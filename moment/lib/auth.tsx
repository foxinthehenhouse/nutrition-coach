import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { supabase } from "./supabase";
import { colors } from "./theme";

type AuthGuardProps = {
  children: React.ReactNode;
  fallback: "auth" | "home";
};

export function AuthGuard({ children, fallback }: AuthGuardProps) {
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
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  if (fallback === "auth" && !session) {
    return <Redirect href="/(auth)" />;
  }

  if (fallback === "home" && session) {
    return <Redirect href="/(app)/home" />;
  }

  return <>{children}</>;
}
