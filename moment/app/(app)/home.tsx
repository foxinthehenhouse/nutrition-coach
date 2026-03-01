import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Animated,
  Easing,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { logFood } from "../../lib/api";
import { GlowRing } from "../../components/ui/GlowRing";
import { InputBar } from "../../components/ui/InputBar";
import { StatPill } from "../../components/ui/StatPill";
import { colors, fontFamily, recoveryColor } from "../../lib/theme";

const QUICK_PILLS = [
  "post-workout 🥩",
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "coffee",
];

function PulsingPlaceholder() {
  const opacity = useRef(new Animated.Value(0.15)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.15,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        height: 52,
        width: "80%",
        backgroundColor: "#111111",
        borderRadius: 8,
        opacity,
      }}
    />
  );
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const todayStr = new Date().toISOString().split("T")[0];

  const [foodLog, setFoodLog] = useState<any[]>([]);
  const [whoopData, setWhoopData] = useState<any>(null);
  const [dailyPlan, setDailyPlan] = useState<any>(null);
  const [userMeta, setUserMeta] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const loadData = useCallback(async () => {
    const [whoopRes, foodRes, planRes, userRes] = await Promise.all([
      supabase
        .from("whoop_cache")
        .select("*")
        .eq("date", todayStr)
        .maybeSingle(),
      supabase
        .from("food_log")
        .select("*")
        .eq("date", todayStr)
        .order("time", { ascending: true }),
      supabase
        .from("daily_plans")
        .select("*")
        .eq("date", todayStr)
        .maybeSingle(),
      supabase.auth.getUser(),
    ]);

    setWhoopData(whoopRes.data);
    setFoodLog(foodRes.data ?? []);
    setDailyPlan(planRes.data);
    setUserMeta(userRes.data?.user?.user_metadata ?? {});
    setIsLoading(false);
  }, [todayStr]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const calorieTarget =
    dailyPlan?.calorie_target ??
    userMeta?.calorie_target ??
    (() => {
      const strain = whoopData?.strain_score;
      if (!strain) return 2500;
      if (strain >= 17) return 3100;
      if (strain >= 13) return 2900;
      if (strain <= 7) return 2200;
      return 2500;
    })();

  const proteinTarget =
    dailyPlan?.protein_target_g ?? userMeta?.protein_target ?? 160;

  const totalCalories = foodLog.reduce(
    (sum, r) => sum + (r.calories ?? 0),
    0
  );
  const totalProtein = foodLog.reduce(
    (sum, r) => sum + (Number(r.protein_g) ?? 0),
    0
  );
  const totalCarbs = foodLog.reduce(
    (sum, r) => sum + (Number(r.carbs_g) ?? 0),
    0
  );
  const totalFat = foodLog.reduce(
    (sum, r) => sum + (Number(r.fat_g) ?? 0),
    0
  );
  const caloriesLeft = Math.max(0, calorieTarget - totalCalories);

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setInput("");

    const optimistic = {
      id: `opt-${Date.now()}`,
      description: trimmed,
      calories: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      time: new Date().toTimeString().slice(0, 8),
      meal_type: null,
      date: todayStr,
    };
    setFoodLog((prev) => [...prev, optimistic]);

    try {
      await logFood(trimmed);
      const { data } = await supabase
        .from("food_log")
        .select("*")
        .eq("date", todayStr)
        .order("time", { ascending: true });
      setFoodLog(data ?? []);
    } catch (e) {
      setFoodLog((prev) => prev.filter((r) => r.id !== optimistic.id));
      console.error("[moment] send failed:", e);
    } finally {
      setSending(false);
    }
  };

  const handleCamera = () => {
    console.log("[moment] camera — coming soon");
  };

  const handleVoice = () => {
    console.log("[moment] voice — coming soon");
  };

  const renderBiometricHeader = () => {
    if (isLoading) {
      return <PulsingPlaceholder />;
    }

    if (whoopData?.recovery_score != null) {
      const score = whoopData.recovery_score;
      const insight =
        score > 67
          ? "good day to push."
          : score >= 34
            ? "moderate intensity today."
            : "prioritise rest and recovery.";

      return (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <GlowRing
              size={52}
              progress={score / 100}
              color={recoveryColor(score)}
              centerLabel=""
            />
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <StatPill
                  value={`${Math.round(score)}`}
                  label="rec"
                  color={recoveryColor(score)}
                />
                <StatPill
                  value={
                    whoopData.hrv_rmssd
                      ? `${Math.round(whoopData.hrv_rmssd)}`
                      : "–"
                  }
                  label="hrv"
                />
                <StatPill
                  value={
                    whoopData.strain_score
                      ? whoopData.strain_score.toFixed(1)
                      : "–"
                  }
                  label="strain"
                />
              </View>
            </View>
          </View>
          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 12,
              color: "#3a3a3a",
              fontStyle: "italic",
              marginTop: 8,
            }}
          >
            {insight}
          </Text>
        </View>
      );
    }

    return (
      <Pressable onPress={() => router.push("/(onboarding)/whoop")}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              backgroundColor: "#f59e0b",
            }}
          />
          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 13,
              color: "#3a3a3a",
            }}
          >
            connect WHOOP for adaptive targets
          </Text>
        </View>
      </Pressable>
    );
  };

  const renderFoodItem = ({ item }: { item: any }) => (
    <View>
      <View style={{ paddingHorizontal: 20, paddingVertical: 14 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <View style={{ flex: 1, marginRight: 16 }}>
            <Text
              numberOfLines={3}
              style={{
                fontFamily: fontFamily.regular,
                fontSize: 15,
                color: "#f0f0f0",
              }}
            >
              {item.description}
            </Text>
            <Text
              style={{
                fontFamily: fontFamily.regular,
                fontSize: 12,
                color: "#2a2a2a",
                marginTop: 5,
              }}
            >
              {`P${Math.round(item.protein_g ?? 0)}  C${Math.round(item.carbs_g ?? 0)}  F${Math.round(item.fat_g ?? 0)}`}
            </Text>
            {item.meal_type ? (
              <View
                style={{
                  backgroundColor: "#0f0f0f",
                  borderWidth: 1,
                  borderColor: "#111111",
                  borderRadius: 999,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  alignSelf: "flex-start",
                  marginTop: 6,
                }}
              >
                <Text
                  style={{
                    fontFamily: fontFamily.regular,
                    fontSize: 11,
                    color: "#282828",
                  }}
                >
                  {item.meal_type}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text
              style={{
                fontFamily: fontFamily.bold,
                fontSize: 16,
                color: "#f0f0f0",
              }}
            >
              {`${item.calories ?? 0}`}
            </Text>
            <Text
              style={{
                fontFamily: fontFamily.regular,
                fontSize: 11,
                color: "#282828",
                marginTop: 3,
              }}
            >
              {item.time?.slice(0, 5) ?? ""}
            </Text>
          </View>
        </View>
      </View>
      <View
        style={{
          height: 1,
          backgroundColor: "#111111",
          marginHorizontal: 20,
        }}
      />
    </View>
  );

  const calProgress = Math.min(totalCalories / calorieTarget, 1);
  const ringColor =
    totalCalories >= calorieTarget
      ? "#a8edea"
      : recoveryColor(Math.round(calProgress * 100));

  return (
    <View style={{ flex: 1, backgroundColor: "#080808" }}>
      {/* Zone A — Biometric Header */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 16,
          borderBottomWidth: 1,
          borderBottomColor: "#111111",
        }}
      >
        {renderBiometricHeader()}
      </View>

      {/* Zone B — Input */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 8,
        }}
      >
        <InputBar
          value={input}
          onChangeText={setInput}
          onSend={handleSend}
          onCamera={handleCamera}
          onVoice={handleVoice}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 12 }}
          contentContainerStyle={{ gap: 8, paddingRight: 4 }}
        >
          {QUICK_PILLS.map((label) => (
            <Pressable key={label} onPress={() => setInput(label)}>
              <View
                style={{
                  backgroundColor: "#0f0f0f",
                  borderWidth: 1,
                  borderColor: "#1c1c1c",
                  borderRadius: 999,
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                }}
              >
                <Text
                  style={{
                    fontFamily: fontFamily.regular,
                    fontSize: 13,
                    color: "#3a3a3a",
                  }}
                >
                  {label}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Zone C — Food Log */}
      <FlatList
        style={{ flex: 1 }}
        data={foodLog}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingTop: 4,
          paddingBottom: 16,
          flexGrow: 1,
        }}
        ListEmptyComponent={
          !isLoading ? (
            <View style={{ flex: 1, paddingTop: 48, alignItems: "center" }}>
              <Text
                style={{
                  fontFamily: fontFamily.regular,
                  fontSize: 14,
                  color: "#282828",
                }}
              >
                nothing logged yet.
              </Text>
            </View>
          ) : null
        }
        renderItem={renderFoodItem}
      />

      {/* Macro Bar — Persistent Bottom */}
      <View
        style={{
          backgroundColor: "#080808",
          borderTopWidth: 1,
          borderTopColor: "#111111",
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 10,
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
        >
          <GlowRing
            size={36}
            progress={calProgress}
            color={ringColor}
            centerLabel=""
          />
          <View style={{ flex: 1 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "baseline",
                gap: 5,
              }}
            >
              <Text
                style={{
                  fontFamily: fontFamily.bold,
                  fontSize: 16,
                  color: "#f0f0f0",
                }}
              >
                {`${totalCalories}`}
              </Text>
              <Text
                style={{
                  fontFamily: fontFamily.regular,
                  fontSize: 13,
                  color: "#444444",
                }}
              >
                cal
              </Text>
              <Text
                style={{
                  fontFamily: fontFamily.regular,
                  fontSize: 13,
                  color: "#282828",
                  marginLeft: 4,
                }}
              >
                {`${caloriesLeft} left`}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <Text
              style={{
                fontFamily: fontFamily.bold,
                fontSize: 14,
                color: "#3b82f6",
              }}
            >
              {`${Math.round(totalProtein)}g`}
            </Text>
            <Text
              style={{
                fontFamily: fontFamily.regular,
                fontSize: 13,
                color: "#444444",
              }}
            >
              {" protein"}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
