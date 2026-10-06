// Shared design tokens for the app.
// Source of truth for values used in JS (Framer Motion springs, type scale
// references, etc.). Color/radius values are mirrored into app/globals.css
// under @theme so Tailwind utilities (text-label, bg-grouped-bg, rounded-card)
// stay in sync.

export const tokens = {
  colors: {
    label: "#000000",
    secondaryLabel: "#3C3C4399",
    tertiaryLabel: "#3C3C434D",
    systemBackground: "#FFFFFF",
    secondarySystemBackground: "#F2F2F7",
    groupedBackground: "#F7F7FA",
    separator: "#3C3C4333",

    systemBlue: "#005FCC",
    systemGreen: "#248A3D",
    systemRed: "#FF3B30",
    systemOrange: "#FF9500",
    systemPurple: "#AF52DE",
    systemPink: "#FF2D55",
    systemTeal: "#0A84A5",
    liquidCyan: "#5AC8FA",
    liquidViolet: "#AF52DE",
    liquidMint: "#34D399",
    warmSurface: "#FFFFFF",

    income: "#34C759",
    fixed: "#0A84A5",
    variable: "#FF9500",
    guiltFree: "#AF52DE",
    investment: "#007AFF",
    goal: "#FF2D55",
  },
  radii: {
    card: "16px",
    button: "12px",
    pill: "9999px",
    sheet: "24px 24px 0 0",
  },
  shadows: {
    card: "0 1px 2px rgba(0,0,0,0.05), 0 8px 24px rgba(20,24,32,0.06)",
    floating: "0 14px 44px rgba(20,24,32,0.16)",
    ledgerGlow: "0 0 0 1px rgba(0,95,204,0.16), 0 10px 30px rgba(90,200,250,0.12)",
  },
  spring: {
    gentle: { type: "spring", stiffness: 300, damping: 30 },
    bouncy: { type: "spring", stiffness: 400, damping: 17 },
    stiff: { type: "spring", stiffness: 500, damping: 40 },
  },
  fonts: {
    sans: `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif`,
    rounded: `-apple-system-rounded, 'SF Pro Rounded', system-ui, sans-serif`,
  },
  type: {
    largeTitle: { size: "34px", weight: 700, lineHeight: "41px" },
    title1: { size: "28px", weight: 700, lineHeight: "34px" },
    title2: { size: "22px", weight: 700, lineHeight: "28px" },
    title3: { size: "20px", weight: 600, lineHeight: "25px" },
    headline: { size: "17px", weight: 600, lineHeight: "22px" },
    body: { size: "17px", weight: 400, lineHeight: "22px" },
    callout: { size: "16px", weight: 400, lineHeight: "21px" },
    subheadline: { size: "15px", weight: 400, lineHeight: "20px" },
    footnote: { size: "13px", weight: 400, lineHeight: "18px" },
    caption: { size: "12px", weight: 400, lineHeight: "16px" },
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "32px",
    xxl: "48px",
  },
} as const;

export type Tokens = typeof tokens;
export type ColorToken = keyof Tokens["colors"];
export type CategoryColor =
  | "income"
  | "fixed"
  | "variable"
  | "guiltFree"
  | "investment"
  | "goal";
