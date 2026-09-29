import type { Config } from "tailwindcss";

const tone = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // hover: styles only where a mouse can hover. A tap fakes :hover on touch
  // screens and it sticks until the next tap elsewhere.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      // Every colour is a CSS variable holding RGB channels, set per theme
      // in globals.css ([data-theme]), so opacity modifiers (bg-ink/5) and
      // the same class work in light and dark.
      colors: {
        background: tone("background"),
        surface: tone("surface"),
        primary: tone("primary"),
        // Primary for text and icons: lighter on dark, deeper on light, 7:1
        // on the surface either way.
        "primary-light": tone("primary-light"),
        accent: tone("accent"),
        ink: tone("ink"),
        muted: tone("muted"),
        // Money and state colours, readable on both surfaces.
        positive: tone("positive"),
        negative: tone("negative"),
        warning: tone("warning"),
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
