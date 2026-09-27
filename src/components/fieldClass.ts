// Shared text-input styling. 17px text keeps iOS Safari from zooming in when
// a field is focused.
export function fieldClass(invalid: boolean) {
  return `block min-h-16 w-full rounded-2xl border bg-charcoal-800 px-4 text-[17px] text-white placeholder:text-charcoal-400 transition outline-none focus:ring-2 disabled:opacity-60 ${
    invalid
      ? "border-red-400/70 focus:border-red-400 focus:ring-red-400/30"
      : "border-charcoal-700 focus:border-gold-400 focus:ring-gold-400/30"
  }`;
}
