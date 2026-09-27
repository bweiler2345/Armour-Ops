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

Never copy the **secret** key or the legacy **service_role** key into `.env.local` for Phase 1. They are not needed.

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

## 6. Create a test employee account (optional)

Once Phase 1B is built, the owner creates employee accounts from the Team screen with temporary passwords. Until then, to test the employee view:

1. Add another user the same way as step 5.1–5.2, using an email address you control.
2. Give it a name (it is already an employee by default):

   ```sql
   update public.profiles
   set full_name = 'TEST_EMPLOYEE_NAME'
   where id = (select id from auth.users where email = 'TEST_EMPLOYEE_EMAIL');
   ```

To test a deactivated account, set `active = false` the same way, and set it back to `true` afterwards.

## 7. Try it

1. Run `npm run dev` and open [http://localhost:3000](http://localhost:3000).
2. You are sent to the sign-in page. Sign in with the owner account. You land on the Owner Dashboard.
3. Sign out from the Account screen, then sign in as the test employee. You land on Jobs. Visiting `/owner` sends you back to Jobs.
4. Signing in with a wrong password shows "That email and password don’t match."
