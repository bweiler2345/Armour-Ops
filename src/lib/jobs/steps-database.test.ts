import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser } from "@/test/database";
import { APPROVED_WORKFLOW } from "@/lib/workflow/approved-workflow";

// Runs every migration in an in-process Postgres and checks step work: open
// steps, edit holds, answers, completion, history, and access. Earlier
// steps that need pictures or videos are marked complete directly in this
// test database (Phase 6 adds uploads); the app itself has no such bypass.

let db: PGlite;
let owner: string;
let a: string; // lead
let b: string; // member
let outsider: string; // not on the team

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

const call = (userId: string, fn: string, ...args: unknown[]) =>
  as(db, { userId }, () =>
    rows<Record<string, unknown>>(
      `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as result`,
      args,
    ),
  );

// Leases handed out by acquire_step_edit, by employee and step. A missing
// lease is sent as a random id, which the database always rejects.
const leases = new Map<string, string>();
const NO_LEASE = "00000000-0000-4000-8000-000000000000";
const lease = (userId: string, stepId: string) => leases.get(`${userId}:${stepId}`) ?? NO_LEASE;

async function hold(userId: string, stepId: string) {
  const [row] = await as(db, { userId }, () =>
    rows<{ lease_id: string; expires_at: Date }>(
      `select lease_id, expires_at from public.acquire_step_edit($1)`,
      [stepId],
    ),
  );
  leases.set(`${userId}:${stepId}`, row.lease_id);
  return row.lease_id;
}

// A claimed job with A as lead and B as member.
async function teamJob() {
  const [{ id }] = await as(db, { userId: owner }, () =>
    rows<{ id: string }>(
      `select public.create_job('Sample Client', '1 Sample Road', 500, 'Sample', '2026-10-20') as id`,
    ),
  );
  await call(owner, "make_job_available", id);
  await call(a, "claim_job", id);
  await call(b, "join_job", id);
  return id;
}

async function steps(jobId: string) {
  return rows<{ id: string; key: string; title: string; stage: string; kind: string }>(
    `select s.id, s.key, s.title, st.key as stage, s.kind
     from public.job_steps s join public.job_stages st on st.id = s.job_stage_id
     where s.job_id = $1 order by st.position, s.position`,
    [jobId],
  );
}

async function step(jobId: string, stage: string, key: string) {
  const found = (await steps(jobId)).find((s) => s.stage === stage && s.key === key);
  if (!found) throw new Error(`No step ${stage}/${key}`);
  return found.id;
}

async function state(stepId: string) {
  const [{ s }] = await rows<{ s: string }>(`select public.job_step_state($1) as s`, [stepId]);
  return s;
}

async function status(jobId: string) {
  const [{ s }] = await rows<{ s: string }>(`select status as s from public.jobs where id = $1`, [jobId]);
  return s;
}

// Test-database fixture: mark a step complete without its media.
async function forceComplete(stepId: string, userId = a) {
  await rows(
    `insert into public.step_attempts
       (job_id, job_step_id, attempt_number, status, started_by, completed_by, completed_at, confirmation_text_shown)
     select job_id, id, 1, 'completed', $2, $2, now(), confirmation_text from public.job_steps where id = $1`,
    [stepId, userId],
  );
}

async function checkAll(stepId: string, userId = a) {
  const items = await rows<{ id: string }>(
    `select i.id from public.job_step_block_items i join public.job_step_blocks b on b.id = i.job_block_id
     where b.job_step_id = $1 and b.kind = 'checklist' order by b.position, i.position`,
    [stepId],
  );
  for (const item of items) await call(userId, "save_step_check", stepId, lease(userId, stepId), item.id, true);
  return items.map((i) => i.id);
}

describe("steps come from the job's snapshot", () => {
  it("lists every stage and step in the approved order, with states", async () => {
    const job = await teamJob();
    const status = await as(db, { userId: owner }, () => rows<{ title: string; state: string }>(
      `select s.title, v.state from public.job_step_status v
       join public.job_steps s on s.id = v.job_step_id
       join public.job_stages st on st.id = s.job_stage_id
       where v.job_id = $1 order by st.position, s.position`,
      [job],
    ));
    expect(status.map((s) => s.title)).toEqual(
      APPROVED_WORKFLOW.stages.flatMap((stage) => stage.steps.map((s) => s.title)),
    );
    expect(status[0].state).toBe("available");
    // Baseboard is off by default, so its Completion Work item doesn't apply.
    expect(status.at(-1)).toEqual({ title: "Baseboard Complete", state: "not_applicable" });
    expect(status.slice(1, -1).every((s) => s.state === "locked")).toBe(true);
  });

  it("keeps every step locked until the job is claimed", async () => {
    const [{ id }] = await as(db, { userId: owner }, () =>
      rows<{ id: string }>(
        `select public.create_job('Sample Client', '1 Sample Road', 500, 'Sample', '2026-10-20') as id`,
      ),
    );
    expect(await state(await step(id, "initial_prep", "grind_floor"))).toBe("locked");
  });
});

describe("who can work steps", () => {
  it("refuses unassigned employees, owners, and deactivated team members", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    await expect(hold(outsider, first)).rejects.toThrow(/Only employees on this job/);
    await expect(hold(owner, first)).rejects.toThrow(/Join the job as a Working Owner/);

    const former = await createUser(db, { role: "employee" });
    await call(owner, "add_team_member", job, former);
    await db.query(`update public.profiles set active = false where id = $1`, [former]);
    await expect(hold(former, first)).rejects.toThrow(/Only an active employee/);
  });

  it("requires holding the edit to save", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    const [item] = await checkAllIds(first);
    await expect(call(a, "save_step_check", first, lease(a, first), item, true)).rejects.toThrow(/editing time on this step ran out/);
  });

  it("blocks direct writes to attempts, answers, and holds", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    for (const userId of [a, owner]) {
      await expect(
        as(db, { userId }, () =>
          rows(
            `insert into public.step_attempts (job_id, job_step_id, attempt_number, started_by)
             values ($1, $2, 1, $3)`,
            [job, first, userId],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        as(db, { userId }, () =>
          rows(`insert into public.step_edit_holds (job_step_id, job_id, held_by, expires_at)
                values ($1, $2, $3, now() + interval '1 hour')`, [first, job, userId]),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("lets unassigned employees read step status, answers, and holds", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    await hold(a, first);
    await checkAll(first);
    const seen = await as(db, { userId: outsider }, () =>
      rows<{ state: string; hold_held_by: string }>(
        `select state, hold_held_by from public.job_step_status where job_step_id = $1`,
        [first],
      ),
    );
    expect(seen).toEqual([{ state: "in_progress", hold_held_by: a }]);
    const answers = await as(db, { userId: outsider }, () =>
      rows(`select checked from public.step_check_responses where job_step_id = $1`, [first]),
    );
    expect(answers.length).toBeGreaterThan(0);
  });
});

async function checkAllIds(stepId: string) {
  return (
    await rows<{ id: string }>(
      `select i.id from public.job_step_block_items i join public.job_step_blocks b on b.id = i.job_block_id
       where b.job_step_id = $1 and b.kind = 'checklist' order by i.position`,
      [stepId],
    )
  ).map((r) => r.id);
}

describe("edit holds", () => {
  it("lets one employee edit at a time, and shows who holds it", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    await hold(a, first);
    await expect(hold(b, first)).rejects.toThrow(/Someone else is editing/);
    // Any active user, including a teammate, sees who holds the step.
    const [shown] = await as(db, { userId: b }, () =>
      rows<{ hold_held_by: string; hold_expires_at: Date }>(
        `select hold_held_by, hold_expires_at from public.job_step_status where job_step_id = $1`,
        [first],
      ),
    );
    expect(shown.hold_held_by).toBe(a);
    expect(shown.hold_expires_at).toBeInstanceOf(Date);
  });

  it("renews the same lease without changing it or when it started", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    const id = await hold(a, first);
    await db.query(
      `update public.step_edit_holds set acquired_at = now() - interval '1 minute',
         expires_at = now() + interval '5 seconds' where job_step_id = $1`,
      [first],
    );
    const [before] = await rows<{ acquired_at: Date }>(
      `select acquired_at from public.step_edit_holds where job_step_id = $1`,
      [first],
    );
    await call(a, "renew_step_edit", first, id);
    const [after] = await rows<{ acquired_at: Date; lease_id: string; long_enough: boolean }>(
      `select acquired_at, lease_id, expires_at - now() > interval '1 minute' as long_enough
       from public.step_edit_holds where job_step_id = $1`,
      [first],
    );
    expect(after.lease_id).toBe(id);
    expect(after.acquired_at).toEqual(before.acquired_at);
    expect(after.long_enough).toBe(true);
  });

  it("lets another employee take over after the hold expires", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    await hold(a, first);
    await db.query(`update public.step_edit_holds set acquired_at = now() - interval '5 minutes',
                    expires_at = now() - interval '1 second' where job_step_id = $1`, [first]);
    await hold(b, first);
    const [{ held_by }] = await rows<{ held_by: string }>(
      `select held_by from public.step_edit_holds where job_step_id = $1`,
      [first],
    );
    expect(held_by).toBe(b);
    // A's saves now fail clearly.
    const [item] = await checkAllIds(first);
    await expect(call(a, "save_step_check", first, lease(a, first), item, true)).rejects.toThrow(/Someone else is editing/);
  });

  it("ignores a hold whose holder left the team", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    await hold(b, first);
    await call(owner, "remove_team_member", job, b, null);
    await hold(a, first);
  });

  it("lets the holder release it and the owner clear it, recording the clear", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    await hold(a, first);
    await call(a, "release_step_edit", first, lease(a, first));
    await hold(b, first);

    await expect(call(a, "clear_step_edit", first)).rejects.toThrow(/Only an active owner/);
    await call(owner, "clear_step_edit", first);
    await hold(a, first);

    const [cleared] = await rows<{ actor_id: string; details: Record<string, unknown> }>(
      `select actor_id, details from public.job_activity where job_id = $1 and activity_type = 'step_hold_cleared'`,
      [job],
    );
    expect(cleared.actor_id).toBe(owner);
    expect(cleared.details.employee_id).toBe(b);
  });

  it("gives the hold to exactly one of several simultaneous requests", async () => {
    const job = await teamJob();
    const extra = [];
    for (let i = 0; i < 4; i++) {
      const e = await createUser(db, { role: "employee" });
      await call(owner, "add_team_member", job, e);
      extra.push(e);
    }
    const first = await step(job, "initial_prep", "grind_floor");
    const results = await Promise.all(
      [a, b, ...extra].map((employee) =>
        db
          .query(`select set_config('request.jwt.claim.sub', $1, false), public.acquire_step_edit($2)`, [
            employee,
            first,
          ])
          .then(
            () => "won",
            (error: Error) => error.message,
          ),
      ),
    );
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    expect(results.filter((r) => r === "won")).toHaveLength(1);
    expect(results.filter((r) => /Someone else is editing/.test(r))).toHaveLength(5);
  });
});

describe("answers and completion", () => {
  it("only allows Final check items as checkboxes, never reference lists", async () => {
    const job = await teamJob();
    const ids = await steps(job);
    for (const s of ids.filter((x) => x.stage === "initial_prep" && x.key !== "set_up_for_base_coat_installation")) {
      await forceComplete(s.id);
    }
    const setup = await step(job, "initial_prep", "set_up_for_base_coat_installation");
    await hold(a, setup);
    const [reference] = await rows<{ id: string }>(
      `select i.id from public.job_step_block_items i join public.job_step_blocks b on b.id = i.job_block_id
       where b.job_step_id = $1 and b.kind = 'reference_list' limit 1`,
      [setup],
    );
    await expect(call(a, "save_step_check", setup, lease(a, setup), reference.id, true)).rejects.toThrow(
      /isn't a check on this step/,
    );
  });

  it("keeps steps locked until the earlier steps are complete", async () => {
    const job = await teamJob();
    const second = await step(job, "initial_prep", "vacuum_floor");
    expect(await state(second)).toBe("locked");
    await expect(hold(a, second)).rejects.toThrow(/isn't open yet/);
    await forceComplete(await step(job, "initial_prep", "grind_floor"));
    expect(await state(second)).toBe("available");
  });

  it("blocks steps that need pictures or videos until verified proof is uploaded", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    await hold(a, first);
    await checkAll(first);
    await expect(call(a, "complete_step", first, lease(a, first), true)).rejects.toThrow(/Add the required proof first/);
    expect(await state(first)).toBe("in_progress");
    expect(
      await rows(`select count(*)::int as n from public.step_attempts where job_step_id = $1 and status = 'completed'`, [first]),
    ).toEqual([{ n: 0 }]);
  });

  it("moves the job to Initial Prep in Progress on the first saved answer", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    await hold(a, first);
    expect(await status(job)).toBe("claimed");
    const [item] = await checkAllIds(first);
    await call(a, "save_step_check", first, lease(a, first), item, true);
    expect(await status(job)).toBe("initial_prep_in_progress");
    const [changed] = await rows(
      `select actor_id, details from public.job_activity where job_id = $1 and activity_type = 'status_changed'`,
      [job],
    );
    expect(changed).toEqual({
      actor_id: a,
      details: { from: "claimed", to: "initial_prep_in_progress" },
    });
  });

  it("completes a no-proof step atomically with attribution and database time", async () => {
    const job = await teamJob();
    for (const key of ["grind_floor", "vacuum_floor", "patchwork", "cut_garage_door_lines", "hand_grind", "clean_joints"]) {
      await forceComplete(await step(job, "initial_prep", key));
    }
    const edges = await step(job, "initial_prep", "clean_edges_and_corners");
    await hold(b, edges);
    const ids = await checkAll(edges, b);

    // All checks are required.
    await call(b, "save_step_check", edges, lease(b, edges), ids[0], false);
    await expect(call(b, "complete_step", edges, lease(b, edges), true)).rejects.toThrow(/Missing: Every edge and corner has been inspected/);
    await call(b, "save_step_check", edges, lease(b, edges), ids[0], true);

    // The confirmation is required.
    await expect(call(b, "complete_step", edges, lease(b, edges), false)).rejects.toThrow(/Confirm the statement/);

    await call(b, "save_step_notes", edges, lease(b, edges), "  Corner by the door needed extra scraping.  ");
    await call(b, "complete_step", edges, lease(b, edges), true);

    const [attempt] = await rows<Record<string, unknown>>(
      `select status, started_by, completed_by, completed_at, confirmation_text_shown, employee_notes
       from public.step_attempts where job_step_id = $1`,
      [edges],
    );
    expect(attempt).toMatchObject({
      status: "completed",
      started_by: b,
      completed_by: b,
      confirmation_text_shown:
        "I confirm all edges and corners have been cleaned and are ready for the final vacuum.",
      employee_notes: "Corner by the door needed extra scraping.",
    });
    expect(attempt.completed_at).toBeInstanceOf(Date);

    const answers = await rows<{ checked: boolean; updated_by: string; item_text_shown: string }>(
      `select checked, updated_by, item_text_shown from public.step_check_responses where job_step_id = $1`,
      [edges],
    );
    expect(answers.every((r) => r.checked && r.updated_by === b)).toBe(true);
    expect(answers.map((r) => r.item_text_shown)).toContain("Debris has been pulled out for vacuuming.");

    // Hold released, next step open, history written.
    expect(await rows(`select * from public.step_edit_holds where job_step_id = $1`, [edges])).toEqual([]);
    expect(await state(await step(job, "initial_prep", "final_vacuum"))).toBe("available");
    const [done] = await rows(
      `select actor_id, details from public.job_activity where job_id = $1 and activity_type = 'step_completed'`,
      [job],
    );
    expect(done).toEqual({
      actor_id: b,
      details: { step_id: edges, title: "Clean Edges and Corners" },
    });
  });

  it("never changes completed attempts or answers", async () => {
    const job = await teamJob();
    for (const key of ["grind_floor", "vacuum_floor", "patchwork", "cut_garage_door_lines", "hand_grind", "clean_joints"]) {
      await forceComplete(await step(job, "initial_prep", key));
    }
    const edges = await step(job, "initial_prep", "clean_edges_and_corners");
    await hold(a, edges);
    const ids = await checkAll(edges);
    await call(a, "complete_step", edges, lease(a, edges), true);

    await expect(hold(a, edges)).rejects.toThrow(/already complete/);
    await expect(call(a, "save_step_check", edges, lease(a, edges), ids[0], false)).rejects.toThrow(/already complete/);
    await expect(
      rows(`update public.step_check_responses set checked = false where job_step_id = $1`, [edges]),
    ).rejects.toThrow(/cannot be changed/);
    await expect(rows(`delete from public.step_check_responses where job_step_id = $1`, [edges])).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      rows(`update public.step_attempts set employee_notes = 'x' where job_step_id = $1`, [edges]),
    ).rejects.toThrow(/cannot be changed/);
    await expect(rows(`delete from public.step_attempts where job_step_id = $1`, [edges])).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it("keeps optional checks optional", async () => {
    const job = await teamJob();
    for (const key of ["grind_floor", "vacuum_floor", "patchwork", "cut_garage_door_lines", "hand_grind", "clean_joints"]) {
      await forceComplete(await step(job, "initial_prep", key));
    }
    const edges = await step(job, "initial_prep", "clean_edges_and_corners");
    // Test fixture: add an optional Final check item to this job's snapshot.
    await rows(
      `insert into public.job_step_block_items (job_id, job_block_id, block_kind, position, text, required)
       select b.job_id, b.id, 'checklist', 99, 'Optional sample check.', false
       from public.job_step_blocks b where b.job_step_id = $1 and b.kind = 'checklist'`,
      [edges],
    );
    await hold(a, edges);
    const required = await rows<{ id: string }>(
      `select i.id from public.job_step_block_items i join public.job_step_blocks b on b.id = i.job_block_id
       where b.job_step_id = $1 and b.kind = 'checklist' and i.required`,
      [edges],
    );
    for (const item of required) await call(a, "save_step_check", edges, lease(a, edges), item.id, true);
    await call(a, "complete_step", edges, lease(a, edges), true);
    expect(await state(edges)).toBe("completed");
  });
});

describe("Collect Excess Flake", () => {
  async function flakeJob() {
    const job = await teamJob();
    for (const s of (await steps(job)).filter((x) => x.stage === "initial_prep")) await forceComplete(s.id);
    // Test fixture: the owner's Base Coat Installed milestone arrives in Phase 7.
    await db.query(`update public.jobs set status = 'initial_prep_in_progress' where id = $1`, [job]);
    await db.query(`update public.jobs set status = 'waiting_for_base_coat_installation' where id = $1`, [job]);
    await db.query(`update public.jobs set status = 'base_coat_installed' where id = $1`, [job]);
    return { job, flake: await step(job, "top_coat_prep", "collect_excess_flake") };
  }

  async function inputs(stepId: string) {
    return rows<{ id: string; label: string }>(
      `select id, label from public.job_step_inputs where job_step_id = $1 order by position`,
      [stepId],
    );
  }

  it("validates Full boxes recovered as a whole number of 0 or more", async () => {
    const { flake } = await flakeJob();
    const [boxes] = await inputs(flake);
    await hold(a, flake);
    await expect(call(a, "save_step_input", flake, lease(a, flake), boxes.id, "-1")).rejects.toThrow(/0 or more/);
    await expect(call(a, "save_step_input", flake, lease(a, flake), boxes.id, "2.5")).rejects.toThrow(/whole number/);
    await expect(call(a, "save_step_input", flake, lease(a, flake), boxes.id, "two")).rejects.toThrow(/Enter a number/);
    await call(a, "save_step_input", flake, lease(a, flake), boxes.id, "0");
    await call(a, "save_step_input", flake, lease(a, flake), boxes.id, " 3 ");
    expect(
      await rows(`select value_number::int as n from public.step_input_responses where job_step_input_id = $1`, [
        boxes.id,
      ]),
    ).toEqual([{ n: 3 }]);
  });

  it("accepts only the approved Additional flake choices", async () => {
    const { flake } = await flakeJob();
    const [, extra] = await inputs(flake);
    await hold(a, flake);
    await expect(call(a, "save_step_input", flake, lease(a, flake), extra.id, "1/4 box")).rejects.toThrow(/listed options/);
    await expect(call(a, "save_step_input", flake, lease(a, flake), extra.id, "Full box")).rejects.toThrow(/listed options/);
    for (const choice of ["None", "¼ box", "½ box", "¾ box"]) {
      await call(a, "save_step_input", flake, lease(a, flake), extra.id, choice);
    }
  });

  it("requires both entries and every check, then moves to Top-Coat Prep in Progress", async () => {
    const { job, flake } = await flakeJob();
    const [boxes, extra] = await inputs(flake);
    await hold(a, flake);
    await checkAll(flake);
    expect(await status(job)).toBe("top_coat_prep_in_progress");

    await expect(call(a, "complete_step", flake, lease(a, flake), true)).rejects.toThrow(/Missing: Full boxes recovered/);
    await call(a, "save_step_input", flake, lease(a, flake), boxes.id, "2");
    await expect(call(a, "complete_step", flake, lease(a, flake), true)).rejects.toThrow(/Missing: Additional flake/);
    await call(a, "save_step_input", flake, lease(a, flake), extra.id, "½ box");
    // Blank clears an answer.
    await call(a, "save_step_input", flake, lease(a, flake), extra.id, "   ");
    await expect(call(a, "complete_step", flake, lease(a, flake), true)).rejects.toThrow(/Missing: Additional flake/);
    await call(a, "save_step_input", flake, lease(a, flake), extra.id, "½ box");
    await call(a, "complete_step", flake, lease(a, flake), true);

    expect(
      await rows(
        `select label_shown, value_number::int as number, value_choice from public.step_input_responses
         where job_step_id = $1 order by label_shown desc`,
        [flake],
      ),
    ).toEqual([
      { label_shown: "Full boxes recovered", number: 2, value_choice: null },
      { label_shown: "Additional flake", number: null, value_choice: "½ box" },
    ]);
    expect(await state(await step(job, "top_coat_prep", "scrape_floor"))).toBe("available");
  });

  it("keeps Top-Coat Prep locked while the job waits for the owner", async () => {
    const job = await teamJob();
    for (const s of (await steps(job)).filter((x) => x.stage === "initial_prep")) await forceComplete(s.id);
    await db.query(`update public.jobs set status = 'initial_prep_in_progress' where id = $1`, [job]);
    await db.query(`update public.jobs set status = 'waiting_for_base_coat_installation' where id = $1`, [job]);
    const flake = await step(job, "top_coat_prep", "collect_excess_flake");
    expect(await state(flake)).toBe("locked");
    await expect(hold(a, flake)).rejects.toThrow(/isn't open yet/);
    const [progress] = await rows(
      `select current_stage_name, current_step_title from public.job_progress where job_id = $1`,
      [job],
    );
    expect(progress).toEqual({
      current_stage_name: "Base-Coat Installation",
      current_step_title: "Waiting for Base-Coat Installation",
    });
  });
});

describe("two open screens stay in step", () => {
  // What an open step screen loads (the same reads as getStepLive), as the
  // given employee.
  async function screen(userId: string, stepId: string) {
    return as(db, { userId }, async () => {
      const [status] = await rows<{ state: string; attempt_id: string | null; hold_held_by: string | null }>(
        `select state, attempt_id, hold_held_by from public.job_step_status where job_step_id = $1`,
        [stepId],
      );
      const checked = status.attempt_id
        ? (
            await rows<{ job_block_item_id: string }>(
              `select job_block_item_id from public.step_check_responses where attempt_id = $1 and checked`,
              [status.attempt_id],
            )
          ).map((r) => r.job_block_item_id)
        : [];
      return { state: status.state, holder: status.hold_held_by, checked: checked.sort() };
    });
  }

  it("shows B's save on A's screen, and A reacquires with all saved answers", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    const items = await checkAllIds(first);

    // A opens the step and saves two checks.
    await hold(a, first);
    await call(a, "save_step_check", first, lease(a, first), items[0], true);
    await call(a, "save_step_check", first, lease(a, first), items[1], true);
    expect((await screen(a, first)).checked).toEqual([items[0], items[1]].sort());

    // A's hold runs out while A's screen stays open; B takes over and saves
    // the third check.
    await db.query(
      `update public.step_edit_holds set acquired_at = now() - interval '5 minutes',
         expires_at = now() - interval '1 second' where job_step_id = $1`,
      [first],
    );
    await hold(b, first);
    await call(b, "save_step_check", first, lease(b, first), items[2], true);

    // A's next load sees all three and that B holds the step.
    const aSees = await screen(a, first);
    expect(aSees.checked).toEqual([items[0], items[1], items[2]].sort());
    expect(aSees.holder).toBe(b);

    // A can't save over B while B holds it.
    await expect(call(a, "save_step_check", first, lease(a, first), items[2], false)).rejects.toThrow(/Someone else is editing/);

    // B leaves; A reacquires and loads the current answers, including B's.
    await call(b, "release_step_edit", first, lease(b, first));
    await hold(a, first);
    const afterReacquire = await screen(a, first);
    expect(afterReacquire.holder).toBe(a);
    expect(afterReacquire.checked).toEqual([items[0], items[1], items[2]].sort());

    // B's check is attributed to B.
    const [third] = await rows<{ updated_by: string }>(
      `select updated_by from public.step_check_responses where job_step_id = $1 and job_block_item_id = $2`,
      [first, items[2]],
    );
    expect(third.updated_by).toBe(b);
  });

  it("shows an unassigned viewer the latest saves too", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    const items = await checkAllIds(first);
    expect((await screen(outsider, first)).checked).toEqual([]);
    await hold(a, first);
    await call(a, "save_step_check", first, lease(a, first), items[0], true);
    expect((await screen(outsider, first)).checked).toEqual([items[0]]);
  });
});

describe("owner-cleared leases", () => {
  it("rejects the old lease for saves, renewals, and completion, and lets people edit again", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    const items = await checkAllIds(first);

    // 1. A holds the step and saves; the owner clears the hold.
    const oldLease = await hold(a, first);
    await call(a, "save_step_check", first, oldLease, items[0], true);
    await call(owner, "clear_step_edit", first);
    const [cleared] = await rows<{ actor_id: string; details: Record<string, unknown> }>(
      `select actor_id, details from public.job_activity
       where job_id = $1 and activity_type = 'step_hold_cleared'`,
      [job],
    );
    expect(cleared.actor_id).toBe(owner);
    expect(cleared.details).toMatchObject({ employee_id: a, lease_id: oldLease });

    // 2. A save from the old lease is rejected, and nothing is saved.
    await expect(call(a, "save_step_check", first, oldLease, items[1], true)).rejects.toThrow(
      /owner ended your editing session/,
    );
    expect(
      await rows(`select count(*)::int as n from public.step_check_responses where job_step_id = $1 and checked`, [
        first,
      ]),
    ).toEqual([{ n: 1 }]);

    // 3. A heartbeat from the old lease cannot renew or re-create the hold.
    await expect(call(a, "renew_step_edit", first, oldLease)).rejects.toThrow(
      /owner ended your editing session/,
    );
    expect(await rows(`select * from public.step_edit_holds where job_step_id = $1`, [first])).toEqual([]);

    // 8. Completion with the cleared lease is rejected.
    await expect(call(a, "complete_step", first, oldLease, true)).rejects.toThrow(
      /owner ended your editing session/,
    );
    await expect(call(a, "save_step_notes", first, oldLease, "note")).rejects.toThrow(
      /owner ended your editing session/,
    );

    // 5. Another employee can now take the step.
    const bLease = await hold(b, first);
    await call(b, "save_step_check", first, bLease, items[1], true);
    await expect(call(a, "save_step_check", first, oldLease, items[2], true)).rejects.toThrow(
      /owner ended your editing session/,
    );

    // 6. After B leaves, A can explicitly take a new lease.
    await call(b, "release_step_edit", first, bLease);
    const newLease = await hold(a, first);
    expect(newLease).not.toBe(oldLease);
    await call(a, "save_step_check", first, newLease, items[2], true);

    // 7. The old lease stays rejected even though A holds the step again.
    await expect(call(a, "save_step_check", first, oldLease, items[0], false)).rejects.toThrow(
      /owner ended your editing session/,
    );
    await expect(call(a, "renew_step_edit", first, oldLease)).rejects.toThrow(
      /owner ended your editing session/,
    );
    const [current] = await rows<{ lease_id: string }>(
      `select lease_id from public.step_edit_holds where job_step_id = $1`,
      [first],
    );
    expect(current.lease_id).toBe(newLease);
  });

  it("locks out an older screen when the same employee opens the step again", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    const [item] = await checkAllIds(first);
    const firstScreen = await hold(a, first);
    const secondScreen = await hold(a, first);
    await expect(call(a, "save_step_check", first, firstScreen, item, true)).rejects.toThrow(
      /opened for editing on another screen/,
    );
    await expect(call(a, "complete_step", first, firstScreen, true)).rejects.toThrow(
      /opened for editing on another screen/,
    );
    await call(a, "save_step_check", first, secondScreen, item, true);
  });

  it("rejects an expired lease, and renewal never brings it back", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    const [item] = await checkAllIds(first);
    const id = await hold(a, first);
    await db.query(
      `update public.step_edit_holds set acquired_at = now() - interval '5 minutes',
         expires_at = now() - interval '1 second' where job_step_id = $1`,
      [first],
    );
    await expect(call(a, "renew_step_edit", first, id)).rejects.toThrow(/editing time on this step ran out/);
    await expect(call(a, "save_step_check", first, id, item, true)).rejects.toThrow(/ran out/);
  });

  it("never shows lease ids to other signed-in users", async () => {
    const job = await teamJob();
    const first = await step(job, "initial_prep", "grind_floor");
    await hold(a, first);
    await expect(
      as(db, { userId: b }, () => rows(`select lease_id from public.step_edit_holds`)),
    ).rejects.toThrow(/permission denied/);
    const visible = await as(db, { userId: b }, () =>
      rows(`select held_by from public.step_edit_holds where job_step_id = $1`, [first]),
    );
    expect(visible).toEqual([{ held_by: a }]);
  });
});

describe("waiting statuses and owner milestones", () => {
  // A small published workflow with no media, so a whole run can be tested.
  async function noMediaJob() {
    const [{ id: template }] = await rows<{ id: string }>(
      `insert into public.workflow_templates (key, name, version, source, content_sha256)
       values ('armour-floors-standard', 'No-media test', 2, 'test', repeat('d', 64)) returning id`,
    );
    const stage = async (pos: number, key: string, kind: string) =>
      (
        await rows<{ id: string }>(
          kind === "owner_milestone"
            ? `insert into public.workflow_stage_templates
                 (template_id, position, key, name, kind, owner_action_label, waiting_status_label, completed_status_label)
               values ($1, $2, $3, $3, 'owner_milestone', 'Mark', 'Waiting', 'Done') returning id`
            : `insert into public.workflow_stage_templates (template_id, position, key, name, kind)
               values ($1, $2, $3, $3, 'employee_stage') returning id`,
          [template, pos, key],
        )
      )[0].id;
    for (const [pos, key, kind] of [
      [1, "initial_prep", "employee_stage"],
      [2, "base_coat_installation", "owner_milestone"],
      [3, "top_coat_prep", "employee_stage"],
      [4, "top_coat_installation", "owner_milestone"],
    ] as const) {
      const stageId = await stage(pos, key, kind);
      if (kind !== "employee_stage") continue;
      const [{ id: stepId }] = await rows<{ id: string }>(
        `insert into public.workflow_step_templates
           (stage_id, stage_kind, position, key, title, kind, goal, proof_type, proof_text, confirmation_text)
         values ($1, 'employee_stage', 1, 'only', 'Only Step', 'standard', 'Goal.', 'none', 'None.', 'Done.')
         returning id`,
        [stageId],
      );
      const [{ id: blockId }] = await rows<{ id: string }>(
        `insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
         values ($1, 'standard', 1, 'Final check', 'checklist') returning id`,
        [stepId],
      );
      await rows(
        `insert into public.workflow_step_block_items (block_id, block_kind, position, text, required)
         values ($1, 'checklist', 1, 'Checked.', true)`,
        [blockId],
      );
    }
    await as(db, "service_role", () => rows(`select public.activate_workflow_template($1)`, [template]));
    return teamJob();
  }

  it("stops at Waiting for Base-Coat Installation, then Waiting for Top-Coat Installation", async () => {
    const job = await noMediaJob();
    const first = await step(job, "initial_prep", "only");
    await hold(a, first);
    await checkAll(first);
    await call(a, "complete_step", first, lease(a, first), true);
    expect(await status(job)).toBe("waiting_for_base_coat_installation");

    // Employees cannot move past an owner milestone.
    const second = await step(job, "top_coat_prep", "only");
    await expect(hold(a, second)).rejects.toThrow(/isn't open yet/);
    await expect(
      as(db, { userId: a }, () => rows(`update public.jobs set status = 'base_coat_installed' where id = $1`, [job])),
    ).rejects.toThrow(/permission denied/);

    // Test fixture: the owner's Mark Base Coat Installed arrives in Phase 7.
    await db.query(`update public.jobs set status = 'base_coat_installed' where id = $1`, [job]);
    await hold(b, second);
    await checkAll(second, b);
    expect(await status(job)).toBe("top_coat_prep_in_progress");
    await call(b, "complete_step", second, lease(b, second), true);
    expect(await status(job)).toBe("waiting_for_top_coat_installation");

    const [progress] = await rows(`select total_units, completed_units from public.job_progress where job_id = $1`, [job]);
    // 2 steps + 2 milestones (this test workflow has no Completion Work);
    // both steps and the base-coat milestone are done.
    expect(progress).toEqual({ total_units: 4, completed_units: 3 });

    const statuses = await rows<{ details: { to: string } }>(
      `select details from public.job_activity where job_id = $1 and activity_type = 'status_changed' order by id`,
      [job],
    );
    expect(statuses.map((s) => s.details.to)).toEqual([
      "initial_prep_in_progress",
      "waiting_for_base_coat_installation",
      "top_coat_prep_in_progress",
      "waiting_for_top_coat_installation",
    ]);
  });
});

