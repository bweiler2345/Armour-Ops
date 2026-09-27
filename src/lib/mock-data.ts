// Temporary sample data for the Weekly Setup screen until Phase 10. All
// values are fictional placeholders. Jobs come from the database, never from
// here.

export type Trailer = {
  id: string;
  name: string;
  unit: string;
  assignedCrew: string;
  lastChecked: string; // ISO date
};

export const trailers: Trailer[] = [
  {
    id: "TR-01",
    name: "Trailer 1",
    unit: "Unit 101 · 7x14 Enclosed",
    assignedCrew: "Crew A",
    lastChecked: "2026-09-21",
  },
  {
    id: "TR-02",
    name: "Trailer 2",
    unit: "Unit 102 · 7x16 Enclosed",
    assignedCrew: "Crew B",
    lastChecked: "2026-09-21",
  },
];
