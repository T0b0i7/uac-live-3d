"use client";

/**
 * Détail d'un bâtiment — apps/web/src/app/buildings/[id]/page.tsx
 *
 * Réutilise le panneau `BuildingDetail` (même source de données, même logique)
 * pour éviter deux implémentations divergentes de la même information.
 */

import { use } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { BuildingDetail } from "@/components/map/BuildingDetail";
import { useAppStore } from "@/lib/store";

export default function BuildingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const selectBuilding = useAppStore((s) => s.selectBuilding);

  return (
    <AppShell title="Détail du bâtiment" subtitle={`Identifiant ${id.slice(0, 8)}…`}>
      <div className="mx-auto max-w-2xl overflow-hidden rounded-xl2 border border-line bg-surface/60">
        <div className="min-h-[60vh]">
          <BuildingDetail
            buildingId={id}
            onClose={() => router.push("/buildings")}
            onNavigate={() => {
              selectBuilding(id);
              router.push("/map");
            }}
          />
        </div>
      </div>
    </AppShell>
  );
}
