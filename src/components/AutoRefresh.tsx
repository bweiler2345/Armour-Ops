"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Keeps a read-only screen current: re-renders it from the server every
// few seconds while the app is on screen, and as soon as it comes back to the
// foreground. Only for screens with no unsaved input (the editing step screen
// keeps itself current instead).
export default function AutoRefresh({ everyMs = 10_000 }: { everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, everyMs);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [everyMs, router]);

  return null;
}
