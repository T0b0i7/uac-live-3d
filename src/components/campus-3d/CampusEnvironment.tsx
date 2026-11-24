"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { CAMPUS_BUILDINGS } from "@/data/buildings";
import {
  CAMPUS_BOUNDARY,
  GEO_BUILDINGS,
  GEO_BOUNDS,
  GEO_FOOTWAYS,
  type GeoRing,
} from "@/data/campus-geo";
import { CAMPUS_STUDENTS } from "@/data/students";
import { hashString } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Terrain                                                             */
/* ------------------------------------------------------------------ */

export function CampusGround({ night, quality }: { night: boolean; quality: "low" | "medium" | "high" }) {
  const cx = (GEO_BOUNDS.minX + GEO_BOUNDS.maxX) / 2;
  const cz = (GEO_BOUNDS.minZ + GEO_BOUNDS.maxZ) / 2;
  const w = GEO_BOUNDS.maxX - GEO_BOUNDS.minX + 400;
  const d = GEO_BOUNDS.maxZ - GEO_BOUNDS.minZ + 400;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.02, cz]} receiveShadow={quality === "high"}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={night ? "#0a1523" : "#123020"} roughness={1} metalness={0} />
      </mesh>

      {/* Emprise officielle du campus, telle que publiée dans OSM.
          C'est l'emprise réelle (31 sommets, 99,37 ha) — pas une zone décorative. */}
      <ShapeFloor
        ring={CAMPUS_BOUNDARY.ring}
        y={0.01}
        color={night ? "#0c1c28" : "#16342a"}
        receiveShadow={quality === "high"}
      />
    </group>
  );
}

/** Aplati un anneau réel au sol — utilisé pour la frontière du campus. */
function ShapeFloor({
  ring,
  y,
  color,
  receiveShadow,
}: {
  ring: GeoRing;
  y: number;
  color: string;
  receiveShadow?: boolean;
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    ring.forEach(([x, z], i) => {
      if (i === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [ring]);

  return (
    <mesh geometry={geometry} position={[0, y, 0]} rotation={[0, Math.PI, 0]} receiveShadow={receiveShadow}>
      <meshStandardMaterial color={color} roughness={0.97} polygonOffset polygonOffsetFactor={-1} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Réseau piéton réel (117 cheminements OSM)                           */
/* ------------------------------------------------------------------ */

const PATH_WIDTH: Record<string, number> = {
  service: 5.5,
  residential: 5,
  path: 3,
  footway: 2.4,
};

/**
 * Rend les cheminements réels d'OpenStreetMap comme des rubans au sol.
 * Tous les segments sont fusionnés en UNE seule géométrie (1 draw call),
 * sinon 117 polylignes coûteraient trop cher.
 */
export function CampusPaths({ night }: { night: boolean }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];

    for (const fw of GEO_FOOTWAYS) {
      const width = PATH_WIDTH[fw.highway ?? "path"] ?? 3;
      const half = width / 2;
      const pts = fw.line;

      for (let i = 0; i < pts.length - 1; i += 1) {
        const [x1, z1] = pts[i];
        const [x2, z2] = pts[i + 1];
        const dx = x2 - x1;
        const dz = z2 - z1;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        // Normale dans le plan, perpendiculaire au segment.
        const nx = (-dz / len) * half;
        const nz = (dx / len) * half;

        // Deux triangles formant le ruban.
        const a = [x1 + nx, x1 - nx];
        const b = [z1 + nz, z1 - nz];
        const c = [x2 + nx, x2 - nx];
        const d = [z2 + nz, z2 - nz];

        positions.push(a[0], 0, b[0], c[0], 0, d[0]);
        positions.push(c[0], 0, d[0], a[0], 0, b[0]);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <mesh geometry={geometry} position={[0, 0.06, 0]} receiveShadow>
      <meshStandardMaterial
        color={night ? "#1a2c3f" : "#2a3f52"}
        roughness={0.88}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </mesh>
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
  const count = quality === "low" ? 90 : quality === "medium" ? 180 : 300;
  const trees = useMemo(() => {
    const rand = seededRandom(9182);
    const out: { x: number; z: number; s: number; r: number }[] = [];

    // Test d'appartenance à une emprise réelle : on rejette les arbres qui
    // tomberaient sur un bâtiment OSM. Un simple test de bbox suffit ici et
    // reste O(n) borné.
    const boxed = GEO_BUILDINGS.map((b) => {
      const xs = b.ring.map((p) => p[0]);
      const zs = b.ring.map((p) => p[1]);
      return {
        minX: Math.min(...xs) - 2,
        maxX: Math.max(...xs) + 2,
        minZ: Math.min(...zs) - 2,
        maxZ: Math.max(...zs) + 2,
      };
    });

    let guard = 0;
    while (out.length < count && guard < count * 30) {
      guard++;
      const x = GEO_BOUNDS.minX + rand() * (GEO_BOUNDS.maxX - GEO_BOUNDS.minX);
      const z = GEO_BOUNDS.minZ + rand() * (GEO_BOUNDS.maxZ - GEO_BOUNDS.minZ);

      const onBuilding = boxed.some(
        (b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ,
      );
      if (onBuilding) continue;
      out.push({ x, z, s: 0.75 + rand() * 0.8, r: rand() * Math.PI });
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

/**
 * Lampadaires posés le long du RÉSEAU PIÉTON RÉEL : on prend un point tous
 * les ~90 m sur les plus longs cheminements OSM. Aucune position inventée.
 */
const LAMP_SPOTS: [number, number][] = (() => {
  const spots: [number, number][] = [];
  const STEP_M = 90;
  for (const fw of GEO_FOOTWAYS) {
    if ((fw.lengthM ?? 0) < 40) continue;
    let travelled = 0;
    for (let i = 0; i < fw.line.length - 1; i += 1) {
      const [x1, z1] = fw.line[i];
      const [x2, z2] = fw.line[i + 1];
      const seg = Math.hypot(x2 - x1, z2 - z1);
      if (seg < 0.01) continue;
      if (travelled + seg >= STEP_M) {
        const t = (STEP_M - travelled) / seg;
        spots.push([x1 + (x2 - x1) * t, z1 + (z2 - z1) * t]);
        travelled = 0;
      } else {
        travelled += seg;
      }
    }
  }
  return spots.slice(0, 60);
})();

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
/* Repères au sol — ancrés sur les emprises réelles                    */
/* ------------------------------------------------------------------ */

/**
 * Aucun objet décoratif n'est inventé ici : le stade, le parking et le
 * château d'eau qui figuraient dans la version de démonstration n'ont pas
 * d'équivalent identifié dans OSM et ont donc été retirés plutôt que
 * d'être maintenus à une position fictive.
 *
 * Ne reste que le liseré de la frontière officielle, tracé à partir des
 * 31 sommets publiés par OSM.
 */
export function CampusProps() {
  return (
    <group>
      <BoundaryOutline />
    </group>
  );
}

/** Tracé au sol de la frontière du campus (donnée OSM réelle). */
function BoundaryOutline() {
  const geometry = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const ring = CAMPUS_BOUNDARY.ring;
    for (let i = 0; i < ring.length; i += 1) {
      const [x1, z1] = ring[i];
      const [x2, z2] = ring[(i + 1) % ring.length];
      pts.push(new THREE.Vector3(x1, 0.12, z1));
      pts.push(new THREE.Vector3(x2, 0.12, z2));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, []);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#35d6f5" transparent opacity={0.5} />
    </lineSegments>
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
