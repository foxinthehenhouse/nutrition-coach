import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { colors, fontFamily } from "../../lib/theme";

export default function OnboardingIndex() {
  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
      <Text
        style={{
          fontFamily: fontFamily.bold,
          fontSize: 28,
          color: colors.textPrimary,
          marginBottom: 12,
        }}
      >
        Welcome to Moment
      </Text>
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 16,
          color: colors.textMuted,
          marginBottom: 32,
          lineHeight: 24,
        }}
      >
        Your nutrition coach. Log meals, track macros, and stay on top of your goals.
      </Text>
      <Pressable
        onPress={() => router.push("/(auth)/login")}
        style={{
          backgroundColor: colors.green,
          borderRadius: 12,
          padding: 16,
          alignItems: "center",
        }}
      >
        <Text style={{ fontFamily: fontFamily.bold, fontSize: 16, color: colors.textPrimary }}>
          Get started
        </Text>
      </Pressable>
    </View>
  );
}
