// Runs after `opennextjs-cloudflare build`.
//
// OpenNext copies every variable from the project's .env files into the Worker
// bundle (.open-next/cloudflare/next-env.mjs). Server secrets such as
// SUPABASE_SECRET_KEY and the R2 keys must never be bundled: on Cloudflare they come from
// Workers secrets, and for local previews from .dev.vars.
//
// 1. Rewrite next-env.mjs to keep only NEXT_PUBLIC_ variables (these are
//    public by design and already inlined into the browser code by Next.js).
// 2. Scan the whole .open-next output for the value of every non-public
//    variable found in the .env files or the current environment, and fail
//    the build if any appears. Values are never printed.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outputDir = join(root, ".open-next");
const envModulePath = join(outputDir, "cloudflare", "next-env.mjs");
const PUBLIC_PREFIX = "NEXT_PUBLIC_";
// Always treated as secrets, even if only set in the shell environment.
const KNOWN_SECRETS = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  // Deployment and backup credentials (GitHub Actions). None should ever be
  // present during a build; if one is, it must not reach the output.
  "CLOUDFLARE_API_TOKEN",
  "SUPABASE_DB_URL",
  "BACKUP_ENCRYPTION_KEY",
  "R2_BACKUP_ACCESS_KEY_ID",
  "R2_BACKUP_SECRET_ACCESS_KEY",
];

if (!existsSync(envModulePath)) {
  console.error(`[cf-protect-secrets] ${envModulePath} not found. Run the OpenNext build first.`);
  process.exit(1);
}

// 1. Keep only public variables in the bundled env module.
const envModule = await import(`${pathToFileURL(envModulePath).href}?t=${Date.now()}`);
let removed = 0;
const lines = Object.entries(envModule).map(([mode, vars]) => {
  const kept = Object.fromEntries(
    Object.entries(vars ?? {}).filter(([key]) => {
      const keep = key.startsWith(PUBLIC_PREFIX);
      if (!keep) removed++;
      return keep;
    }),
  );
  return `export const ${mode} = ${JSON.stringify(kept)};\n`;
});
writeFileSync(envModulePath, lines.join(""));
console.log(
  `[cf-protect-secrets] Kept only ${PUBLIC_PREFIX}* variables in the Worker env module (${removed} server-only entr${removed === 1 ? "y" : "ies"} removed).`,
);

// 2. Collect server-only values to search for.
function parseEnvFile(path) {
  const vars = {};
  if (!existsSync(path)) return vars;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    vars[match[1]] = value;
  }
  return vars;
}

const secrets = new Map();
const envFiles = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.development",
  ".env.development.local",
  ".dev.vars",
];
for (const file of envFiles) {
  for (const [key, value] of Object.entries(parseEnvFile(join(root, file)))) {
    if (!key.startsWith(PUBLIC_PREFIX) && value.length >= 8) secrets.set(value, key);
  }
}
for (const key of KNOWN_SECRETS) {
  const value = process.env[key];
  if (value && value.length >= 8) secrets.set(value, key);
}

// 3. Scan every output file.
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const leaks = [];
if (secrets.size > 0) {
  for (const file of walk(outputDir)) {
    const content = readFileSync(file, "latin1");
    for (const [value, key] of secrets) {
      if (content.includes(value)) leaks.push({ key, file: file.slice(root.length + 1) });
    }
  }
}

if (leaks.length > 0) {
  console.error("[cf-protect-secrets] Server-only values were found in the Worker build output:");
  for (const { key, file } of leaks) console.error(`  - ${key} in ${file}`);
  console.error("Do not deploy this build. Remove the value from the build inputs and rebuild.");
  process.exit(1);
}

console.log(
  `[cf-protect-secrets] Checked ${secrets.size} server-only value${secrets.size === 1 ? "" : "s"}; none found in .open-next.`,
);
