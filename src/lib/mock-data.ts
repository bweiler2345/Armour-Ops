// Temporary sample data for the visual shell. All names and addresses are
// fictional placeholders and will be replaced once real data sources exist.

export type JobStatus = "In Progress" | "Scheduled" | "Open";

export type Job = {
  id: string;
  clientName: string;
  address: string;
  city: string;
  projectType: string;
  squareFeet: number;
  flakeColor: string;
  flakeSwatch: string[];
  scheduledDate: string; // ISO date, YYYY-MM-DD
  status: JobStatus;
  progress: number; // 0-100
};

export const activeJob: Job = {
  id: "AF-24117",
  clientName: "Daniel & Priya Whitaker",
  address: "1482 Ridgeview Drive",
  city: "Brookfield",
  projectType: "3-Car Garage",
  squareFeet: 720,
  flakeColor: "Gravel Blend",
  flakeSwatch: ["#8b8680", "#d8d4cc", "#3d3b39"],
  scheduledDate: "2026-09-28",
  status: "In Progress",
  progress: 40,
};

export const availableJobs: Job[] = [
  {
    id: "AF-24121",
    clientName: "Marcus Holloway",
    address: "207 Aspen Court",
    city: "Fairview",
    projectType: "2-Car Garage",
    squareFeet: 480,
    flakeColor: "Nightfall",
    flakeSwatch: ["#1f2328", "#5b6470", "#c9ccd1"],
    scheduledDate: "2026-09-29",
    status: "Open",
    progress: 0,
  },
  {
    id: "AF-24126",
    clientName: "Linda Castellano",
    address: "9 Harbor Point Lane",
    city: "Lakewood",
    projectType: "Basement",
    squareFeet: 1150,
    flakeColor: "Coastal Sand",
    flakeSwatch: ["#cbb89a", "#f1ebe0", "#7a6a55"],
    scheduledDate: "2026-09-30",
    status: "Open",
    progress: 0,
  },
  {
    id: "AF-24130",
    clientName: "Greene Family",
    address: "3316 Old Mill Road",
    city: "Oak Ridge",
    projectType: "Garage + Workshop",
    squareFeet: 960,
    flakeColor: "Charcoal Granite",
    flakeSwatch: ["#2e2e30", "#7c7c80", "#e2e2e4"],
    scheduledDate: "2026-10-01",
    status: "Scheduled",
    progress: 0,
  },
  {
    id: "AF-24134",
    clientName: "Tom Nakamura",
    address: "58 Birchwood Terrace",
    city: "Brookfield",
    projectType: "Covered Patio",
    squareFeet: 340,
    flakeColor: "Stone Grey",
    flakeSwatch: ["#9a9a98", "#5f5f5c", "#d6d6d2"],
    scheduledDate: "2026-10-02",
    status: "Open",
    progress: 0,
  },
];

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

export function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
