# Armour Ops

Armour Ops is an internal, mobile-first web app for Armour Floors employees and management. It is designed primarily for use on iPhones in the field, with large touch-friendly controls that work while wearing work gloves, and it remains usable on desktop browsers.

The app is organized into three areas, reachable from the bottom navigation bar:

- **Jobs**: the employee's jobs and jobs available to claim.
- **Weekly Setup**: will hold the weekly trailer inventory checklist.
- **Account**: the signed-in user's name and role, plus sign-out.

Owners also have an owner-only area at `/owner`, reachable from the Account screen.

The approved product behavior is in [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md), and the build plan is in [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router) with TypeScript
- Tailwind CSS
- Supabase (Free plan) for sign-in and the database
- ESLint and Vitest
- npm

## Requirements

- Node.js 20.9 or newer (developed on Node 24)
- npm
- A Supabase project to sign in (see below). Without one, the app runs but every page redirects to the sign-in screen, which shows "Sign-in isn't connected yet."

## Install dependencies

From the project folder:

```bash
npm install
```

## Connect Supabase

Follow [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md) once. In short:

1. Create a Supabase Free project and run the SQL in `supabase/migrations/` in the SQL Editor.
2. Turn off public sign-up.
3. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key.
4. Create the owner account in the dashboard and set its role to `owner`.

`.env.local` is ignored by Git. Never commit real keys, names, or email addresses.

## Start the development server

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser. Signed-out visitors are sent to the sign-in screen. After signing in, owners land on the Owner Dashboard and employees land on Jobs.

To preview on an iPhone connected to the same Wi-Fi network, open `http://<your-computer's-local-IP>:3000` in Safari. You may need to allow Node.js through Windows Firewall.

## Other commands

| Command             | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `npm run lint`      | Checks the code with ESLint                             |
| `npm run typecheck` | Generates route types and checks TypeScript             |
| `npm test`          | Runs the unit and database tests                        |
| `npm run workflow:seed` | Regenerates the workflow seed migration from `src/lib/workflow/approved-workflow.ts` |
| `npm run build`     | Creates an optimized production build                   |
| `npm run start`     | Serves the production build (after `build`)             |
| `npm run cf:build`  | Builds for Cloudflare Workers, then strips and scans for server secrets |
| `npm run cf:preview`| Builds for Workers and runs it locally in Wrangler      |

The Cloudflare commands run entirely on your computer and need no Cloudflare account. The app will be hosted on Cloudflare Workers (see the implementation plan). Nothing is deployed yet. OpenNext warns that it is not fully supported on Windows; local builds work, but production builds will run on Linux.

## Project structure

```
src/
  proxy.ts                Refreshes the session and redirects signed-out visitors
  app/
    layout.tsx            Document shell (fonts, metadata)
    sign-in/              Sign-in screen
    auth/deactivated/     Signs out deactivated accounts
    (app)/                Signed-in screens with header and bottom navigation
      page.tsx            Sends each user to their home screen
      jobs/               Jobs screen
      weekly-setup/       Weekly Setup screen
      account/            Account screen and sign-out
      owner/              Owner-only area: dashboard, Team screen, workflow preview
    globals.css           Color palette and global styles
  components/             Shared UI (header, bottom nav, job card, icons)
  lib/
    dal.ts                requireUser() and requireOwner(): the auth check every page and action uses
    auth/                 Sign-in, validation, roles, safe redirects, temporary passwords (with unit tests)
    actions/              Server Actions for the Team screen and password changes
    team/                 Team screen types
    workflow/             Approved workflow data, seed generator, spec parser, loader (with tests)
    supabase/             Supabase clients for the server, proxy, and server-only admin tasks
    database.types.ts     Database types (hand-written until the Supabase CLI is set up)
    jobs/                 Job validation, statuses, Jobs screen sections, teams, queries (with tests)
    steps/                Step queries and entry validation (with tests)
    mock-data.ts          Temporary sample trailers for Weekly Setup
  test/                   Test-only helpers (runs migrations in an in-process Postgres)
supabase/
  migrations/             Database schema and security rules
scripts/                  Build helpers (Worker secret protection, workflow seed generator)
docs/                     Product spec, implementation plan, Supabase setup
```

## Current status

**Phase 1: sign-in and route protection — complete and verified against the live Supabase project.** Owner and employee test accounts signed in successfully, a wrong password was rejected, and an employee visiting `/owner` was redirected to `/jobs`.

What exists:

- Email and password sign-in with show/hide password, loading state, and clear error messages. No public sign-up.
- `owner` and `employee` roles stored in the database, with Row Level Security.
- Every page requires sign-in. Signed-out visitors are redirected to the sign-in screen and returned to the page they wanted afterwards.
- Owner-only pages are blocked for employees. Deactivated accounts are signed out.
- A real Account screen with Change Password and a working Sign Out.

**Phase 1B: Team screen — complete and verified against the live Supabase project.** Account creation with a one-time temporary password, the employee password change and reminder, password reset, deactivation, reactivation, and employee redirects away from `/owner/team` were all tested successfully. Setup steps are in `docs/SUPABASE_SETUP.md`, step 8.

- Owner-only Team screen at `/owner/team`, with active and inactive accounts listed separately.
- The owner creates employee accounts. Armour Ops generates a temporary password on the server and shows it once, with a Copy Password button, for the owner to text to the employee. Temporary passwords are never stored or logged.
- The owner can reset a forgotten password (a new one-time temporary password), and deactivate or reactivate accounts, each after a confirmation. Owners cannot deactivate their own account, and the database refuses to deactivate the last active owner.
- Account history records creation, password resets, deactivation, and reactivation without any password.
- Everyone can change their own password on the Account screen. Users with a temporary password see a reminder.
- The Weekly Setup screen still uses fictional sample trailers from `src/lib/mock-data.ts` until Phase 10.

**Phase 2: approved workflow — complete and verified against the live Supabase project.** Both migrations ran, and the owner confirmed the stored workflow at `/owner/workflow` matches the approved specification. Setup steps are in `docs/SUPABASE_SETUP.md`, step 9.

- The approved workflow from `docs/PRODUCT_SPEC.md` is stored as version 1 of a versioned, read-only workflow template: 5 stages and 16 steps, with Final checks, reference-only setup lists, proof requirements, structured inputs, owner-only installation milestones, and Completion Work.
- Published versions cannot be changed, so jobs will keep the version they started with.
- Owners can review the stored workflow at `/owner/workflow`.

**Phase 3: jobs — complete and verified against the live Supabase project.** Job creation with defaults and validation, the workflow snapshot, editing with history, Make Available, Return to Scheduled, and employee read-only access were all tested successfully. Setup steps are in `docs/SUPABASE_SETUP.md`, step 10.

- Owners create jobs at `/owner/jobs/new` (Caulking on, Baseboard off, and Allow Employees to Join on by default). Each new job starts as Scheduled and gets its own copy of the active workflow version, so later workflow changes never affect it.
- Owners edit Scheduled jobs, make them available, and return them to Scheduled. Every change is kept in the job's history.
- The Jobs screen shows real jobs in My Current Jobs, Other Active Jobs, Available Jobs, Scheduled Jobs, and Completed Jobs. Employees have read-only access.

**Phase 4: claiming and job teams — complete and verified against the live Supabase project.** Claiming, joining, the join setting, owner additions and removals, lead replacement, team history, deactivation, and read-only access were tested successfully; simultaneous-claim protection is covered by the database tests. Setup steps are in `docs/SUPABASE_SETUP.md`, step 11.

- Employees claim Available jobs (the first claim becomes the lead) and join in-progress jobs when the owner allows joining.
- The owner adds and removes team members, changes the lead, and turns joining on or off. A lead with teammates can only be removed by naming a new lead.
- Team history is kept: assignments are ended, never deleted, and every change records who made it and when.

**Phase 5: step screens without media — complete and verified against the live Supabase project.** Step screens, autosave, status changes, one-editor edit leases, live updates between employees, owner hold clearing, and media-required blocking were tested successfully. Two bugs found in live testing (out-of-date open screens, and owner-cleared holds that could still save) were fixed and retested. Setup steps are in `docs/SUPABASE_SETUP.md`, step 12.

- Job pages show a workflow map from the job's own snapshot, with step states and owner-only milestones.
- Team members work steps one at a time with an expiring edit lease: Final check, required entries, notes, and the confirmation, all saved as they go. Completed steps record who completed them and when, and never change.

**Phase 6: photo and video proof — complete and verified against the live Supabase project and a private Cloudflare R2 bucket.** Video and picture uploads from an iPhone (including HEIC), progress, cancel, lost-connection retry and resume, server verification, completion gating, private viewing, and access refusals were tested successfully. Testing on a phone over the local network needs `DEV_LAN_HOSTS` in `.env.local`. Setup steps are in `docs/SUPABASE_SETUP.md`, step 13.

- Phones upload proof straight to a private Cloudflare R2 bucket using short-lived links; the R2 keys stay on the server and files never pass through the app's server.
- Pictures are compressed on the phone to at most 5 MB. Videos (MOV or MP4, up to 3 minutes and 300 MB) upload in parts and continue after a lost connection or a reload.
- A step needing proof completes only after every required file is uploaded and checked by the server. Proof on a completed step can't be removed or replaced.
- Only the owner and the job's team can view proof, through links that expire within minutes.

**Phase 7: installation milestones and Completion Work — complete and verified against the live Supabase project.** Both installation milestones, stale-request safety, Completion Work order and attribution, the Owner Dashboard groups, Mark Job Complete, the five-year retention date, and read-only complete jobs were tested successfully. Setup steps are in `docs/SUPABASE_SETUP.md`, step 14.

- Only the owner can mark Base Coat Installed and Top Coat Installed, each only from its waiting status and with a confirmation. The owner and time are recorded, and the next stage opens.
- After Top Coat Installed, team members mark Caulking Complete and then Baseboard Complete, each only when the job option is on; items for options that are off show as Not applicable.
- The owner marks the job Complete once everything is done. Complete jobs are read only, and their pictures and videos are kept for five years.
- Owner notifications are in-app only: the Owner Dashboard shows counts and links for jobs waiting for each installation or ready to mark Complete. Employees text the owner when a job is ready for an installation.

**Phase 8: reopening, custom steps, the Custom Step Library, reference pictures, and Working Owner — built; waiting for live verification.** Setup steps are in `docs/SUPABASE_SETUP.md`, step 15.

- The owner keeps reusable custom steps (such as Sand Stairs) in a versioned Custom Step Library, imports them into jobs, or adds one-time steps. Jobs keep the copy they imported.
- Owner reference pictures guide employees on standard and custom steps. They are private and never count as proof.
- The owner can join a job as an Owner/Working Member to work steps with full attribution; the employee lead stays the lead.
- The owner can reopen a completed step with a reason. The earlier attempt and its proof are kept; the team redoes the step as a new attempt.

Not built yet: skipping, reordering, and editing standard job steps; role changes on the Team screen; Weekly Setup checklists; and deployment. See the implementation plan for the order.
