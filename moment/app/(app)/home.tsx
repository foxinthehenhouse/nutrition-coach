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
import { logFood } from "../../lib/api";
import { GlowRing } from "../../components/ui/GlowRing";
import { InputBar } from "../../components/ui/InputBar";
import { StatPill } from "../../components/ui/StatPill";
import { colors, fontFamily, recoveryColor, spacing } from "../../lib/theme";

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
  const recordingRef = useRef<Audio.Recording | null>(null);

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
      <Pressable
        onPress={() => router.push("/(onboarding)/whoop")}
        style={{ paddingVertical: 12 }}
      >
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
      <View style={{ paddingHorizontal: spacing.contentPadding, paddingVertical: 14 }}>
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
          marginHorizontal: spacing.contentPadding,
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
          paddingHorizontal: spacing.contentPadding,
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
          paddingHorizontal: spacing.contentPadding,
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
          isRecording={isRecording}
          voiceLoading={voiceLoading}
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
            paddingHorizontal: spacing.contentPadding,
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
