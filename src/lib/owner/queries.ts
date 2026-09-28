import "server-only";
import { createClient } from "@/lib/supabase/server";
import { toDashboardJob, type DashboardJob } from "./dashboard";

// Owner Dashboard data, read with the owner's own session. The database
// functions check the owner again and return names only. Callers must run
// requireOwner() first.

export type RecentActivity = {
  id: number;
  jobId: string;
  jobNumber: number;
  clientName: string;
  type: string;
  actorName: string | null;
  details: unknown;
  names: Record<string, string>;
  at: string;
};

export async function loadOwnerDashboard(): Promise<
  { status: "ok"; jobs: DashboardJob[]; activity: RecentActivity[]; loadedAt: string } | { status: "error" }
> {
  const supabase = await createClient();
  if (!supabase) return { status: "error" };
  const [jobs, activity] = await Promise.all([
    supabase.rpc("owner_dashboard"),
    supabase.rpc("owner_recent_activity", { p_limit: 25 }),
  ]);
  if (jobs.error || activity.error) {
    console.error("[owner] dashboard load failed", { code: jobs.error?.code ?? activity.error?.code });
    return { status: "error" };
  }
  return {
    status: "ok",
    jobs: (jobs.data ?? []).map(toDashboardJob),
    activity: (activity.data ?? []).map((a) => ({
      id: a.id,
      jobId: a.job_id,
      jobNumber: a.job_number,
      clientName: a.client_name,
      type: a.activity_type,
      actorName: a.actor_name,
      details: a.details,
      names: (a.names ?? {}) as Record<string, string>,
      at: a.created_at,
    })),
    loadedAt: new Date().toISOString(),
  };
}
