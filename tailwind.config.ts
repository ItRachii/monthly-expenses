import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Mirrors the Streamlit theme in legacy-streamlit/.streamlit/config.toml
        background: "#0E1117",
        surface: "#1C1F26",
        primary: "#4C72B0",
        accent: "#DD8452",
        ink: "#FAFAFA",
        muted: "#8B9DB8",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
