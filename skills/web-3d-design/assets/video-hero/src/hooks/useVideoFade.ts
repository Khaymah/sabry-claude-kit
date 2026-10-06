import { useCallback, useEffect, useRef } from "react";

const FADE_MS = 500; // length of every fade, in and out
const FADE_OUT_LEAD_S = 0.55; // start fading out this many seconds before the end
const RESTART_DELAY_MS = 100; // black gap between "ended" and the restart

/**
 * Seamless looping for a background <video> using requestAnimationFrame fades
 * (no CSS transitions). Spread `handlers` on the video and do NOT set `loop`:
 * the native loop attribute stops `ended` from firing, which this relies on.
 */
export function useVideoFade() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false); // guards against repeated timeupdate events
  const restartTimerRef = useRef<number | null>(null);

  const cancelFade = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const fadeTo = useCallback(
    (target: number) => {
      const video = videoRef.current;
      if (!video) return;
      cancelFade(); // a new fade always replaces the running one

      // Resume from wherever the opacity is now instead of snapping.
      const from = Number.parseFloat(video.style.opacity || "0");
      const start = performance.now();

      const tick = (now: number) => {
        const t = Math.min((now - start) / FADE_MS, 1);
        video.style.opacity = String(from + (target - from) * t);
        rafRef.current = t < 1 ? requestAnimationFrame(tick) : null;
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [cancelFade],
  );

  const onLoadedData = useCallback(() => {
    fadingOutRef.current = false;
    void videoRef.current?.play().catch(() => {});
    fadeTo(1);
  }, [fadeTo]);

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || fadingOutRef.current) return;
    const { duration, currentTime } = video;
    if (Number.isFinite(duration) && duration - currentTime <= FADE_OUT_LEAD_S) {
      fadingOutRef.current = true;
      fadeTo(0);
    }
  }, [fadeTo]);

  const onEnded = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    cancelFade();
    video.style.opacity = "0";
    if (restartTimerRef.current !== null) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      video.currentTime = 0;
      void video.play().catch(() => {});
      fadingOutRef.current = false;
      fadeTo(1);
    }, RESTART_DELAY_MS);
  }, [cancelFade, fadeTo]);

  useEffect(() => {
    // Cached video can be ready before the first render commits; don't leave it invisible.
    const video = videoRef.current;
    if (video && video.readyState >= 2 && video.style.opacity === "0") onLoadedData();

    return () => {
      cancelFade();
      if (restartTimerRef.current !== null) clearTimeout(restartTimerRef.current);
    };
  }, [cancelFade, onLoadedData]);

  return { videoRef, handlers: { onLoadedData, onTimeUpdate, onEnded } };
}
