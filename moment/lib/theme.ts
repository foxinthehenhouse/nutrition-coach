import { useFonts as useExpoFonts } from "expo-font";
import {
  Geist_400Regular,
  Geist_700Bold,
} from "@expo-google-fonts/geist";

export const colors = {
  bg: "#080808",
  surface: "#0f0f0f",
  surfaceHigh: "#161616",
  border: "#1c1c1c",
  textPrimary: "#f0f0f0",
  textMuted: "#444444",
  textDim: "#282828",
  green: "#22c55e",
  greenDim: "rgba(34,197,94,0.10)",
  amber: "#f59e0b",
  red: "#ef4444",
  blue: "#3b82f6",
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
  if (score > 67) return colors.green;
  if (score >= 34) return colors.amber;
  return colors.red;
}

export function strainColor(strain: number): string {
  if (strain < 8) return colors.green;
  if (strain <= 13) return colors.amber;
  return colors.red;
}

export const spacing = {
  contentPadding: 24,
  touchTargetMin: 44,
} as const;

export const radius = {
  input: 14,
  card: 12,
} as const;

export const fontFamily = {
  regular: "Geist_400Regular",
  bold: "Geist_700Bold",
} as const;

export function useFonts(): [boolean, Error | null] {
  return useExpoFonts({
    Geist_400Regular,
    Geist_700Bold,
  });
}
