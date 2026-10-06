/**
 * Aurora Dark UI — Tailwind preset (v3 `presets: [...]`, or port to v4 @theme).
 * Pair with tokens.css for the signature utilities (.edge-light, .surface-card, .aurora*, .glow).
 */
module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        frame: "#05070A",
        canvas: "#0C1015",
        sidebar: "#13171C",
        surface: { DEFAULT: "#1A1E23", top: "#2A2E31", inset: "#161A1E", raised: "#22262B" },
        bubble: "#191D21",
        input: "#05060F",
        track: "#34383D",
        ink: { DEFAULT: "#F3F4F6", secondary: "#B4B8BF", tertiary: "#8A8F97", muted: "#5E636B", onlight: "#16161C" },
        violet: { DEFAULT: "#6A5AE0", soft: "#B379E1" },
        amber: { DEFAULT: "#F49514", soft: "#E8C17E" },
        green: { DEFAULT: "#6BBF72", vivid: "#14EB78" },
        blue: { DEFAULT: "#68B3EC", strong: "#2F6FDB", soft: "#77A3E2" },
        coral: "#ED7572",
        danger: "#D33A3A",
      },
      borderColor: {
        subtle: "rgba(255,255,255,0.06)",
        DEFAULT: "rgba(255,255,255,0.10)",
        strong: "rgba(255,255,255,0.16)",
      },
      backgroundImage: {
        aurora: "linear-gradient(90deg,#7BA9EC 0%,#A9C0EA 20%,#ECE1E9 44%,#FDD0D8 60%,#FE9FC1 82%,#F5A9CA 100%)",
        "aurora-card": "linear-gradient(115deg,#67A5F7 0%,#C9E0F8 26%,#FFFFFF 48%,#FEF8F5 70%,#FFD6C8 100%)",
        "aurora-orb": "radial-gradient(circle at 32% 28%,#FFFFFF 0%,#FBD9D4 32%,#F4A39C 62%,#A8C4F5 100%)",
        card: "linear-gradient(180deg,#2A2E31 0%,#1A1E23 60%)",
        row: "linear-gradient(180deg,#1C2025 0%,#14181C 100%)",
      },
      borderRadius: { xs: "6px", sm: "10px", md: "12px", lg: "16px", xl: "22px", "2xl": "28px" },
      fontFamily: {
        sans: ["Poppins", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
        arabic: ["IBM Plex Sans Arabic", "Poppins", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["11px", "1.4"], xs: ["12px", "1.45"], sm: ["13px", "1.45"], md: ["14px", "1.5"],
        lg: ["16px", "1.35"], xl: ["18px", "1.3"], "2xl": ["24px", "1.25"], stat: ["34px", "1"],
      },
      boxShadow: {
        frame: "0 40px 90px rgba(0,0,0,0.35)",
        card: "inset 0 1px 0 rgba(255,255,255,0.04)",
        composer:
          "-14px 0 36px -10px rgba(104,160,240,0.45), 14px 0 36px -10px rgba(240,140,160,0.40), 0 -10px 30px -14px rgba(240,140,160,0.30)",
        "glow-blue": "0 0 10px rgba(104,179,236,0.55)",
        "glow-coral": "0 0 10px rgba(237,117,114,0.55)",
        "glow-amber": "0 0 10px rgba(244,149,20,0.55)",
      },
      spacing: { sidebar: "220px", aside: "330px", topbar: "76px" },
      transitionTimingFunction: { out: "cubic-bezier(0.22,1,0.36,1)" },
      transitionDuration: { fast: "140ms", base: "200ms", slow: "320ms" },
    },
  },
};
