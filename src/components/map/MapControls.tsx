"use client";

import { useState } from "react";
import {
  Compass,
  Layers,
  Minus,
  Moon,
  Navigation2,
  Plus,
  Sun,
  Target,
  Box,
  Map as MapIcon,
  Users,
  Tag,
  ShieldAlert,
  Crosshair,
  Locate,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";

function CtrlButton({
  onClick,
  active,
  label,
  children,
  tone = "default",
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <Tooltip label={label} side="left">
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "grid h-9 w-9 place-items-center rounded-xl border transition-all duration-200",
          active
            ? "border-cyan/50 bg-cyan/15 text-cyan shadow-[0_0_18px_-4px_rgba(53,214,245,0.6)]"
            : tone === "danger"
              ? "border-danger/30 bg-danger/10 text-danger hover:bg-danger/20"
              : "border-white/[0.09] bg-white/[0.045] text-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-ink",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function MapControls({
  onLocate,
  onRecenter,
  onStartNavigation,
  onOpenLayers,
}: {
  onLocate: () => void;
  onRecenter: () => void;
  onStartNavigation: () => void;
  onOpenLayers: () => void;
}) {
  const mapView = useAppStore((s) => s.mapView);
  const setMapView = useAppStore((s) => s.setMapView);
  const mapTime = useAppStore((s) => s.mapTime);
  const setMapTime = useAppStore((s) => s.setMapTime);
  const showAvatars = useAppStore((s) => s.showAvatars);
  const toggleAvatars = useAppStore((s) => s.toggleAvatars);
  const showLabels = useAppStore((s) => s.showLabels);
  const toggleLabels = useAppStore((s) => s.toggleLabels);
  const showAlerts = useAppStore((s) => s.showAlerts);
  const toggleAlerts = useAppStore((s) => s.toggleAlerts);
  const [zoomPulse, setZoomPulse] = useState(0);

  return (
    <div className="pointer-events-auto">
      {/* Zoom cluster */}
      <div className="panel flex flex-col items-center gap-1 rounded-2xl p-1.5">
        <button
          onClick={() => {
            setZoomPulse((z) => z + 1);
            document.dispatchEvent(new CustomEvent("uac:zoom", { detail: { dir: 1 } }));
          }}
          className="grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:bg-white/[0.08] hover:text-ink"
          aria-label="Zoom avant"
        >
          <Plus size={17} />
        </button>
        <div className="h-px w-5 bg-white/10" />
        <button
          onClick={() => document.dispatchEvent(new CustomEvent("uac:zoom", { detail: { dir: -1 } }))}
          className="grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:bg-white/[0.08] hover:text-ink"
          aria-label="Zoom arrière"
        >
          <Minus size={17} />
        </button>
      </div>

      {/* Primary controls */}
      <div className="panel flex flex-col items-center gap-1 rounded-2xl p-1.5">
        <CtrlButton onClick={onLocate} label="Me localiser">
          <Crosshair size={16} />
        </CtrlButton>
        <CtrlButton onClick={onRecenter} label="Recentrer la caméra">
          <Locate size={16} />
        </CtrlButton>
        <CtrlButton onClick={onStartNavigation} label="Navigation piétonne">
          <Navigation2 size={16} />
        </CtrlButton>
        <div className="h-px w-5 bg-white/10" />
        <CtrlButton onClick={() => setMapView(mapView === "3d" ? "2d" : "3d")} label="Basculer 2D / 3D" active={mapView === "3d"}>
          {mapView === "3d" ? <Box size={16} /> : <MapIcon size={16} />}
        </CtrlButton>
        <CtrlButton onClick={() => setMapTime(mapTime === "day" ? "night" : "day")} label="Mode jour / nuit" active={mapTime === "night"}>
          {mapTime === "day" ? <Sun size={16} /> : <Moon size={16} />}
        </CtrlButton>
        <CtrlButton onClick={onOpenLayers} label="Calques de la carte">
          <Layers size={16} />
        </CtrlButton>
      </div>

      {/* Layer toggles (desktop inline) */}
      <div className="panel hidden flex-col items-center gap-1 rounded-2xl p-1.5 sm:flex">
        <CtrlButton onClick={toggleAvatars} active={showAvatars} label="Radar étudiant">
          <Users size={16} />
        </CtrlButton>
        <CtrlButton onClick={toggleLabels} active={showLabels} label="Étiquettes des bâtiments">
          <Tag size={16} />
        </CtrlButton>
        <CtrlButton onClick={toggleAlerts} active={showAlerts} label="Pins d'alertes">
          <ShieldAlert size={16} />
        </CtrlButton>
      </div>

      {/* 2D / 3D segmented switch */}
      <div className="panel flex items-center rounded-2xl p-1">
        {(["3d", "2d"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setMapView(v)}
            className={cn(
              "rounded-xl px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-wider transition-all",
              mapView === v ? "bg-cyan text-[#04141b]" : "text-muted hover:text-ink",
            )}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LayersPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  const setMapTime = useAppStore((s) => s.setMapTime);
  const mapTime = useAppStore((s) => s.mapTime);

  if (!open) return null;
  return (
    <div className="panel absolute bottom-28 right-3 z-30 w-[260px] rounded-2xl p-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Calques</p>
        <button onClick={onClose} className="text-[11px] text-cyan hover:underline">
          Fermer
        </button>
      </div>
      <div className="space-y-1">
        {[
          { key: "showAvatars" as const, label: "Radar étudiant", icon: Users },
          { key: "showLabels" as const, label: "Étiquettes", icon: Tag },
          { key: "auto2DFallback" as const, label: "Repli 2D automatique", icon: MapIcon },
        ].map((row) => {
          const Icon = row.icon;
          const on = settings[row.key];
          return (
            <button
              key={row.key}
              onClick={() => update({ [row.key]: !on } as never)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.06]"
            >
              <Icon size={14} className={on ? "text-cyan" : "text-muted"} />
              <span className="flex-1 text-[12.5px] text-ink">{row.label}</span>
              <span
                className={cn(
                  "h-4 w-7 rounded-full border transition-colors",
                  on ? "border-cyan/50 bg-cyan/70" : "border-white/15 bg-white/10",
                )}
              >
                <span className={cn("block h-3 w-3 rounded-full bg-white transition-transform", on ? "translate-x-[13px]" : "translate-x-[2px]")} />
              </span>
            </button>
          );
        })}
        <div className="mt-2 border-t border-white/[0.07] pt-2">
          <p className="mb-1.5 px-2 text-[10.5px] uppercase tracking-wider text-muted">Rendu</p>
          <div className="flex gap-1">
            {(["low", "medium", "high"] as const).map((q) => (
              <button
                key={q}
                onClick={() => update({ mapQuality: q })}
                className={cn(
                  "flex-1 rounded-lg py-1.5 text-[11px] font-medium capitalize transition-colors",
                  settings.mapQuality === q ? "bg-cyan/20 text-cyan" : "bg-white/[0.05] text-muted hover:text-ink",
                )}
              >
                {q}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1">
            {(["day", "night"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setMapTime(t)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors",
                  mapTime === t ? "bg-violet/20 text-[#b79cff]" : "bg-white/[0.05] text-muted hover:text-ink",
                )}
              >
                {t === "day" ? <Sun size={11} /> : <Moon size={11} />}
                {t === "day" ? "Jour" : "Nuit"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CompassRose() {
  const mapView = useAppStore((s) => s.mapView);
  return (
    <div className="panel pointer-events-none grid h-11 w-11 place-items-center rounded-full">
      <Compass size={20} className={cn("text-cyan/80 transition-transform duration-700", mapView === "2d" && "rotate-12")} />
      <span className="absolute mt-7 text-[8px] font-bold tracking-wider text-muted">N</span>
    </div>
  );
}

export function TargetBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel flex items-center gap-2 rounded-xl px-3 py-1.5">
      <Target size={13} className="text-cyan" />
      <span className="text-[10.5px] uppercase tracking-wider text-muted">{label}</span>
      <span className="text-[12px] font-semibold text-ink">{value}</span>
    </div>
  );
}
