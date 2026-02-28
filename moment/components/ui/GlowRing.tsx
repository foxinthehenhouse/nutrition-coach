import React, { useEffect, useRef } from "react";
import { View, Text, Animated, Easing } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { colors, fontFamily } from "../../lib/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type GlowRingProps = {
  size: number;
  progress: number;
  color: string;
  centerLabel: string;
  centerSublabel?: string;
};

export function GlowRing({
  size,
  progress,
  color,
  centerLabel,
  centerSublabel,
}: GlowRingProps) {
  const animValue = useRef(new Animated.Value(0)).current;
  const strokeWidth = size / 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  useEffect(() => {
    Animated.timing(animValue, {
      toValue: progress,
      duration: 1000,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const strokeDashoffset = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  const glowRadius = radius + 4;

  const hexToRgba = (hex: string, alpha: number) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return hex;
    const r = parseInt(result[1], 16);
    const g = parseInt(result[2], 16);
    const b = parseInt(result[3], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const glowColor = hexToRgba(color, 0.15);

  const labelSize = Math.max(size * 0.25, 14);

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        {/* Glow circle (behind) */}
        <Circle
          cx={center}
          cy={center}
          r={glowRadius}
          stroke={glowColor}
          strokeWidth={strokeWidth + 4}
          fill="none"
        />
        {/* Track */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={colors.border}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress arc */}
        <G transform={`rotate(-90 ${center} ${center})`}>
          <AnimatedCircle
            cx={center}
            cy={center}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <View style={{ alignItems: "center", justifyContent: "center" }}>
        <Text
          style={{
            fontFamily: fontFamily.bold,
            fontSize: labelSize,
            color: colors.textPrimary,
          }}
        >
          {centerLabel}
        </Text>
        {centerSublabel != null && (
          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 10,
              color: colors.textMuted,
              marginTop: 2,
            }}
          >
            {centerSublabel}
          </Text>
        )}
      </View>
    </View>
  );
}
