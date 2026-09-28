"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import Dialog from "@/components/Dialog";
import { AlertIcon, CheckIcon, SpinnerIcon } from "@/components/Icons";
import { saveRestockNotes, saveSetupItem, submitSetup } from "@/lib/actions/pre-week-setup";
import { countStatus, parseCount, shortageText, STATUS_LABELS, type InventoryStatus } from "@/lib/inventory/status";

export type ChecklistItem = {
  id: string;
  category: string;
  label: string;
  tracking: "count" | "status_only";
  target: number | null;
  unit: string | null;
  quantity: number | null;
  status: InventoryStatus | null;
  shortage: number | null;
  note: string;
};

type Local = { quantity: string; status: InventoryStatus | null; note: string; save: "saved" | "saving" | "error"; error?: string };

const SAVE_DELAY_MS = 600;

const statusStyle: Record<InventoryStatus, string> = {
  ready: "bg-emerald-400/15 text-emerald-200 ring-emerald-400/40",
  need_more: "bg-gold-400/20 text-gold-100 ring-gold-400/50",
  missing: "bg-red-500/20 text-red-100 ring-red-400/50",
};

// One trailer's weekly checklist, grouped by category. Every change saves on
// its own; a failed save keeps what was entered and offers Retry. Statuses
// shown here match the database's calculation, which is what's stored.
export default function SetupChecklist({
  setupId,
  items,
  restockNotes,
  editable,
}: {
  setupId: string;
  items: ChecklistItem[];
  restockNotes: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [local, setLocal] = useState<Record<string, Local>>(() =>
    Object.fromEntries(
      items.map((i) => [i.id, { quantity: i.quantity === null ? "" : String(i.quantity), status: i.status, note: i.note, save: "saved" as const }]),
    ),
  );
  const [notes, setNotes] = useState(restockNotes);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  const shown = (item: ChecklistItem) => {
    const l = local[item.id];
    if (item.tracking === "status_only") return { status: l.status, shortage: null };
    const parsed = parseCount(l.quantity);
    return parsed.ok ? countStatus(item.target ?? 1, parsed.value) : { status: null, shortage: null };
  };

  async function save(item: ChecklistItem, next: Local) {
    const parsed = parseCount(next.quantity);
    if (item.tracking === "count" && !parsed.ok) {
      setLocal((all) => ({ ...all, [item.id]: { ...next, save: "error", error: parsed.error } }));
      return;
    }
    setLocal((all) => ({ ...all, [item.id]: { ...all[item.id], save: "saving", error: undefined } }));
    const result = await saveSetupItem({
      itemId: item.id,
      quantity: item.tracking === "count" && parsed.ok ? parsed.value : null,
      status: item.tracking === "status_only" ? next.status : null,
      note: next.note,
    }).catch(() => ({ ok: false as const, error: "Not saved. Check your connection and tap Retry." }));
    setLocal((all) => {
      const current = all[item.id];
      // A newer change is on its way; leave its state alone.
      if (current.quantity !== next.quantity || current.status !== next.status || current.note !== next.note) return all;
      return { ...all, [item.id]: result.ok ? { ...current, save: "saved" } : { ...current, save: "error", error: result.error } };
    });
  }

  function change(item: ChecklistItem, changes: Partial<Local>, immediate = false) {
    if (!editable) return;
    const next = { ...local[item.id], ...changes };
    setLocal((all) => ({ ...all, [item.id]: { ...next, save: "saving" } }));
    const existing = timers.current.get(item.id);
    if (existing) window.clearTimeout(existing);
    timers.current.set(
      item.id,
      window.setTimeout(() => void save(item, next), immediate ? 0 : SAVE_DELAY_MS),
    );
  }

  const assessed = items.filter((i) => shown(i).status !== null).length;
  const unsaved = Object.values(local).filter((l) => l.save !== "saved").length;
  const failed = Object.values(local).filter((l) => l.save === "error").length;
  const ready = assessed === items.length && unsaved === 0;
  const summary = items.map((i) => ({ item: i, ...shown(i) }));
  const shortages = summary.filter((s) => s.status === "missing" || s.status === "need_more");

  const categories = [...new Set(items.map((i) => i.category))];

  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-0 z-10 -mx-4 border-b border-charcoal-800 bg-charcoal-950/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-charcoal-700" aria-hidden>
            <div className="gold-gradient h-full rounded-full" style={{ width: `${Math.round((assessed / Math.max(items.length, 1)) * 100)}%` }} />
          </div>
          <span className="text-sm font-semibold text-white tabular-nums">
            {assessed} of {items.length}
          </span>
        </div>
        <p role="status" className={`mt-1 text-sm ${failed ? "font-semibold text-red-200" : "text-charcoal-400"}`}>
          {!editable
            ? "Read only."
            : failed
              ? `${failed} change${failed === 1 ? "" : "s"} not saved. Check your connection and tap Retry.`
              : unsaved
                ? "Saving…"
                : "All changes saved."}
        </p>
      </div>

      {categories.map((category) => (
        <section key={category} aria-labelledby={`cat-${category}`}>
          <h2 id={`cat-${category}`} className="mb-3 text-lg font-semibold tracking-wide text-gold-300">
            {category}
          </h2>
          <ul className="flex flex-col gap-3">
            {items
              .filter((i) => i.category === category)
              .map((item) => {
                const l = local[item.id];
                const { status, shortage } = shown(item);
                return (
                  <li
                    key={item.id}
                    className={`rounded-3xl border-2 p-4 ${
                      status === "missing"
                        ? "border-red-400/50 bg-red-500/5"
                        : status === "need_more"
                          ? "border-gold-500/60 bg-gold-900/20"
                          : status === "ready"
                            ? "border-emerald-400/30 bg-charcoal-900"
                            : "border-charcoal-700 bg-charcoal-900"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[18px] leading-snug font-semibold text-white">{item.label}</p>
                        {item.tracking === "count" && (
                          <p className="text-sm text-charcoal-300">
                            Target: {item.target}
                            {item.unit ? ` ${item.unit}` : ""}
                          </p>
                        )}
                      </div>
                      {status && (
                        <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ring-1 ${statusStyle[status]}`}>
                          {STATUS_LABELS[status]}
                        </span>
                      )}
                    </div>

                    {item.tracking === "count" ? (
                      <div className="mt-3 grid grid-cols-[4rem_minmax(0,1fr)_4rem] gap-2">
                        <button
                          type="button"
                          disabled={!editable || l.quantity.trim() === "0"}
                          // From an empty count, − records 0 (Missing).
                          onClick={() => change(item, { quantity: l.quantity.trim() === "" ? "0" : String(Math.max(0, (Number(l.quantity) || 0) - 1)) })}
                          aria-label={`One fewer ${item.label}`}
                          className="flex min-h-16 items-center justify-center rounded-2xl border border-charcoal-600 bg-charcoal-800 text-3xl font-bold text-white disabled:opacity-40"
                        >
                          −
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={l.quantity}
                          disabled={!editable}
                          placeholder="Count"
                          aria-label={`Usable ${item.label}`}
                          onChange={(e) => change(item, { quantity: e.target.value })}
                          className="min-h-16 w-full rounded-2xl border border-charcoal-600 bg-charcoal-950 text-center text-2xl font-bold text-white outline-none focus:border-gold-400 disabled:opacity-70"
                        />
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => change(item, { quantity: String((Number(l.quantity) || 0) + 1) })}
                          aria-label={`One more ${item.label}`}
                          className="flex min-h-16 items-center justify-center rounded-2xl border border-charcoal-600 bg-charcoal-800 text-3xl font-bold text-white disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={item.label}>
                        {(["ready", "need_more", "missing"] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={l.status === value}
                            disabled={!editable}
                            onClick={() => change(item, { status: value }, true)}
                            className={`min-h-16 rounded-2xl border text-base font-bold ${
                              l.status === value ? `${statusStyle[value]} border-transparent ring-2` : "border-charcoal-600 bg-charcoal-800 text-white"
                            } disabled:opacity-70`}
                          >
                            {STATUS_LABELS[value]}
                          </button>
                        ))}
                      </div>
                    )}

                    {item.tracking === "count" && shortage ? (
                      <p className={`mt-3 text-xl font-bold ${status === "missing" ? "text-red-200" : "text-gold-100"}`}>
                        {shortageText(shortage, item.unit)}
                      </p>
                    ) : null}

                    {(editable || l.note) && (
                      <input
                        type="text"
                        value={l.note}
                        disabled={!editable}
                        maxLength={500}
                        placeholder="Note (optional), e.g. one broken"
                        aria-label={`Note for ${item.label}`}
                        onChange={(e) => change(item, { note: e.target.value })}
                        className="mt-3 min-h-12 w-full rounded-xl border border-charcoal-700 bg-charcoal-950 px-3 text-[16px] text-white outline-none focus:border-gold-400 disabled:opacity-70"
                      />
                    )}

                    {l.save === "error" && (
                      <p role="alert" className="mt-2 flex items-center justify-between gap-3 text-[15px] text-red-200">
                        <span className="flex items-center gap-2">
                          <AlertIcon className="h-5 w-5 shrink-0" /> {l.error}
                        </span>
                        <button
                          type="button"
                          onClick={() => void save(item, l)}
                          className="min-h-12 shrink-0 rounded-xl border border-red-400/50 px-4 font-semibold text-red-100"
                        >
                          Retry
                        </button>
                      </p>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      <section aria-labelledby="restock">
        <h2 id="restock" className="mb-2 text-lg font-semibold text-white">
          Restock notes <span className="text-sm font-normal text-charcoal-400">optional</span>
        </h2>
        <textarea
          value={notes}
          disabled={!editable}
          maxLength={2000}
          rows={3}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={async () => {
            if (!editable || notes === restockNotes) return;
            const result = await saveRestockNotes(setupId, notes).catch(() => ({ ok: false as const, error: "Not saved. Check your connection." }));
            setNotesError(result.ok ? null : result.error);
          }}
          className="block w-full rounded-2xl border border-charcoal-700 bg-charcoal-900 px-4 py-3 text-[17px] text-white outline-none focus:border-gold-400 disabled:opacity-70"
        />
        {notesError && <p role="alert" className="mt-2 text-[15px] text-red-200">{notesError}</p>}
      </section>

      {editable && (
        <>
          {submitError && (
            <p role="alert" className="flex items-start gap-2 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
              <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" /> {submitError}
            </p>
          )}
          <button
            type="button"
            disabled={!ready || submitting}
            onClick={() => {
              setSubmitError(null);
              setConfirming(true);
            }}
            className="gold-gradient flex min-h-16 items-center justify-center gap-2 rounded-2xl text-lg font-semibold text-charcoal-950 shadow-lg shadow-black/30 disabled:opacity-40"
          >
            <CheckIcon className="h-6 w-6" />
            {assessed < items.length ? `Check ${items.length - assessed} more item${items.length - assessed === 1 ? "" : "s"} to submit` : unsaved ? "Saving…" : "Review and Submit"}
          </button>
        </>
      )}

      {confirming && (
        <Dialog title="Submit this Pre-Week Setup?" onClose={() => setConfirming(false)} locked={submitting}>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[16px] font-semibold">
            <span className="text-emerald-200">{summary.filter((s) => s.status === "ready").length} Ready</span>
            <span className="text-gold-200">{summary.filter((s) => s.status === "need_more").length} Need More</span>
            <span className="text-red-200">{summary.filter((s) => s.status === "missing").length} Missing</span>
          </p>
          {shortages.length > 0 ? (
            <ul className="mt-3 flex max-h-72 flex-col gap-1 overflow-y-auto text-[15px]">
              {shortages.map(({ item, status, shortage }) => (
                <li key={item.id} className="text-charcoal-200">
                  <span className="font-semibold text-white">{item.label}</span>:{" "}
                  <span className={status === "missing" ? "text-red-200" : "text-gold-200"}>
                    {STATUS_LABELS[status!]}
                    {item.tracking === "count" && shortage ? ` · ${shortageText(shortage, item.unit)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[15px] text-emerald-100">Everything is Ready.</p>
          )}
          <p className="mt-3 text-sm text-charcoal-400">After submitting, only the owner can reopen it.</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setConfirming(false)} disabled={submitting} className="flex min-h-14 items-center justify-center rounded-2xl border border-charcoal-600 bg-charcoal-800 font-semibold text-white">
              Keep Checking
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                startSubmit(async () => {
                  const result = await submitSetup(setupId).catch(() => ({ ok: false as const, error: "Couldn’t reach the server. Your counts are saved; try again." }));
                  setConfirming(false);
                  if (!result.ok) setSubmitError(result.error);
                  router.refresh();
                })
              }
              className="gold-gradient flex min-h-14 items-center justify-center gap-2 rounded-2xl font-semibold text-charcoal-950"
            >
              {submitting && <SpinnerIcon className="h-5 w-5" />}
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
