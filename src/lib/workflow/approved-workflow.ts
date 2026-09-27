// The approved Armour Ops workflow, version 1, transcribed word for word from
// docs/PRODUCT_SPEC.md (the authority). Tests parse the spec and fail if any
// text here drifts from it. The database seed migration is generated from this
// file by `npm run workflow:seed`; never edit the generated SQL by hand.
//
// To change the workflow later: update PRODUCT_SPEC.md, copy the change here,
// bump `version`, and generate a new seed migration. Published versions are
// immutable in the database, so jobs keep the version they started with.
//
// This file has no imports so Node can run the seed generator directly.

export type StageKind = "employee_stage" | "owner_milestone" | "completion_work";
export type StepKind = "standard" | "completion_item";
// ordered_list: numbered instructions (read only).
// reference_list: visual list, never checked item by item.
// checklist: every item must be checked before the step can be completed.
export type BlockKind = "ordered_list" | "reference_list" | "checklist";
export type ProofType = "none" | "picture" | "video";
export type ProofMediaType = "picture" | "video";
export type InputType = "text" | "number" | "single_select";
export type JobOption = "caulking_required" | "baseboard_required";

export type WorkflowBlock = {
  heading: string;
  kind: BlockKind;
  items: readonly string[];
};

export type WorkflowInput = {
  key: string;
  label: string;
  type: InputType;
  required: boolean;
  unit: string | null;
  choices: readonly string[] | null;
  wholeNumber: boolean;
  minimum: number | null;
};

export type ProofRequirement = {
  label: string;
  mediaType: ProofMediaType;
  minCount: number;
  allowMultiple: boolean;
};

export type WorkflowStep = {
  key: string;
  title: string;
  kind: StepKind;
  note: string | null;
  goal: string | null;
  blocks: readonly WorkflowBlock[];
  inputs: readonly WorkflowInput[];
  proofType: ProofType;
  // The spec's "Required proof" text when it is a single sentence. Null when
  // the spec lists several proofs (each becomes a requirement label).
  proofText: string | null;
  proofRequirements: readonly ProofRequirement[];
  // Stored without the spec's surrounding quotation marks.
  confirmationText: string | null;
  appliesWhen: JobOption | null;
};

export type OwnerAction = {
  label: string;
  waitingStatusLabel: string | null;
  completedStatusLabel: string | null;
};

export type WorkflowStage = {
  key: string;
  name: string;
  kind: StageKind;
  description: string | null;
  rulesHeading: string | null;
  rules: readonly string[];
  ownerAction: OwnerAction | null;
  steps: readonly WorkflowStep[];
};

export type WorkflowTemplate = {
  key: string;
  name: string;
  version: number;
  source: string;
  stages: readonly WorkflowStage[];
};

// Shared shapes ---------------------------------------------------------------

const instructions = (...items: string[]): WorkflowBlock => ({
  heading: "Instructions",
  kind: "ordered_list",
  items,
});

const finalCheck = (...items: string[]): WorkflowBlock => ({
  heading: "Final check",
  kind: "checklist",
  items,
});

const oneVideo = (label: string): ProofRequirement => ({
  label,
  mediaType: "video",
  minCount: 1,
  allowMultiple: false,
});

const pictures = (label: string, allowMultiple: boolean): ProofRequirement => ({
  label,
  mediaType: "picture",
  minCount: 1,
  allowMultiple,
});

const standard = (
  step: Omit<WorkflowStep, "kind" | "inputs" | "appliesWhen" | "note"> &
    Partial<Pick<WorkflowStep, "inputs" | "note">>,
): WorkflowStep => ({
  kind: "standard",
  note: null,
  inputs: [],
  appliesWhen: null,
  ...step,
});

const completionItem = (key: string, title: string, appliesWhen: JobOption): WorkflowStep => ({
  key,
  title,
  kind: "completion_item",
  note: null,
  goal: null,
  blocks: [],
  inputs: [],
  proofType: "none",
  proofText: null,
  proofRequirements: [],
  confirmationText: null,
  appliesWhen,
});

// The approved workflow -------------------------------------------------------

export const APPROVED_WORKFLOW: WorkflowTemplate = {
  key: "armour-floors-standard",
  name: "Armour Floors Standard Workflow",
  version: 1,
  source: "docs/PRODUCT_SPEC.md",
  stages: [
    {
      key: "initial_prep",
      name: "Initial Prep",
      kind: "employee_stage",
      description: null,
      rulesHeading: null,
      rules: [],
      ownerAction: null,
      steps: [
        standard({
          key: "grind_floor",
          title: "Grind Floor",
          goal: "Grind every area the big grinder can properly hit.",
          blocks: [
            instructions(
              "Select the correct diamond bond for the concrete.",
              "Connect the grinder to the vacuum and confirm good suction.",
              "Grind using consistent, overlapping passes.",
              "Areas the big grinder cannot hit, including low or uneven spots in the middle, will be completed during hand grinding.",
            ),
            finalCheck(
              "Every area the big grinder can hit has been ground.",
              "No smooth or shiny areas remain in those areas.",
              "No removable coating, glue, or contamination remains.",
            ),
          ],
          proofType: "video",
          proofText: "Upload one slow video showing the entire floor.",
          proofRequirements: [oneVideo("Upload one slow video showing the entire floor.")],
          confirmationText:
            "I confirm every area the big grinder can hit has been properly ground.",
        }),
        standard({
          key: "vacuum_floor",
          title: "Vacuum Floor",
          goal: "Remove grinding dust so the floor can be inspected and patched.",
          blocks: [
            instructions(
              "Vacuum the entire floor using the flat vacuum attachment.",
              "Vacuum around cracks, pits, drains, posts, and other obstacles.",
              "Make sure all damaged areas requiring patchwork are clearly visible.",
            ),
            finalCheck(
              "No piles or heavy areas of grinding dust remain.",
              "Cracks, pits, and damaged areas are visible.",
              "The floor is ready for patchwork.",
            ),
          ],
          proofType: "video",
          proofText:
            "Upload one slow video showing the entire floor and clearly showing the key areas requiring patchwork.",
          proofRequirements: [
            oneVideo(
              "Upload one slow video showing the entire floor and clearly showing the key areas requiring patchwork.",
            ),
          ],
          confirmationText:
            "I confirm the floor has been vacuumed and all areas requiring patchwork are visible.",
        }),
        standard({
          key: "patchwork",
          title: "Patchwork",
          goal: "Completely fill all damaged areas and prepare them to be ground flush.",
          blocks: [
            instructions(
              "Use the proper tool to remove loose debris from every patching area.",
              "Vacuum each repair area thoroughly.",
              "Mix TEC 305.",
              "Completely fill each repair and slightly overfill it for grinding.",
              "Inspect all joints and repeat the process on any broken areas around them.",
            ),
            finalCheck(
              "All loose debris was removed before patching.",
              "Every damaged area was completely filled and slightly overfilled.",
              "Broken areas around the joints were inspected and patched.",
            ),
          ],
          proofType: "picture",
          proofText: "Upload clear pictures showing the completed patchwork.",
          proofRequirements: [
            pictures("Upload clear pictures showing the completed patchwork.", true),
          ],
          confirmationText:
            "I confirm all damaged areas, including broken areas around the joints, have been properly patched.",
        }),
        standard({
          key: "cut_garage_door_lines",
          title: "Cut Garage-Door Lines",
          goal: "Create a clean termination cut that conforms to the garage-door line.",
          blocks: [
            instructions(
              "Mark the termination line to follow the garage-door line across the entire opening.",
              "Use the angle grinder to make a clean, consistent cut along the marked line.",
            ),
            finalCheck(
              "The cut conforms to the garage-door line.",
              "The cut is clean and consistent across the opening.",
            ),
          ],
          proofType: "picture",
          proofText: "Upload one clear picture of each completed garage-door line.",
          proofRequirements: [
            pictures("Upload one clear picture of each completed garage-door line.", true),
          ],
          confirmationText:
            "I confirm each termination cut properly conforms to the garage-door line.",
        }),
        standard({
          key: "hand_grind",
          title: "Hand-Grind Edges, Patches, and Missed Areas",
          goal: "Finish every area the big grinder could not properly reach and grind all patchwork flush.",
          blocks: [
            instructions(
              "Connect the hand grinder to the vacuum and confirm good suction.",
              "Grind the entire perimeter. Open the dust shroud at garage-door lines, doorways, and drains to grind completely up to them.",
              "Grind around posts and other obstacles.",
              "Grind all patchwork smooth and flush with the surrounding concrete.",
              "Grind any low or uneven areas in the middle that the big grinder missed.",
            ),
            finalCheck(
              "The entire perimeter has been ground.",
              "Grinding reaches completely up to garage-door lines, doorways, and drains.",
              "Areas around obstacles have been ground.",
              "All patchwork is smooth and flush.",
              "Low or uneven areas missed by the big grinder have been ground.",
              "No smooth or shiny concrete remains.",
            ),
          ],
          proofType: "video",
          proofText:
            "Upload one slow video showing the perimeter, patched areas, and corrected areas.",
          proofRequirements: [
            oneVideo(
              "Upload one slow video showing the perimeter, patched areas, and corrected areas.",
            ),
          ],
          confirmationText:
            "I confirm all edges, patches, and areas missed by the big grinder have been properly hand-ground.",
        }),
        standard({
          key: "clean_joints",
          title: "Clean Joints",
          goal: "Loosen and remove material from every joint so it can be fully vacuumed later.",
          blocks: [
            instructions(
              "Use the appropriate tool to remove dirt, loose concrete, old material, and debris from each joint.",
              "Clean the full length of every joint, including intersections and ends.",
              "Inspect the joints for broken areas that still need patching.",
            ),
            finalCheck(
              "Every joint has been cleaned from end to end.",
              "No stuck or compacted material remains inside the joints.",
              "Intersections and ends have been cleaned.",
              "Any remaining joint damage has been reported.",
            ),
          ],
          proofType: "picture",
          proofText: "Upload clear pictures showing the cleaned joints.",
          proofRequirements: [pictures("Upload clear pictures showing the cleaned joints.", true)],
          confirmationText: "I confirm every joint has been completely cleaned and inspected.",
        }),
        standard({
          key: "clean_edges_and_corners",
          title: "Clean Edges and Corners",
          goal: "Clear remaining debris and buildup from areas the hand grinder could not reach.",
          blocks: [
            instructions(
              "Inspect the entire perimeter after hand grinding.",
              "Use a 5-in-1 tool or scraper to clean tight edges and corners.",
              "Remove any remaining caulk, coating, patch material, plastic, or other buildup along the edges.",
              "Pull loosened debris onto the open floor for the final vacuum.",
            ),
            finalCheck(
              "Every edge and corner has been inspected.",
              "No plastic or other buildup remains along the edges.",
              "Debris has been pulled out for vacuuming.",
            ),
          ],
          proofType: "none",
          proofText: "None.",
          proofRequirements: [],
          confirmationText:
            "I confirm all edges and corners have been cleaned and are ready for the final vacuum.",
        }),
        standard({
          key: "final_vacuum",
          title: "Final Vacuum",
          goal: "Remove all dust and debris so the floor is completely clean for installation.",
          blocks: [
            instructions(
              "Use the round attachment to vacuum all joints, edges, corners, drains, garage-door lines, and around obstacles.",
              "Vacuum the entire open floor using the flat attachment.",
              "Inspect the entire floor before putting the vacuum away.",
            ),
            finalCheck(
              "All joints have been completely vacuumed.",
              "Edges, corners, drains, and garage-door lines are clean.",
              "The open floor is free of dust and debris.",
              "No concrete chips or loose material remain.",
            ),
          ],
          proofType: "video",
          proofText:
            "Upload one slow video showing the entire cleaned floor, including the perimeter and joints.",
          proofRequirements: [
            oneVideo(
              "Upload one slow video showing the entire cleaned floor, including the perimeter and joints.",
            ),
          ],
          confirmationText:
            "I confirm the entire floor has been thoroughly vacuumed and is clean for installation.",
        }),
        standard({
          key: "set_up_for_base_coat_installation",
          title: "Set Up for Base-Coat Installation",
          note: "The mixing-station checklist and inside-work-area checklist in this step are visual reference lists. Employees do not check each item. “Second weenie roller when needed” is reference text. The final action is an instruction. Employees complete only the Final check, the required proof, and the confirmation for the overall setup step.",
          goal: "Organize the mixing station and application tools so the installation can begin immediately.",
          blocks: [
            {
              heading: "Choose the setup location",
              kind: "ordered_list",
              items: [
                "Set up near the garage door closest to the trailer whenever conditions allow.",
                "If wind could blow leaves, dust, or other debris onto the floor, set up near the regular side door.",
                "If it is raining or snowing, move the necessary setup items inside. Keep filled flake buckets inside the trailer so they remain dry.",
              ],
            },
            {
              heading: "Mixing-station checklist",
              kind: "reference_list",
              items: [
                "Plywood or cardboard floor mat",
                "Required epoxy",
                "Flake buckets filled and ready",
                "Drill with base-coat mixing attachment",
                "Acetone and rags",
                "Gloves",
                "Garbage box",
                "Dustpan",
              ],
            },
            {
              heading: "Inside-work-area checklist",
              kind: "reference_list",
              items: [
                "Two pairs of clean spike boots",
                "Clean notched squeegee",
                "Clean 18-inch roller with a clean nap",
                "Clean weenie roller with a clean nap",
                "Second weenie roller when needed",
                "Brushes placed near the areas where they will be used",
                "Scraper on a stick",
              ],
            },
            {
              heading: "Final action",
              kind: "reference_list",
              items: ["Tape off and protect every drain."],
            },
            finalCheck(
              "Setup location protects the floor from weather and airborne debris.",
              "Mixing station is completely organized.",
              "All application tools and roller naps are clean.",
              "Inside tools are positioned without blocking the installation path.",
              "Every drain is completely taped off and protected.",
            ),
          ],
          proofType: "picture",
          proofText: null,
          proofRequirements: [
            pictures("One picture of the mixing station.", false),
            pictures("One picture of the tools staged inside.", false),
            pictures("One picture showing each protected drain.", true),
          ],
          confirmationText:
            "I confirm the mixing station and application tools are ready, and every drain is taped off for the base-coat installation.",
        }),
      ],
    },
    {
      key: "base_coat_installation",
      name: "Base-Coat Installation",
      kind: "owner_milestone",
      description:
        "The Base-Coat Installation is currently the owner’s responsibility and must not contain employee installation instructions.",
      rulesHeading: "When Initial Prep is complete:",
      rules: [
        "Change the status to “Waiting for Base-Coat Installation.”",
        "Notify the owner.",
        "Only the owner can select “Mark Base Coat Installed.”",
        "Record the owner and timestamp.",
        "Unlock Top-Coat Prep.",
      ],
      ownerAction: {
        label: "Mark Base Coat Installed",
        waitingStatusLabel: "Waiting for Base-Coat Installation",
        completedStatusLabel: "Base Coat Installed",
      },
      steps: [],
    },
    {
      key: "top_coat_prep",
      name: "Top-Coat Prep",
      kind: "employee_stage",
      description: null,
      rulesHeading: null,
      rules: [],
      ownerAction: null,
      steps: [
        standard({
          key: "collect_excess_flake",
          title: "Collect Excess Flake",
          goal: "Collect the loose flake and return it to the correct boxes.",
          blocks: [
            instructions(
              "Walk the floor in clean footwear.",
              "Use the leaf blower to move loose flake into manageable piles.",
              "Collect the flake with the dustpan.",
              "Return the flake to the correct boxes, filling any partially full boxes left from the flake broadcast before starting an empty box.",
            ),
            finalCheck(
              "Loose flake has been collected.",
              "Flake was returned to the correct boxes.",
              "Partially full boxes were filled first.",
              "No large piles remain.",
            ),
          ],
          inputs: [
            {
              key: "full_boxes_recovered",
              label: "Full boxes recovered",
              type: "number",
              required: true,
              unit: null,
              choices: null,
              wholeNumber: true,
              minimum: 0,
            },
            {
              key: "additional_flake",
              label: "Additional flake",
              type: "single_select",
              required: true,
              unit: null,
              choices: ["None", "¼ box", "½ box", "¾ box"],
              wholeNumber: false,
              minimum: null,
            },
          ],
          proofType: "none",
          proofText: "No picture or video.",
          proofRequirements: [],
          confirmationText:
            "I confirm the loose flake has been collected, stored correctly, and the recovered amount has been recorded.",
        }),
        standard({
          key: "scrape_floor",
          title: "Scrape Floor",
          goal: "Remove standing and loosely bonded flake before applying the top coat.",
          blocks: [
            instructions(
              "Scrape the entire floor in one direction using the scraper on a stick.",
              "Scrape the entire floor again in the opposite direction.",
              "Apply consistent pressure and overlap each pass.",
              "Scrape carefully along edges, doorways, drains, and around obstacles.",
            ),
            finalCheck(
              "The entire floor has been scraped in both directions.",
              "Edges, drains, doorways, and obstacles have been scraped.",
              "No obvious high or standing flakes remain.",
            ),
          ],
          proofType: "none",
          proofText: "None.",
          proofRequirements: [],
          confirmationText: "I confirm the entire floor has been thoroughly scraped in both directions.",
        }),
        standard({
          key: "clean_joints",
          title: "Clean Joints",
          goal: "Remove flake and coating buildup from every joint before vacuuming.",
          blocks: [
            instructions(
              "Use a 5-in-1 tool to clean flake and coating buildup from each joint.",
              "Clean the full length of every joint, including intersections and ends.",
              "Pull all loosened material out of the joints and onto the floor.",
              "Check that no areas of the joints were missed.",
            ),
            finalCheck(
              "Every joint has been cleaned from end to end.",
              "Intersections and ends have been cleaned.",
              "No stuck flake or coating buildup remains.",
              "Loosened material has been pulled out for vacuuming.",
            ),
          ],
          proofType: "none",
          proofText: "None.",
          proofRequirements: [],
          confirmationText:
            "I confirm every joint has been completely cleaned and is ready for vacuuming.",
        }),
        standard({
          key: "vacuum_floor",
          title: "Vacuum Floor",
          goal: "Remove all loose flake and debris before the top-coat installation.",
          blocks: [
            instructions(
              "Use the round attachment to vacuum all joints, edges, corners, drains, doorways, and around obstacles.",
              "Vacuum the entire open floor using the flat attachment.",
              "Inspect the floor and vacuum any remaining loose flake or debris.",
            ),
            finalCheck(
              "All joints have been completely vacuumed.",
              "Edges, corners, drains, and doorways are clean.",
              "No loose flake, dust, or debris remains on the floor.",
            ),
          ],
          proofType: "video",
          proofText:
            "Upload one slow video showing the entire clean floor, including the joints and perimeter.",
          proofRequirements: [
            oneVideo(
              "Upload one slow video showing the entire clean floor, including the joints and perimeter.",
            ),
          ],
          confirmationText:
            "I confirm the entire floor has been thoroughly vacuumed and is ready for the next step.",
        }),
        standard({
          key: "set_up_for_top_coat_installation",
          title: "Set Up for Top-Coat Installation",
          note: "The mixing-station checklist and inside-work-area checklist in this step are visual reference lists. Employees do not check each item. “Second weenie roller when needed” is reference text. Employees complete only the Final check, the required proof, and the confirmation for the overall setup step.",
          goal: "Organize the mixing station and application tools so the top-coat installation can begin immediately.",
          blocks: [
            {
              heading: "Choose the setup location",
              kind: "ordered_list",
              items: [
                "Set up near the garage door closest to the trailer whenever conditions allow.",
                "If wind could blow leaves, dust, or other debris onto the floor, set up near the regular side door.",
                "If it is raining or snowing, move the necessary setup items inside.",
              ],
            },
            {
              heading: "Mixing-station checklist",
              kind: "reference_list",
              items: [
                "Plywood or cardboard floor mat",
                "Required top coat",
                "Drill with top-coat mixing attachment",
                "Acetone and rags",
                "Gloves",
                "Garbage box",
                "Dustpan",
              ],
            },
            {
              heading: "Inside-work-area checklist",
              kind: "reference_list",
              items: [
                "Two pairs of clean spike boots",
                "Clean flat top-coat squeegee",
                "Clean 18-inch roller with a clean nap",
                "Clean weenie roller with a clean nap",
                "Second weenie roller when needed",
                "Brushes placed near the areas where they will be used",
                "Scraper on a stick",
              ],
            },
            finalCheck(
              "Setup location protects the floor from weather and airborne debris.",
              "Mixing station is completely organized.",
              "All application tools and roller naps are clean.",
              "Inside tools are positioned without blocking the installation path.",
            ),
          ],
          proofType: "picture",
          proofText: null,
          proofRequirements: [
            pictures("One picture of the mixing station.", false),
            pictures("One picture of the tools staged inside.", false),
          ],
          confirmationText:
            "I confirm the mixing station and application tools are clean, organized, and ready for the top-coat installation.",
        }),
      ],
    },
    {
      key: "top_coat_installation",
      name: "Top-Coat Installation",
      kind: "owner_milestone",
      description:
        "The Top-Coat Installation is currently the owner’s responsibility and must not contain employee installation instructions.",
      rulesHeading: "When Top-Coat Prep is complete:",
      rules: [
        "Change the status to “Waiting for Top-Coat Installation.”",
        "Notify the owner.",
        "Only the owner can select “Mark Top Coat Installed.”",
        "Record the owner and timestamp.",
        "Unlock Completion Work.",
      ],
      ownerAction: {
        label: "Mark Top Coat Installed",
        waitingStatusLabel: "Waiting for Top-Coat Installation",
        completedStatusLabel: "Top Coat Installed",
      },
      steps: [],
    },
    {
      key: "completion_work",
      name: "Completion Work",
      kind: "completion_work",
      description: "Caulking and baseboard are future detailed modules.",
      rulesHeading: "For the first version:",
      rules: [
        "Show a simple “Caulking Complete” checkbox only when caulking was selected on the job.",
        "Show a simple “Baseboard Complete” checkbox only when baseboard was selected on the job.",
        "Do not add detailed instructions, sub-checklists, or proof requirements yet.",
        "Once all applicable completion items are checked, allow the job to be marked Complete.",
        "Any assigned employee can check “Caulking Complete” when applicable.",
        "Any assigned employee can check “Baseboard Complete” when applicable.",
        "Only the owner can select “Mark Job Complete.”",
        "Before completing a job, the owner can review its completed steps, evidence, completion items, and activity history.",
      ],
      ownerAction: {
        label: "Mark Job Complete",
        waitingStatusLabel: null,
        completedStatusLabel: null,
      },
      steps: [
        completionItem("caulking_complete", "Caulking Complete", "caulking_required"),
        completionItem("baseboard_complete", "Baseboard Complete", "baseboard_required"),
      ],
    },
  ],
};
