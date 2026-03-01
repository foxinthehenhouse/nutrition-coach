import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { logFood } from "../../lib/api";
import { InputBar } from "../../components/ui/InputBar";
import { colors, fontFamily } from "../../lib/theme";

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setLastMessage(null);
    setInput("");
    try {
      const result = await logFood(trimmed);
      setLastMessage(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log food");
    } finally {
      setLoading(false);
    }
  };

  const handleCamera = () => {
    setError("Camera not implemented yet");
  };

  const handleVoice = () => {
    setError("Voice not implemented yet");
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/(auth)");
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Home</Text>
        <Pressable onPress={handleSignOut} hitSlop={12}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      {lastMessage && (
        <Text style={styles.lastMessage}>{lastMessage}</Text>
      )}
      {error && (
        <Text style={styles.error}>{error}</Text>
      )}

      <View style={styles.inputBar}>
        <InputBar
          value={input}
          onChangeText={setInput}
          onSend={handleSend}
          onCamera={handleCamera}
          onVoice={handleVoice}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    color: colors.textPrimary,
  },
  signOut: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: colors.textMuted,
  },
  lastMessage: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  error: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: colors.red,
    marginBottom: 12,
  },
  inputBar: {
    marginTop: "auto",
  },
});
