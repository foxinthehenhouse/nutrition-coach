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
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
import { supabase } from "../../lib/supabase";
import { logFood, deleteFoodLogEntry } from "../../lib/api";
import { GlowRing } from "../../components/ui/GlowRing";
import { InputBar } from "../../components/ui/InputBar";
import { StatPill } from "../../components/ui/StatPill";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { Toast } from "../../components/ui/Toast";
import { SwipeableRow } from "../../components/ui/SwipeableRow";
import { FoodEntryDetailSheet } from "../../components/ui/FoodEntryDetailSheet";
import { colors, fontFamily, recoveryColor, proteinBarColor, spacing, radius, shadows } from "../../lib/theme";
import { getRangeTargets } from "../../lib/rangeTargets";

const MEAL_CHIPS = [
  "post-workout 🥩",
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "+ custom",
] as const;

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
  const [imageConfirmState, setImageConfirmState] = useState<{
    visible: boolean;
    smsConfirmation: string;
    analysis: {
      components: { food: string; portion_estimate: string; calories: number }[];
      totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
      meal_type: string;
      overall_confidence: string;
    } | null;
    pendingId: string;
    correctionInput: string;
    isLoading: boolean;
    correctionMode: boolean;
  }>({
    visible: false,
    smsConfirmation: "",
    analysis: null,
    pendingId: "",
    correctionInput: "",
    isLoading: false,
    correctionMode: false,
  });
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [selectedMealChip, setSelectedMealChip] = useState<string | null>(null);
  const [frequentMeals, setFrequentMeals] = useState<{ description: string }[]>([]);
  const [undoLogId, setUndoLogId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [foodEntryDetailId, setFoodEntryDetailId] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);

  const loadData = useCallback(async () => {
    const [whoopRes, foodRes, planRes, userRes, recentRes] = await Promise.all([
      supabase.from("whoop_cache").select("*").eq("date", todayStr).maybeSingle(),
      supabase.from("food_log").select("*").eq("date", todayStr).order("time", { ascending: true }),
      supabase.from("daily_plans").select("*").eq("date", todayStr).maybeSingle(),
      supabase.auth.getUser(),
      supabase.from("food_log").select("description").order("date", { ascending: false }).order("time", { ascending: false }).limit(100),
    ]);

    setWhoopData(whoopRes.data);
    setFoodLog(foodRes.data ?? []);
    setDailyPlan(planRes.data);
    setUserMeta(userRes.data?.user?.user_metadata ?? {});
    const recent = (recentRes.data as { description: string }[] | null) ?? [];
    const byDesc = new Map<string, { original: string; count: number }>();
    for (const r of recent) {
      const orig = (r.description ?? "").trim();
      const key = orig.toLowerCase();
      if (key) {
        const existing = byDesc.get(key);
        if (!existing) byDesc.set(key, { original: orig, count: 1 });
        else existing.count += 1;
      }
    }
    const top = Array.from(byDesc.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(({ original }) => ({ description: original }));
    setFrequentMeals(top);
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

  const baseCal = userMeta?.calorie_target ?? calorieTarget;
  const baseProtein = userMeta?.protein_target ?? proteinTarget;
  const strain = whoopData?.strain_score ?? 10;
  const recovery = whoopData?.recovery_score ?? 50;
  const range = getRangeTargets(baseCal, baseProtein, strain, recovery);

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
      const last = (data ?? [])[(data ?? []).length - 1];
      if (last) {
        setToastMessage(`${last.calories ?? 0} cal logged ✓`);
        setToastVisible(true);
      }
    } catch (e) {
      setFoodLog((prev) => prev.filter((r) => r.id !== optimistic.id));
      console.error("[moment] send failed:", e);
    } finally {
      setSending(false);
    }
  };

  const handleRepeatMeal = async (description: string) => {
    if (sending) return;
    setSending(true);
    try {
      await logFood(description);
      const { data } = await supabase
        .from("food_log")
        .select("*")
        .eq("date", todayStr)
        .order("time", { ascending: true });
      setFoodLog(data ?? []);
      const last = (data ?? [])[(data ?? []).length - 1];
      if (last?.id) setUndoLogId(last.id);
      setTimeout(() => setUndoLogId(null), 500);
    } catch (e) {
      console.error("[moment] repeat failed:", e);
    } finally {
      setSending(false);
    }
  };

  const handleCamera = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    const cameraStatus = await ImagePicker.requestCameraPermissionsAsync();

    Alert.alert("Add meal photo", "", [
      {
        text: "Take photo",
        onPress: async () => {
          if (cameraStatus.status !== "granted") {
            Alert.alert("Camera access required", "Enable camera access in Settings.");
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
            base64: false,
          });
          if (!result.canceled && result.assets[0]) {
            await processImageAsset(result.assets[0]);
          }
        },
      },
      {
        text: "Choose from library",
        onPress: async () => {
          if (status !== "granted") {
            Alert.alert("Photo library access required", "Enable in Settings.");
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
            base64: false,
          });
          if (!result.canceled && result.assets[0]) {
            await processImageAsset(result.assets[0]);
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const processImageAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    setImageConfirmState((prev) => ({
      ...prev,
      visible: true,
      isLoading: true,
      analysis: null,
      smsConfirmation: "",
    }));

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const pendingId = user?.id ?? "app_user";
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "";

      const formData = new FormData();
      formData.append(
        "file",
        {
          uri: asset.uri,
          name: "meal.jpg",
          type: asset.mimeType ?? "image/jpeg",
        } as any
      );
      formData.append("phone", pendingId);

      const res = await fetch(`${apiUrl}/api/food/image`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `Upload failed: ${res.status}`);
      }

      const data = await res.json();
      setImageConfirmState((prev) => ({
        ...prev,
        isLoading: false,
        smsConfirmation: data.sms_confirmation,
        analysis: data.analysis,
        pendingId,
        correctionInput: "",
        correctionMode: false,
      }));
    } catch (e) {
      setImageConfirmState((prev) => ({
        ...prev,
        visible: false,
        isLoading: false,
      }));
      Alert.alert(
        "Could not analyse photo",
        e instanceof Error ? e.message : "Try again or describe your meal in text."
      );
    }
  };

  const handleImageConfirm = async () => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "";
    setImageConfirmState((prev) => ({ ...prev, isLoading: true }));
    try {
      const res = await fetch(`${apiUrl}/api/food/image/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: imageConfirmState.pendingId,
          confirmed: true,
        }),
      });
      const data = await res.json();
      if (data.status === "logged") {
        setImageConfirmState({
          visible: false,
          smsConfirmation: "",
          analysis: null,
          pendingId: "",
          correctionInput: "",
          isLoading: false,
          correctionMode: false,
        });
        const { data: logData } = await supabase
          .from("food_log")
          .select("*")
          .eq("date", todayStr)
          .order("time", { ascending: true });
        setFoodLog(logData ?? []);
      }
    } catch (e) {
      setImageConfirmState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const handleImageCorrection = async () => {
    const correction = imageConfirmState.correctionInput.trim();
    if (!correction) return;
    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "";
    setImageConfirmState((prev) => ({ ...prev, isLoading: true }));
    try {
      const res = await fetch(`${apiUrl}/api/food/image/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: imageConfirmState.pendingId,
          confirmed: false,
          correction,
        }),
      });
      const data = await res.json();
      if (data.status === "corrected") {
        setImageConfirmState((prev) => ({
          ...prev,
          isLoading: false,
          smsConfirmation: data.sms_confirmation,
          analysis: data.analysis,
          correctionInput: "",
          correctionMode: false,
        }));
      }
    } catch (e) {
      setImageConfirmState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const handleVoice = async () => {
    if (isRecording) {
      await stopRecording();
      return;
    }
    await startRecording();
  };

  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Microphone access required", "Enable microphone access in Settings.");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setRecording(recording);
      setIsRecording(true);
    } catch (e) {
      console.error("[moment] recording start failed:", e);
      Alert.alert("Could not start recording", "Try again.");
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);
    setVoiceLoading(true);

    try {
      const rec = recordingRef.current;
      if (!rec) return;

      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = rec.getURI();
      recordingRef.current = null;
      setRecording(null);

      if (!uri) throw new Error("No recording URI");

      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "";
      const formData = new FormData();
      formData.append(
        "file",
        {
          uri,
          name: "voice.m4a",
          type: "audio/m4a",
        } as any
      );

      const res = await fetch(`${apiUrl}/api/food/voice`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `Voice upload failed: ${res.status}`);
      }

      const data = await res.json();

      if (data.logged) {
        const { data: logData } = await supabase
          .from("food_log")
          .select("*")
          .eq("date", todayStr)
          .order("time", { ascending: true });
        setFoodLog(logData ?? []);
      } else {
        setInput(data.transcription ?? "");
      }
    } catch (e) {
      Alert.alert(
        "Voice note failed",
        e instanceof Error ? e.message : "Try describing your meal in text."
      );
    } finally {
      setVoiceLoading(false);
    }
  };

  const getCoachingCopy = (): string => {
    const score = whoopData?.recovery_score;
    const strain = whoopData?.strain_score;
    if (score != null && strain != null) {
      if (score < 34) return `Easy day. Aim for ${calorieTarget} cal and ${proteinTarget}g protein to support recovery.`;
      if (strain >= 13) return `Hard day ahead. Aim for ${calorieTarget} cal and ${proteinTarget}g protein to support tonight's recovery.`;
      if (score > 67) return `Good day to push. Aim for ${calorieTarget} cal and ${proteinTarget}g protein.`;
      return `Moderate intensity today. Aim for ${calorieTarget} cal and ${proteinTarget}g protein.`;
    }
    if (strain != null && strain >= 13) return `Big day. Don't skip carbs. Aim for ${calorieTarget} cal and ${proteinTarget}g protein.`;
    return `Aim for ${calorieTarget} cal and ${proteinTarget}g protein today.`;
  };

  const postWorkoutMinsRemaining = (whoopData as any)?.last_workout_minutes_remaining ?? null;

  const renderWhoopCard = () => {
    if (isLoading) return <PulsingPlaceholder />;
    if (postWorkoutMinsRemaining != null && postWorkoutMinsRemaining > 0) {
      const burned = (whoopData as any)?.workout_calories_burned ?? 820;
      return (
        <Pressable
          onPress={() => {
            setSelectedMealChip("post-workout 🥩");
            setInput("");
          }}
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.card,
            padding: spacing.cardPaddingH,
            marginHorizontal: spacing.contentPadding,
            flexDirection: "row",
            alignItems: "center",
            borderWidth: 1,
            borderColor: colors.border,
            borderLeftWidth: 3,
            borderLeftColor: colors.accentGold,
            ...shadows.card,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 11, color: colors.textTertiary, letterSpacing: 1, marginBottom: 4 }}>
              POST-WORKOUT · {postWorkoutMinsRemaining} min remaining
            </Text>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, color: colors.textPrimary, lineHeight: 20 }}>
              You burned ~{burned} cal. Hit 40g protein + 80g carbs to refuel.
            </Text>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: 13, color: colors.accentBlue, marginTop: 10 }}>
              Refuel now
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.3)" />
        </Pressable>
      );
    }
    if (whoopData?.recovery_score != null) {
      const score = whoopData.recovery_score;
      return (
        <Pressable
          onPress={() => router.push("/(onboarding)/whoop")}
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.card,
            padding: spacing.cardPaddingH,
            marginHorizontal: spacing.contentPadding,
            flexDirection: "row",
            alignItems: "center",
            borderWidth: 1,
            borderColor: colors.border,
            ...shadows.card,
          }}
        >
          <GlowRing
            size={40}
            progress={score / 100}
            color={colors.accentGold}
            centerLabel=""
          />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text
              style={{
                fontFamily: fontFamily.regular,
                fontSize: 15,
                color: colors.textPrimary,
              }}
              numberOfLines={2}
            >
              {getCoachingCopy()}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
              <StatPill value={`${Math.round(score)}`} label="REC" color={recoveryColor(score)} />
              <StatPill value={whoopData.hrv_rmssd ? `${Math.round(whoopData.hrv_rmssd)}` : "–"} label="HRV" />
              <StatPill value={whoopData.strain_score ? whoopData.strain_score.toFixed(1) : "–"} label="STRAIN" />
            </View>
          </View>
          <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.3)" />
        </Pressable>
      );
    }
    return (
      <Pressable
        onPress={() => router.push("/(onboarding)/whoop")}
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          padding: spacing.cardPaddingH,
          marginHorizontal: spacing.contentPadding,
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: colors.border,
          ...shadows.card,
        }}
      >
        <View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: colors.accentGold }} />
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary, marginLeft: 8 }}>
          Connect WHOOP for adaptive targets
        </Text>
      </Pressable>
    );
  };

  const calProgress = Math.min(totalCalories / range.calMid, 1);
  const proteinProgress = range.proteinMid > 0 ? Math.min(totalProtein / range.proteinMid, 1) : 0;
  const remainingCal = Math.max(0, range.calMid - totalCalories);
  const remainingProtein = Math.max(0, range.proteinMid - totalProtein);
  const scaleMaxCal = Math.max(range.calMax, totalCalories, 1);
  const scaleMaxProtein = Math.max(range.proteinMax, totalProtein, 1);
  const calRangeMin = range.calMin / scaleMaxCal;
  const calRangeMax = range.calMax / scaleMaxCal;
  const proteinRangeMin = range.proteinMin / scaleMaxProtein;
  const proteinRangeMax = range.proteinMax / scaleMaxProtein;

  const getEmptyStateSuggestion = (): string => {
    const hour = new Date().getHours();
    const strain = whoopData?.strain_score;
    if (strain != null && strain >= 13 && (hour < 10 || hour >= 6)) {
      return "Given your strain today, you need carbs and protein at breakfast. Try: oats + 2 eggs + banana — est. 520 cal, 28g P";
    }
    if (hour < 10) return "Start with protein and carbs. Try: oats + 2 eggs + banana — est. 520 cal, 28g P";
    if (hour >= 18) return "Wind down with a balanced dinner. Try: grilled chicken + veg + rice — est. 600 cal, 45g P";
    return "Log a meal to see your progress. Try: chicken breast with quinoa — est. 500 cal, 40g P";
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      await deleteFoodLogEntry(id);
      const { data } = await supabase
        .from("food_log")
        .select("*")
        .eq("date", todayStr)
        .order("time", { ascending: true });
      setFoodLog(data ?? []);
    } catch (e) {
      console.error("[moment] delete failed:", e);
      Alert.alert("Could not delete", "Try again.");
    }
  };

  const renderFoodItem = ({ item }: { item: any }) => (
    <SwipeableRow
      onDelete={() => {
        Alert.alert("Delete entry", "Remove this meal from today?", [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => handleDeleteEntry(item.id) },
        ]);
      }}
      onRepeat={() => handleRepeatMeal(item.description ?? "")}
    >
      <Pressable
        onPress={() => setFoodEntryDetailId(item.id)}
        style={({ pressed }) => ({
          backgroundColor: pressed ? colors.surfaceL3 : "transparent",
        })}
      >
        <View style={{ paddingHorizontal: spacing.contentPadding, paddingVertical: 8, flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                fontFamily: fontFamily.regular,
                fontSize: 15,
                color: colors.textPrimary,
              }}
            >
              {item.description}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentGreen }} />
              <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>
                {Math.round(item.protein_g ?? 0)}g
              </Text>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentCarb }} />
              <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>
                {Math.round(item.carbs_g ?? 0)}g
              </Text>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentFat }} />
              <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>
                {Math.round(item.fat_g ?? 0)}g
              </Text>
              <View style={{ flex: 1 }} />
              <Text style={{ fontFamily: fontFamily.regular, fontSize: 12, color: colors.textTertiary }}>
                {item.time?.slice(0, 5) ?? ""}
              </Text>
            </View>
          </View>
          <Text style={{ fontFamily: fontFamily.bold, fontSize: 17, color: colors.textPrimary, marginRight: 8 }}>
            {item.calories ?? 0}
          </Text>
          <Feather name="chevron-right" size={18} color="rgba(255,255,255,0.25)" />
        </View>
        <View
          style={{
            height: 1,
            backgroundColor: "rgba(255,255,255,0.06)",
            marginHorizontal: spacing.contentPadding,
          }}
        />
      </Pressable>
    </SwipeableRow>
  );

  const selectedEntry = foodLog.find((e) => e.id === foodEntryDetailId);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Toast
        visible={toastVisible}
        message={toastMessage ?? ""}
        onDismiss={() => {
          setToastVisible(false);
          setToastMessage(null);
        }}
      />
      <FoodEntryDetailSheet
        visible={foodEntryDetailId != null}
        entry={selectedEntry ?? null}
        remaining={{
          protein: Math.max(0, range.proteinMid - totalProtein),
          carbs: Math.max(0, (range.calMid * 0.5) / 4 - totalCarbs),
          fat: Math.max(0, (range.calMid * 0.3) / 9 - totalFat),
        }}
        onClose={() => setFoodEntryDetailId(null)}
        onDelete={(e) => {
          setFoodEntryDetailId(null);
          Alert.alert("Delete entry", "Remove this meal from today?", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => handleDeleteEntry(e.id) },
          ]);
        }}
        onLogAgain={(e) => {
          setFoodEntryDetailId(null);
          handleRepeatMeal(e.description ?? "");
        }}
      />
      {/* WHOOP Coaching Card */}
      <View style={{ paddingTop: insets.top + 12, paddingBottom: 16 }}>
        {renderWhoopCard()}
      </View>

      {/* Hero Progress */}
      <View style={{ paddingHorizontal: spacing.contentPadding, marginBottom: 16 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 }}>
          <View>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textTertiary, marginBottom: 2 }}>
              {range.calMin.toLocaleString()}–{range.calMax.toLocaleString()} cal range →
            </Text>
            <Text style={[calProgress >= 0.9 ? { color: colors.accentBlue } : {}, { fontFamily: fontFamily.bold, fontSize: 52, color: colors.textPrimary, letterSpacing: -0.5 }]}>
              {totalCalories}
            </Text>
          </View>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 15, color: colors.textSecondary }}>
            {remainingCal} to go
          </Text>
        </View>
        <View style={{ marginTop: 8 }}>
          <ProgressBar
            variant="holo-primary"
            progress={calProgress}
            rangeMin={calRangeMin}
            rangeMax={calRangeMax}
            accessibilityValue={{ text: `${totalCalories} of ${range.calMid} calories, ${Math.round(calProgress * 100)} percent` }}
          />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 16, marginBottom: 8 }}>
          <View>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textTertiary, marginBottom: 2 }}>
              {range.proteinMin}–{range.proteinMax}g range →
            </Text>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: 52, color: colors.textPrimary, letterSpacing: -0.5 }}>
              {Math.round(totalProtein)}g
            </Text>
          </View>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 15, color: colors.textSecondary }}>
            {Math.round(remainingProtein)}g to go
          </Text>
        </View>
        <ProgressBar
          variant="holo-protein"
          progress={proteinProgress}
          rangeMin={proteinRangeMin}
          rangeMax={proteinRangeMax}
          accessibilityValue={{ text: `${Math.round(totalProtein)} of ${range.proteinMid}g protein, ${Math.round(proteinProgress * 100)} percent` }}
        />
      </View>

      {/* Input */}
      <View style={{ paddingHorizontal: spacing.contentPadding, paddingBottom: 8 }}>
        <InputBar
          value={input}
          onChangeText={setInput}
          onSend={handleSend}
          onCamera={handleCamera}
          onVoice={handleVoice}
          isRecording={isRecording}
          voiceLoading={voiceLoading}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 8 }}
          contentContainerStyle={{ gap: 8, paddingRight: 4 }}
        >
          {MEAL_CHIPS.map((label) => {
            const isActive = selectedMealChip === label;
            return (
              <Pressable
                key={label}
                onPress={() => setSelectedMealChip(isActive ? null : label)}
                style={{
                  backgroundColor: isActive ? colors.textPrimary : "rgba(255,255,255,0.07)",
                  borderWidth: 1,
                  borderColor: isActive ? colors.textPrimary : "rgba(255,255,255,0.1)",
                  borderRadius: radius.pill,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                }}
              >
                <Text
                  style={{
                    fontFamily: fontFamily.regular,
                    fontSize: 13,
                    color: isActive ? colors.bg : "rgba(255,255,255,0.6)",
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Repeat meals + Food Log */}
      <FlatList
        style={{ flex: 1 }}
        data={foodLog}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingTop: 4,
          paddingBottom: 16,
          flexGrow: 1,
        }}
        ListHeaderComponent={
          frequentMeals.length > 0 && foodLog.length >= 3 ? (
            <View style={{ marginBottom: 16 }}>
              <Text
                style={{
                  fontFamily: fontFamily.regular,
                  fontSize: 11,
                  color: colors.textTertiary,
                  letterSpacing: 1.5,
                  marginBottom: 8,
                }}
              >
                REPEAT A MEAL
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {frequentMeals.map((m) => (
                  <Pressable
                    key={m.description}
                    onPress={() => handleRepeatMeal(m.description)}
                    style={{
                      backgroundColor: "rgba(255,255,255,0.07)",
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.1)",
                      borderRadius: radius.pill,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      maxWidth: 180,
                    }}
                  >
                    <Text numberOfLines={1} style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>
                      {m.description}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !isLoading ? (
            <View
              style={{
                flex: 1,
                paddingTop: 32,
                paddingHorizontal: spacing.contentPadding,
              }}
            >
              <View
                style={{
                  borderWidth: 1,
                  borderStyle: "dashed",
                  borderColor: colors.borderSubtle,
                  borderRadius: radius.card,
                  padding: 16,
                }}
              >
                <Text
                  style={{
                    fontFamily: fontFamily.regular,
                    fontSize: 14,
                    color: colors.textSecondary,
                    lineHeight: 22,
                  }}
                >
                  {getEmptyStateSuggestion()}
                </Text>
              </View>
            </View>
          ) : null
        }
        renderItem={renderFoodItem}
      />

      <Modal
        visible={imageConfirmState.visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!imageConfirmState.isLoading) {
            setImageConfirmState((prev) => ({ ...prev, visible: false }));
          }
        }}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: "#080808" }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View
            style={{
              paddingTop: insets.top + 16,
              paddingHorizontal: 24,
              paddingBottom: 16,
              borderBottomWidth: 1,
              borderBottomColor: "#111111",
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text
              style={{ fontFamily: fontFamily.bold, fontSize: 17, color: "#f0f0f0" }}
            >
              meal analysis
            </Text>
            <Pressable
              onPress={() => setImageConfirmState((prev) => ({ ...prev, visible: false }))}
              hitSlop={12}
              disabled={imageConfirmState.isLoading}
            >
              <Feather name="x" size={20} color="#444444" />
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            {imageConfirmState.isLoading ? (
              <View style={{ paddingTop: 60, alignItems: "center", gap: 16 }}>
                <ActivityIndicator color="#22c55e" size="large" />
                <Text
                  style={{ fontFamily: fontFamily.regular, fontSize: 14, color: "#444444" }}
                >
                  analysing meal...
                </Text>
              </View>
            ) : (
              <>
                {imageConfirmState.analysis?.components?.map((component, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      paddingVertical: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: "#111111",
                    }}
                  >
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text
                        style={{ fontFamily: fontFamily.regular, fontSize: 15, color: "#f0f0f0" }}
                      >
                        {component.food}
                      </Text>
                      <Text
                        style={{
                          fontFamily: fontFamily.regular,
                          fontSize: 12,
                          color: "#2a2a2a",
                          marginTop: 3,
                        }}
                      >
                        {component.portion_estimate}
                      </Text>
                    </View>
                    <Text
                      style={{ fontFamily: fontFamily.bold, fontSize: 14, color: "#f0f0f0" }}
                    >
                      {component.calories} kcal
                    </Text>
                  </View>
                ))}

                {imageConfirmState.analysis?.totals && (
                  <View
                    style={{
                      marginTop: 16,
                      padding: 16,
                      backgroundColor: "#0f0f0f",
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: "#1c1c1c",
                    }}
                  >
                    <Text
                      style={{ fontFamily: fontFamily.bold, fontSize: 20, color: "#f0f0f0" }}
                    >
                      {imageConfirmState.analysis.totals.calories} kcal
                    </Text>
                    <Text
                      style={{
                        fontFamily: fontFamily.regular,
                        fontSize: 13,
                        color: "#444444",
                        marginTop: 6,
                      }}
                    >
                      {`P${imageConfirmState.analysis.totals.protein_g}g  C${imageConfirmState.analysis.totals.carbs_g}g  F${imageConfirmState.analysis.totals.fat_g}g`}
                    </Text>
                    {imageConfirmState.analysis.overall_confidence && (
                      <Text
                        style={{
                          fontFamily: fontFamily.regular,
                          fontSize: 11,
                          color: "#282828",
                          marginTop: 8,
                        }}
                      >
                        {imageConfirmState.analysis.overall_confidence} confidence
                      </Text>
                    )}
                  </View>
                )}

                {imageConfirmState.correctionMode ? (
                  <View style={{ marginTop: 20 }}>
                    <TextInput
                      value={imageConfirmState.correctionInput}
                      onChangeText={(v) =>
                        setImageConfirmState((prev) => ({ ...prev, correctionInput: v }))
                      }
                      placeholder="e.g. bigger portion of rice, no sauce"
                      placeholderTextColor="#282828"
                      multiline
                      autoFocus
                      style={{
                        fontFamily: fontFamily.regular,
                        fontSize: 15,
                        color: "#f0f0f0",
                        backgroundColor: "#0f0f0f",
                        borderWidth: 1,
                        borderColor: "rgba(168,237,234,0.25)",
                        borderRadius: 14,
                        padding: 16,
                        minHeight: 80,
                      }}
                    />
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                      <Pressable
                        onPress={() =>
                          setImageConfirmState((prev) => ({
                            ...prev,
                            correctionMode: false,
                            correctionInput: "",
                          }))
                        }
                        style={{
                          flex: 1,
                          height: 48,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: "#1c1c1c",
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: fontFamily.regular,
                            fontSize: 14,
                            color: "#444444",
                          }}
                        >
                          cancel
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={handleImageCorrection}
                        style={{
                          flex: 2,
                          height: 48,
                          borderRadius: 12,
                          backgroundColor: "#f0f0f0",
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <Text
                          style={{ fontFamily: fontFamily.bold, fontSize: 14, color: "#080808" }}
                        >
                          update
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 24 }}>
                    <Pressable
                      onPress={() =>
                        setImageConfirmState((prev) => ({ ...prev, correctionMode: true }))
                      }
                      style={{
                        flex: 1,
                        height: 50,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: "#1c1c1c",
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{ fontFamily: fontFamily.regular, fontSize: 14, color: "#444444" }}
                      >
                        correct
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={handleImageConfirm}
                      style={{
                        flex: 2,
                        height: 50,
                        borderRadius: 14,
                        backgroundColor: "#22c55e",
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{ fontFamily: fontFamily.bold, fontSize: 15, color: "#080808" }}
                      >
                        log it
                      </Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
