"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CATEGORY_META, CAMPUS_BUILDINGS } from "@/data/buildings";
import {
  CAMPUS_BOUNDARY,
  GEO_BUILDINGS,
  GEO_FOOTWAYS,
  GEO_META,
  OSM_ATTRIBUTION,
} from "@/data/campus-geo";
import { CAMPUS_STUDENTS, STATUS_META } from "@/data/students";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

const PAD = 40;

/**
 * Étendue du référentiel réel, dans le repère local (x = est, z = -nord).
 * On cadre la carte sur la FRONTIÈRE OSM du campus : c'est l'emprise
 * officielle telle que publiée, pas une zone décorative.
 */
const BOUNDS = (() => {
  const xs = CAMPUS_BOUNDARY.ring.map((p) => p[0]);
  const zs = CAMPUS_BOUNDARY.ring.map((p) => p[1]);
  const padM = 60;
  return {
    minX: Math.min(...xs) - padM,
    maxX: Math.max(...xs) + padM,
    minZ: Math.min(...zs) - padM,
    maxZ: Math.max(...zs) + padM,
  };
})();

/** Bâtiment OSM -> repère applicatif (repère vérifié) inversé, pour les liaisons. */
const LANDMARK_BY_OSM = new Map<number, (typeof CAMPUS_BUILDINGS)[number]>(
  CAMPUS_BUILDINGS.filter((b) => b.geo).map((b) => [b.geo!.osmId, b]),
);

export function useCampusTransform(width: number, height: number) {
  return useMemo(() => {
    const w = BOUNDS.maxX - BOUNDS.minX;
    const h = BOUNDS.maxZ - BOUNDS.minZ;
    // Small screens need a closer default framing so labels stay legible.
    const fitBoost = width < 480 ? 1.5 : width < 768 ? 1.2 : 1;
    const scale =
      Math.min((width - PAD * 2) / w, (height - PAD * 2) / h) * fitBoost;
    const offsetX = width / 2 - ((BOUNDS.minX + BOUNDS.maxX) / 2) * scale;
    const offsetY = height / 2 - ((BOUNDS.minZ + BOUNDS.maxZ) / 2) * scale;
    return {
      scale,
      tx: (x: number) => x * scale + offsetX,
      ty: (z: number) => z * scale + offsetY,
    };
  }, [width, height]);
}

/** Convertit un anneau local en points SVG. */
function ringToPoints(ring: [number, number][], t: ReturnType<typeof useCampusTransform>) {
  return ring.map(([x, z]) => `${t.tx(x)},${t.ty(z)}`).join(" ");
}

type Props = {
  onSelectStudent: (id: string) => void;
  interactive?: boolean;
  showRoute?: boolean;
  compact?: boolean;
};

export function CampusMap2D({
  onSelectStudent,
  interactive = true,
  showRoute = true,
  compact = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 1200, h: 760 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );

  const selectedBuildingId = useAppStore((s) => s.selectedBuildingId);
  const hoveredBuildingId = useAppStore((s) => s.hoveredBuildingId);
  const selectBuilding = useAppStore((s) => s.selectBuilding);
  const hoverBuilding = useAppStore((s) => s.hoverBuilding);
  const mapTime = useAppStore((s) => s.mapTime);
  const showAvatars = useAppStore((s) => s.showAvatars);
  const showAlerts = useAppStore((s) => s.showAlerts);
  const showLabels = useAppStore((s) => s.showLabels);
  const route = useAppStore((s) => s.route);
  const alerts = useAppStore((s) => s.alerts);
  const camTarget = useAppStore((s) => s.camTargetBuildingId);

  const night = mapTime === "night";
  const t = useCampusTransform(dims.w, dims.h);

  const alertPins = useMemo(
    () => (showAlerts ? alerts.filter((a) => a.status === "active") : []),
    [alerts, showAlerts],
  );

  const avatars = useMemo(
    () => CAMPUS_STUDENTS.filter((s) => s.privacy !== "ghost").slice(0, 18),
    [],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!interactive) return;
      e.preventDefault();
      setZoom((z) => Math.min(2.4, Math.max(0.65, z - e.deltaY * 0.0012)));
    },
    [interactive],
  );

  const measure = useCallback((node: SVGSVGElement | null) => {
    if (!node) return;
    svgRef.current = node;
    const rect = node.getBoundingClientRect();
    if (rect.width && rect.height) setDims({ w: rect.width, h: rect.height });
  }, []);

  const focused = camTarget ? CAMPUS_BUILDINGS.find((b) => b.id === camTarget) : null;
  const focusTransform = focused
    ? `translate(${dims.w / 2} ${dims.h / 2}) scale(${zoom * 2.1}) translate(${-t.tx(focused.position.x)} ${-t.ty(focused.position.z)})`
    : `translate(${pan.x} ${pan.y}) scale(${zoom})`;

  return (
    <div className="absolute inset-0 overflow-hidden map-backdrop">
      <div className="pointer-events-none absolute inset-0 map-grid-lines opacity-70" />

      <svg
        ref={measure}
        className={cn(
          "relative h-full w-full",
          interactive && "cursor-grab active:cursor-grabbing",
        )}
        viewBox={`0 0 ${dims.w} ${dims.h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        role="img"
        aria-label={`Carte du campus de l'Université d'Abomey-Calavi, emprises bâties issues d'OpenStreetMap (${GEO_META.buildingCount} bâtiments)`}
      >
        <defs>
          <linearGradient id="bld-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={night ? "#16303f" : "#1d3d52"} />
            <stop offset="100%" stopColor={night ? "#0d1f2c" : "#122b3b"} />
          </linearGradient>
          <linearGradient id="bld-sel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a4d66" />
            <stop offset="100%" stopColor="#0f3346" />
          </linearGradient>
          <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern id="grass" width="18" height="18" patternUnits="userSpaceOnUse">
            <rect width="18" height="18" fill={night ? "#0a1c14" : "#123024"} />
            <circle cx="4" cy="5" r="1" fill={night ? "#123024" : "#1a4430"} />
            <circle cx="13" cy="12" r="1" fill={night ? "#123024" : "#1a4430"} />
          </pattern>
        </defs>

        <g
          transform={focusTransform}
          style={{ transition: "transform 600ms cubic-bezier(0.22,1,0.36,1)" }}
        >
          {/* --- Emprise officielle du campus (frontière OSM) --- */}
          <polygon
            points={ringToPoints(CAMPUS_BOUNDARY.ring, t)}
            fill="url(#grass)"
            stroke={night ? "rgba(53,214,245,0.4)" : "rgba(53,214,245,0.6)"}
            strokeWidth={1.6}
            strokeDasharray="7 5"
          />

          {/* --- Réseau piéton réel (117 cheminements OSM) --- */}
          <g>
            {GEO_FOOTWAYS.map((fw) => (
              <polyline
                key={fw.osmId}
                points={ringToPoints(fw.line, t)}
                fill="none"
                stroke={night ? "#1d3346" : "#2b4459"}
                strokeWidth={Math.max(1.1, Math.min(4, (fw.highway === "service" ? 5.5 : 3) * t.scale))}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </g>
          <g>
            {GEO_FOOTWAYS.map((fw) => (
              <polyline
                key={`c-${fw.osmId}`}
                points={ringToPoints(fw.line, t)}
                fill="none"
                stroke={night ? "rgba(53,214,245,0.10)" : "rgba(53,214,245,0.18)"}
                strokeWidth={0.8}
                strokeLinecap="round"
              />
            ))}
          </g>

          {/* --- Emprises bâties réelles (355 bâtiments OSM) --- */}
          <g>
            {GEO_BUILDINGS.map((gb) => {
              const landmark = LANDMARK_BY_OSM.get(gb.osmId);
              const active = landmark ? selectedBuildingId === landmark.id : false;
              const hover = landmark ? hoveredBuildingId === landmark.id : false;
              const color = landmark
                ? CATEGORY_META[landmark.category].color
                : "rgba(148,163,184,0.55)";
              const points = ringToPoints(gb.ring, t);
              return (
                <g key={gb.osmId}>
                  {(active || hover) && (
                    <polygon
                      points={points}
                      fill={color}
                      opacity={0.28}
                      filter="url(#glow)"
                    />
                  )}
                  <polygon
                    points={points}
                    fill={active ? "url(#bld-sel)" : "url(#bld-fill)"}
                    stroke={
                      active
                        ? color
                        : hover
                          ? `${color}`
                          : night
                            ? "rgba(148,163,184,0.30)"
                            : "rgba(148,163,184,0.38)"
                    }
                    strokeWidth={active ? 2.2 : 0.8}
                    strokeLinejoin="round"
                    onPointerEnter={() => interactive && landmark && hoverBuilding(landmark.id)}
                    onPointerLeave={() => interactive && landmark && hoverBuilding(null)}
                    onClick={(e) => {
                      if (!interactive || !landmark) return;
                      e.stopPropagation();
                      selectBuilding(landmark.id);
                    }}
                    style={{ cursor: interactive && landmark ? "pointer" : "default" }}
                  />
                </g>
              );
            })}
          </g>

          {/* --- Route piétonne calculée --- */}
          {showRoute && route && (
            <>
              <polyline
                points={route.points.map((p) => `${t.tx(p.x)},${t.ty(p.z)}`).join(" ")}
                fill="none"
                stroke="#35d6f5"
                strokeWidth={10}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.22}
                filter="url(#glow)"
              />
              <polyline
                points={route.points.map((p) => `${t.tx(p.x)},${t.ty(p.z)}`).join(" ")}
                fill="none"
                stroke="#7ce8ff"
                strokeWidth={3.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="route-dash"
              />
            </>
          )}

          {/* --- Repères nommés (14) sur les plus grandes emprises OSM --- */}
          {showLabels &&
            !compact &&
            CAMPUS_BUILDINGS.map((b) => {
              const active = selectedBuildingId === b.id;
              return (
                <text
                  key={b.id}
                  x={t.tx(b.position.x)}
                  y={t.ty(b.position.z)}
                  textAnchor="middle"
                  fontSize={Math.max(9, 10.5 * Math.min(1.25, t.scale))}
                  fontWeight={700}
                  fill={active ? "#eafaff" : "rgba(226,240,255,0.9)"}
                  style={{
                    paintOrder: "stroke",
                    stroke: night ? "#050c14" : "#08131d",
                    strokeWidth: 3.4,
                    pointerEvents: "none",
                  }}
                >
                  {b.shortName}
                  {b.confidence === "unverified" && " *"}
                </text>
              );
            })}

          {/* --- Pastilles d'alerte communautaire --- */}
          {alertPins.slice(0, 8).map((a) => {
            const b = CAMPUS_BUILDINGS.find((x) => x.id === a.buildingId);
            if (!b) return null;
            const x = t.tx(b.position.x) + b.footprint.w * t.scale * 0.42;
            const y = t.ty(b.position.z) - b.footprint.d * t.scale * 0.42;
            return (
              <g key={a.id} transform={`translate(${x} ${y})`}>
                <circle
                  r={9}
                  fill="#f43f5e"
                  opacity={0.22}
                  className="animate-pulse-ring"
                  style={{ transformOrigin: "center" }}
                />
                <circle r={5} fill="#f43f5e" stroke="#1a0810" strokeWidth={1.2} />
                <circle r={1.6} fill="#fff" />
              </g>
            );
          })}

          {/* --- Étudiants (radar) --- */}
          {showAvatars &&
            avatars.map((s) => {
              const b = CAMPUS_BUILDINGS.find((x) => x.id === s.buildingId);
              if (!b) return null;
              const jitter = (s.radar.x * 2 - 1) * b.footprint.w * 0.35;
              const jitterY = (s.radar.y * 2 - 1) * b.footprint.d * 0.35;
              const x = t.tx(b.position.x + jitter);
              const y = t.ty(b.position.z + jitterY);
              const c = STATUS_META[s.status].color;
              return (
                <g
                  key={s.id}
                  transform={`translate(${x} ${y})`}
                  onClick={(e) => {
                    if (!interactive) return;
                    e.stopPropagation();
                    onSelectStudent(s.id);
                  }}
                  style={{ cursor: interactive ? "pointer" : "default" }}
                >
                  <circle r={7} fill={c} opacity={0.18} />
                  <circle
                    r={4}
                    fill={c}
                    stroke={night ? "#050c14" : "#08131d"}
                    strokeWidth={1.4}
                  />
                </g>
              );
            })}
        </g>
      </svg>

      {/* --- Mention de source : obligatoire pour les données ODbL --- */}
      <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2">
        <span className="rounded-full border border-cyan/25 bg-[#070b14]/80 px-2.5 py-1 text-[10px] font-medium tracking-wide text-muted backdrop-blur-md">
          Emprises réelles OSM · {GEO_META.buildingCount} bâtiments · {OSM_ATTRIBUTION} · ODbL
        </span>
      </div>

      {/* Légende bas-droite */}
      <div className="pointer-events-none absolute bottom-3 right-3 hidden select-none flex-col gap-1.5 rounded-lg border border-white/10 bg-[#070b14]/80 px-3 py-2 text-[10px] text-muted backdrop-blur-md md:flex">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-3 rounded-sm border border-white/40 bg-[#1d3d52]" />
          Emprise bâtie (OSM)
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 bg-[#2b4459]" />
          Cheminement ({GEO_FOOTWAYS.length})
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-cyan/60" />
          Frontière campus ({CAMPUS_BOUNDARY.areaHectares} ha)
        </div>
        <div className="mt-0.5 text-[9px] opacity-70">* repère sans emprise OSM</div>
      </div>
    </div>
  );
}
