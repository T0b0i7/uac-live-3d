"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import { Sidebar, MobileTabBar } from "./Sidebar";
import { Toaster } from "@/components/ui/Toaster";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isMap = pathname === "/map";
  const user = useAppStore((s) => s.user);
  const [hydrated, setHydrated] = useState(false);

  // Zustand persist rehydrates on the client — wait one tick before guarding.
  useEffect(() => {
    const unsub = useAppStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAppStore.persist.hasHydrated()) setHydrated(true);
    const t = window.setTimeout(() => setHydrated(true), 400);
    return () => {
      unsub();
      window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (hydrated && !user) router.replace("/login");
  }, [hydrated, user, router]);

  if (!hydrated || !user) {
    return (
      <div className="grid min-h-screen place-items-center map-backdrop">
        <div className="flex flex-col items-center gap-4">
          <div className="relative grid h-14 w-14 place-items-center">
            <span className="absolute inset-0 rounded-2xl border border-cyan/25 bg-cyan/10" />
            <span className="absolute inset-0 animate-pulse-ring rounded-2xl border border-cyan/40" />
            <span className="h-6 w-6 rounded-lg bg-cyan/70 blur-[2px]" />
          </div>
          <p className="text-[12.5px] font-medium tracking-wide text-muted">Initialisation du campus…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen bg-void text-ink">
      {/* Desktop sidebar — the map route renders its own floating rail */}
      {!isMap && (
        <div className="fixed left-0 top-0 z-40 hidden h-screen w-[248px] border-r border-white/[0.07] bg-[#080d17]/85 px-3 py-4 backdrop-blur-xl lg:block">
          <Sidebar />
        </div>
      )}

      <div className={isMap ? "min-h-screen w-full" : "min-h-screen w-full lg:pl-[248px]"}>
        <div className={isMap ? "pb-[64px] md:pb-0" : "pb-[76px] md:pb-0"}>{children}</div>
      </div>

      <MobileTabBar />
      <Toaster />
    </div>
  );
}
