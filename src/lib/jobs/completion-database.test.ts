import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser } from "@/test/database";

// Runs every migration in an in-process Postgres and checks Phase 7: owner
// installation milestones, Completion Work, and owner job completion.
//
// Test-database fixture: preparation steps are marked complete directly and
// the job is walked through the approved statuses with set_job_status (the
// same internal helper Complete Step uses), because the approved preparation
// steps need real uploads. The app itself has no such bypass.

let db: PGlite;
let owner: string;
let a: string; // lead
let b: string; // member
let outsider: string;

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createUser(db, { role: "owner" });
  a = await createUser(db, { role: "employee" });
  b = await createUser(db, { role: "employee" });
  outsider = await createUser(db, { role: "employee" });
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function rows<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function call(userId: string, fn: string, ...args: unknown[]) {
  const [row] = await as(db, { userId }, () =>
    rows<{ result: unknown }>(
      `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as result`,
      args,
    ),
  );
  return row.result;
}

async function newJob({ caulking = true, baseboard = false } = {}) {
  const [{ id }] = await as(db, { userId: owner }, () =>
    rows<{ id: string }>(
      `select public.create_job('Sample Client', '1 Sample Road', 500, 'Sample', '2026-10-20', '', $1, $2) as id`,
      [caulking, baseboard],
    ),
  );
  await call(owner, "make_job_available", id);
  await call(a, "claim_job", id);
  await call(b, "join_job", id);
  return id;
}

async function stepIds(jobId: string, stage: string) {
  return (
    await rows<{ id: string }>(
      `select s.id from public.job_steps s join public.job_stages st on st.id = s.job_stage_id
       where s.job_id = $1 and st.key = $2 order by s.position`,
      [jobId, stage],
    )
  ).map((r) => r.id);
}

async function item(jobId: string, key: "caulking_complete" | "baseboard_complete") {
  const [{ id }] = await rows<{ id: string }>(`select id from public.job_steps where job_id = $1 and key = $2`, [
    jobId,
    key,
  ]);
  return id;
}

async function status(jobId: string) {
  const [{ s }] = await rows<{ s: string }>(`select status as s from public.jobs where id = $1`, [jobId]);
  return s;
}

async function state(stepId: string) {
  const [{ s }] = await rows<{ s: string }>(`select public.job_step_state($1) as s`, [stepId]);
  return s;
}

async function history(jobId: string, type: string) {
  return rows<{ actor_id: string; details: Record<string, unknown>; created_at: Date }>(
    `select actor_id, details, created_at from public.job_activity where job_id = $1 and activity_type = $2 order by id`,
    [jobId, type],
  );
}

async function forceStage(jobId: string, stage: string) {
  for (const id of await stepIds(jobId, stage)) {
    await rows(
      `insert into public.step_attempts
         (job_id, job_step_id, attempt_number, status, started_by, completed_by, completed_at, confirmation_text_shown)
       select job_id, id, 1, 'completed', $2, $2, now(), confirmation_text from public.job_steps where id = $1`,
      [id, a],
    );
  }
}

async function walk(jobId: string, ...statuses: string[]) {
  for (const to of statuses) await rows(`select public.set_job_status($1, $2, $3)`, [jobId, to, a]);
}

async function waitingForBase(options?: { caulking?: boolean; baseboard?: boolean }) {
  const job = await newJob(options);
  await forceStage(job, "initial_prep");
  await walk(job, "initial_prep_in_progress", "waiting_for_base_coat_installation");
  return job;
}

async function waitingForTop(options?: { caulking?: boolean; baseboard?: boolean }) {
  const job = await waitingForBase(options);
  await call(owner, "mark_milestone_installed", job, "base_coat_installation");
  await forceStage(job, "top_coat_prep");
  await walk(job, "top_coat_prep_in_progress", "waiting_for_top_coat_installation");
  return job;
}

async function topCoatInstalled(options?: { caulking?: boolean; baseboard?: boolean }) {
  const job = await waitingForTop(options);
  await call(owner, "mark_milestone_installed", job, "top_coat_installation");
  return job;
}

async function progress(jobId: string) {
  const [row] = await as(db, { userId: owner }, () =>
    rows<{
      total_units: number;
      completed_units: number;
      current_step_title: string | null;
      ready_for_owner_completion: boolean;
    }>(`select * from public.job_progress where job_id = $1`, [jobId]),
  );
  return row;
}

describe("Mark Base Coat Installed", () => {
  it("is unavailable before the job is Waiting for Base-Coat Installation", async () => {
    const job = await newJob();
    await expect(call(owner, "mark_milestone_installed", job, "base_coat_installation")).rejects.toThrow(
      "Base Coat Installed can be marked only while the job is Waiting for Base-Coat Installation.",
    );
    expect(await status(job)).toBe("claimed");
    expect(await history(job, "milestone_installed")).toEqual([]);
  });

  it("can't be marked by an employee, even on the team", async () => {
    const job = await waitingForBase();
    for (const user of [a, b, outsider]) {
      await expect(call(user, "mark_milestone_installed", job, "base_coat_installation")).rejects.toThrow(
        "Only an active owner can do this.",
      );
    }
    expect(await status(job)).toBe("waiting_for_base_coat_installation");
  });

  it("records the owner and database time, changes the status, unlocks Top-Coat Prep, and writes history", async () => {
    const job = await waitingForBase();
    const [firstTopCoatStep, second] = await stepIds(job, "top_coat_prep");
    expect(await state(firstTopCoatStep)).toBe("locked");

    const before = new Date();
    expect(await call(owner, "mark_milestone_installed", job, "base_coat_installation")).toBe("installed");

    expect(await status(job)).toBe("base_coat_installed");
    const [milestone] = await rows<{ installed_by: string; installed_at: Date; milestone_key: string }>(
      `select installed_by, installed_at, milestone_key from public.job_milestones where job_id = $1`,
      [job],
    );
    expect(milestone.installed_by).toBe(owner);
    expect(milestone.milestone_key).toBe("base_coat_installation");
    expect(milestone.installed_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5_000);

    expect(await state(firstTopCoatStep)).toBe("available");
    expect(await state(second)).toBe("locked");
    expect(await history(job, "milestone_installed")).toMatchObject([
      { actor_id: owner, details: { milestone: "base_coat_installation", label: "Base Coat Installed" } },
    ]);
    expect((await history(job, "status_changed")).at(-1)).toMatchObject({
      actor_id: owner,
      details: { from: "waiting_for_base_coat_installation", to: "base_coat_installed" },
    });

    // The team can start Top-Coat Prep; that moves the job on as before.
    await as(db, { userId: a }, () => rows(`select * from public.acquire_step_edit($1)`, [firstTopCoatStep]));
  });

  it("is safe to repeat: no second record, status change, or history entry", async () => {
    const job = await waitingForBase();
    await call(owner, "mark_milestone_installed", job, "base_coat_installation");
    const statusChanges = (await history(job, "status_changed")).length;
    expect(await call(owner, "mark_milestone_installed", job, "base_coat_installation")).toBe("already_installed");
    expect(await rows(`select 1 from public.job_milestones where job_id = $1`, [job])).toHaveLength(1);
    expect(await history(job, "milestone_installed")).toHaveLength(1);
    expect(await history(job, "status_changed")).toHaveLength(statusChanges);
    // A second owner's simultaneous request is serialized by the job lock and
    // sees the first one's record.
    const secondOwner = await createUser(db, { role: "owner" });
    expect(await call(secondOwner, "mark_milestone_installed", job, "base_coat_installation")).toBe(
      "already_installed",
    );
  });

  it("refuses a deactivated owner and unknown milestones", async () => {
    const job = await waitingForBase();
    const former = await createUser(db, { role: "owner", active: false });
    await expect(call(former, "mark_milestone_installed", job, "base_coat_installation")).rejects.toThrow(
      "Only an active owner can do this.",
    );
    await expect(call(owner, "mark_milestone_installed", job, "top_coat")).rejects.toThrow(
      "Unknown installation milestone.",
    );
  });

  it("milestone records can't be changed or removed", async () => {
    const job = await waitingForBase();
    await call(owner, "mark_milestone_installed", job, "base_coat_installation");
    await expect(rows(`update public.job_milestones set installed_at = now() where job_id = $1`, [job])).rejects.toThrow(
      /part of job history/,
    );
    await expect(rows(`delete from public.job_milestones where job_id = $1`, [job])).rejects.toThrow(/part of job history/);
    await expect(
      as(db, { userId: owner }, () =>
        rows(`insert into public.job_milestones (job_id, job_stage_id, milestone_key, installed_by)
              select job_id, id, 'top_coat_installation', $2 from public.job_stages where job_id = $1 and key = 'top_coat_installation'`,
          [job, owner]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("Mark Top Coat Installed", () => {
  it("is unavailable before the job is Waiting for Top-Coat Installation", async () => {
    const job = await waitingForBase();
    await expect(call(owner, "mark_milestone_installed", job, "top_coat_installation")).rejects.toThrow(
      "Top Coat Installed can be marked only while the job is Waiting for Top-Coat Installation.",
    );
    await call(owner, "mark_milestone_installed", job, "base_coat_installation");
    await expect(call(owner, "mark_milestone_installed", job, "top_coat_installation")).rejects.toThrow(
      /only while the job is Waiting for Top-Coat Installation/,
    );
  });

  it("can't be marked by an employee", async () => {
    const job = await waitingForTop();
    await expect(call(a, "mark_milestone_installed", job, "top_coat_installation")).rejects.toThrow(
      "Only an active owner can do this.",
    );
    expect(await status(job)).toBe("waiting_for_top_coat_installation");
  });

  it("records the owner, moves to Top Coat Installed, and unlocks Completion Work", async () => {
    const job = await waitingForTop();
    const caulking = await item(job, "caulking_complete");
    expect(await state(caulking)).toBe("locked");

    expect(await call(owner, "mark_milestone_installed", job, "top_coat_installation")).toBe("installed");
    expect(await status(job)).toBe("top_coat_installed");
    expect(await state(caulking)).toBe("available");
    expect(await history(job, "milestone_installed")).toMatchObject([
      { details: { milestone: "base_coat_installation" } },
      { actor_id: owner, details: { milestone: "top_coat_installation", label: "Top Coat Installed" } },
    ]);
    const [milestones] = await as(db, { userId: a }, () =>
      rows<{ n: number }>(`select count(*)::int as n from public.job_milestone_status where job_id = $1`, [job]),
    );
    expect(milestones.n).toBe(2);
  });
});

describe("Completion Work", () => {
  it("stays locked until the top coat is installed", async () => {
    const job = await waitingForTop();
    await expect(call(a, "complete_completion_item", await item(job, "caulking_complete"))).rejects.toThrow(
      "Completion Work opens after the top coat is installed.",
    );
  });

  it("with caulking on and baseboard off: caulking applies, baseboard is Not Applicable", async () => {
    const job = await topCoatInstalled({ caulking: true, baseboard: false });
    const caulking = await item(job, "caulking_complete");
    const baseboard = await item(job, "baseboard_complete");
    expect(await state(baseboard)).toBe("not_applicable");
    await expect(call(a, "complete_completion_item", baseboard)).rejects.toThrow(
      "This Completion Work item doesn't apply to this job.",
    );
    expect((await progress(job)).ready_for_owner_completion).toBe(false);
    expect(await call(a, "complete_completion_item", caulking)).toBe("completed");
    expect((await progress(job)).ready_for_owner_completion).toBe(true);
  });

  it("with caulking off and baseboard on: baseboard opens right away", async () => {
    const job = await topCoatInstalled({ caulking: false, baseboard: true });
    expect(await state(await item(job, "caulking_complete"))).toBe("not_applicable");
    expect(await state(await item(job, "baseboard_complete"))).toBe("available");
    expect(await call(b, "complete_completion_item", await item(job, "baseboard_complete"))).toBe("completed");
    expect((await progress(job)).ready_for_owner_completion).toBe(true);
  });

  it("with both on: caulking first, then baseboard", async () => {
    const job = await topCoatInstalled({ caulking: true, baseboard: true });
    const caulking = await item(job, "caulking_complete");
    const baseboard = await item(job, "baseboard_complete");
    expect(await state(baseboard)).toBe("locked");
    await expect(call(a, "complete_completion_item", baseboard)).rejects.toThrow(
      "Finish the earlier Completion Work item first.",
    );
    expect((await progress(job)).current_step_title).toBe("Caulking Complete");
    await call(a, "complete_completion_item", caulking);
    expect(await state(baseboard)).toBe("available");
    expect((await progress(job)).current_step_title).toBe("Baseboard Complete");
    await call(b, "complete_completion_item", baseboard);
    const p = await progress(job);
    expect(p).toMatchObject({ current_step_title: "Ready for owner review", ready_for_owner_completion: true });
    expect(p.completed_units).toBe(p.total_units);
  });

  it("with both off: the job is ready for owner completion right after Top Coat Installation", async () => {
    const job = await topCoatInstalled({ caulking: false, baseboard: false });
    expect(await status(job)).toBe("top_coat_installed");
    expect(await progress(job)).toMatchObject({
      current_step_title: "Ready for owner review",
      ready_for_owner_completion: true,
    });
    expect(await call(owner, "mark_job_complete", job)).toBe("completed");
  });

  it("records the employee and database time, moves the job to Completion Work in Progress, and is safe to repeat", async () => {
    const job = await topCoatInstalled({ caulking: true, baseboard: true });
    const caulking = await item(job, "caulking_complete");
    expect(await call(b, "complete_completion_item", caulking)).toBe("completed");

    const [attempt] = await rows<{ completed_by: string; completed_at: Date; status: string }>(
      `select completed_by, completed_at, status from public.step_attempts where job_step_id = $1`,
      [caulking],
    );
    expect(attempt).toMatchObject({ completed_by: b, status: "completed" });
    expect(attempt.completed_at).toBeInstanceOf(Date);
    expect(await status(job)).toBe("completion_work_in_progress");
    expect((await history(job, "step_completed")).at(-1)).toMatchObject({
      actor_id: b,
      details: { step_id: caulking, title: "Caulking Complete", completion_item: true },
    });

    // A teammate's second tap changes nothing.
    const entries = (await history(job, "step_completed")).length;
    expect(await call(a, "complete_completion_item", caulking)).toBe("already_completed");
    expect(await rows(`select 1 from public.step_attempts where job_step_id = $1`, [caulking])).toHaveLength(1);
    expect(await history(job, "step_completed")).toHaveLength(entries);

    // Completed items never change.
    await expect(
      rows(`update public.step_attempts set completed_by = $2 where job_step_id = $1`, [caulking, a]),
    ).rejects.toThrow("Completed step work cannot be changed.");
  });

  it("refuses the owner, unassigned, removed, and deactivated employees", async () => {
    const job = await topCoatInstalled();
    const caulking = await item(job, "caulking_complete");
    await expect(call(owner, "complete_completion_item", caulking)).rejects.toThrow(/active employee/i);
    await expect(call(outsider, "complete_completion_item", caulking)).rejects.toThrow(
      "Only employees on this job's team can mark Completion Work.",
    );

    await call(owner, "remove_team_member", job, b);
    await expect(call(b, "complete_completion_item", caulking)).rejects.toThrow(
      "Only employees on this job's team can mark Completion Work.",
    );

    const c = await createUser(db, { role: "employee" });
    await call(owner, "add_team_member", job, c);
    await rows(`update public.profiles set active = false where id = $1`, [c]);
    await expect(call(c, "complete_completion_item", caulking)).rejects.toThrow(/active employee|deactivated/i);
    expect(await state(caulking)).toBe("available");
  });

  it("never uses edit leases, answers, uploads, or Complete Step", async () => {
    const job = await topCoatInstalled();
    const caulking = await item(job, "caulking_complete");
    await expect(as(db, { userId: a }, () => rows(`select * from public.acquire_step_edit($1)`, [caulking]))).rejects.toThrow(
      "Completion Work items are marked complete with their own button.",
    );
  });
});

describe("Mark Job Complete", () => {
  it("is blocked until both milestones and all applicable Completion Work are done", async () => {
    const early = await waitingForTop();
    await expect(call(owner, "mark_job_complete", early)).rejects.toThrow(
      "A job can be marked Complete only after the top coat is installed and all Completion Work is done.",
    );

    const job = await topCoatInstalled({ caulking: true, baseboard: true });
    await expect(call(owner, "mark_job_complete", job)).rejects.toThrow(
      "Finish every step first. Not done yet: Caulking Complete",
    );
    await call(a, "complete_completion_item", await item(job, "caulking_complete"));
    await expect(call(owner, "mark_job_complete", job)).rejects.toThrow(/Not done yet: Baseboard Complete/);
    expect(await status(job)).toBe("completion_work_in_progress");
  });

  it("is owner only", async () => {
    const job = await topCoatInstalled({ caulking: false });
    for (const user of [a, b, outsider]) {
      await expect(call(user, "mark_job_complete", job)).rejects.toThrow("Only an active owner can do this.");
    }
    expect(await status(job)).toBe("top_coat_installed");
  });

  it("records the owner, database time, final status, history, and a five-year media retention date", async () => {
    const job = await topCoatInstalled({ caulking: true });
    await call(a, "complete_completion_item", await item(job, "caulking_complete"));
    expect(await call(owner, "mark_job_complete", job)).toBe("completed");

    const [row] = await rows<{ status: string; completed_by: string; completed_at: Date; media_delete_after: Date; same: boolean }>(
      `select status, completed_by, completed_at, media_delete_after,
              media_delete_after = completed_at + interval '5 years' as same
       from public.jobs where id = $1`,
      [job],
    );
    expect(row).toMatchObject({ status: "complete", completed_by: owner, same: true });
    expect(row.media_delete_after.getUTCFullYear() - row.completed_at.getUTCFullYear()).toBe(5);
    expect((await history(job, "status_changed")).at(-1)).toMatchObject({
      actor_id: owner,
      details: { from: "completion_work_in_progress", to: "complete" },
    });
    expect(await history(job, "job_completed")).toHaveLength(1);
    expect(await progress(job)).toMatchObject({ current_step_title: null, ready_for_owner_completion: false });

    // Repeated: no second history entry or change.
    expect(await call(owner, "mark_job_complete", job)).toBe("already_complete");
    expect(await history(job, "job_completed")).toHaveLength(1);

    // Nothing is deleted or scheduled for deletion yet.
    const [kept] = await rows<{ attempts: number; team: number; milestones: number }>(
      `select (select count(*)::int from public.step_attempts where job_id = $1) as attempts,
              (select count(*)::int from public.job_assignments where job_id = $1) as team,
              (select count(*)::int from public.job_milestones where job_id = $1) as milestones`,
      [job],
    );
    expect(kept.team).toBe(2);
    expect(kept.milestones).toBe(2);
    expect(kept.attempts).toBeGreaterThan(10);
    expect(await as(db, "service_role", () => rows(`select * from public.media_due_for_retention_cleanup()`))).toEqual([]);
  });

  it("leaves a complete job read only", async () => {
    const job = await topCoatInstalled({ caulking: false });
    const [firstStep] = await stepIds(job, "initial_prep");
    await call(owner, "mark_job_complete", job);

    await expect(as(db, { userId: a }, () => rows(`select * from public.acquire_step_edit($1)`, [firstStep]))).rejects.toThrow(
      /already complete|isn't open|job is complete/,
    );
    expect(await call(owner, "mark_milestone_installed", job, "top_coat_installation")).toBe("already_installed");
    await expect(call(owner, "change_lead", job, b)).rejects.toThrow(/in progress/);
    await expect(call(owner, "remove_team_member", job, b)).rejects.toThrow(/complete/);
    await expect(call(owner, "add_team_member", job, outsider)).rejects.toThrow(/complete/);
    await expect(call(owner, "set_job_join_setting", job, false)).rejects.toThrow(/complete/);
    await expect(
      call(owner, "update_job_details", job, 'New Name', '1 Sample Road', 500, 'Sample', '2026-10-20', '', true, false, true),
    ).rejects.toThrow();
    // Even direct changes by the database owner are refused.
    await expect(rows(`update public.jobs set general_notes = 'x' where id = $1`, [job])).rejects.toThrow(
      "This job is complete and can't be changed.",
    );
    await expect(rows(`update public.job_assignments set ended_at = now() where job_id = $1`, [job])).rejects.toThrow(
      "This job is complete and can't be changed.",
    );
    await expect(
      rows(
        `insert into public.step_edit_holds (job_step_id, job_id, held_by, expires_at, lease_id)
         values ($1, $2, $3, now() + interval '2 minutes', gen_random_uuid())`,
        [firstStep, job, a],
      ),
    ).rejects.toThrow("This job is complete and can't be changed.");
  });

  it("refuses completion records on jobs that aren't complete", async () => {
    const job = await newJob();
    await expect(
      rows(`update public.jobs set media_delete_after = now() where id = $1`, [job]),
    ).rejects.toThrow("Only a complete job has a completion record.");
  });
});
