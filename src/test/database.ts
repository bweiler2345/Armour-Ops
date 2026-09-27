// Test-only helpers: runs the real supabase/migrations in PGlite (Postgres
// compiled to WebAssembly, in process) with a minimal stand-in for the parts
// of Supabase the migrations rely on. Never imported by application code.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = "supabase/migrations";

// Mirrors Supabase: the API roles, default table privileges that migrations
// must explicitly revoke, and auth.uid() read from the request's JWT subject.
const SUPABASE_STAND_IN = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export function readMigration(name: string) {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

export async function createTestDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_STAND_IN);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readMigration(file));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

// Creates a user through auth.users (so the profile trigger runs) and returns
// its id. Test names and emails are fictional.
export async function createUser(
  db: PGlite,
  { role, active = true }: { role: "owner" | "employee"; active?: boolean },
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data)
     values ('test-' || gen_random_uuid() || '@example.com', '{"full_name": "Test User"}')
     returning id`,
  );
  const id = rows[0].id;
  await db.query(`update public.profiles set role = $1::public.app_role, active = $2 where id = $3`, [
    role,
    active,
    id,
  ]);
  return id;
}

// Runs `fn` as a signed-in user (role "authenticated"), a visitor ("anon"),
// or the server secret key ("service_role"), then switches back to the
// database owner.
export async function as<T>(
  db: PGlite,
  who: { userId: string } | "anon" | "service_role",
  fn: () => Promise<T>,
): Promise<T> {
  const role = typeof who === "string" ? who : "authenticated";
  const sub = typeof who === "string" ? "" : who.userId;
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
