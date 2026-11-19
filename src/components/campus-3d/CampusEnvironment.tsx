"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { CAMPUS_BUILDINGS } from "@/data/buildings";
import { CAMPUS_STUDENTS } from "@/data/students";
import { CAMPUS_BOUNDS } from "@/lib/routing";
import { hashString } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Terrain                                                             */
/* ------------------------------------------------------------------ */

export function CampusGround({ night, quality }: { night: boolean; quality: "low" | "medium" | "high" }) {
  const size = {
    w: CAMPUS_BOUNDS.maxX - CAMPUS_BOUNDS.minX + 320,
    d: CAMPUS_BOUNDS.maxZ - CAMPUS_BOUNDS.minZ + 320,
  };
  const cx = (CAMPUS_BOUNDS.minX + CAMPUS_BOUNDS.maxX) / 2;
  const cz = (CAMPUS_BOUNDS.minZ + CAMPUS_BOUNDS.maxZ) / 2;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.02, cz]} receiveShadow={quality === "high"}>
        <planeGeometry args={[size.w, size.d]} />
        <meshStandardMaterial color={night ? "#0a1523" : "#123020"} roughness={1} metalness={0} />
      </mesh>

      {/* campus green islands */}
      {GREEN_ZONES.map((g, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[g.x, 0.02, g.z]}>
          <circleGeometry args={[g.r, 28]} />
          <meshStandardMaterial color={night ? "#0c2318" : "#17482c"} roughness={1} />
        </mesh>
      ))}

      {/* base plaza under IFRI */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <circleGeometry args={[56, 48]} />
        <meshStandardMaterial color={night ? "#101f30" : "#1b3244"} roughness={0.9} />
      </mesh>
    </group>
  );
}

const GREEN_ZONES = [
  { x: -60, z: 60, r: 34 },
  { x: 96, z: 60, r: 40 },
  { x: -140, z: 20, r: 28 },
  { x: 170, z: -20, r: 32 },
  { x: 10, z: 100, r: 30 },
  { x: -30, z: -110, r: 36 },
  { x: 120, z: -130, r: 26 },
];

/* ------------------------------------------------------------------ */
/* Pedestrian spine roads                                              */
/* ------------------------------------------------------------------ */

const PATHS: { from: [number, number]; to: [number, number]; width: number }[] = [
  { from: [-34, 22], to: [30, 52], width: 9 },
  { from: [-34, 22], to: [0, 26], width: 11 },
  { from: [-60, -6], to: [-34, 22], width: 8 },
  { from: [-44, -38], to: [-60, -6], width: 7 },
  { from: [-104, -44], to: [-44, -38], width: 7 },
  { from: [-116, 0], to: [-60, -6], width: 7 },
  { from: [-140, -70], to: [-116, 0], width: 6 },
  { from: [-62, 70], to: [-20, 44], width: 6 },
  { from: [-20, 44], to: [0, 26], width: 8 },
  { from: [30, 52], to: [34, 104], width: 8 },
  { from: [30, 52], to: [92, 92], width: 7 },
  { from: [92, 92], to: [122, 30], width: 6 },
  { from: [122, 30], to: [150, -70], width: 7 },
  { from: [88, -28], to: [122, 30], width: 6 },
  { from: [88, -28], to: [62, -84], width: 6 },
  { from: [0, 26], to: [62, -84], width: 6 },
  { from: [0, 26], to: [88, -28], width: 7 },
  { from: [0, 26], to: [-44, -38], width: 6 },
];

export function CampusPaths({ night }: { night: boolean }) {
  const segments = useMemo(
    () =>
      PATHS.map((p) => {
        const dx = p.to[0] - p.from[0];
        const dz = p.to[1] - p.from[1];
        const len = Math.hypot(dx, dz);
        const angle = Math.atan2(dx, dz);
        return {
          pos: [(p.from[0] + p.to[0]) / 2, 0.06, (p.from[1] + p.to[1]) / 2] as [number, number, number],
          len,
          angle,
          width: p.width,
        };
      }),
    [],
  );

  return (
    <group>
      {segments.map((s, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, s.angle]} position={s.pos}>
          <planeGeometry args={[s.width, s.len]} />
          <meshStandardMaterial
            color={night ? "#1a2c3f" : "#2a3f52"}
            roughness={0.85}
            polygonOffset
            polygonOffsetFactor={-2}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Trees + lamps (procedural, count scales with quality)              */
/* ------------------------------------------------------------------ */

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function CampusTrees({ night, quality }: { night: boolean; quality: "low" | "medium" | "high" }) {
  const count = quality === "low" ? 55 : quality === "medium" ? 110 : 190;
  const trees = useMemo(() => {
    const rand = seededRandom(9182);
    const out: { x: number; z: number; s: number; r: number }[] = [];
    let guard = 0;
    while (out.length < count && guard < count * 40) {
      guard++;
      const x = CAMPUS_BOUNDS.minX + rand() * (CAMPUS_BOUNDS.maxX - CAMPUS_BOUNDS.minX);
      const z = CAMPUS_BOUNDS.minZ + rand() * (CAMPUS_BOUNDS.maxZ - CAMPUS_BOUNDS.minZ);
      // Keep trees off buildings and main plaza.
      const onBuilding = CAMPUS_BUILDINGS.some((b) => {
        const pad = 14;
        return (
          Math.abs(x - b.position.x) < b.footprint.w / 2 + pad &&
          Math.abs(z - b.position.z) < b.footprint.d / 2 + pad
        );
      });
      if (onBuilding) continue;
      if (Math.hypot(x, z) < 46) continue;
      out.push({ x, z, s: 0.72 + rand() * 0.7, r: rand() * Math.PI });
    }
    return out;
  }, [count]);

  return (
    <group>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} rotation={[0, t.r, 0]} scale={t.s}>
          <mesh position={[0, 1.4, 0]}>
            <cylinderGeometry args={[0.34, 0.46, 2.8, 6]} />
            <meshStandardMaterial color="#3b2a1c" roughness={1} />
          </mesh>
          <mesh position={[0, 4.2, 0]} castShadow={quality === "high"}>
            <icosahedronGeometry args={[2.5, 0]} />
            <meshStandardMaterial color={night ? "#0e3a26" : "#1c6b3d"} roughness={0.95} flatShading />
          </mesh>
          <mesh position={[1.2, 3.3, 0.7]}>
            <icosahedronGeometry args={[1.5, 0]} />
            <meshStandardMaterial color={night ? "#123f2a" : "#227d47"} roughness={0.95} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const LAMP_SPOTS: [number, number][] = [
  [-34, 22], [0, 26], [-60, -6], [30, 52], [92, 92], [122, 30], [88, -28], [62, -84],
  [-44, -38], [-116, 0], [-62, 70], [34, 104], [150, -70], [-20, 44], [-140, -70],
];

export function CampusLamps({ night }: { night: boolean }) {
  return (
    <group>
      {LAMP_SPOTS.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 3, 0]}>
            <cylinderGeometry args={[0.13, 0.17, 6, 6]} />
            <meshStandardMaterial color="#26374a" metalness={0.7} roughness={0.4} />
          </mesh>
          <mesh position={[0, 6.2, 0]}>
            <sphereGeometry args={[0.42, 10, 10]} />
            <meshStandardMaterial
              color={night ? "#cdefff" : "#7d94a8"}
              emissive={night ? "#8fdcff" : "#000000"}
              emissiveIntensity={night ? 2.4 : 0}
              toneMapped={false}
            />
          </mesh>
          {night && (
            <pointLight position={[0, 6, 0]} color="#9fe4ff" intensity={9} distance={34} decay={2} />
          )}
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Ambient campus "campus life" props                                  */
/* ------------------------------------------------------------------ */

export function CampusProps() {
  return (
    <group>
      {/* stadium pitch */}
      <group position={[34, 0.06, 132]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[62, 38]} />
          <meshStandardMaterial color="#14532d" roughness={1} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[9, 9.6, 40]} />
          <meshBasicMaterial color="#eaf6ff" transparent opacity={0.35} />
        </mesh>
      </group>

      {/* parking deck near amphis */}
      <group position={[104, 0.07, -104]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[46, 26]} />
          <meshStandardMaterial color="#152435" roughness={0.9} />
        </mesh>
        {Array.from({ length: 10 }).map((_, i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[-20 + i * 4.4, 0.01, 0]}>
            <planeGeometry args={[0.3, 22]} />
            <meshBasicMaterial color="#7f93a8" transparent opacity={0.35} />
          </mesh>
        ))}
      </group>

      {/* water tower landmark */}
      <group position={[-186, 0, 64]}>
        <mesh position={[0, 9, 0]}>
          <cylinderGeometry args={[3.4, 4.6, 18, 8]} />
          <meshStandardMaterial color="#1c3245" metalness={0.4} roughness={0.6} />
        </mesh>
        <mesh position={[0, 19.4, 0]}>
          <sphereGeometry args={[5.4, 18, 14]} />
          <meshStandardMaterial color="#26455e" metalness={0.5} roughness={0.45} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Student radar avatars (3D)                                          */
/* ------------------------------------------------------------------ */

export function CampusAvatars({
  onSelect,
  disabled,
}: {
  onSelect: (studentId: string) => void;
  disabled: boolean;
}) {
  const visible = CAMPUS_STUDENTS.filter((s) => s.privacy !== "ghost").slice(0, 16);
  if (disabled) return null;

  return (
    <group>
      {visible.map((s) => {
        const b = CAMPUS_BUILDINGS.find((x) => x.id === s.buildingId);
        if (!b) return null;
        const h = hashString(s.id);
        const angle = (h % 360) * (Math.PI / 180);
        const radius = 10 + ((h >> 3) % 20);
        const x = b.position.x + Math.cos(angle) * (b.footprint.w / 2 + radius * 0.6);
        const z = b.position.z + Math.sin(angle) * (b.footprint.d / 2 + radius * 0.6);
        const color =
          s.status === "in-class" ? "#8B5CF6"
            : s.status === "studying" ? "#35D6F5"
              : s.status === "on-break" ? "#F59E0B"
                : s.status === "available" ? "#22C55E"
                  : "#F43F5E";
        return (
          <group
            key={s.id}
            position={[x, 0, z]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(s.id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              document.body.style.cursor = "auto";
            }}
          >
            <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[2.4, 3.1, 24]} />
              <meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 5.4, 0]}>
              <sphereGeometry args={[1.9, 16, 16]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} toneMapped={false} />
            </mesh>
            <mesh position={[0, 9.2, 0]}>
              <coneGeometry args={[0.85, 1.8, 12]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} />
            </mesh>
            <mesh position={[0, 4, 0]}>
              <cylinderGeometry args={[0.06, 0.06, 4.4, 5]} />
              <meshBasicMaterial color={color} transparent opacity={0.35} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Night ambient haze discs                                            */
/* ------------------------------------------------------------------ */

export function AmbientHaze({ night }: { night: boolean }) {
  if (!night) return null;
  return (
    <group>
      {CAMPUS_BUILDINGS.slice(0, 8).map((b, i) => (
        <mesh key={b.id} rotation={[-Math.PI / 2, 0, 0]} position={[b.position.x, 0.09, b.position.z]}>
          <circleGeometry args={[Math.max(b.footprint.w, b.footprint.d) * 0.95, 26]} />
          <meshBasicMaterial color={i % 2 ? "#35d6f5" : "#8b5cf6"} transparent opacity={0.045} />
        </mesh>
      ))}
    </group>
  );
}
