import React from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { colors, fontFamily, spacing, radius, holoGradients } from "../../lib/theme";

export type FoodLogEntry = {
  id: string;
  description: string | null;
  time: string | null;
  meal_type: string | null;
  date: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g?: number | null;
  sodium_mg?: number | null;
  iron_mg?: number | null;
  calcium_mg?: number | null;
  potassium_mg?: number | null;
  vitamin_d_mcg?: number | null;
  magnesium_mg?: number | null;
  zinc_mg?: number | null;
  b12_mcg?: number | null;
  [key: string]: unknown;
};

type Remaining = { protein: number; carbs: number; fat: number };

type FoodEntryDetailSheetProps = {
  visible: boolean;
  entry: FoodLogEntry | null;
  remaining: Remaining;
  onClose: () => void;
  onEdit?: (entry: FoodLogEntry) => void;
  onDelete?: (entry: FoodLogEntry) => void;
  onLogAgain?: (entry: FoodLogEntry) => void;
};

const MICRO_LABELS: { key: keyof FoodLogEntry; label: string; daily?: number }[] = [
  { key: "fiber_g", label: "Fiber", daily: 28 },
  { key: "sodium_mg", label: "Sodium", daily: 2300 },
  { key: "iron_mg", label: "Iron", daily: 18 },
  { key: "calcium_mg", label: "Calcium", daily: 1300 },
  { key: "potassium_mg", label: "Potassium", daily: 2600 },
  { key: "vitamin_d_mcg", label: "Vitamin D", daily: 20 },
  { key: "magnesium_mg", label: "Magnesium", daily: 420 },
];

export function FoodEntryDetailSheet({
  visible,
  entry,
  remaining,
  onClose,
  onEdit,
  onDelete,
  onLogAgain,
}: FoodEntryDetailSheetProps) {
  if (!entry) return null;

  const cal = entry.calories ?? 0;
  const protein = Number(entry.protein_g) ?? 0;
  const carbs = Number(entry.carbs_g) ?? 0;
  const fat = Number(entry.fat_g) ?? 0;

  const impactPct = (val: number, rem: number) => (rem > 0 ? Math.round((val / rem) * 100) : 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={onClose}>
        <Pressable
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            maxHeight: "85%",
          }}
          onPress={(e) => e.stopPropagation()}
        >
          <LinearGradient
            colors={[...holoGradients.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ height: 3, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
          />
          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingHorizontal: spacing.contentPadding, paddingTop: 12, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", alignSelf: "center", marginBottom: 16 }} />
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: 17, color: colors.textPrimary }} numberOfLines={2}>
              {entry.description ?? "Meal"}
            </Text>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 12, color: colors.textTertiary, marginTop: 4 }}>
              {entry.time?.slice(0, 5) ?? "—"} · {entry.meal_type ?? "meal"}
            </Text>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: 52, color: colors.accentBlue, letterSpacing: -1 }}>{cal}</Text>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textTertiary }}>cal</Text>

            <View style={{ flexDirection: "row", gap: 16, marginTop: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accentGreen }} />
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, color: colors.textSecondary }}>Protein {protein}g</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accentCarb }} />
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, color: colors.textSecondary }}>Carbs {carbs}g</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accentFat }} />
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, color: colors.textSecondary }}>Fat {fat}g</Text>
              </View>
            </View>

            <Text style={{ fontFamily: fontFamily.regular, fontSize: 11, color: colors.textTertiary, letterSpacing: 1.5, marginTop: 24, marginBottom: 8 }}>
              IMPACT ON TODAY
            </Text>
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>Protein</Text>
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textPrimary }}>
                  {impactPct(protein, remaining.protein)}% of remaining {Math.round(remaining.protein)}g {protein <= remaining.protein ? "✓" : ""}
                </Text>
              </View>
              <View style={{ height: 4, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
                <View style={{ width: `${Math.min(100, impactPct(protein, remaining.protein))}%`, height: "100%", backgroundColor: colors.accentGreen, borderRadius: 2 }} />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>Carbs</Text>
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textPrimary }}>
                  {impactPct(carbs, remaining.carbs)}% of remaining {Math.round(remaining.carbs)}g {carbs <= remaining.carbs ? "✓" : ""}
                </Text>
              </View>
              <View style={{ height: 4, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
                <View style={{ width: `${Math.min(100, impactPct(carbs, remaining.carbs))}%`, height: "100%", backgroundColor: colors.accentCarb, borderRadius: 2 }} />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>Fat</Text>
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textPrimary }}>
                  {impactPct(fat, remaining.fat)}% of remaining {Math.round(remaining.fat)}g {fat <= remaining.fat ? "✓" : ""}
                </Text>
              </View>
              <View style={{ height: 4, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
                <View style={{ width: `${Math.min(100, impactPct(fat, remaining.fat))}%`, height: "100%", backgroundColor: colors.accentFat, borderRadius: 2 }} />
              </View>
            </View>

            <Text style={{ fontFamily: fontFamily.regular, fontSize: 11, color: colors.textTertiary, letterSpacing: 1.5, marginTop: 20, marginBottom: 8 }}>
              MICRONUTRIENTS
            </Text>
            <View style={{ gap: 6 }}>
              {MICRO_LABELS.map(({ key, label, daily }) => {
                const raw = entry[key];
                const val = typeof raw === "number" ? raw : Number(raw) || 0;
                const pct = daily && daily > 0 ? Math.round((val / daily) * 100) : 0;
                return (
                  <View key={key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>{label}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ width: 120, height: 4, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
                        <View
                          style={{
                            width: `${Math.min(100, pct)}%`,
                            height: "100%",
                            backgroundColor: pct >= 100 ? colors.accentGreen : pct >= 70 ? colors.accentBlue : "rgba(255,255,255,0.3)",
                            borderRadius: 2,
                          }}
                        />
                      </View>
                      <Text style={{ fontFamily: fontFamily.regular, fontSize: 12, color: colors.textTertiary, minWidth: 36 }}>
                        {val > 0 ? (daily ? `${pct}%` : `${val}`) : "—"}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 12, color: colors.accentBlue, marginTop: 8 }}>View all nutrients →</Text>

            <View style={{ marginTop: 20, borderLeftWidth: 3, borderLeftColor: colors.accentBlue, paddingLeft: 12, paddingVertical: 8 }}>
              <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>
                This meal contributes to your daily targets. Keep logging to see patterns over time.
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 12, marginTop: 24 }}>
              {onEdit && (
                <Pressable onPress={() => onEdit(entry)} style={{ flex: 1, paddingVertical: 12, alignItems: "center", backgroundColor: colors.surfaceL3, borderRadius: radius.input }}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.textPrimary }}>Edit entry</Text>
                </Pressable>
              )}
              {onDelete && (
                <Pressable onPress={() => onDelete(entry)} style={{ flex: 1, paddingVertical: 12, alignItems: "center", backgroundColor: colors.surfaceL3, borderRadius: radius.input }}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.accentRed }}>Delete</Text>
                </Pressable>
              )}
              {onLogAgain && (
                <Pressable onPress={() => onLogAgain(entry)} style={{ flex: 1, paddingVertical: 12, alignItems: "center", backgroundColor: colors.surfaceL3, borderRadius: radius.input }}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.accentBlue }}>Log again</Text>
                </Pressable>
              )}
            </View>
            <Pressable onPress={onClose} style={{ marginTop: 16, paddingVertical: 12, alignItems: "center" }}>
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: 15, color: colors.accentBlue }}>Close</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
