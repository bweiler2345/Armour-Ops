# Supabase Setup (Phase 1)

These steps connect Armour Ops to a Supabase Free project and create the first owner account. They are done once, by the owner, in the Supabase dashboard.

**Do not put real names, email addresses, passwords, or keys in this repository.** Everything below that looks like `YOUR_...` is a placeholder you type only into the Supabase dashboard or your local `.env.local` file.

## 1. Create the project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and sign in or create a free account.
2. Select **New project**.
3. Choose the **Free** plan, name it (for example `armour-ops`), pick the region closest to your crews, and set a strong database password. Save the password in your password manager. The app does not need it in Phase 1.
4. Wait for the project to finish setting up.

## 2. Create the database tables

1. In the project, open **SQL Editor** and select **New query**.
2. Open `supabase/migrations/20260927000000_profiles_and_roles.sql` from this repository, copy its entire contents, and paste them into the editor.
3. Select **Run**. It should finish with "Success. No rows returned."

This creates the `profiles` table, the `owner` and `employee` roles, and the security rules.

## 3. Turn off public sign-up

1. Open **Authentication**, then **Sign In / Providers**.
2. Make sure **Email** is enabled.
3. Turn **off** "Allow new users to sign up" and save.

You can still add users yourself from the dashboard with sign-up turned off.

## 4. Connect the app on your computer

1. In the repository folder, copy `.env.example` to a new file named `.env.local`.
2. In the Supabase dashboard, open **Project Settings**, then **Data API** (or select **Connect** at the top of the project). Copy the **Project URL** into `NEXT_PUBLIC_SUPABASE_URL`.
3. Open **Project Settings**, then **API Keys**. Copy the **Publishable key** (it starts with `sb_publishable_`) into `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. Save `.env.local`. It is ignored by Git and must never be committed.

The **secret** key is added separately in step 8.2, under its own server-only name. Never put it in a `NEXT_PUBLIC_` variable.

## 5. Create the owner account

1. Open **Authentication**, then **Users**, then **Add user**, then **Create new user**.
2. Enter your email and a strong password, check **Auto Confirm User**, and create the user.
3. Open **SQL Editor**, start a new query, and run this after replacing the two placeholders. Do not save the filled-in query anywhere in the repository.

   ```sql
   update public.profiles
   set role = 'owner', full_name = 'YOUR_FULL_NAME'
   where id = (select id from auth.users where email = 'YOUR_EMAIL');
   ```

   It should report "1 row affected".

## 6. Create a test employee account (Phase 1 only)

This was only needed before the Team screen existed. From Phase 1B on, create employees from the Team screen instead (see step 8). Any employee account you already created here is kept and shows up on the Team screen; do not create it again.

## 7. Try it

1. Run `npm run dev` and open [http://localhost:3000](http://localhost:3000).
2. You are sent to the sign-in page. Sign in with the owner account. You land on the Owner Dashboard.
3. Sign out from the Account screen, then sign in as the test employee. You land on Jobs. Visiting `/owner` sends you back to Jobs.
4. Signing in with a wrong password shows "That email and password don’t match."

## 8. Phase 1B: Team screen setup

Do these once, in order.

### 8.1 Run the Phase 1B database update

1. Open **SQL Editor**, then **New query**.
2. Copy the entire contents of `supabase/migrations/20260927010000_team_accounts.sql` from this repository, paste it, and select **Run**. It should finish with "Success. No rows returned."

This adds account-status columns to `profiles` (existing accounts, including any test employee, are kept and get their email copied in), the `account_events` history table, and a rule that the last active owner can never be deactivated. It never stores passwords.

### 8.2 Add the server secret key to `.env.local`

1. In the Supabase dashboard, open **Project Settings**, then **API Keys**.
2. Under **Secret keys**, use the existing key or select **Add new secret key**. Name it something like `armour-ops-local`. It starts with `sb_secret_`.
3. Reveal and copy it, then open `.env.local` on your computer and add this line, pasting the key after the `=`:

   ```
   SUPABASE_SECRET_KEY=
   ```

   The name must be exactly `SUPABASE_SECRET_KEY`, with **no** `NEXT_PUBLIC_` prefix.
4. Save the file and restart `npm run dev`.

Never paste this key into chat, code, documentation, or a commit. It bypasses every security rule. `.env.local` is ignored by Git. If the key is ever exposed, delete it in the dashboard and create a new one.

Older projects may only show the legacy **service_role** key under **Legacy API Keys**. Prefer creating a new secret key; if you must use the legacy key, it goes in the same `SUPABASE_SECRET_KEY` variable.

### 8.3 Adjust two sign-in settings

1. Open **Authentication**, then the email provider settings (**Sign In / Providers**, then **Email**).
2. Turn **off** **Secure password change**. With it on, Supabase can require an emailed code before a password change, and Armour Ops does not send email.
3. Set the **minimum password length** to **10**, to match the Change Password form. Save.

### 8.4 Try it

1. Sign in as the owner and open **Owner Dashboard**, then **Team**. Your account and any existing employee appear under **Active**.
2. Select **Add Employee**, enter a test name and an email address you control, and select **Create Account**. Copy the temporary password from the dialog. It is shown only once.
3. In a private browser window, sign in as that employee with the temporary password. A reminder asks you to change it. Change it on the **Account** screen.
4. Back as the owner, select **Reset Password** for the test employee, confirm, and copy the new temporary password. The old password stops working.
5. Select **Deactivate**, confirm, and check that the employee can no longer sign in. Then **Reactivate** them.
6. As the employee, visiting `/owner/team` sends you back to Jobs.

### Local Cloudflare previews

`npm run cf:preview` does not use the secret key from `.env.local`: the build removes it from the Worker on purpose. To use the Team screen in a local Cloudflare preview, put the same `SUPABASE_SECRET_KEY=...` line in a file named `.dev.vars` in the project folder. `.dev.vars` is also ignored by Git.

## 9. Phase 2: Load the approved workflow

Run these two files, **in this order**, in **SQL Editor** (a new query for each, paste the whole file, select **Run**):

1. `supabase/migrations/20260927020000_workflow_templates.sql` creates the versioned workflow template tables, their rules, and read-only security. It should finish with "Success. No rows returned."
2. `supabase/migrations/20260927020100_seed_approved_workflow_v1.sql` loads the approved workflow from `docs/PRODUCT_SPEC.md` as version 1 and makes it active. It should finish with "Success. No rows returned."

The second file is safe to run again: if version 1 is already loaded with the same content it does nothing, and if a different version 1 exists it stops with an error instead of changing it.

Then check it:

1. Sign in as the owner and open **Owner Dashboard**, then **Workflow**.
2. Compare it with `docs/PRODUCT_SPEC.md`: 5 stages (Initial Prep, Base-Coat Installation, Top-Coat Prep, Top-Coat Installation, Completion Work) and 16 steps (9 in Initial Prep, 5 in Top-Coat Prep, and Caulking Complete and Baseboard Complete in Completion Work).
3. Optional check in **SQL Editor**:

   ```sql
   select key, version, status from public.workflow_templates;
   ```

   It should return one row: `armour-floors-standard`, version `1`, status `active`.

## 10. Phase 3: Jobs

Run this file in **SQL Editor** (new query, paste the whole file, select **Run**). The Phase 2 files must already have been run.

1. `supabase/migrations/20260927030000_jobs.sql` creates jobs, per-job workflow snapshots, job history, the status rules, and read-only access for employees. It should finish with "Success. No rows returned."

Then check it with fictional test data only (no real customer names or addresses):

1. Sign in as the owner. Open **Owner Dashboard**, then **Jobs**. Every section shows an empty message.
2. Select **New Job**. Check that **Caulking** and **Allow Employees to Join** are on and **Baseboard** is off. Select **Create Job** with everything blank and confirm each required field shows an error. Try a square footage of `0` and of `abc`.
3. Fill in a fictional client, address, square footage (for example `1,250`), flake color, and a date, and create the job. The job page shows status **Scheduled**, workflow version 1, and a **History** entry for the creation.
4. Select **Edit Details**, change the square footage and turn on **Baseboard**, and save. History shows both changes with old and new values, and the workflow outline now includes Baseboard Complete.
5. Select **Make Available**. The status becomes **Available to Claim** and Edit Details disappears. Select **Return to Scheduled** and confirm it goes back.
6. Sign in as an employee (a private window works). **Jobs** shows the job under **Scheduled Jobs** (or **Available Jobs** if you made it available), with every card field. Opening it shows the details read only, with no edit or status buttons. Visiting `/owner/jobs` sends the employee back to Jobs.
7. Optional check in **SQL Editor**:

   ```sql
   select job_number, status, workflow_version from public.jobs;
   ```

## 11. Phase 4: Claiming and job teams

Run this file in **SQL Editor** (new query, paste the whole file, select **Run**). The Phase 3 file must already have been run.

1. `supabase/migrations/20260927040000_job_teams.sql` adds job teams (one lead plus members), claiming, joining, owner team management, and team history. It should finish with "Success. No rows returned."

You need the owner account and at least **three active employee accounts** (create test employees on the Team screen if needed). Use a fictional job. A private window, or a second phone, makes switching accounts easier.

1. **Claim.** As the owner, create a job and select **Make Available**. As Employee A, open **Jobs**: the job is under **Available Jobs** with a large **Claim Job** button. Claim it. It moves to **My Current Jobs**, its status is **Claimed**, and the team shows Employee A as **Lead**.
2. **Losing claim.** Make a second job available. Open it as Employee B in one window and Employee C in another, then select **Claim Job** in both, one right after the other. One succeeds; the other shows "Someone else claimed this job first." and is not added.
3. **Join.** As Employee B, open the first job (under **Other Active Jobs**) and select **Join Job**. The team shows A as Lead and B as Member, and the job moves to B's **My Current Jobs**.
4. **Joining off.** As the owner, open the first job and select **Turn Joining Off**. As Employee C, open the job: there is no Join button, and it says the owner turned off joining.
5. **Owner adds.** As the owner, with joining still off, add Employee C. The team now has three people.
6. **Lead rules.** As the owner, select **Remove** on the lead (Employee A). The dialog requires choosing a new lead; choose Employee B and confirm. B is Lead, A is gone, and **History** shows the removal and the lead change with names and times. Then select **Make Lead** on Employee C: C becomes Lead and B stays as a Member.
7. **Remove a member.** Remove Employee B. History keeps the removal.
8. **Deactivated employee.** On the Team screen, deactivate a test employee who is on a job. Their name stays on the job team marked **Deactivated**, and they can no longer sign in. Reactivate them afterwards.
9. **Read only.** As an employee who is not on a job, open it: you see the team but can't change anything. Visiting `/owner/jobs` sends you back to Jobs.

## 12. Phase 5: Step screens (without media)

Run these files in **SQL Editor**, **in this order** (a new query for each, paste the whole file, select **Run**). The Phase 4 file must already have been run.

1. `supabase/migrations/20260927050000_step_work.sql` adds step attempts, Final check and entry answers, edit holds, the step rules, and step progress. It should finish with "Success. No rows returned."
2. `supabase/migrations/20260927060000_step_edit_leases.sql` turns edit holds into leases: every save needs the exact lease the database issued to that screen, and a cleared or old lease can never save again. It should finish with "Success. No rows returned." If you already ran file 1, run only this one.

What to expect: in the approved workflow, the first step (Grind Floor) needs a video, and uploading arrives in Phase 6. So on a live job you can work through Grind Floor's Final check, but you cannot complete it yet, and the later steps stay locked. Completing no-proof steps (such as Clean Edges and Corners and Collect Excess Flake) is covered by the automated database tests.

You need the owner and two active test employees (A and B), and a fictional job that A has claimed and B has joined (see step 11).

1. **Workflow map.** As A, open the job. The Workflow section shows each stage with a progress bar, Grind Floor as the current step, later steps locked, and both installation milestones marked **Owner only**. A **Continue: Grind Floor** button is near the top.
2. **Edit hold.** Select **Continue**. The step shows "You're editing this step", the goal, the numbered instructions, the Final check, the required video, and the confirmation statement.
3. **Autosave.** Tick two Final check items. "Saved" appears. Go back to the job: the status is now **Initial Prep in Progress**, and History (as the owner) shows the step started and the status change.
4. **One editor at a time.** With A's step screen still open, open the same step as B. B sees who is editing and until about when, and cannot tick anything. Close A's screen (or wait about two minutes); B selects **Try again** and can now edit, with A's ticks still there.
5. **Owner clears a hold.** While B has the step open, open the step as the owner and select **Clear Edit Hold**. History shows the clear. B's next tick shows that their editing time ran out, with an **Edit this step** button.
6. **Media blocks completion.** Tick every Final check item and the confirmation. The button reads **Needs Proof to Complete** and stays disabled, and the list explains that uploading arrives in the next update.
7. **Locked steps and reference lists.** From the job's Workflow section, open **Set Up for Base-Coat Installation** (locked). It is read only; its mixing-station and inside-work-area lists appear as **Reference** lists with no checkboxes, and its Final check shows as read only.
8. **Read only.** As an employee not on the job, open Grind Floor: you see A's or B's progress but cannot change anything. As the owner, you can view every step but not tick anything.

## 13. Phase 6: Photo and video proof (Cloudflare R2)

Proof files are stored in a **private** Cloudflare R2 bucket, not in Supabase. Phones upload straight to R2 using short-lived links the app issues after checking the employee, the job team, and the edit lease; the R2 keys stay on the server. Nothing here needs a paid plan: R2's free allowance covers 10 GB of storage.

### 13.1 Run the Phase 6 database update

The Phase 5 files (step 12) must already have been run. In **SQL Editor**, run `supabase/migrations/20260927070000_step_media.sql` (new query, paste the whole file, **Run**). It should finish with "Success. No rows returned." It adds upload records, verification states, retention dates, and the rule that a step needing pictures or videos completes only with verified uploads.

### 13.2 Create the private bucket

In the Cloudflare dashboard (sign in with your own account):

1. Open **R2 Object Storage**. If asked, enable R2 (the free plan is enough; Cloudflare may ask for a payment method even for free usage).
2. Select **Create bucket**.
   - **Bucket name:** `armour-ops-media-dev` (for local testing; a separate production bucket comes with deployment).
   - **Location:** Automatic.
   - **Default storage class:** Standard.
3. Select **Create bucket**.
4. Open the bucket's **Settings** tab and confirm it is private:
   - **Public access → R2.dev subdomain:** leave **Disabled**.
   - **Custom domains:** leave empty.

### 13.3 Allow uploads from the app (CORS)

Still in the bucket's **Settings** tab, find **CORS Policy**, select **Add CORS policy** (or **Edit**), and paste exactly:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "http://localhost:8787"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Select **Save**. Only uploads need this: viewing uses ordinary links, and the server checks finished uploads itself, so no response headers need exposing. `localhost:8787` is for `npm run cf:preview`. If you test on a phone using your computer's network address (for example `http://192.168.1.20:3000`), add that exact address to `AllowedOrigins` too. The production address is added at deployment.

### 13.4 Clean up abandoned uploads automatically

In the bucket's **Settings** tab, find **Object lifecycle rules**. Cloudflare adds a default rule that aborts incomplete multipart uploads after 7 days; keep it. If it is missing, select **Add rule**, name it `abort-incomplete-uploads`, apply it to all objects, turn on **Abort incomplete multipart uploads** after **7 days**, and save.

Do **not** add a rule that deletes objects. Proof is kept for five years after job completion; the app records the date each job's media becomes eligible for cleanup, and a later phase will do the cleanup.

### 13.5 Create an API token for this bucket only

1. Go back to **R2 Object Storage** (the overview page), and in **Account details** select **Manage** next to **API Tokens** (on some dashboards: **Manage R2 API Tokens**).
2. Select **Create Account API token** (or **Create User API token**).
   - **Token name:** `armour-ops-media-dev`
   - **Permissions:** **Object Read & Write**
   - **Specify bucket(s):** **Apply to specific buckets only**, then choose `armour-ops-media-dev`.
   - **TTL:** Forever (or a date you'll remember to renew).
   - **Client IP address filtering:** leave empty.
3. Select **Create API Token**. The next page shows values **once**. You need two of them, from the **S3 client** section: **Access Key ID** and **Secret Access Key**. (The "Token value" at the top is not used.)
4. On the R2 overview page, **Account details** also shows your **Account ID**.

### 13.6 Add the settings to `.env.local`

Open `.env.local` in the project folder (never in chat, and never commit it) and add these four lines with your own values:

```
R2_ACCOUNT_ID=<Account ID from 13.5, step 4>
R2_ACCESS_KEY_ID=<Access Key ID from 13.5>
R2_SECRET_ACCESS_KEY=<Secret Access Key from 13.5>
R2_BUCKET=armour-ops-media-dev
```

- Never add a `NEXT_PUBLIC_` prefix to any of these names.
- For `npm run cf:preview`, put the same four lines in `.dev.vars` (also ignored by Git). `npm run cf:build` removes them from the Worker bundle and fails if a key appears in the build output.
- Restart `npm run dev` after editing `.env.local`.

If the values are missing, the step screen says "Uploads aren't set up yet" and nothing is uploaded.

### 13.7 Testing on a phone over Wi-Fi

The phone and computer must be on the same Wi-Fi network.

1. Run `npm run dev`. It prints a **Network** address such as `http://192.168.1.20:3000`.
2. In `.env.local`, add (or update) this line with that address's host only, no `http://` and no port:
   ```
   DEV_LAN_HOSTS=192.168.1.20
   ```
   Without it, Next.js blocks its development scripts for any address other than `localhost`: the phone can load pages and sign in, but screens never become interactive (for example, a step stays on "Opening this step for editing…").
3. Add the same full address (`http://192.168.1.20:3000`) to the bucket's CORS `AllowedOrigins` (13.3), or uploads from the phone are refused.
4. Stop and restart `npm run dev`, then open the Network address on the phone.

When the computer's address changes (a different network or router), update `DEV_LAN_HOSTS` and the CORS entry, and restart `npm run dev`. Nothing in the code changes. This setting only affects `npm run dev`; production is unaffected.

### 13.8 Try it

You need the owner, two active test employees (A and B) on a fictional job's team, one employee (C) who is not on the team, and a phone. Use test pictures and videos only, never a real customer's floor with identifying details.

1. **Required proof is shown first.** As A, open **Grind Floor**. Under **Required proof** it says one video, MOV or MP4, up to 3 minutes and 300 MB, and **Complete Step** reads **Needs Proof to Complete**.
2. **Unsupported and oversized files.** Choose a picture where the video is required: "This proof needs a video, not a picture." Choose a video longer than 3 minutes: "That video is 3:25 long. Videos can be up to 3 minutes." (or similar). Your ticked Final check items stay ticked.
3. **Video upload with progress.** Record or choose a 1 to 3 minute video on the phone. The item shows "Checking video…", then "Uploading N%" with a bar, then "Checking upload…", then **Video uploaded** with its length and size.
4. **Interrupted upload.** Start another large video on a step that needs one (or remove the first and add it again), then turn on airplane mode mid-upload. After a few tries it shows "Lost connection…" with **Retry**. Turn airplane mode off and tap **Retry**: it continues from where it stopped rather than from 0%.
5. **Reload and resume.** Start a video upload and reload the page mid-way. The item shows "Upload paused. Choose the same video to continue." Tap **Continue**, choose the same video, and it finishes. Choosing a different video is refused.
6. **Cancel and remove.** Start an upload and tap **Cancel**: it disappears without asking. Tap **Remove** on an uploaded video: a confirmation appears; **Keep** leaves it, **Remove** removes it and History (as the owner) shows the removal.
7. **Completion.** With the video uploaded, every Final check item ticked, and the confirmation tapped, **Complete Step** unlocks and completes the step. The step then shows the video read only, with no Remove button.
8. **Pictures.** On a step that needs pictures (for example the setup step's photos), use the camera and the photo library. Each picture shows "Preparing picture…", then progress, then a thumbnail. HEIC pictures from an iPhone work. On a step that allows several pictures, **Add Another Picture** keeps working.
9. **Private viewing.** As B (on the team) and as the owner, open the completed step: the video and pictures open. As C (not on the team), open the same step: the proof shows "Only the job's team and the owner can see proof files." Copy a proof link (`/media/…`) from A's screen and open it signed in as C: "Not found." Signed out, it goes to the sign-in page. A signed link copied from the browser's address bar after opening a video stops working after about 15 minutes (pictures after 5).
10. **Edit lease.** While A is uploading, have the owner select **Clear Edit Hold**. A's upload stops being accepted and A sees that the owner ended the session; after **Edit this step**, **Retry** finishes it.
11. **Bucket stays private.** In the R2 dashboard, open the bucket's objects: files are under `jobs/<job id>/steps/<step id>/<attempt id>/…` with random names. The bucket has no public URL.

## 14. Phase 7: Installation milestones and Completion Work

Owner notifications are in-app only (approved owner decision): no email provider or new settings are needed. Employees text the owner when a job is ready for an installation.

### 14.1 Run the Phase 7 database update

The Phase 6 file (step 13.1) must already have been run. In **SQL Editor**, run `supabase/migrations/20260927080000_milestones_and_completion.sql` (new query, paste the whole file, **Run**). It should finish with "Success. No rows returned." Restart `npm run dev` afterwards.

### 14.2 Try it

You need the owner, two active test employees (A and B) on a fictional job's team, and one employee (C) who is not on the team. Use the phone for the employee steps. Create the test job with **Caulking on** and **Baseboard on** so both Completion Work items appear. Use test pictures and videos only.

1. **Before the milestone.** While Initial Prep is still in progress, open the job as the owner: there is no **Mark Base Coat Installed** button, and the Owner Dashboard's **Needs you** count doesn't include it.
2. **Waiting for Base-Coat Installation.** As A, complete every Initial Prep step (with its required proof). The job page shows **Waiting for owner: Base-Coat Installation** and a reminder to text the owner. Top-Coat Prep steps stay locked. Within about 30 seconds, without reloading, the owner's dashboard shows the job under **Waiting for Base-Coat Installation** with a count, and the owner's Jobs screen lists it under **Needs You**.
3. **Employees can't mark it.** As A, B, and C, no installation button appears anywhere.
4. **Mark Base Coat Installed.** Sign in as the owner on both the computer and a second device (or a second browser), and open the job page on both. On the computer, tap **Mark Base Coat Installed**. A confirmation appears; **Cancel** changes nothing. Tap it again and confirm. The job becomes **Base Coat Installed**, the workflow map shows "Installed by (owner) · (time)", History shows the milestone and the status change, and the dashboard count goes down.
5. **Stale request.** Right away, on the second device, tap **Mark Base Coat Installed** and confirm. It says Base Coat Installed was already marked and nothing changed; History still has one milestone entry. (If the button has already disappeared, that screen refreshed itself first, which is also correct.)
6. **Top-Coat Prep opens.** As A, the job page offers **Continue** to the first Top-Coat Prep step. Starting it moves the job to Top-Coat Prep in Progress.
7. **Waiting for Top-Coat Installation.** As A, complete every Top-Coat Prep step. The job appears under **Waiting for Top-Coat Installation** on the dashboard. As the owner, mark **Top Coat Installed** (with confirmation). The job becomes **Top Coat Installed** and Completion Work opens.
8. **Completion Work order.** As B, open the job: **Continue: Caulking Complete**. **Baseboard Complete** shows "Opens after the item above is complete". Tap **Caulking Complete**, confirm, and the job becomes **Completion Work in Progress**, with B's name and time on the item. Then complete **Baseboard Complete** as A.
9. **Not on the team.** As C, open a Completion Work item on the job: there is no button, only a note that you can view the step but not change it.
10. **Ready for review.** The job page tells the team that all work is done and it's waiting for the owner. The owner's dashboard shows it under **Ready to Mark Complete**.
11. **Mark Job Complete.** As the owner, review the steps, proof, and History, then tap **Mark Job Complete** and confirm. The job becomes **Complete**, the page says it is read only and shows the date its pictures and videos are kept until (five years later), and it moves to **Complete** on the Jobs screens (owner and employees).
12. **Read only.** As A, open any step of the complete job: nothing can be changed or uploaded. As the owner, there are no milestone, team-change, or completion buttons. Completed proof still opens for the owner and the team.
13. **Options off (optional).** On a job created with **Baseboard off**, Baseboard Complete shows **Not applicable** and the job is ready for the owner once Caulking Complete is done. With both off, the job is ready for Mark Job Complete right after Top Coat Installed. These combinations are also covered by the automated database tests.
