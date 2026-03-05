import { useFonts as useExpoFonts } from "expo-font";
import {
  Geist_400Regular,
  Geist_700Bold,
} from "@expo-google-fonts/geist";

// Brief palette: base #0A0A0A, surface #141414, elevated #1F1F1F
export const colors = {
  bg: "#0A0A0A",
  surface: "#141414",
  surfaceElevated: "#1F1F1F",
  surfaceHigh: "#161616",
  border: "rgba(255,255,255,0.14)",
  borderSubtle: "rgba(255,255,255,0.08)",
  textPrimary: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.55)",
  textTertiary: "rgba(255,255,255,0.30)",
  // Legacy aliases
  textMuted: "rgba(255,255,255,0.55)",
  textDim: "rgba(255,255,255,0.30)",
  // Accents
  accentGold: "#F5A623",
  accentBlue: "#4A9EFF",
  accentGreen: "#34C85A",
  accentOrange: "#FF9500",
  accentRed: "#FF3B30",
  // State
  green: "#34C85A",
  greenDim: "rgba(52,200,90,0.15)",
  amber: "#FF9500",
  red: "#FF3B30",
  blue: "#4A9EFF",
  purple: "#a855f7",
} as const;

export const holoGradient = [
  "#a8edea",
  "#c2e9fb",
  "#d4a8ff",
  "#fed6e3",
  "#a8edea",
] as const;

export function recoveryColor(score: number): string {
  if (score > 67) return colors.accentGreen;
  if (score >= 34) return colors.accentOrange;
  return colors.accentRed;
}

export function strainColor(strain: number): string {
  if (strain < 8) return colors.accentGreen;
  if (strain <= 13) return colors.accentOrange;
  return colors.accentRed;
}

/** Protein bar fill by % of target: <50% red, 50-89% orange, >=90% green */
export function proteinBarColor(pct: number): string {
  if (pct >= 0.9) return colors.accentGreen;
  if (pct >= 0.5) return colors.accentOrange;
  return colors.accentRed;
}

/** Calorie bar: >=90% blue, 60-89% orange, <60% red */
export function calorieBarColor(pct: number): string {
  if (pct >= 0.9) return colors.accentBlue;
  if (pct >= 0.6) return colors.accentOrange;
  return colors.accentRed;
}

export const spacing = {
  contentPadding: 20,
  contentPaddingLegacy: 24,
  cardPaddingH: 16,
  cardPaddingV: 12,
  sectionGap: 24,
  gridBase: 8,
  touchTargetMin: 44,
} as const;

export const radius = {
  pill: 999,
  card: 16,
  input: 14,
  inputBar: 28,
  listItem: 12,
} as const;

export const typography = {
  heroNumber: { fontSize: 48, fontWeight: "700" as const, letterSpacing: -0.5 },
  sectionNumber: { fontSize: 28, fontWeight: "600" as const },
  sectionLabel: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 1.5 },
  bodyInput: { fontSize: 17, fontWeight: "400" as const },
  logDescription: { fontSize: 15, fontWeight: "400" as const },
  logSecondary: { fontSize: 13, fontWeight: "400" as const },
  timestamp: { fontSize: 12, fontWeight: "400" as const },
  navLabel: { fontSize: 10, fontWeight: "500" as const },
} as const;

export const fontFamily = {
  regular: "Geist_400Regular",
  bold: "Geist_700Bold",
} as const;

/** Motion: 0.2s ease-out for state; 0.6s bar fill; spring 300/30 */
export const motion = {
  durationFast: 200,
  durationBar: 600,
  springStiffness: 300,
  springDamping: 30,
} as const;

export function useFonts(): [boolean, Error | null] {
  return useExpoFonts({
    Geist_400Regular,
    Geist_700Bold,
  });
}
