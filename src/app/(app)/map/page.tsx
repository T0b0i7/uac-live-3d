"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronUp,
  MapPin,
  Navigation2,
  ShieldAlert,
  Siren,
  X,
  Footprints,
  CheckCircle2,
} from "lucide-react";
import { BUILDING_BY_ID } from "@/data/buildings";
import { CAMPUS_STUDENTS } from "@/data/students";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, useUnreadCount } from "@/store/useAppStore";
import { Button, Modal } from "@/components/ui/primitives";
import { SearchBar } from "@/components/layout/SearchBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { MapControls, LayersPanel, CompassRose } from "@/components/map/MapControls";
import { ActivityPanel } from "@/components/map/ActivityPanel";
import { CampusMap2D } from "@/components/map/CampusMap2D";
import { BuildingDrawer, StudentProfileModal } from "@/components/buildings/BuildingDrawer";
import { cn } from "@/lib/utils";

const Campus3D = dynamic(() => import("@/components/campus-3d/Campus3D").then((m) => m.Campus3D), {
  ssr: false,
  loading: () => <SceneSkeleton />,
});

function SceneSkeleton() {
  return (
    <div className="absolute inset-0 map-backdrop">
      <div className="absolute inset-0 map-grid-lines opacity-60" />
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="relative h-12 w-12">
            <span className="absolute inset-0 animate-pulse-ring rounded-full border border-cyan/40" />
            <span className="absolute inset-2 rounded-full border border-cyan/30" />
            <span className="absolute inset-[18px] rounded-full bg-cyan/70 blur-[2px]" />
          </div>
          <p className="text-[11.5px] tracking-wide text-muted">Chargement du campus 3D…</p>
        </div>
      </div>
    </div>
  );
}

export default function MapPage() {
  const mapView = useAppStore((s) => s.mapView);
  const route = useAppStore((s) => s.route);
  const navigating = useAppStore((s) => s.navigating);
  const cancelNavigation = useAppStore((s) => s.cancelNavigation);
  const flyTo = useAppStore((s) => s.flyToBuilding);
  const selectedId = useAppStore((s) => s.selectedBuildingId);
  const select = useAppStore((s) => s.selectBuilding);
  const privacy = useAppStore((s) => s.privacy);
  const user = useAppStore((s) => s.user);
  const triggerSos = useAppStore((s) => s.triggerSos);
  const sosActive = useAppStore((s) => s.sosActive);
  const cancelSos = useAppStore((s) => s.cancelSos);
  const privacyState = useAppStore((s) => s.setPrivacy);
  const unread = useUnreadCount();
  const mapTime = useAppStore((s) => s.mapTime);
  const setMapTime = useAppStore((s) => s.setMapTime);

  const [studentId, setStudentId] = useState<string | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);

  const destination = route ? BUILDING_BY_ID.get(route.toBuildingId) : null;
  const activeAlerts = useAppStore(useShallow((s) => s.alerts.filter((a) => a.status === "active")));

  const onLocate = useCallback(() => {
    flyTo(user?.currentBuildingId ?? "ifri");
  }, [flyTo, user?.currentBuildingId]);

  // Bridge zoom events from the control cluster into the 2D map / 3D canvas.
  useEffect(() => {
    const handler = (e: Event) => {
      const dir = (e as CustomEvent<{ dir: number }>).detail?.dir ?? 0;
      if (mapView === "2d") {
        document.dispatchEvent(new CustomEvent("uac:2d-zoom", { detail: { dir } }));
      }
    };
    document.addEventListener("uac:zoom", handler as EventListener);
    return () => document.removeEventListener("uac:zoom", handler as EventListener);
  }, [mapView]);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden">
      {/* ---------------- map canvas layer ---------------- */}
      <div className="absolute inset-0">
        {mapView === "3d" ? (
          <Campus3D onSelectStudent={setStudentId} />
        ) : (
          <CampusMap2D onSelectStudent={setStudentId} />
        )}
      </div>

      {/* ambient gradient veil for panel legibility */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_50%,transparent_35%,rgba(4,7,13,0.55)_100%)]" />

      {/* ---------------- desktop left sidebar ---------------- */}
      <div className="pointer-events-none absolute inset-y-3 left-0 z-30 hidden w-[248px] px-3 lg:block">
        <div className="panel pointer-events-auto h-full rounded-2xl px-3 py-3.5">
          <Sidebar />
        </div>
      </div>

      {/* ---------------- mobile top bar ---------------- */}
      <div className="absolute inset-x-0 top-0 z-40 flex items-center gap-2 p-3 lg:hidden">
        <button
          onClick={() => setMobileSidebar(true)}
          className="panel grid h-11 w-11 shrink-0 place-items-center rounded-xl"
          aria-label="Ouvrir le menu"
        >
          <span className="space-y-1">
            <span className="block h-[1.5px] w-4 bg-cyan" />
            <span className="block h-[1.5px] w-4 bg-ink/70" />
            <span className="block h-[1.5px] w-2.5 bg-ink/40" />
          </span>
        </button>
        <div className="flex-1">
          <SearchBar onOpenProfile={setStudentId} />
        </div>
        <Link
          href="/notifications"
          className="panel relative grid h-11 w-11 shrink-0 place-items-center rounded-xl"
          aria-label="Notifications"
        >
          <ShieldAlert size={17} className="text-muted" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
              {unread}
            </span>
          )}
        </Link>
      </div>

      {/* ---------------- desktop top search ---------------- */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-40 hidden -translate-x-1/2 lg:block">
        <div className="pointer-events-auto">
          <SearchBar variant="floating" onOpenProfile={setStudentId} />
        </div>
      </div>

      {/* ---------------- right activity panel (desktop) ---------------- */}
      <div className="pointer-events-none absolute inset-y-3 right-3 z-30 hidden w-[286px] xl:block">
        <div className="panel pointer-events-auto h-full rounded-2xl p-3">
          <ActivityPanel onOpenStudent={setStudentId} />
        </div>
      </div>

      {/* ---------------- map controls ---------------- */}
      <div
        className={cn(
          "absolute z-30 flex flex-col items-end gap-2",
          "right-3 bottom-[104px] lg:bottom-4",
          selectedId && "hidden sm:flex",
          "xl:right-[304px]",
        )}
      >
        <MapControls
          onLocate={onLocate}
          onRecenter={() => flyTo(null)}
          onStartNavigation={() => {
            document.dispatchEvent(new CustomEvent("uac:open-nav"));
            setSheetExpanded(true);
          }}
          onOpenLayers={() => setLayersOpen((v) => !v)}
        />
      </div>

      <div className="pointer-events-none absolute left-3 top-20 z-20 hidden lg:block xl:left-[268px]">
        <CompassRose />
      </div>

      <LayersPanel open={layersOpen} onClose={() => setLayersOpen(false)} />

      {/* ---------------- bottom status bar ---------------- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 hidden items-end justify-between gap-3 p-3 lg:flex">
        <div className="pointer-events-auto panel flex items-center gap-2 rounded-xl px-3 py-2">
          <MapPin size={13} className="text-cyan" />
          <span className="text-[11px] tracking-wide text-dim">
            CAMPUS UAC · ABOMEY-CALAVI <span className="text-muted/50">|</span>{" "}
            <span className="text-muted">IFRI & alentours</span>
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={() => setMapTime(mapTime === "day" ? "night" : "day")}
            className="panel rounded-xl px-3 py-2 text-[11px] font-medium text-dim transition-colors hover:text-ink"
          >
            {mapTime === "day" ? "Mode jour" : "Mode nuit"}
          </button>
          <span className="panel inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> {mapView.toUpperCase()} LIVE
          </span>
        </div>
      </div>

      {/* ---------------- SOS ---------------- */}
      <div className="absolute bottom-[96px] left-3 z-30 flex flex-col gap-2 lg:bottom-4 lg:left-[268px] xl:left-auto xl:right-[304px]">
        <button
          onClick={() => setSosOpen(true)}
          className={cn(
            "group relative grid h-12 w-12 place-items-center rounded-2xl border transition-all",
            sosActive
              ? "border-danger bg-danger text-white shadow-[0_0_30px_rgba(244,63,94,0.7)]"
              : "border-danger/40 bg-danger/12 text-danger hover:bg-danger/22 hover:shadow-[0_0_24px_rgba(244,63,94,0.4)]",
          )}
          aria-label="Bouton SOS démo"
        >
          {sosActive && <span className="absolute inset-0 animate-pulse-ring rounded-2xl border border-danger/70" />}
          <Siren size={20} />
        </button>
      </div>

      {/* ---------------- mobile bottom sheet ---------------- */}
      <div className="absolute inset-x-0 bottom-[64px] z-30 md:hidden">
        <div
          className={cn(
            "panel mx-2 rounded-2xl transition-all duration-300",
            sheetExpanded ? "max-h-[52vh]" : "max-h-[124px]",
          )}
        >
          <button
            onClick={() => setSheetExpanded((v) => !v)}
            className="flex w-full items-center justify-between px-3.5 pb-1.5 pt-2"
            aria-label="Déployer le panneau"
          >
            <span className="mx-auto h-1 w-10 rounded-full bg-white/20" />
          </button>
          <div className="flex items-center justify-between px-3.5 pb-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-success">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
              </span>
              <span className="text-[11px] text-dim">{CAMPUS_STUDENTS.filter((s) => s.online).length} étudiants</span>
            </div>
            <ChevronUp
              size={15}
              className={cn("text-muted transition-transform", sheetExpanded && "rotate-180")}
            />
          </div>
          <div className={cn("thin-scroll overflow-y-auto px-3 pb-3", sheetExpanded ? "max-h-[42vh]" : "max-h-[64px]")}>
            {activeAlerts.slice(0, sheetExpanded ? 6 : 1).map((a) => {
              const b = BUILDING_BY_ID.get(a.buildingId);
              return (
                <Link
                  key={a.id}
                  href="/alerts"
                  className="mb-1.5 flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2"
                >
                  <AlertTriangle size={13} className="shrink-0 text-warning" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{a.title}</span>
                  <span className="shrink-0 text-[9.5px] text-muted">{b?.shortName}</span>
                </Link>
              );
            })}
            {sheetExpanded && (
              <div className="mt-2 flex gap-2">
                <Link href="/study" className="flex-1">
                  <Button variant="secondary" size="sm" full>
                    Groupes d&apos;étude
                  </Button>
                </Link>
                <Link href="/friends" className="flex-1">
                  <Button variant="secondary" size="sm" full>
                    Amis
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- building drawer ---------------- */}
      <BuildingDrawer />

      {/* ---------------- navigation HUD ---------------- */}
      {route && destination && (
        <NavigationHud
          onCancel={cancelNavigation}
          destinationName={destination.shortName}
          distanceM={route.distanceM}
          durationMin={route.durationMin}
          steps={route.steps}
          navigating={navigating}
          onRecenter={() => flyTo(route.toBuildingId)}
        />
      )}

      <StudentProfileModal studentId={studentId} onClose={() => setStudentId(null)} />

      {/* ---------------- SOS modal ---------------- */}
      <Modal
        open={sosOpen}
        onClose={() => setSosOpen(false)}
        title="SOS Campus — démonstration"
        description="Ce bouton est une simulation d'interface. Aucune alerte réelle n'est transmise."
        size="sm"
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/[0.08] px-3 py-2.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[12px] leading-relaxed text-dim">
              Aucune coordonnée GPS n&apos;est lue ni envoyée. Aucun appel n&apos;est passé. Aucun service de sécurité
              n&apos;est contacté. Ce prototype ne constitue pas un dispositif d&apos;urgence.
            </p>
          </div>
          {sosActive ? (
            <div className="space-y-2 rounded-xl border border-success/25 bg-success/[0.07] px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-success">
                <CheckCircle2 size={14} /> SOS simulé actif
              </p>
              <p className="text-[11.5px] leading-relaxed text-dim">
                Statut : alerte de démonstration en cours. Contacts d&apos;urgence fictifs en attente.
              </p>
              <Button variant="secondary" size="sm" full onClick={cancelSos}>
                Annuler le SOS simulé
              </Button>
            </div>
          ) : (
            <Button
              variant="danger"
              full
              onClick={() => {
                triggerSos();
                setSosOpen(false);
              }}
            >
              <Siren size={15} /> Activer le SOS simulé
            </Button>
          )}
          <Link href="/settings" className="block text-center text-[11px] text-cyan hover:underline">
            Gérer mes contacts d&apos;urgence
          </Link>
        </div>
      </Modal>

      {/* mobile drawer sidebar */}
      {mobileSidebar && (
        <div className="fixed inset-0 z-[95] lg:hidden">
          <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileSidebar(false)} aria-label="Fermer" />
          <div className="panel absolute inset-y-0 left-0 w-[276px] rounded-r-2xl px-3 py-4">
            <button
              onClick={() => setMobileSidebar(false)}
              className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/10 hover:text-ink"
              aria-label="Fermer le menu"
            >
              <X size={15} />
            </button>
            <Sidebar onNavigate={() => setMobileSidebar(false)} />
          </div>
        </div>
      )}

      {/* privacy chip (desktop, bottom-left of map) */}
      <div className="pointer-events-auto absolute bottom-20 left-[268px] z-20 hidden lg:block">
        <button
          onClick={() => {
            const order = ["ghost", "zone", "friends", "open"] as const;
            const i = order.indexOf(privacy);
            privacyState(order[(i + 1) % order.length]!);
          }}
          className={cn(
            "panel flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[10.5px] font-medium transition-colors",
            privacy === "ghost" ? "text-muted" : "text-cyan",
          )}
          title="Changer de mode de confidentialité"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          Confidentialité :{" "}
          {privacy === "ghost" ? "Fantôme" : privacy === "zone" ? "Zone" : privacy === "friends" ? "Amis" : "Ouvert"}
        </button>
      </div>

    </div>
  );
}

function NavigationHud({
  onCancel,
  destinationName,
  distanceM,
  durationMin,
  steps,
  navigating,
  onRecenter,
}: {
  onCancel: () => void;
  destinationName: string;
  distanceM: number;
  durationMin: number;
  steps: { instruction: string; distanceM: number; icon: string }[];
  navigating: boolean;
  onRecenter: () => void;
}) {
  const [step, setStep] = useState(0);
  const current = steps[Math.min(step, steps.length - 1)];

  return (
    <div className="absolute bottom-[176px] left-1/2 z-30 w-[min(420px,calc(100vw-24px))] -translate-x-1/2 lg:bottom-4 lg:left-[calc(50%+40px)]">
      <div className="panel overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan/15 text-cyan">
              <Navigation2 size={15} />
            </span>
            <div>
              <p className="text-[12.5px] font-semibold text-ink">Vers {destinationName}</p>
              <p className="text-[10.5px] text-muted">
                {distanceM} m · {durationMin} min à pied · simulation
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.08] hover:text-ink"
            aria-label="Annuler la navigation"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-3.5 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Étape {Math.min(step + 1, steps.length)} / {steps.length}
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-ink">{current?.instruction}</p>
          {current && current.distanceM > 0 && (
            <p className="mt-0.5 text-[10.5px] text-cyan">dans {current.distanceM} m</p>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <Button size="sm" variant="primary" onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))} disabled={step >= steps.length - 1}>
              <Footprints size={12} /> Étape suivante
            </Button>
            <Button size="sm" variant="secondary" onClick={onRecenter}>
              Recentrer
            </Button>
            <span className="ml-auto text-[10px] text-muted">{navigating ? "Actif" : "En pause"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
