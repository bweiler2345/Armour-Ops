import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser } from "@/test/database";
import { APPROVED_WORKFLOW } from "@/lib/workflow/approved-workflow";
import { assembleWorkflow } from "@/lib/workflow/assemble";
import { workflowContentHash } from "@/lib/workflow/seed-sql";

// Runs every migration in an in-process Postgres and checks job creation,
// the workflow snapshot, status rules, history protection, and access.
// All names and addresses are fictional.

const JOB_TABLES = [
  "jobs",
  "job_stages",
  "job_steps",
  "job_step_blocks",
  "job_step_block_items",
  "job_step_inputs",
  "job_step_proof_requirements",
  "job_activity",
];

let db: PGlite;
let ownerId: string;
let employeeId: string;
let inactiveId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  ownerId = await createUser(db, { role: "owner" });
  employeeId = await createUser(db, { role: "employee" });
  inactiveId = await createUser(db, { role: "employee", active: false });
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function rows<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function counts() {
  const [row] = await rows<Record<string, number>>(
    `select ${JOB_TABLES.map((t) => `(select count(*)::int from public.${t}) as ${t}`).join(", ")}`,
  );
  return row;
}

type JobInput = {
  client?: string;
  address?: string;
  squareFeet?: number;
  flake?: string;
  date?: string;
};

// Calls create_job as the owner with only the required arguments, so the
// function's own defaults apply.
async function createJob(input: JobInput = {}, userId = ownerId) {
  const [{ id }] = await as(db, { userId }, () =>
    rows<{ id: string }>(`select public.create_job($1, $2, $3, $4, $5::date) as id`, [
      input.client ?? "Sample Client",
      input.address ?? "100 Example Street, Sampletown",
      input.squareFeet ?? 640,
      input.flake ?? "Sample Blend",
      input.date ?? "2026-10-15",
    ]),
  );
  return id;
}

async function jobSnapshot(jobId: string) {
  const [job] = await rows<{
    workflow_template_id: string;
    workflow_key: string;
    workflow_version: number;
  }>(`select * from public.jobs where id = $1`, [jobId]);
  return assembleWorkflow({
    template: {
      id: jobId,
      key: job.workflow_key,
      name: APPROVED_WORKFLOW.name,
      version: job.workflow_version,
      source: APPROVED_WORKFLOW.source,
    },
    stages: (await rows<never>(`select *, job_id as template_id from public.job_stages where job_id = $1`, [jobId])),
    steps: await rows<never>(
      `select *, job_stage_id as stage_id from public.job_steps where job_id = $1`,
      [jobId],
    ),
    blocks: await rows<never>(
      `select *, job_step_id as step_id from public.job_step_blocks where job_id = $1`,
      [jobId],
    ),
    items: await rows<never>(
      `select *, job_block_id as block_id from public.job_step_block_items where job_id = $1`,
      [jobId],
    ),
    inputs: await rows<never>(
      `select *, job_step_id as step_id from public.job_step_inputs where job_id = $1`,
      [jobId],
    ),
    proofs: await rows<never>(
      `select *, job_step_id as step_id from public.job_step_proof_requirements where job_id = $1`,
      [jobId],
    ),
  });
}

describe("creating a job", () => {
  let jobId: string;

  beforeAll(async () => {
    jobId = await createJob();
  });

  it("starts Scheduled with the approved defaults", async () => {
    expect(
      await rows(
        `select status, caulking_required, baseboard_required, allow_employees_to_join,
                general_notes, made_available_at
         from public.jobs where id = $1`,
        [jobId],
      ),
    ).toEqual([
      {
        status: "scheduled",
        caulking_required: true,
        baseboard_required: false,
        allow_employees_to_join: true,
        general_notes: "",
        made_available_at: null,
      },
    ]);
  });

  it("uses database timestamps and records who created it", async () => {
    const [job] = await rows<{
      created_by: string;
      created_at: Date;
      last_activity_at: Date;
      job_number: number;
    }>(`select created_by, created_at, last_activity_at, job_number from public.jobs where id = $1`, [
      jobId,
    ]);
    expect(job.created_by).toBe(ownerId);
    expect(job.created_at).toBeInstanceOf(Date);
    expect(job.last_activity_at).toBeInstanceOf(Date);
    expect(job.job_number).toBeGreaterThanOrEqual(1001);
  });

  it("snapshots the complete active workflow into the job", async () => {
    expect(await jobSnapshot(jobId)).toEqual(APPROVED_WORKFLOW);
  });

  it("records the workflow version and content fingerprint", async () => {
    expect(
      await rows(
        `select workflow_key, workflow_version, workflow_content_sha256 from public.jobs where id = $1`,
        [jobId],
      ),
    ).toEqual([
      {
        workflow_key: "armour-floors-standard",
        workflow_version: 1,
        workflow_content_sha256: workflowContentHash(APPROVED_WORKFLOW),
      },
    ]);
  });

  it("writes a job_created history entry with the workflow version", async () => {
    expect(
      await rows(
        `select actor_id, activity_type, details from public.job_activity where job_id = $1`,
        [jobId],
      ),
    ).toEqual([
      {
        actor_id: ownerId,
        activity_type: "job_created",
        details: {
          workflow_key: "armour-floors-standard",
          workflow_version: 1,
          workflow_content_sha256: workflowContentHash(APPROVED_WORKFLOW),
        },
      },
    ]);
  });

  it("numbers jobs in order", async () => {
    const second = await createJob({ client: "Second Sample" });
    const [{ a }] = await rows<{ a: number }>(`select job_number as a from public.jobs where id = $1`, [jobId]);
    const [{ b }] = await rows<{ b: number }>(`select job_number as b from public.jobs where id = $1`, [second]);
    expect(b).toBe(a + 1);
  });

  it("stores explicit toggle choices", async () => {
    const [{ id }] = await as(db, { userId: ownerId }, () =>
      rows<{ id: string }>(
        `select public.create_job('Toggle Sample', '1 Sample Road', 300, 'Sample', '2026-11-01',
                                  'Side gate code on file.', false, true, false) as id`,
      ),
    );
    expect(
      await rows(
        `select general_notes, caulking_required, baseboard_required, allow_employees_to_join
         from public.jobs where id = $1`,
        [id],
      ),
    ).toEqual([
      {
        general_notes: "Side gate code on file.",
        caulking_required: false,
        baseboard_required: true,
        allow_employees_to_join: false,
      },
    ]);
  });

  it("counts progress units from the snapshot and the job's toggles", async () => {
    // 14 preparation steps + 2 milestones + caulking (default on).
    expect(
      await rows(
        `select total_units, completed_units, current_stage_name, current_step_title
         from public.job_progress where job_id = $1`,
        [jobId],
      ),
    ).toEqual([
      {
        total_units: 17,
        completed_units: 0,
        current_stage_name: "Initial Prep",
        current_step_title: "Grind Floor",
      },
    ]);
  });
});

describe("validation in the database", () => {
  const cases: [string, JobInput, RegExp][] = [
    ["blank client name", { client: "   " }, /check constraint/],
    ["blank address", { address: "" }, /check constraint/],
    ["zero square feet", { squareFeet: 0 }, /check constraint/],
    ["negative square feet", { squareFeet: -5 }, /check constraint/],
    ["too many square feet", { squareFeet: 100001 }, /check constraint/],
    ["blank flake", { flake: " " }, /check constraint/],
    ["date before 2020", { date: "2019-12-31" }, /check constraint/],
    ["impossible date", { date: "2026-02-30" }, /date|out of range/i],
  ];

  for (const [name, input, error] of cases) {
    it(`rejects a ${name} and leaves nothing behind`, async () => {
      const before = await counts();
      await expect(createJob(input)).rejects.toThrow(error);
      expect(await counts()).toEqual(before);
    });
  }

  it("rejects overly long notes", async () => {
    const before = await counts();
    await expect(
      as(db, { userId: ownerId }, () =>
        rows(`select public.create_job('A', 'B', 10, 'C', '2026-10-01', repeat('x', 2001))`),
      ),
    ).rejects.toThrow(/check constraint/);
    expect(await counts()).toEqual(before);
  });

  it("trims surrounding spaces", async () => {
    const id = await createJob({ client: "  Spaced Sample  ", flake: " Sample Flake " });
    expect(
      await rows(`select client_name, flake_color from public.jobs where id = $1`, [id]),
    ).toEqual([{ client_name: "Spaced Sample", flake_color: "Sample Flake" }]);
  });
});

describe("status changes", () => {
  it("lets the owner make a Scheduled job available and return it", async () => {
    const id = await createJob();
    await as(db, { userId: ownerId }, () => rows(`select public.make_job_available($1)`, [id]));
    const [available] = await rows<{ status: string; made_available_at: Date | null }>(
      `select status, made_available_at from public.jobs where id = $1`,
      [id],
    );
    expect(available.status).toBe("available_to_claim");
    expect(available.made_available_at).toBeInstanceOf(Date);

    await as(db, { userId: ownerId }, () => rows(`select public.return_job_to_scheduled($1)`, [id]));
    expect(
      await rows(`select status, made_available_at from public.jobs where id = $1`, [id]),
    ).toEqual([{ status: "scheduled", made_available_at: null }]);

    expect(
      (
        await rows<{ activity_type: string }>(
          `select activity_type from public.job_activity where job_id = $1 order by id`,
          [id],
        )
      ).map((r) => r.activity_type),
    ).toEqual(["job_created", "made_available", "returned_to_scheduled"]);
  });

  it("refuses functions from the wrong status", async () => {
    const id = await createJob();
    await expect(
      as(db, { userId: ownerId }, () => rows(`select public.return_job_to_scheduled($1)`, [id])),
    ).rejects.toThrow(/Only jobs that are Available to Claim/);
    await as(db, { userId: ownerId }, () => rows(`select public.make_job_available($1)`, [id]));
    await expect(
      as(db, { userId: ownerId }, () => rows(`select public.make_job_available($1)`, [id])),
    ).rejects.toThrow(/Only Scheduled jobs can be made available/);
  });

  it("allows only approved transitions, even for direct database writes", async () => {
    const id = await createJob();
    for (const target of ["claimed", "complete", "top_coat_installed", "initial_prep_in_progress"]) {
      await expect(
        rows(`update public.jobs set status = $1::public.job_status where id = $2`, [target, id]),
      ).rejects.toThrow(/cannot move from scheduled/);
    }
    await rows(`update public.jobs set status = 'available_to_claim' where id = $1`, [id]);
    await rows(`update public.jobs set status = 'claimed' where id = $1`, [id]);
    await expect(
      rows(`update public.jobs set status = 'scheduled' where id = $1`, [id]),
    ).rejects.toThrow(/cannot move from claimed to scheduled/);
  });

  it("never inserts a job in any status but Scheduled", async () => {
    await expect(
      rows(
        `insert into public.jobs (client_name, address, square_feet, flake_color, scheduled_date,
           workflow_template_id, workflow_key, workflow_version, workflow_content_sha256, created_by, status)
         select 'X', 'Y', 1, 'Z', '2026-10-01', id, key, version, content_sha256, $1, 'available_to_claim'
         from public.workflow_templates where status = 'active'`,
        [ownerId],
      ),
    ).rejects.toThrow(/must start as Scheduled/);
  });
});

describe("editing Scheduled jobs", () => {
  it("updates details and records old and new values in history", async () => {
    const id = await createJob({ client: "Before Name", squareFeet: 500 });
    await as(db, { userId: ownerId }, () =>
      rows(
        `select public.update_job_details($1, 'After Name', '100 Example Street, Sampletown', 520,
           'Sample Blend', '2026-10-15', 'New note', true, true, true)`,
        [id],
      ),
    );
    const [entry] = await rows<{ details: unknown }>(
      `select details from public.job_activity where job_id = $1 and activity_type = 'job_details_edited'`,
      [id],
    );
    expect(entry.details).toEqual({
      changes: {
        client_name: { from: "Before Name", to: "After Name" },
        square_feet: { from: 500, to: 520 },
        general_notes: { from: "", to: "New note" },
        baseboard_required: { from: false, to: true },
      },
    });
  });

  it("records nothing when nothing changed", async () => {
    const id = await createJob();
    await as(db, { userId: ownerId }, () =>
      rows(
        `select public.update_job_details($1, 'Sample Client', '100 Example Street, Sampletown', 640,
           'Sample Blend', '2026-10-15', '', true, false, true)`,
        [id],
      ),
    );
    expect(
      await rows(`select count(*)::int as n from public.job_activity where job_id = $1`, [id]),
    ).toEqual([{ n: 1 }]);
  });

  it("refuses to edit a job that is not Scheduled", async () => {
    const id = await createJob();
    await as(db, { userId: ownerId }, () => rows(`select public.make_job_available($1)`, [id]));
    await expect(
      as(db, { userId: ownerId }, () =>
        rows(
          `select public.update_job_details($1, 'X', 'Y', 1, 'Z', '2026-10-01', '', true, false, true)`,
          [id],
        ),
      ),
    ).rejects.toThrow(/Only Scheduled jobs can be edited/);
  });
});

describe("history is protected", () => {
  it("never deletes jobs, snapshot rows, or history", async () => {
    const id = await createJob();
    await expect(rows(`delete from public.jobs where id = $1`, [id])).rejects.toThrow(/job history/);
    for (const table of JOB_TABLES.slice(1)) {
      await expect(rows(`delete from public.${table} where job_id = $1`, [id]), table).rejects.toThrow(
        /job history/,
      );
    }
  });

  it("never changes snapshot rows or history entries", async () => {
    const id = await createJob();
    await expect(
      rows(`update public.job_steps set title = 'Changed' where job_id = $1`, [id]),
    ).rejects.toThrow(/job history/);
    await expect(
      rows(`update public.job_step_block_items set text = 'Changed' where job_id = $1`, [id]),
    ).rejects.toThrow(/job history/);
    await expect(
      rows(`update public.job_activity set details = '{}' where job_id = $1`, [id]),
    ).rejects.toThrow(/job history/);
  });

  it("never changes the workflow version a job was created from", async () => {
    const id = await createJob();
    await expect(
      rows(`update public.jobs set workflow_version = 2 where id = $1`, [id]),
    ).rejects.toThrow(/cannot change/);
  });
});

describe("access", () => {
  let scheduledId: string;

  beforeAll(async () => {
    scheduledId = await createJob({ client: "Visible Scheduled Sample" });
  });

  it("lets active employees read every job, including Scheduled jobs, and the snapshot", async () => {
    const visible = await as(db, { userId: employeeId }, () =>
      rows<{ id: string; status: string }>(`select id, status from public.jobs`),
    );
    expect(visible.find((j) => j.id === scheduledId)?.status).toBe("scheduled");
    for (const table of JOB_TABLES) {
      const [{ n }] = await as(db, { userId: employeeId }, () =>
        rows<{ n: number }>(`select count(*)::int as n from public.${table}`),
      );
      expect(n, table).toBeGreaterThan(0);
    }
    const progress = await as(db, { userId: employeeId }, () =>
      rows(`select total_units from public.job_progress where job_id = $1`, [scheduledId]),
    );
    expect(progress).toEqual([{ total_units: 17 }]);
  });

  it("hides jobs from deactivated users", async () => {
    expect(await as(db, { userId: inactiveId }, () => rows(`select id from public.jobs`))).toEqual([]);
  });

  it("blocks visitors who are not signed in", async () => {
    await expect(as(db, "anon", () => rows(`select id from public.jobs`))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("does not let employees create, edit, reschedule, or make jobs available", async () => {
    const before = await counts();
    await expect(createJob({}, employeeId)).rejects.toThrow(/Only an active owner/);
    await expect(
      as(db, { userId: employeeId }, () =>
        rows(
          `select public.update_job_details($1, 'X', 'Y', 1, 'Z', '2027-01-01', '', true, false, true)`,
          [scheduledId],
        ),
      ),
    ).rejects.toThrow(/Only an active owner/);
    await expect(
      as(db, { userId: employeeId }, () => rows(`select public.make_job_available($1)`, [scheduledId])),
    ).rejects.toThrow(/Only an active owner/);
    expect(await counts()).toEqual(before);
  });

  it("does not let deactivated owners manage jobs", async () => {
    const formerOwner = await createUser(db, { role: "owner", active: false });
    await expect(createJob({}, formerOwner)).rejects.toThrow(/Only an active owner/);
  });

  for (const who of ["employee", "owner"] as const) {
    it(`blocks direct writes to job tables for ${who}s`, async () => {
      const userId = who === "employee" ? employeeId : ownerId;
      for (const table of JOB_TABLES) {
        await expect(as(db, { userId }, () => rows(`delete from public.${table}`)), table).rejects.toThrow(
          /permission denied/,
        );
        const column = table === "jobs" ? "client_name" : "job_id";
        await expect(
          as(db, { userId }, () => rows(`update public.${table} set ${column} = ${column}`)),
          table,
        ).rejects.toThrow(/permission denied/);
      }
    });
  }
});

describe("snapshots survive workflow changes", () => {
  it("keeps existing jobs on the version they started with", async () => {
    const oldJob = await createJob({ client: "Before Version Two" });

    // Publish a small version 2 of the workflow.
    const [{ id: v2 }] = await rows<{ id: string }>(
      `insert into public.workflow_templates (key, name, version, source, content_sha256)
       values ('armour-floors-standard', 'Version Two', 2, 'test', repeat('e', 64)) returning id`,
    );
    const [{ id: stageId }] = await rows<{ id: string }>(
      `insert into public.workflow_stage_templates (template_id, position, key, name, kind)
       values ($1, 1, 'prep', 'Prep', 'employee_stage') returning id`,
      [v2],
    );
    const [{ id: stepId }] = await rows<{ id: string }>(
      `insert into public.workflow_step_templates
         (stage_id, stage_kind, position, key, title, kind, goal, proof_type, proof_text, confirmation_text)
       values ($1, 'employee_stage', 1, 'only_step', 'Only Step', 'standard', 'Goal.', 'none', 'None.', 'Done.')
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
    await as(db, "service_role", () => rows(`select public.activate_workflow_template($1)`, [v2]));

    // The old job is untouched; a new job gets version 2.
    expect(await jobSnapshot(oldJob)).toEqual(APPROVED_WORKFLOW);
    const newJob = await createJob({ client: "After Version Two" });
    expect(
      await rows(
        `select workflow_version, workflow_content_sha256 from public.jobs where id = $1`,
        [newJob],
      ),
    ).toEqual([{ workflow_version: 2, workflow_content_sha256: "e".repeat(64) }]);
    expect((await jobSnapshot(newJob)).stages.map((s) => s.name)).toEqual(["Prep"]);
  });
});

describe("without an active workflow", () => {
  let empty: PGlite;
  let owner: string;

  beforeAll(async () => {
    empty = await createTestDatabase();
    owner = await createUser(empty, { role: "owner" });
    await empty.exec(`update public.workflow_templates set status = 'retired', retired_at = now()`);
  }, 60_000);

  afterAll(async () => {
    await empty?.close();
  });

  it("refuses to create a job and leaves nothing behind", async () => {
    await expect(
      as(empty, { userId: owner }, () =>
        empty.query(`select public.create_job('A', 'B', 10, 'C', '2026-10-01')`),
      ),
    ).rejects.toThrow(/No active approved workflow/);
    const { rows: left } = await empty.query(
      `select (select count(*)::int from public.jobs) as jobs,
              (select count(*)::int from public.job_stages) as stages,
              (select count(*)::int from public.job_activity) as activity`,
    );
    expect(left).toEqual([{ jobs: 0, stages: 0, activity: 0 }]);
  });
});
