# Armour Ops production deployment and runbook

Armour Ops runs on **Cloudflare Workers Free** at the free `workers.dev` address, built with OpenNext on Linux by **GitHub Actions**. Media is in a private **R2** bucket. Weekly encrypted database backups go to a separate private R2 bucket (see `docs/BACKUPS.md`). There are no custom domains, analytics, email providers, or paid services.

| Thing | Value |
| --- | --- |
| Worker name | `armour-ops` |
| Production URL | `https://armour-ops.<your-workers-subdomain>.workers.dev` (record the exact address below after the first deployment) |
| Production media bucket | `armour-ops-media` |
| Backup bucket | `armour-ops-backups` |
| Deploy workflow | `.github/workflows/deploy.yml` (every push to `main`, or run by hand) |
| Backup workflow | `.github/workflows/weekly-backup.yml` (Sundays 09:00 UTC, or run by hand) |
| Health check | `<production URL>/api/health` answers `{"status":"ok"}` |

**Production URL (fill in after step 6):** `https://armour-ops.________.workers.dev`

## Why GitHub Actions deploys (not Cloudflare's Git integration)

Both work on the free plans. GitHub Actions was chosen because the weekly backups already need it, and one workflow can run every check (lint, type check, all unit and database tests, the production build, the Cloudflare build with its secret scan, a browser-bundle scan, and the Worker size limit) and deploy only when all of them pass, one deployment at a time. The app's runtime secrets never enter GitHub: only a deploy-only Cloudflare token does.

## Where every setting lives

| Name | Kind | Where | Value comes from |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | GitHub Actions **variable** | Supabase: Project Settings › Data API (same as `.env.local`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | GitHub Actions **variable** | Supabase: Project Settings › API Keys › Publishable key |
| `PRODUCTION_URL` | public | GitHub Actions **variable** | The workers.dev address (for the post-deploy health check) |
| `CLOUDFLARE_API_TOKEN` | secret | GitHub Actions **secret** | Cloudflare: a token that can edit Workers (step 3) |
| `CLOUDFLARE_ACCOUNT_ID` | secret | GitHub Actions **secret** | Cloudflare: Account ID (Workers & Pages overview) |
| `SUPABASE_SECRET_KEY` | secret | Cloudflare Worker **secret** | Supabase: API Keys › Secret keys |
| `R2_ACCOUNT_ID` | secret | Cloudflare Worker **secret** | Cloudflare: R2 overview › Account details |
| `R2_ACCESS_KEY_ID` | secret | Cloudflare Worker **secret** | The production media R2 token (step 2) |
| `R2_SECRET_ACCESS_KEY` | secret | Cloudflare Worker **secret** | The production media R2 token (step 2) |
| `R2_BUCKET` | secret | Cloudflare Worker **secret** | `armour-ops-media` |

`DEV_LAN_HOSTS` is development only; it is never set in GitHub or Cloudflare, and production builds ignore it. Never paste any secret into chat, code, docs, commits, or an issue.

## One-time setup (the owner, in order)

1. **Cloudflare account and workers.dev.** Sign in to (or create) a free Cloudflare account. Open **Workers & Pages**. If asked, choose your free `workers.dev` subdomain. Note the **Account ID** shown on the right of the Workers & Pages overview.
2. **Production media bucket.** R2 › **Create bucket** named `armour-ops-media` (Location: Automatic, Standard). In its **Settings**: leave **R2.dev subdomain** disabled and add no custom domain; keep the lifecycle rule that aborts incomplete multipart uploads after 7 days (add it if missing). Then R2 overview › **Manage API tokens** › **Create Account API token**: name `armour-ops-media-prod`, permission **Object Read & Write**, **Apply to specific buckets only** › `armour-ops-media`. Keep the **Access Key ID** and **Secret Access Key** in your password manager (they are shown once).
3. **Deploy token.** Cloudflare › My Profile › **API Tokens** › **Create Token** › template **Edit Cloudflare Workers**. Under Account Resources choose your account only; Zone Resources: none needed. Create it and keep the token in your password manager.
4. **GitHub settings.** In the GitHub repository: **Settings › Secrets and variables › Actions**.
   - **Variables** tab › New repository variable: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the same values as in `.env.local`).
   - **Secrets** tab › New repository secret: `CLOUDFLARE_API_TOKEN` (step 3) and `CLOUDFLARE_ACCOUNT_ID` (step 1).
5. **First deployment.** GitHub › **Actions** › **Deploy** › **Run workflow** (branch `main`). Wait for the green check. The Deploy step prints the address, `https://armour-ops.<subdomain>.workers.dev`. Record it at the top of this file.
6. **Worker secrets.** Cloudflare › Workers & Pages › `armour-ops` › **Settings › Variables and Secrets** › **Add**, choosing type **Secret** for each: `SUPABASE_SECRET_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` (value `armour-ops-media`). Deploy when asked. Secrets stay across later deployments. (Command-line alternative after `npx wrangler login`: `npx wrangler secret put SUPABASE_SECRET_KEY` and so on; it asks for the value without showing it.)
7. **Health-check variable.** GitHub › Settings › Secrets and variables › Actions › **Variables**: add `PRODUCTION_URL` = the address from step 5 (no trailing slash).
8. **R2 CORS for production.** R2 › `armour-ops-media` › Settings › **CORS Policy**:
   ```json
   [{"AllowedOrigins":["https://armour-ops.<subdomain>.workers.dev"],"AllowedMethods":["PUT"],"AllowedHeaders":["content-type"],"MaxAgeSeconds":3600}]
   ```
   Use the exact address from step 5. Leave the development bucket's policy as it is.
9. **Supabase URL settings.** Supabase › **Authentication › URL Configuration**: **Site URL** = the production address; under **Redirect URLs** add `https://armour-ops.<subdomain>.workers.dev/**` and keep `http://localhost:3000/**`. (Armour Ops signs in with passwords and sends no emails, so these are only a safety net.)
10. **Supabase checks.** In **Authentication › Sign In / Providers**: **Allow new users to sign up** stays **off**; **Minimum password length** is **10**; **Secure password change** stays **off**. Then run the SQL checks below in the SQL Editor.
11. **Backups:** follow `docs/BACKUPS.md`.
12. **Production verification:** work through the checklist below with fictional test data.

### SQL checks for the live project (read only)

```sql
-- Every Phase 1–10 table exists (each should be true).
select to_regclass('public.profiles') is not null as profiles,
       to_regclass('public.jobs') is not null as jobs,
       to_regclass('public.job_assignments') is not null as teams,
       to_regclass('public.step_attempts') is not null as step_work,
       to_regclass('public.step_media') is not null as media,
       to_regclass('public.job_milestones') is not null as milestones,
       to_regclass('public.step_library_items') is not null as library,
       to_regclass('public.job_working_owners') is not null as working_owners,
       to_regclass('public.weekly_setups') is not null as pre_week_setup,
       exists (select 1 from pg_proc where proname = 'owner_dashboard') as dashboard;

-- Tables without Row Level Security (should return no rows).
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- Server-only functions callable by signed-in users (should return no rows).
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('confirm_media_upload','media_upload_details','set_media_multipart','fail_media_upload',
                    'authorize_media_view','expire_abandoned_media','media_due_for_retention_cleanup',
                    'mark_media_deleted','confirm_reference_upload','authorize_reference_view',
                    'reference_pictures_due_for_retention_cleanup')
  and has_function_privilege('authenticated', p.oid, 'execute');
```

## Everyday deployment

Push (or merge) to `main`. The **Deploy** workflow runs every check; if any fails, nothing is deployed. A newer push waits for the running deployment to finish. To redeploy the current `main` by hand: **Actions › Deploy › Run workflow**.

Local development is unchanged: `npm run dev` with `.env.local`.

## Rolling back

Rolling back changes the app only. It never touches the database, and no workflow changes the database.

- **Fastest:** Cloudflare › Workers & Pages › `armour-ops` › **Deployments** › choose the last good version › **Rollback**.
- **Through Git:** `git revert <bad commit>` and push to `main`; the workflow deploys the reverted code after its checks pass. (Avoid a revert across a database migration that the older code doesn't understand; ask first.)

## Cost and limits

Everything is on free plans. Watch these in the Cloudflare dashboard: Workers Free allows 100,000 requests a day and a 3 MiB compressed Worker (the deploy check refuses anything over the limit; the current size is reported in each run). R2's free tier includes 10 GB of storage. If a limit is ever approached, the owner is told before any upgrade.

## Production verification checklist

Use fictional clients, addresses, and pictures only. Test on a desktop browser and an iPhone, with the computer's `npm run dev` stopped.

- [ ] `<URL>/api/health` shows `{"status":"ok"}`.
- [ ] Signed out, opening `<URL>/jobs` goes to Sign In.
- [ ] Owner signs in and out; closing and reopening the browser keeps the owner signed in.
- [ ] Owner creates a test employee on the Team screen, copies the temporary password; the employee signs in and changes it.
- [ ] Employee visiting `<URL>/owner` is sent to Jobs.
- [ ] A deactivated test employee can't sign in.
- [ ] Owner creates, edits, and makes a test job available; one employee claims, another joins; both see each other's updates.
- [ ] Step edit leases: a second employee sees the step in use; the owner clears a hold and the first employee is stopped.
- [ ] Picture and video proof upload with progress; a video upload interrupted by Airplane Mode resumes; proof opens for the owner and team only.
- [ ] Owner marks Base Coat Installed and Top Coat Installed; Completion Work order; Mark Job Complete.
- [ ] Owner joins as Owner · Working Member, works a step, and leaves.
- [ ] Custom Step Library: create a step, import it into a test job; a reference picture shows as guidance.
- [ ] Owner reopens a step with a reason; the earlier attempt stays.
- [ ] Owner Dashboard updates within about 20 seconds; filters survive refresh.
- [ ] Pre-Week Setup: draft and autosave, shortage calculation, submit, owner reopen, history.
- [ ] Navigation shows "Pre-Week Setup", and the installation wording uses "installation"/"installed".
