"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, Preload } from "@react-three/drei";
import * as THREE from "three";
import { CAMPUS_BUILDINGS } from "@/data/buildings";
import { useAppStore } from "@/store/useAppStore";
import { CampusBuilding } from "./CampusBuilding";
import {
  AmbientHaze,
  CampusAvatars,
  CampusGround,
  CampusLamps,
  CampusPaths,
  CampusProps,
  CampusTrees,
} from "./CampusEnvironment";
import { CameraRig, Lighting, RoutePath } from "./CameraRig";

type Props = {
  onSelectStudent: (id: string) => void;
};

function SceneContent({ onSelectStudent }: Props) {
  const selectedBuildingId = useAppStore((s) => s.selectedBuildingId);
  const hoveredBuildingId = useAppStore((s) => s.hoveredBuildingId);
  const selectBuilding = useAppStore((s) => s.selectBuilding);
  const hoverBuilding = useAppStore((s) => s.hoverBuilding);
  const showLabels = useAppStore((s) => s.showLabels);
  const showAvatars = useAppStore((s) => s.showAvatars);
  const showAlerts = useAppStore((s) => s.showAlerts);
  const mapTime = useAppStore((s) => s.mapTime);
  const settings = useAppStore((s) => s.settings);
  const route = useAppStore((s) => s.route);
  const camTarget = useAppStore((s) => s.camTargetBuildingId);
  const alerts = useAppStore((s) => s.alerts);

  const night = mapTime === "night";
  const quality = settings.batterySaver ? "low" : settings.mapQuality;

  const alertBuildingIds = useMemo(() => {
    const set = new Set<string>();
    if (showAlerts) {
      alerts.filter((a) => a.status === "active" && a.severity !== "low").forEach((a) => set.add(a.buildingId));
    }
    return set;
  }, [alerts, showAlerts]);

  return (
    <>
      <color attach="background" args={[night ? "#050a12" : "#08131d"]} />
      <Lighting night={night} />
      <CameraRig targetBuildingId={camTarget} trigger={Date.now()} night={night} />

      <Suspense fallback={null}>
        <CampusGround night={night} quality={quality} />
        <CampusPaths night={night} />
        <AmbientHaze night={night} />
        <CampusProps />
        <CampusTrees night={night} quality={quality} />
        <CampusLamps night={night} />

        {CAMPUS_BUILDINGS.map((b) => (
          <CampusBuilding
            key={b.id}
            building={b}
            selected={selectedBuildingId === b.id}
            hovered={hoveredBuildingId === b.id}
            dimmed={false}
            hasAlert={alertBuildingIds.has(b.id)}
            showLabel={showLabels}
            quality={quality}
            onSelect={selectBuilding}
            onHover={hoverBuilding}
          />
        ))}

        <CampusAvatars onSelect={onSelectStudent} disabled={!showAvatars} />
        {route && <RoutePath points={route.points} />}
        <Preload all />
      </Suspense>

      <AdaptiveDpr pixelated />
    </>
  );
}

export function Campus3D({ onSelectStudent }: Props) {
  const mapView = useAppStore((s) => s.mapView);
  const settings = useAppStore((s) => s.settings);
  const selectBuilding = useAppStore((s) => s.selectBuilding);
  const [supported, setSupported] = useState(true);

  // WebGL capability probe → graceful 2D fallback.
  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      setSupported(Boolean(gl));
    } catch {
      setSupported(false);
    }
  }, []);

  const lowPower = settings.batterySaver || settings.mapQuality === "low";
  const dpr: [number, number] = lowPower ? [1, 1.2] : [1, Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1.5)];

  if (mapView === "2d" || !supported) return null;

  return (
    <div className="absolute inset-0" onPointerDown={(e) => e.stopPropagation()}>
      <Canvas
        dpr={dpr}
        shadows={settings.mapQuality === "high" && !settings.batterySaver}
        gl={{
          antialias: !lowPower,
          powerPreference: "high-performance",
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.06,
        }}
        camera={{ position: [150, 178, 205], fov: 42, near: 1, far: 2000 }}
        onPointerMissed={() => selectBuilding(null)}
        frameloop="always"
      >
        <SceneContent onSelectStudent={onSelectStudent} />
      </Canvas>
    </div>
  );
}
