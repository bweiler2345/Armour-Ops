// Measures the compressed Worker size exactly as Cloudflare will, using a
// Wrangler dry run (no account needed, nothing is uploaded), and fails if it
// is not below the Workers Free limit. Run after `npm run cf:build`.
//
//   node scripts/check-worker-size.mjs

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LIMIT_KIB = 3072; // Workers Free: 3 MiB compressed
const WARN_KIB = 2900;

const outdir = mkdtempSync(join(tmpdir(), "armour-ops-size-"));
try {
  const result = spawnSync("npx", ["wrangler", "deploy", "--dry-run", "--outdir", outdir], {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, CLOUDFLARE_API_TOKEN: "" },
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = output.match(/Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/);
  if (result.status !== 0 || !match) {
    console.error("[worker-size] The Wrangler dry run failed or printed no size.");
    process.exit(1);
  }
  const gzip = Number(match[2]);
  const margin = (LIMIT_KIB - gzip).toFixed(2);
  console.log(`[worker-size] Compressed Worker: ${gzip.toFixed(2)} KiB of ${LIMIT_KIB} KiB (margin ${margin} KiB).`);
  if (gzip >= LIMIT_KIB) {
    console.error("[worker-size] Over the Workers Free limit. Do not deploy.");
    process.exit(1);
  }
  if (gzip >= WARN_KIB) console.warn("[worker-size] Warning: within 172 KiB of the Workers Free limit.");
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
