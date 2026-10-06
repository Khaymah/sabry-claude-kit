/**
 * Moonflower Cosmetics — Tailwind preset.
 * Use with `dir="rtl"` on <html> and Tailwind's logical utilities (ms-*, me-*, ps-*, pe-*, start-*, end-*).
 * Import tokens.css as well for .mf-arch, .mf-wave-bottom, and the direction-aware card shadow.
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#F6F3FF", 100: "#E0DDEA", 200: "#DAD6E3", 300: "#CBC5DB",
          400: "#968AB6", 500: "#7566A0", 600: "#5F4E91", 700: "#4A3C78",
          DEFAULT: "#7566A0",
        },
        ink: "#1B1A1A",
        stone: "#6B6765",
        pebble: "#B5B2B0",
        rating: { DEFAULT: "#F88820", strong: "#D66A00" },
      },
      fontFamily: {
        sans: ["Tajawal", "IBM Plex Sans Arabic", "Segoe UI", "Tahoma", "sans-serif"],
        latin: ["Inter", "Helvetica Neue", "Arial", "sans-serif"],
      },
      fontSize: {
        label: ["14px", { lineHeight: "1", fontWeight: "700" }],
        small: ["16px", { lineHeight: "1.7" }],
        body: ["18px", { lineHeight: "1.7" }],
        subtitle: ["20px", { lineHeight: "1.6" }],
        nav: ["20px", { lineHeight: "1.3", fontWeight: "700" }],
        title: ["24px", { lineHeight: "1.4", fontWeight: "700" }],
        lead: ["24px", { lineHeight: "1.75" }],
        "lead-xl": ["32px", { lineHeight: "1.9" }],
        h3: ["34px", { lineHeight: "1.5", fontWeight: "700" }],
        h2: ["40px", { lineHeight: "1.4", fontWeight: "800" }],
        display: ["44px", { lineHeight: "1.5", fontWeight: "800" }],
      },
      borderRadius: { sm: "8px", md: "16px", lg: "24px", xl: "40px" },
      boxShadow: {
        // RTL default (shadow falls left). Use `ltr:shadow-card-ltr` for LTR pages.
        card: "-6px 8px 14px -4px rgba(117,102,160,0.32), 0 1px 0 rgba(117,102,160,0.06)",
        "card-ltr": "6px 8px 14px -4px rgba(117,102,160,0.32), 0 1px 0 rgba(117,102,160,0.06)",
        "card-hover": "-10px 14px 24px -6px rgba(117,102,160,0.38)",
        ring: "0 0 0 5px #7566A0",
      },
      dropShadow: { heading: "0 4px 4px rgba(0,0,0,0.18)" },
      maxWidth: { container: "1200px" },
      spacing: { section: "120px", "title-gap": "64px", topbar: "64px", navbar: "68px" },
      transitionTimingFunction: { mf: "cubic-bezier(0.25,0.8,0.3,1)" },
    },
  },
};
