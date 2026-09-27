import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, readMigration } from "@/test/database";
import { APPROVED_WORKFLOW } from "./approved-workflow";
import { assembleWorkflow } from "./assemble";

// Runs every migration in an in-process Postgres and checks the seeded
// workflow, the template security rules, and versioning behavior.

const SEED = "20260927020100_seed_approved_workflow_v1.sql";
const TEMPLATE_TABLES = [
  "workflow_templates",
  "workflow_stage_templates",
  "workflow_step_templates",
  "workflow_step_blocks",
  "workflow_step_block_items",
  "workflow_step_inputs",
  "workflow_step_proof_requirements",
];

let db: PGlite;
let ownerId: string;
let employeeId: string;
let inactiveEmployeeId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  ownerId = await createUser(db, { role: "owner" });
  employeeId = await createUser(db, { role: "employee" });
  inactiveEmployeeId = await createUser(db, { role: "employee", active: false });
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function rows<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

describe("seeded approved workflow", () => {
  it("loads exactly one active version 1", async () => {
    expect(
      await rows(`select key, version, status, source from public.workflow_templates`),
    ).toEqual([
      {
        key: "armour-floors-standard",
        version: 1,
        status: "active",
        source: "docs/PRODUCT_SPEC.md",
      },
    ]);
  });

  it("stores the stages and steps in the approved order", async () => {
    const stageRows = await rows<{ key: string; kind: string; steps: string[] | null }>(
      `select st.key, st.kind,
              array_agg(s.title order by s.position) filter (where s.id is not null) as steps
       from public.workflow_stage_templates st
       left join public.workflow_step_templates s on s.stage_id = st.id
       group by st.id, st.key, st.kind, st.position
       order by st.position`,
    );
    expect(stageRows).toEqual(
      APPROVED_WORKFLOW.stages.map((stage) => ({
        key: stage.key,
        kind: stage.kind,
        steps: stage.steps.length ? stage.steps.map((s) => s.title) : null,
      })),
    );
  });

  it("stores every block, item, input, and proof requirement", async () => {
    const [counts] = await rows<Record<string, number>>(
      `select
         (select count(*)::int from public.workflow_step_templates) as steps,
         (select count(*)::int from public.workflow_step_blocks) as blocks,
         (select count(*)::int from public.workflow_step_block_items) as items,
         (select count(*)::int from public.workflow_step_inputs) as inputs,
         (select count(*)::int from public.workflow_step_proof_requirements) as proofs`,
    );
    const steps = APPROVED_WORKFLOW.stages.flatMap((s) => s.steps);
    expect(counts).toEqual({
      steps: steps.length,
      blocks: steps.reduce((n, s) => n + s.blocks.length, 0),
      items: steps.reduce((n, s) => n + s.blocks.reduce((m, b) => m + b.items.length, 0), 0),
      inputs: steps.reduce((n, s) => n + s.inputs.length, 0),
      proofs: steps.reduce((n, s) => n + s.proofRequirements.length, 0),
    });
  });

  it("requires only Final check items", async () => {
    expect(
      await rows(
        `select b.heading, b.kind, bool_and(i.required) as all_required, bool_or(i.required) as any_required
         from public.workflow_step_blocks b
         join public.workflow_step_block_items i on i.block_id = b.id
         group by b.heading, b.kind
         order by b.heading`,
      ),
    ).toEqual([
      { heading: "Choose the setup location", kind: "ordered_list", all_required: false, any_required: false },
      { heading: "Final action", kind: "reference_list", all_required: false, any_required: false },
      { heading: "Final check", kind: "checklist", all_required: true, any_required: true },
      { heading: "Inside-work-area checklist", kind: "reference_list", all_required: false, any_required: false },
      { heading: "Instructions", kind: "ordered_list", all_required: false, any_required: false },
      { heading: "Mixing-station checklist", kind: "reference_list", all_required: false, any_required: false },
    ]);
  });

  it("stores the proof type of every step", async () => {
    const stored = await rows<{ proof_type: string }>(
      `select s.proof_type
       from public.workflow_step_templates s
       join public.workflow_stage_templates st on st.id = s.stage_id
       order by st.position, s.position`,
    );
    expect(stored.map((r) => r.proof_type)).toEqual(
      APPROVED_WORKFLOW.stages.flatMap((s) => s.steps.map((step) => step.proofType)),
    );
  });

  it("stores the Collect Excess Flake inputs", async () => {
    expect(
      await rows(
        `select i.label, i.input_type, i.required, i.choices, i.whole_number, i.minimum::int
         from public.workflow_step_inputs i
         join public.workflow_step_templates s on s.id = i.step_id
         where s.key = 'collect_excess_flake'
         order by i.position`,
      ),
    ).toEqual([
      {
        label: "Full boxes recovered",
        input_type: "number",
        required: true,
        choices: null,
        whole_number: true,
        minimum: 0,
      },
      {
        label: "Additional flake",
        input_type: "single_select",
        required: true,
        choices: ["None", "¼ box", "½ box", "¾ box"],
        whole_number: false,
        minimum: null,
      },
    ]);
  });

  it("keeps installation milestones as owner actions with no steps", async () => {
    expect(
      await rows(
        `select st.key, st.owner_action_label, st.waiting_status_label, st.completed_status_label,
                (select count(*)::int from public.workflow_step_templates s where s.stage_id = st.id) as steps
         from public.workflow_stage_templates st
         where st.kind = 'owner_milestone'
         order by st.position`,
      ),
    ).toEqual([
      {
        key: "base_coat_installation",
        owner_action_label: "Mark Base Coat Installed",
        waiting_status_label: "Waiting for Base-Coat Installation",
        completed_status_label: "Base Coat Installed",
        steps: 0,
      },
      {
        key: "top_coat_installation",
        owner_action_label: "Mark Top Coat Installed",
        waiting_status_label: "Waiting for Top-Coat Installation",
        completed_status_label: "Top Coat Installed",
        steps: 0,
      },
    ]);
  });

  it("places caulking and baseboard only in Completion Work, last", async () => {
    expect(
      await rows(
        `select st.position as stage_position, st.key as stage, s.title, s.applies_when
         from public.workflow_step_templates s
         join public.workflow_stage_templates st on st.id = s.stage_id
         where s.kind = 'completion_item' or s.applies_when is not null
         order by s.position`,
      ),
    ).toEqual([
      { stage_position: 5, stage: "completion_work", title: "Caulking Complete", applies_when: "caulking_required" },
      { stage_position: 5, stage: "completion_work", title: "Baseboard Complete", applies_when: "baseboard_required" },
    ]);
  });

  it("reads back from the database exactly as the approved workflow", async () => {
    // What an employee reads through Row Level Security.
    const read = (table: string) =>
      as(db, { userId: employeeId }, () => rows<never>(`select * from public.${table}`));
    const [template] = await read("workflow_templates");
    const assembled = assembleWorkflow({
      template,
      stages: await read("workflow_stage_templates"),
      steps: await read("workflow_step_templates"),
      blocks: await read("workflow_step_blocks"),
      items: await read("workflow_step_block_items"),
      inputs: await read("workflow_step_inputs"),
      proofs: await read("workflow_step_proof_requirements"),
    });
    expect(assembled).toEqual(APPROVED_WORKFLOW);
  });

  it("does nothing when the seed runs again", async () => {
    await db.exec(readMigration(SEED));
    expect(await rows(`select count(*)::int as n from public.workflow_templates`)).toEqual([{ n: 1 }]);
    expect(await rows(`select count(*)::int as n from public.workflow_step_templates`)).toEqual([
      { n: 16 },
    ]);
  });

  it("refuses to load version 1 over different content", async () => {
    const altered = readMigration(SEED).replace(
      /content_sha256 into v_existing_hash/,
      "content_sha256 into v_existing_hash",
    ).replace(/if v_existing_hash = '[0-9a-f]{64}'/, "if v_existing_hash = 'different'");
    await expect(db.exec(altered)).rejects.toThrow(/already exists with different content/);
  });
});

describe("template security", () => {
  it("lets an active employee read the active workflow", async () => {
    const counts = await as(db, { userId: employeeId }, () =>
      rows<{ table: string; n: number }>(
        TEMPLATE_TABLES.map(
          (t) => `select '${t}' as table, count(*)::int as n from public.${t}`,
        ).join(" union all "),
      ),
    );
    for (const { table, n } of counts) expect(n, table).toBeGreaterThan(0);
  });

  it("hides the workflow from deactivated users", async () => {
    const templates = await as(db, { userId: inactiveEmployeeId }, () =>
      rows(`select id from public.workflow_templates`),
    );
    expect(templates).toEqual([]);
  });

  it("blocks visitors who are not signed in", async () => {
    await expect(
      as(db, "anon", () => rows(`select id from public.workflow_templates`)),
    ).rejects.toThrow(/permission denied/);
  });

  for (const who of ["employee", "owner"] as const) {
    it(`does not let ${who}s insert, update, or delete template content`, async () => {
      const userId = who === "employee" ? employeeId : ownerId;
      for (const table of TEMPLATE_TABLES) {
        await expect(
          as(db, { userId }, () => rows(`delete from public.${table}`)),
          table,
        ).rejects.toThrow(/permission denied/);
        await expect(
          as(db, { userId }, () => rows(`update public.${table} set id = id`)),
          table,
        ).rejects.toThrow(/permission denied/);
      }
      await expect(
        as(db, { userId }, () =>
          rows(
            `insert into public.workflow_templates (key, name, version, source, content_sha256)
             values ('x', 'x', 9, 'x', repeat('a', 64))`,
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it(`does not let ${who}s activate or validate templates`, async () => {
      const userId = who === "employee" ? employeeId : ownerId;
      const [{ id }] = await rows<{ id: string }>(`select id from public.workflow_templates`);
      await expect(
        as(db, { userId }, () => rows(`select public.activate_workflow_template($1)`, [id])),
      ).rejects.toThrow(/permission denied/);
    });
  }
});

describe("published templates are immutable", () => {
  it("rejects changes to the active version's content", async () => {
    await expect(
      rows(`update public.workflow_step_templates set title = 'Changed' where key = 'grind_floor'`),
    ).rejects.toThrow(/cannot change after it is published/);
    await expect(
      rows(`update public.workflow_step_block_items set text = 'Changed' where position = 1`),
    ).rejects.toThrow(/cannot change after it is published/);
    await expect(rows(`update public.workflow_templates set name = 'Changed'`)).rejects.toThrow(
      /cannot change after it is published/,
    );
    await expect(rows(`delete from public.workflow_templates`)).rejects.toThrow(
      /cannot be deleted/,
    );
  });
});

describe("template constraints", () => {
  let draftId: string;
  let milestoneStageId: string;
  let employeeStageId: string;

  beforeAll(async () => {
    [{ id: draftId }] = await rows<{ id: string }>(
      `insert into public.workflow_templates (key, name, version, source, content_sha256)
       values ('armour-floors-standard', 'Draft', 2, 'test', repeat('b', 64)) returning id`,
    );
    [{ id: employeeStageId }] = await rows<{ id: string }>(
      `insert into public.workflow_stage_templates (template_id, position, key, name, kind)
       values ($1, 1, 'prep', 'Prep', 'employee_stage') returning id`,
      [draftId],
    );
    [{ id: milestoneStageId }] = await rows<{ id: string }>(
      `insert into public.workflow_stage_templates
         (template_id, position, key, name, kind, owner_action_label, waiting_status_label, completed_status_label)
       values ($1, 2, 'install', 'Install', 'owner_milestone', 'Mark Installed', 'Waiting', 'Installed')
       returning id`,
      [draftId],
    );
  });

  it("does not allow steps inside an owner milestone", async () => {
    await expect(
      rows(
        `insert into public.workflow_step_templates
           (stage_id, stage_kind, position, key, title, kind, goal, proof_type, proof_text, confirmation_text)
         values ($1, 'owner_milestone', 1, 'x', 'X', 'standard', 'g', 'none', 'None.', 'c')`,
        [milestoneStageId],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("does not allow a reference list item to be required", async () => {
    const [{ id: stepId }] = await rows<{ id: string }>(
      `insert into public.workflow_step_templates
         (stage_id, stage_kind, position, key, title, kind, goal, proof_type, proof_text, confirmation_text)
       values ($1, 'employee_stage', 1, 'setup', 'Setup', 'standard', 'g', 'none', 'None.', 'c')
       returning id`,
      [employeeStageId],
    );
    const [{ id: blockId }] = await rows<{ id: string }>(
      `insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
       values ($1, 'standard', 1, 'Mixing-station checklist', 'reference_list') returning id`,
      [stepId],
    );
    await expect(
      rows(
        `insert into public.workflow_step_block_items (block_id, block_kind, position, text, required)
         values ($1, 'reference_list', 1, 'Gloves', true)`,
        [blockId],
      ),
    ).rejects.toThrow(/violates check constraint/);
    await expect(
      rows(
        `insert into public.workflow_step_block_items (block_id, block_kind, position, text, required)
         values ($1, 'checklist', 1, 'Gloves', true)`,
        [blockId],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("does not allow proof requirements on a step with no proof", async () => {
    const [{ id: stepId }] = await rows<{ id: string }>(
      `select id from public.workflow_step_templates where key = 'setup' and stage_id = $1`,
      [employeeStageId],
    );
    await expect(
      rows(
        `insert into public.workflow_step_proof_requirements
           (step_id, step_proof_type, position, label, media_type, min_count, allow_multiple)
         values ($1, 'none', 1, 'One picture.', 'picture', 1, false)`,
        [stepId],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("does not allow completion items outside Completion Work", async () => {
    await expect(
      rows(
        `insert into public.workflow_step_templates
           (stage_id, stage_kind, position, key, title, kind, proof_type, applies_when)
         values ($1, 'employee_stage', 9, 'caulk', 'Caulking Complete', 'completion_item', 'none', 'caulking_required')`,
        [employeeStageId],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("refuses to activate an invalid draft", async () => {
    // The draft's setup step has no Final check yet.
    await expect(rows(`select public.activate_workflow_template($1)`, [draftId])).rejects.toThrow(
      /not valid/,
    );
    await expect(
      rows(`select status from public.workflow_templates where id = $1`, [draftId]),
    ).resolves.toEqual([{ status: "draft" }]);
  });
});

describe("versions and the active template", () => {
  it("keeps drafts hidden from employees but visible to owners", async () => {
    const employeeView = await as(db, { userId: employeeId }, () =>
      rows<{ version: number }>(`select version from public.workflow_templates order by version`),
    );
    const ownerView = await as(db, { userId: ownerId }, () =>
      rows<{ version: number }>(`select version from public.workflow_templates order by version`),
    );
    expect(employeeView.map((r) => r.version)).toEqual([1]);
    expect(ownerView.map((r) => r.version)).toEqual([1, 2]);
  });

  it("activating a new version retires the old one, and only one can be active", async () => {
    const [{ id: v2 }] = await rows<{ id: string }>(
      `select id from public.workflow_templates where version = 2`,
    );
    // Finish the draft: give its step a Final check.
    const [{ id: stepId }] = await rows<{ id: string }>(
      `select s.id from public.workflow_step_templates s
       join public.workflow_stage_templates st on st.id = s.stage_id
       where st.template_id = $1`,
      [v2],
    );
    const [{ id: blockId }] = await rows<{ id: string }>(
      `insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
       values ($1, 'standard', 2, 'Final check', 'checklist') returning id`,
      [stepId],
    );
    await rows(
      `insert into public.workflow_step_block_items (block_id, block_kind, position, text, required)
       values ($1, 'checklist', 1, 'Done.', true)`,
      [blockId],
    );
    // The reference list from the earlier test still has no items.
    await rows(
      `insert into public.workflow_step_block_items (block_id, block_kind, position, text, required)
       select id, 'reference_list', 1, 'Gloves', false from public.workflow_step_blocks
       where step_id = $1 and kind = 'reference_list'`,
      [stepId],
    );

    await as(db, "service_role", () => rows(`select public.activate_workflow_template($1)`, [v2]));

    expect(
      await rows(`select version, status from public.workflow_templates order by version`),
    ).toEqual([
      { version: 1, status: "retired" },
      { version: 2, status: "active" },
    ]);

    // Version 1's content is still intact for jobs that started on it.
    expect(
      await rows(
        `select count(*)::int as n from public.workflow_step_templates s
         join public.workflow_stage_templates st on st.id = s.stage_id
         join public.workflow_templates t on t.id = st.template_id
         where t.version = 1`,
      ),
    ).toEqual([{ n: 16 }]);

    // A retired version cannot be reactivated directly, and a second
    // active version is impossible.
    await expect(
      rows(`update public.workflow_templates set status = 'active' where version = 1`),
    ).rejects.toThrow(/Invalid workflow template status change/);
    const [{ id: v3 }] = await rows<{ id: string }>(
      `insert into public.workflow_templates (key, name, version, source, content_sha256)
       values ('armour-floors-standard', 'Draft', 3, 'test', repeat('c', 64)) returning id`,
    );
    await expect(
      rows(
        `update public.workflow_templates set status = 'active', activated_at = now() where id = $1`,
        [v3],
      ),
    ).rejects.toThrow(/workflow_templates_one_active/);
  });

  it("shows employees only the newly active version", async () => {
    const employeeView = await as(db, { userId: employeeId }, () =>
      rows<{ version: number }>(`select version from public.workflow_templates`),
    );
    expect(employeeView).toEqual([{ version: 2 }]);
  });
});
