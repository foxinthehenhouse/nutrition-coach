import React, { useEffect, useRef } from "react";
import { View, Animated, Easing, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, motion, holoGradients, proteinBarColor } from "../../lib/theme";

const BAR_HEIGHT = 8;
const BAR_RADIUS = 4;
const RANGE_BAND_COLOR = "rgba(255,255,255,0.12)";

type ProgressBarVariant = "holo-primary" | "holo-protein" | "solid";

export type ProgressBarProps = {
  progress: number;
  variant?: ProgressBarVariant;
  color?: string;
  height?: number;
  borderRadius?: number;
  rangeMin?: number;
  rangeMax?: number;
  animated?: boolean;
  accessibilityLabel?: string;
  accessibilityValue?: { text: string };
};

export function ProgressBar({
  progress,
  variant = "solid",
  color = colors.accentBlue,
  height = BAR_HEIGHT,
  borderRadius = BAR_RADIUS,
  rangeMin,
  rangeMax,
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
        easing: Easing.bezier(0.34, 1.56, 0.64, 1),
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

  const fillColor =
    variant === "holo-protein"
      ? proteinBarColor(clamped)
      : variant === "solid"
        ? color
        : undefined;
  const useGradient =
    variant === "holo-primary" || (variant === "holo-protein" && clamped >= 0.9);

  const gradientColors: [string, string, ...string[]] =
    variant === "holo-primary"
      ? [...holoGradients.primary] as [string, string, ...string[]]
      : [...holoGradients.protein] as [string, string, ...string[]];

  return (
    <View
      style={[
        styles.track,
        {
          height,
          borderRadius,
        },
      ]}
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={accessibilityValue}
    >
      {rangeMin != null && rangeMax != null && rangeMin < rangeMax && (
        <View
          style={[
            styles.rangeBand,
            {
              left: `${rangeMin * 100}%`,
              width: `${(rangeMax - rangeMin) * 100}%`,
              height,
              borderRadius,
            },
          ]}
          pointerEvents="none"
        />
      )}
      <Animated.View
        style={[
          styles.fillWrap,
          {
            width: widthInterpolate,
            height,
            borderRadius,
          },
        ]}
      >
        {useGradient ? (
          <LinearGradient
            colors={gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[StyleSheet.absoluteFill, { borderRadius }]}
          />
        ) : (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: fillColor ?? color, borderRadius },
            ]}
          />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  rangeBand: {
    position: "absolute",
    top: 0,
    backgroundColor: RANGE_BAND_COLOR,
  },
  fillWrap: {
    position: "absolute",
    left: 0,
    top: 0,
    overflow: "hidden",
  },
});
