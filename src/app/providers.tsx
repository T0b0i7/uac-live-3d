"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";

function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const settings = useAppStore((s) => s.settings);
  const expireStaleAlerts = useAppStore((s) => s.expireStaleAlerts);

  // Apply theme + motion + a11y attributes to <html>.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    const reduced = settings.reducedMotion || prefersReducedMotion();
    root.dataset.reducedMotion = String(reduced);
  }, [settings.theme, settings.reducedMotion]);

  // Simulated clock: expire alerts + refresh relative timestamps.
  useEffect(() => {
    expireStaleAlerts();
    const t = window.setInterval(() => expireStaleAlerts(), 30_000);
    return () => window.clearInterval(t);
  }, [expireStaleAlerts]);

  return <>{children}</>;
}
