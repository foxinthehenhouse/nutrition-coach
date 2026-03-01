import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Animated,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { fontFamily } from "../../lib/theme";

type Mode = null | "quick" | "detailed";

function AnimatedRow({
  label,
  sub,
  onPress,
  showDivider,
}: {
  label: string;
  sub: string;
  onPress: () => void;
  showDivider: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPressIn={() =>
        Animated.timing(scale, {
          toValue: 0.98,
          duration: 80,
          useNativeDriver: true,
        }).start()
      }
      onPressOut={() =>
        Animated.timing(scale, {
          toValue: 1,
          duration: 80,
          useNativeDriver: true,
        }).start()
      }
      onPress={onPress}
    >
      <Animated.View
        style={[
          {
            paddingVertical: 20,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          },
          showDivider && {
            borderBottomWidth: 1,
            borderBottomColor: "#111111",
          },
          { transform: [{ scale }] },
        ]}
      >
        <View style={{ gap: 4 }}>
          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 16,
              color: "#f0f0f0",
            }}
          >
            {label}
          </Text>
          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 13,
              color: "#2a2a2a",
            }}
          >
            {sub}
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color="#282828" />
      </Animated.View>
    </Pressable>
  );
}

function Pill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          backgroundColor: selected ? "#161616" : "#0f0f0f",
          borderWidth: 1,
          borderColor: selected ? "rgba(168,237,234,0.3)" : "#1c1c1c",
          borderRadius: 999,
          paddingHorizontal: 14,
          paddingVertical: 8,
        }}
      >
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 13,
            color: selected ? "#f0f0f0" : "#3a3a3a",
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const GOALS = ["performance", "recomp", "maintenance"] as const;
const ACTIVITY = ["sedentary", "moderate", "active", "athlete"] as const;
const DIETARY = ["none", "vegetarian", "vegan", "gluten-free", "dairy-free"] as const;

const CALORIE_DEFAULTS: Record<string, number> = {
  athlete: 2900,
  active: 2700,
  moderate: 2500,
  sedentary: 2200,
};

export default function OnboardingIndex() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  const [goalMode, setGoalMode] = useState("maintenance");
  const [activityLevel, setActivityLevel] = useState("moderate");
  const [calorieTarget, setCalorieTarget] = useState("");
  const [proteinTarget, setProteinTarget] = useState("");
  const [selectedDietary, setSelectedDietary] = useState<string[]>(["none"]);

  const [focusedField, setFocusedField] = useState<string | null>(null);

  const inputStyle = (field: string) => ({
    backgroundColor: "#0f0f0f",
    borderWidth: 1,
    borderColor:
      focusedField === field ? "rgba(168,237,234,0.25)" : "#1c1c1c",
    borderRadius: 14,
    padding: 16,
    fontFamily: fontFamily.regular,
    fontSize: 15,
    color: "#f0f0f0",
    marginBottom: 12,
  });

  const handleSkip = async () => {
    setSubmitting(true);
    await supabase.auth.updateUser({
      data: {
        profile_complete: true,
        onboarding_mode: "skipped",
        calorie_target: 2500,
        protein_target: 160,
        goal_mode: "maintenance",
      },
    });
    router.replace("/(onboarding)/whoop");
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    const metadata: Record<string, unknown> = {
      profile_complete: true,
      onboarding_mode: mode,
      name: name.trim(),
      weight_kg: parseFloat(weight) || null,
      goal_mode: goalMode,
      activity_level: activityLevel,
      calorie_target:
        mode === "detailed" && calorieTarget
          ? parseInt(calorieTarget)
          : CALORIE_DEFAULTS[activityLevel] ?? 2500,
      protein_target:
        mode === "detailed" && proteinTarget ? parseInt(proteinTarget) : 160,
      dietary: mode === "detailed" ? selectedDietary : [],
    };
    await supabase.auth.updateUser({ data: metadata });
    router.replace("/(onboarding)/whoop");
  };

  const toggleDietary = (value: string) => {
    setSelectedDietary((prev) => {
      if (value === "none") return ["none"];
      const without = prev.filter((v) => v !== "none");
      if (without.includes(value)) {
        const next = without.filter((v) => v !== value);
        return next.length === 0 ? ["none"] : next;
      }
      return [...without, value];
    });
  };

  const disabled = !name.trim() || !weight.trim();

  if (mode === null) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#080808",
          paddingHorizontal: 24,
          paddingTop: insets.top + 52,
        }}
      >
        <Text
          style={{
            fontFamily: fontFamily.bold,
            fontSize: 28,
            color: "#f0f0f0",
          }}
        >
          setup
        </Text>

        <View style={{ marginTop: 48 }}>
          <AnimatedRow
            label="skip"
            sub="defaults applied"
            onPress={handleSkip}
            showDivider
          />
          <AnimatedRow
            label="quick"
            sub="2 min"
            onPress={() => setMode("quick")}
            showDivider
          />
          <AnimatedRow
            label="detailed"
            sub="5 min"
            onPress={() => setMode("detailed")}
            showDivider={false}
          />
        </View>

        {submitting && (
          <ActivityIndicator
            color="#f0f0f0"
            style={{ marginTop: 24 }}
          />
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#080808" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 20,
          paddingBottom: 40,
        }}
      >
        <Pressable onPress={() => setMode(null)} style={{ marginBottom: 32 }}>
          <Feather name="chevron-left" size={20} color="#444444" />
        </Pressable>

        <TextInput
          placeholder="name"
          placeholderTextColor="#282828"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          onFocus={() => setFocusedField("name")}
          onBlur={() => setFocusedField(null)}
          style={inputStyle("name")}
        />

        <TextInput
          placeholder="weight (kg)"
          placeholderTextColor="#282828"
          value={weight}
          onChangeText={setWeight}
          keyboardType="decimal-pad"
          onFocus={() => setFocusedField("weight")}
          onBlur={() => setFocusedField(null)}
          style={inputStyle("weight")}
        />

        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 10,
            color: "#282828",
            textTransform: "uppercase",
            letterSpacing: 3,
            marginTop: 24,
            marginBottom: 10,
          }}
        >
          goal
        </Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {GOALS.map((g) => (
            <Pill
              key={g}
              label={g}
              selected={goalMode === g}
              onPress={() => setGoalMode(g)}
            />
          ))}
        </View>

        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 10,
            color: "#282828",
            textTransform: "uppercase",
            letterSpacing: 3,
            marginTop: 24,
            marginBottom: 10,
          }}
        >
          activity
        </Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {ACTIVITY.map((a) => (
            <Pill
              key={a}
              label={a}
              selected={activityLevel === a}
              onPress={() => setActivityLevel(a)}
            />
          ))}
        </View>

        {mode === "detailed" && (
          <>
            <TextInput
              placeholder="daily calories"
              placeholderTextColor="#282828"
              value={calorieTarget}
              onChangeText={setCalorieTarget}
              keyboardType="numeric"
              onFocus={() => setFocusedField("calories")}
              onBlur={() => setFocusedField(null)}
              style={[inputStyle("calories"), { marginTop: 24 }]}
            />

            <TextInput
              placeholder="protein target (g)"
              placeholderTextColor="#282828"
              value={proteinTarget}
              onChangeText={setProteinTarget}
              keyboardType="numeric"
              onFocus={() => setFocusedField("protein")}
              onBlur={() => setFocusedField(null)}
              style={inputStyle("protein")}
            />

            <Text
              style={{
                fontFamily: fontFamily.regular,
                fontSize: 10,
                color: "#282828",
                textTransform: "uppercase",
                letterSpacing: 3,
                marginTop: 24,
                marginBottom: 10,
              }}
            >
              dietary
            </Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {DIETARY.map((d) => (
                <Pill
                  key={d}
                  label={d}
                  selected={selectedDietary.includes(d)}
                  onPress={() => toggleDietary(d)}
                />
              ))}
            </View>
          </>
        )}

        <Pressable
          onPress={handleSubmit}
          disabled={disabled || submitting}
          style={{
            height: 50,
            borderRadius: 14,
            backgroundColor:
              disabled || submitting
                ? "rgba(240,240,240,0.08)"
                : "#f0f0f0",
            justifyContent: "center",
            alignItems: "center",
            marginTop: 32,
          }}
        >
          {submitting ? (
            <ActivityIndicator color="#080808" />
          ) : (
            <Text
              style={{
                fontFamily: fontFamily.bold,
                fontSize: 15,
                color: disabled ? "#444444" : "#080808",
              }}
            >
              continue
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
