import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthGuard } from "../../lib/auth";
import { colors, fontFamily } from "../../lib/theme";

export default function AppLayout() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 83;

  return (
    <AuthGuard fallback="auth">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: true,
          tabBarActiveTintColor: colors.textPrimary,
          tabBarInactiveTintColor: "rgba(255,255,255,0.4)",
          tabBarLabelStyle: {
            fontFamily: fontFamily.regular,
            fontSize: 10,
          },
          tabBarStyle: {
            backgroundColor: "rgba(10,10,10,0.92)",
            borderTopWidth: 0,
            height: tabBarHeight,
            paddingBottom: insets.bottom,
            paddingTop: 8,
            elevation: 0,
          },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: "Today",
            tabBarIcon: ({ color }) => (
              <Feather name="home" size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="insights"
          options={{
            title: "Trends",
            tabBarIcon: ({ color }) => (
              <Feather name="bar-chart-2" size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="log"
          options={{
            title: "History",
            tabBarIcon: ({ color }) => (
              <Feather name="list" size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color }) => (
              <Feather name="user" size={22} color={color} />
            ),
          }}
        />
      </Tabs>
    </AuthGuard>
  );
}
