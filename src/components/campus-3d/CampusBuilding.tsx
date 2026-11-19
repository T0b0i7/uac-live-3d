"use client";

import { useMemo, useRef, useState } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import type { Building } from "@/types";
import { CATEGORY_META } from "@/data/buildings";

type Props = {
  building: Building;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
  hasAlert: boolean;
  showLabel: boolean;
  quality: "low" | "medium" | "high";
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
};

const ROOF_BY_CATEGORY: Record<Building["category"], string> = {
  academic: "#1d4f6b",
  administration: "#3b2a63",
  amphitheatre: "#4b3a7a",
  library: "#1b4b3a",
  food: "#5c3d16",
  residence: "#5b2340",
  sports: "#154158",
  service: "#4a3a12",
};

export function CampusBuilding({
  building,
  selected,
  hovered,
  dimmed,
  hasAlert,
  showLabel,
  quality,
  onSelect,
  onHover,
}: Props) {
  const [hoverText, setHoverText] = useState(false);
  const group = useRef<THREE.Group>(null);

  const accent = CATEGORY_META[building.category].color;
  const roof = ROOF_BY_CATEGORY[building.category];
  const { w, d } = building.footprint;
  const h = building.height;

  // Window rows are procedural — an instanced-ish grid of small emissive quads.
  const windows = useMemo(() => {
    const floors = Math.max(1, building.floors);
    const perSide = quality === "low" ? 3 : quality === "medium" ? 5 : 7;
    const out: { pos: [number, number, number]; rot: number; lit: boolean }[] = [];
    const floorH = h / floors;
    for (let f = 0; f < floors; f++) {
      const y = floorH * (f + 0.55);
      for (let i = 0; i < perSide; i++) {
        const t = (i + 0.5) / perSide;
        const x = -w / 2 + t * w;
        const z = -d / 2 + t * d;
        const lit = ((f * 7 + i * 3 + building.accentIndex) % 5) < 3;
        out.push({ pos: [x, y, d / 2 + 0.06], rot: 0, lit });
        out.push({ pos: [x, y, -d / 2 - 0.06], rot: Math.PI, lit });
        out.push({ pos: [w / 2 + 0.06, y, z], rot: Math.PI / 2, lit: !lit });
        out.push({ pos: [-w / 2 - 0.06, y, z], rot: -Math.PI / 2, lit: !lit });
      }
    }
    return out;
  }, [building.accentIndex, building.floors, d, h, quality, w]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(building.id);
  };

  return (
    <group
      ref={group}
      position={[building.position.x, 0, building.position.z]}
      rotation={[0, building.rotation ?? 0, 0]}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(building.id);
        setHoverText(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        onHover(null);
        setHoverText(false);
        document.body.style.cursor = "auto";
      }}
    >
      {/* plinth / ground slab */}
      <mesh position={[0, 0.15, 0]} receiveShadow={quality === "high"}>
        <boxGeometry args={[w + 6, 0.3, d + 6]} />
        <meshStandardMaterial color="#0f1c2c" roughness={0.95} metalness={0.05} />
      </mesh>

      {/* main volume */}
      <mesh position={[0, h / 2 + 0.3, 0]} castShadow={quality === "high"} receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={selected ? "#153a52" : hovered ? "#122c3d" : "#0e2231"}
          roughness={0.72}
          metalness={0.18}
          emissive={selected ? accent : hovered ? accent : "#000000"}
          emissiveIntensity={selected ? 0.14 : hovered ? 0.06 : 0}
        />
      </mesh>

      {/* roof cap */}
      <mesh position={[0, h + 0.3 + 0.35, 0]} castShadow={quality === "high"}>
        <boxGeometry args={[w + 2.5, 0.7, d + 2.5]} />
        <meshStandardMaterial color={roof} roughness={0.6} metalness={0.28} />
      </mesh>

      {/* accent trim line for wayfinding */}
      <mesh position={[0, h + 0.3 + 0.05, 0]}>
        <boxGeometry args={[w + 3.2, 0.12, d + 3.2]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={selected || hovered ? 1.1 : hasAlert ? 0.75 : 0.25}
          toneMapped={false}
        />
      </mesh>

      {/* windows */}
      {windows.map((win, i) => (
        <mesh key={i} position={win.pos} rotation={[0, win.rot, 0]}>
          <planeGeometry args={[1.15, 0.8]} />
          <meshStandardMaterial
            color={win.lit ? "#8fe6ff" : "#0a1826"}
            emissive={win.lit ? "#4fd6f0" : "#000000"}
            emissiveIntensity={win.lit ? 0.85 : 0}
            roughness={0.4}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* entrance canopy */}
      <mesh position={[0, 2.2, d / 2 + 2.2]} castShadow={false}>
        <boxGeometry args={[Math.min(12, w * 0.4), 0.25, 4.4]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} toneMapped={false} />
      </mesh>

      {/* alert beacon */}
      {hasAlert && (
        <group position={[w / 2 - 2, h + 3.4, d / 2 - 2]}>
          <mesh>
            <sphereGeometry args={[1.05, 16, 16]} />
            <meshStandardMaterial color="#f43f5e" emissive="#f43f5e" emissiveIntensity={2.2} toneMapped={false} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, 0]}>
            <ringGeometry args={[1.8, 2.6, 32]} />
            <meshBasicMaterial color="#f43f5e" transparent opacity={0.32} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}

      {/* selection halo */}
      {(selected || hovered) && (
        <mesh position={[0, 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(w, d) * 0.72, Math.max(w, d) * 0.78, 48]} />
          <meshBasicMaterial color={accent} transparent opacity={selected ? 0.7 : 0.34} side={THREE.DoubleSide} />
        </mesh>
      )}

      {showLabel && (quality !== "low" || selected || hovered) && (
        <Text
          position={[0, h + 5.2, 0]}
          fontSize={quality === "low" ? 3.4 : 3}
          color="#e9f6ff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.12}
          outlineColor="#04121b"
          fillOpacity={selected || hoverText || dimmed ? 1 : 0.86}
        >
          {building.shortName}
        </Text>
      )}
    </group>
  );
}
