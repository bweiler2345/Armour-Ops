# Armour Ops Implementation Plan

This plan describes how to build the features in [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) on top of the existing Next.js application. `PRODUCT_SPEC.md` is the authority on workflow content and behavior. Where this plan and the spec disagree, the spec wins and this plan must be corrected.

No application code, dependencies, or UI have been changed as part of writing this plan.

## Contents

1. [Starting point](#starting-point)
2. [Technology and framework notes](#technology-and-framework-notes)
3. [User roles and security](#1-user-roles-and-security)
4. [Database model](#2-database-model)
5. [Application routes and screens](#3-application-routes-and-screens)
6. [Workflow behavior](#4-workflow-behavior)
7. [Media uploads](#5-media-uploads)
8. [Build phases](#6-build-phases)
9. [Decisions still required](#7-decisions-still-required)

---

## Starting point

The current repository is a visual shell only:

- Next.js 16.3 (App Router, `src/` directory, `@/*` alias), React 19.2, TypeScript, Tailwind CSS v4, ESLint.
- `src/app/layout.tsx` renders `AppHeader`, the page, and `BottomNav` (Jobs, Weekly Setup, Account).
- `src/app/jobs`, `src/app/weekly-setup`, and `src/app/account` render fictional data from `src/lib/mock-data.ts`.
- `JobCard`, `PageHeading`, and `Icons` are reusable presentational components.
- The palette (charcoal and muted gold) is defined in `src/app/globals.css` as Tailwind theme tokens.

Gaps between the shell and the spec that later phases will close:

- Mock `JobStatus` values (`In Progress`, `Scheduled`, `Open`) do not match the spec's twelve statuses.
- `JobCard` does not yet show assigned employee, current step, or last activity time.
- Mock jobs split address into `address` and `city` and include a `projectType` field the spec does not define. The spec defines a single address.
- The Account screen shows Crew and Employee ID, which the spec does not require. It will show name and role only unless the owner asks otherwise.
- All buttons (Claim, Open, Sign Out, checklist) are visual only.

The existing visual components will be kept and fed real data rather than rewritten.

## Technology and framework notes

Stack: existing Next.js App Router app, TypeScript, Tailwind CSS, Supabase Postgres, Supabase Auth, Supabase Storage, and Vercel deployment in a later phase.

Planned additions, installed only in the phase that needs them:

| Package | Purpose |
| --- | --- |
| `@supabase/supabase-js`, `@supabase/ssr` | Database, auth, and storage clients with cookie-based sessions |
| `zod` | Server-side validation of every form and action input |
| `tus-js-client` | Resumable uploads to Supabase Storage with progress reporting |
| Supabase CLI (dev dependency) | Local database, migrations, type generation, database tests |
| `vitest` | Unit tests for pure workflow logic |
| `@playwright/test` | End-to-end tests with iPhone viewport emulation |

Next.js 16 conventions that affect this plan (from `node_modules/next/dist/docs/`):

- **`proxy.ts` replaces `middleware.ts`.** It lives in `src/proxy.ts`. It will refresh the Supabase session cookie and redirect signed-out users to `/sign-in`. The docs state Proxy is for optimistic checks only and must not be the only authorization layer.
- **Data Access Layer (DAL).** Authorization is enforced close to the data: a `src/lib/dal.ts` module with `cache()`-wrapped `requireUser()` and `requireOwner()` functions, called from every page, Server Action, and Route Handler that touches data. Supabase Row Level Security is the final enforcement layer.
- **Do not rely on layouts for auth checks.** Layouts do not re-render on navigation and do not stop nested segments from rendering. Each page and action checks for itself.
- **Server Actions are public POST endpoints** and must re-check auth and role inside every action.
- **Server Action request bodies are capped at 1 MB by default.** Pictures and videos will therefore upload directly from the browser to Supabase Storage, never through a Server Action.
- **Dynamic route `params` are Promises** and are typed with the generated `PageProps<'/jobs/[jobId]'>` helpers, matching the existing `LayoutProps<'/'>` usage.
- The experimental `authInterrupts` (`forbidden()` / `unauthorized()`) will not be used. Standard `redirect()` and `notFound()` are sufficient.

---

## 1. User roles and security

### Roles

| Role | Stored as | Summary |
| --- | --- | --- |
| Owner/Admin | `profiles.role = 'owner'` | Full read and write access to all jobs, steps, evidence, problems, milestones, and Weekly Setup submissions. More than one owner account is supported. |
| Employee | `profiles.role = 'employee'` | Can view claimable jobs and their own claimed jobs, perform steps on their own claimed job, report problems, and submit Weekly Setup checks. |

Every `auth.users` row has exactly one `profiles` row. Deactivated users (`profiles.active = false`) cannot sign in to app data. RLS helper functions treat them as having no role.

### Authentication approach

- Supabase Auth with cookie-based sessions via `@supabase/ssr`.
- No public sign-up. The owner creates employee accounts, either from the Supabase dashboard at first or from an owner-only Team screen later. The Team screen uses the service-role key in a server-only module.
- The sign-in method is an open decision (see [Decisions](#7-decisions-still-required)). The plan assumes email and password until decided, because it works without leaving the app on an iPhone.
- A Supabase **custom access token hook** copies `profiles.role` into the JWT so `proxy.ts` can make optimistic role redirects without a database call. The database remains authoritative.

### Route protection (three layers)

1. **`src/proxy.ts` (optimistic).** It refreshes the session, redirects signed-out users to `/sign-in`, and redirects employees away from `/owner/*`. It runs on all routes except static assets.
2. **DAL (authoritative in app code).** `requireUser()` returns the signed-in user and profile or redirects to `/sign-in`. `requireOwner()` also verifies `role = 'owner'` from the database, not the JWT. Every page and Server Action calls one of these.
3. **Row Level Security (authoritative in the database).** Even a bug in app code cannot expose or change rows the user is not permitted to access.

### Row Level Security

RLS is enabled on every table. Two `security definer` helper functions (with `search_path` set to empty) keep policies short:

- `is_owner()`: the current user is active and has role `owner`.
- `is_active_employee()`: the current user is active and has role `employee`.

Read policies:

| Data | Owner | Employee |
| --- | --- | --- |
| Profiles | All | Own profile, plus the names of claimants on jobs they can see |
| Jobs | All | Jobs in `available_to_claim`, plus jobs they currently hold a claim on or have worked on |
| Job stages, steps, checklist items, inputs, proof requirements | All | Those belonging to jobs they can see |
| Step attempts, responses, media records | All | Those on jobs they can see |
| Problem reports | All | Those they reported, or on jobs they currently hold |
| Job activity | All | Activity on jobs they currently hold |
| Workflow templates | All | None needed (jobs carry their own snapshot) |
| Trailers, inventory items | All | All active |
| Weekly Setup submissions and results | All | Their own submissions, plus the latest submitted condition for each trailer |
| Notifications | Their own | Their own |

Write policies:

- Employees get **no direct `insert`, `update`, or `delete`** on workflow tables. Every employee write goes through a narrow Postgres function (RPC) that checks the caller holds the job's active claim, the step is unlocked, and the action is valid. Examples: `claim_job`, `save_step_draft`, `complete_step`, `report_problem`, `submit_weekly_setup`. This keeps rules like "cannot silently modify a completed step" in one place that cannot be bypassed from the browser.
- Owner-only functions (`create_job`, `release_claim`, `override_claim`, `mark_milestone_installed`, `reopen_step`, `skip_step`, `add_custom_step`, `reorder_steps`, `edit_step`, `resolve_problem`) start with an `is_owner()` check. Owner installation milestones can **only** be completed through `mark_milestone_installed`, so no employee path can mark Base Coat Installed or Top Coat Installed.
- `job_activity`, `step_attempts` history, and completed responses are append-only. No `update` or `delete` policy exists for any role. Corrections happen through reopening, which adds records.

### Timestamps

- Every event timestamp (`claimed_at`, `completed_at`, `uploaded_at`, `reported_at`, `submitted_at`, milestone times, activity times) is set in the database with `now()` inside the RPC or by a column default. RPCs never accept these values from the client.
- For future offline support, a separate informational `client_recorded_at` column may be added later. It will never replace the database timestamp.

---

## 2. Database model

All schema changes live in `supabase/migrations/*.sql`. Generated TypeScript types go in `src/lib/database.types.ts`. Primary keys are `uuid`. Client-generated UUIDs are accepted for attempts and media so that retried requests are idempotent, which also prepares for offline sync.

### Enums

| Enum | Values |
| --- | --- |
| `app_role` | `owner`, `employee` |
| `job_status` | `scheduled`, `available_to_claim`, `claimed`, `initial_prep_in_progress`, `waiting_for_base_coat_installation`, `base_coat_installed`, `top_coat_prep_in_progress`, `waiting_for_top_coat_installation`, `top_coat_installed`, `completion_work_in_progress`, `complete`, `blocked` |
| `stage_kind` | `employee_stage`, `owner_milestone`, `completion_work` |
| `step_state` | `locked`, `available`, `in_progress`, `completed`, `reopened`, `skipped` |
| `proof_media_type` | `picture`, `video` (a step with proof type "none" has no proof requirement rows) |
| `input_type` | `text`, `number`, `single_select` (a step with structured input type "none" has no input rows) |
| `step_block_kind` | `ordered_list`, `checklist` |
| `attempt_status` | `draft`, `completed`, `superseded` |
| `media_status` | `pending`, `uploaded`, `failed`, `discarded` |
| `problem_status` | `open`, `resolved` |
| `claim_end_reason` | `released_by_owner`, `overridden_by_owner`, `job_completed` |
| `inventory_result` | `present`, `missing`, `damaged` |
| `activity_type` | `job_created`, `job_edited`, `made_available`, `claimed`, `claim_released`, `claim_overridden`, `step_started`, `step_completed`, `step_reopened`, `step_skipped`, `step_added`, `step_edited`, `steps_reordered`, `media_uploaded`, `problem_reported`, `problem_resolved`, `milestone_installed`, `status_changed`, `job_completed` |

Display labels for `job_status` exactly match the spec wording, for example `waiting_for_base_coat_installation` displays as "Waiting for Base-Coat Installation" and `blocked` displays as "Blocked / Problem Reported".

### Step content structure

Standard and custom steps share one structure. A step has:

- A title, goal, optional reference image, and confirmation text.
- An ordered set of **content blocks**. Each block has a heading from the spec (for example "Instructions", "Choose the setup location", "Mixing-station checklist", "Inside-work-area checklist", "Final action", "Final check") and a kind:
  - `ordered_list`: numbered instructions, read only.
  - `checklist`: items the employee ticks. Each item has a `required` flag.
- Zero or more **structured inputs** (text, number, single-select), each with label, required flag, optional unit, and choices.
- Zero or more **proof requirements**, each with a label, media type (picture or video), minimum count, and whether more than one file is allowed (for "one picture of each completed garage-door line" or "one picture showing each protected drain").

This lets every step in the spec be stored word for word without special cases, and lets custom steps use the same editor and the same completion rules.

### Tables

#### People

**`profiles`**
`id` (PK, FK `auth.users.id`), `full_name`, `role app_role`, `active bool default true`, `created_at`, `updated_at`.

#### Workflow templates (the approved workflow)

Templates are seeded from `PRODUCT_SPEC.md` by a migration and versioned. Editing a template creates a new version. Jobs never reference template rows for content.

**`workflow_templates`**
`id`, `name`, `version int`, `is_current bool` (partial unique index: one current), `created_at`, `created_by`.

**`stage_templates`**
`id`, `workflow_template_id` FK, `position`, `key` (for example `initial_prep`, `base_coat_installation`, `top_coat_prep`, `top_coat_installation`, `completion_work`), `name`, `kind stage_kind`.

**`step_templates`**
`id`, `stage_template_id` FK, `position`, `key`, `title`, `goal`, `reference_image_path` (nullable), `confirmation_text`, `applies_when` (nullable: `caulking_required` or `baseboard_required`, used for the Completion Work checkboxes).

**`step_template_blocks`**
`id`, `step_template_id` FK, `position`, `heading`, `kind step_block_kind`.

**`step_template_block_items`**
`id`, `block_id` FK, `position`, `text`, `required bool default true` (only meaningful for checklist blocks).

**`step_template_inputs`**
`id`, `step_template_id` FK, `position`, `label`, `input_type`, `required bool`, `unit` (nullable), `choices text[]` (single-select only).

**`step_template_proof_requirements`**
`id`, `step_template_id` FK, `position`, `label`, `media_type proof_media_type`, `min_count int default 1`, `allow_multiple bool`.

#### Jobs and per-job snapshots

**`jobs`**
`id`, `job_number` (human-readable, sequence-backed), `client_name`, `address`, `square_feet int`, `flake_color`, `scheduled_date date`, `general_notes`, `caulking_required bool default true`, `baseboard_required bool default false`, `status job_status default 'scheduled'`, `status_before_block job_status` (nullable), `workflow_template_id` (which version was copied, for reference only), `current_claim_id` FK (nullable), `last_activity_at`, `completed_at`, `created_by`, `created_at`, `updated_at`.

**`job_claims`**
`id`, `job_id` FK, `employee_id` FK profiles, `claimed_at default now()`, `ended_at` (nullable), `ended_by` (nullable), `end_reason claim_end_reason` (nullable).
Partial unique index on `(job_id) where ended_at is null`, so at most one open claim per job.

**`job_stages`** (snapshot of `stage_templates`)
`id`, `job_id` FK, `position`, `key`, `name`, `kind`, `unlocked_at` (nullable), `completed_at` (nullable), `completed_by` (nullable). For owner milestones, `completed_at` and `completed_by` record who marked the coat installed and when.

**`job_steps`** (snapshot of `step_templates`, plus custom steps)
`id`, `job_stage_id` FK, `position`, `source_step_template_id` (nullable, null for custom steps), `is_custom bool`, `title`, `goal`, `reference_image_path`, `confirmation_text`, `applies_when`, `state step_state`, `current_attempt_id` (nullable), `skipped_at`, `skipped_by`, `skip_reason`, `removed_at`, `removed_by` (soft delete keeps history), `created_at`, `updated_at`.

**`job_step_blocks`**, **`job_step_block_items`**, **`job_step_inputs`**, **`job_step_proof_requirements`**
Same columns as their template counterparts, keyed to `job_steps`. These are the rows employees see and answer.

`create_job` copies every template row for the current workflow version into these tables inside one transaction. Later template edits do not affect existing jobs. Owner edits to a job change only that job's snapshot rows.

#### Step execution and history

**`step_attempts`**
`id` (client-generated allowed), `job_step_id` FK, `attempt_number`, `status attempt_status`, `started_by`, `started_at`, `completed_by`, `completed_at`, `employee_notes`, `confirmation_text_shown` (copy of the exact statement the employee confirmed), `superseded_at`, `superseded_by_reopen_id`.
A reopened step keeps its completed attempt, marked `superseded`, and gets a new `draft` attempt. Nothing is deleted.

**`step_checklist_responses`**
`attempt_id` FK, `block_item_id` FK, `item_text_shown`, `checked bool`, `updated_at`. PK `(attempt_id, block_item_id)`.

**`step_input_responses`**
`attempt_id` FK, `input_id` FK, `label_shown`, `value_text`, `value_number numeric`, `value_choice`, `updated_at`. PK `(attempt_id, input_id)`.

**`step_reopenings`**
`id`, `job_step_id` FK, `reopened_by`, `reopened_at default now()`, `reason`, `previous_attempt_id`.

Checklist and input responses are editable only while their attempt is `draft`. Completing the attempt freezes them. Copies of the displayed text (`item_text_shown`, `label_shown`, `confirmation_text_shown`) preserve exactly what the employee saw even if the owner later edits the step.

#### Media

**`media_assets`**
`id` (client-generated), `job_id` FK, `job_step_id` FK (nullable), `attempt_id` FK (nullable), `proof_requirement_id` FK (nullable), `problem_report_id` FK (nullable), `uploaded_by`, `media_type proof_media_type`, `bucket`, `storage_path` (unique), `mime_type`, `size_bytes`, `duration_seconds` (nullable), `status media_status`, `created_at`, `uploaded_at`.

#### Problems, activity, notifications

**`problem_reports`**
`id`, `job_id` FK, `job_step_id` FK (nullable), `reported_by`, `reported_at default now()`, `description`, `blocks_work bool`, `status problem_status`, `resolved_by`, `resolved_at`, `resolution_note`.

**`job_activity`** (append-only audit history)
`id bigint identity`, `job_id` FK, `actor_id`, `activity_type`, `job_step_id` (nullable), `details jsonb`, `created_at default now()`.
Written only by RPCs and triggers.

**`notifications`**
`id`, `recipient_id`, `job_id` (nullable), `kind` (for example `waiting_for_base_coat_installation`, `waiting_for_top_coat_installation`, `problem_reported`), `body`, `created_at`, `read_at`.
This covers the spec's "Notify the owner" inside the app. Delivery outside the app (email, text, push) depends on an owner decision.

#### Weekly Setup

**`trailers`**
`id`, `name`, `active bool`, `position`. Seeded with the two trailers.

**`inventory_items`** (one shared list used by both trailers)
`id`, `category` (Core equipment, Prep tools, Mixing and application, Materials and consumables), `position`, `label` (for example "Two full fuel cans"), `active bool`.
Seeded word for word from the spec's required inventory.

**`weekly_setup_submissions`**
`id`, `trailer_id` FK, `submitted_by`, `started_at`, `submitted_at` (null while draft), `restock_notes`.

**`weekly_setup_item_results`**
`submission_id` FK, `inventory_item_id` FK, `category_shown`, `label_shown`, `result inventory_result`, `note`. PK `(submission_id, inventory_item_id)`.

Shortages, damage, and restock notes are recorded by `result = 'missing'`, `result = 'damaged'`, the per-item `note`, and the submission's `restock_notes`. A database view **`trailer_current_condition`** returns, for each trailer, its latest submitted submission with missing and damaged items and restock notes. The owner's Weekly Setup screen reads from this view.

### Relationships (summary)

```
profiles 1─* job_claims *─1 jobs
jobs 1─* job_stages 1─* job_steps 1─* job_step_blocks 1─* job_step_block_items
                             job_steps 1─* job_step_inputs
                             job_steps 1─* job_step_proof_requirements
                             job_steps 1─* step_attempts 1─* step_checklist_responses
                                                       1─* step_input_responses
                                                       1─* media_assets
                             job_steps 1─* step_reopenings
jobs 1─* problem_reports 1─* media_assets
jobs 1─* job_activity
workflow_templates 1─* stage_templates 1─* step_templates 1─* (template blocks, items, inputs, proof requirements)
trailers 1─* weekly_setup_submissions 1─* weekly_setup_item_results *─1 inventory_items
```

### Atomic job claiming

`claim_job(job_id)` runs as one statement-level transaction:

1. Verify the caller is an active employee (or owner).
2. `update jobs set status = 'claimed', ... where id = $1 and status = 'available_to_claim' and current_claim_id is null returning id`.
3. If no row is returned, the job was already claimed. Return a clear "already claimed" result.
4. Insert into `job_claims`. The partial unique index is a second safeguard: a concurrent insert fails instead of creating two claims.
5. Write `job_activity` and set `last_activity_at`.

There is no employee path to transfer a claim. Only `release_claim` and `override_claim` (owner) end a claim, and both are recorded in `job_claims` and `job_activity`.

---

## 3. Application routes and screens

All routes are under `src/app`. Route groups keep layouts separate without affecting URLs.

### Shared

| Route | Screen |
| --- | --- |
| `/sign-in` | Sign-in form (Server Action). Large inputs and button. No app navigation. |
| `/` | Redirects to `/jobs` for employees and `/owner` for owners. |
| `/account` | Name, role, and a working Sign Out. |

### Employee (`(employee)` route group, bottom nav: Jobs, Weekly Setup, Account)

| Route | Screen |
| --- | --- |
| `/jobs` | **Employee Jobs.** "My Active Job" and "Available Jobs". Job cards show every field required by the spec: client name, address, square footage, flake color, scheduled date, assigned employee, current status, current step, overall progress, and last activity time. |
| `/jobs/[jobId]` | **Job details and stage overview.** Job information, general notes, a large **Claim Job** button (when available) or **Continue** button (when held), and a list of stages with per-step state (locked, available, completed, skipped, reopened). Owner milestone stages appear as waiting or installed, with no installation instructions. |
| `/jobs/[jobId]/steps/[stepId]` | **Step details.** Title, goal, reference image, content blocks, checklists, structured inputs, proof upload slots with progress, employee notes, the confirmation statement, a **Complete Step** button, and a **Report a Problem** button. Completed steps open read-only with who completed them, when, and their evidence. |
| `/jobs/[jobId]/problem` | **Problem reporting.** Description, optional pictures or video, and the related step. Opened from the job or a step (`?step=`). |
| `/weekly-setup` | **Weekly Setup.** Both trailer cards showing their latest check status. |
| `/weekly-setup/[trailerId]` | **Trailer inventory.** The shared inventory list grouped by category, with large present, missing, and damaged controls per item, optional item notes, restock notes, and Submit. |

Claiming is an action on `/jobs` and `/jobs/[jobId]`, not a separate page. It calls a Server Action that calls `claim_job` and then redirects to the job.

Evidence upload happens inline on the step screen, one slot per proof requirement, so employees never leave the step to upload.

### Owner (`/owner`, owner layout with nav: Dashboard, Jobs, Weekly Setup, Account)

| Route | Screen |
| --- | --- |
| `/owner` | **Owner dashboard.** Jobs grouped by available, claimed and active, waiting for installation, blocked, and completed. Unread notifications, open problems, and trailer shortages. |
| `/owner/jobs/new` | **Owner job creation.** Client name, address, square footage, flake color, scheduled date, general notes, Caulking required toggle (on by default), Baseboard required toggle (off by default), and optional custom steps. |
| `/owner/jobs/[jobId]` | **Owner progress monitoring.** Status, claimant, current step, progress, a full activity timeline, every step with completion time and person, evidence viewer, problem reports, claim release and override, and the **installation milestone** controls: **Mark Base Coat Installed** (shown only when the job is Waiting for Base-Coat Installation) and **Mark Top Coat Installed** (shown only when the job is Waiting for Top-Coat Installation). |
| `/owner/jobs/[jobId]/edit` | **Owner job editing.** Job details and toggles, plus the step editor: add a custom step, remove, reorder, skip, and edit steps for this job only. |
| `/owner/jobs/[jobId]/steps/new` | **Custom step editor.** Step name, stage, position, instructions, optional reference picture, optional checklist, required proof type (none, picture, or video), structured inputs, and final confirmation text. Shares the same form as step editing. |
| `/owner/jobs/[jobId]/steps/[stepId]` | Owner view of one step: all attempts, including superseded ones, with responses, media, notes, and timestamps. Reopen, skip, and edit actions. |
| `/owner/weekly-setup` | Current condition of both trailers (from `trailer_current_condition`) and submission history. |
| `/owner/weekly-setup/[submissionId]` | One submission in full. |

Owners can also open employee routes (for example to see exactly what an employee sees).

### Supporting source layout

```
src/
  proxy.ts                         session refresh and optimistic redirects
  lib/
    supabase/server.ts             server client (cookies)
    supabase/browser.ts            browser client (uploads, realtime)
    supabase/admin.ts              service-role client, server-only, owner Team screen only
    dal.ts                         requireUser(), requireOwner()
    database.types.ts              generated
    workflow/                      pure functions: unlocking, progress, validation, status labels
    actions/                       Server Actions grouped by area (jobs, steps, media, problems, owner, weekly-setup)
  components/                      existing components, extended (JobCard, StepChecklist, ProofUploader, ...)
supabase/
  migrations/                      schema, RLS, functions, seed of the approved workflow and inventory
  tests/                           database tests for RLS and RPCs
```

---

## 4. Workflow behavior

### How steps unlock

- Stages run in order: Initial Prep, Base-Coat Installation (owner milestone), Top-Coat Prep, Top-Coat Installation (owner milestone), Completion Work.
- A stage unlocks when the previous stage is complete. An employee stage is complete when every non-removed step is `completed` or `skipped`. A milestone stage is complete when the owner marks it installed.
- Within an employee stage, steps run in position order. A step becomes `available` when every earlier step in the stage is `completed` or `skipped`.
- Employees can see later steps' titles as locked, and can open earlier completed steps read-only.
- Unlocking is computed in Postgres inside the RPCs (the source of truth) and mirrored by pure TypeScript functions in `src/lib/workflow/` for display and unit tests.

### How required checklist items are validated

- Every checklist item with `required = true` must be checked on the current attempt before completion.
- The step screen disables **Complete Step** and lists what is missing. `complete_step` re-checks on the server and rejects the request if any required item is unchecked.

### How structured inputs are validated

- `text`: required inputs must be non-blank after trimming. A proposed maximum of 2,000 characters applies, subject to owner approval.
- `number`: must parse as a number. Required inputs must be present. Negative values are rejected. Whole numbers are enforced where the input represents a count ("Full boxes recovered").
- `single_select`: the value must exactly match one of the input's stored choices ("None", "¼ box", "½ box", "¾ box" for Additional flake).
- The same rules run in `zod` (Server Action), in the browser (instant feedback), and in `complete_step` (final authority).

### How uploads are validated

- Each proof requirement needs at least `min_count` media records with `status = 'uploaded'` on the current attempt, of the required media type.
- A media record only becomes `uploaded` after the server confirms the object exists in Storage with an allowed MIME type and size (see [Media uploads](#5-media-uploads)).
- Pending or failed uploads do not count.

### How a step is completed

1. The employee opens an available step. The first saved change creates a `draft` attempt and records `step_started` (and moves the job into the stage's "in progress" status if it is the first activity in that stage).
2. Checklist ticks, input values, and notes **autosave** as they change (checkbox changes immediately; text after a short pause). A visible "Saved" indicator confirms each save.
3. Uploads attach to the current attempt as they finish.
4. When all requirements are met, the confirmation statement is shown with the **Complete Step** button. Pressing it is the confirmation.
5. `complete_step(attempt_id)` locks the attempt, re-validates everything, sets `completed_by = auth.uid()` and `completed_at = now()`, stores the confirmation text shown, marks the step `completed`, unlocks the next step, updates job progress, status, and `last_activity_at`, and writes activity. All of this happens in one transaction.
6. After completion the step is read-only for employees.

### How progress is calculated

- Units: every non-removed, non-skipped employee step in the job, plus each owner milestone as one unit, plus each applicable Completion Work item (caulking if required, baseboard if required).
- Progress = completed units ÷ total units, rounded to a whole percent.
- A reopened step counts as not completed until it is completed again.
- Progress is computed in a Postgres view (`job_progress`) so job cards, the dashboard, and the job page always agree.
- "Current step" on the job card is the first step that is `available`, `in_progress`, or `reopened`. When a milestone is pending it shows the milestone's waiting status instead.

### How jobs move between statuses

| From | Event | To |
| --- | --- | --- |
| (new) | Owner creates job | Scheduled |
| Scheduled | Owner makes the job claimable (trigger to be decided) | Available to Claim |
| Available to Claim | Employee claims | Claimed |
| Claimed | First Initial Prep activity | Initial Prep in Progress |
| Initial Prep in Progress | Last Initial Prep step completed | Waiting for Base-Coat Installation (owner notified) |
| Waiting for Base-Coat Installation | Owner selects Mark Base Coat Installed | Base Coat Installed (Top-Coat Prep unlocks) |
| Base Coat Installed | First Top-Coat Prep activity | Top-Coat Prep in Progress |
| Top-Coat Prep in Progress | Last Top-Coat Prep step completed | Waiting for Top-Coat Installation (owner notified) |
| Waiting for Top-Coat Installation | Owner selects Mark Top Coat Installed | Top Coat Installed (Completion Work unlocks) |
| Top Coat Installed | First completion item checked | Completion Work in Progress |
| Top Coat Installed or Completion Work in Progress | All applicable completion items checked, and job marked Complete | Complete |
| Any active status | Blocking problem reported | Blocked / Problem Reported (previous status saved) |
| Blocked / Problem Reported | Owner resolves all blocking problems | Previous status restored |
| Claimed or any in-progress status | Owner releases claim | Available to Claim (work already completed is kept) |

Status changes happen only inside RPCs, never by direct updates from the client. Each change writes a `status_changed` activity record.

### How owner milestones unlock the next employee stage

- When the last step of Initial Prep completes, `complete_step` sets the job to Waiting for Base-Coat Installation, unlocks the Base-Coat Installation milestone stage, and creates an owner notification.
- Employees see a waiting screen for the milestone. It contains no installation instructions.
- Only `mark_milestone_installed(job_id, stage_key)` (owner only) can complete the milestone. It records the owner and database timestamp in `job_stages`, sets Base Coat Installed, and unlocks Top-Coat Prep. The top coat works the same way and unlocks Completion Work.
- The function refuses to run if the job is not in the matching waiting status, so a milestone cannot be marked early by mistake.

### How problems block or pause work

- An employee can report a problem from any step or the job page without completing the step. The report records the reporter, time, related step, description, and any attached media, and notifies the owner.
- When a report blocks work, the job moves to Blocked / Problem Reported, the previous status is saved, and step completion is disabled for that job until the owner resolves it. Whether every report blocks work is an open decision; the schema supports both through `blocks_work`.
- Resolving restores the saved status (unless another blocking report remains open) and records who resolved it and when.
- Reporting a problem never marks a step complete.

### How owner reopening works

- The owner can reopen any completed step, with an optional reason.
- `reopen_step` marks the current attempt `superseded` (it keeps every response, media file, timestamp, and name), creates a `step_reopenings` record, sets the step to `reopened`, and writes activity.
- The step appears at the top of the employee's job as needing to be redone. The employee completes a new attempt using the same rules.
- Reopening an earlier step does not undo later completed steps or milestones. The job cannot move to a waiting status or to Complete while any step in the relevant stage is reopened.
- The owner can view all attempts side by side on `/owner/jobs/[jobId]/steps/[stepId]`.

### Other owner step edits (per job only)

- **Add custom step:** same structure as standard steps. It is inserted at the chosen stage and position. The owner can choose any employee stage. Custom steps cannot be added to owner milestone stages.
- **Remove:** soft delete (`removed_at`). A removed step keeps its history and drops out of progress.
- **Reorder:** changes positions for steps that are not yet completed.
- **Skip:** marks the step `skipped` with owner and time. It counts as satisfied for unlocking and is excluded from progress.
- **Edit:** changes the job's snapshot rows. Completed attempts keep the text that was shown at the time.

### How completion work handles optional caulking and baseboard

- The Completion Work stage contains at most two simple items, generated from the job toggles when the job is created and updated if the owner changes the toggles before Completion Work starts:
  - "Caulking Complete", only when `caulking_required` is true.
  - "Baseboard Complete", only when `baseboard_required` is true.
- Each is a single checkbox with no detailed instructions, sub-checklists, or proof requirements, as the spec requires.
- When all applicable items are checked, the **Mark Job Complete** action becomes available. If neither toggle is on, the action is available as soon as Top Coat Installed is reached.
- Completing the job sets status Complete and `completed_at`, and closes the claim with `end_reason = 'job_completed'`.

---

## 5. Media uploads

All values in this section marked **proposed** are suggestions for owner approval, not decisions.

### Supported formats

| Kind | Accepted | Notes |
| --- | --- | --- |
| Pictures | JPEG, HEIC/HEIF, PNG | iPhone cameras produce HEIC by default. Pictures are converted to JPEG in the browser before upload where possible, so they display everywhere, including the owner's desktop browser. |
| Videos | MOV (QuickTime), MP4 | iPhone videos are MOV, usually HEVC. HEVC plays in Safari but may not play in every desktop browser. See decisions. |

The server checks MIME type and extension, not only the file name.

### File-size and length limits (proposed)

| Item | Proposed limit |
| --- | --- |
| Picture after compression | 5 MB |
| Picture before compression (rejected if larger) | 25 MB |
| Video length | 3 minutes |
| Video size | 300 MB |
| Files per proof requirement that allows multiple | 20 |

Supabase's Free plan limits individual uploads to 50 MB. A slow walkthrough video of a whole floor at 1080p will often exceed that, so the proposed video limit requires a paid Supabase plan with a raised upload limit. This is listed under decisions.

### Mobile compression

- **Pictures:** resized in the browser to a proposed maximum of 2,560 pixels on the long edge and re-encoded as JPEG at about 80% quality. This usually brings iPhone photos under 1 MB and speeds up uploads on job-site cellular connections.
- **Videos:** reliable in-browser video compression is not practical on iPhone Safari. Size is controlled by the recording settings instead (proposed: 1080p at 30 fps, "Most Compatible" format). The app shows the file size before upload and rejects files over the limit with a clear message.
- The upload control uses the iPhone camera or photo library directly (`accept="image/*"` or `accept="video/*"`).

### Private storage paths

- One private bucket, `job-media`. Nothing is public.
- Paths are generated by the server:
  - Step evidence: `jobs/{job_id}/steps/{job_step_id}/{attempt_id}/{media_id}.{ext}`
  - Problem reports: `jobs/{job_id}/problems/{problem_report_id}/{media_id}.{ext}`
  - Reference images: a separate private bucket, `reference-images/{step_id}/{file}`, readable by signed-in users.
- Storage RLS on `storage.objects`:
  - **Insert** is allowed only when a matching `media_assets` row exists with that exact path, `status = 'pending'`, `uploaded_by = auth.uid()`, and the uploader still holds the job's claim (or is the owner).
  - **Read** is allowed for owners, and for employees on jobs they can see.
  - **Update and delete** are not allowed for employees.
- Viewing uses short-lived signed URLs (proposed: 10 minutes) created on the server after the DAL check.

### Upload flow and progress

1. The employee picks or records a file in a proof slot.
2. The browser prepares it (picture compression, size check) and calls the Server Action `createUploadIntent(requirementId)`. The server validates the claim, step state, type, and count, then creates a `pending` `media_assets` row and returns the path.
3. The browser uploads **directly to Supabase Storage** using resumable (TUS) uploads, showing a progress bar per file. This avoids the 1 MB Server Action body limit.
4. On finish, the browser calls `confirmUpload(mediaId)`. The server checks the stored object's size and MIME type, marks the row `uploaded`, and records `uploaded_at` with the database clock.
5. The slot shows a thumbnail (pictures) or a poster frame and duration (videos).

### Failed-upload recovery

- Resumable uploads continue from where they stopped after a dropped connection. The upload is retried automatically a few times, then shows a large **Retry** button.
- If the employee leaves the page, the `pending` row remains. Returning to the step shows the slot as "Upload interrupted, tap to retry", which re-selects the file (iPhone Safari cannot keep file access across page reloads).
- An employee can discard a pending or failed file from a draft attempt before completion. Discarded files are marked `discarded`, and their storage objects are cleaned up by a scheduled job.
- Stale `pending` rows (proposed: older than 24 hours) are marked `failed` by a scheduled cleanup.

### Preventing completion until uploads finish

- The **Complete Step** button stays disabled while any upload for the step is pending or uploading, and until every proof requirement's minimum count is met with `uploaded` files.
- `complete_step` re-checks this in the database, so the rule holds even if the browser is bypassed.

---

## 6. Build phases

Each phase ends with lint, a production build, its listed tests, and a check on a real iPhone where UI changed. Nothing moves forward until the confirmation items are met. Each phase is a separate reviewable change.

### Phase 1: Supabase foundation, sign-in, and route protection

- **Features:** Supabase project connection (dev project plus local Supabase via the CLI), environment variables, `profiles` table and RLS, role in JWT hook, `/sign-in`, `src/proxy.ts`, DAL, real Account screen and Sign Out, owner and employee route groups with placeholder owner dashboard.
- **Files or areas:** `package.json`, `supabase/migrations`, `src/proxy.ts`, `src/lib/supabase/*`, `src/lib/dal.ts`, `src/app/sign-in`, `src/app/account`, `src/app/layout.tsx` and new route-group layouts, `.env.example`, README.
- **Testing:** Database tests confirming a user can only read their own profile. Playwright: signed-out users are redirected, an employee cannot open `/owner`, and sign-out works. Manual sign-in on iPhone.
- **Confirm before moving on:** Owner has approved the sign-in method. Test owner and employee accounts work. No page shows data while signed out.

### Phase 2: Workflow templates and seed of the approved workflow

- **Features:** Template tables and enums. A seed migration that loads every stage, step, block, checklist item, structured input, proof requirement, and confirmation statement from `PRODUCT_SPEC.md` word for word. A read-only owner preview of the template.
- **Files or areas:** `supabase/migrations`, `src/lib/workflow/`, `src/app/owner/workflow` (preview).
- **Testing:** A test that checks the seeded counts and titles for each stage and step against the spec. The owner reads the preview side by side with the spec.
- **Confirm before moving on:** The owner agrees the seeded workflow matches the approved spec exactly, including the Collect Excess Flake inputs and every proof requirement.

### Phase 3: Jobs, snapshots, and real job cards

- **Features:** `jobs`, per-job snapshot tables, and `create_job`. Owner job creation form with default toggles. Owner job editing of details. "Make available" action. Employee `/jobs` and `/jobs/[jobId]` using real data. JobCard extended with assigned employee, current step, and last activity. The `job_progress` view. Mock data removed from the Jobs screens.
- **Files or areas:** migrations, `src/lib/actions/jobs.ts`, `src/app/owner/jobs/*`, `src/app/(employee)/jobs/*`, `src/components/JobCard.tsx`, `src/lib/mock-data.ts`.
- **Testing:** Database test: changing a template after job creation does not change the job. RLS tests: employees see only claimable jobs and their own. Unit tests for status labels and progress.
- **Confirm before moving on:** The owner can create a job on a phone and a desktop, and the job card shows every required field.

### Phase 4: Atomic claiming, release, override, and activity history

- **Features:** `job_claims`, `claim_job`, `release_claim`, `override_claim`, and `job_activity`. Claim buttons wired up. Activity timeline on the owner job page.
- **Files or areas:** migrations, `src/lib/actions/claims.ts`, job pages.
- **Testing:** A concurrency test firing two simultaneous claims at the same job: exactly one succeeds. RLS tests on claims. Playwright flow: claim, see as active job, owner releases, job is available again.
- **Confirm before moving on:** Double-claiming is impossible. Every claim change appears in the activity history with the right person and time.

### Phase 5: Step execution without media

- **Features:** Step screen, content blocks, checklists, structured inputs, notes, autosave, confirmation, `complete_step`, unlocking, progress, and automatic status transitions through Initial Prep and Top-Coat Prep. Owner milestones are shown to employees as waiting screens. Steps that require proof show their proof slots as "Uploads coming in the next phase" and cannot be completed yet.
- **Files or areas:** migrations (attempts, responses, RPCs), `src/lib/workflow/*`, `src/lib/actions/steps.ts`, `src/app/(employee)/jobs/[jobId]/steps/[stepId]`, new step components.
- **Testing:** Unit tests for unlocking, validation, and progress. Database tests: an employee cannot complete a locked step, another employee's step, or a step with missing required items or inputs; completed steps cannot be changed. On iPhone: Clean Edges and Corners (no proof) and Collect Excess Flake (two structured inputs) complete correctly, with gloves. Because milestones and uploads arrive in later phases, these checks use a test job whose earlier steps and Base-Coat Installation milestone are set directly in the test database.
- **Confirm before moving on:** The owner has tried the step screen on a phone and approved its layout and touch targets.

### Phase 6: Media uploads and evidence review

- **Features:** Private buckets and storage policies, `media_assets`, upload intent and confirm actions, resumable uploads with progress, picture compression, failed-upload recovery, completion gating on uploads, and the owner evidence viewer with signed URLs. Reference images on steps.
- **Files or areas:** migrations and storage policies, `src/lib/actions/media.ts`, `src/components/ProofUploader*`, owner step view.
- **Testing:** Storage policy tests: an employee cannot upload to or read another job's path. Tests on a real iPhone over cellular: large video, airplane-mode interruption, and resume. Confirm Complete Step stays disabled until every upload finishes.
- **Confirm before moving on:** The owner has approved the media limits and the Supabase plan. The owner can view pictures and videos from their usual device.

### Phase 7: Owner installation milestones, notifications, and completion work

- **Features:** `mark_milestone_installed`, in-app owner notifications (and the approved outside-the-app channel if decided), Completion Work checkboxes driven by the caulking and baseboard toggles, and Mark Job Complete.
- **Files or areas:** migrations, `src/lib/actions/owner.ts`, owner job page, notifications UI, employee job page.
- **Testing:** Database tests: employees cannot mark a milestone; a milestone cannot be marked from the wrong status. A complete run-through of a test job from creation to Complete, covering all four combinations of the caulking and baseboard toggles.
- **Confirm before moving on:** The full job lifecycle works end to end on a phone.

### Phase 8: Problems, blocking, reopening, and owner step editing

- **Features:** Problem reporting with media, blocking and resolving, owner reopen, skip, remove, reorder, edit, and add custom steps using the shared step editor with structured inputs and proof types.
- **Files or areas:** migrations, `src/lib/actions/problems.ts`, `src/lib/actions/owner-steps.ts`, owner edit screens, problem screen.
- **Testing:** Database tests: reopened steps keep their earlier attempt and media; a blocked job cannot advance; custom steps follow the same validation as standard steps.
- **Confirm before moving on:** The owner has reopened a step and added a custom step on a real job and confirmed the history looks right.

### Phase 9: Owner dashboard and live monitoring

- **Features:** Owner dashboard grouping, filters, open problems, and live updates using Supabase Realtime on `job_activity` (RLS applies to Realtime).
- **Files or areas:** `src/app/owner/page.tsx`, dashboard components, browser Supabase client.
- **Testing:** Two devices: the employee completes a step and the owner dashboard updates without reloading.
- **Confirm before moving on:** The owner is happy with what the dashboard shows at a glance.

### Phase 10: Weekly Setup

- **Features:** Trailers and the shared inventory list seeded from the spec, the trailer inventory checklist with present, missing, and damaged plus notes, restock notes, submission, and the owner's current-condition and history views.
- **Files or areas:** migrations, `src/lib/actions/weekly-setup.ts`, `src/app/(employee)/weekly-setup/*`, `src/app/owner/weekly-setup/*`.
- **Testing:** A seed test against the spec's inventory list. RLS tests. A submission on iPhone with gloves for each trailer, then owner review.
- **Confirm before moving on:** The owner confirms both trailers use the full list and shortages are easy to see.

This phase is independent of the job workflow and can move earlier if the owner wants Weekly Setup sooner.

### Phase 11: Hardening and Vercel deployment (only when approved)

- **Features:** Remove the "Preview" badge and remaining mock data. Error and loading states. Add-to-home-screen icon. Vercel project, production Supabase project, environment variables, and backups. Production checklist from the Next.js docs.
- **Testing:** Full end-to-end suite against a preview deployment. Real-device pass with every role.
- **Confirm before moving on:** The owner approves going live.

---

## 7. Decisions still required

Only the following need owner input. Each includes a recommendation.

1. **Sign-in method.** Email and password, emailed magic link, or phone text code? *Recommendation:* email and password, with accounts created by the owner and no public sign-up. Magic links open the Mail app and can break the add-to-home-screen flow on iPhone.
2. **Supabase plan and media retention.** The Free plan caps each upload at 50 MB, which is too small for slow whole-floor videos. How long should pictures and videos be kept after a job is complete? *Recommendation:* Supabase Pro with a raised upload limit, keeping media for at least the warranty period.
3. **Media limits and recording settings.** Approve or change the proposed values in [Media uploads](#5-media-uploads). Should employee iPhones be set to record video in "Most Compatible" (H.264) so videos play in any browser, including on a Windows PC? *Recommendation:* yes, if the owner reviews videos anywhere other than an iPhone, iPad, or Mac.
4. **How the owner is notified.** The spec says to notify the owner when a job is waiting for base-coat or top-coat installation. In-app only, email, text message, or phone push notifications (push requires adding the app to the home screen)? *Recommendation:* in-app plus email first; text or push later if needed.
5. **When a job becomes Available to Claim.** Should the owner release each Scheduled job manually, or should jobs become claimable automatically (for example on or before the scheduled date)? *Recommendation:* manual, with a one-tap "Make available" button.
6. **What employees can see of other employees' jobs.** Should employees see jobs claimed by others (read-only), or only available jobs and their own? *Recommendation:* only available jobs and their own.
7. **One active job at a time.** Can an employee hold more than one claimed job at once, for example starting another job's prep while one is waiting for installation? *Recommendation:* allow more than one, but show the most recently active as "My Active Job".
8. **Who finishes the job.** Who checks "Caulking Complete" and "Baseboard Complete", and who marks the job Complete: the employee, the owner, or either? *Recommendation:* the employee checks the items, and the owner marks the job Complete.
9. **Whether every problem report blocks work.** Should every report move the job to Blocked / Problem Reported, or should the employee choose between "Stop work, need the owner" and "Let the owner know, keep working"? This matters for items like reporting remaining joint damage in Clean Joints. *Recommendation:* let the employee choose; only blocking reports change the job status.
10. **Setup checklists.** In the two setup steps, must employees tick every item in the mixing-station and inside-work-area lists, or are those lists reference only, with only the Final check ticked? How should "Second weenie roller when needed" be handled? *Recommendation:* every item must be ticked, except "Second weenie roller when needed", which is optional.
11. **Weekly Setup quantities.** For items with a quantity (for example "Two full fuel cans", "Thirty 3-inch brushes"), is present, missing, or damaged plus a note enough, or should employees enter the count on hand? *Recommendation:* present, missing, or damaged plus an optional note for partial quantities in the first version.

### Setup information needed (not decisions)

Before the relevant phases: the owner account email(s), employee names and emails (Phase 1), the two trailers' names (Phase 10), and any reference images for steps (Phase 6).
