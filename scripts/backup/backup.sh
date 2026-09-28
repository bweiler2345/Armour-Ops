#!/usr/bin/env bash
# Weekly encrypted Armour Ops database backup to a private R2 bucket.
# Run by .github/workflows/weekly-backup.yml; see docs/BACKUPS.md.
#
# 1. Export the public and auth schemas with pg_dump (custom format,
#    compressed, restorable with pg_restore).
# 2. Check the export is a readable archive that contains the app's tables.
# 3. Encrypt it (GnuPG, AES-256) with BACKUP_ENCRYPTION_KEY, then decrypt it
#    again and compare checksums.
# 4. Upload it under a timestamped name, then confirm R2 has it at the
#    right size and checksum.
# 5. Only then delete backups beyond the newest 12.
#
# Any failure stops the script before step 5, so older backups are never
# deleted after a failed export or upload. Nothing secret, no connection
# string, and no database content is printed.

set -euo pipefail
umask 077

KEEP=12
for name in SUPABASE_DB_URL BACKUP_ENCRYPTION_KEY R2_BACKUP_ACCOUNT_ID R2_BACKUP_ACCESS_KEY_ID R2_BACKUP_SECRET_ACCESS_KEY R2_BACKUP_BUCKET; do
  if [ -z "${!name:-}" ]; then
    echo "Missing required secret: $name (see docs/BACKUPS.md)." >&2
    exit 1
  fi
done
if [ "${#BACKUP_ENCRYPTION_KEY}" -lt 32 ]; then
  echo "BACKUP_ENCRYPTION_KEY must be at least 32 characters." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
KEY="backups/armour-ops-${STAMP}-${GITHUB_RUN_ID:-manual}.dump.gpg"
DUMP="$WORK/armour-ops.dump"
ENC="$DUMP.gpg"

hide() { sed -E 's#(postgres(ql)?://)[^[:space:]]+#\1<hidden>#g; s#password=[^[:space:]]+#password=<hidden>#g'; }

echo "1. Exporting the database (public and auth schemas)…"
if ! pg_dump --format=custom --compress=9 --no-owner --schema=public --schema=auth \
     --file "$DUMP" --dbname "$SUPABASE_DB_URL" 2> "$WORK/pg_dump.log"; then
  echo "The export failed. Existing backups were not touched." >&2
  hide < "$WORK/pg_dump.log" | tail -n 5 >&2
  exit 1
fi

echo "2. Checking the export…"
pg_restore --list "$DUMP" > "$WORK/toc.txt"
for table in "public jobs" "public job_activity" "public step_attempts" "public weekly_setups" "auth users"; do
  if ! grep -q "TABLE DATA ${table} " "$WORK/toc.txt"; then
    echo "The export is missing data for ${table}. Existing backups were not touched." >&2
    exit 1
  fi
done
DUMP_SHA="$(sha256sum "$DUMP" | cut -d' ' -f1)"
echo "   $(grep -c 'TABLE DATA' "$WORK/toc.txt") tables, $(stat -c%s "$DUMP") bytes."

echo "3. Encrypting and checking decryption…"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --symmetric --cipher-algo AES256 --output "$ENC" "$DUMP" 3<<< "$BACKUP_ENCRYPTION_KEY"
CHECK_SHA="$(gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$ENC" 3<<< "$BACKUP_ENCRYPTION_KEY" | sha256sum | cut -d' ' -f1)"
if [ "$CHECK_SHA" != "$DUMP_SHA" ]; then
  echo "Decryption check failed. Existing backups were not touched." >&2
  exit 1
fi
rm -f "$DUMP"
ENC_SIZE="$(stat -c%s "$ENC")"
ENC_SHA="$(sha256sum "$ENC" | cut -d' ' -f1)"

export AWS_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
export AWS_PAGER=""
ENDPOINT="https://${R2_BACKUP_ACCOUNT_ID}.r2.cloudflarestorage.com"
r2() { aws s3api "$@" --endpoint-url "$ENDPOINT" --bucket "$R2_BACKUP_BUCKET"; }

echo "4. Uploading ${KEY}…"
r2 put-object --key "$KEY" --body "$ENC" --content-type application/octet-stream \
  --metadata "sha256=${ENC_SHA}" > /dev/null
STORED_SIZE="$(r2 head-object --key "$KEY" --query ContentLength --output text)"
STORED_SHA="$(r2 head-object --key "$KEY" --query 'Metadata.sha256' --output text)"
if [ "$STORED_SIZE" != "$ENC_SIZE" ] || [ "$STORED_SHA" != "$ENC_SHA" ]; then
  # Remove only the bad new upload; older backups stay.
  r2 delete-object --key "$KEY" > /dev/null || true
  echo "The uploaded backup doesn't match, so it was removed. Older backups were not deleted." >&2
  exit 1
fi
echo "   Verified in R2 (${ENC_SIZE} bytes)."

echo "5. Keeping the newest ${KEEP} backups…"
r2 list-objects-v2 --prefix backups/ --query 'Contents[].Key' --output text \
  | tr '\t' '\n' | grep -v '^None$' > "$WORK/keys.txt"
node "$(dirname "$0")/prune.mjs" "$KEEP" "$KEY" < "$WORK/keys.txt" > "$WORK/delete.txt"
while IFS= read -r old; do
  [ -n "$old" ] || continue
  r2 delete-object --key "$old" > /dev/null
  echo "   Deleted ${old}"
done < "$WORK/delete.txt"
echo "Done. $(( $(wc -l < "$WORK/keys.txt") - $(wc -l < "$WORK/delete.txt") )) backups kept."
