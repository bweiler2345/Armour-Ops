import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser } from "@/test/database";

// Runs every migration in an in-process Postgres and checks claiming,
// joining, owner team management, lead rules, history, and access.

let db: PGlite;
let owner: string;
let emp: string[] = [];

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createUser(db, { role: "owner" });
  emp = [];
  for (let i = 0; i < 12; i++) emp.push(await createUser(db, { role: "employee" }));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function rows<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

const call = (userId: string, fn: string, ...args: unknown[]) =>
  as(db, { userId }, () =>
    rows(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args),
  );

async function newJob({ available = true, allowJoin = true } = {}) {
  const [{ id }] = await as(db, { userId: owner }, () =>
    rows<{ id: string }>(
      `select public.create_job('Sample Client', '1 Sample Road', 500, 'Sample', '2026-10-20', '',
                                true, false, $1) as id`,
      [allowJoin],
    ),
  );
  if (available) await call(owner, "make_job_available", id);
  return id;
}

async function team(jobId: string) {
  return rows<{ employee_id: string; role: string }>(
    `select employee_id, role from public.job_assignments
     where job_id = $1 and ended_at is null order by role, employee_id`,
    [jobId],
  );
}

async function status(jobId: string) {
  const [{ status: s }] = await rows<{ status: string }>(`select status from public.jobs where id = $1`, [jobId]);
  return s;
}

describe("claiming", () => {
  it("makes the first claimant the lead and moves the job to Claimed", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);

    expect(await status(job)).toBe("claimed");
    const [assignment] = await rows<Record<string, unknown>>(
      `select employee_id, role, method, assigned_by, assigned_at, ended_at
       from public.job_assignments where job_id = $1`,
      [job],
    );
    expect(assignment).toMatchObject({
      employee_id: emp[0],
      role: "lead",
      method: "claimed",
      assigned_by: emp[0],
      ended_at: null,
    });
    expect(assignment.assigned_at).toBeInstanceOf(Date);

    const [activity] = await rows(
      `select actor_id, activity_type, details from public.job_activity
       where job_id = $1 and activity_type = 'claimed'`,
      [job],
    );
    expect(activity).toEqual({
      actor_id: emp[0],
      activity_type: "claimed",
      details: { employee_id: emp[0] },
    });
  });

  it("refuses a losing claim with a clear message and saves nothing for it", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await expect(call(emp[1], "claim_job", job)).rejects.toThrow(/Someone else claimed this job first/);
    expect(await team(job)).toEqual([{ employee_id: emp[0], role: "lead" }]);
    expect(
      await rows(`select count(*)::int as n from public.job_activity where job_id = $1 and actor_id = $2`, [
        job,
        emp[1],
      ]),
    ).toEqual([{ n: 0 }]);
  });

  it("lets exactly one of many simultaneous claims win", async () => {
    const job = await newJob();
    // Each claim is one statement that sets the caller and claims, so the
    // requests can be fired together without sharing session state.
    const attempts = emp.slice(0, 10).map((employee) =>
      db
        .query(
          `select set_config('request.jwt.claim.sub', $1, false), public.claim_job($2)`,
          [employee, job],
        )
        .then(
          () => "won",
          (error: Error) => error.message,
        ),
    );
    const results = await Promise.all(attempts);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);

    expect(results.filter((r) => r === "won")).toHaveLength(1);
    expect(results.filter((r) => /Someone else claimed this job first/.test(r))).toHaveLength(9);
    const leads = await team(job);
    expect(leads).toHaveLength(1);
    expect(leads[0].role).toBe("lead");
    expect(
      await rows(`select count(*)::int as n from public.job_assignments where job_id = $1`, [job]),
    ).toEqual([{ n: 1 }]);
  });

  it("refuses Scheduled and complete jobs", async () => {
    const scheduled = await newJob({ available: false });
    await expect(call(emp[0], "claim_job", scheduled)).rejects.toThrow(/isn't available to claim/);
    expect(await team(scheduled)).toEqual([]);
  });

  it("lets one employee lead several jobs at once", async () => {
    const a = await newJob();
    const b = await newJob();
    await call(emp[5], "claim_job", a);
    await call(emp[5], "claim_job", b);
    expect(
      await rows(
        `select count(*)::int as n from public.job_assignments where employee_id = $1 and ended_at is null
         and job_id in ($2, $3)`,
        [emp[5], a, b],
      ),
    ).toEqual([{ n: 2 }]);
  });
});

describe("one active lead", () => {
  it("rejects a second active lead even through direct database writes", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await expect(
      rows(
        `insert into public.job_assignments (job_id, employee_id, role, method, assigned_by)
         values ($1, $2, 'lead', 'claimed', $2)`,
        [job, emp[1]],
      ),
    ).rejects.toThrow(/job_assignments_one_active_lead/);
  });

  it("rejects a team with members but no lead", async () => {
    const job = await newJob();
    await expect(
      rows(
        `insert into public.job_assignments (job_id, employee_id, role, method, assigned_by)
         values ($1, $2, 'member', 'joined', $2)`,
        [job, emp[1]],
      ),
    ).rejects.toThrow(/exactly one lead/);
  });
});

describe("joining", () => {
  it("lets active employees join an in-progress job when joining is on", async () => {
    const job = await newJob({ allowJoin: true });
    await call(emp[0], "claim_job", job);
    await call(emp[1], "join_job", job);
    await call(emp[2], "join_job", job);
    expect(await team(job)).toEqual(
      [
        { employee_id: emp[0], role: "lead" },
        { employee_id: emp[1], role: "member" },
        { employee_id: emp[2], role: "member" },
      ].sort((a, b) => (a.role + a.employee_id < b.role + b.employee_id ? -1 : 1)),
    );
    const [joined] = await rows<Record<string, unknown>>(
      `select method, assigned_by from public.job_assignments where job_id = $1 and employee_id = $2`,
      [job, emp[1]],
    );
    expect(joined).toEqual({ method: "joined", assigned_by: emp[1] });
  });

  it("refuses joining when the owner turned it off", async () => {
    const job = await newJob({ allowJoin: false });
    await call(emp[0], "claim_job", job);
    await expect(call(emp[1], "join_job", job)).rejects.toThrow(/turned off joining/);
    expect(await team(job)).toHaveLength(1);
  });

  it("follows the owner changing the setting later", async () => {
    const job = await newJob({ allowJoin: true });
    await call(emp[0], "claim_job", job);
    await call(owner, "set_job_join_setting", job, false);
    await expect(call(emp[1], "join_job", job)).rejects.toThrow(/turned off joining/);
    await call(owner, "set_job_join_setting", job, true);
    await call(emp[1], "join_job", job);
    expect(await team(job)).toHaveLength(2);
    const changes = await rows<{ details: unknown }>(
      `select details from public.job_activity where job_id = $1 and activity_type = 'join_setting_changed' order by id`,
      [job],
    );
    expect(changes.map((c) => c.details)).toEqual([
      { from: true, to: false },
      { from: false, to: true },
    ]);
  });

  it("refuses Scheduled, Available, and duplicate joins", async () => {
    const scheduled = await newJob({ available: false });
    await expect(call(emp[1], "join_job", scheduled)).rejects.toThrow(/only join a job that is in progress/);
    const available = await newJob();
    await expect(call(emp[1], "join_job", available)).rejects.toThrow(/Claim it instead/);
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await expect(call(emp[0], "join_job", job)).rejects.toThrow(/already on this job/);
    await call(emp[1], "join_job", job);
    await expect(call(emp[1], "join_job", job)).rejects.toThrow(/already on this job/);
    expect(await team(job)).toHaveLength(2);
  });

  it("blocks duplicate active assignments even through direct database writes", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await call(emp[1], "join_job", job);
    await expect(
      rows(
        `insert into public.job_assignments (job_id, employee_id, role, method, assigned_by)
         values ($1, $2, 'member', 'joined', $2)`,
        [job, emp[1]],
      ),
    ).rejects.toThrow(/job_assignments_one_active_per_employee/);
  });
});

describe("owner team management", () => {
  it("adds employees whatever the join setting", async () => {
    const job = await newJob({ allowJoin: false });
    await call(emp[0], "claim_job", job);
    await call(owner, "add_team_member", job, emp[1]);
    const [added] = await rows<Record<string, unknown>>(
      `select role, method, assigned_by from public.job_assignments where job_id = $1 and employee_id = $2`,
      [job, emp[1]],
    );
    expect(added).toEqual({ role: "member", method: "added_by_owner", assigned_by: owner });
  });

  it("makes the first employee added to an Available job its lead", async () => {
    const job = await newJob();
    await call(owner, "add_team_member", job, emp[3]);
    expect(await status(job)).toBe("claimed");
    expect(await team(job)).toEqual([{ employee_id: emp[3], role: "lead" }]);
  });

  it("refuses Scheduled jobs, duplicates, owners, and deactivated employees", async () => {
    const scheduled = await newJob({ available: false });
    await expect(call(owner, "add_team_member", scheduled, emp[1])).rejects.toThrow(/Make the job available/);

    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await expect(call(owner, "add_team_member", job, emp[0])).rejects.toThrow(/already on this job/);
    await expect(call(owner, "add_team_member", job, owner)).rejects.toThrow(/active employee/);

    const former = await createUser(db, { role: "employee", active: false });
    await expect(call(owner, "add_team_member", job, former)).rejects.toThrow(/active employee/);
  });

  it("removes a member but keeps their assignment history", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await call(emp[1], "join_job", job);
    await call(owner, "remove_team_member", job, emp[1], null);

    expect(await team(job)).toEqual([{ employee_id: emp[0], role: "lead" }]);
    const [ended] = await rows<Record<string, unknown>>(
      `select role, ended_by, end_reason, ended_at from public.job_assignments where job_id = $1 and employee_id = $2`,
      [job, emp[1]],
    );
    expect(ended).toMatchObject({ role: "member", ended_by: owner, end_reason: "removed_by_owner" });
    expect(ended.ended_at).toBeInstanceOf(Date);

    // They can rejoin later with a new assignment; the old one stays.
    await call(emp[1], "join_job", job);
    expect(
      await rows(`select count(*)::int as n from public.job_assignments where job_id = $1 and employee_id = $2`, [
        job,
        emp[1],
      ]),
    ).toEqual([{ n: 2 }]);
  });

  it("never deletes or reopens assignment rows", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await expect(rows(`delete from public.job_assignments where job_id = $1`, [job])).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      rows(`update public.job_assignments set role = 'member' where job_id = $1`, [job]),
    ).rejects.toThrow(/can only be ended/);
  });
});

describe("lead replacement", () => {
  it("requires a new lead before removing a lead who has teammates", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await call(emp[1], "join_job", job);
    await expect(call(owner, "remove_team_member", job, emp[0], null)).rejects.toThrow(
      /Choose a new lead before removing/,
    );
    expect(await team(job)).toHaveLength(2);
  });

  it("replaces the lead atomically when removing them, keeping history", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await call(emp[1], "join_job", job);
    await call(emp[2], "join_job", job);
    await call(owner, "remove_team_member", job, emp[0], emp[1]);

    const current = await team(job);
    expect(current.find((a) => a.role === "lead")?.employee_id).toBe(emp[1]);
    expect(current.map((a) => a.employee_id).sort()).toEqual([emp[1], emp[2]].sort());

    expect(
      await rows(
        `select employee_id, role, method, end_reason from public.job_assignments
         where job_id = $1 and employee_id in ($2, $3) order by assigned_at, role`,
        [job, emp[0], emp[1]],
      ),
    ).toEqual([
      { employee_id: emp[0], role: "lead", method: "claimed", end_reason: "removed_by_owner" },
      { employee_id: emp[1], role: "member", method: "joined", end_reason: "role_changed" },
      { employee_id: emp[1], role: "lead", method: "lead_change", end_reason: null },
    ]);
    expect(
      (
        await rows<{ activity_type: string }>(
          `select activity_type from public.job_activity where job_id = $1 and actor_id = $2 order by id`,
          [job, owner],
        )
      ).map((r) => r.activity_type),
    ).toEqual(["job_created", "made_available", "employee_removed", "lead_changed"]);
  });

  it("changes the lead and keeps the old lead as a member", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await call(emp[1], "join_job", job);
    await call(owner, "change_lead", job, emp[1]);
    const current = await team(job);
    expect(current.find((a) => a.role === "lead")?.employee_id).toBe(emp[1]);
    expect(current.find((a) => a.employee_id === emp[0])?.role).toBe("member");
    await expect(call(owner, "change_lead", job, emp[1])).rejects.toThrow(/already the lead/);
  });

  it("can make an employee who is not on the team the new lead", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await call(owner, "change_lead", job, emp[4]);
    expect(await team(job)).toEqual(
      [
        { employee_id: emp[0], role: "member" },
        { employee_id: emp[4], role: "lead" },
      ].sort((a, b) => (a.role + a.employee_id < b.role + b.employee_id ? -1 : 1)),
    );
  });

  it("allows removing a lead who is alone, leaving no team, and never promotes anyone", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await call(owner, "remove_team_member", job, emp[0], null);
    expect(await team(job)).toEqual([]);
    expect(await status(job)).toBe("claimed");
    // Nobody can join a job with no lead; the owner must add someone.
    await expect(call(emp[1], "join_job", job)).rejects.toThrow(/no lead right now/);
    await call(owner, "add_team_member", job, emp[1]);
    expect(await team(job)).toEqual([{ employee_id: emp[1], role: "lead" }]);
  });

  it("does not allow naming a new lead when removing a member", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await call(emp[1], "join_job", job);
    await expect(call(owner, "remove_team_member", job, emp[1], emp[2])).rejects.toThrow(
      /only chosen when removing the current lead/,
    );
  });
});

describe("deactivated employees", () => {
  it("cannot claim or join, and deactivation keeps their assignment history", async () => {
    const worker = await createUser(db, { role: "employee" });
    const job = await newJob();
    await call(worker, "claim_job", job);
    await db.query(`update public.profiles set active = false where id = $1`, [worker]);

    const other = await newJob();
    await expect(call(worker, "claim_job", other)).rejects.toThrow(/Only an active employee/);
    await expect(call(worker, "join_job", job)).rejects.toThrow(/Only an active employee/);
    expect(await team(job)).toEqual([{ employee_id: worker, role: "lead" }]);
    expect(await team(other)).toEqual([]);
  });
});

describe("permissions", () => {
  it("does not let employees manage teams or the join setting", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await expect(call(emp[0], "add_team_member", job, emp[1])).rejects.toThrow(/Only an active owner/);
    await expect(call(emp[0], "remove_team_member", job, emp[0], null)).rejects.toThrow(/Only an active owner/);
    await expect(call(emp[0], "change_lead", job, emp[1])).rejects.toThrow(/Only an active owner/);
    await expect(call(emp[0], "set_job_join_setting", job, false)).rejects.toThrow(/Only an active owner/);
  });

  it("does not let owners claim or join as themselves", async () => {
    const job = await newJob();
    await expect(call(owner, "claim_job", job)).rejects.toThrow(/Only an active employee/);
  });

  it("blocks direct writes to assignments for everyone signed in", async () => {
    const job = await newJob();
    for (const userId of [emp[0], owner]) {
      await expect(
        as(db, { userId }, () =>
          rows(
            `insert into public.job_assignments (job_id, employee_id, role, method, assigned_by)
             values ($1, $2, 'lead', 'claimed', $2)`,
            [job, userId],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("does not let internal helper functions be called directly", async () => {
    const job = await newJob();
    await expect(
      call(emp[0], "start_job_assignment", job, emp[0], "lead", "claimed", emp[0]),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses returning a job to Scheduled while anyone is assigned", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await expect(call(owner, "return_job_to_scheduled", job)).rejects.toThrow(/Only jobs that are Available/);
  });
});

describe("team visibility", () => {
  it("shows the current team with names to any active user, including unassigned employees", async () => {
    const job = await newJob();
    await call(emp[0], "claim_job", job);
    await call(emp[1], "join_job", job);
    const seen = await as(db, { userId: emp[9] }, () =>
      rows<{ employee_id: string; role: string; full_name: string }>(
        `select employee_id, role, full_name from public.job_team where job_id = $1 order by role`,
        [job],
      ),
    );
    expect(seen).toEqual([
      { employee_id: emp[0], role: "lead", full_name: "Test User" },
      { employee_id: emp[1], role: "member", full_name: "Test User" },
    ]);
    // Unassigned employees still read the job itself, but cannot write.
    const jobs = await as(db, { userId: emp[9] }, () =>
      rows(`select id from public.jobs where id = $1`, [job]),
    );
    expect(jobs).toHaveLength(1);
    await expect(
      as(db, { userId: emp[9] }, () => rows(`update public.jobs set client_name = 'X' where id = $1`, [job])),
    ).rejects.toThrow(/permission denied/);
  });

  it("hides teams from deactivated users and visitors", async () => {
    const former = await createUser(db, { role: "employee", active: false });
    expect(await as(db, { userId: former }, () => rows(`select * from public.job_team`))).toEqual([]);
    expect(await as(db, { userId: former }, () => rows(`select * from public.job_assignments`))).toEqual([]);
    await expect(as(db, "anon", () => rows(`select * from public.job_team`))).rejects.toThrow(/permission denied/);
  });

  it("does not expose emails or other profile details through the team view", async () => {
    const columns = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'job_team' order by ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      "job_id",
      "employee_id",
      "role",
      "method",
      "assigned_at",
      "full_name",
      "employee_active",
    ]);
  });
});
