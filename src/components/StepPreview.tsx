import type { StepDefinition } from "@/lib/steps/definition";

// Read-only preview of a custom step, as employees will see its content.
export default function StepPreview({ definition }: { definition: StepDefinition }) {
  const d = definition;
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-charcoal-800 bg-charcoal-900 p-5">
      <h2 className="text-2xl font-semibold text-white">{d.title}</h2>
      {d.goal && <p className="text-[16px] leading-relaxed text-charcoal-300">{d.goal}</p>}
      {d.instructions.length > 0 && (
        <Section title="Instructions">
          <ol className="list-decimal pl-5 text-[15px] leading-relaxed text-white">
            {d.instructions.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </Section>
      )}
      {d.referenceLists.map((list, i) => (
        <Section key={i} title={`${list.heading} (reference)`}>
          <ul className="list-disc pl-5 text-[15px] text-charcoal-300">
            {list.items.map((t, j) => (
              <li key={j}>{t}</li>
            ))}
          </ul>
        </Section>
      ))}
      {d.checks.length > 0 && (
        <Section title="Final check">
          <ul className="flex flex-col gap-1 text-[15px] text-white">
            {d.checks.map((c, i) => (
              <li key={i}>
                ☐ {c.text}
                {!c.required && <span className="ml-2 text-sm text-charcoal-400">(optional)</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {d.inputs.length > 0 && (
        <Section title="Entries">
          <ul className="flex flex-col gap-1 text-[15px] text-white">
            {d.inputs.map((input, i) => (
              <li key={i}>
                {input.label}
                <span className="ml-2 text-sm text-charcoal-400">
                  {input.type === "single_select" ? `choose: ${input.choices.join(", ")}` : input.type === "number" ? `number${input.unit ? ` (${input.unit})` : ""}` : "written text"}
                  {input.required ? "" : " · optional"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Required proof">
        <p className="text-[15px] text-white">
          {d.proof.type === "none"
            ? "None"
            : d.proof.type === "video"
              ? `Video: ${d.proof.label}`
              : `${d.proof.minCount} or more picture${d.proof.minCount === 1 ? "" : "s"}: ${d.proof.label}`}
        </p>
      </Section>
      <Section title="Confirmation">
        <p className="text-[15px] font-medium text-white">“{d.confirmationText}”</p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-1 text-xs font-semibold tracking-[0.15em] text-charcoal-400 uppercase">{title}</p>
      {children}
    </section>
  );
}
