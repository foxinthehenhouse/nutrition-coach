import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

function getRedirectUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "https://moment.up.railway.app";
}

function Wordmark() {
  const textStyle = {
    fontFamily: fontFamily.bold,
    fontSize: 38,
    letterSpacing: -1,
  } as const;

  if (MaskedView) {
    return (
      <MaskedView
        maskElement={
          <Text style={[textStyle, { backgroundColor: "transparent" }]}>
            moment
          </Text>
        }
      >
        <LinearGradient
          colors={[...holoGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        >
          <Text style={[textStyle, { opacity: 0 }]}>moment</Text>
        </LinearGradient>
      </MaskedView>
    );
  }

  return <Text style={[textStyle, { color: "#f0f0f0" }]}>moment</Text>;
}

export default function AuthLogin() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [focused, setFocused] = useState(false);

  const handleMagicLink = async () => {
    if (!email.trim()) {
      setError("Email required");
      return;
    }
    setLoading(true);
    setError(null);
    setSent(false);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: getRedirectUrl(),
      },
    });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  };

  const disabled = loading || !email.trim();

  if (sent) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#080808",
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View
          style={{
            maxWidth: 320,
            width: "100%",
            alignSelf: "center",
            alignItems: "center",
          }}
        >
          <Text
            style={{
              fontFamily: fontFamily.bold,
              fontSize: 20,
              color: "#f0f0f0",
            }}
          >
            check your inbox
          </Text>
          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 14,
              color: "rgba(255,255,255,0.45)",
              marginTop: 8,
            }}
          >
            {email}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#080808",
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <View
        style={{
          maxWidth: 320,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <View style={{ alignItems: "center" }}>
          <Wordmark />
        </View>

        <View style={{ height: 72 }} />

        <TextInput
          placeholder="email"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={email}
          onChangeText={setEmail}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 15,
            color: "#f0f0f0",
            backgroundColor: "#10111C",
            borderWidth: 1,
            borderColor: focused
              ? "rgba(255,255,255,0.30)"
              : "rgba(255,255,255,0.12)",
            borderRadius: 14,
            padding: 16,
          }}
        />

        {error && (
          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 12,
              color: "#ef4444",
              marginTop: 8,
              marginBottom: -2,
            }}
          >
            {error}
          </Text>
        )}

        <Pressable
          onPress={handleMagicLink}
          disabled={loading}
          style={{
            height: 50,
            borderRadius: 14,
            backgroundColor: disabled
              ? "rgba(240,240,240,0.08)"
              : "#f0f0f0",
            justifyContent: "center",
            alignItems: "center",
            marginTop: 10,
          }}
        >
          {loading ? (
            <ActivityIndicator color="#080808" />
          ) : (
            <Text
              style={{
                fontFamily: fontFamily.bold,
                fontSize: 15,
                color: disabled ? "rgba(255,255,255,0.35)" : "#080808",
              }}
            >
              continue
            </Text>
          )}
        </Pressable>

        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 12,
            color: "rgba(255,255,255,0.30)",
            textAlign: "center",
            marginTop: 16,
          }}
        >
          magic link. no password.
        </Text>
      </View>
    </View>
  );
}
