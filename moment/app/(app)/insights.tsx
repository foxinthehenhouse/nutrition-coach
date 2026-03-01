import { View, Text, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontFamily } from "../../lib/theme";

export default function Insights() {
  const insets = useSafeAreaInsets();
  const today = new Date()
    .toLocaleDateString("en-AU", {
      weekday: "long",
      month: "short",
      day: "numeric",
    })
    .toLowerCase();

  return (
    <ScrollView
      style={{ backgroundColor: "#080808" }}
      contentContainerStyle={{
        paddingHorizontal: 24,
        paddingTop: insets.top + 24,
        paddingBottom: 40,
      }}
    >
      <Text
        style={{
          fontFamily: fontFamily.bold,
          fontSize: 26,
          color: "#f0f0f0",
        }}
      >
        this week
      </Text>
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 13,
          color: "#444444",
          marginTop: 4,
        }}
      >
        {today}
      </Text>

      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 14,
          color: "#282828",
          marginTop: 60,
        }}
      >
        insights loading soon.
      </Text>
    </ScrollView>
  );
}
