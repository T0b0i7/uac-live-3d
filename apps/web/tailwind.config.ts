import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palette imposée du cahier des charges — valeurs exactes.
        bg: "#070B14",
        surface: "#111C2E",
        secondary: "#0D1422",
        primary: "#35D6F5",
        violet: "#8B5CF6",
        ok: "#22C55E",
        warn: "#F59E0B",
        danger: "#F43F5E",
        ink: "#F8FAFC",
        muted: "#94A3B8",
        line: "#1E2B42",
      },
      borderColor: {
        DEFAULT: "#1E2B42",
      },
      borderRadius: {
        xl2: "18px",
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
      keyframes: {
        pulseDot: {
          "0%, 100%": { boxShadow: "0 0 0 3px rgba(34,197,94,0.18)" },
          "50%": { boxShadow: "0 0 0 7px rgba(34,197,94,0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        pulseDot: "pulseDot 2s ease-in-out infinite",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
