export default function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6">
      {eyebrow && (
        <p className="text-xs font-semibold tracking-[0.2em] text-gold-400 uppercase">
          {eyebrow}
        </p>
      )}
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
        {title}
      </h1>
      {description && (
        <p className="mt-2 text-[15px] leading-relaxed text-charcoal-300">
          {description}
        </p>
      )}
    </div>
  );
}

export function SectionHeading({
  id,
  title,
  count,
}: {
  id?: string;
  title: string;
  count?: number;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2
        id={id}
        className="text-sm font-semibold tracking-[0.15em] text-charcoal-300 uppercase"
      >
        {title}
      </h2>
      {count !== undefined && (
        <span className="rounded-full bg-charcoal-800 px-2.5 py-0.5 text-xs font-semibold text-charcoal-300 tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}
