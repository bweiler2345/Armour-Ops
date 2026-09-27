import type { StepState } from "@/lib/steps/queries";

const LABELS: Record<StepState, { label: string; style: string }> = {
  completed: { label: "Completed", style: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30" },
  in_progress: { label: "In progress", style: "bg-gold-400/15 text-gold-300 ring-gold-400/40" },
  available: { label: "Ready", style: "bg-sky-400/10 text-sky-200 ring-sky-400/30" },
  locked: { label: "Locked", style: "bg-white/5 text-charcoal-400 ring-white/10" },
};

export default function StepStateBadge({ state }: { state: StepState }) {
  const { label, style } = LABELS[state];
  return (
    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${style}`}>{label}</span>
  );
}
