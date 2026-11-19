"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { BUILDING_BY_ID } from "@/data/buildings";
import type { Vec2 } from "@/types";

type Props = {
  targetBuildingId: string | null;
  trigger: number;
  night: boolean;
};

/**
 * Camera rig: smooth cinematic fly-to when a building is focused,
 * otherwise user-controlled orbit. Uses damped lerp so it never snaps.
 */
export function CameraRig({ targetBuildingId, trigger, night }: Props) {
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl | null>(null);
  const anim = useRef<{
    active: boolean;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
  }>({
    active: false,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
    t: 0,
  });

  useEffect(() => {
    if (!targetBuildingId) return;
    const b = BUILDING_BY_ID.get(targetBuildingId);
    if (!b) return;

    const toTarget = new THREE.Vector3(b.position.x, b.height * 0.5, b.position.z);
    const dir = new THREE.Vector3(0.62, 0.86, 0.62).normalize();
    const dist = Math.max(b.footprint.w, b.footprint.d) * 1.5 + 92;
    const toPos = toTarget.clone().add(dir.multiplyScalar(dist));

    anim.current = {
      active: true,
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.current ? controls.current.target.clone() : new THREE.Vector3(),
      toTarget,
      t: 0,
    };
  }, [targetBuildingId, trigger, camera]);

  // Damped interpolation each frame.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const a = anim.current;
      if (a.active && controls.current) {
        a.t = Math.min(1, a.t + 0.028);
        const e = 1 - Math.pow(1 - a.t, 3); // easeOutCubic
        camera.position.lerpVectors(a.fromPos, a.toPos, e);
        controls.current.target.lerpVectors(a.fromTarget, a.toTarget, e);
        controls.current.update();
        if (a.t >= 1) a.active = false;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [camera]);

  const fog = night ? "#050a12" : "#0a1a24";

  return (
    <>
      <OrbitControls
        ref={controls as never}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.55}
        zoomSpeed={0.8}
        panSpeed={0.7}
        minDistance={38}
        maxDistance={520}
        maxPolarAngle={Math.PI / 2.22}
        minPolarAngle={0.18}
        target={[0, 8, 0]}
        screenSpacePanning={false}
      />
      <fog attach="fog" args={[fog, 300, 1000]} />
    </>
  );
}

export function Lighting({ night }: { night: boolean }) {
  return (
    <>
      <hemisphereLight
        args={[night ? "#1b3a5c" : "#a8d8ff", night ? "#04080f" : "#173a2a", night ? 0.42 : 0.95]}
      />
      <ambientLight intensity={night ? 0.22 : 0.5} color={night ? "#2a4a6a" : "#dff3ff"} />
      <directionalLight
        position={night ? [-160, 180, -120] : [180, 260, 140]}
        intensity={night ? 0.55 : 2.4}
        color={night ? "#7fb4e6" : "#fff6e8"}
        castShadow={!night}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-420}
        shadow-camera-right={420}
        shadow-camera-top={420}
        shadow-camera-bottom={-420}
        shadow-camera-far={900}
        shadow-bias={-0.0008}
      />
      {night && (
        <directionalLight position={[120, 90, 160]} intensity={0.3} color="#8b5cf6" />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Navigation route ribbon                                          */
/* ---------------------------------------------------------------- */

export function RoutePath({ points }: { points: Vec2[] }) {
  const geometry = useRef<THREE.BufferGeometry>(null);

  useEffect(() => {
    if (!geometry.current || points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(p.x, 0.55, p.z)),
      false,
      "catmullrom",
      0.15,
    );
    const pts = curve.getPoints(Math.max(40, points.length * 16));
    geometry.current.setFromPoints(pts);
    geometry.current.attributes.position && (geometry.current.attributes.position.needsUpdate = true);
    geometry.current.computeBoundingSphere();
  }, [points]);

  return (
    <group>
      {/* glow underlay */}
      <line>
        <bufferGeometry ref={geometry} />
        <lineBasicMaterial color="#35d6f5" transparent opacity={0.28} linewidth={2} />
      </line>
      {/* tube for volumetric feel */}
      <RouteTube points={points} />
      {/* destination marker */}
      {points.length > 0 && (
        <group position={[points[points.length - 1]!.x, 0, points[points.length - 1]!.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
            <ringGeometry args={[4.5, 6.6, 40]} />
            <meshBasicMaterial color="#35d6f5" transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 9, 0]}>
            <cylinderGeometry args={[0.16, 1.2, 18, 12, 1, true]} />
            <meshBasicMaterial color="#35d6f5" transparent opacity={0.14} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function RouteTube({ points }: { points: Vec2[] }) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x, 0.5, p.z)),
    false,
    "catmullrom",
    0.15,
  );
  return (
    <mesh>
      <tubeGeometry args={[curve, Math.max(48, points.length * 20), 0.85, 8, false]} />
      <meshBasicMaterial color="#35d6f5" transparent opacity={0.95} toneMapped={false} />
    </mesh>
  );
}
