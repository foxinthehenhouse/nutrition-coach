import React from "react";
import { View, Text } from "react-native";
import { colors, fontFamily } from "../../lib/theme";

type MacroBarProps = {
  label: string;
  current: number;
  target: number;
  color: string;
  unit: string;
};

export function MacroBar({ label, current, target, color, unit }: MacroBarProps) {
  const progress = Math.min(target > 0 ? current / target : 0, 1);

  return (
    <View style={{ width: "100%" }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 12,
            color: colors.textMuted,
            textTransform: "uppercase",
            letterSpacing: 4,
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 12,
            color: colors.textPrimary,
          }}
        >
          {current}/{target}{unit}
        </Text>
      </View>
      <View
        style={{
          width: "100%",
          height: 2,
          backgroundColor: colors.border,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${progress * 100}%`,
            height: 2,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}
