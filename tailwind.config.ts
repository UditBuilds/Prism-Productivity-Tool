import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "var(--font-jetbrains-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        // shadcn semantic tokens (mapped to the PRISM palette)
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground))",
          hover: "rgb(var(--accent-hover-rgb) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "rgb(var(--accent-rgb) / <alpha-value>)",

        // PRISM design-system extras (direct, non-colliding names)
        surface: "hsl(var(--surface))",
        "surface-raised": "hsl(var(--surface-raised))",
        "border-col": "hsl(var(--border-col))",
        "accent-hover": "rgb(var(--accent-hover-rgb) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft-rgb) / <alpha-value>)",
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        danger: "hsl(var(--danger))",
      },
      backgroundImage: {
        // Accent gradients resolve from the theme vars so all 6 accent themes work
        "accent-gradient":
          "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent-soft-rgb)))",
        "accent-gradient-hover":
          "linear-gradient(135deg, rgb(var(--accent-hover-rgb)), rgb(var(--accent-rgb)))",
        "success-gradient": "linear-gradient(135deg, #10B981, #34D399)",
        "warning-gradient": "linear-gradient(135deg, #F59E0B, #FBBF24)",
        "danger-gradient": "linear-gradient(135deg, #EF4444, #F87171)",
      },
      boxShadow: {
        "glow-accent": "0 0 16px rgb(var(--accent-rgb) / 0.25)",
        "glow-accent-sm": "0 0 8px rgb(var(--accent-rgb) / 0.2)",
        "lift":
          "0 8px 24px rgb(0 0 0 / 0.4), 0 0 12px rgb(var(--accent-rgb) / 0.06)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-4px)" },
          "40%": { transform: "translateX(4px)" },
          "60%": { transform: "translateX(-3px)" },
          "80%": { transform: "translateX(3px)" },
        },
        "bell-ring": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "15%": { transform: "rotate(14deg)" },
          "30%": { transform: "rotate(-12deg)" },
          "45%": { transform: "rotate(8deg)" },
          "60%": { transform: "rotate(-6deg)" },
          "75%": { transform: "rotate(3deg)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        breathe: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.6" },
          "50%": { transform: "scale(1.06)", opacity: "1" },
        },
        "pulse-ring": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgb(var(--accent-rgb) / 0.25)" },
          "50%": { boxShadow: "0 0 0 6px rgb(var(--accent-rgb) / 0)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        flicker: {
          "0%, 100%": { transform: "scale(1) rotate(-1deg)", opacity: "1" },
          "30%": { transform: "scale(1.08) rotate(1deg)", opacity: "0.9" },
          "60%": { transform: "scale(0.96) rotate(-2deg)", opacity: "1" },
          "80%": { transform: "scale(1.04) rotate(2deg)", opacity: "0.95" },
        },
        pop: {
          "0%": { transform: "scale(0.9)" },
          "60%": { transform: "scale(1.06)" },
          "100%": { transform: "scale(1)" },
        },
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        "underline-grow": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-up": "fade-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.3s ease-out both",
        "slide-in-right":
          "slide-in-right 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
        shake: "shake 0.3s ease-in-out",
        "bell-ring": "bell-ring 1s ease-in-out",
        "bell-ring-loop": "bell-ring 2s ease-in-out infinite",
        float: "float 3.5s ease-in-out infinite",
        breathe: "breathe 2.5s ease-in-out infinite",
        "pulse-ring": "pulse-ring 2s ease-in-out infinite",
        shimmer: "shimmer 1.8s linear infinite",
        flicker: "flicker 1.6s ease-in-out infinite",
        pop: "pop 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
        "spin-slow": "spin-slow 6s linear infinite",
        "underline-grow":
          "underline-grow 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
