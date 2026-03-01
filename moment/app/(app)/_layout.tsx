import { Stack } from "expo-router";
import { AuthGuard } from "../../lib/auth";

export default function AppLayout() {
  return (
    <AuthGuard fallback="auth">
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#080808" },
        }}
      />
    </AuthGuard>
  );
}
