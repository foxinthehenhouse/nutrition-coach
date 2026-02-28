import React from "react";
import { View, Text } from "react-native";
import { colors, fontFamily } from "../../lib/theme";

type StatPillProps = {
  label: string;
  value: string | number;
  color?: string;
};

export function StatPill({ label, value, color }: StatPillProps) {
  return (
    <View
      style={{
        backgroundColor: colors.surfaceHigh,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        flexDirection: "row",
        alignItems: "baseline",
        gap: 4,
      }}
    >
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 12,
          color: color ?? colors.textPrimary,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 12,
          color: colors.textMuted,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
