// Chooses which backups to delete after a new one is verified: keeps the
// newest `keep` backups by the timestamp in their names, never the one just
// uploaded, and ignores anything that isn't an Armour Ops backup.
//
// Reads object keys (one per line) on stdin; prints keys to delete, one per
// line. Usage: node scripts/backup/prune.mjs <keep> <just-uploaded-key>

export const BACKUP_KEY = /^backups\/armour-ops-(\d{8}T\d{6}Z)-[\w-]+\.dump\.gpg$/;

export function keysToDelete(keys, keep, justUploaded) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error("keep must be at least 1");
  const backups = [...new Set(keys)].filter((k) => BACKUP_KEY.test(k));
  if (!backups.includes(justUploaded)) throw new Error("The new backup isn't in the listing; nothing is deleted.");
  const newestFirst = backups.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return newestFirst.slice(keep).filter((k) => k !== justUploaded);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("prune.mjs")) {
  const [keepArg, justUploaded] = process.argv.slice(2);
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    const keys = input.split(/\r?\n/).map((k) => k.trim()).filter(Boolean);
    for (const key of keysToDelete(keys, Number(keepArg), justUploaded)) console.log(key);
  });
}
