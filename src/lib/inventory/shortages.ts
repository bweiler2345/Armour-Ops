// Combines this week's Missing and Need More items across trailers: each
// trailer's own shortage is kept, and counted items also get a combined
// total. Items match when their label, unit, and kind match.

export type ShortageItem = {
  setupId: string;
  label: string;
  unitLabel: string | null;
  tracking: "count" | "status_only";
  status: "missing" | "need_more";
  shortage: number | null;
  note: string;
};

export type ShortageLine = {
  label: string;
  unitLabel: string | null;
  tracking: "count" | "status_only";
  perTrailer: { trailerId: string; trailerName: string; setupId: string; status: "missing" | "need_more"; shortage: number | null; note: string }[];
  total: number | null;
};

export function combineShortages(
  items: readonly ShortageItem[],
  setups: readonly { id: string; trailerId: string; trailerName: string }[],
): ShortageLine[] {
  const lines = new Map<string, ShortageLine>();
  for (const item of items) {
    const setup = setups.find((s) => s.id === item.setupId);
    if (!setup) continue;
    const key = `${item.label}|${item.unitLabel ?? ""}|${item.tracking}`;
    const line = lines.get(key) ?? {
      label: item.label,
      unitLabel: item.unitLabel,
      tracking: item.tracking,
      perTrailer: [],
      total: item.tracking === "count" ? 0 : null,
    };
    line.perTrailer.push({
      trailerId: setup.trailerId,
      trailerName: setup.trailerName,
      setupId: setup.id,
      status: item.status,
      shortage: item.shortage,
      note: item.note,
    });
    if (line.total !== null) line.total += item.shortage ?? 0;
    lines.set(key, line);
  }
  return [...lines.values()];
}
