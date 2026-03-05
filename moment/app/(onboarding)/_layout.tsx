import { Stack } from "expo-router";
import { AuthGuard } from "../../lib/auth";

export default function OnboardingLayout() {
  return (
    <AuthGuard fallback="home">
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#080810" },
        }}
      />
    </AuthGuard>
  );
}
