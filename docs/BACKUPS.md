# Armour Ops database backups and restore

Every Sunday at 09:00 UTC (and whenever you run it by hand), GitHub Actions exports the Supabase database, encrypts it, uploads it to a private R2 bucket, checks the upload, and only then deletes backups beyond the newest 12. A failed export, check, or upload never deletes an existing backup.

- Workflow: `.github/workflows/weekly-backup.yml` (runs one at a time; **Actions › Weekly backup › Run workflow** to run it now)
- Script: `scripts/backup/backup.sh`; retention: `scripts/backup/prune.mjs`
- Format: PostgreSQL custom format (`pg_dump --format=custom`, compressed) of the `public` and `auth` schemas, restorable with `pg_restore`
- Encryption: GnuPG symmetric, AES-256, with `BACKUP_ENCRYPTION_KEY`; the file is decrypted again and compared before upload
- Names: `backups/armour-ops-<UTC timestamp>-<run id>.dump.gpg` in the `armour-ops-backups` bucket
- Logs show only steps, sizes, table counts, and object names; never data, passwords, connection strings, keys, or links

Backups contain customer and account data. They exist only encrypted, in the private bucket; never download them to shared places or commit them (`.gitignore` blocks `*.dump` and `*.dump.gpg`).

## GitHub Actions secrets

Add each in GitHub › **Settings › Secrets and variables › Actions › Secrets › New repository secret**.

| Secret | Value comes from |
| --- | --- |
| `SUPABASE_DB_URL` | Supabase › **Connect** (top of the dashboard) › **Session pooler** connection string, with your database password filled in. Use the Session pooler (port 5432): GitHub's runners can't reach the direct connection, which is IPv6 only on the free plan. If you don't know the database password, reset it in Project Settings › Database; the app doesn't use it. |
| `BACKUP_ENCRYPTION_KEY` | A long random passphrase you create (below). Store it in your password manager too: **without it, no backup can ever be restored.** |
| `R2_BACKUP_ACCOUNT_ID` | Cloudflare › R2 overview › Account details › Account ID |
| `R2_BACKUP_ACCESS_KEY_ID` | The backup-only R2 token (below) |
| `R2_BACKUP_SECRET_ACCESS_KEY` | The backup-only R2 token (below) |
| `R2_BACKUP_BUCKET` | `armour-ops-backups` |

The database connection uses the `postgres` role because `pg_dump` must read every table past Row Level Security; the string lives only in this GitHub secret.

## One-time setup

1. **Backup bucket.** Cloudflare › R2 › **Create bucket** named `armour-ops-backups` (Automatic, Standard). In its Settings, leave **R2.dev subdomain** disabled and add no custom domain. Add no CORS policy (browsers never use it).
2. **Backup-only token.** R2 overview › **Manage API tokens** › **Create Account API token**: name `armour-ops-backups`, permission **Object Read & Write**, **Apply to specific buckets only** › `armour-ops-backups`. Keep the Access Key ID and Secret Access Key in your password manager. This token can't touch the media bucket, and the app's token can't touch backups.
3. **Encryption key.** On your computer, in PowerShell:
   ```powershell
   $b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
   ```
   Copy the result into your password manager and into the `BACKUP_ENCRYPTION_KEY` secret. Don't paste it anywhere else.
4. **Secrets.** Add the six secrets above.
5. **Test run.** GitHub › **Actions › Weekly backup › Run workflow**. It should finish green with "Verified in R2" and "Done. N backups kept." In R2 › `armour-ops-backups` › Objects, one `backups/armour-ops-…dump.gpg` object appears.

## Restore test (safe: never touches the live database)

Do this after the first backup and a few times a year. You need Docker Desktop (already installed) and the encryption key.

1. **Download** the newest backup from R2 › `armour-ops-backups` › Objects › the object › **Download**, into a private folder such as `C:\Users\<you>\ArmourRestoreTest`.
2. **Decrypt** (Git Bash, in that folder; paste the key when asked for the passphrase):
   ```bash
   gpg --output armour-ops.dump --decrypt armour-ops-<timestamp>-<run>.dump.gpg
   ```
3. **Start a scratch Postgres** (Docker Desktop running):
   ```bash
   docker run --name armour-restore-test -e POSTGRES_PASSWORD=scratch-only -p 55432:5432 -d postgres:17
   docker exec -i armour-restore-test psql -U postgres -c "create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;"
   ```
4. **Restore into it:**
   ```bash
   docker cp armour-ops.dump armour-restore-test:/tmp/armour-ops.dump
   docker exec armour-restore-test pg_restore -U postgres -d postgres --no-owner /tmp/armour-ops.dump
   ```
   A few errors about Supabase-only extensions or roles are expected. The check is the next step.
5. **Check the data** (counts, not contents):
   ```bash
   docker exec armour-restore-test psql -U postgres -c "select (select count(*) from public.jobs) as jobs, (select count(*) from public.job_activity) as history, (select count(*) from public.weekly_setups) as pre_week_setups, (select count(*) from auth.users) as accounts;"
   ```
   The numbers should match what you expect from the app.
6. **Clean up:** `docker rm -f armour-restore-test`, then delete `armour-ops.dump` and the downloaded file.

## Real recovery (only if the live database is lost)

Don't restore over the live database. Create a new Supabase project, then restore into it with care: first the `auth` data (`pg_restore --data-only --schema=auth`), then the `public` schema (`pg_restore --schema=public --no-owner`), then point the app's Supabase settings at the new project. Rehearse with a restore test first, and ask for help before doing this for real.
