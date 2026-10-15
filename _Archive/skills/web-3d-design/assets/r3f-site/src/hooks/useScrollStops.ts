import { useEffect, useRef } from "react";

/**
 * Continuous "stop" index for the 3D scene: 0 while section 0 is centered in the
 * viewport, 1 when section 1 is centered, 2.5 halfway between sections 2 and 3...
 * Anchored to real [data-stop] elements, so sections can have any height.
 * Stored in a ref (not state) so scrolling never re-renders React.
 */
export function useScrollStops() {
  const stop = useRef(0);

  useEffect(() => {
    let centers: number[] = [];

    const measure = () => {
      centers = Array.from(document.querySelectorAll<HTMLElement>("[data-stop]")).map((el) => {
        const r = el.getBoundingClientRect();
        return r.top + window.scrollY + r.height / 2;
      });
      update();
    };

    const update = () => {
      if (centers.length < 2) return;
      const c = window.scrollY + window.innerHeight / 2;
      if (c <= centers[0]) return void (stop.current = 0);
      for (let i = 0; i < centers.length - 1; i++) {
        if (c <= centers[i + 1]) {
          stop.current = i + (c - centers[i]) / (centers[i + 1] - centers[i]);
          return;
        }
      }
      stop.current = centers.length - 1;
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update);
    };
  }, []);

  return stop;
}
