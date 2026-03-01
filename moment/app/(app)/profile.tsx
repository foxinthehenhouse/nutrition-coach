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
import { fontFamily } from "../../lib/theme";

const GOALS = ["maintenance", "performance", "recomp"] as const;

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

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: fontFamily.regular,
        fontSize: 10,
        color: "#282828",
        textTransform: "uppercase",
        letterSpacing: 3,
        marginTop: 40,
        marginBottom: 14,
      }}
    >
      {children}
    </Text>
  );
}

function SaveButton({
  onSave,
}: {
  onSave: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  const handlePress = async () => {
    setSaving(true);
    await onSave();
    setSaving(false);
    setSaved(true);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setSaved(false), 1500);
  };

  useEffect(() => {
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);

  if (saving) return <ActivityIndicator color="#f0f0f0" size="small" />;

  return (
    <Pressable onPress={handlePress}>
      <Text
        style={{
          fontFamily: saved ? fontFamily.regular : fontFamily.bold,
          fontSize: 14,
          color: saved ? "#22c55e" : "#f0f0f0",
        }}
      >
        {saved ? "saved ✓" : "save"}
      </Text>
    </Pressable>
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
  const [whoopSkipped, setWhoopSkipped] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const m = user.user_metadata ?? {};
      setEmail(user.email ?? "");
      setName(m.name ?? "");
      setCalorieTarget(m.calorie_target?.toString() ?? "");
      setProteinTarget(m.protein_target?.toString() ?? "");
      setGoalMode(m.goal_mode ?? "maintenance");
      setPhone(m.phone ?? "");
      setWhoopConnected(!!m.whoop_connected);
      setWhoopSkipped(!!m.whoop_skipped);
      setLoading(false);
    })();
  }, []);

  const inputStyle = (field: string) => ({
    backgroundColor: "#0f0f0f",
    borderWidth: 1,
    borderColor:
      focusedField === field ? "rgba(168,237,234,0.25)" : "#1c1c1c",
    borderRadius: 14,
    padding: 14,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: "#f0f0f0",
  });

  const handleGoalChange = async (goal: string) => {
    setGoalMode(goal);
    await supabase.auth.updateUser({ data: { goal_mode: goal } });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/(auth)");
  };

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#080808",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator color="#22c55e" />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: "#080808" }}
      contentContainerStyle={{
        paddingHorizontal: 24,
        paddingTop: insets.top + 32,
        paddingBottom: 60,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 13,
          color: "#444444",
        }}
      >
        {email}
      </Text>
      {name ? (
        <Text
          style={{
            fontFamily: fontFamily.bold,
            fontSize: 20,
            color: "#f0f0f0",
            marginTop: 4,
          }}
        >
          {name}
        </Text>
      ) : null}

      <SectionLabel>targets</SectionLabel>
      <TextInput
        placeholder="calories"
        placeholderTextColor="#282828"
        value={calorieTarget}
        onChangeText={setCalorieTarget}
        keyboardType="numeric"
        onFocus={() => setFocusedField("calories")}
        onBlur={() => setFocusedField(null)}
        style={[inputStyle("calories"), { marginBottom: 10 }]}
      />
      <TextInput
        placeholder="protein (g)"
        placeholderTextColor="#282828"
        value={proteinTarget}
        onChangeText={setProteinTarget}
        keyboardType="numeric"
        onFocus={() => setFocusedField("protein")}
        onBlur={() => setFocusedField(null)}
        style={inputStyle("protein")}
      />
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          marginTop: 8,
        }}
      >
        <SaveButton
          onSave={async () => {
            await supabase.auth.updateUser({
              data: {
                calorie_target: parseInt(calorieTarget),
                protein_target: parseInt(proteinTarget),
              },
            });
          }}
        />
      </View>

      <SectionLabel>goal</SectionLabel>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {GOALS.map((g) => (
          <Pill
            key={g}
            label={g}
            selected={goalMode === g}
            onPress={() => handleGoalChange(g)}
          />
        ))}
      </View>

      <SectionLabel>wearable</SectionLabel>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 15,
            color: "#f0f0f0",
          }}
        >
          WHOOP
        </Text>
        {whoopConnected ? (
          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 13,
              color: "#22c55e",
            }}
          >
            connected
          </Text>
        ) : (
          <Pressable onPress={() => router.push("/(onboarding)/whoop")}>
            <Text
              style={{
                fontFamily: fontFamily.regular,
                fontSize: 13,
                color: "#444444",
              }}
            >
              {"connect →"}
            </Text>
          </Pressable>
        )}
      </View>

      <SectionLabel>sms</SectionLabel>
      <TextInput
        placeholder="+61 4xx xxx xxx"
        placeholderTextColor="#282828"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        onFocus={() => setFocusedField("phone")}
        onBlur={() => setFocusedField(null)}
        style={inputStyle("phone")}
      />
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          marginTop: 8,
        }}
      >
        <SaveButton
          onSave={async () => {
            await supabase.auth.updateUser({ data: { phone } });
          }}
        />
      </View>
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 11,
          color: "#1e1e1e",
          marginTop: 6,
        }}
      >
        linked to your nutrition coach
      </Text>

      <Pressable onPress={handleSignOut} style={{ marginTop: 60 }}>
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 14,
            color: "#222222",
            textAlign: "center",
          }}
        >
          sign out
        </Text>
      </Pressable>
    </ScrollView>
  );
}
