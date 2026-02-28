import "../global.css";
import { GluestackUIProvider } from "@gluestack-ui/themed";
import { config } from "@gluestack-ui/config";
import { Stack } from "expo-router";
import { useFonts } from "../lib/theme";

export default function RootLayout() {
  const [fontsLoaded] = useFonts();

  if (!fontsLoaded) {
    return null;
  }

  return (
    <GluestackUIProvider config={config}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#080808" },
        }}
      />
    </GluestackUIProvider>
  );
}
