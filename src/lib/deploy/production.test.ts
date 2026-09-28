import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { isPublicPath } from "@/lib/auth/routes";
import { keysToDelete } from "../../../scripts/backup/prune.mjs";

const read = (path: string) => readFileSync(path, "utf8");
const key = (stamp: string, run = "1") => `backups/armour-ops-${stamp}-${run}.dump.gpg`;

describe("backup retention", () => {
  const keys = Array.from({ length: 14 }, (_, i) => key(`2026${String(i + 1).padStart(2, "0")}01T090000Z`, String(i)));

  it("keeps the newest 12 and deletes only older Armour Ops backups", () => {
    const newest = keys[13];
    const doomed = keysToDelete([...keys, "backups/notes.txt", "other/file"], 12, newest);
    expect(doomed.sort()).toEqual([keys[0], keys[1]].sort());
  });

  it("never deletes the backup just uploaded, and refuses if it isn't listed", () => {
    expect(keysToDelete([keys[0]], 1, keys[0])).toEqual([]);
    expect(() => keysToDelete(keys.slice(0, 3), 12, key("20990101T000000Z"))).toThrow(/nothing is deleted/);
    expect(() => keysToDelete(keys, 0, keys[13])).toThrow();
  });
});

describe("backup script and workflow", () => {
  const script = read("scripts/backup/backup.sh");
  const workflow = read(".github/workflows/weekly-backup.yml");

  it("runs weekly and on demand, never overlapping", () => {
    expect(workflow).toMatch(/schedule:\s*\n\s*#.*\n\s*- cron: "0 9 \* \* 0"/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toMatch(/concurrency:\s*\n\s*group: weekly-backup\s*\n\s*cancel-in-progress: false/);
    expect(workflow).toContain("permissions:\n  contents: read");
  });

  it("verifies before pruning, and stops on any failure", () => {
    expect(script).toContain("set -euo pipefail");
    const order = ["pg_dump --format=custom", "pg_restore --list", "--symmetric --cipher-algo AES256", "--decrypt", "put-object", "head-object", "prune.mjs"];
    const positions = [...order.map((s) => script.indexOf(s)), script.lastIndexOf("delete-object")];
    // The only earlier delete removes the just-uploaded object when it fails verification.
    expect(script.indexOf("delete-object")).toBeGreaterThan(script.indexOf("head-object"));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("never prints secrets, connection strings, or data", () => {
    expect(script).not.toMatch(/set -x|set -o xtrace/);
    expect(script).not.toMatch(/echo[^\n]*\$\{?(SUPABASE_DB_URL|BACKUP_ENCRYPTION_KEY|R2_BACKUP_SECRET_ACCESS_KEY|R2_BACKUP_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)/);
    // The passphrase goes through a file descriptor, never the command line.
    expect(script).toContain('3<<< "$BACKUP_ENCRYPTION_KEY"');
    expect(script).not.toMatch(/--passphrase [^-]/);
    // pg_dump errors are shown with connection strings hidden.
    expect(script).toMatch(/hide < "\$WORK\/pg_dump\.log"/);
  });
});

describe("deployment workflow", () => {
  const workflow = read(".github/workflows/deploy.yml");

  it("deploys from main or on demand, one at a time", () => {
    expect(workflow).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toMatch(/group: deploy-production\s*\n\s*cancel-in-progress: false/);
  });

  it("runs every check before deploying, and keeps deploy secrets out of the build", () => {
    const steps = ["npm ci", "npm run lint", "npm run typecheck", "npm test", "npm run build", "npm run cf:build", "npm run cf:size", "npx wrangler deploy"];
    const positions = steps.map((s) => workflow.indexOf(s));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(workflow.indexOf("CLOUDFLARE_API_TOKEN: ${{ secrets")).toBeGreaterThan(workflow.indexOf("npm run cf:size"));
    // The app's runtime secrets live only in Cloudflare, never in this workflow.
    expect(workflow).not.toMatch(/secrets\.(SUPABASE_SECRET_KEY|R2_)/);
  });
});

describe("production configuration", () => {
  it("keeps secrets and account ids out of the Wrangler config, on workers.dev only", () => {
    const wrangler = read("wrangler.jsonc");
    expect(wrangler).toContain('"workers_dev": true');
    expect(wrangler).toContain('"upload_source_maps": false');
    expect(wrangler).not.toMatch(/"(vars|account_id|routes|route)"\s*:/);
    expect(wrangler).not.toMatch(/armourfloors\.net/);
  });

  it("sends security headers without blocking uploads, media, or sign-in", () => {
    const config = read("next.config.ts");
    for (const header of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security", "frame-ancestors 'none'"]) {
      expect(config).toContain(header);
    }
    // No script, image, or connect restrictions that would break R2 or Next.
    expect(config).not.toMatch(/script-src|img-src|connect-src|media-src/);
    expect(config).toContain("poweredByHeader: false");
    expect(config).toContain('process.env.NODE_ENV === "development" ? parseDevLanHosts');
  });

  it("answers the health check without a session and without details", async () => {
    expect(isPublicPath("/api/health")).toBe(true);
    const response = GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
    const route = read("src/app/api/health/route.ts");
    expect(route).not.toMatch(/supabase|process\.env|createClient/);
  });

  it("protects every signed-in page on the server (so none is cached publicly)", () => {
    const pages = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? pages(path) : name === "page.tsx" ? [path] : [];
      });
    const all = pages("src/app/(app)");
    expect(all.length).toBeGreaterThan(20);
    for (const page of all) {
      expect(read(page), page).toMatch(/await require(User|Owner)\(\)/);
    }
  });

  it("never commits backups or environment files", () => {
    const ignore = read(".gitignore");
    expect(ignore).toMatch(/^\.env\*$/m);
    expect(ignore).toMatch(/^\.dev\.vars\*$/m);
    expect(ignore).toMatch(/^\*\.dump$/m);
    expect(ignore).toMatch(/^\*\.dump\.gpg$/m);
  });
});
