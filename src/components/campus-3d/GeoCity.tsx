"use client";

import { useEffect, useMemo, useRef } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Building } from "@/types";
import { CATEGORY_META, CAMPUS_BUILDINGS } from "@/data/buildings";
import { GEO_BUILDINGS, GEO_META, type GeoRing } from "@/data/campus-geo";

/**
 * Rendu 3D des emprises bâties du campus.
 *
 * Les 355 emprises proviennent d'OpenStreetMap (ODbL) et sont EXTRUDÉES
 * telles quelles : ce ne sont pas des boîtes génériques. Chaque anneau
 * réel devient un `THREE.Shape` (avec ses trous), extrudé verticalement
 * à la hauteur estimée du bâtiment.
 *
 * Performance : les 344 emprises non-repères sont fusionnées en UNE géométrie
 * par catégorie (5 draw calls au lieu de 344). Les 11 repères vérifiés sont
 * rendus individuellement pour rester cliquables et étiquetés.
 *
 * Convention de rotation : les points de l'anneau sont (x, z) dans le repère
 * local où z = -nord. On construit le `Shape` en (x, -z) puis on applique une
 * rotation de -π/2 autour de X : un sommet (x, y, z) devient (x, z, -y).
 * Le résultat place donc l'emprise à (x, hauteur, z) — aligné avec la carte 2D.
 */

const ROTATE_X = -Math.PI / 2;

/** Convertit un anneau local (x, z) en `THREE.Shape` posé dans le plan XY. */
function ringToShape(ring: GeoRing, holes: GeoRing[]): THREE.Shape {
  const shape = new THREE.Shape();
  ring.forEach(([x, z], i) => {
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  for (const hole of holes) {
    const path = new THREE.Path();
    hole.forEach(([x, z], i) => {
      if (i === 0) path.moveTo(x, -z);
      else path.lineTo(x, -z);
    });
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

function extrude(ring: GeoRing, holes: GeoRing[], height: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(ringToShape(ring, holes), {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geo.rotateX(ROTATE_X);
  return geo;
}

/** Emprises de fond, fusionnées par catégorie : 1 mesh par catégorie. */
function useMergedFootprints(
  landmarkOsmIds: Set<number>,
  quality: "low" | "medium" | "high",
) {
  return useMemo(() => {
    const byCategory = new Map<string, THREE.BufferGeometry[]>();
    // En qualité basse on n'affiche que les emprises significatives : le rendu
    // reste lisible et le coût GPU chute fortement sur mobile.
    const minArea = quality === "low" ? 40 : quality === "medium" ? 12 : 0;

    for (const gb of GEO_BUILDINGS) {
      if (landmarkOsmIds.has(gb.osmId)) continue;
      if (gb.areaM2 < minArea) continue;
      const geo = extrude(gb.ring, gb.holes, Math.max(1.2, gb.height));
      const list = byCategory.get(gb.category) ?? [];
      list.push(geo);
      byCategory.set(gb.category, list);
    }

    const merged: { category: string; geometry: THREE.BufferGeometry }[] = [];
    for (const [category, list] of byCategory) {
      const m = mergeGeometries(list, false);
      if (m) {
        m.computeVertexNormals();
        merged.push({ category, geometry: m });
      }
      // Libère les géométries unitaires une fois fusionnées.
      for (const g of list) g.dispose();
    }
    return merged;
  }, [landmarkOsmIds, quality]);
}

type GeoCityProps = {
  selectedId: string | null;
  hoveredId: string | null;
  alertIds: Set<string>;
  showLabels: boolean;
  quality: "low" | "medium" | "high";
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
};

/**
 * Scène complète : fond fusionné + repères cliquables.
 * Les couleurs de fond restent sobres pour que les repères et les alertes
 * ressortent — la lisibilité prime sur le spectaculaire.
 */
export function GeoCity({
  selectedId,
  hoveredId,
  alertIds,
  showLabels,
  quality,
  onSelect,
  onHover,
}: GeoCityProps) {
  const landmarks = useMemo(
    () => CAMPUS_BUILDINGS.filter((b) => b.geo),
    [],
  );
  const landmarkOsmIds = useMemo(
    () => new Set(landmarks.map((b) => b.geo!.osmId)),
    [landmarks],
  );

  const merged = useMergedFootprints(landmarkOsmIds, quality);

  // Libération des géométries fusionnées au démontage.
  const mergedRef = useRef(merged);
  mergedRef.current = merged;
  useEffect(
    () => () => {
      for (const m of mergedRef.current) m.geometry.dispose();
    },
    [],
  );

  return (
    <group>
      {/* --- Emprises de fond (344 bâtiments, fusionnées par catégorie) --- */}
      {merged.map((m) => {
        const color = CATEGORY_META[m.category as Building["category"]]?.color ?? "#94a3b8";
        return (
          <mesh
            key={m.category}
            geometry={m.geometry}
            receiveShadow={quality !== "low"}
            castShadow={quality === "high"}
          >
            <meshStandardMaterial
              color="#0e2231"
              roughness={0.82}
              metalness={0.12}
              emissive={color}
              emissiveIntensity={0.045}
            />
          </mesh>
        );
      })}

      {/* --- Repères vérifiés : emprises réelles, cliquables, étiquetés --- */}
      {landmarks.map((b) => (
        <LandmarkMesh
          key={b.id}
          building={b}
          selected={selectedId === b.id}
          hovered={hoveredId === b.id}
          hasAlert={alertIds.has(b.id)}
          showLabel={showLabels}
          quality={quality}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </group>
  );
}

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

type LandmarkProps = {
  building: Building & { geo?: { osmId: number; areaM2: number; osmName: string | null } };
  selected: boolean;
  hovered: boolean;
  hasAlert: boolean;
  showLabel: boolean;
  quality: "low" | "medium" | "high";
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
};

function LandmarkMesh({
  building,
  selected,
  hovered,
  hasAlert,
  showLabel,
  quality,
  onSelect,
  onHover,
}: LandmarkProps) {
  const accent = CATEGORY_META[building.category].color;
  const roof = ROOF_BY_CATEGORY[building.category];
  const h = building.height;

  // Emprise réelle si elle existe, sinon repli sur l'empreinte déclarée
  // (uniquement pour les 3 repères sans géométrie OSM).
  const geometry = useMemo(() => {
    const osmId = building.geo?.osmId;
    if (osmId) {
      const gb = GEO_BUILDINGS.find((g) => g.osmId === osmId);
      if (gb) return extrude(gb.ring, gb.holes, h);
    }
    const w = building.footprint.w;
    const d = building.footprint.d;
    const ring: GeoRing = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ];
    return extrude(ring, [], h);
  }, [building, h]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(building.id);
  };

  return (
    <group position={[0, 0, 0]}>
      {/* L'emprise est déjà en coordonnées locales absolues : pas de translation. */}
      <mesh
        geometry={geometry}
        castShadow={quality === "high"}
        receiveShadow
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(building.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "auto";
        }}
      >
        <meshStandardMaterial
          color={selected ? "#153a52" : hovered ? "#122c3d" : "#10283a"}
          roughness={0.74}
          metalness={0.16}
          emissive={selected || hovered ? accent : "#000000"}
          emissiveIntensity={selected ? 0.16 : hovered ? 0.07 : 0}
        />
      </mesh>

      {/* Filet lumineux au sommet : repérage rapide de jour comme de nuit. */}
      <mesh position={[building.position.x, h + 0.06, building.position.z]}>
        <boxGeometry args={[building.footprint.w * 0.94, 0.09, building.footprint.d * 0.94]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={selected || hovered ? 1.1 : hasAlert ? 0.8 : 0.26}
          toneMapped={false}
        />
      </mesh>

      {/* Balise d'alerte */}
      {hasAlert && (
        <group position={[building.position.x, h + 4.2, building.position.z]}>
          <mesh>
            <sphereGeometry args={[1.15, 16, 16]} />
            <meshStandardMaterial
              color="#f43f5e"
              emissive="#f43f5e"
              emissiveIntensity={2.2}
              toneMapped={false}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]}>
            <ringGeometry args={[1.9, 2.7, 32]} />
            <meshBasicMaterial
              color="#f43f5e"
              transparent
              opacity={0.32}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      )}

      {/* Halo de sélection, posé au sol sous l'emprise */}
      {(selected || hovered) && (
        <mesh
          position={[building.position.x, 0.4, building.position.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry
            args={[
              Math.max(building.footprint.w, building.footprint.d) * 0.62,
              Math.max(building.footprint.w, building.footprint.d) * 0.68,
              48,
            ]}
          />
          <meshBasicMaterial
            color={accent}
            transparent
            opacity={selected ? 0.7 : 0.34}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {showLabel && (quality !== "low" || selected || hovered) && (
        <Text
          position={[building.position.x, h + 6, building.position.z]}
          fontSize={quality === "low" ? 4 : 3.4}
          color="#e9f6ff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.14}
          outlineColor="#04121b"
          fillOpacity={selected || hovered ? 1 : 0.88}
        >
          {building.shortName}
        </Text>
      )}
    </group>
  );
}

/** Mention de source affichée dans l'interface 3D (obligation ODbL). */
export const GEO_ATTRIBUTION = GEO_META.attribution;
