// The approved Pre-Week Setup inventory list (docs/PRODUCT_SPEC.md,
// "Required inventory for each trailer"), as seeded by
// supabase/migrations/20260927120000_pre_week_setup.sql. Tests check both
// against the spec word for word. `spec` is the line as written there.

export type ApprovedItem = {
  spec: string;
  category: string;
  label: string;
  target: number | null;
  unit: string | null;
};

const item = (spec: string, category: string, label: string, target: number | null = 1, unit: string | null = null): ApprovedItem => ({
  spec,
  category,
  label,
  target,
  unit,
});

const CORE = "Core equipment";
const PREP = "Prep tools";
const MIX = "Mixing and application";
const MATERIALS = "Materials and consumables";

export const APPROVED_INVENTORY: readonly ApprovedItem[] = [
  item("Grinder", CORE, "Grinder"),
  item("Vacuum", CORE, "Vacuum"),
  item("Flat vacuum attachment", CORE, "Flat vacuum attachment"),
  item("Round vacuum attachment", CORE, "Round vacuum attachment"),
  item("Generator", CORE, "Generator"),
  item("Two full fuel cans", CORE, "Full fuel cans", 2, "cans"),
  item("Two batteries", CORE, "Batteries", 2, "batteries"),
  item("Battery charger", CORE, "Battery charger"),
  item("Two extension cords", CORE, "Extension cords", 2, "cords"),
  item("Angle grinder", PREP, "Angle grinder"),
  item("Hand grinder", PREP, "Hand grinder"),
  item("Palm sander", PREP, "Palm sander"),
  item("Leaf blower", PREP, "Leaf blower"),
  item("Broom", PREP, "Broom"),
  item("Dustpan", PREP, "Dustpan"),
  item("Two scrapers", PREP, "Scrapers", 2, "scrapers"),
  item("Three 5-in-1 tools", PREP, "5-in-1 tools", 3, "tools"),
  item("Two trowels", PREP, "Trowels", 2, "trowels"),
  item("Screwdriver", PREP, "Screwdriver"),
  item("Hammer", PREP, "Hammer"),
  item("Two utility knives", PREP, "Utility knives", 2, "knives"),
  item("Extra-soft bit set", PREP, "Extra-soft bit set", 1, "set"),
  item("Medium bit set", PREP, "Medium bit set", 1, "set"),
  item("1 full plywood sheet", PREP, "Full plywood sheet", 1, "sheet"),
  item("1 quarter-board piece", PREP, "Quarter-board piece", 1, "piece"),
  item("Drill", MIX, "Drill"),
  item("Base-coat mixer", MIX, "Base-coat mixer"),
  item("Top-coat mixer", MIX, "Top-coat mixer"),
  item("Patch mixer", MIX, "Patch mixer"),
  item("Small mixer", MIX, "Small mixer"),
  item("Two clear 5-gallon measuring pails", MIX, "Clear 5-gallon measuring pails", 2, "pails"),
  item("Ten flake buckets", MIX, "Flake buckets", 10, "buckets"),
  item("Notched squeegee", MIX, "Notched squeegee"),
  item("Top-coat squeegee", MIX, "Top-coat squeegee"),
  item("Two 18-inch rollers", MIX, "18-inch rollers", 2, "rollers"),
  item("Two weenie roller sticks", MIX, "Weenie roller sticks", 2, "sticks"),
  item("Three pairs of spikes", MIX, "Pairs of spikes", 3, "pairs"),
  item("Four bags TEC 305 patch", MATERIALS, "TEC 305 patch", 4, "bags"),
  item("Spray bottle", MATERIALS, "Spray bottle"),
  item("Thirty 3-inch brushes", MATERIALS, "3-inch brushes", 30, "brushes"),
  item("Ten weenie roller naps", MATERIALS, "Weenie roller naps", 10, "naps"),
  item("Eight 18-inch, 3/8-inch-nap roller covers", MATERIALS, "18-inch, 3/8-inch-nap roller covers", 8, "covers"),
  item("Two boxes of rubber gloves", MATERIALS, "Rubber gloves", 2, "boxes"),
  item("Two cans of acetone", MATERIALS, "Acetone", 2, "cans"),
  item("Rags stocked", MATERIALS, "Rags stocked", null, null),
  item("Two rolls of masking tape", MATERIALS, "Masking tape", 2, "rolls"),
  item("Two rolls of duct tape", MATERIALS, "Duct tape", 2, "rolls"),
  item("Ten pencils", MATERIALS, "Pencils", 10, "pencils"),
];
