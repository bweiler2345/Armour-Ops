import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser } from "@/test/database";

// Runs every migration in an in-process Postgres and checks the proof rules:
// who may upload, limits, proof counts, server verification, completion,
// viewing, immutability, abandoned uploads, and retention. R2 itself is not
// involved here; the server's R2 checks are passed in as the server would.

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

const call = (userId: string, fn: string, ...args: unknown[]) =>
  as(db, { userId }, () =>
    rows<Record<string, unknown>>(
      `select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`,
      args,
    ),
  );

// Calls a secret-key-only function as the server does.
const server = (fn: string, ...args: unknown[]) =>
  as(db, "service_role", () =>
    rows<Record<string, unknown>>(
      `select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`,
      args,
    ),
  );

async function teamJob() {
  const [{ id }] = await as(db, { userId: owner }, () =>
    rows<{ id: string }>(
      `select public.create_job('Sample Client', '1 Sample Road', 500, 'Sample', '2026-10-20') as id`,
    ),
  );
  await as(db, { userId: owner }, () => rows(`select public.make_job_available($1)`, [id]));
  await as(db, { userId: a }, () => rows(`select public.claim_job($1)`, [id]));
  await as(db, { userId: b }, () => rows(`select public.join_job($1)`, [id]));
  return id;
}

async function step(jobId: string, key: string, stage = "initial_prep") {
  const [row] = await rows<{ id: string }>(
    `select s.id from public.job_steps s join public.job_stages st on st.id = s.job_stage_id
     where s.job_id = $1 and st.key = $2 and s.key = $3`,
    [jobId, stage, key],
  );
  return row.id;
}

async function requirements(stepId: string) {
  return rows<{ id: string; label: string; media_type: string; allow_multiple: boolean }>(
    `select id, label, media_type, allow_multiple from public.job_step_proof_requirements
     where job_step_id = $1 order by position`,
    [stepId],
  );
}

// Test-database fixture: earlier steps complete without their media.
async function forceComplete(stepId: string) {
  await rows(
    `insert into public.step_attempts
       (job_id, job_step_id, attempt_number, status, started_by, completed_by, completed_at, confirmation_text_shown)
     select job_id, id, 1, 'completed', $2, $2, now(), confirmation_text from public.job_steps where id = $1`,
    [stepId, a],
  );
}

async function lease(userId: string, stepId: string) {
  const [row] = await call(userId, "acquire_step_edit", stepId);
  return row.lease_id as string;
}

type Upload = {
  requirement: string;
  type?: "picture" | "video";
  contentType?: string;
  size?: number;
  original?: number | null;
  duration?: number | null;
};

async function startUpload(userId: string, stepId: string, leaseId: string, u: Upload) {
  const type = u.type ?? "picture";
  const [row] = await call(
    userId,
    "create_media_upload",
    stepId,
    leaseId,
    u.requirement,
    type,
    u.contentType ?? (type === "picture" ? "image/jpeg" : "video/quicktime"),
    u.size ?? (type === "picture" ? 1_500_000 : 90_000_000),
    u.original === undefined ? (type === "picture" ? 4_000_000 : null) : u.original,
    u.duration === undefined ? (type === "video" ? 95.5 : null) : u.duration,
    type === "picture" ? "IMG_0001.HEIC" : "IMG_0002.MOV",
    1_790_000_000_000,
  );
  return row as {
    media_id: string;
    object_key: string;
    upload_method: string;
    part_size: number | null;
    authorization_expires_at: Date;
  };
}

// The server checked R2 and found this object.
async function confirm(media: string, actor: string, leaseId: string, overrides: Partial<{ key: string; size: number; type: string }> = {}) {
  const [row] = await rows<Record<string, string>>(
    `select object_key, declared_size_bytes, content_type from public.step_media where id = $1`,
    [media],
  );
  const [result] = await server(
    "confirm_media_upload",
    media,
    actor,
    leaseId,
    overrides.key ?? row.object_key,
    overrides.size ?? Number(row.declared_size_bytes),
    overrides.type ?? row.content_type,
  );
  return result.confirm_media_upload as string;
}

async function checkAll(stepId: string, userId: string, leaseId: string) {
  const items = await rows<{ id: string }>(
    `select i.id from public.job_step_block_items i join public.job_step_blocks b on b.id = i.job_block_id
     where b.job_step_id = $1 and b.kind = 'checklist'`,
    [stepId],
  );
  for (const item of items) await call(userId, "save_step_check", stepId, leaseId, item.id, true);
}

async function mediaStatus(media: string) {
  const [row] = await rows<{ status: string }>(`select status from public.step_media where id = $1`, [media]);
  return row.status;
}

describe("starting uploads", () => {
  it("approves an authorized picture with a scoped, non-guessable key", async () => {
    const job = await teamJob();
    await forceComplete(await step(job, "grind_floor"));
    await forceComplete(await step(job, "vacuum_floor"));
    const patch = await step(job, "patchwork");
    const [req] = await requirements(patch);
    const l = await lease(a, patch);
    const up = await startUpload(a, patch, l, { requirement: req.id });

    const [attempt] = await rows<{ id: string }>(
      `select id from public.step_attempts where job_step_id = $1 and status = 'draft'`,
      [patch],
    );
    expect(up.upload_method).toBe("single");
    expect(up.object_key).toMatch(
      new RegExp(`^jobs/${job}/steps/${patch}/${attempt.id}/${up.media_id}-[0-9a-f]{32}\\.jpg$`),
    );
    expect(await mediaStatus(up.media_id)).toBe("pending");
    const [row] = await rows<Record<string, unknown>>(
      `select uploaded_by, original_size_bytes, created_at, authorization_expires_at > now() + interval '23 hours' as long
       from public.step_media where id = $1`,
      [up.media_id],
    );
    expect(row).toMatchObject({ uploaded_by: a, original_size_bytes: 4000000, long: true });
  });

  it("approves an authorized multipart video and records the R2 upload id", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    const up = await startUpload(a, grind, l, { requirement: req.id, type: "video" });
    expect(up.upload_method).toBe("multipart");
    expect(up.part_size).toBe(10_485_760);
    expect(up.object_key).toMatch(/\.mov$/);

    await server("set_media_multipart", up.media_id, a, l, "r2-upload-123");
    await expect(server("set_media_multipart", up.media_id, a, l, "r2-other")).rejects.toThrow(/already started/);

    // Resume after a reload: the server can look the upload up again.
    const [details] = await server("media_upload_details", up.media_id, a, l);
    expect(details).toMatchObject({
      object_key: up.object_key,
      r2_upload_id: "r2-upload-123",
      declared_size_bytes: 90000000,
      original_file_name: "IMG_0002.MOV",
    });
    expect(await confirm(up.media_id, a, l)).toBe("uploaded");
  });

  it("rejects unsupported types and the wrong media for a requirement", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    await expect(startUpload(a, grind, l, { requirement: req.id, type: "picture" })).rejects.toThrow(
      /This proof needs a video/,
    );
    await expect(
      startUpload(a, grind, l, { requirement: req.id, type: "video", contentType: "video/x-msvideo" }),
    ).rejects.toThrow(/MOV or MP4/);
  });

  it("enforces the picture limits", async () => {
    const job = await teamJob();
    await forceComplete(await step(job, "grind_floor"));
    await forceComplete(await step(job, "vacuum_floor"));
    const patch = await step(job, "patchwork");
    const [req] = await requirements(patch);
    const l = await lease(a, patch);
    await expect(startUpload(a, patch, l, { requirement: req.id, contentType: "image/png" })).rejects.toThrow(
      /prepared as JPEG/,
    );
    await expect(startUpload(a, patch, l, { requirement: req.id, original: 26_214_401 })).rejects.toThrow(
      /larger than 25 MB/,
    );
    await expect(startUpload(a, patch, l, { requirement: req.id, size: 5_242_881 })).rejects.toThrow(
      /larger than 5 MB after preparing/,
    );
    await startUpload(a, patch, l, { requirement: req.id, size: 5_242_880, original: 26_214_400 });
  });

  it("enforces the video limits", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    await expect(
      startUpload(a, grind, l, { requirement: req.id, type: "video", size: 314_572_801 }),
    ).rejects.toThrow(/larger than 300 MB/);
    await expect(
      startUpload(a, grind, l, { requirement: req.id, type: "video", duration: 180.5 }),
    ).rejects.toThrow(/longer than 3 minutes/);
    await expect(
      startUpload(a, grind, l, { requirement: req.id, type: "video", duration: null }),
    ).rejects.toThrow(/longer than 3 minutes/);
    await startUpload(a, grind, l, { requirement: req.id, type: "video", size: 314_572_800, duration: 180 });
  });

  it("rejects a requirement from another step", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [other] = await requirements(await step(job, "patchwork"));
    const l = await lease(a, grind);
    await expect(startUpload(a, grind, l, { requirement: other.id })).rejects.toThrow(/isn't part of this step/);
  });
});

describe("who may upload", () => {
  it("refuses unassigned employees, owners, and deactivated employees", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const fake = "00000000-0000-4000-8000-000000000000";
    await expect(startUpload(outsider, grind, fake, { requirement: req.id, type: "video" })).rejects.toThrow(
      /Only employees on this job/,
    );
    await expect(startUpload(owner, grind, fake, { requirement: req.id, type: "video" })).rejects.toThrow(
      /Join the job as a Working Owner/,
    );
    const former = await createUser(db, { role: "employee" });
    await as(db, { userId: owner }, () => rows(`select public.add_team_member($1, $2)`, [job, former]));
    const l = await lease(former, grind);
    await db.query(`update public.profiles set active = false where id = $1`, [former]);
    await expect(startUpload(former, grind, l, { requirement: req.id, type: "video" })).rejects.toThrow(
      /Only an active employee/,
    );
  });

  it("requires the current lease: a teammate, a cleared lease, and an old lease are refused", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    await expect(startUpload(b, grind, l, { requirement: req.id, type: "video" })).rejects.toThrow(
      /Someone else is editing/,
    );
    const up = await startUpload(a, grind, l, { requirement: req.id, type: "video" });

    await as(db, { userId: owner }, () => rows(`select public.clear_step_edit($1)`, [grind]));
    await expect(startUpload(a, grind, l, { requirement: req.id, type: "video" })).rejects.toThrow(
      /owner ended your editing session/,
    );
    // The server can't finish or sign for the old lease either.
    await expect(server("media_upload_details", up.media_id, a, l)).rejects.toThrow(/owner ended/);
    await expect(confirm(up.media_id, a, l)).rejects.toThrow(/owner ended/);
    await expect(server("set_media_multipart", up.media_id, a, l, "x")).rejects.toThrow(/owner ended/);
    await expect(call(a, "discard_media", up.media_id, l)).rejects.toThrow(/owner ended/);

    // A new lease works; the old one stays refused.
    const fresh = await lease(a, grind);
    expect(await confirm(up.media_id, a, fresh)).toBe("uploaded");
    await expect(confirm(up.media_id, a, l)).rejects.toThrow();
  });
});

describe("server verification", () => {
  async function pendingPicture() {
    const job = await teamJob();
    await forceComplete(await step(job, "grind_floor"));
    await forceComplete(await step(job, "vacuum_floor"));
    const patch = await step(job, "patchwork");
    const [req] = await requirements(patch);
    const l = await lease(a, patch);
    const up = await startUpload(a, patch, l, { requirement: req.id });
    return { job, patch, l, up };
  }

  it("fails an object with the wrong key, size, or type", async () => {
    for (const bad of [{ key: "jobs/other/object.jpg" }, { size: 1_500_001 }, { type: "image/png" }]) {
      const { l, up } = await pendingPicture();
      const reason = await confirm(up.media_id, a, l, bad);
      expect(reason).not.toBe("uploaded");
      expect(await mediaStatus(up.media_id)).toBe("failed");
    }
  });

  it("accepts a content type with parameters, like image/jpeg; charset", async () => {
    const { l, up } = await pendingPicture();
    expect(await confirm(up.media_id, a, l, { type: "image/jpeg; qs=1" })).toBe("uploaded");
  });

  it("only lets the uploader finish, and only once", async () => {
    const { patch, l, up } = await pendingPicture();
    await call(a, "release_step_edit", patch, l);
    const bLease = await lease(b, patch);
    await expect(confirm(up.media_id, b, bLease)).rejects.toThrow(/Only the person who started this upload/);
    await call(b, "release_step_edit", patch, bLease);
    const aLease = await lease(a, patch);
    expect(await confirm(up.media_id, a, aLease)).toBe("uploaded");
    await expect(confirm(up.media_id, a, aLease)).rejects.toThrow(/no longer in progress/);
  });

  it("refuses an upload whose authorization expired", async () => {
    const { l, up } = await pendingPicture();
    await expireUpload(up.media_id);
    await expect(confirm(up.media_id, a, l)).rejects.toThrow(/authorization expired/);
  });

  it("records a proof_uploaded history entry", async () => {
    const { job, l, up } = await pendingPicture();
    await confirm(up.media_id, a, l);
    const [entry] = await rows<{ actor_id: string; details: Record<string, unknown> }>(
      `select actor_id, details from public.job_activity where job_id = $1 and activity_type = 'proof_uploaded'`,
      [job],
    );
    expect(entry.actor_id).toBe(a);
    expect(entry.details).toMatchObject({ media_id: up.media_id, media_type: "picture" });
  });
});

// Test fixture: move an upload's authorization window into the past.
async function expireUpload(media: string) {
  await db.exec(`alter table public.step_media disable trigger step_media_guard`);
  await db.query(
    `update public.step_media set created_at = now() - interval '2 days',
       authorization_expires_at = now() - interval '1 second' where id = $1`,
    [media],
  );
  await db.exec(`alter table public.step_media enable trigger step_media_guard`);
}

describe("proof counts and completion", () => {
  it("blocks completion until the required video is verified", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    await checkAll(grind, a, l);

    await expect(call(a, "complete_step", grind, l, true)).rejects.toThrow(
      /Missing: Upload one slow video showing the entire floor/,
    );
    const up = await startUpload(a, grind, l, { requirement: req.id, type: "video" });
    await expect(call(a, "complete_step", grind, l, true)).rejects.toThrow(/Wait for every upload to finish/);
    await confirm(up.media_id, a, l);
    await call(a, "complete_step", grind, l, true);
    const [done] = await rows<{ status: string }>(
      `select status from public.step_attempts where job_step_id = $1`,
      [grind],
    );
    expect(done.status).toBe("completed");
  });

  it("allows one file for single proofs and many for 'each' proofs, then completes", async () => {
    const job = await teamJob();
    const prep = await rows<{ id: string; key: string }>(
      `select s.id, s.key from public.job_steps s join public.job_stages st on st.id = s.job_stage_id
       where s.job_id = $1 and st.key = 'initial_prep' and s.key <> 'set_up_for_base_coat_installation'`,
      [job],
    );
    for (const s of prep) await forceComplete(s.id);
    const setup = await step(job, "set_up_for_base_coat_installation");
    const [mixing, tools, drains] = await requirements(setup);
    expect([mixing.allow_multiple, tools.allow_multiple, drains.allow_multiple]).toEqual([false, false, true]);

    const l = await lease(a, setup);
    await checkAll(setup, a, l);
    const m1 = await startUpload(a, setup, l, { requirement: mixing.id });
    await expect(startUpload(a, setup, l, { requirement: mixing.id })).rejects.toThrow(/already has a file/);
    await confirm(m1.media_id, a, l);
    await expect(startUpload(a, setup, l, { requirement: mixing.id })).rejects.toThrow(/already has a file/);

    // Removing it frees the slot; a replacement is allowed before completion.
    await call(a, "discard_media", m1.media_id, l);
    const m2 = await startUpload(a, setup, l, { requirement: mixing.id });
    await confirm(m2.media_id, a, l);

    const t = await startUpload(a, setup, l, { requirement: tools.id });
    await confirm(t.media_id, a, l);

    // Missing the drains picture still blocks completion.
    await expect(call(a, "complete_step", setup, l, true)).rejects.toThrow(
      /Missing: One picture showing each protected drain/,
    );
    for (let i = 0; i < 3; i++) {
      const d = await startUpload(a, setup, l, { requirement: drains.id });
      await confirm(d.media_id, a, l);
    }
    await call(a, "complete_step", setup, l, true);
    expect(
      await rows(
        `select count(*)::int as n from public.step_media where job_step_id = $1 and status = 'uploaded'`,
        [setup],
      ),
    ).toEqual([{ n: 5 }]);
  });

  it("caps a multiple-file proof at 20 files", async () => {
    const job = await teamJob();
    await forceComplete(await step(job, "grind_floor"));
    await forceComplete(await step(job, "vacuum_floor"));
    const patch = await step(job, "patchwork");
    const [req] = await requirements(patch);
    const l = await lease(a, patch);
    for (let i = 0; i < 20; i++) await startUpload(a, patch, l, { requirement: req.id });
    await expect(startUpload(a, patch, l, { requirement: req.id })).rejects.toThrow(/most files allowed \(20\)/);
  });

  it("does not count failed or abandoned uploads as proof", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    await checkAll(grind, a, l);
    const up = await startUpload(a, grind, l, { requirement: req.id, type: "video" });
    await confirm(up.media_id, a, l, { size: 1 });
    await expect(call(a, "complete_step", grind, l, true)).rejects.toThrow(/Missing: Upload one slow video/);
  });
});

describe("viewing", () => {
  it("authorizes the owner and assigned employees only, and only for verified files", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    const up = await startUpload(a, grind, l, { requirement: req.id, type: "video" });

    // Nothing to view until verified.
    expect(await server("authorize_media_view", up.media_id, owner)).toEqual([]);
    await confirm(up.media_id, a, l);

    for (const viewer of [owner, a, b]) {
      const [row] = await server("authorize_media_view", up.media_id, viewer);
      expect(row, viewer).toMatchObject({ object_key: expect.stringMatching(/^jobs\//), media_type: "video" });
    }
    expect(await server("authorize_media_view", up.media_id, outsider)).toEqual([]);

    // A removed team member and a deactivated owner lose access.
    await call(a, "release_step_edit", grind, l);
    await as(db, { userId: owner }, () => rows(`select public.remove_team_member($1, $2, null)`, [job, b]));
    expect(await server("authorize_media_view", up.media_id, b)).toEqual([]);
    const formerOwner = await createUser(db, { role: "owner", active: false });
    expect(await server("authorize_media_view", up.media_id, formerOwner)).toEqual([]);
  });

  it("hides proof records from unassigned employees and object keys from everyone signed in", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    const up = await startUpload(a, grind, l, { requirement: req.id, type: "video" });

    const seenByOutsider = await as(db, { userId: outsider }, () =>
      rows(`select id from public.step_media where id = $1`, [up.media_id]),
    );
    expect(seenByOutsider).toEqual([]);
    const seenByTeam = await as(db, { userId: b }, () =>
      rows(`select id, status from public.step_media where id = $1`, [up.media_id]),
    );
    expect(seenByTeam).toEqual([{ id: up.media_id, status: "pending" }]);
    for (const userId of [a, owner]) {
      await expect(
        as(db, { userId }, () => rows(`select object_key from public.step_media`)),
      ).rejects.toThrow(/permission denied/);
      await expect(
        as(db, { userId }, () => rows(`select r2_upload_id from public.step_media`)),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("keeps the server-only functions away from signed-in users", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    const up = await startUpload(a, grind, l, { requirement: req.id, type: "video" });
    for (const [fn, args] of [
      ["confirm_media_upload", [up.media_id, a, l, up.object_key, 90_000_000, "video/quicktime"]],
      ["set_media_multipart", [up.media_id, a, l, "x"]],
      ["media_upload_details", [up.media_id, a, l]],
      ["authorize_media_view", [up.media_id, a]],
      ["fail_media_upload", [up.media_id, a, l, "x"]],
      ["expire_abandoned_media", []],
    ] as const) {
      await expect(call(a, fn, ...args), fn).rejects.toThrow(/permission denied/);
    }
    await expect(
      as(db, { userId: a }, () =>
        rows(`update public.step_media set status = 'uploaded' where id = $1`, [up.media_id]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, { userId: a }, () => rows(`delete from public.step_media where id = $1`, [up.media_id])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("history protection", () => {
  it("never changes or removes proof on a completed attempt", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    await checkAll(grind, a, l);
    const up = await startUpload(a, grind, l, { requirement: req.id, type: "video" });
    await confirm(up.media_id, a, l);
    await call(a, "complete_step", grind, l, true);

    await expect(call(a, "discard_media", up.media_id, l)).rejects.toThrow();
    await expect(rows(`update public.step_media set status = 'discarded', discarded_at = now(), discarded_by = $2 where id = $1`, [up.media_id, a])).rejects.toThrow(
      /completed step cannot be changed/,
    );
    await expect(rows(`delete from public.step_media where id = $1`, [up.media_id])).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(rows(`update public.step_media set object_key = 'x' where id = $1`, [up.media_id])).rejects.toThrow(
      /details cannot change/,
    );
  });

  it("lets the editor remove an uploaded proof before completion, with history", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    const up = await startUpload(a, grind, l, { requirement: req.id, type: "video" });
    await confirm(up.media_id, a, l);
    await expect(call(b, "discard_media", up.media_id, l)).rejects.toThrow(/Someone else is editing/);
    await call(a, "discard_media", up.media_id, l);
    expect(await mediaStatus(up.media_id)).toBe("discarded");
    const [entry] = await rows<{ actor_id: string }>(
      `select actor_id from public.job_activity where job_id = $1 and activity_type = 'proof_removed'`,
      [job],
    );
    expect(entry.actor_id).toBe(a);
  });
});

describe("abandoned uploads and retention", () => {
  it("marks expired pending uploads failed and returns what to clean up in R2", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    const up = await startUpload(a, grind, l, { requirement: req.id, type: "video" });
    await server("set_media_multipart", up.media_id, a, l, "r2-abandoned");

    const mine = (result: Record<string, unknown>[]) => result.filter((r) => r.media_id === up.media_id);
    expect(mine(await server("expire_abandoned_media"))).toEqual([]);
    await expireUpload(up.media_id);
    const cleaned = await server("expire_abandoned_media");
    expect(mine(cleaned)).toEqual([{ media_id: up.media_id, object_key: up.object_key, r2_upload_id: "r2-abandoned" }]);
    expect(await mediaStatus(up.media_id)).toBe("failed");
    // An abandoned upload no longer blocks adding the proof again.
    await startUpload(a, grind, l, { requirement: req.id, type: "video" });
  });

  it("keeps completed proof until five years after job completion", async () => {
    const job = await teamJob();
    const grind = await step(job, "grind_floor");
    const [req] = await requirements(grind);
    const l = await lease(a, grind);
    await checkAll(grind, a, l);
    const up = await startUpload(a, grind, l, { requirement: req.id, type: "video" });
    await confirm(up.media_id, a, l);
    await call(a, "complete_step", grind, l, true);

    expect(await server("media_due_for_retention_cleanup")).toEqual([]);
    await expect(server("mark_media_deleted", up.media_id)).rejects.toThrow(/completed step cannot be changed|isn't due/);

    // Test-database fixture: the job was completed more than five years ago
    // (mark_job_complete sets these; triggers are skipped to backdate them).
    await db.exec("set session_replication_role = replica");
    await db.query(
      `update public.jobs set status = 'complete', completed_by = $2,
         completed_at = now() - interval '5 years 1 day', media_delete_after = now() - interval '1 day'
       where id = $1`,
      [job, owner],
    );
    await db.exec("set session_replication_role = origin");
    const due = await server("media_due_for_retention_cleanup");
    expect(due).toEqual([{ media_id: up.media_id, object_key: up.object_key }]);
    await server("mark_media_deleted", up.media_id);
    expect(await mediaStatus(up.media_id)).toBe("deleted");
  });
});
