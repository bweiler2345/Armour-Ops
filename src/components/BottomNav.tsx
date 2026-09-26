"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountIcon, JobsIcon, TrailerIcon } from "@/components/Icons";

const items = [
  { href: "/jobs", label: "Jobs", Icon: JobsIcon },
  { href: "/weekly-setup", label: "Weekly Setup", Icon: TrailerIcon },
  { href: "/account", label: "Account", Icon: AccountIcon },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-charcoal-800 bg-charcoal-950/95 backdrop-blur-md"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-3 gap-2 px-3 py-2">
        {items.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl text-[13px] font-semibold transition active:scale-[0.97] ${
                  active
                    ? "bg-charcoal-800 text-gold-300 ring-1 ring-gold-500/30"
                    : "text-charcoal-400 hover:text-white"
                }`}
              >
                <Icon className="h-7 w-7" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
