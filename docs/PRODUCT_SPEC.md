# Armour Ops Product Specification

## Product purpose

Armour Ops is a private, mobile-first web application for Armour Floors employees and management.

Its purposes are to:

1. Give employees a clear visual workflow for every flooring job.
2. Allow employees to claim jobs and track progress.
3. Require verification, pictures, videos, or notes at important steps.
4. Allow the owner to monitor job progress remotely.
5. Separate employee preparation work from owner-controlled coating pours.
6. Provide a Weekly Setup section for trailer inventory checks.

The interface must remain clean, visual, and touch-friendly for employees using iPhones, including employees wearing work gloves.

## User roles

### Owner/Admin

The owner can:

- Create and edit jobs.
- Enter job information.
- View available, claimed, active, blocked, and completed jobs.
- See which employee claimed each job.
- View completed steps and timestamps.
- View submitted pictures, videos, notes, and verification responses.
- Add, remove, reorder, skip, reopen, or edit steps.
- Add custom job steps.
- Release or override a claimed job.
- Mark the Base-Coat Pour complete.
- Mark the Top-Coat Pour complete.
- Monitor live job progress.
- View Weekly Setup submissions and trailer shortages.

### Employee

Employees can:

- View available jobs.
- View active jobs.
- Claim an available job.
- Open a claimed job.
- View the current stage and next required step.
- Open visual instructions for each step.
- Complete verification checklists.
- Upload required pictures or videos.
- Enter required notes or quantities.
- Report a problem without falsely completing a step.
- Complete Weekly Setup trailer checks.

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
- Custom steps

Defaults:

- Caulking is selected by default.
- Baseboard is not selected by default.

The owner can add a custom step and determine:

- Step name
- Stage
- Position in the workflow
- Instructions
- Optional reference picture
- Optional checklist
- Required proof type: none, picture, video, or written entry
- Final confirmation text

## Job claiming

- Available jobs can be claimed by an employee.
- Claiming records the employee and timestamp.
- A claimed job becomes that employee’s active job.
- The owner can release or override a claim.
- Employees cannot silently transfer a job to another employee.

## Job statuses

- Scheduled
- Available to Claim
- Claimed
- Initial Prep in Progress
- Waiting for Base-Coat Pour
- Base Coat Installed
- Top-Coat Prep in Progress
- Waiting for Top-Coat Pour
- Top Coat Installed
- Completion Work in Progress
- Complete
- Blocked / Problem Reported

Each job card should show:

- Client name
- Address
- Square footage
- Flake color
- Scheduled date
- Assigned employee
- Current status
- Current step
- Overall progress
- Last activity time

## General step behavior

Each workflow step can contain:

- Step title
- Goal
- Visual reference image
- Ordered instructions
- Final checklist
- Required proof
- Confirmation statement
- Completion timestamp
- Employee who completed it
- Employee notes
- Problem-report option

Rules:

- Required proof must finish uploading before a step can be completed.
- A step automatically records who completed it and when.
- Employees can view earlier completed steps.
- Employees cannot silently modify a completed step.
- The owner can reopen a completed step.
- Reopened steps retain their original history.
- Progress should autosave.
- The system should be designed for future offline saving and later synchronization, but offline functionality is not required in the first version.

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

Remove all dust and debris so the floor is completely clean for pouring.

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

“I confirm the entire floor has been thoroughly vacuumed and is clean for pouring.”

## Step 9: Set Up for Base-Coat Pour

### Goal

Organize the mixing station and application tools so the pour can begin immediately.

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
- Inside tools are positioned without blocking the pour path.
- Every drain is completely taped off and protected.

### Required proof

- One picture of the mixing station.
- One picture of the tools staged inside.
- One picture showing each protected drain.

### Confirmation

“I confirm the mixing station and application tools are ready, and every drain is taped off for the base-coat pour.”

# Owner Milestone: Base-Coat Pour

The Base-Coat Pour is currently the owner’s responsibility and must not contain employee pour instructions.

When Initial Prep is complete:

1. Change the status to “Waiting for Base-Coat Pour.”
2. Notify the owner.
3. Only the owner can mark “Base Coat Poured.”
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
4. Return it to the correct boxes, filling partially full boxes from the pour before starting an empty box.

### Final check

- Loose flake has been collected.
- Flake was returned to the correct boxes.
- Partially full boxes were filled first.
- No large piles remain.

### Required entry

- Full boxes recovered: numeric entry.
- Additional flake: select None, ¼ box, ½ box, or ¾ box.

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

Remove all loose flake and debris before the top-coat pour.

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

## Step 5: Set Up for Top-Coat Pour

### Goal

Organize the mixing station and application tools so the top-coat pour can begin immediately.

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
- Inside tools are positioned without blocking the pour path.

### Required proof

- One picture of the mixing station.
- One picture of the tools staged inside.

### Confirmation

“I confirm the mixing station and application tools are clean, organized, and ready for the top-coat pour.”

# Owner Milestone: Top-Coat Pour

The Top-Coat Pour is currently the owner’s responsibility and must not contain employee pour instructions.

When Top-Coat Prep is complete:

1. Change the status to “Waiting for Top-Coat Pour.”
2. Notify the owner.
3. Only the owner can mark “Top Coat Poured.”
4. Record the owner and timestamp.
5. Unlock Completion Work.

# Completion Work

Caulking and baseboard are future detailed modules.

For the first version:

- Show a simple “Caulking Complete” checkbox only when caulking was selected on the job.
- Show a simple “Baseboard Complete” checkbox only when baseboard was selected on the job.
- Do not add detailed instructions, sub-checklists, or proof requirements yet.
- Once all applicable completion items are checked, allow the job to be marked Complete.

# Weekly Setup

The navigation label is “Weekly Setup,” not “Monday Check.”

Weekly Setup contains one inventory checklist for each trailer.

Each submission records:

- Trailer
- Employee
- Date and time
- Checked items
- Missing items
- Damaged items
- Restock notes

The owner can review the current condition of both trailers.

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
