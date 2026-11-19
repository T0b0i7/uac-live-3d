"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const go = () => {
      const { user } = useAppStore.getState();
      router.replace(user ? "/map" : "/login");
    };
    if (useAppStore.persist.hasHydrated()) go();
    const unsub = useAppStore.persist.onFinishHydration(go);
    const t = window.setTimeout(go, 500);
    return () => {
      unsub();
      window.clearTimeout(t);
    };
  }, [router]);

  return (
    <div className="grid min-h-screen place-items-center map-backdrop">
      <div className="flex flex-col items-center gap-4">
        <div className="relative grid h-14 w-14 place-items-center">
          <span className="absolute inset-0 rounded-2xl border border-cyan/25 bg-cyan/10" />
          <span className="absolute inset-0 animate-pulse-ring rounded-2xl border border-cyan/40" />
          <span className="h-6 w-6 rounded-lg bg-cyan/70 blur-[2px]" />
        </div>
        <p className="text-[12.5px] font-medium tracking-wide text-muted">UAC-LIVE 3D — chargement…</p>
      </div>
    </div>
  );
}
