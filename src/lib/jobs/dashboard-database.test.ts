import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser } from "@/test/database";

// Runs every migration in an in-process Postgres and checks the Owner
// Dashboard reads: one row per job with progress, current step, team,
// last activity, editor, and upload problems; the recent activity feed; and
// owner-only access with names but never email addresses.
//
// Test-database fixture: approved preparation steps are marked complete
// directly and jobs are walked through the approved statuses with
// set_job_status, because the approved steps need real uploads.

let db: PGlite;
let owner: string;
let a: string;
let b: string;

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createUser(db, { role: "owner" });
  a = await createUser(db, { role: "employee" });
  b = await createUser(db, { role: "employee" });
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function call<T = unknown>(userId: string, fn: string, ...args: unknown[]): Promise<T> {
  const [row] = await as(db, { userId }, () =>
    rows<{ result: T }>(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as result`, args),
  );
  return row.result;
}

type DashboardRow = {
  job_id: string;
  client_name: string;
  status: string;
  total_units: number;
  completed_units: number;
  current_stage_name: string | null;
  current_step_title: string | null;
  current_step_id: string | null;
  ready_for_owner_completion: boolean;
  reopened_step_title: string | null;
  team: { id: string; name: string; role: string; active: boolean }[];
  working_owners: { id: string; name: string; active: boolean }[];
  last_activity_type: string | null;
  last_activity_actor: string | null;
  last_activity_title: string | null;
  last_activity_time: Date | null;
  last_activity_at: Date;
  editor_name: string | null;
  editor_step_title: string | null;
  editor_expires_at: Date | null;
  unfinished_uploads: number;
  failed_uploads: number;
};

const dashboard = (userId = owner) =>
  as(db, { userId }, () => rows<DashboardRow>(`select * from public.owner_dashboard()`));
const row = async (job: string) => (await dashboard()).find((r) => r.job_id === job)!;

let counter = 0;
async function newJob({ claim = true, caulking = true, baseboard = false, available = true } = {}) {
  counter += 1;
  const id = await call<string>(owner, "create_job", `Client ${counter}`, `${counter} Sample Road`, 500, "Sample", "2026-10-20", "", caulking, baseboard);
  if (available || claim) await call(owner, "make_job_available", id);
  if (claim) {
    await call(a, "claim_job", id);
    await call(b, "join_job", id);
  }
  return id;
}

async function stageSteps(job: string, key: string) {
  return rows<{ id: string; title: string }>(
    `select s.id, s.title from public.job_steps s join public.job_stages st on st.id = s.job_stage_id
     where s.job_id = $1 and st.key = $2 order by s.position`,
    [job, key],
  );
}

async function forceComplete(stepId: string) {
  await rows(
    `insert into public.step_attempts (job_id, job_step_id, attempt_number, status, started_by, completed_by, completed_at)
     select job_id, id, coalesce((select max(attempt_number) from public.step_attempts where job_step_id = $1), 0) + 1,
            'completed', $2, $2, now() from public.job_steps where id = $1`,
    [stepId, a],
  );
}

async function forceStage(job: string, key: string) {
  for (const s of await stageSteps(job, key)) await forceComplete(s.id);
}

async function walk(job: string, ...statuses: string[]) {
  for (const to of statuses) await rows(`select public.set_job_status($1, $2, $3)`, [job, to, a]);
}

async function toWaitingBase(options?: Parameters<typeof newJob>[0]) {
  const job = await newJob(options);
  await forceStage(job, "initial_prep");
  await walk(job, "initial_prep_in_progress", "waiting_for_base_coat_installation");
  return job;
}

async function toTopCoatInstalled(options?: Parameters<typeof newJob>[0]) {
  const job = await toWaitingBase(options);
  await call(owner, "mark_milestone_installed", job, "base_coat_installation");
  await forceStage(job, "top_coat_prep");
  await walk(job, "top_coat_prep_in_progress", "waiting_for_top_coat_installation");
  await call(owner, "mark_milestone_installed", job, "top_coat_installation");
  return job;
}

describe("Owner Dashboard rows", () => {
  it("is owner only and never returns email addresses", async () => {
    await newJob();
    await expect(dashboard(a)).rejects.toThrow("Only an active owner can do this.");
    await expect(as(db, { userId: a }, () => rows(`select * from public.owner_recent_activity(10)`))).rejects.toThrow(
      "Only an active owner can do this.",
    );
    await expect(as(db, "anon", () => rows(`select * from public.owner_dashboard()`))).rejects.toThrow(/permission denied/);
    const former = await createUser(db, { role: "owner", active: false });
    await expect(dashboard(former)).rejects.toThrow("Only an active owner can do this.");

    const everything = JSON.stringify([...(await dashboard()), ...(await as(db, { userId: owner }, () => rows(`select * from public.owner_recent_activity(100)`)))]);
    expect(everything).not.toMatch(/@example\.com|object_key|reference\/|jobs\/[0-9a-f-]{36}\/steps/);
  });

  it("shows Scheduled and Available jobs with no current step", async () => {
    const scheduled = await newJob({ claim: false, available: false });
    const available = await newJob({ claim: false });
    expect(await row(scheduled)).toMatchObject({ status: "scheduled", current_step_id: null, team: [], working_owners: [] });
    expect(await row(available)).toMatchObject({ status: "available_to_claim", current_step_id: null, team: [] });
  });

  it("shows the current stage and step with a link target, the lead and members, and progress", async () => {
    const job = await newJob();
    const [first, second] = await stageSteps(job, "initial_prep");
    await forceComplete(first.id);
    await walk(job, "initial_prep_in_progress");
    const r = await row(job);
    expect(r).toMatchObject({
      status: "initial_prep_in_progress",
      current_stage_name: "Initial Prep",
      current_step_title: second.title,
      current_step_id: second.id,
      completed_units: 1,
      reopened_step_title: null,
    });
    // Caulking applies by default; Baseboard is Not Applicable and not counted.
    const [{ standard }] = await rows<{ standard: number }>(
      `select count(*)::int as standard from public.job_steps where job_id = $1 and kind = 'standard'`,
      [job],
    );
    expect(r.total_units).toBe(standard + 2 + 1);
    expect(r.team.map((m) => [m.id, m.role])).toEqual([
      [a, "lead"],
      [b, "member"],
    ]);
  });

  it("counts both Completion Work items only when both options are on", async () => {
    const both = await newJob({ caulking: true, baseboard: true });
    const neither = await newJob({ caulking: false, baseboard: false });
    expect((await row(both)).total_units - (await row(neither)).total_units).toBe(2);
  });

  it("flags jobs waiting for the owner and ready to mark complete", async () => {
    const base = await toWaitingBase();
    expect(await row(base)).toMatchObject({
      status: "waiting_for_base_coat_installation",
      current_step_title: "Waiting for Base-Coat Installation",
      current_step_id: null,
    });
    const ready = await toTopCoatInstalled({ caulking: false, baseboard: false });
    const r = await row(ready);
    expect(r).toMatchObject({ status: "top_coat_installed", ready_for_owner_completion: true, current_step_title: "Ready for owner review" });
    expect(r.completed_units).toBe(r.total_units);
  });

  it("shows a reopened step first, with its link", async () => {
    const job = await newJob();
    const [first, second] = await stageSteps(job, "initial_prep");
    await forceComplete(first.id);
    await forceComplete(second.id);
    await walk(job, "initial_prep_in_progress");
    await call(owner, "reopen_step", first.id, "Grind again");
    expect(await row(job)).toMatchObject({ reopened_step_title: first.title, current_step_id: first.id, current_step_title: first.title });
  });

  it("shows the active editor and lease expiry, and the last activity with who did it", async () => {
    const job = await newJob();
    const [first] = await stageSteps(job, "initial_prep");
    const [lease] = await as(db, { userId: b }, () =>
      rows<{ expires_at: Date }>(`select * from public.acquire_step_edit($1)`, [first.id]),
    );
    const r = await row(job);
    const [{ name }] = await rows<{ name: string }>(`select full_name as name from public.profiles where id = $1`, [b]);
    expect(r).toMatchObject({ editor_name: name, editor_step_title: first.title });
    expect(r.editor_expires_at?.getTime()).toBe(lease.expires_at.getTime());

    // Saving a check starts the step: the newest history entry is attributed to B.
    const [item] = await rows<{ id: string }>(
      `select i.id from public.job_step_block_items i join public.job_step_blocks bl on bl.id = i.job_block_id
       where bl.job_step_id = $1 and bl.kind = 'checklist' limit 1`,
      [first.id],
    );
    const [{ lease_id }] = await rows<{ lease_id: string }>(`select lease_id from public.step_edit_holds where job_step_id = $1`, [first.id]);
    await call(b, "save_step_check", first.id, lease_id, item.id, true);
    const after = await row(job);
    const [newest] = await rows<{ activity_type: string; created_at: Date }>(
      `select activity_type, created_at from public.job_activity where job_id = $1 order by created_at desc, id desc limit 1`,
      [job],
    );
    expect(after.last_activity_type).toBe(newest.activity_type);
    expect(after.last_activity_actor).toBe(name);
    expect(after.last_activity_time?.getTime()).toBe(newest.created_at.getTime());

    // An expired lease is no longer shown.
    await rows(`update public.step_edit_holds set acquired_at = now() - interval '10 minutes', expires_at = now() - interval '5 minutes' where job_step_id = $1`, [first.id]);
    expect((await row(job)).editor_name).toBeNull();
  });

  it("counts unfinished and failed uploads on work in progress", async () => {
    const job = await newJob();
    const [first] = await stageSteps(job, "initial_prep");
    const [lease] = await as(db, { userId: a }, () => rows<{ lease_id: string }>(`select * from public.acquire_step_edit($1)`, [first.id]));
    const [req] = await rows<{ id: string }>(`select id from public.job_step_proof_requirements where job_step_id = $1`, [first.id]);
    const start = () =>
      as(db, { userId: a }, () =>
        rows<{ media_id: string; object_key: string }>(
          `select * from public.create_media_upload($1, $2, $3, 'video', 'video/quicktime', 90000000, null, 95, 'IMG.MOV', 1)`,
          [first.id, lease.lease_id, req.id],
        ),
      );
    const [up] = await start();
    expect(await row(job)).toMatchObject({ unfinished_uploads: 1, failed_uploads: 0 });
    // The server found the wrong size: the upload failed.
    await as(db, "service_role", () =>
      rows(`select public.confirm_media_upload($1, $2, $3, $4, 1, 'video/quicktime')`, [up.media_id, a, lease.lease_id, up.object_key]),
    );
    expect(await row(job)).toMatchObject({ unfinished_uploads: 0, failed_uploads: 1 });
  });

  it("shows active Working Owners separately from the employee team", async () => {
    const job = await newJob();
    await call(owner, "join_job_as_working_owner", job);
    const r = await row(job);
    expect(r.working_owners.map((w) => w.id)).toEqual([owner]);
    expect(r.team.map((m) => m.role)).toEqual(["lead", "member"]);
    await call(owner, "leave_working_team", job);
    expect((await row(job)).working_owners).toEqual([]);
  });

  it("shows completed jobs with their completion time", async () => {
    const job = await toTopCoatInstalled({ caulking: false, baseboard: false });
    await call(owner, "mark_job_complete", job);
    const r = (await dashboard()).find((x) => x.job_id === job) as DashboardRow & { completed_at: Date };
    expect(r).toMatchObject({ status: "complete", current_step_id: null, current_step_title: null });
    expect(r.completed_at).toBeInstanceOf(Date);
  });
});

describe("recent activity", () => {
  it("lists the newest entries across jobs with names", async () => {
    const job = await newJob();
    const feed = await as(db, { userId: owner }, () =>
      rows<{ job_id: string; activity_type: string; actor_name: string | null; names: Record<string, string>; created_at: Date }>(
        `select * from public.owner_recent_activity(5)`,
      ),
    );
    expect(feed).toHaveLength(5);
    const times = feed.map((f) => f.created_at.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    const joined = feed.find((f) => f.job_id === job && f.activity_type === "employee_joined");
    expect(joined?.actor_name).toBeTruthy();
    expect(Object.keys(joined?.names ?? {})).toEqual([b]);
  });
});

describe("performance", () => {
  it("returns a realistic number of jobs quickly", async () => {
    for (let i = 0; i < 60; i++) await newJob({ claim: i % 2 === 0, available: i % 3 !== 0 });
    const started = performance.now();
    const all = await dashboard();
    const elapsed = performance.now() - started;
    expect(all.length).toBeGreaterThan(70);
    // In-process test Postgres (WebAssembly) is much slower than Supabase.
    expect(elapsed).toBeLessThan(10_000);
  }, 120_000);
});
