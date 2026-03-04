import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { View, Text, ActivityIndicator } from "react-native";
import { supabase } from "../lib/supabase";
import { colors, fontFamily } from "../lib/theme";

export default function Index() {
  const [session, setSession] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: colors.bg,
        }}
      >
        <Text
          style={{
            fontFamily: fontFamily.bold,
            fontSize: 18,
            color: colors.textPrimary,
            marginBottom: 24,
          }}
        >
          moment
        </Text>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  if (session) {
    return <Redirect href="/(app)/home" />;
  }

  return <Redirect href="/(onboarding)" />;
}
