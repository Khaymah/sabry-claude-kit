import { lazy, Suspense } from "react";
import Nav from "./sections/Nav";
import Hero from "./sections/Hero";
import Issues from "./sections/Issues";
import Join from "./sections/Join";
import { useScrollStops } from "./hooks/useScrollStops";
import { usePointer } from "./hooks/usePointer";

// three + R3F load after the HTML content, so text is readable before the 3D arrives.
const Scene = lazy(() => import("./scene/Scene"));

export default function App() {
  const stop = useScrollStops();
  const pointer = usePointer();

  return (
    <>
      {/* Depth glow behind the canvas: separates the dark object from the black page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{ background: "radial-gradient(55% 45% at 50% 70%, rgba(52,58,110,0.42), transparent 72%)" }}
      />
      <Suspense fallback={null}>
        <Scene stop={stop} pointer={pointer} />
      </Suspense>
      <Nav />
      <main className="relative z-10">
        <Hero />
        <Issues />
        <Join />
      </main>
    </>
  );
}
