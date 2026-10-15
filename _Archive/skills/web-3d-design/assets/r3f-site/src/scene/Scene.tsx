import { Suspense, useState, type RefObject } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import HeroObject from "./HeroObject";
import Studio from "./Studio";
import { hasWebGL } from "./webgl";
import { useReducedMotion } from "../hooks/useReducedMotion";

type Props = {
  stop: RefObject<number>;
  pointer: RefObject<{ x: number; y: number }>;
};

/**
 * Fixed full-viewport canvas behind the page. pointer-events: none keeps every
 * DOM control clickable; pointer and scroll come in through refs instead.
 */
export default function Scene({ stop, pointer }: Props) {
  const reduced = useReducedMotion();
  const [webgl] = useState(hasWebGL);
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio, 1.5));

  if (!webgl) return <StaticFallback />;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0">
      <Canvas
        dpr={dpr}
        camera={{ position: [0, 0, 6], fov: 35 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        fallback={<StaticFallback />}
      >
        <PerformanceMonitor
          onIncline={() => setDpr(Math.min(window.devicePixelRatio, 2))}
          onDecline={() => setDpr(1)}
        />
        <Suspense fallback={null}>
          <Studio />
          <HeroObject stop={stop} pointer={pointer} reduced={reduced} />
        </Suspense>
      </Canvas>
    </div>
  );
}

/** Shown when WebGL is unavailable: a tipped iridescent ring in CSS, placed like the 3D ring's first pose. */
function StaticFallback() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden [perspective:900px]">
      <div
        className="absolute left-1/2 top-[74%] aspect-square w-[min(44vh,62vw)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-90"
        style={{
          background: "conic-gradient(from 210deg, #cfd3e6, #5a6dff, #1a1d3a, #ffb8d2, #a9c8ff, #cfd3e6)",
          mask: "radial-gradient(circle, transparent 41%, #000 42%, #000 69%, transparent 70%)",
          WebkitMask: "radial-gradient(circle, transparent 41%, #000 42%, #000 69%, transparent 70%)",
          transform: "rotateX(62deg) rotateZ(-18deg)",
        }}
      />
    </div>
  );
}
