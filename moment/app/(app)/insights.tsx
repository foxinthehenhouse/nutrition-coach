import { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { colors, fontFamily, spacing, radius, shadows } from "../../lib/theme";

const RANGE_OPTIONS = [
  { id: "week", label: "this week" },
  { id: "30", label: "last 30 days" },
  { id: "custom", label: "custom" },
] as const;

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: fontFamily.regular,
        fontSize: 11,
        color: colors.textTertiary,
        textTransform: "uppercase",
        letterSpacing: 1.5,
        marginBottom: 10,
      }}
    >
      {children}
    </Text>
  );
}

export default function Insights() {
  const insets = useSafeAreaInsets();
  const [rangeId, setRangeId] = useState<"week" | "30" | "custom">("week");

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingHorizontal: spacing.contentPadding,
        paddingTop: insets.top + 24,
        paddingBottom: 80,
      }}
    >
      <Text style={{ fontFamily: fontFamily.bold, fontSize: 20, color: colors.textPrimary, marginBottom: 16 }}>
        Insights
      </Text>

      {/* Date range pills */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
        {RANGE_OPTIONS.map((opt) => {
          const isActive = rangeId === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => setRangeId(opt.id)}
              style={{
                backgroundColor: isActive ? colors.textPrimary : colors.surface,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: radius.pill,
                borderWidth: isActive ? 0 : 1,
                borderColor: colors.border,
              }}
            >
              <Text
                style={{
                  fontFamily: fontFamily.medium,
                  fontSize: 13,
                  color: isActive ? colors.bg : colors.textSecondary,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* A. Post-workout refuel card — placeholder when no workout */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.cardLg,
          padding: 16,
          borderWidth: 1,
          borderColor: colors.border,
          ...shadows.card,
          marginBottom: 24,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Feather name="zap" size={18} color={colors.accentGold} />
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: 13, color: colors.textTertiary, letterSpacing: 1 }}>
            POST-WORKOUT
          </Text>
        </View>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, color: colors.textSecondary, lineHeight: 20 }}>
          When you finish a workout, you’ll see a refuel card here with a 90‑minute window to log protein + carbs.
        </Text>
      </View>

      {/* B. Needs dashboard — placeholders */}
      <SectionLabel>Needs</SectionLabel>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Energy", sub: "Cal range + strain", icon: "trending-up" as const },
          { label: "Recovery", sub: "Priority + still needed", icon: "activity" as const },
          { label: "Muscle", sub: "Protein range + logged", icon: "target" as const },
        ].map((card) => (
          <Pressable
            key={card.label}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.cardLg,
              padding: 16,
              width: "47%",
              borderWidth: 1,
              borderColor: colors.border,
              ...shadows.card,
            }}
          >
            <Feather name={card.icon} size={20} color={colors.accentBlue} style={{ marginBottom: 8 }} />
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: 15, color: colors.textPrimary }}>{card.label}</Text>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 12, color: colors.textTertiary, marginTop: 4 }}>{card.sub}</Text>
          </Pressable>
        ))}
      </View>

      {/* C. Micronutrient status — placeholder */}
      <SectionLabel>Nutrient status (7-day avg)</SectionLabel>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.cardLg,
          padding: 16,
          borderWidth: 1,
          borderColor: colors.border,
          ...shadows.card,
          marginBottom: 24,
        }}
      >
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary, lineHeight: 20 }}>
          Iron, calcium, potassium, vitamin D, magnesium, fiber and more — compared to daily values. Coming soon.
        </Text>
      </View>

      {/* D. Recovery × Nutrition deep dive — placeholder */}
      <SectionLabel>Recovery × nutrition</SectionLabel>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.cardLg,
          padding: 16,
          borderWidth: 1,
          borderColor: colors.border,
          ...shadows.card,
          marginBottom: 24,
        }}
      >
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary, lineHeight: 20 }}>
          Tap a day to see logged meals and next-morning recovery with pattern summary. Coming soon.
        </Text>
      </View>

      {/* E. Goal progress trends — placeholder */}
      <SectionLabel>Goal progress</SectionLabel>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.cardLg,
          padding: 16,
          borderWidth: 1,
          borderColor: colors.border,
          ...shadows.card,
        }}
      >
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary, lineHeight: 20 }}>
          Protein hit rate, calorie adherence, days logged streak with sparklines. Coming soon.
        </Text>
      </View>
    </ScrollView>
  );
}
