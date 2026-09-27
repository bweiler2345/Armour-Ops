# Armour Ops Product Specification

## Product purpose

Armour Ops is a private, mobile-first web application for Armour Floors employees and management.

Its purposes are to:

1. Give employees a clear visual workflow for every flooring job.
2. Allow employees to claim and join jobs and track progress.
3. Require verification, pictures, videos, or notes at important steps.
4. Allow the owner to monitor job progress remotely.
5. Separate employee preparation work from owner-controlled coating installations.
6. Provide a Weekly Setup section for trailer inventory checks.

The interface must remain clean, visual, and touch-friendly for employees using iPhones, including employees wearing work gloves.

## User roles

### Owner/Admin

The owner can:

- Create and edit jobs.
- Enter job information.
- Make a Scheduled job available, and return an unassigned job to Scheduled.
- View scheduled, available, active, and completed jobs.
- See the lead employee and every assigned employee on each job.
- Add employees to a job, remove employees from a job, and change the lead employee.
- Turn a job’s “Allow Employees to Join” setting on or off.
- View completed steps and timestamps.
- View submitted pictures, videos, notes, and verification responses.
- Add, remove, reorder, skip, reopen, or edit steps.
- Add custom job steps.
- Mark Base Coat Installed.
- Mark Top Coat Installed.
- Review a job and select Mark Job Complete.
- Monitor live job progress.
- Receive in-app and email notifications.
- View Weekly Setup submissions and trailer shortages.
- Manage employee accounts on the Team screen.

### Employee

Employees can:

- View all jobs and their progress. Employees not assigned to a job have read-only access to it.
- Claim an available job.
- Join an active job when the owner has turned on “Allow Employees to Join.”
- Belong to more than one active job at the same time.
- Open their assigned jobs.
- View the current stage and next required step.
- Open visual instructions for each step.
- Complete verification checklists.
- Upload required pictures or videos.
- Enter required notes or quantities.
- Check Caulking Complete and Baseboard Complete when applicable.
- Complete Weekly Setup trailer checks.

When something goes wrong on a job, employees text or call the owner. In-app problem reporting is a future feature.

## Accounts and Team management

- Employees and the owner sign in with email and password.
- There is no public sign-up. The owner creates every employee account.
- The owner manages accounts on an owner-only Team screen. The Team screen allows the owner to:
  - Create an employee account by entering the employee’s name and email.
  - See a secure temporary password that Armour Ops generates for the new account. It is shown to the owner once, so the owner can send it to the employee by text.
  - Generate a new temporary password for an employee who forgets theirs. It is also shown once.
  - Deactivate or reactivate an employee.
  - View the employee’s role.
  - Change roles later if needed.
- Temporary passwords are never stored in the application database, logs, or activity history.
- After signing in, every user can change their own password from the Account screen.
- There are no automated invitation emails or password-reset emails in version one.
- Account creation, temporary-password resets, activation, deactivation, and role changes are owner-only actions.
- Administrative account changes happen only through a trusted server-only path. No administrative secret is ever exposed in browser code, logs, error messages, or the public repository.
- Real owner or employee names and email addresses are never placed in the public repository, documentation, mock data, migrations, or seed files.

## Job creation

The owner creates a job with:

- Client name
- Address
- Square footage
- Flake color
- Scheduled date
- General notes
- Caulking required toggle
- Baseboard required toggle
- Allow Employees to Join setting
- Custom steps

Defaults:

- Caulking is selected by default.
- Baseboard is not selected by default.
- Allow Employees to Join is on by default. The owner can turn it off for an individual job.
- New jobs begin as Scheduled.

The owner can add a custom step and determine:

- Step name
- Stage
- Position in the workflow
- Instructions
- Optional reference picture
- Optional checklist
- Required proof type: none, picture, or video
- Optional structured inputs (see “Structured inputs” below)
- Final confirmation text

## Making jobs available

- New jobs begin as Scheduled.
- Scheduled jobs are visible to employees, read-only, until the owner selects Make Available.
- The owner manually selects Make Available to change a job to Available to Claim.
- Employees cannot claim or join a Scheduled job.
- The owner can return an unassigned job to Scheduled.
- Jobs are never released automatically based on their scheduled date.

## Job teams

- The first employee to claim an available job becomes its lead employee. Only one employee can become the initial lead.
- The owner can add one or more additional employees to the job.
- Each job has an owner-controlled “Allow Employees to Join” setting.
  - When it is on, another employee can join the job without waiting for the owner.
  - When it is off, only the owner can add another employee.
- Every assigned employee can update the job, complete steps, enter checklist responses, enter structured inputs, add notes, and upload evidence.
- Every action records the specific employee who performed it.
- Only one employee can actively edit a particular step at one time, to prevent conflicting updates.
- The owner can remove an employee from the job without deleting that employee’s previous activity.
- Claiming, joining, being added, and being removed are each recorded with the employee and timestamp.
- Employees cannot silently transfer a job to another employee.
- Employees can be assigned to more than one active job at the same time. There is no one-active-job limit.

## Job statuses

- Scheduled
- Available to Claim
- Claimed
- Initial Prep in Progress
- Waiting for Base-Coat Installation
- Base Coat Installed
- Top-Coat Prep in Progress
- Waiting for Top-Coat Installation
- Top Coat Installed
- Completion Work in Progress
- Complete

The “Blocked / Problem Reported” status belongs to the future problem-reporting feature and is not part of the first version.

Each job card should show:

- Client name
- Address
- Square footage
- Flake color
- Scheduled date
- Lead employee and assigned employees
- Current status
- Current step
- Overall progress
- Last activity time

## Employee Jobs screen

The employee Jobs screen contains:

- My Current Jobs: every job the employee is assigned to that is not yet complete.
- Other Active Jobs: jobs in progress that the employee is not assigned to, shown read-only, with a Join button when joining is allowed.
- Available Jobs: jobs that can be claimed.
- Scheduled Jobs: jobs the owner has not made available yet, shown read-only.
- Completed Jobs.

## General step behavior

Each workflow step can contain:

- Step title
- Goal
- Visual reference image
- Ordered instructions
- Reference lists
- Final checklist
- Required proof
- Structured inputs
- Confirmation statement
- Completion timestamp
- Employee who completed it
- Employee notes

Rules:

- Required proof must finish uploading before a step can be completed.
- A step automatically records who completed it and when.
- Employees can view earlier completed steps.
- Employees cannot silently modify a completed step.
- The owner can reopen a completed step.
- Reopened steps retain their original history.
- Progress should autosave.
- Every Final check item must be checked before a step can be completed, unless this specification says otherwise. Reference lists do not need to be checked item by item.
- The system should be designed for future offline saving and later synchronization, but offline functionality is not required in the first version.

## Structured inputs

- Required proof type: none, picture, or video.
- Optional structured input type: none, written text, number, or single-select.
- Each structured input can define a label, whether it is required, an optional unit, and selection choices.
- A step can contain more than one structured input.
- Custom steps must support these structured input types.

## Pictures and videos

Pictures:

- Accept JPEG, HEIC/HEIF, and PNG.
- Compress pictures before upload, targeting approximately 1–5 MB after compression.
- Maximum original picture size: 25 MB.
- Maximum compressed picture size: 5 MB.

Videos:

- Accept MOV and MP4.
- Maximum length: 3 minutes.
- Maximum size: 300 MB.
- Employee iPhones should record in the Most Compatible format.
- Recommended recording setting: 1080p at 30 fps.
- Show the file size before upload.
- Use resumable uploads so an upload can continue when service drops.

Storage:

- All employee-uploaded pictures and videos are stored privately and viewed only through short-lived authorized links.
- Job pictures and videos are retained for five years after job completion.

These values are approved for version one.

## Owner notifications

The owner receives an in-app notification and an email when:

- Initial Prep is complete and the job is Waiting for Base-Coat Installation.
- Top-Coat Prep is complete and the job is Waiting for Top-Coat Installation.

The app keeps a history of in-app notifications.

Each email includes:

- Client name
- Address
- Completed stage
- Employee
- Completion time
- Link to the job

Text message and phone push notifications are future features.

## Hosting and backups

- Armour Ops is hosted on Cloudflare Workers Free using the OpenNext adapter. Vercel and Cloudflare Pages are not used.
- Full Next.js compatibility on Cloudflare Workers is tested before production deployment.
- The hosting plan is upgraded only if actual usage requires it.
- Supabase Free provides authentication and the database.
- Employee-uploaded pictures and videos are stored in a private Cloudflare R2 bucket.
- The Supabase database is exported automatically every week to the private Cloudflare R2 bucket. The newest 12 weekly backups are kept, and older backups are deleted automatically.

# Stage 1: Initial Prep

## Step 1: Grind Floor

### Goal

Grind every area the big grinder can properly hit.

### Instructions

1. Select the correct diamond bond for the concrete.
2. Connect the grinder to the vacuum and confirm good suction.
3. Grind using consistent, overlapping passes.
4. Areas the big grinder cannot hit, including low or uneven spots in the middle, will be completed during hand grinding.

### Final check

- Every area the big grinder can hit has been ground.
- No smooth or shiny areas remain in those areas.
- No removable coating, glue, or contamination remains.

### Required proof

Upload one slow video showing the entire floor.

### Confirmation

“I confirm every area the big grinder can hit has been properly ground.”

## Step 2: Vacuum Floor

### Goal

Remove grinding dust so the floor can be inspected and patched.

### Instructions

1. Vacuum the entire floor using the flat vacuum attachment.
2. Vacuum around cracks, pits, drains, posts, and other obstacles.
3. Make sure all damaged areas requiring patchwork are clearly visible.

### Final check

- No piles or heavy areas of grinding dust remain.
- Cracks, pits, and damaged areas are visible.
- The floor is ready for patchwork.

### Required proof

Upload one slow video showing the entire floor and clearly showing the key areas requiring patchwork.

### Confirmation

“I confirm the floor has been vacuumed and all areas requiring patchwork are visible.”

## Step 3: Patchwork

### Goal

Completely fill all damaged areas and prepare them to be ground flush.

### Instructions

1. Use the proper tool to remove loose debris from every patching area.
2. Vacuum each repair area thoroughly.
3. Mix TEC 305.
4. Completely fill each repair and slightly overfill it for grinding.
5. Inspect all joints and repeat the process on any broken areas around them.

### Final check

- All loose debris was removed before patching.
- Every damaged area was completely filled and slightly overfilled.
- Broken areas around the joints were inspected and patched.

### Required proof

Upload clear pictures showing the completed patchwork.

### Confirmation

“I confirm all damaged areas, including broken areas around the joints, have been properly patched.”

## Step 4: Cut Garage-Door Lines

### Goal

Create a clean termination cut that conforms to the garage-door line.

### Instructions

1. Mark the termination line to follow the garage-door line across the entire opening.
2. Use the angle grinder to make a clean, consistent cut along the marked line.

### Final check

- The cut conforms to the garage-door line.
- The cut is clean and consistent across the opening.

### Required proof

Upload one clear picture of each completed garage-door line.

### Confirmation

“I confirm each termination cut properly conforms to the garage-door line.”

## Step 5: Hand-Grind Edges, Patches, and Missed Areas

### Goal

Finish every area the big grinder could not properly reach and grind all patchwork flush.

### Instructions

1. Connect the hand grinder to the vacuum and confirm good suction.
2. Grind the entire perimeter. Open the dust shroud at garage-door lines, doorways, and drains to grind completely up to them.
3. Grind around posts and other obstacles.
4. Grind all patchwork smooth and flush with the surrounding concrete.
5. Grind any low or uneven areas in the middle that the big grinder missed.

### Final check

- The entire perimeter has been ground.
- Grinding reaches completely up to garage-door lines, doorways, and drains.
- Areas around obstacles have been ground.
- All patchwork is smooth and flush.
- Low or uneven areas missed by the big grinder have been ground.
- No smooth or shiny concrete remains.

### Required proof

Upload one slow video showing the perimeter, patched areas, and corrected areas.

### Confirmation

“I confirm all edges, patches, and areas missed by the big grinder have been properly hand-ground.”

## Step 6: Clean Joints

### Goal

Loosen and remove material from every joint so it can be fully vacuumed later.

### Instructions

1. Use the appropriate tool to remove dirt, loose concrete, old material, and debris from each joint.
2. Clean the full length of every joint, including intersections and ends.
3. Inspect the joints for broken areas that still need patching.

### Final check

- Every joint has been cleaned from end to end.
- No stuck or compacted material remains inside the joints.
- Intersections and ends have been cleaned.
- Any remaining joint damage has been reported.

### Required proof

Upload clear pictures showing the cleaned joints.

### Confirmation

“I confirm every joint has been completely cleaned and inspected.”

## Step 7: Clean Edges and Corners

### Goal

Clear remaining debris and buildup from areas the hand grinder could not reach.

### Instructions

1. Inspect the entire perimeter after hand grinding.
2. Use a 5-in-1 tool or scraper to clean tight edges and corners.
3. Remove any remaining caulk, coating, patch material, plastic, or other buildup along the edges.
4. Pull loosened debris onto the open floor for the final vacuum.

### Final check

- Every edge and corner has been inspected.
- No plastic or other buildup remains along the edges.
- Debris has been pulled out for vacuuming.

### Required proof

None.

### Confirmation

“I confirm all edges and corners have been cleaned and are ready for the final vacuum.”

## Step 8: Final Vacuum

### Goal

Remove all dust and debris so the floor is completely clean for installation.

### Instructions

1. Use the round attachment to vacuum all joints, edges, corners, drains, garage-door lines, and around obstacles.
2. Vacuum the entire open floor using the flat attachment.
3. Inspect the entire floor before putting the vacuum away.

### Final check

- All joints have been completely vacuumed.
- Edges, corners, drains, and garage-door lines are clean.
- The open floor is free of dust and debris.
- No concrete chips or loose material remain.

### Required proof

Upload one slow video showing the entire cleaned floor, including the perimeter and joints.

### Confirmation

“I confirm the entire floor has been thoroughly vacuumed and is clean for installation.”

## Step 9: Set Up for Base-Coat Installation

> The mixing-station checklist and inside-work-area checklist in this step are visual reference lists. Employees do not check each item. “Second weenie roller when needed” is reference text. The final action is an instruction. Employees complete only the Final check, the required proof, and the confirmation for the overall setup step.

### Goal

Organize the mixing station and application tools so the installation can begin immediately.

### Choose the setup location

1. Set up near the garage door closest to the trailer whenever conditions allow.
2. If wind could blow leaves, dust, or other debris onto the floor, set up near the regular side door.
3. If it is raining or snowing, move the necessary setup items inside. Keep filled flake buckets inside the trailer so they remain dry.

### Mixing-station checklist

- Plywood or cardboard floor mat
- Required epoxy
- Flake buckets filled and ready
- Drill with base-coat mixing attachment
- Acetone and rags
- Gloves
- Garbage box
- Dustpan

### Inside-work-area checklist

- Two pairs of clean spike boots
- Clean notched squeegee
- Clean 18-inch roller with a clean nap
- Clean weenie roller with a clean nap
- Second weenie roller when needed
- Brushes placed near the areas where they will be used
- Scraper on a stick

### Final action

- Tape off and protect every drain.

### Final check

- Setup location protects the floor from weather and airborne debris.
- Mixing station is completely organized.
- All application tools and roller naps are clean.
- Inside tools are positioned without blocking the installation path.
- Every drain is completely taped off and protected.

### Required proof

- One picture of the mixing station.
- One picture of the tools staged inside.
- One picture showing each protected drain.

### Confirmation

“I confirm the mixing station and application tools are ready, and every drain is taped off for the base-coat installation.”

# Owner Milestone: Base-Coat Installation

The Base-Coat Installation is currently the owner’s responsibility and must not contain employee installation instructions.

When Initial Prep is complete:

1. Change the status to “Waiting for Base-Coat Installation.”
2. Notify the owner.
3. Only the owner can select “Mark Base Coat Installed.”
4. Record the owner and timestamp.
5. Unlock Top-Coat Prep.

# Stage 2: Top-Coat Prep

## Step 1: Collect Excess Flake

### Goal

Collect the loose flake and return it to the correct boxes.

### Instructions

1. Walk the floor in clean footwear.
2. Use the leaf blower to move loose flake into manageable piles.
3. Collect the flake with the dustpan.
4. Return the flake to the correct boxes, filling any partially full boxes left from the flake broadcast before starting an empty box.

### Final check

- Loose flake has been collected.
- Flake was returned to the correct boxes.
- Partially full boxes were filled first.
- No large piles remain.

### Required structured inputs

This step uses two required structured inputs:

- Full boxes recovered: number.
- Additional flake: single-select with None, ¼ box, ½ box, or ¾ box.

### Required proof

No picture or video.

### Confirmation

“I confirm the loose flake has been collected, stored correctly, and the recovered amount has been recorded.”

## Step 2: Scrape Floor

### Goal

Remove standing and loosely bonded flake before applying the top coat.

### Instructions

1. Scrape the entire floor in one direction using the scraper on a stick.
2. Scrape the entire floor again in the opposite direction.
3. Apply consistent pressure and overlap each pass.
4. Scrape carefully along edges, doorways, drains, and around obstacles.

### Final check

- The entire floor has been scraped in both directions.
- Edges, drains, doorways, and obstacles have been scraped.
- No obvious high or standing flakes remain.

### Required proof

None.

### Confirmation

“I confirm the entire floor has been thoroughly scraped in both directions.”

## Step 3: Clean Joints

### Goal

Remove flake and coating buildup from every joint before vacuuming.

### Instructions

1. Use a 5-in-1 tool to clean flake and coating buildup from each joint.
2. Clean the full length of every joint, including intersections and ends.
3. Pull all loosened material out of the joints and onto the floor.
4. Check that no areas of the joints were missed.

### Final check

- Every joint has been cleaned from end to end.
- Intersections and ends have been cleaned.
- No stuck flake or coating buildup remains.
- Loosened material has been pulled out for vacuuming.

### Required proof

None.

### Confirmation

“I confirm every joint has been completely cleaned and is ready for vacuuming.”

## Step 4: Vacuum Floor

### Goal

Remove all loose flake and debris before the top-coat installation.

### Instructions

1. Use the round attachment to vacuum all joints, edges, corners, drains, doorways, and around obstacles.
2. Vacuum the entire open floor using the flat attachment.
3. Inspect the floor and vacuum any remaining loose flake or debris.

### Final check

- All joints have been completely vacuumed.
- Edges, corners, drains, and doorways are clean.
- No loose flake, dust, or debris remains on the floor.

### Required proof

Upload one slow video showing the entire clean floor, including the joints and perimeter.

### Confirmation

“I confirm the entire floor has been thoroughly vacuumed and is ready for the next step.”

## Step 5: Set Up for Top-Coat Installation

> The mixing-station checklist and inside-work-area checklist in this step are visual reference lists. Employees do not check each item. “Second weenie roller when needed” is reference text. Employees complete only the Final check, the required proof, and the confirmation for the overall setup step.

### Goal

Organize the mixing station and application tools so the top-coat installation can begin immediately.

### Choose the setup location

1. Set up near the garage door closest to the trailer whenever conditions allow.
2. If wind could blow leaves, dust, or other debris onto the floor, set up near the regular side door.
3. If it is raining or snowing, move the necessary setup items inside.

### Mixing-station checklist

- Plywood or cardboard floor mat
- Required top coat
- Drill with top-coat mixing attachment
- Acetone and rags
- Gloves
- Garbage box
- Dustpan

### Inside-work-area checklist

- Two pairs of clean spike boots
- Clean flat top-coat squeegee
- Clean 18-inch roller with a clean nap
- Clean weenie roller with a clean nap
- Second weenie roller when needed
- Brushes placed near the areas where they will be used
- Scraper on a stick

### Final check

- Setup location protects the floor from weather and airborne debris.
- Mixing station is completely organized.
- All application tools and roller naps are clean.
- Inside tools are positioned without blocking the installation path.

### Required proof

- One picture of the mixing station.
- One picture of the tools staged inside.

### Confirmation

“I confirm the mixing station and application tools are clean, organized, and ready for the top-coat installation.”

# Owner Milestone: Top-Coat Installation

The Top-Coat Installation is currently the owner’s responsibility and must not contain employee installation instructions.

When Top-Coat Prep is complete:

1. Change the status to “Waiting for Top-Coat Installation.”
2. Notify the owner.
3. Only the owner can select “Mark Top Coat Installed.”
4. Record the owner and timestamp.
5. Unlock Completion Work.

# Completion Work

Caulking and baseboard are future detailed modules.

For the first version:

- Show a simple “Caulking Complete” checkbox only when caulking was selected on the job.
- Show a simple “Baseboard Complete” checkbox only when baseboard was selected on the job.
- Do not add detailed instructions, sub-checklists, or proof requirements yet.
- Once all applicable completion items are checked, allow the job to be marked Complete.
- Any assigned employee can check “Caulking Complete” when applicable.
- Any assigned employee can check “Baseboard Complete” when applicable.
- Only the owner can select “Mark Job Complete.”
- Before completing a job, the owner can review its completed steps, evidence, completion items, and activity history.

# Weekly Setup

The navigation label is “Weekly Setup,” not “Monday Check.”

Weekly Setup contains one inventory checklist for each trailer. Both trailers use the same inventory list.

Each submission records:

- Trailer
- Employee
- Date and time
- Each item’s target quantity, usable quantity on hand, status, and shortage
- Optional employee note for each item
- Restock notes

The owner can review the current condition of both trailers.

## Item statuses

Each inventory item has one of three statuses:

- Ready
- Missing
- Need More

For items with a numeric quantity, each item stores:

- Target quantity
- Unit or item label when useful
- Usable quantity on hand
- Optional employee note

The status is calculated automatically from the count. Employees do not choose it manually:

- If the usable quantity is zero, the status is Missing.
- If the usable quantity is greater than zero but below the target, the status is Need More.
- If the usable quantity meets or exceeds the target, the status is Ready.
- When the status is Need More, the shortage is calculated and displayed automatically. Example: target 30 brushes, usable quantity 12, display “Need 18 More.”
- Broken or unusable items are not included in the usable quantity and can be explained in the note.

For items without a practical numeric quantity, such as “Rags stocked,” the employee selects Ready, Missing, or Need More and can add a note.

The target quantity for each item is the number in its name in the list below (for example, “Two full fuel cans” has a target of 2). Items listed without a number have a target of 1. “Rags stocked” has no numeric target.

Every submission keeps its historical counts so Weekly Setup can later grow into a fuller inventory-tracking system.

## Required inventory for each trailer

### Core equipment

- Grinder
- Vacuum
- Flat vacuum attachment
- Round vacuum attachment
- Generator
- Two full fuel cans
- Two batteries
- Battery charger
- Two extension cords

### Prep tools

- Angle grinder
- Hand grinder
- Palm sander
- Leaf blower
- Broom
- Dustpan
- Two scrapers
- Three 5-in-1 tools
- Two trowels
- Screwdriver
- Hammer
- Two utility knives
- Extra-soft bit set
- Medium bit set
- Plywood

### Mixing and application

- Drill
- Base-coat mixer
- Top-coat mixer
- Patch mixer
- Small mixer
- Two clear 5-gallon measuring pails
- Ten flake buckets
- Notched squeegee
- Top-coat squeegee
- Two 18-inch rollers
- Two weenie roller sticks
- Three pairs of spikes

### Materials and consumables

- Four bags TEC 305 patch
- Spray bottle
- Thirty 3-inch brushes
- Ten weenie roller naps
- Eight 18-inch, 3/8-inch-nap roller covers
- Two boxes of rubber gloves
- Two cans of acetone
- Rags stocked
- Two rolls of masking tape
- Two rolls of duct tape
- Ten pencils

# Future functionality

Do not implement these until specifically requested:

- Offline workflow synchronization
- Detailed caulking instructions
- Detailed baseboard instructions
- Payroll
- Builder Prime integration
- Automatic scheduling
- Customer access
- App Store distribution
- In-app problem reporting, including:
  - A problem-report form on a job or step, with notes, pictures, or videos
  - Blocking and non-blocking reports
  - The “Blocked / Problem Reported” job status
  - Owner notifications for problem reports
  - Owner resolution of reports
- Text message notifications
- Phone push notifications
- Automated account invitation emails
- Email password recovery (employees resetting a forgotten password themselves by email)
- Archive and export of job pictures, videos, and records
- Fuller inventory tracking built on Weekly Setup history, such as usage trends and restocking lists
