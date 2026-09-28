"use server";

import { revalidatePath } from "next/cache";
import { requireOwner, requireUser } from "@/lib/dal";
import { isUuid, jobErrorMessage, JOB_ERROR_MESSAGES } from "@/lib/jobs/errors";
import { createClient } from "@/lib/supabase/server";

// Pre-Week Setup. Every action checks the signed-in user here, then a
// database function checks the role, the week, and the setup's state again,
// and calculates every status and shortage itself.

export type SetupResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { value: T }))
  | { ok: false; error: string };

type RpcError = { code?: string; message?: string } | null;

function fail(action: string, error: RpcError): { ok: false; error: string } {
  console.error(`[pre-week-setup] ${action} failed`, { code: error?.code });
  return { ok: false, error: jobErrorMessage(error) };
}

function refresh() {
  revalidatePath("/pre-week-setup", "layout");
  revalidatePath("/owner/pre-week-setup", "layout");
  revalidatePath("/owner");
}

async function client() {
  const supabase = await createClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

// Employees ------------------------------------------------------------------------------

export async function saveSetupItem(input: {
  itemId: string;
  quantity: number | null;
  status: "ready" | "missing" | "need_more" | null;
  note: string;
}): Promise<SetupResult<{ status: string | null; shortage: number | null }>> {
  await requireUser();
  if (!isUuid(input.itemId)) return { ok: false, error: "Item not found." };
  const { data, error } = await (await client()).rpc("save_setup_item", {
    p_item: input.itemId,
    p_quantity: input.quantity,
    p_status: input.status,
    p_note: String(input.note ?? "").slice(0, 500),
  });
  if (error) return fail("save_setup_item", error);
  const row = Array.isArray(data) ? data[0] : null;
  return { ok: true, value: { status: row?.status ?? null, shortage: row?.shortage ?? null } };
}

export async function saveRestockNotes(setupId: string, notes: string): Promise<SetupResult> {
  await requireUser();
  if (!isUuid(setupId)) return { ok: false, error: "Setup not found." };
  const { error } = await (await client()).rpc("save_setup_restock_notes", { p_setup: setupId, p_notes: String(notes ?? "").slice(0, 2000) });
  return error ? fail("save_setup_restock_notes", error) : { ok: true };
}

export async function submitSetup(setupId: string): Promise<SetupResult<"submitted" | "already_submitted">> {
  await requireUser();
  if (!isUuid(setupId)) return { ok: false, error: "Setup not found." };
  const { data, error } = await (await client()).rpc("submit_weekly_setup", { p_setup: setupId });
  if (error) return fail("submit_weekly_setup", error);
  refresh();
  return { ok: true, value: data };
}

// Owner --------------------------------------------------------------------------------------

type Outcome = { ok: boolean; error?: string; message?: string };

async function ownerCall(action: string, run: (s: Awaited<ReturnType<typeof client>>) => PromiseLike<{ error: RpcError }>, message: string): Promise<Outcome> {
  await requireOwner();
  const { error } = await run(await client());
  if (error) return fail(action, error);
  refresh();
  return { ok: true, message };
}

export async function reopenSetup(setupId: string, reason: string): Promise<Outcome> {
  if (!isUuid(setupId)) return { ok: false, error: "Setup not found." };
  if (!String(reason ?? "").trim()) return { ok: false, error: "Give a reason for reopening this setup." };
  return ownerCall("reopen_weekly_setup", (s) => s.rpc("reopen_weekly_setup", { p_setup: setupId, p_reason: reason.trim() }),
    "Reopened. The team can change it and submit again; the earlier submission is kept.");
}

export async function addTrailer(name: string): Promise<Outcome> {
  return ownerCall("add_trailer", (s) => s.rpc("add_trailer", { p_name: String(name ?? "").trim() }), "Trailer added.");
}

export async function renameTrailer(trailerId: string, name: string): Promise<Outcome> {
  if (!isUuid(trailerId)) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  return ownerCall("rename_trailer", (s) => s.rpc("rename_trailer", { p_trailer: trailerId, p_name: String(name ?? "").trim() }), "Trailer renamed.");
}

export async function archiveTrailer(trailerId: string): Promise<Outcome> {
  if (!isUuid(trailerId)) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  return ownerCall("archive_trailer", (s) => s.rpc("archive_trailer", { p_trailer: trailerId }),
    "Trailer archived. Its history is kept.");
}

function itemFields(form: FormData) {
  const target = String(form.get("target") ?? "").trim();
  return {
    category: String(form.get("category") ?? "").trim(),
    label: String(form.get("label") ?? "").trim(),
    tracking: form.get("tracking") === "status_only" ? ("status_only" as const) : ("count" as const),
    target: target === "" ? null : Number(target),
    unit: String(form.get("unit") ?? "").trim() || null,
  };
}

export async function addInventoryItem(_previous: Outcome, form: FormData): Promise<Outcome> {
  const f = itemFields(form);
  return ownerCall(
    "add_inventory_item",
    (s) =>
      s.rpc("add_inventory_item", {
        p_category: f.category,
        p_label: f.label,
        p_tracking: f.tracking,
        p_target: f.tracking === "count" ? f.target : null,
        p_unit: f.tracking === "count" ? f.unit : null,
      }),
    "Item added. It appears from the next setup started.",
  );
}

export async function updateInventoryItem(itemId: string, _previous: Outcome, form: FormData): Promise<Outcome> {
  if (!isUuid(itemId)) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  const f = itemFields(form);
  return ownerCall(
    "update_inventory_item",
    (s) => s.rpc("update_inventory_item", { p_item: itemId, p_category: f.category, p_label: f.label, p_target: f.target, p_unit: f.unit }),
    "Saved for future weeks. Weeks already started keep their list.",
  );
}

export async function archiveInventoryItem(itemId: string): Promise<Outcome> {
  if (!isUuid(itemId)) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  return ownerCall("archive_inventory_item", (s) => s.rpc("archive_inventory_item", { p_item: itemId }),
    "Item archived for future weeks. Past weeks keep it.");
}

export async function moveInventoryItem(itemId: string, direction: -1 | 1): Promise<Outcome> {
  if (!isUuid(itemId) || (direction !== -1 && direction !== 1)) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  return ownerCall("move_inventory_item", (s) => s.rpc("move_inventory_item", { p_item: itemId, p_direction: direction }), "Moved.");
}
