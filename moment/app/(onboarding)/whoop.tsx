import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
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
      <MaskedView
        maskElement={<Text style={textStyle}>WHOOP</Text>}
      >
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

const BENEFITS = [
  "calorie targets adjust to your strain score daily",
  "meal timing responds to recovery and HRV",
  "weekly targets adapt based on training load",
];

export default function WhoopConnect() {
  const insets = useSafeAreaInsets();
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "";
    const result = await WebBrowser.openAuthSessionAsync(
      `${apiUrl}/auth/whoop`,
      "moment://"
    );
    setConnecting(false);
    if (result.type === "success") {
      await supabase.auth.updateUser({ data: { whoop_connected: true } });
      setConnected(true);
      setTimeout(() => router.replace("/(app)/home"), 1200);
    }
  };

  const handleSkip = async () => {
    await supabase.auth.updateUser({ data: { whoop_skipped: true } });
    router.replace("/(app)/home");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#080808" }}>
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View
          style={{
            maxWidth: 300,
            width: "100%",
            alignSelf: "center",
          }}
        >
          <Wordmark />

          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 17,
              color: "#f0f0f0",
              marginTop: 24,
            }}
          >
            targets that adapt daily.
          </Text>

          <View style={{ marginTop: 32 }}>
            {BENEFITS.map((b, i) => (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 999,
                    backgroundColor: "#22c55e",
                    marginTop: 6,
                  }}
                />
                <Text
                  style={{
                    fontFamily: fontFamily.regular,
                    fontSize: 14,
                    color: "#3a3a3a",
                    lineHeight: 20,
                    flex: 1,
                  }}
                >
                  {b}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 52 }}>
            {connected ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  justifyContent: "center",
                }}
              >
                <Feather name="check-circle" size={22} color="#22c55e" />
                <Text
                  style={{
                    fontFamily: fontFamily.bold,
                    fontSize: 15,
                    color: "#22c55e",
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
                  height: 50,
                  backgroundColor: "#22c55e",
                  borderRadius: 14,
                  width: "100%",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                {connecting ? (
                  <ActivityIndicator color="#080808" />
                ) : (
                  <Text
                    style={{
                      fontFamily: fontFamily.bold,
                      fontSize: 15,
                      color: "#080808",
                    }}
                  >
                    connect
                  </Text>
                )}
              </Pressable>
            )}
          </View>

          <Pressable
            onPress={handleSkip}
            style={{
              marginTop: 16,
              alignSelf: "center",
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: 16,
            }}
          >
            <Text
              style={{
                fontFamily: fontFamily.regular,
                fontSize: 13,
                color: "#444444",
                textAlign: "center",
              }}
            >
              skip for now
            </Text>
          </Pressable>
        </View>
      </View>

      <Text
        style={{
          position: "absolute",
          bottom: insets.bottom + 24,
          left: 0,
          right: 0,
          fontFamily: fontFamily.regular,
          fontSize: 11,
          color: "#444444",
          textAlign: "center",
        }}
      >
        connect anytime in profile
      </Text>
    </View>
  );
}
