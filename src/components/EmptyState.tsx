export default function EmptyState({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-charcoal-700 p-5 text-center text-[15px] leading-relaxed text-charcoal-400">
      {text}
    </p>
  );
}
