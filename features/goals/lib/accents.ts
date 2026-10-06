// Curated accent palette for goals — small enough to pick from without a color
// wheel, wide enough to feel personal. Each accent has a solid swatch + a
// gradient for the ring/card background. Keep in sync with @theme colors in
// app/globals.css (these reference the iOS token names).

export type AccentKey =
  | "blue"
  | "teal"
  | "green"
  | "orange"
  | "pink"
  | "purple"
  | "red";

export interface Accent {
  key: AccentKey;
  label: string;
  /** Solid color, e.g. for ring strokes and emoji backplate. */
  solid: string;
  /** Light/tint for card background. */
  tint: string;
  /** Linear gradient used on the hero tile. */
  gradient: string;
  /** Token-name Tailwind class maps, for text and chip labels. */
  textClass: string;
}

export const ACCENTS: Record<AccentKey, Accent> = {
  blue: {
    key: "blue",
    label: "Ocean",
    solid: "var(--color-system-blue)",
    tint: "rgba(0, 122, 255, 0.10)",
    gradient: "linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)",
    textClass: "text-system-blue",
  },
  teal: {
    key: "teal",
    label: "Mint",
    solid: "var(--color-system-teal)",
    tint: "rgba(90, 200, 250, 0.12)",
    gradient: "linear-gradient(135deg, #5AC8FA 0%, #34C759 100%)",
    textClass: "text-system-teal",
  },
  green: {
    key: "green",
    label: "Meadow",
    solid: "var(--color-system-green)",
    tint: "rgba(52, 199, 89, 0.12)",
    gradient: "linear-gradient(135deg, #34C759 0%, #CBF358 100%)",
    textClass: "text-system-green",
  },
  orange: {
    key: "orange",
    label: "Sunset",
    solid: "var(--color-system-orange)",
    tint: "rgba(255, 149, 0, 0.12)",
    gradient: "linear-gradient(135deg, #FF9500 0%, #FFCC00 100%)",
    textClass: "text-system-orange",
  },
  pink: {
    key: "pink",
    label: "Bubblegum",
    solid: "var(--color-system-pink)",
    tint: "rgba(255, 45, 85, 0.10)",
    gradient: "linear-gradient(135deg, #FF2D55 0%, #FFB1C1 100%)",
    textClass: "text-system-pink",
  },
  purple: {
    key: "purple",
    label: "Lilac",
    solid: "var(--color-system-purple)",
    tint: "rgba(175, 82, 222, 0.10)",
    gradient: "linear-gradient(135deg, #AF52DE 0%, #BF5AF2 100%)",
    textClass: "text-system-purple",
  },
  red: {
    key: "red",
    label: "Berry",
    solid: "var(--color-system-red)",
    tint: "rgba(255, 59, 48, 0.10)",
    gradient: "linear-gradient(135deg, #FF3B30 0%, #FF9500 100%)",
    textClass: "text-system-red",
  },
};

export const ACCENT_KEYS: AccentKey[] = [
  "blue",
  "teal",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
];

export function accentOrDefault(key: string | null | undefined): Accent {
  if (key && key in ACCENTS) return ACCENTS[key as AccentKey];
  return ACCENTS.blue;
}

// Stable pseudo-random accent from a string, so unstyled goals still look
// varied instead of all-blue.
export function deriveAccent(seed: string): Accent {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % ACCENT_KEYS.length;
  return ACCENTS[ACCENT_KEYS[idx]];
}
