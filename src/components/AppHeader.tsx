export default function AppHeader() {
  return (
    <header className="pt-safe sticky top-0 z-20 border-b border-charcoal-800 bg-charcoal-950/90 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="gold-gradient flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold text-charcoal-950 shadow-lg shadow-black/40">
            A
          </div>
          <div className="leading-tight">
            <p className="text-lg font-semibold tracking-tight text-white">
              Armour <span className="gold-text">Ops</span>
            </p>
            <p className="text-[11px] font-medium tracking-[0.2em] text-charcoal-400 uppercase">
              Armour Floors
            </p>
          </div>
        </div>
        <span className="rounded-full border border-charcoal-700 bg-charcoal-900 px-3 py-1 text-xs font-medium text-charcoal-300">
          Preview
        </span>
      </div>
    </header>
  );
}
