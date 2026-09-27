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
