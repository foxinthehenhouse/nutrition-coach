import React, { useEffect, useRef } from "react";
import { View, Animated, Easing } from "react-native";
import { colors, motion } from "../../lib/theme";

type ProgressBarProps = {
  progress: number; // 0..1
  color?: string;
  height?: number;
  borderRadius?: number;
  animated?: boolean;
  accessibilityLabel?: string;
  accessibilityValue?: { text: string };
};

export function ProgressBar({
  progress,
  color = colors.accentBlue,
  height = 6,
  borderRadius = 3,
  animated = true,
  accessibilityLabel,
  accessibilityValue,
}: ProgressBarProps) {
  const animValue = useRef(new Animated.Value(0)).current;
  const clamped = Math.min(1, Math.max(0, progress));

  useEffect(() => {
    if (animated) {
      Animated.timing(animValue, {
        toValue: clamped,
        duration: motion.durationBar,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    } else {
      animValue.setValue(clamped);
    }
  }, [clamped, animated, animValue]);

  const widthInterpolate = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View
      style={{
        height,
        borderRadius,
        backgroundColor: "rgba(255,255,255,0.1)",
        overflow: "hidden",
      }}
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={accessibilityValue}
    >
      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: widthInterpolate,
          backgroundColor: color,
          borderRadius,
        }}
      />
    </View>
  );
}
