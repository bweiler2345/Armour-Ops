"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import ConfirmAction from "@/components/ConfirmAction";
import { fieldClass } from "@/components/fieldClass";
import { addInventoryItem, archiveInventoryItem, moveInventoryItem, updateInventoryItem } from "@/lib/actions/pre-week-setup";

export type TemplateItem = {
  id: string;
  category: string;
  label: string;
  tracking: "count" | "status_only";
  target: number | null;
  unit: string | null;
};

type Outcome = { ok: boolean; error?: string; message?: string };

// One item of the inventory list: edit for future weeks, reorder within its
// category, or archive.
export function ItemEditor({ item, categories, first, last }: { item: TemplateItem; categories: string[]; first: boolean; last: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<Outcome, FormData>(updateInventoryItem.bind(null, item.id), { ok: true });
  // The form stays open from when Edit was tapped until a save succeeds.
  const [openedWith, setOpenedWith] = useState<Outcome | null>(null);
  const open = openedWith !== null && (openedWith === state || !state.ok);
  const setOpen = (value: boolean) => setOpenedWith(value ? state : null);
  const [moving, startMove] = useTransition();

  return (
    <li className="rounded-2xl border border-charcoal-800 bg-charcoal-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[17px] font-semibold text-white">{item.label}</p>
          <p className="text-sm text-charcoal-300">
            {item.tracking === "count" ? `Target: ${item.target}${item.unit ? ` ${item.unit}` : ""}` : "Ready / Need More / Missing (no count)"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {([-1, 1] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              disabled={moving || (direction < 0 ? first : last)}
              onClick={() => startMove(async () => { await moveInventoryItem(item.id, direction); router.refresh(); })}
              aria-label={direction < 0 ? `Move ${item.label} up` : `Move ${item.label} down`}
              className="flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-charcoal-600 text-lg font-bold text-white disabled:opacity-30"
            >
              {direction < 0 ? "↑" : "↓"}
            </button>
          ))}
        </div>
      </div>
      {state.message && !open && <p className="mt-2 text-sm text-emerald-200">{state.message}</p>}
      {open ? (
        <form action={formAction} className="mt-3 flex flex-col gap-3">
          <ItemFields item={item} categories={categories} />
          {!state.ok && state.error && <p role="alert" className="text-[15px] text-red-200">{state.error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setOpen(false)} className="min-h-14 rounded-2xl border border-charcoal-600 font-semibold text-white">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="gold-gradient min-h-14 rounded-2xl font-semibold text-charcoal-950 disabled:opacity-50">
              {pending ? "Saving…" : "Save for Future Weeks"}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setOpen(true)} className="min-h-14 rounded-2xl border border-gold-500/50 bg-charcoal-800 font-semibold text-gold-200">
            Edit
          </button>
          <ConfirmAction
            action={archiveInventoryItem.bind(null, item.id)}
            label="Archive"
            title={`Archive ${item.label}?`}
            body="It won’t appear in weeks started from now on. This week’s checks, if already started, and every past week keep it."
            confirmLabel="Archive"
            busyLabel="Archiving…"
            tone="danger"
          />
        </div>
      )}
    </li>
  );
}

function ItemFields({ item, categories }: { item?: TemplateItem; categories: string[] }) {
  const [tracking, setTracking] = useState(item?.tracking ?? "count");
  return (
    <>
      <label className="text-[15px] font-semibold text-white">
        Name
        <input name="label" defaultValue={item?.label} maxLength={80} required className={`${fieldClass(false)} mt-1`} />
      </label>
      <label className="text-[15px] font-semibold text-white">
        Category
        <input name="category" defaultValue={item?.category ?? categories[0]} list="inventory-categories" maxLength={60} required className={`${fieldClass(false)} mt-1`} />
        <datalist id="inventory-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      {!item && (
        <label className="text-[15px] font-semibold text-white">
          Kind
          <select name="tracking" value={tracking} onChange={(e) => setTracking(e.target.value as "count" | "status_only")} className={`${fieldClass(false)} mt-1 appearance-none`}>
            <option value="count">Counted, with a target</option>
            <option value="status_only">Ready / Need More / Missing only</option>
          </select>
        </label>
      )}
      {tracking === "count" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[15px] font-semibold text-white">
            Target
            <input name="target" type="number" min={1} max={1000} defaultValue={item?.target ?? 1} required className={`${fieldClass(false)} mt-1`} />
          </label>
          <label className="text-[15px] font-semibold text-white">
            Unit <span className="font-normal text-charcoal-400">optional</span>
            <input name="unit" defaultValue={item?.unit ?? ""} maxLength={30} placeholder="e.g. bags" className={`${fieldClass(false)} mt-1`} />
          </label>
        </div>
      )}
    </>
  );
}

export function AddItemForm({ categories }: { categories: string[] }) {
  const [state, formAction, pending] = useActionState<Outcome, FormData>(addInventoryItem, { ok: true });
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-3xl border border-dashed border-charcoal-600 p-4">
      <h2 className="text-lg font-semibold text-white">Add an item for future weeks</h2>
      <ItemFields categories={categories} />
      {state.error && <p role="alert" className="text-[15px] text-red-200">{state.error}</p>}
      {state.message && <p role="status" className="text-[15px] text-emerald-200">{state.message}</p>}
      <button type="submit" disabled={pending} className="gold-gradient min-h-16 rounded-2xl text-lg font-semibold text-charcoal-950 disabled:opacity-50">
        {pending ? "Adding…" : "Add Item"}
      </button>
    </form>
  );
}
