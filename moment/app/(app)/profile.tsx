import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { colors, fontFamily, radius, spacing } from "../../lib/theme";

const GOALS = [
  { id: "maintenance", label: "maintenance", description: "Maintain weight and energy. Steady calories and protein." },
  { id: "performance", label: "performance", description: "Maximize training output and recovery. Higher calories and protein on training days." },
  { id: "recomp", label: "recomp", description: "Build muscle while staying lean. Moderate surplus with focus on protein." },
] as const;

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
          backgroundColor: selected ? "transparent" : "rgba(255,255,255,0.07)",
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? colors.textPrimary : "rgba(255,255,255,0.1)",
          borderRadius: 999,
          paddingHorizontal: 14,
          paddingVertical: 8,
        }}
      >
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 13,
            color: selected ? colors.textPrimary : "rgba(255,255,255,0.6)",
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: fontFamily.regular,
        fontSize: 11,
        color: colors.textTertiary,
        textTransform: "uppercase",
        letterSpacing: 1.5,
        marginTop: 24,
        marginBottom: 10,
      }}
    >
      {children}
    </Text>
  );
}

export default function Profile() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [calorieTarget, setCalorieTarget] = useState("");
  const [proteinTarget, setProteinTarget] = useState("");
  const [goalMode, setGoalMode] = useState("maintenance");
  const [phone, setPhone] = useState("");
  const [whoopConnected, setWhoopConnected] = useState(false);
  const [whoopData, setWhoopData] = useState<{ recovery_score?: number; strain_score?: number; hrv_rmssd?: number } | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [targetsSaved, setTargetsSaved] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const m = user.user_metadata ?? {};
      setEmail(user.email ?? "");
      setName(m.name ?? "");
      setCalorieTarget(m.calorie_target?.toString() ?? "");
      setProteinTarget(m.protein_target?.toString() ?? "");
      setGoalMode(m.goal_mode ?? "maintenance");
      setPhone(m.phone ?? "");
      setWhoopConnected(!!m.whoop_connected);
      const todayStr = new Date().toISOString().split("T")[0];
      const { data: whoop } = await supabase.from("whoop_cache").select("recovery_score, strain_score, hrv_rmssd").eq("date", todayStr).maybeSingle();
      setWhoopData(whoop ?? null);
      setLoading(false);
    })();
  }, []);

  const suggestedCal = 2900;
  const suggestedProtein = 190;
  const showSuggestion = !calorieTarget && !proteinTarget;

  const inputStyle = (field: string) => ({
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: focusedField === field ? "rgba(255,255,255,0.2)" : colors.borderSubtle,
    borderRadius: radius.input,
    paddingHorizontal: 20,
    paddingVertical: 16,
    height: 56,
    fontFamily: fontFamily.regular,
    fontSize: 20,
    color: colors.textPrimary,
  });

  const handleGoalChange = async (goal: string) => {
    setGoalMode(goal);
    await supabase.auth.updateUser({ data: { goal_mode: goal } });
  };

  const handleUseSuggested = () => {
    setCalorieTarget(String(suggestedCal));
    setProteinTarget(String(suggestedProtein));
  };

  const handleSaveTargets = async () => {
    const cal = parseInt(calorieTarget, 10);
    const prot = parseInt(proteinTarget, 10);
    await supabase.auth.updateUser({
      data: {
        ...(Number.isFinite(cal) && { calorie_target: cal }),
        ...(Number.isFinite(prot) && { protein_target: prot }),
      },
    });
    setTargetsSaved(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => setTargetsSaved(false), 2000);
  };

  const handleSavePhone = async () => {
    await supabase.auth.updateUser({ data: { phone } });
    setPhoneSaved(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => setPhoneSaved(false), 2000);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/(auth)");
  };

  const currentGoalDesc = GOALS.find((g) => g.id === goalMode)?.description ?? "";

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingHorizontal: spacing.contentPadding,
        paddingTop: insets.top + 24,
        paddingBottom: 60,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ fontFamily: fontFamily.regular, fontSize: 15, color: colors.textSecondary }}>
        {email}
      </Text>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
        <Pressable onPress={() => {}} hitSlop={8}>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.accentBlue }}>Edit profile</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textTertiary }}>|</Text>
        <Pressable onPress={handleSignOut} hitSlop={8}>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.accentBlue }}>Log out</Text>
        </Pressable>
      </View>

      <SectionLabel>Goal</SectionLabel>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          padding: spacing.cardPaddingH,
          marginHorizontal: 0,
          borderWidth: 1,
          borderColor: colors.borderSubtle,
        }}
      >
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {GOALS.map((g) => (
            <Pill
              key={g.id}
              label={g.label}
              selected={goalMode === g.id}
              onPress={() => handleGoalChange(g.id)}
            />
          ))}
        </View>
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 14,
            color: "rgba(255,255,255,0.6)",
            marginTop: 12,
            lineHeight: 20,
          }}
        >
          {currentGoalDesc}
        </Text>
      </View>

      <SectionLabel>Targets</SectionLabel>
      {showSuggestion && (
        <View
          style={{
            backgroundColor: colors.surfaceElevated,
            borderRadius: 12,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, color: colors.textSecondary }}>
            Based on your performance goal and WHOOP data, we suggest: {suggestedCal} cal · {suggestedProtein}g protein
          </Text>
          <Pressable
            onPress={handleUseSuggested}
            style={{ alignSelf: "flex-start", marginTop: 8 }}
          >
            <Text style={{ fontFamily: fontFamily.bold, fontSize: 14, color: colors.accentBlue }}>Use these</Text>
          </Pressable>
        </View>
      )}
      <TextInput
        placeholder="calories"
        placeholderTextColor={colors.textTertiary}
        value={calorieTarget}
        onChangeText={setCalorieTarget}
        keyboardType="numeric"
        onFocus={() => setFocusedField("calories")}
        onBlur={() => setFocusedField(null)}
        style={[inputStyle("calories"), { marginBottom: 10 }]}
      />
      <TextInput
        placeholder="protein (g)"
        placeholderTextColor={colors.textTertiary}
        value={proteinTarget}
        onChangeText={setProteinTarget}
        keyboardType="numeric"
        onFocus={() => setFocusedField("protein")}
        onBlur={() => setFocusedField(null)}
        style={inputStyle("protein")}
      />
      <Pressable
        onPress={handleSaveTargets}
        style={{
          marginTop: 16,
          height: 56,
          borderRadius: radius.input,
          backgroundColor: colors.textPrimary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontFamily: fontFamily.bold, fontSize: 17, color: colors.bg }}>
          {targetsSaved ? "Saved ✓" : "Save targets"}
        </Text>
      </Pressable>

      <SectionLabel>Wearable</SectionLabel>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          padding: spacing.cardPaddingH,
          borderWidth: 1,
          borderColor: colors.borderSubtle,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontFamily: fontFamily.bold, fontSize: 15, color: colors.textPrimary }}>WHOOP</Text>
          {whoopConnected ? (
            <View style={{ backgroundColor: colors.greenDim, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
              <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.accentGreen }}>✓ Connected</Text>
            </View>
          ) : (
            <Pressable
              onPress={() => router.push("/(onboarding)/whoop")}
              style={{ backgroundColor: colors.textPrimary, paddingHorizontal: 24, paddingVertical: 8, borderRadius: 10 }}
            >
              <Text style={{ fontFamily: fontFamily.bold, fontSize: 13, color: colors.bg }}>Connect</Text>
            </Pressable>
          )}
        </View>
        {whoopConnected ? (
          <>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textTertiary, marginTop: 8 }}>
              Last sync: today
            </Text>
            {whoopData && (whoopData.recovery_score != null || whoopData.strain_score != null) && (
              <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary, marginTop: 4 }}>
                Recovery {whoopData.recovery_score != null ? `${Math.round(whoopData.recovery_score)}%` : "–"} · Strain {whoopData.strain_score != null ? whoopData.strain_score.toFixed(1) : "–"} · HRV {whoopData.hrv_rmssd != null ? Math.round(whoopData.hrv_rmssd) : "–"}
              </Text>
            )}
          </>
        ) : (
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
            Sync recovery, strain & HRV to personalize your daily calorie and protein targets.
          </Text>
        )}
      </View>

      <SectionLabel>SMS coaching</SectionLabel>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          padding: spacing.cardPaddingH,
          borderWidth: 1,
          borderColor: colors.borderSubtle,
        }}
      >
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>
          Log meals and get coaching by text. Reply to any message to chat with your AI nutrition coach.
        </Text>
        <TextInput
          placeholder="+61 4xx xxx xxx"
          placeholderTextColor={colors.textTertiary}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          onFocus={() => setFocusedField("phone")}
          onBlur={() => setFocusedField(null)}
          style={{
            ...inputStyle("phone"),
            marginBottom: 8,
            fontSize: 17,
          }}
        />
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Pressable onPress={handleSavePhone}>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: 14, color: colors.textPrimary }}>{phoneSaved ? "Saved ✓" : "Save"}</Text>
          </Pressable>
        </View>
        {phone && phoneSaved && (
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 12, color: colors.accentGreen, marginTop: 6 }}>
            Active — you can log via SMS
          </Text>
        )}
      </View>
    </ScrollView>
  );
}
