import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthGuard } from "../../lib/auth";

export default function AppLayout() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 52 + insets.bottom;

  return (
    <AuthGuard fallback="auth">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarActiveTintColor: "#f0f0f0",
          tabBarInactiveTintColor: "#282828",
          tabBarStyle: {
            backgroundColor: "#080808",
            borderTopWidth: 1,
            borderTopColor: "#111111",
            height: tabBarHeight,
            paddingBottom: insets.bottom,
            paddingTop: 0,
            elevation: 0,
          },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            tabBarIcon: ({ color }) => (
              <Feather name="home" size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="insights"
          options={{
            tabBarIcon: ({ color }) => (
              <Feather name="activity" size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="log"
          options={{
            tabBarIcon: ({ color }) => (
              <Feather name="list" size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            tabBarIcon: ({ color }) => (
              <Feather name="user" size={22} color={color} />
            ),
          }}
        />
      </Tabs>
    </AuthGuard>
  );
}
