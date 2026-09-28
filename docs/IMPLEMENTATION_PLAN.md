# Armour Ops Implementation Plan

This plan describes how to build the features in [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) on top of the existing Next.js application. `PRODUCT_SPEC.md` is the authority on workflow content and behavior. Where this plan and the spec disagree, the spec wins and this plan must be corrected.

No application code, dependencies, external services, or UI have been changed as part of writing this plan.

## Contents

1. [Starting point](#starting-point)
2. [Approved architecture](#approved-architecture)
3. [Technology and framework notes](#technology-and-framework-notes)
4. [User roles, accounts, and security](#1-user-roles-accounts-and-security)
5. [Database model](#2-database-model)
6. [Application routes and screens](#3-application-routes-and-screens)
7. [Workflow behavior](#4-workflow-behavior)
8. [Media uploads (Cloudflare R2)](#5-media-uploads-cloudflare-r2)
9. [Owner notifications](#6-owner-notifications)
10. [Weekly Setup](#7-weekly-setup)
11. [Build phases](#8-build-phases)
12. [Deferred from version one](#9-deferred-from-version-one)
13. [Decisions still required](#10-decisions-still-required)

Also: [Database backups](#database-backups) (in section 6).

---

## Starting point

The current repository is a visual shell only:

- Next.js 16.3 (App Router, `src/` directory, `@/*` alias), React 19.2, TypeScript, Tailwind CSS v4, ESLint.
- `src/app/layout.tsx` renders `AppHeader`, the page, and `BottomNav` (Jobs, Weekly Setup, Account).
- `src/app/jobs`, `src/app/weekly-setup`, and `src/app/account` render fictional data from `src/lib/mock-data.ts`.
- `JobCard`, `PageHeading`, and `Icons` are reusable presentational components.
- The palette (charcoal and muted gold) is defined in `src/app/globals.css` as Tailwind theme tokens.
- `.gitignore` already excludes `.env*` files except `.env.example`.

Gaps between the shell and the spec that later phases will close:

- Mock `JobStatus` values (`In Progress`, `Scheduled`, `Open`) do not match the spec's statuses.
- The Jobs screen has "My Active Job" and "Available Jobs". The spec requires My Current Jobs, Other Active Jobs, Available Jobs, Scheduled Jobs, and Completed Jobs.
- `JobCard` does not yet show the lead and assigned employees, current step, or last activity time.
- Mock jobs split address into `address` and `city` and include a `projectType` field the spec does not define.
- The Account screen shows Crew and Employee ID, which the spec does not require. It will show name and role only.
- All buttons (Claim, Open, Sign Out, checklist) are visual only.

The existing visual components will be kept and fed real data rather than rewritten. Mock data stays fictional until it is removed.

## Approved architecture

| Concern | Service | Notes |
| --- | --- | --- |
| Application hosting | Cloudflare Workers Free, using the OpenNext adapter (`@opennextjs/cloudflare`) | Vercel and Cloudflare Pages are not used. Full Next.js compatibility is tested before production deployment. The plan is upgraded only if actual usage requires it. |
| Database, auth, security rules, app data | Supabase Free | Postgres, Supabase Auth (email and password), Row Level Security. Also stores all media metadata and authorization relationships. |
| Employee pictures and videos | Cloudflare R2 (private bucket) | Supabase Storage is **not** used for job media. |
| Database backups | Weekly export to the private R2 bucket | Newest 12 weekly backups kept, older ones deleted automatically. See [Database backups](#database-backups). |
| Scheduled jobs | Cloudflare Workers Cron Triggers | Media retention deletion and stale upload cleanup. |
| Owner notification email | None in version one | Approved owner decision: owner notifications are in-app only (status, badges, and the Owner Dashboard). Employees text the owner when a job is ready for an installation. Email remains a possible future feature. |

The goal is to stay free or extremely inexpensive at the current company size.

**Free-tier limits to keep in mind** (at the time of writing; recheck when each service is set up):

- Supabase Free: a small database size cap (500 MB), a pause after a week with no activity (daily use prevents this), and no automatic backups. The database will hold text and metadata only, so it should stay well under the cap.
- Cloudflare R2: 10 GB of storage per month free, no charge for downloads (egress), then about $0.015 per GB per month.
- Cloudflare Workers Free: a daily request allowance, a small CPU-time limit per request, and a compressed size limit for the deployed app. Server rendering and the app's bundle size must fit within these. The hosting compatibility check measures both, and the Workers Paid plan is the upgrade path only if real usage exceeds them.
- **Rough media estimate:** each job has five required videos (four in Initial Prep, one in Top-Coat Prep). At about 60 MB per minute for 1080p/30 fps Most Compatible video and one to two minutes each, a job produces roughly 0.35–0.65 GB including pictures. At 100 jobs a year with five-year retention, storage would grow by about 35–65 GB a year, roughly $0.50–$1 more per month each year. This is an estimate for planning, not a quote.

## Technology and framework notes

Planned additions, installed only in the phase that needs them:

| Package | Phase | Purpose |
| --- | --- | --- |
| `@supabase/supabase-js`, `@supabase/ssr` | 1 | Database and auth clients with cookie-based sessions |
| `server-only` | 1 | Makes the build fail if a module holding secrets is imported into browser code |
| `zod` | 1 | Server-side validation of every form and action input |
| Supabase CLI (dev dependency) | 1 | Local database, migrations, type generation, database tests |
| `vitest` | 1 | Unit tests for pure logic (sign-in validation, redirects, workflow, inventory) |
| `@playwright/test` | Later, when a dedicated test Supabase project exists | End-to-end tests with iPhone viewport emulation |
| `@opennextjs/cloudflare`, `wrangler` and `esbuild` (dev dependencies) | Hosting check (added) | Build and preview the app on Cloudflare Workers |
| `aws4fetch` | 6 | Server-side R2 requests and presigned URLs (R2 is S3-compatible). Chosen over the much larger AWS SDK to stay within the Workers Free size limit. |

Supabase Storage and browser-side upload libraries that need storage credentials are not used.

Next.js 16 conventions that affect this plan (from `node_modules/next/dist/docs/`):

- **`proxy.ts` replaces `middleware.ts`.** It lives in `src/proxy.ts`. It refreshes the Supabase session cookie and redirects signed-out users to `/sign-in`. The docs state Proxy is for optimistic checks only and must not be the only authorization layer.
- **Data Access Layer (DAL).** Authorization is enforced close to the data: a `src/lib/dal.ts` module with `cache()`-wrapped `requireUser()` and `requireOwner()` functions, called from every page, Server Action, and Route Handler that touches data. Row Level Security is the final enforcement layer.
- **Do not rely on layouts for auth checks.** Layouts do not re-render on navigation and do not stop nested segments from rendering. Each page and action checks for itself.
- **Server Actions are public POST endpoints** and must re-check auth and role inside every action.
- **Server Action request bodies are capped at 1 MB by default.** Pictures and videos therefore upload directly from the browser to R2 using presigned URLs, never through a Server Action.
- **Dynamic route `params` are Promises** and are typed with the generated `PageProps<'/jobs/[jobId]'>` helpers, matching the existing `LayoutProps<'/'>` usage.
- The experimental `authInterrupts` (`forbidden()` / `unauthorized()`) will not be used. Standard `redirect()` and `notFound()` are sufficient.

### Secrets

| Secret | Where it lives | Never |
| --- | --- | --- |
| Supabase URL and publishable key | `.env.local`, later Cloudflare Workers environment variables | Safe for the browser by design, protected by RLS |
| Supabase secret key (`SUPABASE_SECRET_KEY`, the `sb_secret_...` key) | `.env.local` during development, a Cloudflare Workers secret once deployed. Read only by `src/lib/supabase/admin.ts` (`server-only`) | Never prefixed `NEXT_PUBLIC_`, never in browser code, logs, error messages, or the repository |
| R2 account ID, access key ID, secret access key, bucket name | Server environment only, read only by `src/lib/r2.ts` (`server-only`) | Never in browser code or the repository |

OpenNext copies every variable from the `.env*` files into the Worker bundle. `npm run cf:build` therefore runs `scripts/cf-protect-secrets.mjs` afterwards. It keeps only `NEXT_PUBLIC_` variables in the bundled env module, then scans the whole `.open-next` output for the value of every server-only variable and fails the build (naming the variable, never printing the value) if one is found. Server secrets for the deployed app are stored as Cloudflare Workers secrets. Secrets for the weekly backup job are stored as encrypted GitHub Actions secrets. Local Workers preview files (`.dev.vars`) are added to `.gitignore` when hosting is set up.

`.env.example` lists variable names with placeholder values only. No real names, email addresses, or credentials appear in the repository, documentation, mock data, migrations, or seed files.

---

## 1. User roles, accounts, and security

### Roles

| Role | Stored as | Summary |
| --- | --- | --- |
| Owner/Admin | `profiles.role = 'owner'` | Full read access, and management of jobs, teams, steps, milestones, the Custom Step Library, reference pictures, Weekly Setup submissions, and the Team screen. Changes employee step work (checks, entries, proof, Complete Step) only after joining the job as an Owner/Working Member (Phase 8). More than one owner account is supported. |
| Employee | `profiles.role = 'employee'` | Read-only access to every job visible to employees. Full working access to jobs they are assigned to. Submits Weekly Setup checks. |

### Authentication

- Supabase Auth with email and password, using cookie-based sessions via `@supabase/ssr`.
- Public sign-up is turned off in Supabase. Every employee account is created by the owner.
- Roles are read from `profiles` in the database by the DAL. No JWT custom claims are needed. (A Supabase custom access token hook could later copy the role into the JWT for optimistic redirects in `proxy.ts`, but it is not required.)
- Supabase Auth sends no email in version one. There are no invitation or password-reset emails. The owner creates accounts with temporary passwords and sends them to employees by text.
- Supabase's **Secure password change** setting stays off. When on, it can require an emailed reauthentication code, which cannot be delivered without an email provider. Current-password checks are done by the app instead (see below).

### First owner account (bootstrap)

Because no real names or emails may be committed, the first owner account is created by hand, following a documented procedure with placeholders only:

1. In the Supabase dashboard, create the owner's user under Authentication.
2. In the dashboard SQL editor, run the documented one-line statement that sets that user's profile role to `owner`, pasting in the user ID at run time.

After this, the owner creates every other account from the Team screen.

### Team screen and temporary passwords

Owner-only screen at `/owner/team`. All account administration runs in Server Actions that call `requireOwner()` first and only then use the admin client in `src/lib/supabase/admin.ts`. That module imports `server-only` and reads `SUPABASE_SECRET_KEY`, so the build fails if browser code ever imports it. Admin API errors are mapped to plain messages; raw error objects and the key are never logged or returned.

| Capability | How it works |
| --- | --- |
| Create an employee account | Owner enters name, email, and role (employee by default). The server generates a temporary password and calls the Supabase admin `createUser` API with the email already confirmed. The `profiles` trigger creates the profile, and the server sets the name, role, and `must_change_password = true`. |
| Show the temporary password once | The password is returned only in that one Server Action response and shown in a dialog with a large **Copy** button and "This password will not be shown again." It lives only in that browser tab's memory and is gone when the dialog closes. It is never placed in a URL, cookie, database row, log, or activity record. |
| Generate a new temporary password | For a forgotten password. The server generates a new one, sets it with the admin `updateUserById` API, sets `must_change_password = true`, and shows it once the same way. The old password stops working immediately. |
| Deactivate | Sets `profiles.active = false` and bans the auth user through the admin API, which blocks sign-in and token refresh. DAL and RLS both check `active`, so access stops right away. Past activity is untouched. |
| Reactivate | Sets `active = true` and lifts the ban. |
| View role and status | Each row shows name, email, role, and status: Active, Temporary password (not yet changed), or Deactivated. |
| Change role | Later, when needed (not part of Phase 1B). Until then, roles are changed in the Supabase SQL editor. When built, the last active owner cannot be demoted. |
| Protect the owner's own account | Owners cannot deactivate themselves or reset their own password from the Team screen (they use Change Password on the Account screen), so the last active owner can never be locked out. |

**Temporary password generation (proposed values).** 16 characters from `crypto.getRandomValues`, using lowercase letters and digits with look-alike characters removed (no `0`, `o`, `1`, `l`, `i`), shown in groups of four such as `k7mq-3xtb-9hwr-2fzp` so it is easy to text and type on a phone. This gives roughly 80 bits of randomness. The hyphens are part of the password.

**Account history without secrets.** An `account_events` table records who created an account, issued a temporary password, deactivated, reactivated, or changed a role or password, and when. It never stores a password or any part of one.

### Changing your own password

- The Account screen has a **Change Password** form for every signed-in user: current password, new password, and confirm new password, each with show and hide.
- The server re-checks the current password by signing in with it, then calls Supabase `updateUser` with the new password, then clears `must_change_password` and records `password_changed` in `account_events`.
- Proposed rules: at least 10 characters, different from the current password, and the two new-password fields must match. The same minimum is set in Supabase's password settings.
- While `must_change_password` is true, the Jobs and Account screens show a prominent reminder to change the temporary password. It does not block work.

### Route protection (three layers)

1. **`src/proxy.ts` (optimistic).** It refreshes the session and redirects signed-out users to `/sign-in`. It runs on all routes except static assets and the `/auth/*` callback routes. It does not make role decisions.
2. **DAL (authoritative in app code).** `requireUser()` returns the signed-in, active user and profile or redirects to `/sign-in`. `requireOwner()` also verifies `role = 'owner'` from the database, not the JWT. Every page, Server Action, and Route Handler calls one of these.
3. **Row Level Security (authoritative in the database).** Even a bug in app code cannot expose or change rows the user is not permitted to access.

### Row Level Security

RLS is enabled on every table. `security definer` helper functions (with `search_path` set to empty) keep policies short:

- `is_active_user()`: the current user has an active profile.
- `is_owner()`: the current user is active and has role `owner`.
- `is_assigned(job_id)`: the current user is active and has an active (not removed) assignment on the job.

**Read access:**

| Data | Owner | Employee |
| --- | --- | --- |
| Profiles | All | Names and roles of active users (needed to show job teams). Email and account-status fields only for their own row. |
| Jobs | All | All jobs, including Scheduled jobs (read-only until made available) |
| Job assignments | All | For every job they can read |
| Job stages, steps, blocks, items, inputs, proof requirements | All | For every job they can read |
| Step attempts, responses, completion items | All | For every job they can read |
| Media metadata, and viewing media through the media route | All | For every job they can read |
| Job activity | All | For every job they can read |
| Workflow templates | All | None needed (jobs carry their own snapshot) |
| Trailers, inventory items | All | All active |
| Weekly Setup submissions and results | All | All submitted, plus their own drafts |

**Write access:**

- No role gets direct `insert`, `update`, or `delete` on workflow tables. Every write goes through a narrow Postgres function (RPC).
- **Employee job functions** (`save_step_draft`, `acquire_step_edit`, `release_step_edit`, `complete_step`, `create_media_intent`, `confirm_media`, `discard_media`, `set_completion_item`) first check `is_assigned(job_id)`. Unassigned employees therefore have read-only access to every job.
- **Team functions:** `claim_job` and `join_job` (employees, under the rules in [Job teams](#job-teams-and-atomic-claiming)).
- **Owner functions** start with an `is_owner()` check: `create_job`, `edit_job`, `make_available`, `return_to_scheduled`, `set_allow_join`, `add_team_member`, `remove_team_member`, `change_lead`, `mark_milestone_installed`, `mark_job_complete`, `reopen_step`, `skip_step`, `add_custom_step`, `remove_step`, `reorder_steps`, `edit_step`, `clear_step_edit`.
- Owner installation milestones can **only** be completed through `mark_milestone_installed`. No employee path can mark Base Coat Installed or Top Coat Installed.
- `job_activity`, completed step attempts, removed assignments, and submitted Weekly Setup results are append-only. There is no `update` or `delete` path for them. Corrections happen by reopening, which adds records.
- Weekly Setup writes go through `save_weekly_setup_draft` and `submit_weekly_setup`, available to any active user.

### Timestamps

- Every event time (`claimed`, `joined`, `assigned`, `removed`, `started`, `completed`, `uploaded`, `submitted`, milestone, and activity times) is set in the database with `now()` inside the RPC or by a column default. RPCs never accept these values from the browser.
- For future offline support, a separate informational `client_recorded_at` column may be added later. It will never replace the database timestamp.

---

## 2. Database model

All schema changes live in `supabase/migrations/*.sql`. Generated TypeScript types go in `src/lib/database.types.ts`. Primary keys are `uuid`. Client-generated UUIDs are accepted for step attempts and media so retried requests are idempotent, which also prepares for offline sync.

### Enums

| Enum | Values |
| --- | --- |
| `app_role` | `owner`, `employee` |
| `job_status` | `scheduled`, `available_to_claim`, `claimed`, `initial_prep_in_progress`, `waiting_for_base_coat_installation`, `base_coat_installed`, `top_coat_prep_in_progress`, `waiting_for_top_coat_installation`, `top_coat_installed`, `completion_work_in_progress`, `complete` |
| `assignment_role` | `lead`, `member` |
| `assignment_method` | `claimed`, `joined`, `added_by_owner`, `lead_change` |
| `assignment_end_reason` | `removed_by_owner`, `role_changed` |
| `stage_kind` | `employee_stage`, `owner_milestone`, `completion_work` |
| `step_state` | `locked`, `available`, `in_progress`, `completed`, `reopened`, `skipped` |
| `step_block_kind` | `ordered_list`, `reference_list`, `checklist` |
| `proof_media_type` | `picture`, `video` (proof type "none" means the step has no proof requirement rows) |
| `input_type` | `text`, `number`, `single_select` (structured input type "none" means the step has no input rows) |
| `attempt_status` | `draft`, `completed`, `superseded` |
| `media_status` | `pending`, `uploaded`, `failed`, `discarded`, `deleted` |
| `media_upload_method` | `single`, `multipart` |
| `inventory_tracking` | `count`, `status_only` |
| `inventory_status` | `ready`, `missing`, `need_more` |
| `activity_type` | `job_created`, `job_edited`, `made_available`, `returned_to_scheduled`, `join_setting_changed`, `claimed`, `employee_joined`, `employee_added`, `employee_removed`, `lead_changed`, `step_started`, `step_completed`, `step_reopened`, `step_skipped`, `step_added`, `step_removed`, `step_edited`, `steps_reordered`, `step_edit_cleared`, `media_uploaded`, `milestone_installed`, `completion_item_checked`, `completion_item_unchecked`, `status_changed`, `job_completed` |

Display labels for `job_status` match the spec wording exactly, for example `waiting_for_base_coat_installation` displays as "Waiting for Base-Coat Installation". There is no Blocked status in version one (see [Deferred](#9-deferred-from-version-one)).

### Step content structure

Standard and custom steps share one structure. A step has:

- A title, goal, optional reference pictures (owner-supplied guidance, never proof), and confirmation text.
- An ordered set of **content blocks**. Each block keeps its heading from the spec and has a kind:
  - `ordered_list`: numbered instructions, read only (for example "Instructions", "Choose the setup location").
  - `reference_list`: a visual list that is displayed but never checked item by item. Used for the **mixing-station checklist**, the **inside-work-area checklist**, and the **final action** in the two setup steps. "Second weenie roller when needed" is reference text inside the inside-work-area list.
  - `checklist`: items the employee must tick. Every **Final check** is a checklist, with all items required, unless the spec says otherwise.
- Zero or more **structured inputs** (text, number, single-select), each with label, required flag, optional unit, and choices.
- Zero or more **proof requirements**, each with a label, media type (picture or video), minimum count, and whether more than one file is allowed (for "one picture of each completed garage-door line" or "one picture showing each protected drain").

Only `checklist` items create checklist responses. This keeps the setup reference lists out of validation while leaving them fully visible on the step screen.

### Tables

#### People

**`profiles`**
`id` (PK, FK `auth.users.id`), `full_name`, `email` (copy for the Team screen), `role app_role`, `active bool default true`, `must_change_password bool default false`, `temp_password_issued_at`, `temp_password_issued_by`, `password_changed_at`, `deactivated_at`, `deactivated_by`, `created_at`, `updated_at`.
Rows are created by a trigger on `auth.users` and changed only by owner Team actions, except that a user's own password change clears `must_change_password` and sets `password_changed_at` through a server-only path. Temporary passwords are never stored here.

#### Workflow templates (the approved workflow)

Templates are seeded from `PRODUCT_SPEC.md` by a migration and versioned. Jobs never reference template rows for content.

**`workflow_templates`**
`id`, `name`, `version int`, `is_current bool` (partial unique index: one current), `created_at`.

**`stage_templates`**
`id`, `workflow_template_id` FK, `position`, `key` (`initial_prep`, `base_coat_installation`, `top_coat_prep`, `top_coat_installation`, `completion_work`), `name`, `kind stage_kind`.

**`step_templates`**
`id`, `stage_template_id` FK, `position`, `key`, `title`, `goal`, `reference_image_key` (nullable, R2 object key), `confirmation_text`, `applies_when` (nullable: `caulking_required` or `baseboard_required`, used for the Completion Work items).

**`step_template_blocks`**
`id`, `step_template_id` FK, `position`, `heading`, `kind step_block_kind`.

**`step_template_block_items`**
`id`, `block_id` FK, `position`, `text`, `required bool default true` (only meaningful for `checklist` blocks).

**`step_template_inputs`**
`id`, `step_template_id` FK, `position`, `label`, `input_type`, `required bool`, `unit` (nullable), `choices text[]` (single-select only).

**`step_template_proof_requirements`**
`id`, `step_template_id` FK, `position`, `label`, `media_type proof_media_type`, `min_count int default 1`, `allow_multiple bool`.

#### Jobs and per-job snapshots

**`jobs`**
`id`, `job_number` (human-readable, sequence-backed), `client_name`, `address`, `square_feet int`, `flake_color`, `scheduled_date date`, `general_notes`, `caulking_required bool default true`, `baseboard_required bool default false`, `allow_employees_to_join bool default true`, `status job_status default 'scheduled'`, `workflow_template_id` (version copied, reference only), `made_available_at`, `claimed_at`, `last_activity_at`, `completed_at`, `completed_by`, `media_delete_after` (set to `completed_at + 5 years` when the owner completes the job), `created_by`, `created_at`, `updated_at`.

**`job_assignments`** (the job team)
`id`, `job_id` FK, `employee_id` FK profiles, `role assignment_role`, `method assignment_method`, `assigned_at default now()`, `assigned_by` (the employee themselves for `claimed` and `joined`, otherwise the owner), `last_activity_at`, `ended_at` (nullable), `ended_by`, `end_reason assignment_end_reason`.

- Partial unique index on `(job_id, employee_id) where ended_at is null`: no duplicate active assignment for the same employee and job.
- Partial unique index on `(job_id) where role = 'lead' and ended_at is null`: at most one active lead per job.
- No limit on how many active jobs an employee can belong to.
- Changing the lead ends the affected rows with `role_changed` and inserts new rows with method `lead_change`, so every role period stays in history.
- Removing an employee sets `ended_at`. Their earlier attempts, uploads, and activity keep pointing at their profile and are never deleted.

**`job_stages`** (snapshot of `stage_templates`)
`id`, `job_id` FK, `position`, `key`, `name`, `kind`, `unlocked_at`, `completed_at`, `completed_by`. For owner milestones, `completed_at` and `completed_by` record who marked the coat installed and when.

**`job_steps`** (snapshot of `step_templates`, plus custom steps)
`id`, `job_stage_id` FK, `position`, `source_step_template_id` (null for custom steps), `is_custom bool`, `title`, `goal`, `reference_image_key`, `confirmation_text`, `applies_when`, `state step_state`, `current_attempt_id`, `skipped_at`, `skipped_by`, `skip_reason`, `removed_at`, `removed_by` (soft delete keeps history), `created_at`, `updated_at`.

**`job_step_blocks`**, **`job_step_block_items`**, **`job_step_inputs`**, **`job_step_proof_requirements`**
Same columns as their template counterparts, keyed to `job_steps`.

`create_job` copies every template row for the current workflow version into these tables in one transaction. Later template edits do not affect existing jobs. Owner edits to a job change only that job's snapshot rows.

#### Step execution and history

**`step_attempts`**
`id` (client-generated allowed), `job_step_id` FK, `attempt_number`, `status attempt_status`, `started_by`, `started_at`, `editing_by` (nullable), `editing_expires_at` (nullable), `completed_by`, `completed_at`, `employee_notes`, `confirmation_text_shown`, `superseded_at`, `superseded_by_reopen_id`.

**`step_checklist_responses`**
`attempt_id` FK, `block_item_id` FK (checklist items only), `item_text_shown`, `checked bool`, `updated_by`, `updated_at`. PK `(attempt_id, block_item_id)`.

**`step_input_responses`**
`attempt_id` FK, `input_id` FK, `label_shown`, `value_text`, `value_number numeric`, `value_choice`, `updated_by`, `updated_at`. PK `(attempt_id, input_id)`.

**`step_reopenings`**
`id`, `job_step_id` FK, `reopened_by`, `reopened_at default now()`, `reason`, `previous_attempt_id`.

**`job_completion_items`**
`id`, `job_id` FK, `kind` (`caulking` or `baseboard`), `label` ("Caulking Complete" or "Baseboard Complete"), `checked bool`, `checked_by`, `checked_at`.
Rows exist only for toggles that are on. Each change is also written to `job_activity`.

`updated_by` and `completed_by` record the specific employee for every response and completion, so shared work on a team is always attributed.

#### Media (metadata in Postgres, files in R2)

**`media_assets`**
`id` (client-generated), `job_id` FK, `job_step_id` FK, `attempt_id` FK, `proof_requirement_id` FK, `uploaded_by`, `media_type proof_media_type`, `object_key` (unique R2 key), `mime_type`, `declared_size_bytes`, `size_bytes` (confirmed from R2), `duration_seconds` (reported by the browser, informational), `upload_method media_upload_method`, `r2_upload_id` (multipart only), `status media_status`, `created_at`, `uploaded_at`, `deleted_at`.

Reference pictures for steps are separate from proof: their own records, their own private R2 keys (`reference/...`), and their own access check. They are uploaded by the owner through the same direct-upload flow (Phase 8).

#### Activity and milestones

**`job_activity`** (append-only audit history)
`id bigint identity`, `job_id` FK, `actor_id`, `activity_type`, `job_step_id` (nullable), `details jsonb`, `created_at default now()`. Written only by RPCs.

**`job_milestones`** (append-only, Phase 7)
`id`, `job_id` FK, `job_stage_id`, `milestone_key` (`base_coat_installation` or `top_coat_installation`), `installed_by`, `installed_at default now()`, unique per job and milestone. Written only by `mark_milestone_installed`.

There is no notifications table: owner notifications are in-app status, badges, and the Owner Dashboard (approved owner decision).

#### Weekly Setup

See [Weekly Setup](#7-weekly-setup) for the behavior.

**`trailers`**
`id`, `name`, `active bool`, `position`. Seeded with two generic names ("Trailer 1", "Trailer 2"). The owner can rename them.

**`inventory_items`** (one shared list used by both trailers)
`id`, `category`, `position`, `label`, `tracking inventory_tracking`, `target_quantity int` (null for `status_only`, otherwise greater than 0), `unit_label` (nullable, for example "brushes"), `active bool`.

**`weekly_setup_submissions`**
`id`, `trailer_id` FK, `submitted_by`, `started_at`, `submitted_at` (null while draft), `restock_notes`.

**`weekly_setup_item_results`**
`submission_id` FK, `inventory_item_id` FK, `category_shown`, `label_shown`, `tracking_shown`, `target_quantity_shown`, `unit_label_shown`, `usable_quantity int` (0 or more, count items only), `selected_status inventory_status` (status-only items only), `status inventory_status` (**generated column**), `shortage int` (**generated column**), `note`. PK `(submission_id, inventory_item_id)`.

For count items, `status` is generated as Missing when `usable_quantity = 0`, Need More when it is below `target_quantity_shown`, and Ready otherwise. `shortage` is generated as `target_quantity_shown - usable_quantity` when that is positive. Because they are generated columns, nobody can set a count item's status by hand. For status-only items, `status` equals `selected_status` and `shortage` is null.

The view **`trailer_current_condition`** returns each trailer's latest submitted check with its Missing and Need More items, shortages, notes, restock notes, submitter, and time.

### Relationships (summary)

```
profiles 1─* job_assignments *─1 jobs          (one active lead, many members, history kept)
jobs 1─* job_stages 1─* job_steps 1─* job_step_blocks 1─* job_step_block_items
                             job_steps 1─* job_step_inputs
                             job_steps 1─* job_step_proof_requirements
                             job_steps 1─* step_attempts 1─* step_checklist_responses
                                                       1─* step_input_responses
                                                       1─* media_assets ── object in R2
                             job_steps 1─* step_reopenings
jobs 1─* job_completion_items
jobs 1─* job_activity
jobs 1─* job_milestones *─1 profiles (owner)
workflow_templates 1─* stage_templates 1─* step_templates 1─* (template blocks, items, inputs, proof requirements)
trailers 1─* weekly_setup_submissions 1─* weekly_setup_item_results *─1 inventory_items
```

### Job teams and atomic claiming

**Claiming (first employee becomes lead).** `claim_job(job_id)` runs in one transaction:

1. Verify the caller is an active user.
2. `update jobs set status = 'claimed', claimed_at = now() where id = $1 and status = 'available_to_claim' returning id`. Only one concurrent caller can match this row; the others see zero rows.
3. If no row is returned, return "already claimed" (the app then offers Join if allowed).
4. Insert the caller's `job_assignments` row with role `lead` and method `claimed`. The one-lead partial unique index is a second safeguard: a racing second lead insert fails and rolls back its transaction.
5. Write `job_activity` and update `last_activity_at`.

**Joining.** `join_job(job_id)` succeeds only when `allow_employees_to_join` is on, the job is past Available to Claim and not Complete, and the caller has no active assignment on it (enforced by the unique index). It inserts a `member` assignment with method `joined`.

**Owner team management.**

- `add_team_member(job_id, employee_id)`: adds a member. If the job is Available to Claim and has no lead, the added employee becomes the lead and the job moves to Claimed.
- `remove_team_member(job_id, employee_id, new_lead_id?)`: ends the assignment. If the lead is removed while others remain, the owner picks the new lead in the same action. If nobody remains, the job keeps its status and shows as "No team assigned" on the owner dashboard.
- `change_lead(job_id, employee_id)`.
- `set_allow_join(job_id, on_or_off)`.
- `return_to_scheduled(job_id)`: allowed only when the job has no active assignments and no step has been started.

There is no employee path to transfer, leave, or reassign a job. Every team change is recorded in `job_assignments` and `job_activity`.

### One editor per step attempt

To prevent conflicting updates when several employees work the same job:

- Opening a step for editing calls `acquire_step_edit(step_id)`, which sets `editing_by` and `editing_expires_at` on the current attempt. It succeeds only if nobody holds the edit, the previous hold has expired, or the caller already holds it.
- Every draft save and upload action requires holding the edit and extends it. The step screen also renews it while open, and releases it on leave.
- Other assigned employees see the step read-only with "Being edited by [name]", and can take over once the hold expires.
- The owner can clear a hold with `clear_step_edit` (recorded in activity).
- Proposed technical defaults: hold length 2 minutes, renewed every 30 seconds while the screen is open.

---

## 3. Application routes and screens

All routes are under `src/app`. Route groups keep layouts separate without affecting URLs.

### Shared

| Route | Screen |
| --- | --- |
| `/sign-in` | Email and password form (Server Action). Large inputs and button. No sign-up link. |
| `/` | Redirects to `/jobs` for employees and `/owner` for owners. |
| `/account` | Name, role, and a working Sign Out. |
| `/media/[mediaId]` | Route Handler. Checks access and redirects to a short-lived R2 viewing link (see [Media](#5-media-uploads-cloudflare-r2)). |

### Employee (`(employee)` route group, bottom nav: Jobs, Weekly Setup, Account)

| Route | Screen |
| --- | --- |
| `/jobs` | **Employee Jobs**, in five sections: **My Current Jobs** (every job they are assigned to that is not complete), **Other Active Jobs** (in-progress jobs they are not on, read-only, with **Join** when allowed), **Available Jobs** (with **Claim Job**), **Scheduled Jobs** (read-only, no Claim or Join), and **Completed Jobs**. Job cards show client name, address, square footage, flake color, scheduled date, lead and assigned employees, status, current step, progress, and last activity time. |
| `/jobs/[jobId]` | **Job details and stage overview.** Job information, general notes, the team (lead marked), and each stage with per-step state. Assigned employees get **Continue**. Unassigned employees see the same content read-only with **Claim Job**, **Join Job**, or "Ask the owner to add you", depending on status and the join setting. Scheduled jobs show "Not available yet" with no Claim or Join. Owner milestones appear as waiting or installed, with no installation instructions. Completion Work shows the applicable checkboxes to assigned employees. |
| `/jobs/[jobId]/steps/[stepId]` | **Step details.** Title, goal, reference image, instructions, reference lists, Final check, structured inputs, proof slots with upload progress, employee notes, the confirmation statement, and **Complete Step**. Shows "Being edited by [name]" when another employee holds the edit. Completed steps open read-only with who completed them, when, and their evidence. Unassigned employees always get the read-only view. |
| `/weekly-setup` | **Weekly Setup.** Both trailer cards with their latest status and shortage count. |
| `/weekly-setup/[trailerId]` | **Trailer inventory.** The shared list grouped by category (see [Weekly Setup](#7-weekly-setup)). |

Claiming and joining are actions on `/jobs` and `/jobs/[jobId]`, not separate pages. Evidence upload happens inline on the step screen.

### Owner (`/owner`, owner layout with nav: Dashboard, Jobs, Weekly Setup, Team, Account)

| Route | Screen |
| --- | --- |
| `/owner` | **Owner dashboard.** Jobs grouped by Scheduled, Available, In progress, Waiting for installation, Ready for owner review, and Completed. Counts and links for jobs waiting for each installation and ready to mark Complete (Phase 7), jobs with no team assigned, and trailer shortages. |
| `/owner/jobs/new` | **Owner job creation.** All job fields, the Caulking toggle (on by default), the Baseboard toggle (off by default), the Allow Employees to Join setting (on by default), and optional custom steps. New jobs are saved as Scheduled. |
| `/owner/jobs/[jobId]` | **Owner progress monitoring and review.** Status, team, current step, progress, activity timeline, every step with completion time and person, evidence viewer, and completion items. Controls: **Make Available**, **Return to Scheduled**, **Allow Employees to Join**, add, remove, and change lead, **Mark Base Coat Installed** (only when Waiting for Base-Coat Installation), **Mark Top Coat Installed** (only when Waiting for Top-Coat Installation), and **Mark Job Complete** (only when the job is ready; see below). |
| `/owner/jobs/[jobId]/edit` | **Owner job editing.** Job details and toggles, plus the step editor: add a custom step, remove, reorder, skip, and edit steps for this job only. |
| `/owner/jobs/[jobId]/steps/new` | **Custom step editor.** Step name, stage, position, instructions, optional reference picture, optional checklist, required proof type (none, picture, or video), structured inputs, and final confirmation text. The same form edits existing steps. |
| `/owner/jobs/[jobId]/steps/[stepId]` | All attempts of one step, including superseded ones, with responses, media, notes, who did what, and timestamps. Reopen, skip, edit, and clear-edit-hold actions. |
| `/owner/team` | **Team screen** (see [Team screen and temporary passwords](#team-screen-and-temporary-passwords)). |
| `/owner/weekly-setup` | Current condition of both trailers and submission history. |
| `/owner/weekly-setup/[submissionId]` | One submission in full. |

Owners can also open employee routes to see exactly what employees see.

### Supporting source layout

```
src/
  proxy.ts                         session refresh and optimistic redirects
  lib/
    supabase/server.ts             server client (cookies)
    supabase/browser.ts            browser client (realtime only)
    supabase/admin.ts              secret-key admin client, server-only, Team actions only
    r2.ts                          R2 client and presigning, server-only
    dal.ts                         requireUser(), requireOwner()
    database.types.ts              generated
    workflow/                      pure functions: unlocking, progress, validation, status labels
    inventory/                     pure functions: status and shortage calculation
    actions/                       Server Actions grouped by area
  components/                      existing components, extended (JobCard, StepChecklist, ProofUploader, ...)
supabase/
  migrations/                      schema, RLS, functions, seed of the approved workflow and inventory list
  tests/                           database tests for RLS and RPCs
```

---

## 4. Workflow behavior

### How steps unlock

- Stages run in order: Initial Prep, Base-Coat Installation (owner milestone), Top-Coat Prep, Top-Coat Installation (owner milestone), Completion Work.
- A stage unlocks when the previous stage is complete. An employee stage is complete when every non-removed step is `completed` or `skipped`. A milestone stage is complete when the owner marks it installed.
- Within an employee stage, steps run in position order. A step becomes `available` when every earlier step in the stage is `completed` or `skipped`.
- Everyone can see later steps' titles as locked and open earlier completed steps read-only.
- Unlocking is computed in Postgres inside the RPCs (the source of truth) and mirrored by pure TypeScript functions in `src/lib/workflow/` for display and unit tests.

### How required checklist items are validated

- Only `checklist` blocks are validated. Every required item on the current attempt must be checked before completion.
- `reference_list` blocks (the mixing-station and inside-work-area lists and the final action in the setup steps) are displayed only and never block completion.
- The step screen disables **Complete Step** and lists what is missing. `complete_step` re-checks on the server.

### How structured inputs are validated

- `text`: required inputs must be non-blank after trimming. A proposed maximum of 2,000 characters applies.
- `number`: must parse as a number. Required inputs must be present. Negative values are rejected. Whole numbers are enforced for counts ("Full boxes recovered").
- `single_select`: the value must exactly match one of the stored choices ("None", "¼ box", "½ box", "¾ box" for Additional flake).
- The same rules run in `zod` (Server Action), in the browser (instant feedback), and in `complete_step` (final authority).

### How uploads are validated

- Each proof requirement needs at least `min_count` media records with `status = 'uploaded'` on the current attempt, of the required media type.
- A media record only becomes `uploaded` after the server confirms the object exists in R2 with an allowed type and size.
- Pending or failed uploads do not count.

### How a step is completed

1. An assigned employee opens an available step and takes the edit hold. The first saved change creates a `draft` attempt and records `step_started` (and moves the job into the stage's "in progress" status if it is the first activity in that stage).
2. Checklist ticks, input values, and notes **autosave** as they change (checkboxes immediately, text after a short pause). A "Saved" indicator confirms each save. Each save records the employee who made it.
3. Uploads attach to the current attempt as they finish.
4. When all requirements are met, the confirmation statement is shown with **Complete Step**. Pressing it is the confirmation.
5. `complete_step(attempt_id)` checks the caller is assigned and holds the edit, re-validates everything, sets `completed_by = auth.uid()` and `completed_at = now()`, stores the confirmation text shown, marks the step `completed`, releases the hold, unlocks the next step, updates progress, status, and `last_activity_at`, and writes activity. All in one transaction.
6. After completion the step is read-only for employees.

### How progress is calculated

- Units: every non-removed, non-skipped employee step, plus each owner milestone as one unit, plus each applicable Completion Work item.
- Progress = completed units ÷ total units, rounded to a whole percent.
- A reopened step counts as not completed until it is completed again.
- Computed in a Postgres view (`job_progress`) so job cards, the dashboard, and the job page always agree.
- "Current step" is the first step that is `available`, `in_progress`, or `reopened`. When a milestone is pending, the waiting status is shown instead.

### How jobs move between statuses

| From | Event | To |
| --- | --- | --- |
| (new) | Owner creates job | Scheduled |
| Scheduled | Owner selects Make Available | Available to Claim |
| Available to Claim | Owner selects Return to Scheduled (no team, no work started) | Scheduled |
| Available to Claim | First employee claims, or owner adds the first employee | Claimed |
| Claimed | First Initial Prep activity | Initial Prep in Progress |
| Initial Prep in Progress | Last Initial Prep step completed | Waiting for Base-Coat Installation (owner notified) |
| Waiting for Base-Coat Installation | Owner selects Mark Base Coat Installed | Base Coat Installed (Top-Coat Prep unlocks) |
| Base Coat Installed | First Top-Coat Prep activity | Top-Coat Prep in Progress |
| Top-Coat Prep in Progress | Last Top-Coat Prep step completed | Waiting for Top-Coat Installation (owner notified) |
| Waiting for Top-Coat Installation | Owner selects Mark Top Coat Installed | Top Coat Installed (Completion Work unlocks) |
| Top Coat Installed | First completion item checked | Completion Work in Progress |
| Top Coat Installed or Completion Work in Progress | Owner selects Mark Job Complete | Complete |

Joining, adding, or removing team members does not change the status. Status changes happen only inside RPCs, and each writes a `status_changed` activity record.

### How owner milestones unlock the next employee stage

- When the last step of Initial Prep completes, `complete_step` sets Waiting for Base-Coat Installation, and the job appears on the Owner Dashboard (see [Owner notifications](#6-owner-notifications)).
- Employees see a waiting screen for the milestone. It contains no installation instructions.
- Only `mark_milestone_installed(job_id, stage_key)` (owner only) completes it. It records the owner and database time in `job_milestones`, sets Base Coat Installed, and unlocks Top-Coat Prep. The top coat works the same way and unlocks Completion Work.
- The function refuses to run unless the job is in the matching waiting status.

### How owner reopening works

- The owner can reopen any completed step on a job that is not Complete, and must give a reason.
- `reopen_step` marks the current attempt `superseded` (keeping every response, media file, name, and timestamp), creates a `step_reopenings` record, sets the step to `reopened`, and writes activity.
- The step appears at the top of the job for the team as needing to be redone. Any assigned employee completes a new attempt using the same rules.
- Reopening an earlier step does not undo later completed steps or milestones, and the job status never moves backward. While any step is reopened: later unfinished steps stay locked until it is completed again; the installation milestone after its stage cannot be marked; Completion Work stays locked; and the job cannot be completed.
- Complete jobs cannot be reopened (they are read only).

### Other owner step edits (per job only)

- **Add custom step:** same structure as standard steps, one-time or imported from the Custom Step Library, at the chosen employee stage and position. Custom steps cannot be added to owner milestone stages or Completion Work. On an active job, only safe positions are allowed: in a preparation stage the job has not finished, and before only steps nobody has started. Complete jobs cannot be changed.
- **Remove:** (Phase 8: only custom steps on jobs not yet claimed, where no work can exist.) Later: soft delete. The step keeps its history and drops out of progress.
- **Reorder:** changes positions for steps that are not yet completed.
- **Skip:** marks the step `skipped` with owner and time. It counts as satisfied for unlocking and is excluded from progress.
- **Edit:** changes the job's snapshot rows. Completed attempts keep the text shown at the time.

### Completion work and final completion

- Completion Work items are generated from the job toggles: "Caulking Complete" only when caulking is required, and "Baseboard Complete" only when baseboard is required. They are updated if the owner changes the toggles before Completion Work starts.
- Each item is a single checkbox with no detailed instructions, sub-checklists, or proof requirements.
- **Any assigned employee** can check or uncheck an applicable item. Each change records the employee and time.
- A job is **ready for owner review** when all applicable items are checked (or none apply), the top coat is installed, and no step is reopened. It then appears in the owner dashboard's "Ready for owner review" group.
- **Only the owner** can select **Mark Job Complete**. Before doing so, the owner job page shows a review of every stage and step with who completed it and when, all evidence, the completion items, and the full activity history.
- `mark_job_complete` re-checks readiness, sets Complete, `completed_at`, `completed_by`, and `media_delete_after`, and writes activity. Team assignments stay in place so the job appears under each employee's Completed Jobs.

### When something goes wrong

In version one, employees text or call the owner. There is no in-app problem report and no Blocked status. The owner can use existing controls (reopen, skip, edit steps, and team changes) in response.

---

## 5. Media uploads (Cloudflare R2)

The approved limits and formats are in the spec's [Pictures and videos](./PRODUCT_SPEC.md#pictures-and-videos) section. Values below marked **proposed** are technical defaults that can change without affecting the approved limits.

### Bucket and credentials

- One **private** R2 bucket for job media (a separate bucket for development). Public access and the public `r2.dev` URL stay disabled.
- An R2 API token scoped to that bucket only, with object read and write permission. Its keys live only in the server environment and are read only by `src/lib/r2.ts`, which imports `server-only`.
- Bucket CORS allows `PUT` and `GET` only from the app's origins (localhost in development, the production domain later) and exposes the `ETag` header, which multipart uploads need.
- Object keys are generated by the server:
  - Step evidence: `jobs/{job_id}/steps/{job_step_id}/{attempt_id}/{media_id}.{ext}`
  - Step reference images: `reference/{step_id}/{media_id}.{ext}`

### Accepted formats and approved limits

| Kind | Accepted | Limits |
| --- | --- | --- |
| Pictures | JPEG, HEIC/HEIF, PNG | Original up to 25 MB. Compressed in the browser before upload, targeting about 1–5 MB, with a hard maximum of 5 MB. |
| Videos | MOV, MP4 | Up to 3 minutes and 300 MB. Employee iPhones record in Most Compatible format at 1080p, 30 fps. |

### Mobile compression

- **Pictures:** decoded and resized in the browser (proposed: 2,560 pixels on the long edge, JPEG at about 80% quality), stepping the quality down if needed to stay at or under 5 MB. iPhone Safari decodes HEIC natively. If a desktop browser cannot decode a HEIC file, the app asks for a JPEG instead.
- **Videos:** not compressed in the browser, which is not reliable on iPhone Safari. The Most Compatible, 1080p, 30 fps camera setting controls size. The app reads the file size and duration before upload, shows the size, and blocks files over 300 MB or 3 minutes with a clear message.
- The upload control opens the iPhone camera or photo library directly (`accept="image/*"` or `accept="video/*"`).

### Server-authorized upload intents

1. The employee picks or records a file in a proof slot. The browser prepares it (compression, size and duration check).
2. The browser calls the Server Action `createUploadIntent(requirementId, type, size, duration)`.
3. The action calls `requireUser()`, then the RPC `create_media_intent`. The RPC checks the caller is assigned to the job, holds the step's edit, the step is open, the requirement allows another file, and the type and size are within limits. It inserts a `pending` `media_assets` row and returns its object key.
4. Only then does the server create temporary upload authorization with the R2 keys:
   - **Pictures (single upload):** one presigned `PUT` URL bound to the object key, content type, and exact content length. Proposed expiry: 10 minutes.
   - **Videos (multipart upload):** the server starts an R2 multipart upload, stores the `r2_upload_id` on the media row, and returns presigned `UploadPart` URLs in batches. Proposed part size: 10 MB (R2 requires every part except the last to be the same size). Proposed URL expiry: 1 hour.
5. The browser uploads directly to R2. Each part is sent with `XMLHttpRequest` so a progress bar can show the percentage for the file.
6. For videos, the browser sends the part numbers and `ETag`s to `completeUpload(mediaId)`. The server completes the multipart upload.
7. `confirmUpload(mediaId)` (or the completion step above) reads the object's metadata from R2, checks size and content type against the media row and the limits, and calls `confirm_media`, which marks the row `uploaded` with the database time. An object that fails the checks is deleted and the row marked `failed`.

### Resumable uploads and failed-upload recovery

- **Pictures** are small; a failed upload is retried automatically, then shows a large **Retry** button.
- **Videos** resume part by part. After a dropped connection, the browser retries the failed part. If the page is reloaded or closed, the media row still holds `r2_upload_id`. When the employee returns, the slot shows "Upload interrupted, tap to resume". The employee re-selects the same file (iPhone Safari cannot keep file access across reloads). The server checks the size matches, lists the parts R2 already has, and the browser uploads only the missing parts.
- An employee can discard a pending or failed file on a draft attempt. The server aborts any multipart upload, deletes any object, and marks the row `discarded`.
- An R2 lifecycle rule aborts incomplete multipart uploads after a proposed 7 days. A scheduled cleanup marks `pending` rows older than a proposed 24 hours as `failed`.

### Preventing completion until uploads finish

- **Complete Step** stays disabled while any upload for the step is pending or in progress, and until every proof requirement's minimum is met with `uploaded` files.
- `complete_step` re-checks this in the database, so the rule holds even if the browser is bypassed.

### Private viewing with short-lived links

- Pictures and videos are displayed through `/media/[mediaId]`, a Route Handler that calls `requireUser()` and reads the media row with the user's own Supabase session, so RLS decides access.
- If allowed, the handler responds with a redirect to a presigned `GET` URL for that one object. Proposed expiry: 5 minutes. The page never receives R2 credentials, and a link copied out of the app stops working after it expires.
- Videos use `preload="metadata"` so only a poster frame and duration load until play is pressed.

### Five-year retention and scheduled deletion

- When the owner marks a job Complete, `media_delete_after` is set to five years after `completed_at`.
- A scheduled deletion job (run daily by a Cloudflare Workers Cron Trigger once deployed) finds media on jobs past `media_delete_after`, deletes the R2 objects, and marks the rows `deleted` with `deleted_at`. The metadata rows and activity history stay in Postgres.
- R2's own lifecycle rules are not used for the five-year deletion, because they count from upload time rather than job completion.
- Jobs that are not complete keep their media until they are completed.
- Archive and export before deletion is a future feature.

---

## 6. Owner notifications

- **When:** only for the two approved events.
  - Initial Prep complete, job Waiting for Base-Coat Installation.
  - Top-Coat Prep complete, job Waiting for Top-Coat Installation.
- **Approved owner decision:** version one notifies the owner in the app only. There are no owner emails, text messages, or push notifications, and no email provider.
- **In-app:** the job status changes in the same transaction as the step completion, so it can't be missed. The Owner Dashboard shows a "Needs you" count and separate groups, each with its own count and direct links, for Waiting for Base-Coat Installation, Waiting for Top-Coat Installation, and Ready to Mark Complete. The dashboard and owner job pages refresh themselves while open (every 30 seconds, and when the app returns to the foreground). The owner's Jobs screen lists the same jobs first under "Needs You". Each job's history records every status change.
- **Employees:** text the owner when a job is ready for an installation. Waiting job pages remind team members to do so.
- Owner notification emails, text message notifications, and phone push notifications are possible future features.

### Database backups

- **What:** a weekly logical export (`pg_dump`) of the Supabase database, compressed, uploaded to the private R2 bucket under a `backups/` prefix. Media files are already in R2 and are not duplicated.
- **Where it runs:** a scheduled GitHub Actions workflow, because `pg_dump` cannot run inside a Cloudflare Worker. The database connection string and a separate R2 token scoped to the bucket are stored as encrypted GitHub Actions secrets, never in the repository.
- **Retention:** after each successful upload, the workflow lists the objects under `backups/` and deletes all but the newest 12.
- **Privacy:** the repository is public, so workflow logs are public. The workflow prints only success, failure, and object counts, never data, connection strings, or object contents.
- **Failure handling:** a failed run leaves the existing backups untouched and is visible as a failed workflow run. Old backups are only deleted after a new one uploads successfully.
- **Restore:** a documented restore procedure, tested once into a scratch database during Phase 11.

---

## 7. Weekly Setup

### Inventory list and targets

- Both trailers use the same list from the spec, seeded word for word into `inventory_items` with its four categories.
- Each item's target is the number in its name ("Thirty 3-inch brushes" has target 30 and unit label "brushes"). Items without a number have target 1. "Rags stocked" is `status_only`.
- The seeded targets are shown to the owner for confirmation in Phase 10 before the feature is used.

### Employee flow (`/weekly-setup/[trailerId]`)

- The list is grouped by category. Each count item shows its label and target (for example "Target: 30 brushes"), and a large number field with − and + buttons for the **usable quantity on hand**.
- As soon as a count is entered, the item shows its calculated status: **Ready**, **Missing**, or **Need More** with the shortage, for example "Need 18 More". There is no manual status control for count items.
- Broken or unusable items are left out of the usable count. The optional note field on each item is where the employee explains them.
- "Rags stocked" and any other status-only item show three large buttons: Ready, Missing, Need More, plus an optional note.
- Restock notes for the whole trailer go at the bottom.
- Progress autosaves as a draft. **Submit** is enabled once every item has a count or a selection. Submission records the employee and the database time.

### Owner review (`/owner/weekly-setup`)

- One card per trailer: last checked by and when, counts of Ready, Need More, and Missing items, then a list of every Missing and Need More item with its shortage and note, plus the restock notes.
- The dashboard shows a trailer shortage summary.
- Submission history per trailer, with each past submission viewable in full.

### History for future inventory tracking

- Each result row keeps its own copy of the item label, category, target, and unit at the time of the check, plus the usable count, status, shortage, and note. Past submissions therefore never change, even if the list or targets are edited later.
- This history supports later features such as usage trends per item, combined restock lists across both trailers, owner-editable targets, and per-trailer lists. These are future features and are not built in version one.

---

## 8. Build phases

Each phase ends with lint, a production build, its listed tests, and a check on a real iPhone where UI changed. Nothing moves forward until the confirmation items are met. Each phase is a separate reviewable change.

### Phase 1: Sign-in and route protection

- **Features:** Supabase Free connection through environment variables. A `profiles` migration with the `app_role` enum, RLS, the `is_owner()` and `is_active_user()` helpers, and a trigger that gives each new auth user an `employee` profile. The documented first-owner bootstrap with placeholders. Email and password `/sign-in` with show and hide password, a loading state, and clear error messages, with no sign-up link. `src/proxy.ts` (session refresh, signed-out redirect) and the DAL (`requireUser()`, `requireOwner()`). A real Account screen and Sign Out. A placeholder owner-only `/owner` page. `.env.example` with placeholders. No invitations, password recovery, or email yet.
- **Files or areas:** `package.json`, `supabase/migrations`, `src/proxy.ts`, `src/lib/supabase/*`, `src/lib/dal.ts`, `src/lib/auth/*`, `src/app/sign-in`, `src/app/account`, `src/app/owner`, layouts, `.env.example`, README.
- **Testing:** Unit tests for sign-in validation, error messages, and safe redirect handling. Lint, type check, and production build. Once a Supabase project exists: manual checks that signed-out users are redirected, an employee cannot open `/owner` or run owner actions, deactivated users are signed out, and sign-out works on an iPhone.
- **Confirm before moving on:** Nothing loads while signed out. Employees cannot reach owner pages. No real personal information or credentials have been committed.
- **Status: complete and verified (2026-09-27).** The owner tested against the real Supabase Free project: the owner account signed in, opened `/owner`, and the Account screen showed the owner's name and Owner role; a wrong password showed an error; an employee test account signed in, and visiting `/owner` redirected it to `/jobs`. Credentials stay in the untracked `.env.local` and the Supabase dashboard only.

### Phase 1B: Team screen and temporary passwords

- **Features:** The server-only admin client in `src/lib/supabase/admin.ts` using `SUPABASE_SECRET_KEY`. The owner-only **Team screen**: create an employee account (name, email, role) with a generated temporary password shown once, generate a new temporary password, deactivate and reactivate (with confirmation, and never your own account), and separate lists of active and inactive accounts with each account's status. Role changes come later. **Change Password** on the Account screen for every user. The temporary-password reminder. A migration adding the account-status columns to `profiles` and the `account_events` table. Supabase settings: minimum password length and Secure password change off. No email provider, invitation emails, or password-reset emails.
- **Files or areas:** `supabase/migrations`, `src/lib/supabase/admin.ts`, `src/lib/auth/*` (password generation and validation), `src/lib/actions/team.ts`, `src/lib/actions/account.ts`, `src/app/(app)/owner/team`, `src/app/(app)/account`, `.env.example`, `docs/SUPABASE_SETUP.md`.
- **Testing:** Unit tests: generated passwords have the right length and alphabet and do not repeat; password-change validation. Database tests: employees cannot change roles, read other users' email, or read `account_events`. Checks that no temporary password appears in the database, server logs, or activity records, and that the secret key does not appear in the browser bundles or the Workers build output. Manual test on an iPhone: the owner creates a test employee, texts the temporary password, the employee signs in and changes it; the owner issues a new temporary password and the old one stops working; deactivate (sign-in fails) and reactivate; an employee cannot open `/owner/team` or run its actions.
- **Confirm before moving on:** The owner can create, reset, deactivate, and reactivate test accounts, and employees can change their own passwords.
- **Status: complete and verified (2026-09-27).** The owner ran the Phase 1B migration and added the server secret key locally, then tested against the real Supabase Free project: the Team screen loaded without a setup warning and listed the existing owner and employee accounts; a new employee account was created and its temporary password shown once, with Temporary Password status; the employee signed in with it, saw the reminder, changed their password, and the reminder disappeared; the employee was redirected from `/owner/team` to Jobs; an owner password reset made the previous password stop working and the new temporary password work; deactivation blocked sign-in and reactivation restored it. No passwords or secret values were exposed or committed.

### Hosting compatibility check (early, before Phase 2 feature work grows)

- **Features:** Add `@opennextjs/cloudflare` and `wrangler`, build the app for Cloudflare Workers, and deploy a private preview to a Workers Free account. Add `.dev.vars` to `.gitignore`.
- **Testing:** Sign-in, `proxy.ts` session refresh, Server Actions, redirects, and cookies work on Workers. Measure the compressed Worker size and per-request CPU time against Workers Free limits.
- **Confirm before moving on:** The app runs correctly on Workers Free, or the specific incompatibility is reported to the owner before more features are built on top of it.
- **Status: complete (2026-09-27), compatible with warnings.** Tested locally only (no Cloudflare account, nothing deployed) with `@opennextjs/cloudflare` 1.20.6 and `wrangler` 4.141 in Wrangler's local Workers runtime:
  - `proxy.ts` ran on Workers: signed-out redirects with the `next` path, public routes, and static assets all worked.
  - A sign-in Server Action ran inside the Worker, called Supabase Auth, and returned the correct wrong-password message. Field validation messages also worked.
  - Fixed during the check: `/auth/deactivated` now uses a relative redirect, because Route Handlers on Workers see an internal `localhost` host. ESLint and TypeScript now ignore `.open-next` and `.wrangler`. `esbuild` is a direct dev dependency, because the adapter imports it without declaring it.
  - **Warning:** OpenNext reports Node.js middleware (which Next.js 16 `proxy.ts` always uses) as experimental on Cloudflare and not officially maintained. It worked in every test. If it breaks in a future release, the fallback is the deprecated `middleware.ts` on the edge runtime.
  - **Warning:** OpenNext is not fully supported on Windows. Local Windows builds worked, but production builds should run on Linux (GitHub Actions or Cloudflare Workers Builds).
  - **Size budget:** the Worker is 2,551 KiB compressed (11,064 KiB uncompressed) against the Workers Free limit of 3 MiB compressed, about 83% used before any feature work. Later phases must keep dependencies small. R2 signing will use `aws4fetch` instead of the AWS SDK for this reason, and the size is re-measured with `wrangler deploy --dry-run` at the end of every phase.
  - **Not yet measurable:** per-request CPU time. The local runtime does not enforce or report the Workers Free CPU limit. It is measured after the first real deployment.

### Phase 2: Workflow templates and seed of the approved workflow

- **Features:** Template tables and enums. A seed migration loading every stage, step, block, checklist item, reference list, structured input, proof requirement, and confirmation statement from `PRODUCT_SPEC.md` word for word. Setup-step mixing-station lists, inside-work-area lists, and the final action are seeded as `reference_list`. A read-only owner preview of the template.
- **Files or areas:** `supabase/migrations`, `src/lib/workflow/`, `src/app/owner/workflow` (preview).
- **Testing:** A seed test comparing stage and step counts, titles, and block kinds with the spec, including a check that no setup reference list is a `checklist`. The owner reads the preview side by side with the spec.
- **Confirm before moving on:** The owner agrees the seeded workflow matches the spec exactly.
- **Status: complete and verified (2026-09-27).** The owner ran both Phase 2 migrations on the real Supabase Free project and reviewed `/owner/workflow`: 5 stages and 16 steps (9 in Initial Prep, 5 in Top-Coat Prep, Caulking Complete then Baseboard Complete in Completion Work), setup lists marked Reference only, both installation milestones marked Owner only, and the displayed workflow matched the approved specification. How it was built:
  - **Single source:** `src/lib/workflow/approved-workflow.ts` holds version 1 word for word. A test parses `docs/PRODUCT_SPEC.md` and fails if any stage, step, goal, instruction, list, check, proof, structured input, confirmation, milestone rule, or Completion Work rule differs. Confirmation statements are stored without the spec's surrounding quotation marks.
  - **Generated seed:** `npm run workflow:seed` writes `supabase/migrations/20260927020100_seed_approved_workflow_v1.sql` from that file. A test fails if the committed SQL differs from the generator's output. The seed records a SHA-256 of the content, does nothing if the same version 1 is already loaded, and stops if a different version 1 exists.
  - **Schema** (`20260927020000_workflow_templates.sql`): `workflow_templates` (key, version, status draft/active/retired, content hash) with one active version per key; `workflow_stage_templates` (employee stage, owner milestone, or Completion Work; milestones carry the owner action and status labels); `workflow_step_templates` (standard steps or completion items); blocks (`ordered_list`, `reference_list`, `checklist`) and items; structured inputs; proof requirements. The names differ slightly from the earlier draft of this plan (`workflow_` prefix, `step_blocks`) to keep template tables grouped.
  - **Constraints:** only checklist items can be required; owner milestones cannot contain steps; completion items exist only in Completion Work and have no goal, instructions, inputs, proof, or confirmation; proof requirements must match the step's proof type; activation validates the whole template (for example, every preparation step has a Final check and every step with proof has requirements).
  - **Versioning and future job snapshots:** once a version is active, its content cannot be changed or deleted, only retired. A change means a new version, which `activate_workflow_template` validates and activates while retiring the old one. Phase 3 jobs will record the template id and content hash they were created from and copy that version's rows, so a job keeps its workflow even after newer versions are published.
  - **Security:** active signed-in users read the active version; owners read every version; deactivated users and visitors read nothing. No signed-in user can insert, update, delete, or activate templates.
  - **Tests:** 33 data tests and 27 database tests. The database tests run every migration in PGlite (in-process Postgres, a test-only dev dependency) with a small stand-in for Supabase roles and `auth.uid()`, and cover order, counts, required checks, proof types, inputs, reference lists, milestones, Completion Work, re-running the seed, immutability, constraints, activation, and read-only access for employees and owners. They also read the workflow back as an employee and confirm it rebuilds exactly into the approved workflow.
  - **Preview:** `/owner/workflow` shows the active version as stored in the database, read only.

### Phase 3: Jobs, snapshots, making jobs available, and real job cards

- **Features:** `jobs`, snapshot tables, and `create_job`. Owner job creation with default toggles and the join setting. Owner editing of job details. Make Available and Return to Scheduled. Employee `/jobs` with its five sections, and a read-only `/jobs/[jobId]`. JobCard with team, current step, and last activity. The `job_progress` view. Mock data removed from the Jobs screens.
- **Files or areas:** migrations, `src/lib/actions/jobs.ts`, `src/app/owner/jobs/*`, `src/app/(employee)/jobs/*`, `src/components/JobCard.tsx`, `src/lib/mock-data.ts`.
- **Testing:** Database tests: changing a template after job creation does not change the job; employees can see Scheduled jobs but cannot claim or join them; employees cannot write to any job table. Unit tests for status labels, progress, and section grouping.
- **Confirm before moving on:** The owner can create and release a job on a phone and a desktop, and job cards show every required field.
- **Status: complete and verified (2026-09-27).** The owner ran the Phase 3 migration on the real Supabase Free project and confirmed: owner Jobs sections and empty states; New Job defaults (Caulking on, Baseboard off, Allow Employees to Join on); blank-form validation; creating a fictional Scheduled job with a job number, a workflow version 1 snapshot, and a creation history entry; the first step shown as not started; editing square footage and enabling Baseboard, with old and new values in history and Baseboard Complete added to the outline; Make Available removing the editing controls; Return to Scheduled; and an employee seeing the Scheduled job read only, with no edit or status controls, and being redirected away from `/owner/jobs`. How it was built:
  - **Migration** `20260927030000_jobs.sql`: `jobs` (job numbers from 1001, check constraints matching the form rules, defaults caulking on, baseboard off, joining on), per-job snapshot tables (`job_stages`, `job_steps`, `job_step_blocks`, `job_step_block_items`, `job_step_inputs`, `job_step_proof_requirements`) that link back to the template rows they came from, append-only `job_activity`, and the `job_progress` view.
  - **Atomic creation:** `create_job()` checks for an active owner, finds the active workflow, inserts the job as Scheduled, copies every template row, records the workflow key, version, and content SHA-256, and writes a `job_created` history entry, all in one transaction. With no active workflow, or any invalid value, nothing is saved.
  - **Status rules:** a trigger allows only the transitions in "How jobs move between statuses" and forces new jobs to start as Scheduled. Phase 3 owner functions are `make_job_available` and `return_job_to_scheduled`. Phase 4 adds the "no team and no started work" check to returning a job.
  - **Editing:** `update_job_details()` edits only Scheduled jobs (an available job is returned to Scheduled first) and records each changed field's old and new value in history. Completion items are not separate rows: the snapshot holds both Caulking Complete and Baseboard Complete, and the job's toggles decide which apply.
  - **History protection:** jobs cannot be deleted; snapshot rows and history entries cannot be changed or deleted; a job's workflow version and creation record cannot change.
  - **Access:** active signed-in users read every job (including Scheduled), its snapshot, and its history. Deactivated users and visitors read nothing. No signed-in user can write to job tables directly, and the job functions refuse anyone but an active owner.
  - **Screens:** owner `/owner/jobs` (grouped by Scheduled, Available to Claim, In Progress, Complete), `/owner/jobs/new`, `/owner/jobs/[jobId]` (details, controls, workflow outline, history), and `/owner/jobs/[jobId]/edit`; employee `/jobs` with the five sections and a read-only `/jobs/[jobId]`. Mock jobs were removed.
  - **Until later phases:** completed progress units are always 0 and the current step is the first preparation step, shown as "not started" (Phase 5). The team shows "No one assigned yet" (Phase 4).
  - **Tests:** 37 database tests (PGlite) and 31 unit tests cover defaults, validation, dates, atomic snapshots, version and fingerprint, snapshots surviving a new workflow version, failure without an active workflow, no partial jobs, status transitions, edit history, protected history, owner-only functions, employee read-only access, Scheduled-job visibility, section placement, empty states, and the removal of mock jobs.

### Phase 4: Job teams, claiming, joining, and activity history

- **Features:** `job_assignments` with its indexes. `claim_job`, `join_job`, `add_team_member`, `remove_team_member`, `change_lead`, `set_allow_join`, and `job_activity`. Claim and Join buttons wired up. Team management and the activity timeline on the owner job page. `is_assigned` in RLS.
- **Files or areas:** migrations, `src/lib/actions/teams.ts`, job pages, owner job page.
- **Testing:** A concurrency test firing many simultaneous claims at one job: exactly one lead is created. Tests: joining is refused when the setting is off, for Scheduled jobs, and for duplicate assignments; an employee can be on several active jobs; removed employees keep their history but lose write access; unassigned employees can read but not write. Playwright: claim, second employee joins, owner removes an employee and changes the lead.
- **Confirm before moving on:** Two people can never both become lead, and every team change shows in the activity history with the right person and time.
- **Status: complete and verified (2026-09-27).** The owner ran the Phase 4 migration on the real Supabase Free project and confirmed: an employee claimed an Available job, which moved to My Current Jobs as Claimed with the claimant as Lead; a second employee joined as a Member; the owner removed a member; turning joining off removed Join Job and showed the correct message; the owner could still add an employee; removing the lead required choosing a replacement, with no silent promotion; Make Lead kept the previous lead as a Member; additions, removals, and lead changes appeared in History with names and times; deactivating an assigned employee kept the assignment, marked them Deactivated, and blocked sign-in, and reactivation worked; an unassigned employee could view the job and team read only; and employees were redirected away from owner job management. Simultaneous claims were not race-tested by hand; that protection is covered by the passing database tests. How it was built:
  - **Migration** `20260927040000_job_teams.sql`: `job_assignments` (role lead or member; method claimed, joined, added_by_owner, or lead_change; `assigned_by`, `ended_at`, `ended_by`, `end_reason`), unique indexes for one active lead per job and one active assignment per employee and job, and a deferred check that any job with assigned employees has exactly one lead. Assignments are never deleted and can only be ended once; a role change ends the old row and starts a new one, so lead history is complete.
  - **Functions:** `claim_job` and `join_job` (active employees only), `add_team_member`, `remove_team_member`, `change_lead`, and `set_job_join_setting` (active owners only). All lock the job row, use the database clock, record who acted, and write job history. `return_job_to_scheduled` now also requires an empty team.
  - **Claiming:** the job row lock makes a second simultaneous claim wait, then fail with "Someone else claimed this job first." with nothing saved; the one-lead index is a second safeguard.
  - **Lead rules:** removing a lead who has teammates requires naming the new lead in the same call; no one is promoted automatically. Removing a lead who is alone leaves the job with no team. Nobody can join a job without a lead; the first employee the owner adds becomes the lead. `change_lead` keeps the previous lead as a member.
  - **Where adding is allowed:** the owner can add employees to Available jobs (the first becomes lead and the job moves to Claimed) and in-progress jobs, not Scheduled or Complete jobs. Only active employees can be added, claim, or join; owners manage teams but are not team members.
  - **Deactivation:** deactivating an employee does not end their assignments, so their history stays; they are shown as Deactivated on the team and the owner can replace them.
  - **Visibility:** active users read assignments and the `job_team` view (current team with names only, no emails), so every job card shows its lead and members. Direct writes are blocked for everyone signed in.
  - **Screens:** Claim Job on Available job cards and job pages; Join Job on in-progress job pages when allowed, with clear messages when joining is off or the job has no lead; the team on every job page; and an owner team panel to add, remove, change the lead, and turn joining on or off, with confirmations, loading, success, and error states. My Current Jobs uses real assignments.
  - **Tests:** 32 database tests and 11 unit tests. The simultaneous-claim test fires 10 claims at one job at once; PGlite runs them one at a time, so it confirms one winner and no partial assignments, while protection under true parallel load comes from the row lock and unique index, which the tests also check directly.

### Phase 5: Step execution without media

- **Features:** Step screen with instructions, reference lists, Final check, structured inputs, notes, autosave, confirmation, `complete_step`, the one-editor hold, unlocking, progress, and automatic status changes through Initial Prep and Top-Coat Prep. Owner milestones shown to employees as waiting screens. Steps that require proof show their slots as "Uploads coming in the next phase" and cannot be completed yet.
- **Files or areas:** migrations (attempts, responses, RPCs), `src/lib/workflow/*`, `src/lib/actions/steps.ts`, `src/app/(employee)/jobs/[jobId]/steps/[stepId]`, new step components.
- **Testing:** Unit tests for unlocking, validation, and progress. Database tests: unassigned employees cannot save or complete; a second employee cannot edit while the first holds the step, but can after it expires; completed steps cannot change; reference lists never block completion; every save records the right employee. On iPhone with gloves: Clean Edges and Corners (no proof) and Collect Excess Flake (two structured inputs), using a test job whose earlier steps and base-coat milestone are set directly in the test database.
- **Confirm before moving on:** The owner has tried the step screen on a phone and approved its layout and touch targets.
- **Status: complete and verified (2026-09-27).** The owner ran both Phase 5 migrations (`20260927050000_step_work.sql`, then `20260927060000_step_edit_leases.sql`) on the real Supabase Free project and confirmed: the workflow map showed the correct current, locked, and owner-only states; Grind Floor showed its approved goal, instructions, Final check, required video, and confirmation; answers autosaved and moved the job to Initial Prep in Progress, with step-start and status-change history; one employee's edit hold blocked another, a second employee could take over after the first released the step, and saved work stayed intact between them; another employee's saved checks appeared without a manual refresh; unsaved typing was preserved; after the owner cleared a hold, the cleared employee could no longer save and saw the correct message, another assigned employee could take over, and history recorded the clear; completion of a step needing media stayed blocked; reference lists had no checkboxes; and the owner could view steps but not check or complete them. Live testing found two bugs, both fixed and retested before approval (see the two "Live-test fix" notes below): open screens showing out-of-date answers, and owner-cleared holds that could still save. How it was built:
  - **Migration** `20260927050000_step_work.sql`: `step_attempts` (draft, completed, or superseded for Phase 8; started by, completed by, database times, notes, and the confirmation text shown), `step_check_responses` and `step_input_responses` (with the item text or label shown and who last changed each answer), and `step_edit_holds`. Drafts can change; completed attempts and their answers can never be changed or deleted.
  - **Open steps:** `job_step_state()` is the single source of truth: a step is open when the job is being worked, every earlier stage is done (preparation steps completed, milestones installed per the job status), and every earlier step in its stage is completed. Completion Work items stay locked until Phase 7.
  - **Edit holds:** `acquire_step_edit` takes or refreshes a two-minute hold in one atomic statement, so simultaneous requests cannot both win; expired holds, and holds of people who left the team or were deactivated, don't block anyone. Every save and completion requires holding the edit and extends it. The screen renews every 30 seconds and releases on leave. `clear_step_edit` is owner only and recorded in history.
  - **Saving and completing:** `save_step_check` (Final check items only; reference lists are never checkboxes), `save_step_input` (text up to 2,000 characters; numbers with whole-number and minimum rules; single-select from the stored choices), `save_step_notes`, and `complete_step`, which requires the confirmation, every required check and entry, and (since Phase 6) verified uploads for every picture and video requirement. Completion records the employee and database time, releases the hold, and writes history.
  - **Status changes:** the first saved answer in Initial Prep moves Claimed to Initial Prep in Progress, and in Top-Coat Prep moves Base Coat Installed to Top-Coat Prep in Progress. Completing a stage's last preparation step moves the job to the matching Waiting for … Installation status. Each change writes a `status_changed` history entry. Employees cannot move past an owner milestone.
  - **Who can work steps:** only active employees on the job team. The owner views every step and can clear holds; unassigned employees view read only.
  - **Screens:** a workflow map on job pages (stage progress bars, step states, owner-only milestones, a Continue button for team members) and a step screen with the note, goal, numbered instructions, reference lists, a tap-to-check Final check, large entry controls, the proof requirement, notes, the confirmation, and clear hold, conflict, expired, saving, and media-required states.
  - **Tests:** 24 database tests and 8 unit tests. Steps needing pictures or videos are marked complete directly in the test database to reach later steps, and a small no-media test workflow proves the waiting statuses; the app has no such bypass.
  - **Live-test fix (open screens staying current):** live testing found that an open step screen kept the answers it loaded when first opened, so an employee who regained the hold could see an out-of-date copy. Now every hold acquire or renewal loads the latest saved answers from the database before editing is enabled (never overwriting a check that is still saving or a field being typed); while someone else holds the step, the screen checks for their saves every 8 seconds while visible and whenever the app returns to the foreground; read-only step screens and employee job pages re-render from the server every 8 and 15 seconds while visible. No database change was needed. Covered by 8 unit tests for the merge rules and 2 database tests that replay the reported sequence.
  - **Live-test fix (owner-cleared holds):** live testing found that after the owner cleared an employee's hold, the employee's open screen kept saving: its 30-second renewal called `acquire_step_edit`, which quietly created a new hold, and saves only checked the employee, not the session. Migration `20260927060000_step_edit_leases.sql` makes holds leases: each acquire issues a new unguessable `lease_id` (readable only by the database functions, not by other users); `renew_step_edit` only extends the caller's current lease and never creates one; every save, completion, renewal, and release must present the exact current lease; the owner's clear records the ended `lease_id` in history so the former editor is told "The owner ended your editing session."; and an old lease stays rejected even after the same employee takes a new one. The screen renews its own lease every 8 seconds while visible, stops editing on any refusal (keeping typed text visible but unsaved), and asks for a new lease only when the step is opened or the employee taps "Edit this step" or "Try again". Covered by 4 new database tests (plus all existing step tests updated for leases) and 6 unit tests.

### Phase 6: Media uploads with Cloudflare R2

- **Features:** Private R2 buckets (development and production), a bucket-scoped API token, CORS, and the incomplete-multipart lifecycle rule. `src/lib/r2.ts`, `media_assets`, `create_media_intent`, presigned single and multipart uploads with progress, resume after interruption, discard, confirmation checks, completion gating, `/media/[mediaId]` viewing links, the owner evidence viewer, and owner reference images on steps.
- **Files or areas:** migrations, `src/lib/r2.ts`, `src/lib/actions/media.ts`, `src/app/media/[mediaId]/route.ts`, `src/components/ProofUploader*`, owner step view, `.env.example`.
- **Testing:** Database tests: unassigned employees and employees without the edit hold cannot create upload intents; completion is refused with missing uploads. Server tests: oversized or wrong-type objects are rejected and deleted; `/media` refuses signed-out users; viewing links expire. A check that no R2 key appears in browser bundles. On a real iPhone over cellular: a 3-minute video, airplane mode mid-upload and resume, reload and resume, and Complete Step staying disabled until uploads finish.
- **Confirm before moving on:** The owner can view pictures and videos from their usual devices, and the bucket is confirmed private.
- **Status: complete and verified (2026-09-27).** The owner ran `20260927070000_step_media.sql` on the real Supabase Free project and set up the private development R2 bucket (no R2.dev URL and no custom domain), its CORS policy, the incomplete-multipart lifecycle rule, and an API token restricted to that bucket, following `docs/SUPABASE_SETUP.md`, step 13. Tested on an iPhone over the local network (after the development-origin fix below) and confirmed: a phone-recorded video uploaded directly to R2 with progress, was verified by the server, and showed its length and size; verified video proof unlocked Complete Step, and the completed step showed its proof read only and unlocked the next step; the owner could view completed proof; an employee not on the team could not open a copied proof link, and a signed-out viewer was sent to sign-in; R2 stored the object under a private job-scoped path; canceling an upload in progress kept checklist answers; Airplane Mode produced the lost-connection state and Retry resumed and finished the interrupted multipart upload; a phone-camera picture was compressed, uploaded, verified, and shown as a thumbnail; removing an unfinished picture asked for confirmation and kept checklist answers; and an existing iPhone HEIC library picture was converted to JPEG, uploaded, and shown correctly. Setup and live checks are in `docs/SUPABASE_SETUP.md`, step 13. How it was built:
  - **Database** (`20260927070000_step_media.sql`): `step_media` records every upload against its job, step, attempt, proof requirement, and uploader, with the declared and verified size, type, video length, upload method, multipart state, a 24-hour upload authorization, and its state (pending, uploaded, failed, discarded, deleted). Checks enforce the approved limits (pictures stored as JPEG up to 5 MB from originals up to 25 MB; MOV or MP4 videos up to 300 MB and 3 minutes, always multipart in 10 MiB parts). A trigger forbids deleting records, changing their details, or changing anything on a completed attempt; the only later change allowed is marking an uploaded file deleted after the job's `media_delete_after` date (five years after completion, set in Phase 7). `create_media_upload` and `discard_media` check the active account, job team, step, draft attempt, and exact edit lease; recording R2 facts (`set_media_multipart`, `media_upload_details`, `confirm_media_upload`, `fail_media_upload`), `authorize_media_view`, `expire_abandoned_media`, `media_due_for_retention_cleanup`, and `mark_media_deleted` are server-only (secret key). `confirm_media_upload` accepts a file only when the stored object's key, size, and type match the record and the caller is the uploader holding the lease; otherwise it marks it failed. `complete_step` now requires each proof requirement's minimum count of verified uploads and refuses while any upload is unfinished. Row Level Security shows proof records only to the owner and the job's active team, and object keys and R2 upload ids are never readable by users.
  - **Storage** (`src/lib/media/r2.ts`, `aws4fetch`): server-only signed links, 10 minutes for a picture upload, 1 hour per video part, 5 minutes to view a picture, 15 minutes for a video. Object keys are `jobs/<job>/steps/<step>/<attempt>/<media id>-<random>.<ext>`. Before accepting a video the server lists the parts R2 actually holds (the browser's report is never trusted), completes the upload, then checks the object's size and type; a mismatched object is deleted.
  - **Actions and viewing:** `src/lib/actions/media.ts` only receives small JSON descriptions and returns links; file contents never pass through a Server Action or the Worker. `/media/[mediaId]` checks access and redirects to a short-lived link with `no-store` and `no-referrer`.
  - **Screen:** each proof requirement is shown before choosing a file; phones offer the camera and library; pictures are resized and compressed in the browser (built-in canvas, upright orientation) to at most 5 MB; video length is read before upload; uploads show preparing, percentage, checking, failure with Retry, and Cancel; lost connections retry automatically, expired links are renewed once, and interrupted videos continue from the parts already stored, including after a reload by choosing the same video again; uploaded pictures show thumbnails and videos show length and size; removing an uploaded file needs confirmation and is recorded in history; upload problems never touch saved checklist work. Read-only step views show proof to the owner and team only.
  - **Live-test fix (phone over Wi-Fi in development, verified):** opening the dev server from a phone by the computer’s network address left steps on “Opening this step for editing…”. Next.js 16 blocks its development scripts and live-reload connection for hosts other than localhost unless listed in `allowedDevOrigins`, so pages rendered but never became interactive and the lease request was never sent. `next.config.ts` now reads exact hosts from `DEV_LAN_HOSTS` in `.env.local` (development only; wildcards ignored; production builds unaffected). Server Action origin checks are unchanged. Opening a step now gives up after 15 seconds with a plain-language message and Try again, and failed saves, renewals, and completion no longer leave a spinner running. Setup is in `docs/SUPABASE_SETUP.md`, step 13.7. This problem predated Phase 6 and affected only the development server. Retested on an iPhone after setting `DEV_LAN_HOSTS`: steps opened for editing, and the lease was acquired, renewed, and released over the local-network address.
  - **Not in this phase:** owner reference images on steps (not part of the approved Phase 6 request), the scheduled cleanup job for abandoned uploads and five-year retention (the database functions exist; scheduling comes with deployment), and the production bucket.
  - **Tests:** 24 database tests (starting, resuming, limits, wrong requirement/job/step/attempt/uploader/key, unassigned and deactivated accounts, stale and cleared leases, server verification, expired authorization, completion blocking and proof counts including multiple-picture steps, private viewing, completed-proof immutability, abandoned uploads, retention) and unit tests for signing, R2 parsing and completion planning, file limits, the upload engine (progress, parts, resume, retry, expiry, cancel), screen state, and source boundaries (no file contents in Server Actions, R2 keys only in server-only code).

### Phase 7: Installation milestones and Completion Work

- **Features:** owner-only Mark Base Coat Installed and Mark Top Coat Installed, Completion Work items checkable by any assigned employee, the owner's review and Mark Job Complete (which sets `media_delete_after`), and in-app owner visibility on the Owner Dashboard. No email (approved owner decision; see [Owner notifications](#6-owner-notifications)).
- **Files or areas:** migration, `src/lib/actions/owner.ts`, owner dashboard, owner job page, employee job page, step screen, workflow map.
- **Testing:** Database tests: employees cannot mark milestones or complete jobs; milestones cannot be marked from the wrong status; unassigned employees cannot check completion items; all four caulking and baseboard combinations; repeated requests add no history; complete jobs are read only.
- **Confirm before moving on:** The owner has marked both installations and completed a test job from the review screen.
- **Status: complete and verified (2026-09-27).** The owner ran `20260927080000_milestones_and_completion.sql` on the real Supabase Free project and confirmed: installation buttons were unavailable before their waiting statuses; completing Initial Prep moved the job to Waiting for Base-Coat Installation; employees saw Waiting for owner and could not mark the milestone; the Owner Dashboard and the Needs You group showed the waiting job; marking Base Coat Installed updated the status, workflow map, attribution, time, and History; a stale second request added no duplicate history; Top-Coat Prep unlocked; completing Top-Coat Prep moved the job to Waiting for Top-Coat Installation; marking Top Coat Installed unlocked Completion Work in the approved order; assigned employees completed Caulking Complete and Baseboard Complete with attribution, times, and the Completion Work in Progress status; the Owner Dashboard showed Ready to Mark Complete; marking the job Complete moved it to the Complete section and showed the five-year media retention date; the complete job became read only; and existing proof stayed viewable. Setup and live checks are in `docs/SUPABASE_SETUP.md`, step 14. How it was built:
  - **Database** (`20260927080000_milestones_and_completion.sql`): `job_milestones` records each installation milestone once per job with the owner and database time, and can never be changed or deleted. `mark_milestone_installed(job, milestone)` is owner only, locks the job row, and works only from the matching waiting status: it records the milestone, writes a `milestone_installed` history entry, and moves the job to Base Coat Installed or Top Coat Installed (with the usual `status_changed` entry). Base Coat Installed unlocks the first Top-Coat Prep step through the existing step rules; Top Coat Installed unlocks Completion Work. A repeated or simultaneous request returns "already installed" and changes nothing.
  - **Completion Work:** `job_step_state` now reports Completion Work items as `not_applicable` when the job's Caulking or Baseboard option is off, `locked` until the top coat is installed and every earlier applicable item is complete (Caulking Complete, then Baseboard Complete), and `available` after that. `complete_completion_item(step)` lets an active employee on the job team mark an available item: it records the employee and database time as a completed step attempt, writes a `step_completed` history entry, and moves Top Coat Installed to Completion Work in Progress on the first item. Items have no checklist, entries, proof, or confirmation, so they don't use edit leases; the job row lock makes a teammate's simultaneous tap return "already completed" with no duplicate. The preparation-step functions (edit leases, answers, uploads, Complete Step) refuse Completion Work items.
  - **Owner completion:** `mark_job_complete(job)` is owner only, locks the job, and requires both milestones, every preparation step, and every applicable Completion Work item. It sets Complete, `completed_by`, `completed_at`, and `media_delete_after = completed_at + 5 years` (database time), clears any edit holds, and writes `status_changed` and `job_completed` history. If no Completion Work applies, the job is ready right after Top Coat Installation. Nothing is deleted or scheduled for deletion.
  - **Read only after completion:** triggers refuse any change to a complete job's row and any new or changed step attempt, edit hold, upload, or team assignment on it, and allow completion fields only on a complete job.
  - **Progress:** `job_progress` counts applicable Completion Work items, names the current item, shows "Ready for owner review" when only Mark Job Complete remains, and adds `ready_for_owner_completion`. `job_milestone_status` shows who marked each milestone (names only) to active users.
  - **Screens:** the Owner Dashboard shows counts and links for jobs waiting for each installation and ready to mark Complete; owner job pages show large Mark Base Coat Installed, Mark Top Coat Installed, and Mark Job Complete buttons only when valid, each with a confirmation; employee job pages show Waiting for owner, All work done, and Complete states; the workflow map shows who marked each milestone and when, and shows Not applicable items; the Completion Work step screen has one large button with a confirmation. Error messages for team checks are now shown as written instead of "Only an active owner can do this."
  - **Tests:** 22 new database tests and unit tests for section moves, dashboard counts, milestone states, and installation terminology.

### Phase 8: Reopening, custom steps, reusable step library, reference pictures, and owner working membership

- **Approved decisions (2026-09-27):**
  1. Custom steps can be created for work such as Sand Stairs or Grind Down Lip.
  2. A custom step can be one-time or saved to an owner-only Custom Step Library.
  3. Library steps can be imported into future jobs without recreating them.
  4. Importing creates a job-specific snapshot. Later edits to the library item never change a job that already imported it.
  5. Library items can be edited for future imports and archived. Used versions and historical job copies are never destroyed.
  6. Standard and custom steps may have optional owner-supplied instructional/reference pictures.
  7. Reference pictures are visual guidance only and never count as employee proof.
  8. The owner can optionally add reference pictures later through the app.
  9. Existing jobs remain snapshot-safe. Template and library changes do not silently alter existing jobs.
  10. The owner can join an active job as an Owner/Working Member.
  11. The employee lead remains the crew lead. Joining does not make the owner lead or replace the lead.
  12. A joined owner may complete employee tasks, checks, structured inputs, and proof uploads, with full attribution.
  13. An owner who has not joined remains view-only for employee work, while keeping normal owner milestone and management powers.
  14. The owner can leave the working team without affecting owner access or the employee lead.
  15. Problem reporting remains deferred.
- **Reopening:** a reason is required (this replaces the earlier "optional reason").
- **Not in Phase 8:** skipping standard steps, reordering steps, and editing a job's standard step content remain in the spec's owner list for a later phase.

- **Features:** Reopen with a required reason; one-time and library custom steps with the shared step editor (structured inputs and proof types); the Custom Step Library with versions and archiving; reference pictures on standard, library, and job steps; Owner/Working Member join and leave. (Clearing an edit hold was delivered in Phase 5.)
- **Files or areas:** migrations, `src/lib/actions/owner-steps.ts`, owner edit screens.
- **Testing:** Database tests: reopened steps keep their earlier attempt, responses, and media; custom steps follow the same validation as standard steps; steps cannot be added to milestone stages or unsafe positions; library versions never change imported steps; reference pictures never satisfy proof; working owners can work only after joining.
- **Confirm before moving on:** The owner has reopened a step and added a custom step on a test job and confirmed the history looks right.
- **Status: complete and verified (2026-09-27).** The owner ran `20260927090000_custom_steps_references_reopening.sql` and the Working Owner display fix `20260927100000_working_owner_display.sql` on the real Supabase Free project and tested against the private R2 bucket, confirming: a library step with instructions, a reference list, required and optional checks, an entry, picture proof, and a confirmation was created; a reference picture uploaded and showed as guidance; editing created a new version and kept the old one; the step was imported into a Scheduled job at the chosen position; a one-time step was created and saved to the library; History recorded additions and a removal, and removing a custom step from a job kept its library item; later library edits did not change the job's imported copy; an employee claimed the job and stayed Lead; the owner joined as Owner · Working Member, shown separately from the Lead on job pages and cards, did employee work with owner attribution, was refused leaving while another tab held an edit lease, left after the lease was released, and disappeared from the active display while the join and leave history remained; active-job insertion offered only safe future positions, never installation milestones or Completion Work, and was recorded in History; a job-specific reference picture showed to the assigned employee as guidance and did not satisfy proof or unlock completion; an archived library item could not be imported and existing copies were unchanged; employees were redirected away from the library; reopening required a reason, kept the earlier attempt, answers, proof, attribution, and time visible and unchanged, started a blank attempt that old proof did not satisfy, kept later work blocked until redone, and History recorded the owner, reason, and time. Setup and live checks are in `docs/SUPABASE_SETUP.md`, step 15. How it was built:
  - **Database** (`20260927090000_custom_steps_references_reopening.sql`): custom steps are described as JSON and validated by `step_definition_problem` (limits match the approved steps). `add_custom_step` (one-time, optionally saved to the library) and `import_library_step` insert a job snapshot at a checked position: `custom_step_positions` allows any employee stage before the job is claimed, and on an active job only preparation stages the job hasn't finished (their installation isn't waiting or done), before steps nobody has started; never milestones, Completion Work, or Complete jobs. Later unstarted steps move down under a transaction-local exception to the snapshot triggers; nothing else about snapshots can change. `remove_custom_step` works only before the job is claimed. Job steps record `custom_origin`, `source_library_version_id`, `added_by`, and `added_at`, and history records every addition and removal.
  - **Library:** `step_library_items` and immutable `step_library_versions`. `update_library_item` adds a version (unchanged content adds none); `archive_library_item` blocks new imports and edits. Items and versions are never deleted. Owner only (functions and Row Level Security).
  - **Reference pictures:** `reference_pictures` (JPEG up to 5 MB under `reference/<id>-<random>.jpg`, verified by the server like proof) and `reference_picture_links` on a standard step, a library item, or one job step. New jobs copy each standard step's current links (a trigger on `job_steps`); imports copy the library item's current links; later changes never touch existing jobs. A job's links can change only while the step is unfinished and the job isn't complete. `authorize_reference_view` (server only) allows owners, and employees for standard-step pictures and for job pictures on jobs they work on. They are separate from `step_media` and never count toward proof. `reference_pictures_due_for_retention_cleanup` lists job-only pictures past their jobs' five-year date for the future cleanup; nothing is deleted in this phase.
  - **Owner/Working Member:** `job_working_owners` (separate from employee assignments; one active row per owner and job; ended, never deleted). `join_job_as_working_owner` works only on jobs in progress; `leave_working_team` refuses while the owner holds an edit lease on the job. `is_job_worker` (an active employee on the team, or an active joined owner) now decides step work in `require_step_worker`, `current_step_hold`, `require_media_worker`, and `complete_completion_item`. `claim_job` and `join_job` stay employee only. The lead never changes.
  - **Reopening:** `reopen_step(step, reason)` requires the owner and a reason, marks the completed attempt superseded (answers, proof, names, and times unchanged), records `step_reopenings` and history, and never changes the job status. While a step is reopened, later unfinished steps stay locked, `mark_milestone_installed` refuses until every earlier preparation step is complete again, Completion Work stays locked, and `mark_job_complete` refuses. Complete jobs can't be reopened. `job_progress` shows the reopened step first and adds `reopened_step_title`.
  - **Screens:** Custom Step Library (list, new, preview, edit, archive, versions, reference pictures); Add Custom Step on owner job pages (from the library or one-time, stage and safe position, save to library, confirmation on jobs in progress); removing custom steps before claiming; reference pictures on standard steps (Workflow page), library items, and job steps, shown to employees near the instructions and marked as guidance, not proof; Join Job as Working Owner and Leave Working Team; Reopen Step with a required reason; attempt history on step pages; labels for library, one-time, and working-owner roles.
  - **Interpretation choices:** skipping, reordering, and editing standard job steps are not in this phase. "During job creation" means right after creating the job, while it is Scheduled (the job page opens after creation and offers Add Custom Step). Standard-step pictures belong to the active workflow's steps. Reopening a Completion Work item is allowed and makes it available again. Leaving the working team requires leaving any step being edited first.
  - **Tests:** 27 new database tests and unit tests for the step editor and source boundaries.
  - **Live-test fix (Working Owner on team displays):** live testing found that after the owner joined as a Working Owner, the owner job page's Team section (and job cards) still showed only the employee team: working owners were drawn only by the employee job page's team list. Now one shared list shows active working owners, labeled "Owner · Working Member" and kept apart from the Lead and members, on the employee job page, the owner job page's team panel, and in job-card team names. Migration `20260927100000_working_owner_display.sql` adds the owner's active flag to `job_working_owner_status` so a deactivated owner is marked "Deactivated", like a deactivated employee. Names only, never email addresses. Leaving removes the owner from the displays; the membership row and history entries remain. Permissions and the lead are unchanged. Covered by 3 database tests and 3 unit tests.

### Phase 9: Owner dashboard and live monitoring

- **Features:** Dashboard groups, jobs with no team assigned, trailer shortage summary (after Weekly Setup), and live updates (built with automatic refresh instead of Supabase Realtime; see Status).
- **Files or areas:** `src/app/owner/page.tsx`, dashboard components, browser Supabase client.
- **Testing:** Two devices: an employee completes a step and the owner dashboard updates without reloading.
- **Confirm before moving on:** The owner is happy with what the dashboard shows at a glance.
- **Status: built; waiting for the owner's live verification.** Setup and live checks are in `docs/SUPABASE_SETUP.md`, step 16. How it was built:
  - **Database** (`20260927110000_owner_dashboard.sql`): owner-only `owner_dashboard()` returns one row per job in a single round trip: job details, applicable progress (Not Applicable Completion Work isn't counted), current stage and step with the step to open (a reopened step first; none while the job waits for the owner), Ready to Mark Complete, the reopened step, the Lead and members, active Working Owners, the last history entry with who did it and its database time, the current editor and lease expiry, and unfinished or failed uploads on work in progress. `owner_recent_activity()` returns the newest history entries across jobs with names. Both require an active owner and return names only. A new index supports the recent-activity order.
  - **Screen:** the Owner Dashboard shows tiles with counts for every category, then Needs you (longest waiting first), In progress (reopened work first, then most recent activity), Scheduled and Available (soonest date first), and Recently completed (newest 10, with a link to all), each with an empty message. Cards show everything above with Open Job and Current Step links. Search (client, address, job number), category, assigned person (including Working Owners), and scheduled date range filters live in the page and the address bar, so refreshes and reloads keep them. The page refreshes every 20 seconds while visible and when the app returns to the foreground, flags data older than 90 seconds, and has a loading state. History wording is shared with the job page's History, which is unchanged.
  - **Live-test fix (card hierarchy):** owner feedback asked for the client name to lead. Dashboard cards and the recent activity list no longer show job numbers (still searchable); the client name is the largest text, the address is the clear second line, and cards are larger with more padding, a stronger border, and more space between them. On wide screens (1024 px and up) only the dashboard widens beyond the phone column, showing two cards side by side with details in two columns. Open Job and Current Step stay large buttons.
  - **Interpretation choices:** live updates use the existing lightweight refresh instead of Supabase Realtime (no WebSocket or new package, per the owner's Phase 9 instructions); an employee's saved work appears on the dashboard within about 20 seconds. The trailer shortage summary waits for Weekly Setup (Phase 10). "Jobs with no team assigned" appear as a note on in-progress cards without a Lead. The owner job page (workflow map, milestone buttons, History) remains the owner review view.
  - **Worker size:** `src/lib/supabase/proxy.ts` now imports `NextResponse` from its own module instead of `next/server`, whose `ImageResponse` export pulled `next/og` image generation into the middleware bundle. Same class and behavior (redirects checked on a local Worker preview). This cut the compressed Worker from 2,910.10 KiB to 2,550.65 KiB. OpenNext still adds a smaller `next/og` path of its own to the middleware bundle; removing it would mean editing build output, so it was left.
  - **Tests:** 12 new database tests (every field, owner-only access, no emails or file keys, editor expiry, uploads, reopened steps, Working Owners, recent activity, and a realistic number of jobs) and unit tests for categories, labels, ordering, filters, filter persistence, row mapping, links, and history wording.

### Phase 10: Weekly Setup

- **Features:** Trailers and the shared inventory list seeded from the spec with targets, units, and tracking type. The trailer inventory screen with usable-quantity entry, automatic status and shortage, status-only items, notes, restock notes, draft autosave, and submission. The owner's current-condition and history views.
- **Files or areas:** migrations, `src/lib/inventory/`, `src/lib/actions/weekly-setup.ts`, `src/app/(employee)/weekly-setup/*`, `src/app/owner/weekly-setup/*`.
- **Testing:** Unit tests: usable 0 gives Missing; 12 of 30 gives Need More with "Need 18 More"; 30 and 31 of 30 give Ready. Database tests: a count item's status and shortage cannot be set by hand; status-only items accept a selection; submitted results cannot be edited; editing an inventory item does not change past submissions. A seed test against the spec's list. A submission on iPhone with gloves for each trailer, then owner review.
- **Confirm before moving on:** The owner confirms the seeded targets and that shortages are easy to see.

This phase is independent of the job workflow and can move earlier if the owner wants Weekly Setup sooner.

### Phase 11: Hardening, scheduled jobs, and deployment (only when approved)

- **Features:** Remove the "Preview" badge and remaining mock data. Error and loading states. Add-to-home-screen icon. Production Supabase and R2 settings. Production deployment on Cloudflare Workers Free with OpenNext. Workers Cron Triggers for daily five-year media deletion and stale upload cleanup. The weekly database backup workflow with 12-backup retention. The Next.js production checklist.
- **Testing:** A full Next.js compatibility pass on Workers (every route, Server Action, redirect, `after()`, and Realtime). Full end-to-end suite against the Workers preview. The scheduled deletion job run against test data with a shortened date. A manual backup run, a test restore into a scratch database, and a check that the 13th backup deletes the oldest. A real-device pass with every role.
- **Confirm before moving on:** The owner approves going live.

---

## 9. Deferred from version one

These are in the spec's Future functionality list and are **not** built in version one. No tables, enums, statuses, routes, actions, notifications, or tests are created for them.

- **In-app problem reporting:** problem-report forms with notes, pictures, or videos; blocking and non-blocking reports; the "Blocked / Problem Reported" job status; problem-report notifications; owner resolution. When built later, this will add a `problem_reports` table, a `blocked` value in `job_status` with a saved previous status, a problem route under each job, and a notification kind.
- Text message and phone push notifications.
- Automated account invitation emails and email password recovery. When built later, these will add an email provider as Supabase custom SMTP, `/auth/confirm` and `/auth/set-password` routes, and a "Forgot password" link on sign-in. Until then, the owner issues temporary passwords from the Team screen.
- Archive and export of job media and records before the five-year deletion.
- Fuller inventory tracking built on Weekly Setup history.
- Offline workflow synchronization (the design already uses client-generated IDs and database timestamps to prepare for it).
- Detailed caulking and baseboard modules, payroll, Builder Prime integration, automatic scheduling, customer access, and App Store distribution.

---

## 10. Decisions still required

There are no open owner decisions. All earlier decisions are recorded in `PRODUCT_SPEC.md` and this plan. New questions will be added here only if they come up during a phase.

### Setup information needed (not decisions)

Before the relevant phases, and never committed to the repository: the owner's sign-in email (Phase 1, entered in the Supabase dashboard), each employee's name and email (Phase 1B, entered on the Team screen; temporary passwords are sent to employees by text, never stored), the trailers' names if different from "Trailer 1" and "Trailer 2" (Phase 10), and any reference images for steps (Phase 6).
