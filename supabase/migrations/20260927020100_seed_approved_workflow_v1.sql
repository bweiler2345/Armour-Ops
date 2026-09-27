-- GENERATED FILE. Do not edit by hand.
-- Source: src/lib/workflow/approved-workflow.ts (transcribed from docs/PRODUCT_SPEC.md).
-- Regenerate with: npm run workflow:seed
--
-- Loads "Armour Floors Standard Workflow" version 1 and makes it the active
-- version. Safe to run more than once.
-- Content SHA-256: d4ab4099b7d36027630735fe3a5bc649644697e03ca6543e70dd36ed0ca18399

do $seed$
declare
  v_existing_hash text;
  v_template uuid;
  v_stage uuid;
  v_step uuid;
  v_block uuid;
begin
  select content_sha256 into v_existing_hash
  from public.workflow_templates
  where key = 'armour-floors-standard' and version = 1;

  if v_existing_hash = 'd4ab4099b7d36027630735fe3a5bc649644697e03ca6543e70dd36ed0ca18399' then
    raise notice 'Workflow armour-floors-standard version 1 is already loaded.';
    return;
  elsif v_existing_hash is not null then
    raise exception 'Workflow armour-floors-standard version 1 already exists with different content. Create a new version instead.';
  end if;

  insert into public.workflow_templates (key, name, version, source, content_sha256)
  values ('armour-floors-standard', 'Armour Floors Standard Workflow', 1, 'docs/PRODUCT_SPEC.md', 'd4ab4099b7d36027630735fe3a5bc649644697e03ca6543e70dd36ed0ca18399')
  returning id into v_template;

  -- Stage 1: Initial Prep
  insert into public.workflow_stage_templates
    (template_id, position, key, name, kind, description, rules_heading, rules, owner_action_label, waiting_status_label, completed_status_label)
  values (
    v_template, 1, 'initial_prep', 'Initial Prep', 'employee_stage',
    null,
    null,
    '{}'::text[],
    null, null, null
  )
  returning id into v_stage;

  -- Initial Prep, step 1: Grind Floor
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 1, 'grind_floor', 'Grind Floor', 'standard',
    null,
    'Grind every area the big grinder can properly hit.',
    'video', 'Upload one slow video showing the entire floor.',
    'I confirm every area the big grinder can hit has been properly ground.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Instructions', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Select the correct diamond bond for the concrete.', false),
    (v_block, 'ordered_list', 2, 'Connect the grinder to the vacuum and confirm good suction.', false),
    (v_block, 'ordered_list', 3, 'Grind using consistent, overlapping passes.', false),
    (v_block, 'ordered_list', 4, 'Areas the big grinder cannot hit, including low or uneven spots in the middle, will be completed during hand grinding.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'Every area the big grinder can hit has been ground.', true),
    (v_block, 'checklist', 2, 'No smooth or shiny areas remain in those areas.', true),
    (v_block, 'checklist', 3, 'No removable coating, glue, or contamination remains.', true);

  insert into public.workflow_step_proof_requirements (step_id, step_proof_type, position, label, media_type, min_count, allow_multiple) values
    (v_step, 'video', 1, 'Upload one slow video showing the entire floor.', 'video', 1, false);

  -- Initial Prep, step 2: Vacuum Floor
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 2, 'vacuum_floor', 'Vacuum Floor', 'standard',
    null,
    'Remove grinding dust so the floor can be inspected and patched.',
    'video', 'Upload one slow video showing the entire floor and clearly showing the key areas requiring patchwork.',
    'I confirm the floor has been vacuumed and all areas requiring patchwork are visible.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Instructions', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Vacuum the entire floor using the flat vacuum attachment.', false),
    (v_block, 'ordered_list', 2, 'Vacuum around cracks, pits, drains, posts, and other obstacles.', false),
    (v_block, 'ordered_list', 3, 'Make sure all damaged areas requiring patchwork are clearly visible.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'No piles or heavy areas of grinding dust remain.', true),
    (v_block, 'checklist', 2, 'Cracks, pits, and damaged areas are visible.', true),
    (v_block, 'checklist', 3, 'The floor is ready for patchwork.', true);

  insert into public.workflow_step_proof_requirements (step_id, step_proof_type, position, label, media_type, min_count, allow_multiple) values
    (v_step, 'video', 1, 'Upload one slow video showing the entire floor and clearly showing the key areas requiring patchwork.', 'video', 1, false);

  -- Initial Prep, step 3: Patchwork
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 3, 'patchwork', 'Patchwork', 'standard',
    null,
    'Completely fill all damaged areas and prepare them to be ground flush.',
    'picture', 'Upload clear pictures showing the completed patchwork.',
    'I confirm all damaged areas, including broken areas around the joints, have been properly patched.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Instructions', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Use the proper tool to remove loose debris from every patching area.', false),
    (v_block, 'ordered_list', 2, 'Vacuum each repair area thoroughly.', false),
    (v_block, 'ordered_list', 3, 'Mix TEC 305.', false),
    (v_block, 'ordered_list', 4, 'Completely fill each repair and slightly overfill it for grinding.', false),
    (v_block, 'ordered_list', 5, 'Inspect all joints and repeat the process on any broken areas around them.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'All loose debris was removed before patching.', true),
    (v_block, 'checklist', 2, 'Every damaged area was completely filled and slightly overfilled.', true),
    (v_block, 'checklist', 3, 'Broken areas around the joints were inspected and patched.', true);

  insert into public.workflow_step_proof_requirements (step_id, step_proof_type, position, label, media_type, min_count, allow_multiple) values
    (v_step, 'picture', 1, 'Upload clear pictures showing the completed patchwork.', 'picture', 1, true);

  -- Initial Prep, step 4: Cut Garage-Door Lines
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 4, 'cut_garage_door_lines', 'Cut Garage-Door Lines', 'standard',
    null,
    'Create a clean termination cut that conforms to the garage-door line.',
    'picture', 'Upload one clear picture of each completed garage-door line.',
    'I confirm each termination cut properly conforms to the garage-door line.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Instructions', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Mark the termination line to follow the garage-door line across the entire opening.', false),
    (v_block, 'ordered_list', 2, 'Use the angle grinder to make a clean, consistent cut along the marked line.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'The cut conforms to the garage-door line.', true),
    (v_block, 'checklist', 2, 'The cut is clean and consistent across the opening.', true);

  insert into public.workflow_step_proof_requirements (step_id, step_proof_type, position, label, media_type, min_count, allow_multiple) values
    (v_step, 'picture', 1, 'Upload one clear picture of each completed garage-door line.', 'picture', 1, true);

  -- Initial Prep, step 5: Hand-Grind Edges, Patches, and Missed Areas
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 5, 'hand_grind', 'Hand-Grind Edges, Patches, and Missed Areas', 'standard',
    null,
    'Finish every area the big grinder could not properly reach and grind all patchwork flush.',
    'video', 'Upload one slow video showing the perimeter, patched areas, and corrected areas.',
    'I confirm all edges, patches, and areas missed by the big grinder have been properly hand-ground.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Instructions', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Connect the hand grinder to the vacuum and confirm good suction.', false),
    (v_block, 'ordered_list', 2, 'Grind the entire perimeter. Open the dust shroud at garage-door lines, doorways, and drains to grind completely up to them.', false),
    (v_block, 'ordered_list', 3, 'Grind around posts and other obstacles.', false),
    (v_block, 'ordered_list', 4, 'Grind all patchwork smooth and flush with the surrounding concrete.', false),
    (v_block, 'ordered_list', 5, 'Grind any low or uneven areas in the middle that the big grinder missed.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'The entire perimeter has been ground.', true),
    (v_block, 'checklist', 2, 'Grinding reaches completely up to garage-door lines, doorways, and drains.', true),
    (v_block, 'checklist', 3, 'Areas around obstacles have been ground.', true),
    (v_block, 'checklist', 4, 'All patchwork is smooth and flush.', true),
    (v_block, 'checklist', 5, 'Low or uneven areas missed by the big grinder have been ground.', true),
    (v_block, 'checklist', 6, 'No smooth or shiny concrete remains.', true);

  insert into public.workflow_step_proof_requirements (step_id, step_proof_type, position, label, media_type, min_count, allow_multiple) values
    (v_step, 'video', 1, 'Upload one slow video showing the perimeter, patched areas, and corrected areas.', 'video', 1, false);

  -- Initial Prep, step 6: Clean Joints
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 6, 'clean_joints', 'Clean Joints', 'standard',
    null,
    'Loosen and remove material from every joint so it can be fully vacuumed later.',
    'picture', 'Upload clear pictures showing the cleaned joints.',
    'I confirm every joint has been completely cleaned and inspected.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Instructions', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Use the appropriate tool to remove dirt, loose concrete, old material, and debris from each joint.', false),
    (v_block, 'ordered_list', 2, 'Clean the full length of every joint, including intersections and ends.', false),
    (v_block, 'ordered_list', 3, 'Inspect the joints for broken areas that still need patching.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'Every joint has been cleaned from end to end.', true),
    (v_block, 'checklist', 2, 'No stuck or compacted material remains inside the joints.', true),
    (v_block, 'checklist', 3, 'Intersections and ends have been cleaned.', true),
    (v_block, 'checklist', 4, 'Any remaining joint damage has been reported.', true);

  insert into public.workflow_step_proof_requirements (step_id, step_proof_type, position, label, media_type, min_count, allow_multiple) values
    (v_step, 'picture', 1, 'Upload clear pictures showing the cleaned joints.', 'picture', 1, true);

  -- Initial Prep, step 7: Clean Edges and Corners
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 7, 'clean_edges_and_corners', 'Clean Edges and Corners', 'standard',
    null,
    'Clear remaining debris and buildup from areas the hand grinder could not reach.',
    'none', 'None.',
    'I confirm all edges and corners have been cleaned and are ready for the final vacuum.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Instructions', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Inspect the entire perimeter after hand grinding.', false),
    (v_block, 'ordered_list', 2, 'Use a 5-in-1 tool or scraper to clean tight edges and corners.', false),
    (v_block, 'ordered_list', 3, 'Remove any remaining caulk, coating, patch material, plastic, or other buildup along the edges.', false),
    (v_block, 'ordered_list', 4, 'Pull loosened debris onto the open floor for the final vacuum.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'Every edge and corner has been inspected.', true),
    (v_block, 'checklist', 2, 'No plastic or other buildup remains along the edges.', true),
    (v_block, 'checklist', 3, 'Debris has been pulled out for vacuuming.', true);

  -- Initial Prep, step 8: Final Vacuum
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 8, 'final_vacuum', 'Final Vacuum', 'standard',
    null,
    'Remove all dust and debris so the floor is completely clean for installation.',
    'video', 'Upload one slow video showing the entire cleaned floor, including the perimeter and joints.',
    'I confirm the entire floor has been thoroughly vacuumed and is clean for installation.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Instructions', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Use the round attachment to vacuum all joints, edges, corners, drains, garage-door lines, and around obstacles.', false),
    (v_block, 'ordered_list', 2, 'Vacuum the entire open floor using the flat attachment.', false),
    (v_block, 'ordered_list', 3, 'Inspect the entire floor before putting the vacuum away.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'All joints have been completely vacuumed.', true),
    (v_block, 'checklist', 2, 'Edges, corners, drains, and garage-door lines are clean.', true),
    (v_block, 'checklist', 3, 'The open floor is free of dust and debris.', true),
    (v_block, 'checklist', 4, 'No concrete chips or loose material remain.', true);

  insert into public.workflow_step_proof_requirements (step_id, step_proof_type, position, label, media_type, min_count, allow_multiple) values
    (v_step, 'video', 1, 'Upload one slow video showing the entire cleaned floor, including the perimeter and joints.', 'video', 1, false);

  -- Initial Prep, step 9: Set Up for Base-Coat Installation
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 9, 'set_up_for_base_coat_installation', 'Set Up for Base-Coat Installation', 'standard',
    'The mixing-station checklist and inside-work-area checklist in this step are visual reference lists. Employees do not check each item. “Second weenie roller when needed” is reference text. The final action is an instruction. Employees complete only the Final check, the required proof, and the confirmation for the overall setup step.',
    'Organize the mixing station and application tools so the installation can begin immediately.',
    'picture', null,
    'I confirm the mixing station and application tools are ready, and every drain is taped off for the base-coat installation.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Choose the setup location', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Set up near the garage door closest to the trailer whenever conditions allow.', false),
    (v_block, 'ordered_list', 2, 'If wind could blow leaves, dust, or other debris onto the floor, set up near the regular side door.', false),
    (v_block, 'ordered_list', 3, 'If it is raining or snowing, move the necessary setup items inside. Keep filled flake buckets inside the trailer so they remain dry.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Mixing-station checklist', 'reference_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'reference_list', 1, 'Plywood or cardboard floor mat', false),
    (v_block, 'reference_list', 2, 'Required epoxy', false),
    (v_block, 'reference_list', 3, 'Flake buckets filled and ready', false),
    (v_block, 'reference_list', 4, 'Drill with base-coat mixing attachment', false),
    (v_block, 'reference_list', 5, 'Acetone and rags', false),
    (v_block, 'reference_list', 6, 'Gloves', false),
    (v_block, 'reference_list', 7, 'Garbage box', false),
    (v_block, 'reference_list', 8, 'Dustpan', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 3, 'Inside-work-area checklist', 'reference_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'reference_list', 1, 'Two pairs of clean spike boots', false),
    (v_block, 'reference_list', 2, 'Clean notched squeegee', false),
    (v_block, 'reference_list', 3, 'Clean 18-inch roller with a clean nap', false),
    (v_block, 'reference_list', 4, 'Clean weenie roller with a clean nap', false),
    (v_block, 'reference_list', 5, 'Second weenie roller when needed', false),
    (v_block, 'reference_list', 6, 'Brushes placed near the areas where they will be used', false),
    (v_block, 'reference_list', 7, 'Scraper on a stick', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 4, 'Final action', 'reference_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'reference_list', 1, 'Tape off and protect every drain.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 5, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'Setup location protects the floor from weather and airborne debris.', true),
    (v_block, 'checklist', 2, 'Mixing station is completely organized.', true),
    (v_block, 'checklist', 3, 'All application tools and roller naps are clean.', true),
    (v_block, 'checklist', 4, 'Inside tools are positioned without blocking the installation path.', true),
    (v_block, 'checklist', 5, 'Every drain is completely taped off and protected.', true);

  insert into public.workflow_step_proof_requirements (step_id, step_proof_type, position, label, media_type, min_count, allow_multiple) values
    (v_step, 'picture', 1, 'One picture of the mixing station.', 'picture', 1, false),
    (v_step, 'picture', 2, 'One picture of the tools staged inside.', 'picture', 1, false),
    (v_step, 'picture', 3, 'One picture showing each protected drain.', 'picture', 1, true);

  -- Stage 2: Base-Coat Installation
  insert into public.workflow_stage_templates
    (template_id, position, key, name, kind, description, rules_heading, rules, owner_action_label, waiting_status_label, completed_status_label)
  values (
    v_template, 2, 'base_coat_installation', 'Base-Coat Installation', 'owner_milestone',
    'The Base-Coat Installation is currently the owner’s responsibility and must not contain employee installation instructions.',
    'When Initial Prep is complete:',
    array['Change the status to “Waiting for Base-Coat Installation.”', 'Notify the owner.', 'Only the owner can select “Mark Base Coat Installed.”', 'Record the owner and timestamp.', 'Unlock Top-Coat Prep.']::text[],
    'Mark Base Coat Installed', 'Waiting for Base-Coat Installation', 'Base Coat Installed'
  )
  returning id into v_stage;

  -- Stage 3: Top-Coat Prep
  insert into public.workflow_stage_templates
    (template_id, position, key, name, kind, description, rules_heading, rules, owner_action_label, waiting_status_label, completed_status_label)
  values (
    v_template, 3, 'top_coat_prep', 'Top-Coat Prep', 'employee_stage',
    null,
    null,
    '{}'::text[],
    null, null, null
  )
  returning id into v_stage;

  -- Top-Coat Prep, step 1: Collect Excess Flake
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 1, 'collect_excess_flake', 'Collect Excess Flake', 'standard',
    null,
    'Collect the loose flake and return it to the correct boxes.',
    'none', 'No picture or video.',
    'I confirm the loose flake has been collected, stored correctly, and the recovered amount has been recorded.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Instructions', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Walk the floor in clean footwear.', false),
    (v_block, 'ordered_list', 2, 'Use the leaf blower to move loose flake into manageable piles.', false),
    (v_block, 'ordered_list', 3, 'Collect the flake with the dustpan.', false),
    (v_block, 'ordered_list', 4, 'Return the flake to the correct boxes, filling any partially full boxes left from the flake broadcast before starting an empty box.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'Loose flake has been collected.', true),
    (v_block, 'checklist', 2, 'Flake was returned to the correct boxes.', true),
    (v_block, 'checklist', 3, 'Partially full boxes were filled first.', true),
    (v_block, 'checklist', 4, 'No large piles remain.', true);

  insert into public.workflow_step_inputs (step_id, step_kind, position, key, label, input_type, required, unit, choices, whole_number, minimum) values
    (v_step, 'standard', 1, 'full_boxes_recovered', 'Full boxes recovered', 'number', true, null, null, true, 0),
    (v_step, 'standard', 2, 'additional_flake', 'Additional flake', 'single_select', true, null, array['None', '¼ box', '½ box', '¾ box']::text[], false, null);

  -- Top-Coat Prep, step 2: Scrape Floor
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 2, 'scrape_floor', 'Scrape Floor', 'standard',
    null,
    'Remove standing and loosely bonded flake before applying the top coat.',
    'none', 'None.',
    'I confirm the entire floor has been thoroughly scraped in both directions.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Instructions', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Scrape the entire floor in one direction using the scraper on a stick.', false),
    (v_block, 'ordered_list', 2, 'Scrape the entire floor again in the opposite direction.', false),
    (v_block, 'ordered_list', 3, 'Apply consistent pressure and overlap each pass.', false),
    (v_block, 'ordered_list', 4, 'Scrape carefully along edges, doorways, drains, and around obstacles.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'The entire floor has been scraped in both directions.', true),
    (v_block, 'checklist', 2, 'Edges, drains, doorways, and obstacles have been scraped.', true),
    (v_block, 'checklist', 3, 'No obvious high or standing flakes remain.', true);

  -- Top-Coat Prep, step 3: Clean Joints
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 3, 'clean_joints', 'Clean Joints', 'standard',
    null,
    'Remove flake and coating buildup from every joint before vacuuming.',
    'none', 'None.',
    'I confirm every joint has been completely cleaned and is ready for vacuuming.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Instructions', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Use a 5-in-1 tool to clean flake and coating buildup from each joint.', false),
    (v_block, 'ordered_list', 2, 'Clean the full length of every joint, including intersections and ends.', false),
    (v_block, 'ordered_list', 3, 'Pull all loosened material out of the joints and onto the floor.', false),
    (v_block, 'ordered_list', 4, 'Check that no areas of the joints were missed.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'Every joint has been cleaned from end to end.', true),
    (v_block, 'checklist', 2, 'Intersections and ends have been cleaned.', true),
    (v_block, 'checklist', 3, 'No stuck flake or coating buildup remains.', true),
    (v_block, 'checklist', 4, 'Loosened material has been pulled out for vacuuming.', true);

  -- Top-Coat Prep, step 4: Vacuum Floor
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 4, 'vacuum_floor', 'Vacuum Floor', 'standard',
    null,
    'Remove all loose flake and debris before the top-coat installation.',
    'video', 'Upload one slow video showing the entire clean floor, including the joints and perimeter.',
    'I confirm the entire floor has been thoroughly vacuumed and is ready for the next step.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Instructions', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Use the round attachment to vacuum all joints, edges, corners, drains, doorways, and around obstacles.', false),
    (v_block, 'ordered_list', 2, 'Vacuum the entire open floor using the flat attachment.', false),
    (v_block, 'ordered_list', 3, 'Inspect the floor and vacuum any remaining loose flake or debris.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'All joints have been completely vacuumed.', true),
    (v_block, 'checklist', 2, 'Edges, corners, drains, and doorways are clean.', true),
    (v_block, 'checklist', 3, 'No loose flake, dust, or debris remains on the floor.', true);

  insert into public.workflow_step_proof_requirements (step_id, step_proof_type, position, label, media_type, min_count, allow_multiple) values
    (v_step, 'video', 1, 'Upload one slow video showing the entire clean floor, including the joints and perimeter.', 'video', 1, false);

  -- Top-Coat Prep, step 5: Set Up for Top-Coat Installation
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'employee_stage', 5, 'set_up_for_top_coat_installation', 'Set Up for Top-Coat Installation', 'standard',
    'The mixing-station checklist and inside-work-area checklist in this step are visual reference lists. Employees do not check each item. “Second weenie roller when needed” is reference text. Employees complete only the Final check, the required proof, and the confirmation for the overall setup step.',
    'Organize the mixing station and application tools so the top-coat installation can begin immediately.',
    'picture', null,
    'I confirm the mixing station and application tools are clean, organized, and ready for the top-coat installation.',
    null
  )
  returning id into v_step;

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 1, 'Choose the setup location', 'ordered_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'ordered_list', 1, 'Set up near the garage door closest to the trailer whenever conditions allow.', false),
    (v_block, 'ordered_list', 2, 'If wind could blow leaves, dust, or other debris onto the floor, set up near the regular side door.', false),
    (v_block, 'ordered_list', 3, 'If it is raining or snowing, move the necessary setup items inside.', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 2, 'Mixing-station checklist', 'reference_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'reference_list', 1, 'Plywood or cardboard floor mat', false),
    (v_block, 'reference_list', 2, 'Required top coat', false),
    (v_block, 'reference_list', 3, 'Drill with top-coat mixing attachment', false),
    (v_block, 'reference_list', 4, 'Acetone and rags', false),
    (v_block, 'reference_list', 5, 'Gloves', false),
    (v_block, 'reference_list', 6, 'Garbage box', false),
    (v_block, 'reference_list', 7, 'Dustpan', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 3, 'Inside-work-area checklist', 'reference_list')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'reference_list', 1, 'Two pairs of clean spike boots', false),
    (v_block, 'reference_list', 2, 'Clean flat top-coat squeegee', false),
    (v_block, 'reference_list', 3, 'Clean 18-inch roller with a clean nap', false),
    (v_block, 'reference_list', 4, 'Clean weenie roller with a clean nap', false),
    (v_block, 'reference_list', 5, 'Second weenie roller when needed', false),
    (v_block, 'reference_list', 6, 'Brushes placed near the areas where they will be used', false),
    (v_block, 'reference_list', 7, 'Scraper on a stick', false);

  insert into public.workflow_step_blocks (step_id, step_kind, position, heading, kind)
  values (v_step, 'standard', 4, 'Final check', 'checklist')
  returning id into v_block;
  insert into public.workflow_step_block_items (block_id, block_kind, position, text, required) values
    (v_block, 'checklist', 1, 'Setup location protects the floor from weather and airborne debris.', true),
    (v_block, 'checklist', 2, 'Mixing station is completely organized.', true),
    (v_block, 'checklist', 3, 'All application tools and roller naps are clean.', true),
    (v_block, 'checklist', 4, 'Inside tools are positioned without blocking the installation path.', true);

  insert into public.workflow_step_proof_requirements (step_id, step_proof_type, position, label, media_type, min_count, allow_multiple) values
    (v_step, 'picture', 1, 'One picture of the mixing station.', 'picture', 1, false),
    (v_step, 'picture', 2, 'One picture of the tools staged inside.', 'picture', 1, false);

  -- Stage 4: Top-Coat Installation
  insert into public.workflow_stage_templates
    (template_id, position, key, name, kind, description, rules_heading, rules, owner_action_label, waiting_status_label, completed_status_label)
  values (
    v_template, 4, 'top_coat_installation', 'Top-Coat Installation', 'owner_milestone',
    'The Top-Coat Installation is currently the owner’s responsibility and must not contain employee installation instructions.',
    'When Top-Coat Prep is complete:',
    array['Change the status to “Waiting for Top-Coat Installation.”', 'Notify the owner.', 'Only the owner can select “Mark Top Coat Installed.”', 'Record the owner and timestamp.', 'Unlock Completion Work.']::text[],
    'Mark Top Coat Installed', 'Waiting for Top-Coat Installation', 'Top Coat Installed'
  )
  returning id into v_stage;

  -- Stage 5: Completion Work
  insert into public.workflow_stage_templates
    (template_id, position, key, name, kind, description, rules_heading, rules, owner_action_label, waiting_status_label, completed_status_label)
  values (
    v_template, 5, 'completion_work', 'Completion Work', 'completion_work',
    'Caulking and baseboard are future detailed modules.',
    'For the first version:',
    array['Show a simple “Caulking Complete” checkbox only when caulking was selected on the job.', 'Show a simple “Baseboard Complete” checkbox only when baseboard was selected on the job.', 'Do not add detailed instructions, sub-checklists, or proof requirements yet.', 'Once all applicable completion items are checked, allow the job to be marked Complete.', 'Any assigned employee can check “Caulking Complete” when applicable.', 'Any assigned employee can check “Baseboard Complete” when applicable.', 'Only the owner can select “Mark Job Complete.”', 'Before completing a job, the owner can review its completed steps, evidence, completion items, and activity history.']::text[],
    'Mark Job Complete', null, null
  )
  returning id into v_stage;

  -- Completion Work, step 1: Caulking Complete
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'completion_work', 1, 'caulking_complete', 'Caulking Complete', 'completion_item',
    null,
    null,
    'none', null,
    null,
    'caulking_required'
  )
  returning id into v_step;

  -- Completion Work, step 2: Baseboard Complete
  insert into public.workflow_step_templates
    (stage_id, stage_kind, position, key, title, kind, note, goal, proof_type, proof_text, confirmation_text, applies_when)
  values (
    v_stage, 'completion_work', 2, 'baseboard_complete', 'Baseboard Complete', 'completion_item',
    null,
    null,
    'none', null,
    null,
    'baseboard_required'
  )
  returning id into v_step;

  -- Validate and make this the active version.
  perform public.activate_workflow_template(v_template);
end
$seed$;
