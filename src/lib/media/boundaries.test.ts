import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-level checks that keep file contents and storage keys where they
// belong. The build's secret scan (scripts/cf-protect-secrets.mjs) checks the
// bundled output as well.

const read = (path: string) => readFileSync(path, "utf8");
const SECRET_NAMES = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe("media boundaries", () => {
  it("media Server Actions accept only small descriptions, never file contents", () => {
    const actions = read("src/lib/actions/media.ts");
    expect(actions.startsWith('"use server";')).toBe(true);
    for (const pattern of [
      /\b(Blob|FormData|ArrayBuffer|ReadableStream|Uint8Array)\b/,
      /:\s*File\b|<File>|File\[\]/,
      /\.(arrayBuffer|formData|stream|bytes)\(/,
    ]) {
      expect(actions).not.toMatch(pattern);
    }
  });

  it("the viewing route redirects to storage instead of streaming the file", () => {
    const route = read("src/app/media/[mediaId]/route.ts");
    expect(route).toContain("authorize_media_view");
    expect(route).toContain("NextResponse.redirect");
    expect(route).not.toMatch(/\bfetch\(|\.body\b|arrayBuffer/);
  });

  it("storage keys stay in server-only code", () => {
    expect(read("src/lib/media/r2.ts").startsWith('import "server-only";')).toBe(true);
    for (const file of sourceFiles("src")) {
      const text = read(file);
      for (const name of SECRET_NAMES) {
        expect(text, file).not.toContain(`NEXT_PUBLIC_${name}`);
        if (text.includes(`process.env.${name}`)) expect(file.replaceAll("\\", "/")).toBe("src/lib/media/r2.ts");
      }
    }
  });

  it("browser code never imports the server storage module", () => {
    for (const file of sourceFiles("src")) {
      const text = read(file);
      if (text.startsWith('"use client"')) {
        expect(text, file).not.toMatch(/@\/lib\/media\/r2"|\/r2"|supabase\/admin/);
      }
    }
  });

  it("the build scan knows every storage secret", () => {
    const scan = read("scripts/cf-protect-secrets.mjs");
    expect(scan).toContain('"R2_SECRET_ACCESS_KEY"');
    expect(scan).toContain('"R2_ACCESS_KEY_ID"');
    const example = read(".env.example");
    for (const name of SECRET_NAMES) expect(example).toMatch(new RegExp(`^${name}=`, "m"));
  });

  it("the step screen never shows storage object keys", () => {
    const queries = read("src/lib/steps/queries.ts");
    const select = queries.match(/from\("step_media"\)\s*\.select\(\s*"([^"]+)"/)?.[1] ?? "";
    expect(select).toContain("id");
    expect(select).not.toMatch(/object_key|r2_upload_id/);
  });
});

describe("Phase 8 boundaries", () => {
  it("reference picture actions accept only small descriptions, never file contents", () => {
    for (const file of ["src/lib/actions/references.ts", "src/lib/actions/library.ts", "src/lib/actions/custom-steps.ts"]) {
      const text = read(file);
      expect(text.startsWith('"use server";'), file).toBe(true);
      expect(text, file).not.toMatch(/\b(Blob|ArrayBuffer|ReadableStream|Uint8Array)\b|:\s*File\b|\.(arrayBuffer|stream|bytes)\(/);
    }
  });

  it("reference pictures are viewed through their own access check and a redirect", () => {
    const route = read("src/app/reference/[pictureId]/route.ts");
    expect(route).toContain("authorize_reference_view");
    expect(route).toContain("NextResponse.redirect");
    expect(route).not.toMatch(/\bfetch\(|\.body\b|arrayBuffer/);
  });

  it("owner-only actions check the owner before touching the database", () => {
    for (const file of ["src/lib/actions/references.ts", "src/lib/actions/library.ts", "src/lib/actions/custom-steps.ts"]) {
      const text = read(file);
      const exported = text.match(/export async function \w+/g) ?? [];
      const checks = text.match(/await requireOwner\(\)/g) ?? [];
      expect(checks.length, file).toBe(exported.length);
    }
  });
});
