import { useFonts as useExpoFonts } from "expo-font";
import {
  PlusJakartaSans_300Light,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";

// v2 palette: blue-tinted base, WCAG AA text, distinct accents
export const colors = {
  bg: "#080810",
  surface: "#10111C",
  surfaceL1: "#10111C",
  surfaceL2: "#181926",
  surfaceL3: "#1E2035",
  surfaceOverlay: "rgba(16,17,28,0.92)",
  // Legacy aliases
  surfaceElevated: "#181926",
  surfaceHigh: "#1E2035",
  border: "rgba(255,255,255,0.18)",
  borderSubtle: "rgba(255,255,255,0.10)",
  borderEmphasis: "rgba(255,255,255,0.30)",
  textPrimary: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.72)",
  textTertiary: "rgba(255,255,255,0.45)",
  textDisabled: "rgba(255,255,255,0.28)",
  textMuted: "rgba(255,255,255,0.72)",
  textDim: "rgba(255,255,255,0.45)",
  // Accents
  accentGold: "#F5A623",
  accentBlue: "#5B9CF6",
  accentGreen: "#3DDC84",
  accentCarb: "#38BDF8",
  accentFat: "#FBBF24",
  accentOrange: "#FB923C",
  accentRed: "#F87171",
  // Protein state
  proteinLow: "#F87171",
  proteinMid: "#FB923C",
  proteinHigh: "#3DDC84",
  // Legacy
  green: "#3DDC84",
  greenDim: "rgba(61,220,132,0.15)",
  amber: "#FBBF24",
  red: "#F87171",
  blue: "#5B9CF6",
  purple: "#8B5CF6",
} as const;

// v1 legacy (replaced by holo tokens below)
export const holoGradient = [
  "#5B9CF6",
  "#8B5CF6",
  "#EC4899",
  "#F5A623",
] as const;

/** v2 holographic gradient color arrays for LinearGradient */
export const holoGradients = {
  primary: ["#5B9CF6", "#8B5CF6", "#EC4899"] as const,
  recovery: ["#F5A623", "#FBBF24", "#F59E0B"] as const,
  protein: ["#3DDC84", "#34D399", "#10B981"] as const,
} as const;

// v2 shadows (RN: use shadowColor, shadowOffset, shadowOpacity, shadowRadius; elevation on Android)
export const shadows = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  cardBorder: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  modal: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 32,
    elevation: 8,
  },
  modalBorder: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cta: {
    shadowColor: "#5B9CF6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 4,
  },
} as const;

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

/** Protein bar fill: <50% red, 50-89% orange, >=90% green */
export function proteinBarColor(pct: number): string {
  if (pct >= 0.9) return colors.proteinHigh;
  if (pct >= 0.5) return colors.proteinMid;
  return colors.proteinLow;
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
  cardLg: 18,
  input: 14,
  inputBar: 28,
  listItem: 12,
} as const;

// v2 type scale (Söhne / Plus Jakarta)
export const typography = {
  heroNumber: { fontSize: 52, fontWeight: "700" as const, letterSpacing: -1 },
  sectionNumber: { fontSize: 32, fontWeight: "600" as const, letterSpacing: -0.5 },
  sectionHeading: { fontSize: 20, fontWeight: "600" as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: "400" as const },
  bodyInput: { fontSize: 17, fontWeight: "400" as const },
  labelCaps: { fontSize: 11, fontWeight: "500" as const, letterSpacing: 1.8 },
  logDescription: { fontSize: 15, fontWeight: "400" as const },
  logSecondary: { fontSize: 13, fontWeight: "300" as const },
  timestamp: { fontSize: 12, fontWeight: "300" as const },
  navLabel: { fontSize: 10, fontWeight: "500" as const, letterSpacing: 0.5 },
  chartAxis: { fontSize: 10, fontWeight: "300" as const },
} as const;

export const fontFamily = {
  light: "PlusJakartaSans_300Light",
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
} as const;

/** Motion: v2 — progress 700ms spring, chart 600ms stagger 60ms, sheet 400ms */
export const motion = {
  durationFast: 200,
  durationBar: 700,
  durationChart: 600,
  staggerChart: 60,
  durationSheet: 400,
  durationRecoveryLine: 800,
  durationShimmer: 600,
  springStiffness: 300,
  springDamping: 30,
  springOvershoot: { x: 0.34, y: 1.56, z: 0.64, w: 1 },
} as const;

export function useFonts(): [boolean, Error | null] {
  return useExpoFonts({
    PlusJakartaSans_300Light,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });
}
