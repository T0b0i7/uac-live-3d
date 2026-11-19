"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CATEGORY_META, CAMPUS_BUILDINGS } from "@/data/buildings";
import { CAMPUS_STUDENTS, STATUS_META } from "@/data/students";
import { CAMPUS_BOUNDS } from "@/lib/routing";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

const PAD = 40;

export function useCampusTransform(width: number, height: number) {
  return useMemo(() => {
    const w = CAMPUS_BOUNDS.maxX - CAMPUS_BOUNDS.minX;
    const h = CAMPUS_BOUNDS.maxZ - CAMPUS_BOUNDS.minZ;
    // Small screens need a closer default framing so labels stay legible.
    const fitBoost = width < 480 ? 2.0 : width < 768 ? 1.45 : 1;
    const scale = Math.min((width - PAD * 2) / w, (height - PAD * 2) / h) * fitBoost;
    const offsetX = width / 2 - ((CAMPUS_BOUNDS.minX + CAMPUS_BOUNDS.maxX) / 2) * scale;
    const offsetY = height / 2 - ((CAMPUS_BOUNDS.minZ + CAMPUS_BOUNDS.maxZ) / 2) * scale;
    return {
      scale,
      tx: (x: number) => x * scale + offsetX,
      ty: (z: number) => z * scale + offsetY,
    };
  }, [width, height]);
}

type Props = {
  onSelectStudent: (id: string) => void;
  interactive?: boolean;
  showRoute?: boolean;
  compact?: boolean;
};

export function CampusMap2D({ onSelectStudent, interactive = true, showRoute = true, compact = false }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 1200, h: 760 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

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

  const avatars = useMemo(() => CAMPUS_STUDENTS.filter((s) => s.privacy !== "ghost").slice(0, 18), []);

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
    ? `translate(${dims.w / 2} ${dims.h / 2}) scale(${zoom * 1.55}) translate(${-t.tx(focused.position.x)} ${-t.ty(focused.position.z)})`
    : `translate(${pan.x} ${pan.y}) scale(${zoom})`;

  return (
    <div className="absolute inset-0 overflow-hidden map-backdrop">
      <div className="pointer-events-none absolute inset-0 map-grid-lines opacity-70" />
      {/* radar sweep */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 opacity-[0.16]">
        <div className="radar-sweep h-full w-full rounded-full" />
      </div>

      <svg
        ref={measure}
        className={cn("relative h-full w-full", interactive && "cursor-grab active:cursor-grabbing")}
        viewBox={`0 0 ${dims.w} ${dims.h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        role="img"
        aria-label="Carte 2D du campus UAC (géométrie de démonstration)"
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
          <radialGradient id="ifri-glow">
            <stop offset="0%" stopColor="#35d6f5" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#35d6f5" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g transform={focusTransform} style={{ transition: "transform 600ms cubic-bezier(0.22,1,0.36,1)" }}>
          {/* green zones */}
          {GREEN.map((g, i) => (
            <g key={i}>
              <circle cx={t.tx(g.x)} cy={t.ty(g.z)} r={g.r * t.scale} fill="url(#grass)" />
            </g>
          ))}

          {/* central plaza */}
          <circle cx={t.tx(0)} cy={t.ty(0)} r={56 * t.scale} fill="url(#ifri-glow)" />
          <circle
            cx={t.tx(0)}
            cy={t.ty(0)}
            r={56 * t.scale}
            fill="none"
            stroke={night ? "rgba(53,214,245,0.22)" : "rgba(53,214,245,0.35)"}
            strokeDasharray="6 8"
          />

          {/* pedestrian spine */}
          {PATHS.map((p, i) => (
            <line
              key={i}
              x1={t.tx(p[0])}
              y1={t.ty(p[1])}
              x2={t.tx(p[2])}
              y2={t.ty(p[3])}
              stroke={night ? "#1d3346" : "#2b4459"}
              strokeWidth={Math.max(4, 9 * t.scale)}
              strokeLinecap="round"
            />
          ))}
          {PATHS.map((p, i) => (
            <line
              key={`c-${i}`}
              x1={t.tx(p[0])}
              y1={t.ty(p[1])}
              x2={t.tx(p[2])}
              y2={t.ty(p[3])}
              stroke={night ? "rgba(53,214,245,0.16)" : "rgba(53,214,245,0.3)"}
              strokeWidth={1.4}
              strokeDasharray="4 10"
            />
          ))}

          {/* route */}
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

          {/* stadium pitch */}
          <rect
            x={t.tx(34) - 31 * t.scale}
            y={t.ty(132) - 19 * t.scale}
            width={62 * t.scale}
            height={38 * t.scale}
            rx={6}
            fill={night ? "#0d2b1c" : "#14532d"}
            stroke={night ? "#1e4a34" : "#2f7d4e"}
          />

          {/* buildings */}
          {CAMPUS_BUILDINGS.map((b) => {
            const active = selectedBuildingId === b.id;
            const hover = hoveredBuildingId === b.id;
            const w = b.footprint.w * t.scale;
            const h = b.footprint.d * t.scale;
            const cx = t.tx(b.position.x);
            const cy = t.ty(b.position.z);
            const color = CATEGORY_META[b.category].color;
            return (
              <g
                key={b.id}
                transform={`translate(${cx} ${cy}) rotate(${((b.rotation ?? 0) * 180) / Math.PI})`}
                onPointerEnter={() => interactive && hoverBuilding(b.id)}
                onPointerLeave={() => interactive && hoverBuilding(null)}
                onClick={(e) => {
                  if (!interactive) return;
                  e.stopPropagation();
                  selectBuilding(b.id);
                }}
                style={{ cursor: interactive ? "pointer" : "default" }}
              >
                {(active || hover) && (
                  <rect
                    x={-w / 2 - 9}
                    y={-h / 2 - 9}
                    width={w + 18}
                    height={h + 18}
                    rx={10}
                    fill={color}
                    opacity={0.16}
                    filter="url(#glow)"
                  />
                )}
                {/* extruded side for pseudo-3D depth */}
                <rect x={-w / 2 + 3} y={-h / 2 + 5} width={w} height={h} rx={5} fill={night ? "#050c14" : "#0a1b26"} opacity={0.9} />
                <rect
                  x={-w / 2}
                  y={-h / 2}
                  width={w}
                  height={h}
                  rx={5}
                  fill={active ? "url(#bld-sel)" : "url(#bld-fill)"}
                  stroke={active ? color : hover ? `${color}99` : "rgba(148,163,184,0.28)"}
                  strokeWidth={active ? 2.4 : 1.2}
                />
                {/* roof accent stripe */}
                <rect x={-w / 2} y={-h / 2} width={w} height={3} rx={1.5} fill={color} opacity={active ? 1 : 0.6} />
                {/* window dots */}
                {Array.from({ length: Math.min(14, Math.floor(w / 12)) }).map((_, i, arr) => (
                  <circle
                    key={i}
                    cx={-w / 2 + ((i + 0.5) * w) / arr.length}
                    cy={h / 2 - 8}
                    r={1.8}
                    fill={color}
                    opacity={0.45}
                  />
                ))}
                {showLabels && !compact && (
                  <text
                    x={0}
                    y={-h / 2 - 10}
                    textAnchor="middle"
                    fontSize={Math.max(9.5, 11 * Math.min(1.3, t.scale))}
                    fontWeight={600}
                    fill={active ? "#eafaff" : "rgba(226,240,255,0.82)"}
                    style={{ paintOrder: "stroke", stroke: night ? "#050c14" : "#08131d", strokeWidth: 3 }}
                  >
                    {b.shortName}
                  </text>
                )}
              </g>
            );
          })}

          {/* alert pins */}
          {alertPins.slice(0, 8).map((a) => {
            const b = CAMPUS_BUILDINGS.find((x) => x.id === a.buildingId);
            if (!b) return null;
            const x = t.tx(b.position.x) + b.footprint.w * t.scale * 0.42;
            const y = t.ty(b.position.z) - b.footprint.d * t.scale * 0.42;
            return (
              <g key={a.id} transform={`translate(${x} ${y})`}>
                <circle r={9} fill="#f43f5e" opacity={0.22} className="animate-pulse-ring" style={{ transformOrigin: "center" }} />
                <circle r={5} fill="#f43f5e" stroke="#1a0810" strokeWidth={1.2} />
                <circle r={1.6} fill="#fff" />
              </g>
            );
          })}

          {/* student avatars */}
          {showAvatars &&
            avatars.map((s) => {
              const b = CAMPUS_BUILDINGS.find((x) => x.id === s.buildingId);
              if (!b) return null;
              const jitter = ((s.radar.x * 2 - 1) * b.footprint.w * 0.35);
              const jitterY = ((s.radar.y * 2 - 1) * b.footprint.d * 0.35);
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
                  <circle r={4} fill={c} stroke={night ? "#050c14" : "#08131d"} strokeWidth={1.4} />
                </g>
              );
            })}
        </g>
      </svg>

      {/* demo-data disclaimer */}
      <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2">
        <span className="rounded-full border border-white/10 bg-[#070b14]/70 px-2.5 py-1 text-[10px] font-medium tracking-wide text-muted backdrop-blur-md">
          Carte 2D de démonstration · géométrie non géoréférencée
        </span>
      </div>
    </div>
  );
}

const GREEN = [
  { x: -60, z: 60, r: 34 },
  { x: 96, z: 60, r: 40 },
  { x: -140, z: 20, r: 28 },
  { x: 170, z: -20, r: 32 },
  { x: 10, z: 100, r: 30 },
  { x: -30, z: -110, r: 36 },
  { x: 120, z: -130, r: 26 },
];

const PATHS: [number, number, number, number][] = [
  [-34, 22, 30, 52],
  [-34, 22, 0, 26],
  [-60, -6, -34, 22],
  [-44, -38, -60, -6],
  [-104, -44, -44, -38],
  [-116, 0, -60, -6],
  [-140, -70, -116, 0],
  [-62, 70, -20, 44],
  [-20, 44, 0, 26],
  [30, 52, 34, 104],
  [30, 52, 92, 92],
  [92, 92, 122, 30],
  [122, 30, 150, -70],
  [88, -28, 122, 30],
  [88, -28, 62, -84],
  [0, 26, 62, -84],
  [0, 26, 88, -28],
  [0, 26, -44, -38],
];
