import { memo } from "react";
import { useVideoFade } from "../hooks/useVideoFade";

export const HERO_VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_115001_bcdaa3b4-03de-47e7-ad63-ae3e392c32d4.mp4";

type BackgroundVideoProps = {
  src?: string;
};

/**
 * Full-viewport background video. Memoized so typing in the hero's inputs never
 * re-renders it. Shifted down 17% because this clip's interesting content sits
 * low in the frame; overflow-hidden on the parent clips the bottom.
 */
function BackgroundVideo({ src = HERO_VIDEO_SRC }: BackgroundVideoProps) {
  const { videoRef, handlers } = useVideoFade();

  return (
    <video
      ref={videoRef}
      src={src}
      className="absolute inset-0 h-full w-full object-cover translate-y-[17%]"
      style={{ opacity: 0 }}
      autoPlay
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
      {...handlers}
    />
  );
}

export default memo(BackgroundVideo);
