import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../../lib/supabase";
import { fontFamily, holoGradient } from "../../lib/theme";

let MaskedView: React.ComponentType<any> | null = null;
if (Platform.OS !== "web") {
  try {
    MaskedView =
      require("@react-native-masked-view/masked-view").default ??
      require("@react-native-masked-view/masked-view").MaskedView;
  } catch {
    MaskedView = null;
  }
}

function Wordmark() {
  const textStyle = {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    color: "#f0f0f0",
  };

  if (MaskedView) {
    return (
      <MaskedView maskElement={<Text style={textStyle}>WHOOP</Text>}>
        <LinearGradient
          colors={[...holoGradient] as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        >
          <Text style={[textStyle, { opacity: 0 }]}>WHOOP</Text>
        </LinearGradient>
      </MaskedView>
    );
  }

  return <Text style={textStyle}>WHOOP</Text>;
}

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 4,
        paddingHorizontal: 24,
        paddingTop: 12,
        paddingBottom: 4,
      }}
    >
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 2,
            borderRadius: 999,
            backgroundColor:
              i <= step ? "#FFFFFF" : "rgba(255,255,255,0.12)",
          }}
        />
      ))}
    </View>
  );
}

function StepContainer({
  children,
  insets,
}: {
  children: React.ReactNode;
  insets: { top: number; bottom: number };
}) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#080810" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 40,
          flexGrow: 1,
        }}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        marginBottom: 32,
        minHeight: 44,
        minWidth: 44,
        justifyContent: "center",
        alignSelf: "flex-start",
      }}
      hitSlop={8}
    >
      <Feather name="chevron-left" size={20} color="rgba(255,255,255,0.35)" />
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: fontFamily.medium,
        fontSize: 11,
        color: "rgba(255,255,255,0.45)",
        textTransform: "uppercase",
        letterSpacing: 1.8,
        marginTop: 28,
        marginBottom: 12,
      }}
    >
      {children}
    </Text>
  );
}

function Pill({
  label,
  sub,
  selected,
  onPress,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ marginBottom: 8 }}>
      <View
        style={{
          backgroundColor: selected ? "rgba(255,255,255,0.08)" : "#10111C",
          borderWidth: 1,
          borderColor: selected
            ? "rgba(255,255,255,0.35)"
            : "rgba(255,255,255,0.12)",
          borderRadius: 999,
          paddingHorizontal: 16,
          paddingVertical: sub ? 10 : 9,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        {selected && (
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              backgroundColor: "#3DDC84",
            }}
          />
        )}
        <View>
          <Text
            style={{
              fontFamily: fontFamily.medium,
              fontSize: 14,
              color: selected ? "#FFFFFF" : "rgba(255,255,255,0.55)",
            }}
          >
            {label}
          </Text>
          {sub && (
            <Text
              style={{
                fontFamily: fontFamily.regular,
                fontSize: 12,
                color: "rgba(255,255,255,0.35)",
                marginTop: 2,
              }}
            >
              {sub}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={{
        height: 52,
        borderRadius: 14,
        backgroundColor:
          disabled || loading
            ? "rgba(255,255,255,0.07)"
            : "#FFFFFF",
        justifyContent: "center",
        alignItems: "center",
        marginTop: 32,
      }}
    >
      {loading ? (
        <ActivityIndicator color="#080810" />
      ) : (
        <Text
          style={{
            fontFamily: fontFamily.bold,
            fontSize: 15,
            color: disabled ? "rgba(255,255,255,0.25)" : "#080810",
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function calculateTargets(profile: {
  goal: string;
  weight: string;
  units: string;
  trainingType: string;
  trainingDays: number[];
  intensity: string;
}): { calories: number; protein: number } {
  const weightKg =
    profile.units === "imperial"
      ? parseFloat(profile.weight || "0") * 0.453592
      : parseFloat(profile.weight || "0");

  const kg = weightKg || 75;
  const trainingDaysPerWeek = profile.trainingDays.length || 3;

  const activityMultiplier =
    profile.intensity === "athlete"
      ? 1.725
      : profile.intensity === "intermediate"
      ? 1.55
      : 1.375;

  let calories = Math.round(kg * 22 * activityMultiplier);

  if (profile.goal === "build") calories = Math.round(calories * 1.1);
  if (profile.goal === "recomp") calories = Math.round(calories * 0.95);
  if (profile.goal === "performance") calories = Math.round(calories * 1.08);

  if (trainingDaysPerWeek >= 5) calories = Math.round(calories * 1.05);
  if (trainingDaysPerWeek <= 2) calories = Math.round(calories * 0.95);

  let proteinMultiplier = 2.0;
  if (profile.goal === "build") proteinMultiplier = 2.2;
  if (profile.goal === "recomp") proteinMultiplier = 2.3;
  if (profile.goal === "performance" && profile.trainingType === "endurance") {
    proteinMultiplier = 1.8;
  }

  const protein = Math.round(kg * proteinMultiplier);
  const roundedCalories = Math.round(calories / 50) * 50;

  return { calories: roundedCalories, protein };
}

function StepGoal({
  value,
  onChange,
  onNext,
  insets,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  insets: { top: number; bottom: number };
}) {
  const goals = [
    {
      key: "performance",
      label: "perform better",
      sub: "train harder, recover faster",
    },
    {
      key: "build",
      label: "build muscle",
      sub: "maximize strength and size",
    },
    {
      key: "recomp",
      label: "recompose",
      sub: "lose fat, preserve muscle",
    },
    {
      key: "maintain",
      label: "maintain",
      sub: "stay where I am",
    },
  ];

  const handleSelect = (key: string) => {
    onChange(key);
    setTimeout(onNext, 180);
  };

  return (
    <StepContainer insets={insets}>
      <View style={{ marginBottom: 40 }}>
        <Text
          style={{
            fontFamily: fontFamily.bold,
            fontSize: 28,
            color: "#FFFFFF",
            letterSpacing: -0.5,
          }}
        >
          what's your goal?
        </Text>
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 15,
            color: "rgba(255,255,255,0.45)",
            marginTop: 8,
          }}
        >
          this shapes your entire experience
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        {goals.map((g) => (
          <Pressable
            key={g.key}
            onPress={() => handleSelect(g.key)}
            style={({ pressed }) => ({
              backgroundColor:
                value === g.key
                  ? "rgba(255,255,255,0.07)"
                  : "#10111C",
              borderWidth: 1,
              borderColor:
                value === g.key
                  ? "rgba(255,255,255,0.30)"
                  : "rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 18,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            <View>
              <Text
                style={{
                  fontFamily: fontFamily.semibold,
                  fontSize: 16,
                  color:
                    value === g.key
                      ? "#FFFFFF"
                      : "rgba(255,255,255,0.72)",
                }}
              >
                {g.label}
              </Text>
              <Text
                style={{
                  fontFamily: fontFamily.regular,
                  fontSize: 13,
                  color: "rgba(255,255,255,0.35)",
                  marginTop: 3,
                }}
              >
                {g.sub}
              </Text>
            </View>
            {value === g.key && (
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  backgroundColor: "#3DDC84",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Feather name="check" size={12} color="#080810" />
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </StepContainer>
  );
}

function StepBody({
  profile,
  onChange,
  onNext,
  onBack,
  insets,
}: {
  profile: { name: string; weight: string; units: "metric" | "imperial" };
  onChange: (patch: any) => void;
  onNext: () => void;
  onBack: () => void;
  insets: { top: number; bottom: number };
}) {
  const [focused, setFocused] = useState<string | null>(null);

  const inputStyle = (field: string) => ({
    backgroundColor: "#10111C",
    borderWidth: 1,
    borderColor:
      focused === field
        ? "rgba(255,255,255,0.30)"
        : "rgba(255,255,255,0.12)",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fontFamily.regular,
    fontSize: 16,
    color: "#FFFFFF",
  } as const);

  const canContinue = !!profile.weight.trim();

  return (
    <StepContainer insets={insets}>
      <BackButton onPress={onBack} />

      <Text
        style={{
          fontFamily: fontFamily.bold,
          fontSize: 28,
          color: "#FFFFFF",
          letterSpacing: -0.5,
          marginBottom: 6,
        }}
      >
        about you
      </Text>
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 15,
          color: "rgba(255,255,255,0.45)",
          marginBottom: 32,
        }}
      >
        used to calculate your baseline energy needs
      </Text>

      <SectionLabel>weight</SectionLabel>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <TextInput
          placeholder={profile.units === "metric" ? "75" : "165"}
          placeholderTextColor="rgba(255,255,255,0.2)"
          value={profile.weight}
          onChangeText={(v) => onChange({ weight: v })}
          keyboardType="decimal-pad"
          onFocus={() => setFocused("weight")}
          onBlur={() => setFocused(null)}
          style={[inputStyle("weight"), { flex: 1 }]}
        />
        <View
          style={{
            flexDirection: "row",
            backgroundColor: "#10111C",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {(["metric", "imperial"] as const).map((u) => (
            <Pressable
              key={u}
              onPress={() => onChange({ units: u })}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 14,
                backgroundColor:
                  profile.units === u
                    ? "rgba(255,255,255,0.10)"
                    : "transparent",
              }}
            >
              <Text
                style={{
                  fontFamily: fontFamily.medium,
                  fontSize: 13,
                  color:
                    profile.units === u
                      ? "#FFFFFF"
                      : "rgba(255,255,255,0.35)",
                }}
              >
                {u === "metric" ? "kg" : "lbs"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <SectionLabel>name (optional)</SectionLabel>
      <TextInput
        placeholder="your name"
        placeholderTextColor="rgba(255,255,255,0.2)"
        value={profile.name}
        onChangeText={(v) => onChange({ name: v })}
        autoCapitalize="words"
        onFocus={() => setFocused("name")}
        onBlur={() => setFocused(null)}
        style={inputStyle("name")}
      />
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 12,
          color: "rgba(255,255,255,0.25)",
          marginTop: 6,
        }}
      >
        used for your coaching messages
      </Text>

      <PrimaryButton
        label="continue"
        onPress={onNext}
        disabled={!canContinue}
      />
    </StepContainer>
  );
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function DayPicker({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (days: number[]) => void;
}) {
  const toggle = (i: number) => {
    const next = selected.includes(i)
      ? selected.filter((d) => d !== i)
      : [...selected, i];
    onChange(next);
  };

  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        marginTop: 4,
      }}
    >
      {DAY_LABELS.map((label, i) => {
        const active = selected.includes(i);
        return (
          <Pressable
            key={i}
            onPress={() => toggle(i)}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 999,
              backgroundColor: active ? "#3DDC84" : "#10111C",
              borderWidth: 1,
              borderColor: active
                ? "#3DDC84"
                : "rgba(255,255,255,0.12)",
              justifyContent: "center",
              alignItems: "center",
              transform: [{ scale: pressed ? 0.92 : 1 }],
            })}
          >
            <Text
              style={{
                fontFamily: fontFamily.medium,
                fontSize: 13,
                color: active
                  ? "#080810"
                  : "rgba(255,255,255,0.45)",
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StepTraining({
  profile,
  onChange,
  onNext,
  onBack,
  insets,
}: {
  profile: {
    trainingType: string;
    trainingDays: number[];
    intensity: string;
  };
  onChange: (patch: any) => void;
  onNext: () => void;
  onBack: () => void;
  insets: { top: number; bottom: number };
}) {
  const trainingTypes = [
    {
      key: "strength",
      label: "strength",
      sub: "weights, powerlifting, CrossFit",
    },
    {
      key: "endurance",
      label: "endurance",
      sub: "running, cycling, swimming",
    },
    { key: "both", label: "both", sub: "mixed training" },
  ];

  const intensities = [
    { key: "beginner", label: "beginner", sub: "0–2 years training" },
    {
      key: "intermediate",
      label: "intermediate",
      sub: "2–5 years training",
    },
    {
      key: "athlete",
      label: "athlete",
      sub: "5+ years, competitive",
    },
  ];

  const canContinue =
    !!profile.trainingType &&
    profile.trainingDays.length > 0 &&
    !!profile.intensity;

  return (
    <StepContainer insets={insets}>
      <BackButton onPress={onBack} />

      <Text
        style={{
          fontFamily: fontFamily.bold,
          fontSize: 28,
          color: "#FFFFFF",
          letterSpacing: -0.5,
          marginBottom: 6,
        }}
      >
        how you train
      </Text>
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 15,
          color: "rgba(255,255,255,0.45)",
          marginBottom: 8,
        }}
      >
        this sets your macro split and daily targets
      </Text>

      <SectionLabel>training type</SectionLabel>
      <View style={{ gap: 8 }}>
        {trainingTypes.map((t) => (
          <Pill
            key={t.key}
            label={t.label}
            sub={t.sub}
            selected={profile.trainingType === t.key}
            onPress={() => onChange({ trainingType: t.key })}
          />
        ))}
      </View>

      <SectionLabel>training days</SectionLabel>
      <DayPicker
        selected={profile.trainingDays}
        onChange={(days) => onChange({ trainingDays: days })}
      />
      {profile.trainingDays.length > 0 && (
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 12,
            color: "rgba(255,255,255,0.35)",
            marginTop: 10,
          }}
        >
          {profile.trainingDays.length} day
          {profile.trainingDays.length !== 1 ? "s" : ""} per week
        </Text>
      )}

      <SectionLabel>experience level</SectionLabel>
      <View style={{ gap: 8 }}>
        {intensities.map((i) => (
          <Pill
            key={i.key}
            label={i.label}
            sub={i.sub}
            selected={profile.intensity === i.key}
            onPress={() => onChange({ intensity: i.key })}
          />
        ))}
      </View>

      <PrimaryButton
        label="continue"
        onPress={onNext}
        disabled={!canContinue}
      />
    </StepContainer>
  );
}

function StepWhoop({
  profile,
  onConnected,
  onSkip,
  onBack,
  insets,
}: {
  profile: { trainingDays: number[]; whoopConnected: boolean };
  onConnected: () => void;
  onSkip: () => void;
  onBack: () => void;
  insets: { top: number; bottom: number };
}) {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(profile.whoopConnected);

  const daysLabel =
    profile.trainingDays.length > 0
      ? `${profile.trainingDays.length} training days`
      : "your training schedule";

  const handleConnect = async () => {
    setConnecting(true);
    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "";
    const result = await WebBrowser.openAuthSessionAsync(
      `${apiUrl}/auth/whoop`,
      "moment://",
    );
    setConnecting(false);
    if (result.type === "success") {
      await supabase.auth.updateUser({ data: { whoop_connected: true } });
      setConnected(true);
      setTimeout(onConnected, 1000);
    }
  };

  return (
    <StepContainer insets={insets}>
      <BackButton onPress={onBack} />

      <View style={{ marginBottom: 24 }}>
        <Wordmark />
      </View>

      <Text
        style={{
          fontFamily: fontFamily.bold,
          fontSize: 22,
          color: "#FFFFFF",
          letterSpacing: -0.3,
          marginBottom: 10,
        }}
      >
        targets that adapt daily
      </Text>

      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 15,
          color: "rgba(255,255,255,0.55)",
          lineHeight: 22,
          marginBottom: 28,
        }}
      >
        You've set up {daysLabel}. Connect WHOOP and your targets will adjust
        automatically based on your actual strain and recovery — not just the
        schedule.
      </Text>

      {[
        "calorie targets adjust to your real strain score daily",
        "meal timing responds to your HRV and recovery",
        "post-workout refuel guidance triggered automatically",
      ].map((b, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <View
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              backgroundColor: "#3DDC84",
              marginTop: 7,
            }}
          />
          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 14,
              color: "rgba(255,255,255,0.60)",
              lineHeight: 21,
              flex: 1,
            }}
          >
            {b}
          </Text>
        </View>
      ))}

      <View style={{ marginTop: 36 }}>
        {connected ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              justifyContent: "center",
              height: 52,
            }}
          >
            <Feather name="check-circle" size={22} color="#3DDC84" />
            <Text
              style={{
                fontFamily: fontFamily.bold,
                fontSize: 15,
                color: "#3DDC84",
              }}
            >
              connected
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={handleConnect}
            disabled={connecting}
            style={{
              height: 52,
              backgroundColor: "#3DDC84",
              borderRadius: 14,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {connecting ? (
              <ActivityIndicator color="#080810" />
            ) : (
              <Text
                style={{
                  fontFamily: fontFamily.bold,
                  fontSize: 15,
                  color: "#080810",
                }}
              >
                connect WHOOP
              </Text>
            )}
          </Pressable>
        )}

        <Pressable
          onPress={onSkip}
          style={{
            marginTop: 16,
            alignSelf: "center",
            minHeight: 44,
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 13,
              color: "rgba(255,255,255,0.30)",
              textAlign: "center",
            }}
          >
            skip — connect later in profile
          </Text>
        </Pressable>
      </View>
    </StepContainer>
  );
}

function StepTargets({
  profile,
  onChange,
  onNext,
  onBack,
  insets,
}: {
  profile: {
    goal: string;
    weight: string;
    units: "metric" | "imperial";
    trainingType: string;
    trainingDays: number[];
    intensity: string;
    calorieOverride: string;
    proteinOverride: string;
  };
  onChange: (patch: any) => void;
  onNext: () => void;
  onBack: () => void;
  insets: { top: number; bottom: number };
}) {
  const [showOverride, setShowOverride] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  const calculated = calculateTargets(profile);
  const calories = profile.calorieOverride
    ? parseInt(profile.calorieOverride)
    : calculated.calories;
  const protein = profile.proteinOverride
    ? parseInt(profile.proteinOverride)
    : calculated.protein;

  const goalLabels: Record<string, string> = {
    performance: "performance goal",
    build: "muscle building goal",
    recomp: "recomposition goal",
    maintain: "maintenance goal",
  };
  const weightDisplay = profile.weight
    ? `${profile.weight}${
        profile.units === "metric" ? "kg" : "lbs"
      }`
    : null;
  const trainingDisplay =
    profile.trainingDays.length > 0
      ? `${profile.trainingDays.length}× training per week`
      : null;

  const explanationParts = [
    goalLabels[profile.goal],
    weightDisplay,
    trainingDisplay,
    profile.intensity || null,
  ].filter(Boolean) as string[];

  return (
    <StepContainer insets={insets}>
      <BackButton onPress={onBack} />

      <Text
        style={{
          fontFamily: fontFamily.bold,
          fontSize: 28,
          color: "#FFFFFF",
          letterSpacing: -0.5,
          marginBottom: 6,
        }}
      >
        your starting targets
      </Text>
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 15,
          color: "rgba(255,255,255,0.45)",
          marginBottom: 32,
        }}
      >
        calculated from your profile — adjusts daily with WHOOP
      </Text>

      <View
        style={{
          backgroundColor: "#10111C",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.12)",
          borderRadius: 18,
          padding: 20,
          gap: 16,
          marginBottom: 16,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <Text
            style={{
              fontFamily: fontFamily.light,
              fontSize: 13,
              color: "rgba(255,255,255,0.45)",
              textTransform: "uppercase",
              letterSpacing: 1.5,
            }}
          >
            Calories
          </Text>
          <Text
            style={{
              fontFamily: fontFamily.bold,
              fontSize: 36,
              color: "#FFFFFF",
              letterSpacing: -1,
            }}
          >
            {calories.toLocaleString()}
          </Text>
        </View>

        <View
          style={{
            height: 1,
            backgroundColor: "rgba(255,255,255,0.07)",
          }}
        />

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <Text
            style={{
              fontFamily: fontFamily.light,
              fontSize: 13,
              color: "rgba(255,255,255,0.45)",
              textTransform: "uppercase",
              letterSpacing: 1.5,
            }}
          >
            Protein
          </Text>
          <Text
            style={{
              fontFamily: fontFamily.bold,
              fontSize: 36,
              color: "#3DDC84",
              letterSpacing: -1,
            }}
          >
            {protein}g
          </Text>
        </View>
      </View>

      {explanationParts.length > 0 && (
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 13,
            color: "rgba(255,255,255,0.30)",
            lineHeight: 18,
            marginBottom: 20,
          }}
        >
          Based on: {explanationParts.join(" · ")}
        </Text>
      )}

      <Pressable
        onPress={() => setShowOverride((v) => !v)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          alignSelf: "flex-start",
          minHeight: 36,
          marginBottom: showOverride ? 16 : 0,
        }}
      >
        <Text
          style={{
            fontFamily: fontFamily.medium,
            fontSize: 13,
            color: "rgba(255,255,255,0.40)",
          }}
        >
          {showOverride ? "use calculated" : "adjust manually"}
        </Text>
        <Feather
          name={showOverride ? "chevron-up" : "chevron-down"}
          size={14}
          color="rgba(255,255,255,0.30)"
        />
      </Pressable>

      {showOverride && (
        <View style={{ gap: 10 }}>
          <TextInput
            placeholder={`calories (suggested: ${calculated.calories.toLocaleString()})`}
            placeholderTextColor="rgba(255,255,255,0.20)"
            value={profile.calorieOverride}
            onChangeText={(v) => onChange({ calorieOverride: v })}
            keyboardType="numeric"
            onFocus={() => setFocused("calories")}
            onBlur={() => setFocused(null)}
            style={{
              backgroundColor: "#10111C",
              borderWidth: 1,
              borderColor:
                focused === "calories"
                  ? "rgba(255,255,255,0.30)"
                  : "rgba(255,255,255,0.12)",
              borderRadius: 14,
              paddingHorizontal: 16,
              paddingVertical: 14,
              fontFamily: fontFamily.regular,
              fontSize: 16,
              color: "#FFFFFF",
            }}
          />
          <TextInput
            placeholder={`protein in grams (suggested: ${calculated.protein}g)`}
            placeholderTextColor="rgba(255,255,255,0.20)"
            value={profile.proteinOverride}
            onChangeText={(v) => onChange({ proteinOverride: v })}
            keyboardType="numeric"
            onFocus={() => setFocused("protein")}
            onBlur={() => setFocused(null)}
            style={{
              backgroundColor: "#10111C",
              borderWidth: 1,
              borderColor:
                focused === "protein"
                  ? "rgba(255,255,255,0.30)"
                  : "rgba(255,255,255,0.12)",
              borderRadius: 14,
              paddingHorizontal: 16,
              paddingVertical: 14,
              fontFamily: fontFamily.regular,
              fontSize: 16,
              color: "#FFFFFF",
            }}
          />
        </View>
      )}

      <PrimaryButton label="looks right" onPress={onNext} />
    </StepContainer>
  );
}

function StepSMS({
  phone,
  onChange,
  onNext,
  onBack,
  submitting,
  insets,
}: {
  phone: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  submitting: boolean;
  insets: { top: number; bottom: number };
}) {
  const [focused, setFocused] = useState(false);

  return (
    <StepContainer insets={insets}>
      <BackButton onPress={onBack} />

      <Text
        style={{
          fontFamily: fontFamily.bold,
          fontSize: 28,
          color: "#FFFFFF",
          letterSpacing: -0.5,
          marginBottom: 6,
        }}
      >
        get coached by text
      </Text>
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 15,
          color: "rgba(255,255,255,0.45)",
          marginBottom: 32,
          lineHeight: 22,
        }}
      >
        Log meals and get real-time feedback by SMS. Your AI nutrition coach
        lives in your messages.
      </Text>

      {[
        'text any meal to log it — "just had chicken and rice"',
        "get immediate macro feedback and coaching",
        "post-workout refuel suggestions sent automatically",
      ].map((b, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <View
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              backgroundColor: "#5B9CF6",
              marginTop: 7,
            }}
          />
          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 14,
              color: "rgba(255,255,255,0.60)",
              lineHeight: 21,
              flex: 1,
            }}
          >
            {b}
          </Text>
        </View>
      ))}

      <View style={{ marginTop: 28 }}>
        <TextInput
          placeholder="+61 4xx xxx xxx"
          placeholderTextColor="rgba(255,255,255,0.20)"
          value={phone}
          onChangeText={onChange}
          keyboardType="phone-pad"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            backgroundColor: "#10111C",
            borderWidth: 1,
            borderColor:
              focused
                ? "rgba(255,255,255,0.30)"
                : "rgba(255,255,255,0.12)",
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 14,
            fontFamily: fontFamily.regular,
            fontSize: 16,
            color: "#FFFFFF",
          }}
        />
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 12,
            color: "rgba(255,255,255,0.25)",
            marginTop: 8,
          }}
        >
          optional — you can add this later in profile
        </Text>
      </View>

      <PrimaryButton
        label={phone.trim() ? "set up SMS coaching" : "skip for now"}
        onPress={onNext}
        loading={submitting}
      />
    </StepContainer>
  );
}

export default function OnboardingIndex() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const initialStepParam = params.startStep
    ? parseInt(params.startStep as string)
    : 0;
  const initialStep = Number.isNaN(initialStepParam)
    ? 0
    : Math.min(Math.max(initialStepParam, 0), 5);

  const [step, setStep] = useState(initialStep);
  const [submitting, setSubmitting] = useState(false);

  const [profile, setProfile] = useState({
    goal: "" as "performance" | "build" | "recomp" | "maintain" | "",
    name: "",
    weight: "",
    units: "metric" as "metric" | "imperial",
    trainingType: "" as "strength" | "endurance" | "both" | "",
    trainingDays: [] as number[],
    intensity: "" as "beginner" | "intermediate" | "athlete" | "",
    whoopConnected: false,
    calorieOverride: "",
    proteinOverride: "",
    phone: "",
  });

  const updateProfile = (patch: Partial<typeof profile>) =>
    setProfile((prev) => ({ ...prev, ...patch }));

  const next = () => setStep((s) => Math.min(s + 1, 5));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const handleFinish = async () => {
    setSubmitting(true);
    const calculated = calculateTargets(profile);
    const finalCalories = profile.calorieOverride
      ? parseInt(profile.calorieOverride)
      : calculated.calories;
    const finalProtein = profile.proteinOverride
      ? parseInt(profile.proteinOverride)
      : calculated.protein;

    await supabase.auth.updateUser({
      data: {
        onboarding_complete: true,
        name: profile.name.trim() || null,
        weight_kg:
          profile.units === "imperial"
            ? parseFloat(profile.weight || "0") * 0.453592
            : parseFloat(profile.weight || "0") || null,
        units: profile.units,
        goal_mode: profile.goal,
        training_type: profile.trainingType,
        training_days: profile.trainingDays,
        intensity: profile.intensity,
        whoop_connected: profile.whoopConnected,
        calorie_target: finalCalories,
        protein_target: finalProtein,
        phone: profile.phone.trim() || null,
      },
    });

    router.replace("/(app)/home");
  };

  const TOTAL_STEPS = 6;

  return (
    <View style={{ flex: 1, backgroundColor: "#080810" }}>
      <View style={{ paddingTop: insets.top }}>
        <ProgressBar step={step} total={TOTAL_STEPS} />
      </View>

      {step === 0 && (
        <StepGoal
          value={profile.goal}
          onChange={(goal) => updateProfile({ goal: goal as any })}
          onNext={next}
          insets={{ top: 0, bottom: insets.bottom }}
        />
      )}
      {step === 1 && (
        <StepBody
          profile={profile}
          onChange={updateProfile}
          onNext={next}
          onBack={back}
          insets={{ top: 0, bottom: insets.bottom }}
        />
      )}
      {step === 2 && (
        <StepTraining
          profile={profile}
          onChange={updateProfile}
          onNext={next}
          onBack={back}
          insets={{ top: 0, bottom: insets.bottom }}
        />
      )}
      {step === 3 && (
        <StepWhoop
          profile={profile}
          onConnected={() => {
            updateProfile({ whoopConnected: true });
            next();
          }}
          onSkip={next}
          onBack={back}
          insets={{ top: 0, bottom: insets.bottom }}
        />
      )}
      {step === 4 && (
        <StepTargets
          profile={profile}
          onChange={updateProfile}
          onNext={next}
          onBack={back}
          insets={{ top: 0, bottom: insets.bottom }}
        />
      )}
      {step === 5 && (
        <StepSMS
          phone={profile.phone}
          onChange={(phone) => updateProfile({ phone })}
          onNext={handleFinish}
          onBack={back}
          submitting={submitting}
          insets={{ top: 0, bottom: insets.bottom }}
        />
      )}
    </View>
  );
}
