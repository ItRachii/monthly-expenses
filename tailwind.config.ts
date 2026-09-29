import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // hover: styles only where a mouse can hover. A tap fakes :hover on touch
  // screens and it sticks until the next tap elsewhere.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        // Mirrors the Streamlit theme in legacy-streamlit/.streamlit/config.toml
        background: "#0E1117",
        surface: "#1C1F26",
        primary: "#4C72B0",
        // The primary blue lightened for text on dark surfaces (7:1 on surface).
        "primary-light": "#8FB0E6",
        accent: "#DD8452",
        ink: "#FAFAFA",
        muted: "#8B9DB8",
      },
      // Motion tokens, the same curves as --ease-out and --ease-drawer in
      // globals.css. ease-out replaces Tailwind's weak default of that name.
      transitionTimingFunction: {
        out: "var(--ease-out)",
        drawer: "var(--ease-drawer)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
