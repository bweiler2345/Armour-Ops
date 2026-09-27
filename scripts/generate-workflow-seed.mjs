// Writes the seed migration for the approved workflow from
// src/lib/workflow/approved-workflow.ts. Node 24 runs the TypeScript sources
// directly (type stripping), so no build step or extra package is needed.
//
// Usage: npm run workflow:seed

import { writeFileSync } from "node:fs";

const { APPROVED_WORKFLOW } = await import("../src/lib/workflow/approved-workflow.ts");
const { generateWorkflowSeedSql } = await import("../src/lib/workflow/seed-sql.ts");

export const SEED_MIGRATION = "supabase/migrations/20260927020100_seed_approved_workflow_v1.sql";

writeFileSync(SEED_MIGRATION, generateWorkflowSeedSql(APPROVED_WORKFLOW));
console.log(`Wrote ${SEED_MIGRATION}`);
