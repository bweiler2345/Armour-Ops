import { SpinnerIcon } from "@/components/Icons";

// Shown while an owner page loads (the dashboard gathers every job first).
export default function OwnerLoading() {
  return (
    <div role="status" className="flex flex-col gap-4" aria-label="Loading">
      <p className="flex items-center gap-3 text-[15px] text-charcoal-300">
        <SpinnerIcon className="h-5 w-5" /> Loading…
      </p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-40 animate-pulse rounded-3xl border border-charcoal-800 bg-charcoal-900" />
      ))}
    </div>
  );
}
