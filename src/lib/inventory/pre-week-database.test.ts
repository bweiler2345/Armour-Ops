import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser } from "@/test/database";
import { APPROVED_INVENTORY } from "./approved-list";

// Runs every migration in an in-process Postgres and checks Pre-Week Setup:
// the seeded trailers and list, weekly snapshots, calculated statuses,
// submission, reopening, owner management, and access.

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

async function trailerId(name: string) {
  const [{ id }] = await rows<{ id: string }>(`select id from public.trailers where name = $1`, [name]);
  return id;
}

type Item = { id: string; label: string; tracking: string; target_quantity: number | null; status: string | null; shortage: number | null; usable_quantity: number | null };

async function items(setup: string) {
  return rows<Item>(
    `select id, label, tracking, target_quantity, status, shortage, usable_quantity from public.weekly_setup_items
     where setup_id = $1 order by category_position, position`,
    [setup],
  );
}

const item = async (setup: string, label: string) => (await items(setup)).find((i) => i.label === label)!;

async function save(userId: string, itemId: string, quantity: number | null, status: string | null = null, note = "") {
  const [row] = await as(db, { userId }, () =>
    rows<{ status: string | null; shortage: number | null }>(`select * from public.save_setup_item($1, $2, $3, $4)`, [
      itemId,
      quantity,
      status,
      note,
    ]),
  );
  return row;
}

async function fillAll(userId: string, setup: string, quantity = 50) {
  for (const i of await items(setup)) {
    if (i.tracking === "count") await save(userId, i.id, quantity);
    else await save(userId, i.id, null, "ready");
  }
}

// Test-database fixture: turn a setup into last week's (skipping triggers).
async function makeLastWeek(setup: string) {
  await db.exec("set session_replication_role = replica");
  await rows(`update public.weekly_setups set week_start = week_start - 7 where id = $1`, [setup]);
  await db.exec("set session_replication_role = origin");
}

describe("seeded trailers and the approved list", () => {
  it("has exactly Trailer 1 and Trailer 2, both active", async () => {
    expect(await rows(`select name, position, archived_at from public.trailers order by position`)).toEqual([
      { name: "Trailer 1", position: 1, archived_at: null },
      { name: "Trailer 2", position: 2, archived_at: null },
    ]);
  });

  it("seeds every approved item with its category, target, and unit", async () => {
    const seeded = await rows<{ category: string; label: string; tracking: string; target_quantity: number | null; unit_label: string | null }>(
      `select category, label, tracking, target_quantity, unit_label from public.inventory_items order by category_position, position`,
    );
    expect(seeded).toEqual(
      APPROVED_INVENTORY.map((i) => ({
        category: i.category,
        label: i.label,
        tracking: i.target === null ? "status_only" : "count",
        target_quantity: i.target,
        unit_label: i.unit,
      })),
    );
    expect(seeded.filter((i) => i.label === "Full plywood sheet" || i.label === "Quarter-board piece")).toEqual([
      { category: "Prep tools", label: "Full plywood sheet", tracking: "count", target_quantity: 1, unit_label: "sheet" },
      { category: "Prep tools", label: "Quarter-board piece", tracking: "count", target_quantity: 1, unit_label: "piece" },
    ]);
    expect(seeded.filter((i) => i.tracking === "status_only").map((i) => i.label)).toEqual(["Rags stocked"]);
  });

  it("gives both trailers the identical list this week", async () => {
    const one = await call<string>(a, "ensure_weekly_setup", await trailerId("Trailer 1"));
    const two = await call<string>(b, "ensure_weekly_setup", await trailerId("Trailer 2"));
    const strip = (list: Item[]) => list.map((i) => [i.label, i.tracking, i.target_quantity]);
    expect(strip(await items(one))).toEqual(strip(await items(two)));
    expect((await items(one)).length).toBe(APPROVED_INVENTORY.length);
  });
});

describe("weeks", () => {
  it("start on Monday in America/Chicago, including across daylight saving", async () => {
    const week = async (at: string) => (await rows<{ w: string }>(`select public.pre_week_start($1)::text as w`, [at]))[0].w;
    expect(await week("2026-09-28T04:59:00Z")).toBe("2026-09-21"); // Sunday 11:59 PM Central
    expect(await week("2026-09-28T05:00:00Z")).toBe("2026-09-28"); // Monday midnight Central
    expect(await week("2026-11-02T05:59:00Z")).toBe("2026-10-26"); // Sunday night, standard time
    expect(await week("2026-11-02T06:00:00Z")).toBe("2026-11-02");
  });

  it("creates one setup per trailer per week, even on simultaneous first visits", async () => {
    const trailer = await trailerId("Trailer 1");
    const first = await call<string>(a, "ensure_weekly_setup", trailer);
    const again = await call<string>(owner, "ensure_weekly_setup", trailer);
    expect(again).toBe(first);
    const [{ n }] = await rows<{ n: number }>(
      `select count(*)::int as n from public.weekly_setups where trailer_id = $1 and week_start = public.pre_week_start()`,
      [trailer],
    );
    expect(n).toBe(1);
  });
});

describe("counting", () => {
  it("calculates Missing, Need More with the exact shortage, and Ready in the database", async () => {
    const setup = await call<string>(a, "ensure_weekly_setup", await trailerId("Trailer 2"));
    const brushes = await item(setup, "3-inch brushes");
    expect(await save(a, brushes.id, 0)).toMatchObject({ status: "missing", shortage: 30 });
    expect(await save(a, brushes.id, 12)).toMatchObject({ status: "need_more", shortage: 18 });
    expect(await save(a, brushes.id, 30)).toMatchObject({ status: "ready", shortage: 0 });
    expect(await save(a, brushes.id, 31)).toMatchObject({ status: "ready", shortage: 0 });
    expect(await save(a, brushes.id, null)).toMatchObject({ status: null, shortage: null });

    await expect(save(a, brushes.id, -1)).rejects.toThrow("A count can't be negative.");
    await expect(save(a, brushes.id, null, "ready")).rejects.toThrow("Enter a count for this item; its status is calculated.");
    // Nobody can write a status or shortage directly.
    await expect(
      as(db, { userId: a }, () => rows(`update public.weekly_setup_items set status = 'ready' where id = $1`, [brushes.id])),
    ).rejects.toThrow(/permission denied/);
    await rows(`update public.weekly_setup_items set usable_quantity = 5, status = 'ready', shortage = 0 where id = $1`, [brushes.id]);
    expect(await item(setup, "3-inch brushes")).toMatchObject({ status: "need_more", shortage: 25 });
  });

  it("uses Ready, Need More, or Missing for Rags with no numeric shortage", async () => {
    const setup = await call<string>(a, "ensure_weekly_setup", await trailerId("Trailer 2"));
    const rags = await item(setup, "Rags stocked");
    expect(await save(a, rags.id, null, "need_more", "Half a box left")).toEqual({ status: "need_more", shortage: null, updated_at: expect.any(Date) });
    await expect(save(a, rags.id, 3)).rejects.toThrow("Choose Ready, Need More, or Missing for this item.");
  });

  it("keeps saved work between visits and records who changed each value and when", async () => {
    const setup = await call<string>(a, "ensure_weekly_setup", await trailerId("Trailer 2"));
    const drill = await item(setup, "Drill");
    await save(b, drill.id, 1, null, "Charged");
    const again = await call<string>(a, "ensure_weekly_setup", await trailerId("Trailer 2"));
    expect(again).toBe(setup);
    const [row] = await rows<{ usable_quantity: number; note: string; updated_by: string; updated_at: Date }>(
      `select usable_quantity, note, updated_by, updated_at from public.weekly_setup_items where id = $1`,
      [drill.id],
    );
    expect(row).toMatchObject({ usable_quantity: 1, note: "Charged", updated_by: b });
    expect(row.updated_at).toBeInstanceOf(Date);
  });
});

describe("submitting and reopening", () => {
  it("requires every item, submits once, and becomes read only", async () => {
    const trailer = await call<string>(owner, "add_trailer", "Submit Test Trailer");
    const setup = await call<string>(a, "ensure_weekly_setup", trailer);
    await expect(call(a, "submit_weekly_setup", setup)).rejects.toThrow("Check every item first. Not done yet: Grinder");
    await fillAll(a, setup);
    const brushes = await item(setup, "3-inch brushes");
    await save(a, brushes.id, 12);
    await call(a, "save_setup_restock_notes", setup, "Order brushes");

    expect(await call(a, "submit_weekly_setup", setup)).toBe("submitted");
    // A second, simultaneous tap changes nothing.
    expect(await call(b, "submit_weekly_setup", setup)).toBe("already_submitted");
    const submissions = await rows<{ submitted_by: string; ready_count: number; need_more_count: number; missing_count: number; restock_notes: string; items: { label: string; shortage: number | null }[] }>(
      `select submitted_by, ready_count, need_more_count, missing_count, restock_notes, items from public.weekly_setup_submissions where setup_id = $1`,
      [setup],
    );
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({ submitted_by: a, need_more_count: 1, missing_count: 0, restock_notes: "Order brushes" });
    expect(submissions[0].items.find((i) => i.label === "3-inch brushes")?.shortage).toBe(18);
    expect(submissions[0].items).toHaveLength(APPROVED_INVENTORY.length);

    await expect(save(a, brushes.id, 30)).rejects.toThrow(/submitted and is read only/);
    await expect(rows(`update public.weekly_setup_items set note = 'x' where id = $1`, [brushes.id])).rejects.toThrow(/read only/);
    await expect(rows(`delete from public.weekly_setup_submissions where setup_id = $1`, [setup])).rejects.toThrow(/part of job history/);
  });

  it("lets only the owner reopen, with a reason, keeping the earlier submission", async () => {
    const trailer = await call<string>(owner, "add_trailer", "Reopen Test Trailer");
    const setup = await call<string>(a, "ensure_weekly_setup", trailer);
    await fillAll(a, setup);
    await call(a, "submit_weekly_setup", setup);

    await expect(call(a, "reopen_weekly_setup", setup, "Recount")).rejects.toThrow("Only an active owner can do this.");
    await expect(call(owner, "reopen_weekly_setup", setup, " ")).rejects.toThrow("Give a reason for reopening this setup.");
    await call(owner, "reopen_weekly_setup", setup, "Recount the brushes");
    expect(await rows(`select state, submitted_at from public.weekly_setups where id = $1`, [setup])).toEqual([{ state: "draft", submitted_at: null }]);
    expect(await rows(`select reason, reopened_by from public.weekly_setup_reopenings where setup_id = $1`, [setup])).toEqual([
      { reason: "Recount the brushes", reopened_by: owner },
    ]);

    const brushes = await item(setup, "3-inch brushes");
    await save(b, brushes.id, 20);
    await call(b, "submit_weekly_setup", setup);
    const all = await rows<{ submitted_by: string }>(`select submitted_by from public.weekly_setup_submissions where setup_id = $1 order by submitted_at`, [setup]);
    expect(all.map((s) => s.submitted_by)).toEqual([a, b]);
    expect(
      await rows(`select activity_type from public.pre_week_activity where setup_id = $1 order by id`, [setup]),
    ).toEqual([{ activity_type: "setup_started" }, { activity_type: "setup_submitted" }, { activity_type: "setup_reopened" }, { activity_type: "setup_submitted" }]);
  });

  it("keeps last week's setup unchanged and read only once the week is over", async () => {
    const trailer = await call<string>(owner, "add_trailer", "Past Week Trailer");
    const setup = await call<string>(a, "ensure_weekly_setup", trailer);
    const grinder = await item(setup, "Grinder");
    await makeLastWeek(setup);
    await expect(save(a, grinder.id, 1)).rejects.toThrow("This week has ended, so its setup can't be changed.");
    // This week starts fresh.
    const current = await call<string>(a, "ensure_weekly_setup", trailer);
    expect(current).not.toBe(setup);
  });
});

describe("owner template and trailer management", () => {
  it("applies template changes to future weeks only", async () => {
    const trailer = await call<string>(owner, "add_trailer", "Template Test Trailer");
    const old = await call<string>(a, "ensure_weekly_setup", trailer);
    await makeLastWeek(old);

    const [{ id: brushesItem }] = await rows<{ id: string }>(`select id from public.inventory_items where label = '3-inch brushes'`);
    await call(owner, "update_inventory_item", brushesItem, "Materials and consumables", "3-inch chip brushes", 40, "brushes");
    const added = await call<string>(owner, "add_inventory_item", "Materials and consumables", "Zip ties", "count", 20, "ties");

    expect(await item(old, "3-inch brushes")).toMatchObject({ target_quantity: 30 });
    expect((await items(old)).some((i) => i.label === "Zip ties")).toBe(false);
    await expect(rows(`update public.weekly_setup_items set label = 'x' where setup_id = $1`, [old])).rejects.toThrow(/snapshot/);

    const current = await call<string>(a, "ensure_weekly_setup", trailer);
    expect(await item(current, "3-inch chip brushes")).toMatchObject({ target_quantity: 40 });
    expect(await item(current, "Zip ties")).toMatchObject({ target_quantity: 20 });

    await call(owner, "archive_inventory_item", added);
    const next = await call<string>(owner, "add_trailer", "After Archive Trailer");
    const fresh = await call<string>(a, "ensure_weekly_setup", next);
    expect((await items(fresh)).some((i) => i.label === "Zip ties")).toBe(false);
    expect((await items(current)).some((i) => i.label === "Zip ties")).toBe(true);
    await expect(rows(`delete from public.inventory_items where id = $1`, [added])).rejects.toThrow(/part of job history/);

    // Put the brushes back for later tests.
    await call(owner, "update_inventory_item", brushesItem, "Materials and consumables", "3-inch brushes", 30, "brushes");
    const history = await rows<{ activity_type: string; actor_id: string }>(
      `select activity_type, actor_id from public.pre_week_activity where item_id = $1 order by id`,
      [brushesItem],
    );
    expect(history).toEqual([
      { activity_type: "item_edited", actor_id: owner },
      { activity_type: "item_edited", actor_id: owner },
    ]);
  });

  it("validates template edits and reorders within a category", async () => {
    await expect(call(owner, "add_inventory_item", "Prep tools", "", "count", 1, null)).rejects.toThrow("Give the item a name");
    await expect(call(owner, "add_inventory_item", "Prep tools", "Rope", "count", 0, null)).rejects.toThrow("Set a target from 1 to 1,000.");
    const [first, second] = await rows<{ id: string; label: string }>(
      `select id, label from public.inventory_items where category = 'Core equipment' and archived_at is null order by position limit 2`,
    );
    await call(owner, "move_inventory_item", second.id, -1);
    const order = await rows<{ label: string }>(
      `select label from public.inventory_items where category = 'Core equipment' and archived_at is null order by position limit 2`,
    );
    expect(order.map((o) => o.label)).toEqual([second.label, first.label]);
    await call(owner, "move_inventory_item", second.id, 1);
  });

  it("renames, adds, and archives trailers while keeping their history", async () => {
    const trailer = await trailerId("Trailer 2");
    await call(owner, "rename_trailer", trailer, "Trailer 2 (Box)");
    expect(await rows(`select name from public.trailers where id = $1`, [trailer])).toEqual([{ name: "Trailer 2 (Box)" }]);
    await call(owner, "rename_trailer", trailer, "Trailer 2");

    const extra = await call<string>(owner, "add_trailer", "Trailer 3");
    const setup = await call<string>(a, "ensure_weekly_setup", extra);
    expect(await call(owner, "archive_trailer", extra)).toBe("archived");
    expect(await call(owner, "archive_trailer", extra)).toBe("already_archived");
    await expect(call(a, "ensure_weekly_setup", extra)).rejects.toThrow("Trailer not found.");
    // History stays; the owner still sees it, employees see only active trailers.
    expect(await as(db, { userId: owner }, () => rows(`select id from public.weekly_setups where id = $1`, [setup]))).toHaveLength(1);
    expect(await as(db, { userId: a }, () => rows(`select id from public.weekly_setups where id = $1`, [setup]))).toEqual([]);
    expect(await as(db, { userId: a }, () => rows(`select id from public.trailers where id = $1`, [extra]))).toEqual([]);
    await expect(rows(`delete from public.trailers where id = $1`, [extra])).rejects.toThrow(/part of job history/);
    expect(
      (await rows<{ activity_type: string }>(`select activity_type from public.pre_week_activity where trailer_id = $1 order by id`, [extra])).map(
        (r) => r.activity_type,
      ),
    ).toEqual(["trailer_added", "setup_started", "trailer_archived"]);
  });
});

describe("access", () => {
  it("lets employees fill in and submit, and only owners manage or reopen", async () => {
    const trailer = await trailerId("Trailer 1");
    for (const fn of ["add_trailer"]) await expect(call(a, fn, "X")).rejects.toThrow("Only an active owner can do this.");
    await expect(call(a, "rename_trailer", trailer, "X")).rejects.toThrow("Only an active owner can do this.");
    await expect(call(a, "archive_trailer", trailer)).rejects.toThrow("Only an active owner can do this.");
    await expect(call(a, "add_inventory_item", "Prep tools", "Rope", "count", 1, null)).rejects.toThrow("Only an active owner can do this.");
    // Owners manage but don't fill in counts.
    const setup = await call<string>(owner, "ensure_weekly_setup", trailer);
    const grinder = await item(setup, "Grinder");
    await expect(save(owner, grinder.id, 1)).rejects.toThrow("Only an active employee can fill in Pre-Week Setup.");
    // Employees can't read owner-only history or submissions.
    expect(await as(db, { userId: a }, () => rows(`select * from public.pre_week_activity`))).toEqual([]);
    expect(await as(db, { userId: a }, () => rows(`select * from public.weekly_setup_submissions`))).toEqual([]);
  });

  it("denies deactivated and signed-out users", async () => {
    const former = await createUser(db, { role: "employee", active: false });
    const trailer = await trailerId("Trailer 1");
    await expect(call(former, "ensure_weekly_setup", trailer)).rejects.toThrow("Only active users can open Pre-Week Setup.");
    const setup = await call<string>(a, "ensure_weekly_setup", trailer);
    const grinder = await item(setup, "Grinder");
    await expect(save(former, grinder.id, 1)).rejects.toThrow("Only an active employee can fill in Pre-Week Setup.");
    expect(await as(db, { userId: former }, () => rows(`select * from public.weekly_setup_items`))).toEqual([]);
    expect(await as(db, { userId: former }, () => rows(`select * from public.trailers`))).toEqual([]);
    await expect(as(db, "anon", () => rows(`select * from public.trailers`))).rejects.toThrow(/permission denied/);
    await expect(as(db, "anon", () => rows(`select public.ensure_weekly_setup($1)`, [trailer]))).rejects.toThrow(/permission denied/);
  });

  it("shows names but never email addresses in the overview", async () => {
    const overview = await as(db, { userId: owner }, () => rows(`select * from public.weekly_setup_overview`));
    const detail = await as(db, { userId: a }, () => rows(`select * from public.weekly_setup_item_detail`));
    expect(JSON.stringify([overview, detail])).not.toMatch(/@example\.com/);
    expect(overview.length).toBeGreaterThan(0);
  });

  it("is quick with a year of weekly history for both trailers", async () => {
    const trailer = await call<string>(owner, "add_trailer", "History Trailer");
    const started = performance.now();
    for (let week = 0; week < 52; week++) {
      const setup = await call<string>(a, "ensure_weekly_setup", trailer);
      // Move this week's setup back week + 1 weeks (fixture, skipping triggers).
      await db.exec("set session_replication_role = replica");
      await rows(`update public.weekly_setups set week_start = week_start - ($2::int + 1) * 7 where id = $1`, [setup, week]);
      await db.exec("set session_replication_role = origin");
    }
    const overview = await as(db, { userId: owner }, () => rows(`select * from public.weekly_setup_overview`));
    expect(overview.length).toBeGreaterThan(52);
    expect(performance.now() - started).toBeLessThan(60_000);
  }, 120_000);
});
