"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import ConfirmAction from "@/components/ConfirmAction";
import { fieldClass } from "@/components/fieldClass";
import { addTrailer, archiveTrailer, renameTrailer } from "@/lib/actions/pre-week-setup";

type Trailer = { id: string; name: string; archived: boolean };

// Rename, add, and archive trailers. Archiving keeps every past week.
export default function TrailerManager({ trailers }: { trailers: Trailer[] }) {
  return (
    <div className="flex flex-col gap-4">
      {trailers
        .filter((t) => !t.archived)
        .map((t) => (
          <div key={t.id} className="flex flex-col gap-3 rounded-3xl border border-charcoal-800 bg-charcoal-900 p-4">
            <NameForm label={`Name of ${t.name}`} initial={t.name} submitLabel="Rename" run={(name) => renameTrailer(t.id, name)} />
            <ConfirmAction
              action={archiveTrailer.bind(null, t.id)}
              label="Archive"
              title={`Archive ${t.name}?`}
              body="It won’t get new weekly checks. Every past week and submission stays in history."
              confirmLabel="Archive"
              busyLabel="Archiving…"
              tone="danger"
            />
          </div>
        ))}
      <div className="rounded-3xl border border-dashed border-charcoal-600 p-4">
        <NameForm label="New trailer name" initial="" submitLabel="Add Trailer" run={addTrailer} />
      </div>
      {trailers.some((t) => t.archived) && (
        <div>
          <h2 className="mb-2 text-lg font-semibold text-white">Archived</h2>
          <ul className="flex flex-col gap-2">
            {trailers
              .filter((t) => t.archived)
              .map((t) => (
                <li key={t.id} className="rounded-2xl border border-charcoal-800 bg-charcoal-900 px-4 py-3 text-[15px] text-charcoal-300">
                  {t.name}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NameForm({
  label,
  initial,
  submitLabel,
  run,
}: {
  label: string;
  initial: string;
  submitLabel: string;
  run: (name: string) => Promise<{ ok: boolean; error?: string; message?: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result: { ok: boolean; error?: string; message?: string } = await run(name).catch(() => ({ ok: false, error: "Couldn’t reach the server. Try again." }));
          setMessage({ ok: result.ok, text: result.ok ? (result.message ?? "Saved.") : (result.error ?? "Something went wrong.") });
          if (result.ok && !initial) setName("");
          router.refresh();
        });
      }}
      className="flex flex-col gap-2"
    >
      <label className="text-[15px] font-semibold text-white">
        {label}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={`${fieldClass(false)} mt-1`} />
      </label>
      <button
        type="submit"
        disabled={pending || !name.trim() || name.trim() === initial}
        className="min-h-14 rounded-2xl border border-gold-500/50 bg-charcoal-800 text-base font-semibold text-gold-200 disabled:opacity-40"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
      {message && <p className={`text-[15px] ${message.ok ? "text-emerald-200" : "text-red-200"}`}>{message.text}</p>}
    </form>
  );
}
