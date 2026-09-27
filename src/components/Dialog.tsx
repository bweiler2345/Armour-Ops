"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Mobile-first modal: a bottom sheet on phones, a centered card on larger
// screens. Escape and the backdrop close it unless `locked` is set (used
// while an action is running).
export default function Dialog({
  title,
  onClose,
  locked = false,
  children,
}: {
  title: string;
  onClose: () => void;
  locked?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Latest values, so the mount effect below runs only once.
  const closeRef = useRef({ onClose, locked });
  useEffect(() => {
    closeRef.current = { onClose, locked };
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeRef.current.locked) {
        closeRef.current.onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => !locked && onClose()}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        className="pb-safe relative w-full max-w-md rounded-t-3xl border border-charcoal-700 bg-charcoal-900 p-6 shadow-2xl shadow-black/60 outline-none sm:rounded-3xl"
      >
        <h2 id="dialog-title" className="text-2xl font-semibold text-white">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
