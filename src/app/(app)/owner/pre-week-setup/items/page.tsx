import type { Metadata } from "next";
import Link from "next/link";
import { AlertIcon } from "@/components/Icons";
import PageHeading from "@/components/PageHeading";
import { requireOwner } from "@/lib/dal";
import { listTemplate } from "@/lib/inventory/queries";
import { AddItemForm, ItemEditor, type TemplateItem } from "./ItemEditor";

export const metadata: Metadata = {
  title: "Inventory List · Armour Ops",
};

// The inventory list every trailer is checked against. Changes apply to
// weeks started from now on; weeks already started keep their snapshot.
export default async function InventoryListPage() {
  await requireOwner();
  const rows = await listTemplate();
  const back = (
    <Link href="/owner/pre-week-setup" className="mb-4 inline-flex min-h-11 items-center text-[15px] font-semibold text-gold-300">
      ← Pre-Week Setup
    </Link>
  );
  if (rows === null) {
    return (
      <>
        {back}
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-[15px] text-red-100">
          <AlertIcon className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
          The inventory list couldn’t be loaded. Refresh to try again.
        </p>
      </>
    );
  }
  const active: TemplateItem[] = rows
    .filter((r) => !r.archived_at)
    .map((r) => ({ id: r.id, category: r.category, label: r.label, tracking: r.tracking, target: r.target_quantity, unit: r.unit_label }));
  const categories = [...new Set(active.map((i) => i.category))];
  const archived = rows.filter((r) => r.archived_at);

  return (
    <>
      {back}
      <PageHeading
        eyebrow="Owner"
        title="Inventory List"
        description="Used for every trailer. Changes apply to weeks started from now on; weeks already started and all past submissions keep what they were checked against."
      />
      <div className="flex flex-col gap-8">
        {categories.map((category) => {
          const items = active.filter((i) => i.category === category);
          return (
            <section key={category} aria-labelledby={`cat-${category}`}>
              <h2 id={`cat-${category}`} className="mb-3 text-lg font-semibold text-gold-300">
                {category} <span className="text-sm font-normal text-charcoal-400">({items.length})</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {items.map((item, i) => (
                  <ItemEditor key={item.id} item={item} categories={categories} first={i === 0} last={i === items.length - 1} />
                ))}
              </ul>
            </section>
          );
        })}
        <AddItemForm categories={categories} />
        {archived.length > 0 && (
          <section aria-labelledby="archived-items">
            <h2 id="archived-items" className="mb-2 text-lg font-semibold text-white">
              Archived
            </h2>
            <ul className="flex flex-col gap-1 text-[15px] text-charcoal-400">
              {archived.map((r) => (
                <li key={r.id}>
                  {r.label} · {r.category}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
