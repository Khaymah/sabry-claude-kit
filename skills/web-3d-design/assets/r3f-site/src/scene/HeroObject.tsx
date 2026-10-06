import { useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";

type Vec3 = [number, number, number];
type Pose = { pos: Vec3; rot: Vec3; scale: number };

/*
 * One pose per [data-stop] section, in page order. World units at camera z=6, fov 35:
 * the visible height is ~3.78 units, so y = -0.95 sits about three quarters down the screen.
 * Edit these to choreograph the object; the scroll hook interpolates between them.
 */
const DESKTOP: Pose[] = [
  { pos: [0, -0.95, 0], rot: [1.05, 0, 0.35], scale: 0.82 }, // hero: low under the headline, ring tipped toward the viewer
  { pos: [1.55, 0.05, 0], rot: [0.35, 0.75, -0.2], scale: 0.9 }, // issues: right half, three-quarter view
  { pos: [0, 0.62, -0.4], rot: [1.2, 3.6, 0.25], scale: 0.55 }, // join: small, tipped again, above the form
];
const PORTRAIT: Pose[] = [
  { pos: [0, -0.95, 0], rot: [1.05, 0, 0.35], scale: 0.5 },
  { pos: [0, 0.88, -0.6], rot: [0.35, 0.75, -0.2], scale: 0.4 },
  { pos: [0, 0.85, -0.6], rot: [1.2, 3.6, 0.25], scale: 0.42 },
];

const ease = (t: number) => THREE.MathUtils.smoothstep(t, 0, 1);

function sample(poses: Pose[], s: number, out: Pose) {
  const i = Math.max(0, Math.min(Math.floor(s), poses.length - 2));
  const t = ease(THREE.MathUtils.clamp(s - i, 0, 1));
  const a = poses[i];
  const b = poses[i + 1];
  for (let k = 0; k < 3; k++) {
    out.pos[k] = THREE.MathUtils.lerp(a.pos[k], b.pos[k], t);
    out.rot[k] = THREE.MathUtils.lerp(a.rot[k], b.rot[k], t);
  }
  out.scale = THREE.MathUtils.lerp(a.scale, b.scale, t);
}

type Props = {
  stop: RefObject<number>;
  pointer: RefObject<{ x: number; y: number }>;
  reduced: boolean;
};

export default function HeroObject({ stop, pointer, reduced }: Props) {
  const group = useRef<THREE.Group>(null);
  const aspect = useThree((s) => s.viewport.aspect);
  const portrait = aspect < 0.8;
  const poses = portrait ? PORTRAIT : DESKTOP;
  const target = useMemo<Pose>(() => ({ pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 }), []);
  const [radial, tubular] = portrait ? [48, 96] : [96, 192]; // keep phones light

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    sample(poses, stop.current ?? 0, target);

    const dt = Math.min(delta, 0.1); // avoid a jump after a background tab resumes
    const lambda = reduced ? 1000 : 3.5; // reduced motion: follow scroll without easing or drift
    const idle = reduced ? 0 : state.clock.elapsedTime * 0.12;
    const tiltX = reduced ? 0 : (pointer.current?.y ?? 0) * 0.15;
    const tiltY = reduced ? 0 : (pointer.current?.x ?? 0) * 0.25;
    const damp = THREE.MathUtils.damp;

    g.position.set(
      damp(g.position.x, target.pos[0], lambda, dt),
      damp(g.position.y, target.pos[1], lambda, dt),
      damp(g.position.z, target.pos[2], lambda, dt),
    );
    g.rotation.set(
      damp(g.rotation.x, target.rot[0] + tiltX, lambda, dt),
      damp(g.rotation.y, target.rot[1] + idle + tiltY, lambda, dt),
      damp(g.rotation.z, target.rot[2], lambda, dt),
    );
    g.scale.setScalar(damp(g.scale.x, target.scale, lambda, dt));
  });

  // Start at the first pose, slightly smaller, so the load reads as one "arrival" rather than a fly-in.
  const first = poses[0];
  return (
    <group ref={group} position={first.pos} rotation={first.rot} scale={reduced ? first.scale : first.scale * 0.7}>
      <mesh>
        {/* A thick ring, not a sphere: a mirror sphere looks identical from every angle, so rotation and
            scroll choreography would be invisible. Any hero shape must read differently as it turns. */}
        <torusGeometry args={[1, 0.42, radial, tubular]} />
        <MeshDistortMaterial
          distort={0.18}
          speed={reduced ? 0 : 1.2}
          color="#cfd3e6"
          metalness={0.92}
          roughness={0.2}
          iridescence={1}
          iridescenceIOR={1.35}
          iridescenceThicknessRange={[100, 900]}
          clearcoat={1}
          clearcoatRoughness={0.12}
          envMapIntensity={1.3}
        />
      </mesh>
    </group>
  );
}
