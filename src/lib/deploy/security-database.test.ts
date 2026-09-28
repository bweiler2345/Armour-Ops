import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "@/test/database";

// Production readiness checks across every migration: Row Level Security on
// every table, nothing readable by signed-out visitors, and server-only
// functions unavailable to signed-in users. docs/DEPLOYMENT.md has the same
// checks as SQL to run against the live project.

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function rows<T>(sql: string) {
  return (await db.query<T>(sql)).rows;
}

describe("production security", () => {
  it("has Row Level Security on every public table", async () => {
    expect(
      await rows(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`),
    ).toEqual([]);
  });

  it("gives signed-out visitors no table or view access", async () => {
    expect(
      await rows(`select table_name, privilege_type from information_schema.role_table_grants
                  where grantee = 'anon' and table_schema = 'public'`),
    ).toEqual([]);
  });

  it("keeps server-only functions away from signed-in users", async () => {
    const serverOnly = [
      "confirm_media_upload",
      "media_upload_details",
      "set_media_multipart",
      "fail_media_upload",
      "authorize_media_view",
      "expire_abandoned_media",
      "media_due_for_retention_cleanup",
      "mark_media_deleted",
      "confirm_reference_upload",
      "authorize_reference_view",
      "reference_pictures_due_for_retention_cleanup",
    ];
    const granted = await rows<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any('{${serverOnly.join(",")}}')
         and has_function_privilege('authenticated', p.oid, 'execute')`,
    );
    expect(granted).toEqual([]);
    const anon = await rows<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
         and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
         and p.proname not in ('is_active_user', 'is_owner')`,
    );
    // Signed-out visitors can call nothing that reads or changes data (only
    // pure helpers such as constants and validation remain callable).
    expect(anon.map((r) => r.proname).filter((n) => !/^(guard_|prevent_|set_updated_at|milestone_installed|completion_item_applies|snapshot_edit_allowed|check_inventory_fields|step_definition_problem|pre_week_start|step_hold_duration)/.test(n))).toEqual([]);
  });
});
