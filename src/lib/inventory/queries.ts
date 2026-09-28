import "server-only";
import type { Database } from "@/lib/database.types";
import { isUuid } from "@/lib/jobs/errors";
import { createClient } from "@/lib/supabase/server";
import { combineShortages, type ShortageLine } from "./shortages";
import { weekStart } from "./status";

export type { ShortageLine };

// Pre-Week Setup reads with the signed-in user's own session: Row Level
// Security shows employees active trailers and owners everything. Callers
// must run requireUser() or requireOwner() first.

type Overview = Database["public"]["Views"]["weekly_setup_overview"]["Row"];
export type SetupItem = Database["public"]["Views"]["weekly_setup_item_detail"]["Row"];

export type TrailerCard = {
  id: string;
  name: string;
  week: string;
  setup: Overview | null;
};

// Active trailers with this week's setup, if started.
export async function listTrailerCards(): Promise<TrailerCard[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const week = weekStart();
  const [trailers, setups] = await Promise.all([
    supabase.from("trailers").select("id, name, position").is("archived_at", null).order("position"),
    supabase.from("weekly_setup_overview").select("*").eq("week_start", week),
  ]);
  if (trailers.error || setups.error) return null;
  return (trailers.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    week,
    setup: (setups.data ?? []).find((s) => s.trailer_id === t.id) ?? null,
  }));
}

export type SetupDetail = {
  overview: Overview;
  items: SetupItem[];
  reopenings: { id: string; reason: string; reopenedAt: string; reopenedByName: string | null }[];
};

export async function loadSetup(setupId: string): Promise<SetupDetail | null | "error"> {
  if (!isUuid(setupId)) return null;
  const supabase = await createClient();
  if (!supabase) return "error";
  const [overview, items, reopenings] = await Promise.all([
    supabase.from("weekly_setup_overview").select("*").eq("id", setupId).maybeSingle(),
    supabase.from("weekly_setup_item_detail").select("*").eq("setup_id", setupId).order("category_position").order("position"),
    supabase.from("weekly_setup_reopening_history").select("*").eq("setup_id", setupId).order("reopened_at"),
  ]);
  if (overview.error || items.error || reopenings.error) return "error";
  if (!overview.data) return null;
  return {
    overview: overview.data,
    items: items.data ?? [],
    reopenings: (reopenings.data ?? []).map((r) => ({
      id: r.id,
      reason: r.reason,
      reopenedAt: r.reopened_at,
      reopenedByName: r.reopened_by_name,
    })),
  };
}

// This week's setup for a trailer, created with its snapshot on first visit.
export async function openCurrentSetup(trailerId: string): Promise<string | null | "error"> {
  if (!isUuid(trailerId)) return null;
  const supabase = await createClient();
  if (!supabase) return "error";
  const { data, error } = await supabase.rpc("ensure_weekly_setup", { p_trailer: trailerId });
  if (error) return error.code === "P0002" ? null : "error";
  return data;
}

// This week's Missing and Need More items across active trailers: each
// trailer's shortage, and a combined total for counted items.
export async function currentShortages(): Promise<ShortageLine[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const setups = await supabase
    .from("weekly_setup_overview")
    .select("id, trailer_id, trailer_name, trailer_archived_at")
    .eq("week_start", weekStart())
    .is("trailer_archived_at", null);
  if (setups.error) return null;
  const ids = (setups.data ?? []).map((s) => s.id);
  if (ids.length === 0) return [];
  const items = await supabase
    .from("weekly_setup_item_detail")
    .select("*")
    .in("setup_id", ids)
    .in("status", ["missing", "need_more"])
    .order("category_position")
    .order("position");
  if (items.error) return null;

  return combineShortages(
    (items.data ?? []).map((i) => ({
      setupId: i.setup_id,
      label: i.label,
      unitLabel: i.unit_label,
      tracking: i.tracking,
      status: i.status as "missing" | "need_more",
      shortage: i.shortage,
      note: i.note,
    })),
    (setups.data ?? []).map((st) => ({ id: st.id, trailerId: st.trailer_id, trailerName: st.trailer_name })),
  );
}

// Owner pages ------------------------------------------------------------------------

export async function listTrailers() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("trailers").select("*").order("position");
  return error ? null : (data ?? []);
}

export async function listTemplate() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("inventory_items").select("*").order("category_position").order("position");
  return error ? null : (data ?? []);
}

export async function listSetupHistory() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("weekly_setup_overview")
    .select("*")
    .order("week_start", { ascending: false })
    .order("trailer_name")
    .limit(200);
  return error ? null : (data ?? []);
}

export async function listSubmissions(setupId: string) {
  if (!isUuid(setupId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("weekly_setup_submission_history")
    .select("*")
    .eq("setup_id", setupId)
    .order("submitted_at", { ascending: false });
  return error ? null : (data ?? []);
}
