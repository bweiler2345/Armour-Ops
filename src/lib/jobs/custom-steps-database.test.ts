import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { definitionFromForm } from "@/lib/steps/definition";
import { as, createTestDatabase, createUser } from "@/test/database";

// Runs every migration in an in-process Postgres and checks Phase 8: the
// Custom Step Library, one-time and imported custom steps, reference
// pictures, Owner/Working Member, and reopening. R2 itself is not involved;
// the server's R2 checks are passed in as the server would.
//
// Test-database fixture: approved preparation steps that need real uploads
// are marked complete directly, and the job is walked through the approved
// statuses with set_job_status. The app has no such bypass.

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

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function call<T = unknown>(userId: string, fn: string, ...args: unknown[]): Promise<T> {
  const [row] = await as(db, { userId }, () =>
    rows<{ result: T }>(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as result`, args),
  );
  return row.result;
}

const server = (fn: string, ...args: unknown[]) =>
  as(db, "service_role", () =>
    rows(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args),
  );

type Definition = Record<string, unknown>;

const SAND_STAIRS: Definition = {
  title: "Sand Stairs",
  goal: "Smooth every tread before coating.",
  instructions: ["Sand each tread with 60 grit.", "Vacuum the dust."],
  referenceLists: [{ heading: "Tools", items: ["Hand sander", "60 grit paper"] }],
  checks: [
    { text: "Every tread is sanded", required: true },
    { text: "Nosing edges checked", required: false },
  ],
  inputs: [
    { label: "Treads sanded", type: "number", required: true, unit: "treads", wholeNumber: true, minimum: 1 },
    { label: "Stair type", type: "single_select", required: false, choices: ["Wood", "Concrete"] },
  ],
  proof: { type: "picture", label: "One picture of the finished stairs", minCount: 1, allowMultiple: false },
  confirmationText: "I confirm the stairs are sanded and clean.",
};

const QUICK_CHECK: Definition = {
  title: "Grind Down Lip",
  instructions: ["Grind the lip flush."],
  checks: [{ text: "Lip is flush", required: true }],
  proof: { type: "none" },
  confirmationText: "I confirm the lip is flush.",
};

async function newJob({ claim = true } = {}) {
  const id = await call<string>(owner, "create_job", "Sample Client", "1 Sample Road", 500, "Sample", "2026-10-20");
  if (claim) {
    await call(owner, "make_job_available", id);
    await call(a, "claim_job", id);
    await call(b, "join_job", id);
  }
  return id;
}

async function stage(jobId: string, key: string) {
  const [{ id }] = await rows<{ id: string }>(`select id from public.job_stages where job_id = $1 and key = $2`, [
    jobId,
    key,
  ]);
  return id;
}

async function stageSteps(jobId: string, key: string) {
  return rows<{ id: string; title: string; position: number; is_custom: boolean }>(
    `select s.id, s.title, s.position, s.is_custom from public.job_steps s
     join public.job_stages st on st.id = s.job_stage_id
     where s.job_id = $1 and st.key = $2 order by s.position`,
    [jobId, key],
  );
}

async function state(stepId: string) {
  const [{ s }] = await rows<{ s: string }>(`select public.job_step_state($1) as s`, [stepId]);
  return s;
}

async function status(jobId: string) {
  const [{ s }] = await rows<{ s: string }>(`select status as s from public.jobs where id = $1`, [jobId]);
  return s;
}

async function history(jobId: string, type: string) {
  return rows<{ actor_id: string; details: Record<string, unknown> }>(
    `select actor_id, details from public.job_activity where job_id = $1 and activity_type = $2 order by id`,
    [jobId, type],
  );
}

async function forceComplete(stepId: string, userId = a) {
  await rows(
    `insert into public.step_attempts
       (job_id, job_step_id, attempt_number, status, started_by, completed_by, completed_at, confirmation_text_shown)
     select job_id, id, coalesce((select max(attempt_number) from public.step_attempts where job_step_id = $1), 0) + 1,
            'completed', $2, $2, now(), confirmation_text from public.job_steps where id = $1`,
    [stepId, userId],
  );
}

async function forceStage(jobId: string, key: string) {
  for (const s of await stageSteps(jobId, key)) await forceComplete(s.id);
}

async function walk(jobId: string, ...statuses: string[]) {
  for (const to of statuses) await rows(`select public.set_job_status($1, $2, $3)`, [jobId, to, a]);
}

async function lease(userId: string, stepId: string) {
  const [row] = await as(db, { userId }, () =>
    rows<{ lease_id: string }>(`select * from public.acquire_step_edit($1)`, [stepId]),
  );
  return row.lease_id;
}

async function checkAll(userId: string, stepId: string, l: string) {
  const items = await rows<{ id: string }>(
    `select i.id from public.job_step_block_items i join public.job_step_blocks b on b.id = i.job_block_id
     where b.job_step_id = $1 and b.kind = 'checklist'`,
    [stepId],
  );
  for (const item of items) await call(userId, "save_step_check", stepId, l, item.id, true);
}

async function inputs(stepId: string) {
  return rows<{ id: string; label: string; input_type: string; required: boolean; choices: string[] | null }>(
    `select id, label, input_type, required, choices from public.job_step_inputs where job_step_id = $1 order by position`,
    [stepId],
  );
}

async function uploadProof(userId: string, stepId: string, l: string) {
  const [req] = await rows<{ id: string }>(`select id from public.job_step_proof_requirements where job_step_id = $1`, [
    stepId,
  ]);
  const [up] = await as(db, { userId }, () =>
    rows<{ media_id: string; object_key: string }>(
      `select * from public.create_media_upload($1, $2, $3, 'picture', 'image/jpeg', 1500000, 4000000, null, 'IMG.HEIC', 1)`,
      [stepId, l, req.id],
    ),
  );
  const [result] = await server("confirm_media_upload", up.media_id, userId, l, up.object_key, 1_500_000, "image/jpeg");
  expect(result).toEqual({ confirm_media_upload: "uploaded" });
  return up.media_id;
}

// Uploads and confirms a reference picture as the server would.
async function referencePicture(size = 800_000) {
  const [row] = await as(db, { userId: owner }, () =>
    rows<{ picture_id: string; object_key: string }>(`select * from public.create_reference_upload($1, 'ref.jpg')`, [size]),
  );
  const [result] = await server("confirm_reference_upload", row.picture_id, owner, row.object_key, size, "image/jpeg");
  expect(result).toEqual({ confirm_reference_upload: "uploaded" });
  return row.picture_id;
}

async function jobLinks(stepId: string) {
  return rows<{ picture_id: string; archived_at: Date | null; source_link_id: string | null }>(
    `select picture_id, archived_at, source_link_id from public.reference_picture_links
     where job_step_id = $1 order by position`,
    [stepId],
  );
}

async function canView(pictureId: string, userId: string) {
  return (await server("authorize_reference_view", pictureId, userId)).length === 1;
}

describe("Custom Step Library", () => {
  it("creates, versions, and archives items without ever deleting a version", async () => {
    const item = await call<string>(owner, "create_library_item", JSON.stringify(SAND_STAIRS));
    expect(await rows(`select version_number, title from public.step_library_versions where item_id = $1`, [item])).toEqual([
      { version_number: 1, title: "Sand Stairs" },
    ]);

    const edited = { ...SAND_STAIRS, title: "Sand Stairs and Landing" };
    expect(await call(owner, "update_library_item", item, JSON.stringify(edited))).toBe(2);
    // Saving the same content again doesn't add a version.
    expect(await call(owner, "update_library_item", item, JSON.stringify(edited))).toBe(2);

    expect(await call(owner, "archive_library_item", item)).toBe("archived");
    expect(await call(owner, "archive_library_item", item)).toBe("already_archived");
    await expect(call(owner, "update_library_item", item, JSON.stringify(SAND_STAIRS))).rejects.toThrow(
      "Archived library steps can't be edited.",
    );

    await expect(rows(`delete from public.step_library_items where id = $1`, [item])).rejects.toThrow(/never deleted/);
    await expect(rows(`update public.step_library_versions set title = 'x' where item_id = $1`, [item])).rejects.toThrow(
      /part of job history/,
    );
    await expect(rows(`delete from public.step_library_versions where item_id = $1`, [item])).rejects.toThrow(
      /part of job history/,
    );
    expect(await rows(`select 1 from public.step_library_versions where item_id = $1`, [item])).toHaveLength(2);
  });

  it("rejects invalid steps in plain language", async () => {
    const bad = (changes: Definition) => call(owner, "create_library_item", JSON.stringify({ ...QUICK_CHECK, ...changes }));
    await expect(bad({ title: "  " })).rejects.toThrow("Give the step a name of up to 80 characters.");
    await expect(bad({ confirmationText: "" })).rejects.toThrow("Add a confirmation statement");
    await expect(bad({ instructions: [], checks: [] })).rejects.toThrow("Add at least one instruction or Final check item.");
    await expect(bad({ proof: { type: "video", label: "Video", minCount: 2, allowMultiple: true } })).rejects.toThrow(
      "A video proof is one video.",
    );
    await expect(bad({ proof: { type: "picture", label: "Pictures", minCount: 3, allowMultiple: false } })).rejects.toThrow(
      "Allow more than one picture",
    );
    await expect(
      bad({ inputs: [{ label: "Kind", type: "single_select", required: true, choices: ["Only one"] }] }),
    ).rejects.toThrow("2 to 12 different choices");
    await expect(
      bad({
        inputs: [
          { label: "Count", type: "number", required: true },
          { label: "count", type: "text", required: false },
        ],
      }),
    ).rejects.toThrow("Each entry needs a different label.");
  });

  it("accepts what the owner's step editor sends", async () => {
    const form = new FormData();
    for (const [k, v] of Object.entries({
      title: "Sand Stairs",
      instructions: "Sand\nVacuum",
      checksRequired: "Sanded",
      checksOptional: "Nosing",
      refHeading0: "Tools",
      refItems0: "Sander",
      inputCount: "2",
      input0Label: "Treads",
      input0Type: "number",
      input0Required: "on",
      input0Whole: "on",
      input0Minimum: "1",
      input1Label: "Kind",
      input1Type: "single_select",
      input1Choices: "Wood\nConcrete",
      proofType: "picture",
      proofLabel: "Stairs",
      proofMinCount: "2",
    })) {
      form.set(k, v);
    }
    const parsed = definitionFromForm(form);
    expect(parsed.ok).toBe(true);
    const [{ problem }] = await rows<{ problem: string | null }>(`select public.step_definition_problem($1) as problem`, [
      JSON.stringify(parsed.ok ? parsed.definition : null),
    ]);
    expect(problem).toBeNull();
  });

  it("is owner only", async () => {
    const item = await call<string>(owner, "create_library_item", JSON.stringify(QUICK_CHECK));
    for (const user of [a, outsider]) {
      await expect(call(user, "create_library_item", JSON.stringify(QUICK_CHECK))).rejects.toThrow(
        "Only an active owner can do this.",
      );
      await expect(call(user, "update_library_item", item, JSON.stringify(QUICK_CHECK))).rejects.toThrow(
        "Only an active owner can do this.",
      );
      await expect(call(user, "archive_library_item", item)).rejects.toThrow("Only an active owner can do this.");
      const visible = await as(db, { userId: user }, () =>
        rows(`select * from public.step_library_items union all select item_id, 1, created_by, created_at, null, null from public.step_library_versions`),
      );
      expect(visible).toEqual([]);
    }
  });
});

describe("custom steps on jobs", () => {
  it("adds a one-time step to a Scheduled job at the chosen position, with checks, inputs, and proof", async () => {
    const job = await newJob({ claim: false });
    const prep = await stage(job, "initial_prep");
    const before = await stageSteps(job, "initial_prep");

    const step = await call<string>(owner, "add_custom_step", job, prep, 2, JSON.stringify(SAND_STAIRS), false);
    const after = await stageSteps(job, "initial_prep");
    expect(after.map((s) => s.title)).toEqual([before[0].title, "Sand Stairs", ...before.slice(1).map((s) => s.title)]);
    expect(after.map((s) => s.position)).toEqual(after.map((_, i) => i + 1));

    const [row] = await rows(
      `select is_custom, custom_origin, source_library_version_id, added_by, added_at is not null as timed, kind, proof_type, proof_text, confirmation_text
       from public.job_steps where id = $1`,
      [step],
    );
    expect(row).toEqual({
      is_custom: true,
      custom_origin: "one_time",
      source_library_version_id: null,
      added_by: owner,
      timed: true,
      kind: "standard",
      proof_type: "picture",
      proof_text: "One picture of the finished stairs",
      confirmation_text: "I confirm the stairs are sanded and clean.",
    });
    expect(
      await rows(
        `select b.kind, b.heading, count(i.*)::int as items, count(*) filter (where i.required)::int as required
         from public.job_step_blocks b join public.job_step_block_items i on i.job_block_id = b.id
         where b.job_step_id = $1 group by b.kind, b.heading, b.position order by b.position`,
        [step],
      ),
    ).toEqual([
      { kind: "ordered_list", heading: "Instructions", items: 2, required: 0 },
      { kind: "reference_list", heading: "Tools", items: 2, required: 0 },
      { kind: "checklist", heading: "Final check", items: 2, required: 1 },
    ]);
    expect((await inputs(step)).map((i) => [i.label, i.input_type, i.required, i.choices])).toEqual([
      ["Treads sanded", "number", true, null],
      ["Stair type", "single_select", false, ["Wood", "Concrete"]],
    ]);
    expect(await history(job, "custom_step_added")).toMatchObject([
      { actor_id: owner, details: { step_id: step, title: "Sand Stairs", origin: "one_time", position: 2 } },
    ]);
  });

  it("can save a one-time step to the library", async () => {
    const job = await newJob({ claim: false });
    const step = await call<string>(owner, "add_custom_step", job, await stage(job, "top_coat_prep"), 1, JSON.stringify(QUICK_CHECK), true);
    const [row] = await rows<{ custom_origin: string; item_id: string; title: string }>(
      `select s.custom_origin, v.item_id, v.title from public.job_steps s
       join public.step_library_versions v on v.id = s.source_library_version_id where s.id = $1`,
      [step],
    );
    expect(row).toMatchObject({ custom_origin: "one_time", title: "Grind Down Lip" });
  });

  it("imports the library's current version as a job copy that later edits never change", async () => {
    const item = await call<string>(owner, "create_library_item", JSON.stringify(SAND_STAIRS));
    // Imported while creating a job (Scheduled), and again while editing another Scheduled job.
    const first = await newJob({ claim: false });
    const imported = await call<string>(owner, "import_library_step", first, await stage(first, "initial_prep"), 1, item);

    await call(owner, "update_library_item", item, JSON.stringify({ ...SAND_STAIRS, title: "Sand Stairs v2", checks: [{ text: "New check", required: true }] }));
    const second = await newJob({ claim: false });
    const later = await call<string>(owner, "import_library_step", second, await stage(second, "initial_prep"), 3, item);

    const describe = (id: string) =>
      rows(
        `select s.title, s.custom_origin, v.version_number,
                (select array_agg(i.text order by i.position) from public.job_step_block_items i
                 join public.job_step_blocks b on b.id = i.job_block_id where b.job_step_id = s.id and b.kind = 'checklist') as checks
         from public.job_steps s join public.step_library_versions v on v.id = s.source_library_version_id where s.id = $1`,
        [id],
      );
    expect(await describe(imported)).toEqual([
      { title: "Sand Stairs", custom_origin: "library_import", version_number: 1, checks: ["Every tread is sanded", "Nosing edges checked"] },
    ]);
    expect(await describe(later)).toEqual([
      { title: "Sand Stairs v2", custom_origin: "library_import", version_number: 2, checks: ["New check"] },
    ]);
  });

  it("won't import an archived item", async () => {
    const item = await call<string>(owner, "create_library_item", JSON.stringify(QUICK_CHECK));
    await call(owner, "archive_library_item", item);
    const job = await newJob({ claim: false });
    await expect(call(owner, "import_library_step", job, await stage(job, "initial_prep"), 1, item)).rejects.toThrow(
      "This library step is archived and can't be imported into new work.",
    );
  });

  it("allows only safe positions on an active job, never milestones or Complete jobs", async () => {
    const job = await newJob();
    const prep = await stage(job, "initial_prep");
    const [first, second, third] = await stageSteps(job, "initial_prep");
    await forceComplete(first.id);
    await forceComplete(second.id);
    await walk(job, "initial_prep_in_progress");

    const [range] = await as(db, { userId: owner }, () =>
      rows(`select * from public.custom_step_positions($1) where stage_id = $2`, [job, prep]),
    );
    expect(range).toMatchObject({ first_position: 3 });

    await expect(call(owner, "add_custom_step", job, prep, 2, JSON.stringify(QUICK_CHECK), false)).rejects.toThrow(
      /Steps can't go before work that has started/,
    );
    await expect(
      call(owner, "add_custom_step", job, await stage(job, "base_coat_installation"), 1, JSON.stringify(QUICK_CHECK), false),
    ).rejects.toThrow("Custom steps can't be added to installation milestones or Completion Work.");
    await expect(
      call(owner, "add_custom_step", job, await stage(job, "completion_work"), 1, JSON.stringify(QUICK_CHECK), false),
    ).rejects.toThrow("Custom steps can't be added to installation milestones or Completion Work.");

    // Safe: right at the current unfinished work. It opens next; the old third step waits.
    const custom = await call<string>(owner, "add_custom_step", job, prep, 3, JSON.stringify(QUICK_CHECK), false);
    expect(await state(custom)).toBe("available");
    expect(await state(third.id)).toBe("locked");

    // Once Initial Prep is finished, it's closed to new steps.
    await forceComplete(custom);
    for (const s of (await stageSteps(job, "initial_prep")).slice(3)) await forceComplete(s.id);
    await walk(job, "waiting_for_base_coat_installation");
    await expect(call(owner, "add_custom_step", job, prep, 20, JSON.stringify(QUICK_CHECK), false)).rejects.toThrow(
      "This stage is already finished, so steps can't be added to it.",
    );
  });

  it("works through the normal lease, checks, entries, proof, and unlocking rules", async () => {
    const job = await newJob();
    const custom = await call<string>(owner, "add_custom_step", job, await stage(job, "initial_prep"), 1, JSON.stringify(SAND_STAIRS), false);
    const grind = (await stageSteps(job, "initial_prep"))[1];
    expect(await state(custom)).toBe("available");
    expect(await state(grind.id)).toBe("locked");

    const l = await lease(a, custom);
    await expect(call(a, "complete_step", custom, l, true)).rejects.toThrow("Check every Final check item first.");
    await checkAll(a, custom, l);
    await expect(call(a, "complete_step", custom, l, true)).rejects.toThrow("Fill in every required entry first. Missing: Treads sanded");
    const [treads] = await inputs(custom);
    await expect(call(a, "save_step_input", custom, l, treads.id, "0")).rejects.toThrow();
    await call(a, "save_step_input", custom, l, treads.id, "12");

    // A reference picture on the step doesn't count as proof.
    const picture = await referencePicture();
    await call(owner, "attach_reference_picture", picture, "job_step", custom);
    await expect(call(a, "complete_step", custom, l, true)).rejects.toThrow(
      "Add the required proof first. Missing: One picture of the finished stairs",
    );

    await uploadProof(a, custom, l);
    await call(a, "complete_step", custom, l, true);
    expect(await state(custom)).toBe("completed");
    expect(await state(grind.id)).toBe("available");
  });

  it("is managed by the owner only", async () => {
    const job = await newJob({ claim: false });
    const prep = await stage(job, "initial_prep");
    const item = await call<string>(owner, "create_library_item", JSON.stringify(QUICK_CHECK));
    const custom = await call<string>(owner, "add_custom_step", job, prep, 1, JSON.stringify(QUICK_CHECK), false);
    for (const user of [a, outsider]) {
      await expect(call(user, "add_custom_step", job, prep, 1, JSON.stringify(QUICK_CHECK), false)).rejects.toThrow(
        "Only an active owner can do this.",
      );
      await expect(call(user, "import_library_step", job, prep, 1, item)).rejects.toThrow("Only an active owner can do this.");
      await expect(call(user, "remove_custom_step", custom)).rejects.toThrow("Only an active owner can do this.");
      await expect(as(db, { userId: user }, () => rows(`update public.job_steps set title = 'x' where id = $1`, [custom]))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("can remove an unstarted custom step only before the job is claimed", async () => {
    const job = await newJob({ claim: false });
    const prep = await stage(job, "initial_prep");
    const before = (await stageSteps(job, "initial_prep")).map((s) => s.title);
    const custom = await call<string>(owner, "add_custom_step", job, prep, 1, JSON.stringify(SAND_STAIRS), false);
    await call(owner, "remove_custom_step", custom);
    const after = await stageSteps(job, "initial_prep");
    expect(after.map((s) => s.title)).toEqual(before);
    expect(after.map((s) => s.position)).toEqual(after.map((_, i) => i + 1));
    expect(await history(job, "custom_step_removed")).toMatchObject([{ actor_id: owner, details: { title: "Sand Stairs" } }]);

    const active = await newJob();
    const kept = await call<string>(owner, "add_custom_step", active, await stage(active, "initial_prep"), 1, JSON.stringify(QUICK_CHECK), false);
    await expect(call(owner, "remove_custom_step", kept)).rejects.toThrow("Custom steps can be removed only before the job is claimed.");
    const [standard] = await stageSteps(job, "initial_prep");
    await expect(call(owner, "remove_custom_step", standard.id)).rejects.toThrow("Only custom steps can be removed.");
  });
});

describe("reference pictures", () => {
  it("copies a standard step's current pictures into new jobs only", async () => {
    const existing = await newJob();
    const [{ id: template }] = await rows<{ id: string }>(
      `select s.id from public.workflow_step_templates s join public.workflow_stage_templates st on st.id = s.stage_id
       join public.workflow_templates t on t.id = st.template_id where t.status = 'active' and s.key = 'grind_floor'`,
    );
    const picture = await referencePicture();
    const link = await call<string>(owner, "attach_reference_picture", picture, "workflow_step", template);

    const fresh = await newJob();
    const grind = async (job: string) => (await stageSteps(job, "initial_prep"))[0].id;
    expect(await jobLinks(await grind(existing))).toEqual([]);
    expect(await jobLinks(await grind(fresh))).toEqual([{ picture_id: picture, archived_at: null, source_link_id: link }]);

    // Archiving it on the standard step doesn't change the job that has it.
    await call(owner, "archive_reference_link", link);
    expect(await jobLinks(await grind(fresh))).toEqual([{ picture_id: picture, archived_at: null, source_link_id: link }]);
    expect(await jobLinks(await grind(await newJob()))).toEqual([]);
  });

  it("copies a library item's current pictures when importing", async () => {
    const item = await call<string>(owner, "create_library_item", JSON.stringify(QUICK_CHECK));
    const picture = await referencePicture();
    const link = await call<string>(owner, "attach_reference_picture", picture, "library_item", item);
    const job = await newJob({ claim: false });
    const step = await call<string>(owner, "import_library_step", job, await stage(job, "initial_prep"), 1, item);
    expect(await jobLinks(step)).toEqual([{ picture_id: picture, archived_at: null, source_link_id: link }]);
    await call(owner, "archive_reference_link", link);
    expect((await jobLinks(step))[0].archived_at).toBeNull();
  });

  it("adds job-specific pictures only to unfinished steps of jobs that aren't complete, with history", async () => {
    const job = await newJob();
    const [first, second] = await stageSteps(job, "initial_prep");
    await forceComplete(first.id);
    const picture = await referencePicture();
    await expect(call(owner, "attach_reference_picture", picture, "job_step", first.id)).rejects.toThrow(
      "This step is complete. Reference pictures can be added only to unfinished steps.",
    );
    const link = await call<string>(owner, "attach_reference_picture", picture, "job_step", second.id);
    expect(await history(job, "reference_picture_added")).toMatchObject([
      { actor_id: owner, details: { step_id: second.id, picture_id: picture } },
    ]);
    // Owner only.
    await expect(call(a, "attach_reference_picture", picture, "job_step", second.id)).rejects.toThrow(
      "Only an active owner can do this.",
    );
    await expect(call(a, "archive_reference_link", link)).rejects.toThrow("Only an active owner can do this.");
    await expect(as(db, { userId: a }, () => rows(`select * from public.create_reference_upload(1000, 'x.jpg')`))).rejects.toThrow(
      "Only an active owner can do this.",
    );

    // Once the step is complete, its pictures stay as they were.
    await forceComplete(second.id);
    await expect(call(owner, "archive_reference_link", link)).rejects.toThrow(
      "This step is complete, so its reference pictures stay as they were.",
    );
    await expect(rows(`update public.reference_picture_links set added_by = $2 where id = $1`, [link, a])).rejects.toThrow(
      "That change to a reference picture isn't allowed.",
    );
    await expect(rows(`delete from public.reference_picture_links where id = $1`, [link])).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it("can be reordered on an unfinished step", async () => {
    const job = await newJob();
    const [, second] = await stageSteps(job, "initial_prep");
    const p1 = await referencePicture();
    const p2 = await referencePicture();
    await call(owner, "attach_reference_picture", p1, "job_step", second.id);
    const l2 = await call<string>(owner, "attach_reference_picture", p2, "job_step", second.id);
    await call(owner, "move_reference_link", l2, -1);
    expect((await jobLinks(second.id)).map((l) => l.picture_id)).toEqual([p2, p1]);
  });

  it("are viewable only through the access check", async () => {
    const job = await newJob();
    const [, second] = await stageSteps(job, "initial_prep");
    const jobOnly = await referencePicture();
    await call(owner, "attach_reference_picture", jobOnly, "job_step", second.id);
    const item = await call<string>(owner, "create_library_item", JSON.stringify(QUICK_CHECK));
    const libraryOnly = await referencePicture();
    await call(owner, "attach_reference_picture", libraryOnly, "library_item", item);

    expect(await canView(jobOnly, owner)).toBe(true);
    expect(await canView(jobOnly, a)).toBe(true);
    expect(await canView(jobOnly, outsider)).toBe(false);
    expect(await canView(libraryOnly, owner)).toBe(true);
    expect(await canView(libraryOnly, a)).toBe(false);

    // Pending uploads and deactivated users never get a link.
    const [pending] = await as(db, { userId: owner }, () =>
      rows<{ picture_id: string }>(`select * from public.create_reference_upload(1000, 'x.jpg')`),
    );
    expect(await canView(pending.picture_id, owner)).toBe(false);
    await rows(`update public.profiles set active = false where id = $1`, [b]);
    expect(await canView(jobOnly, b)).toBe(false);
    await rows(`update public.profiles set active = true where id = $1`, [b]);

    // Object keys are never readable by signed-in users, and the check is server only.
    await expect(as(db, { userId: owner }, () => rows(`select object_key from public.reference_pictures`))).rejects.toThrow(
      /permission denied/,
    );
    await expect(as(db, { userId: owner }, () => rows(`select * from public.authorize_reference_view($1, $2)`, [jobOnly, owner]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("rejects uploads that don't match and never counts as proof records", async () => {
    const [row] = await as(db, { userId: owner }, () =>
      rows<{ picture_id: string; object_key: string }>(`select * from public.create_reference_upload(2000, 'x.jpg')`),
    );
    const [result] = await server("confirm_reference_upload", row.picture_id, owner, row.object_key, 1999, "image/jpeg");
    expect(result).toEqual({ confirm_reference_upload: "The uploaded file's size doesn't match." });
    await expect(call(owner, "attach_reference_picture", row.picture_id, "workflow_step", owner)).rejects.toThrow(
      "Finish uploading the picture first.",
    );
    expect(await rows(`select 1 from public.step_media where object_key like 'reference/%'`)).toEqual([]);
  });
});

describe("Owner/Working Member", () => {
  it("lets a joined owner work steps with full attribution while the lead stays the lead", async () => {
    const job = await newJob();
    const custom = await call<string>(owner, "add_custom_step", job, await stage(job, "initial_prep"), 1, JSON.stringify(QUICK_CHECK), false);

    // Not joined: view only.
    await expect(lease(owner, custom)).rejects.toThrow(/Join the job as a Working Owner/);

    expect(await call(owner, "join_job_as_working_owner", job)).toBe("joined");
    const l = await lease(owner, custom);
    await checkAll(owner, custom, l);
    await call(owner, "complete_step", custom, l, true);
    expect(
      await rows(`select completed_by, started_by from public.step_attempts where job_step_id = $1`, [custom]),
    ).toEqual([{ completed_by: owner, started_by: owner }]);
    expect((await history(job, "step_completed")).at(-1)).toMatchObject({ actor_id: owner });

    // The lead is unchanged and the owner never becomes an employee assignment.
    expect(
      await rows(`select employee_id, role from public.job_assignments where job_id = $1 and ended_at is null order by role`, [job]),
    ).toEqual([
      { employee_id: a, role: "lead" },
      { employee_id: b, role: "member" },
    ]);
    const [working] = await as(db, { userId: a }, () =>
      rows(`select owner_id from public.job_working_owner_status where job_id = $1`, [job]),
    );
    expect(working).toEqual({ owner_id: owner });
  });

  it("lets a joined owner upload proof", async () => {
    const job = await newJob();
    const custom = await call<string>(owner, "add_custom_step", job, await stage(job, "initial_prep"), 1, JSON.stringify(SAND_STAIRS), false);
    await call(owner, "join_job_as_working_owner", job);
    const l = await lease(owner, custom);
    const media = await uploadProof(owner, custom, l);
    expect(await rows(`select uploaded_by from public.step_media where id = $1`, [media])).toEqual([{ uploaded_by: owner }]);
  });

  it("rejects duplicate joins and joins on jobs that aren't in progress", async () => {
    const job = await newJob();
    await call(owner, "join_job_as_working_owner", job);
    expect(await call(owner, "join_job_as_working_owner", job)).toBe("already_joined");
    expect(await rows(`select 1 from public.job_working_owners where job_id = $1 and left_at is null`, [job])).toHaveLength(1);
    await expect(rows(`insert into public.job_working_owners (job_id, owner_id) values ($1, $2)`, [job, owner])).rejects.toThrow(
      /duplicate key/,
    );
    expect(await history(job, "owner_joined_working_team")).toHaveLength(1);

    const scheduled = await newJob({ claim: false });
    await expect(call(owner, "join_job_as_working_owner", scheduled)).rejects.toThrow(/in progress/);
    await expect(call(a, "join_job_as_working_owner", job)).rejects.toThrow("Only an active owner can do this.");
    // Owners never claim or join as employees.
    const available = await newJob({ claim: false });
    await call(owner, "make_job_available", available);
    await expect(call(owner, "claim_job", available)).rejects.toThrow(/Owners join a job as a Working Owner/);
  });

  it("leaves the working team without losing work or history, but not mid-edit", async () => {
    const job = await newJob();
    const custom = await call<string>(owner, "add_custom_step", job, await stage(job, "initial_prep"), 1, JSON.stringify(QUICK_CHECK), false);
    await call(owner, "join_job_as_working_owner", job);
    const l = await lease(owner, custom);
    await expect(call(owner, "leave_working_team", job)).rejects.toThrow(/Leave that step first/);
    await checkAll(owner, custom, l);
    await call(owner, "complete_step", custom, l, true);

    expect(await call(owner, "leave_working_team", job)).toBe("left");
    expect(await call(owner, "leave_working_team", job)).toBe("not_joined");
    expect(await rows(`select completed_by from public.step_attempts where job_step_id = $1`, [custom])).toEqual([
      { completed_by: owner },
    ]);
    expect(await history(job, "owner_left_working_team")).toHaveLength(1);
    const [next] = (await stageSteps(job, "initial_prep")).slice(1);
    await expect(lease(owner, next.id)).rejects.toThrow(/Join the job as a Working Owner/);
    // Rejoining starts a new membership row; the old one stays.
    await call(owner, "join_job_as_working_owner", job);
    expect(await rows(`select 1 from public.job_working_owners where job_id = $1`, [job])).toHaveLength(2);
    await expect(rows(`delete from public.job_working_owners where job_id = $1`, [job])).rejects.toThrow(/cannot be deleted/);
  });
});

describe("Working Owner on job-team displays", () => {
  const ownerRows = (viewer: string, job: string) =>
    as(db, { userId: viewer }, () =>
      rows(`select owner_id, full_name, owner_active from public.job_working_owner_status where job_id = $1`, [job]),
    );
  const teamRows = (viewer: string, job: string) =>
    as(db, { userId: viewer }, () =>
      rows(`select employee_id, role from public.job_team where job_id = $1 order by role`, [job]),
    );

  it("shows the joined owner to the owner, the team, and unassigned employees alike, with names only", async () => {
    const job = await newJob();
    await call(owner, "join_job_as_working_owner", job);
    const [{ full_name: name }] = await rows<{ full_name: string }>(`select full_name from public.profiles where id = $1`, [owner]);
    const expected = [{ owner_id: owner, full_name: name, owner_active: true }];
    for (const viewer of [owner, a, b, outsider]) {
      expect(await ownerRows(viewer, job)).toEqual(expected);
      // The employee lead stays the lead, and the owner is never an employee team row.
      expect(await teamRows(viewer, job)).toEqual([
        { employee_id: a, role: "lead" },
        { employee_id: b, role: "member" },
      ]);
    }
    const columns = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'job_working_owner_status'`,
    );
    expect(columns.map((c) => c.column_name).sort()).toEqual(["full_name", "job_id", "joined_at", "owner_active", "owner_id"]);
    expect(JSON.stringify(await ownerRows(outsider, job))).not.toMatch(/@/);
    await expect(as(db, "anon", () => rows(`select * from public.job_working_owner_status`))).rejects.toThrow(/permission denied/);
  });

  it("removes the active display when the owner leaves, keeping the membership history", async () => {
    const job = await newJob();
    await call(owner, "join_job_as_working_owner", job);
    await call(owner, "leave_working_team", job);
    expect(await ownerRows(a, job)).toEqual([]);
    expect(await ownerRows(owner, job)).toEqual([]);
    expect(
      await rows(`select owner_id, left_at is not null as ended from public.job_working_owners where job_id = $1`, [job]),
    ).toEqual([{ owner_id: owner, ended: true }]);
    expect((await history(job, "owner_joined_working_team")).length).toBe(1);
    expect((await history(job, "owner_left_working_team")).length).toBe(1);
  });

  it("marks a deactivated working owner, who can no longer work steps", async () => {
    const job = await newJob();
    const second = await createUser(db, { role: "owner" });
    await call(second, "join_job_as_working_owner", job);
    await rows(`update public.profiles set active = false where id = $1`, [second]);
    expect(await ownerRows(a, job)).toMatchObject([{ owner_id: second, owner_active: false }]);
    expect(await rows<{ w: boolean }>(`select public.is_job_worker($1, $2) as w`, [job, second])).toEqual([{ w: false }]);
  });
});

describe("reopening", () => {
  async function completedCustomStep(definition = SAND_STAIRS) {
    const job = await newJob();
    const step = await call<string>(owner, "add_custom_step", job, await stage(job, "initial_prep"), 1, JSON.stringify(definition), false);
    const l = await lease(a, step);
    await checkAll(a, step, l);
    const [treads] = await inputs(step);
    if (treads) await call(a, "save_step_input", step, l, treads.id, "12");
    const media = definition === SAND_STAIRS ? await uploadProof(a, step, l) : null;
    await call(a, "complete_step", step, l, true);
    return { job, step, media };
  }

  it("requires the owner and a reason, and records who, why, and when", async () => {
    const { job, step } = await completedCustomStep();
    await expect(call(owner, "reopen_step", step, "   ")).rejects.toThrow("Give a reason for reopening this step.");
    await expect(call(a, "reopen_step", step, "Missed a tread")).rejects.toThrow("Only an active owner can do this.");
    const reopening = await call<string>(owner, "reopen_step", step, "Missed a tread");
    const [row] = await rows<{ reason: string; reopened_by: string; reopened_at: Date }>(
      `select reason, reopened_by, reopened_at from public.step_reopenings where id = $1`,
      [reopening],
    );
    expect(row).toMatchObject({ reason: "Missed a tread", reopened_by: owner });
    expect(row.reopened_at).toBeInstanceOf(Date);
    expect(await history(job, "step_reopened")).toMatchObject([
      { actor_id: owner, details: { step_id: step, reason: "Missed a tread" } },
    ]);
    await expect(call(owner, "reopen_step", step, "Again")).rejects.toThrow("Only a completed step can be reopened.");
    await expect(rows(`update public.step_reopenings set reason = 'x' where id = $1`, [reopening])).rejects.toThrow(
      /part of job history/,
    );
  });

  it("keeps the earlier attempt, answers, and proof unchanged and viewable", async () => {
    const { step, media } = await completedCustomStep();
    const snapshot = () =>
      rows(
        `select a.id, a.attempt_number, a.completed_by, a.completed_at,
                (select count(*)::int from public.step_check_responses r where r.attempt_id = a.id and r.checked) as checks,
                (select count(*)::int from public.step_input_responses r where r.attempt_id = a.id) as inputs,
                (select count(*)::int from public.step_media m where m.attempt_id = a.id and m.status = 'uploaded') as proof
         from public.step_attempts a where a.job_step_id = $1 order by a.attempt_number`,
        [step],
      );
    const before = await snapshot();
    await call(owner, "reopen_step", step, "Redo the landing");
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(await rows(`select status from public.step_attempts where job_step_id = $1`, [step])).toEqual([
      { status: "superseded" },
    ]);
    await expect(rows(`update public.step_attempts set employee_notes = 'x' where job_step_id = $1`, [step])).rejects.toThrow(
      "Completed step work cannot be changed.",
    );
    expect(await server("authorize_media_view", media, a)).toHaveLength(1);
    expect(await state(step)).toBe("available");
  });

  it("starts a new attempt that needs fresh checks, entries, and proof", async () => {
    const { job, step } = await completedCustomStep();
    await call(owner, "reopen_step", step, "Redo it");
    const l = await lease(b, step);
    await expect(call(b, "complete_step", step, l, true)).rejects.toThrow("Check every Final check item first.");
    await checkAll(b, step, l);
    await expect(call(b, "complete_step", step, l, true)).rejects.toThrow(/required entry/);
    const [treads] = await inputs(step);
    await call(b, "save_step_input", step, l, treads.id, "14");
    await expect(call(b, "complete_step", step, l, true)).rejects.toThrow(/Add the required proof first/);
    await uploadProof(b, step, l);
    await call(b, "complete_step", step, l, true);
    expect(
      await rows(`select attempt_number, status, completed_by from public.step_attempts where job_step_id = $1 order by attempt_number`, [step]),
    ).toEqual([
      { attempt_number: 1, status: "superseded", completed_by: a },
      { attempt_number: 2, status: "completed", completed_by: b },
    ]);
    const [progress] = await as(db, { userId: owner }, () =>
      rows(`select reopened_step_title from public.job_progress where job_id = $1`, [job]),
    );
    expect(progress).toEqual({ reopened_step_title: null });
  });

  it("holds later work and the installation milestone until the step is done again, without moving the status back", async () => {
    const job = await newJob();
    await forceStage(job, "initial_prep");
    await walk(job, "initial_prep_in_progress", "waiting_for_base_coat_installation");
    const [first] = await stageSteps(job, "initial_prep");

    await call(owner, "reopen_step", first.id, "Grind again near the door");
    expect(await status(job)).toBe("waiting_for_base_coat_installation");
    await expect(call(owner, "mark_milestone_installed", job, "base_coat_installation")).rejects.toThrow(
      /A reopened step must be completed again first/,
    );
    const [progress] = await as(db, { userId: owner }, () =>
      rows(`select current_step_title, reopened_step_title from public.job_progress where job_id = $1`, [job]),
    );
    expect(progress).toEqual({ current_step_title: first.title, reopened_step_title: first.title });

    await forceComplete(first.id);
    expect(await call(owner, "mark_milestone_installed", job, "base_coat_installation")).toBe("installed");

    // Reopening a finished Initial Prep step after the milestone locks unstarted Top-Coat Prep work.
    const [topFirst] = await stageSteps(job, "top_coat_prep");
    expect(await state(topFirst.id)).toBe("available");
    await call(owner, "reopen_step", first.id, "Check again");
    expect(await state(topFirst.id)).toBe("locked");
    expect(await status(job)).toBe("base_coat_installed");
  });

  it("holds Completion Work and Mark Job Complete, and can reopen a Completion Work item", async () => {
    const job = await newJob();
    await forceStage(job, "initial_prep");
    await walk(job, "initial_prep_in_progress", "waiting_for_base_coat_installation");
    await call(owner, "mark_milestone_installed", job, "base_coat_installation");
    await forceStage(job, "top_coat_prep");
    await walk(job, "top_coat_prep_in_progress", "waiting_for_top_coat_installation");
    await call(owner, "mark_milestone_installed", job, "top_coat_installation");
    const [caulking] = await rows<{ id: string }>(`select id from public.job_steps where job_id = $1 and key = 'caulking_complete'`, [job]);
    await call(a, "complete_completion_item", caulking.id);
    const ready = async () =>
      (await as(db, { userId: owner }, () =>
        rows<{ r: boolean }>(`select ready_for_owner_completion as r from public.job_progress where job_id = $1`, [job]),
      ))[0].r;
    expect(await ready()).toBe(true);

    await call(owner, "reopen_step", caulking.id, "Bead is uneven");
    expect(await state(caulking.id)).toBe("available");
    expect(await ready()).toBe(false);
    await call(b, "complete_completion_item", caulking.id);
    expect(await ready()).toBe(true);

    const [prep] = await stageSteps(job, "top_coat_prep");
    await call(owner, "reopen_step", prep.id, "Scrape again");
    expect(await ready()).toBe(false);
    await expect(call(owner, "mark_job_complete", job)).rejects.toThrow(`Not done yet: ${prep.title}`);
    expect(await status(job)).toBe("completion_work_in_progress");

    await forceComplete(prep.id);
    await call(owner, "mark_job_complete", job);
    await expect(call(owner, "reopen_step", prep.id, "Too late")).rejects.toThrow(
      "A complete job is read only, so its steps can't be reopened.",
    );
    const job2 = await newJob({ claim: false });
    await expect(
      call(owner, "add_custom_step", job, await stage(job, "top_coat_prep"), 99, JSON.stringify(QUICK_CHECK), false),
    ).rejects.toThrow(/complete job/);
    expect(job2).toBeTruthy();
  });
});
