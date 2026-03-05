import React from "react";
import { View } from "react-native";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthGuard } from "../../lib/auth";
import { colors, fontFamily, holoGradients } from "../../lib/theme";

const HOLO_LINE = { width: 24, height: 2 };

function TabIconWithHolo({
  focused,
  color,
  name,
}: {
  focused: boolean;
  color: string;
  name: React.ComponentProps<typeof Feather>["name"];
}) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      {focused && (
        <LinearGradient
          colors={[...holoGradients.primary] as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ width: HOLO_LINE.width, height: HOLO_LINE.height, marginBottom: 4, borderRadius: 1 }}
        />
      )}
      <Feather name={name} size={22} color={color} />
    </View>
  );
}

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
            backgroundColor: colors.surfaceOverlay,
            borderTopWidth: 0.5,
            borderTopColor: "rgba(255,255,255,0.12)",
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
            tabBarIcon: ({ focused, color }) => (
              <TabIconWithHolo focused={focused} color={color} name="home" />
            ),
          }}
        />
        <Tabs.Screen
          name="insights"
          options={{
            title: "Insights",
            tabBarIcon: ({ focused, color }) => (
              <TabIconWithHolo focused={focused} color={color} name="zap" />
            ),
          }}
        />
        <Tabs.Screen
          name="trends"
          options={{
            title: "Trends",
            tabBarIcon: ({ focused, color }) => (
              <TabIconWithHolo focused={focused} color={color} name="bar-chart-2" />
            ),
          }}
        />
        <Tabs.Screen
          name="log"
          options={{
            title: "History",
            tabBarIcon: ({ focused, color }) => (
              <TabIconWithHolo focused={focused} color={color} name="list" />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ focused, color }) => (
              <TabIconWithHolo focused={focused} color={color} name="user" />
            ),
          }}
        />
      </Tabs>
    </AuthGuard>
  );
}
