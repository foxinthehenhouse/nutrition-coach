import { useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { colors, fontFamily } from "../../lib/theme";

function getRedirectUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "https://moment.up.railway.app";
}

export default function AuthLogin() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

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

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
  const isConfigured = Boolean(supabaseUrl);
  useEffect(() => {
    if (typeof window !== "undefined") {
      console.log("[Moment] EXPO_PUBLIC_SUPABASE_URL:", isConfigured ? "set" : "not set");
    }
  }, [isConfigured]);

  if (sent) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        <Text
          style={{
            fontFamily: fontFamily.bold,
            fontSize: 24,
            color: colors.textPrimary,
            marginBottom: 12,
          }}
        >
          Check your email
        </Text>
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 16,
            color: colors.textMuted,
            marginBottom: 24,
            lineHeight: 24,
          }}
        >
          We sent a magic link to {email}. Click the link to sign in.
        </Text>
        <Pressable
          onPress={() => setSent(false)}
          style={{
            backgroundColor: "transparent",
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 16,
            alignItems: "center",
          }}
        >
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 16, color: colors.textPrimary }}>
            Use a different email
          </Text>
        </Pressable>
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 12,
            color: colors.textMuted,
            marginTop: 24,
          }}
        >
          Supabase: {isConfigured ? "configured" : "not configured"}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
      <Text
        style={{
          fontFamily: fontFamily.bold,
          fontSize: 24,
          color: colors.textPrimary,
          marginBottom: 24,
        }}
      >
        Sign in
      </Text>
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 14,
          color: colors.textMuted,
          marginBottom: 16,
        }}
      >
        Enter your email and we'll send you a magic link to sign in—no password needed.
      </Text>

      <TextInput
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 16,
          color: colors.textPrimary,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
        }}
      />

      {error && (
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 14,
            color: colors.red,
            marginBottom: 12,
          }}
        >
          {error}
        </Text>
      )}

      <Pressable
        onPress={handleMagicLink}
        disabled={loading}
        style={{
          backgroundColor: colors.green,
          borderRadius: 12,
          padding: 16,
          alignItems: "center",
        }}
      >
        {loading ? (
          <ActivityIndicator color={colors.textPrimary} />
        ) : (
          <Text style={{ fontFamily: fontFamily.bold, fontSize: 16, color: colors.textPrimary }}>
            Send magic link
          </Text>
        )}
      </Pressable>

      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 12,
          color: colors.textMuted,
          marginTop: 24,
        }}
      >
        Supabase: {isConfigured ? "configured" : "not configured"}
      </Text>
    </View>
  );
}
