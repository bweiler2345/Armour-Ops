import "server-only";
import { isUuid } from "@/lib/jobs/errors";
import { asDefinition, type StepDefinition } from "@/lib/steps/definition";
import { createClient } from "@/lib/supabase/server";

// The owner-only Custom Step Library, read with the owner's own session
// (Row Level Security hides it from everyone else). Callers must run
// requireOwner() first.

export type LibraryListItem = {
  id: string;
  title: string;
  version: number;
  archived: boolean;
  updatedAt: string;
};

export async function listLibraryItems(): Promise<LibraryListItem[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const [items, versions] = await Promise.all([
    supabase.from("step_library_items").select("*").order("created_at"),
    supabase.from("step_library_versions").select("item_id, version_number, title, created_at"),
  ]);
  if (items.error || versions.error) return null;
  return (items.data ?? [])
    .map((item) => {
      const current = (versions.data ?? []).find(
        (v) => v.item_id === item.id && v.version_number === item.current_version,
      );
      return {
        id: item.id,
        title: current?.title ?? "Untitled step",
        version: item.current_version,
        archived: item.archived_at !== null,
        updatedAt: current?.created_at ?? item.created_at,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export type LibraryItemDetail = {
  id: string;
  archived: boolean;
  archivedAt: string | null;
  version: number;
  definition: StepDefinition;
  versions: { number: number; title: string; createdAt: string }[];
  references: { linkId: string; pictureId: string }[];
  importedCount: number;
};

export async function getLibraryItem(itemId: string): Promise<LibraryItemDetail | null | "error"> {
  if (!isUuid(itemId)) return null;
  const supabase = await createClient();
  if (!supabase) return "error";
  const [item, versions, references, imports] = await Promise.all([
    supabase.from("step_library_items").select("*").eq("id", itemId).maybeSingle(),
    supabase
      .from("step_library_versions")
      .select("id, version_number, title, definition, created_at")
      .eq("item_id", itemId)
      .order("version_number", { ascending: false }),
    supabase
      .from("reference_picture_links")
      .select("id, picture_id")
      .eq("library_item_id", itemId)
      .is("archived_at", null)
      .order("position"),
    supabase.from("job_steps").select("id, source_library_version_id").not("source_library_version_id", "is", null),
  ]);
  if (item.error || versions.error || references.error || imports.error) return "error";
  if (!item.data) return null;
  const versionIds = new Set((versions.data ?? []).map((v) => v.id));
  const current = (versions.data ?? []).find((v) => v.version_number === item.data!.current_version);
  return {
    id: item.data.id,
    archived: item.data.archived_at !== null,
    archivedAt: item.data.archived_at,
    version: item.data.current_version,
    definition: asDefinition(current?.definition),
    versions: (versions.data ?? []).map((v) => ({ number: v.version_number, title: v.title, createdAt: v.created_at })),
    references: (references.data ?? []).map((r) => ({ linkId: r.id, pictureId: r.picture_id })),
    importedCount: (imports.data ?? []).filter((s) => versionIds.has(s.source_library_version_id!)).length,
  };
}

// Current reference pictures on a standard workflow step.
export async function listWorkflowStepReferences(stepId: string) {
  if (!isUuid(stepId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("reference_picture_links")
    .select("id, picture_id")
    .eq("workflow_step_id", stepId)
    .is("archived_at", null)
    .order("position");
  if (error) return null;
  return (data ?? []).map((r) => ({ linkId: r.id, pictureId: r.picture_id }));
}

// Safe places for a new custom step on a job, per employee stage.
export async function customStepPositions(jobId: string) {
  if (!isUuid(jobId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("custom_step_positions", { p_job: jobId });
  if (error) return null;
  return (data ?? []).map((r) => ({
    stageId: r.stage_id,
    stageName: r.stage_name,
    first: r.first_position,
    last: r.last_position,
  }));
}
