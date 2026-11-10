import defaultTheme from "tailwindcss/defaultTheme";
import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        xs: "400px",
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "oklch(var(--border))",
        "border-2": "oklch(var(--border-2))",
        input: "oklch(var(--input))",
        ring: "oklch(var(--ring))",
        background: "oklch(var(--background))",
        foreground: "oklch(var(--foreground))",
        "paper-2": "oklch(var(--paper-2))",
        "paper-3": "oklch(var(--paper-3))",
        "ink-2": "oklch(var(--ink-2))",
        primary: {
          DEFAULT: "oklch(var(--primary))",
          foreground: "oklch(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "oklch(var(--secondary))",
          foreground: "oklch(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "oklch(var(--destructive))",
          foreground: "oklch(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "oklch(var(--muted))",
          foreground: "oklch(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "oklch(var(--accent))",
          foreground: "oklch(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "oklch(var(--popover))",
          foreground: "oklch(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "oklch(var(--card))",
          foreground: "oklch(var(--card-foreground))",
        },
        success: {
          DEFAULT: "oklch(var(--success))",
          foreground: "oklch(var(--success-foreground))",
          text: "oklch(var(--success-text))",
        },
        warning: {
          DEFAULT: "oklch(var(--warning))",
          foreground: "oklch(var(--warning-foreground))",
          text: "oklch(var(--warning-text))",
        },
        info: {
          DEFAULT: "oklch(var(--info))",
          foreground: "oklch(var(--info-foreground))",
          text: "oklch(var(--info-text))",
        },
        "destructive-text": "oklch(var(--destructive-text))",
        overlay: "oklch(var(--overlay))",
        chart: {
          1: "oklch(var(--chart-1))",
          2: "oklch(var(--chart-2))",
          3: "oklch(var(--chart-3))",
          4: "oklch(var(--chart-4))",
          5: "oklch(var(--chart-5))",
        },
      },
      fontFamily: {
        sans: ["Geist Variable", "Geist", ...defaultTheme.fontFamily.sans],
        mono: ["Geist Mono Variable", "Geist Mono", ...defaultTheme.fontFamily.mono],
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        card: "var(--radius-card)",
      },
      keyframes: {
        // Grid track, never height (Floor 10a): 0fr -> 1fr interpolates to
        // the content's natural size without a measured height variable.
        "accordion-down": {
          from: { gridTemplateRows: "0fr" },
          to: { gridTemplateRows: "1fr" },
        },
        "accordion-up": {
          from: { gridTemplateRows: "1fr" },
          to: { gridTemplateRows: "0fr" },
        },
        "fade-in": {
          from: {
            opacity: "0",
          },
          to: {
            opacity: "1",
          },
        },
        marquee: {
          "100%": {
            transform: "translateY(-50%)",
          },
        },
        "spin-reverse": {
          to: {
            transform: "rotate(-360deg)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "accordion-up": "accordion-up 0.2s cubic-bezier(0.65, 0, 0.35, 1)",
        "fade-in": "fade-in 0.5s linear forwards",
        marquee: "marquee var(--marquee-duration) linear infinite",
        "spin-slow": "spin 4s linear infinite",
        "spin-slower": "spin 6s linear infinite",
        "spin-reverse": "spin-reverse 1s linear infinite",
        "spin-reverse-slow": "spin-reverse 4s linear infinite",
        "spin-reverse-slower": "spin-reverse 6s linear infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate, typography],
};
