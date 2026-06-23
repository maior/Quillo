import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-inter)", "sans-serif"],
        serif: ["var(--font-serif)", "ui-serif", "Georgia", "serif"],
      },
      colors: {
        ink: {
          DEFAULT: "#0A1022",
          800: "#0E1730",
          700: "#13203F",
        },
        navy: {
          DEFAULT: "#0E2A5E",
          700: "#143A7A",
        },
        accent: {
          DEFAULT: "#3B82F6",
          cyan: "#22D3EE",
        },
        copper: "#C9824A",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 8px 24px -12px rgba(16,24,40,.12)",
        "card-hover": "0 8px 32px -8px rgba(14,42,94,.25)",
        glow: "0 0 60px -10px rgba(34,211,238,.45)",
      },
      backgroundImage: {
        "hero-glow":
          "radial-gradient(60% 80% at 70% 10%, rgba(34,211,238,.18) 0%, transparent 60%), radial-gradient(50% 60% at 15% 30%, rgba(59,130,246,.20) 0%, transparent 55%)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        kenburns: {
          "0%": { transform: "scale(1)" },
          "100%": { transform: "scale(1.12)" },
        },
        "lightbox-fade": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "lightbox-zoom": {
          "0%": { opacity: "0", transform: "scale(.94) translateY(10px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        "drawer-in": {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up .6s cubic-bezier(.16,1,.3,1) both",
        kenburns: "kenburns 28s ease-out both",
        "lightbox-fade": "lightbox-fade .25s ease-out both",
        "lightbox-zoom": "lightbox-zoom .35s cubic-bezier(.16,1,.3,1) both",
        "drawer-in": "drawer-in .35s cubic-bezier(.16,1,.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
