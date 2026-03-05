import React, { useRef } from "react";
import { View, Text, Pressable } from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { Feather } from "@expo/vector-icons";
import { colors, fontFamily } from "../../lib/theme";

const ACTION_WIDTH = 80;

type SwipeableRowProps = {
  children: React.ReactNode;
  onDelete: () => void;
  onRepeat?: () => void;
};

export function SwipeableRow({ children, onDelete, onRepeat }: SwipeableRowProps) {
  const swipeableRef = useRef<Swipeable>(null);

  const close = () => {
    swipeableRef.current?.close();
  };

  const renderRightActions = () => (
    <Pressable
      onPress={() => {
        onDelete();
        close();
      }}
      style={{
        width: ACTION_WIDTH,
        backgroundColor: colors.accentRed,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Feather name="trash-2" size={20} color={colors.textPrimary} />
      <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textPrimary, marginTop: 4 }}>
        Delete
      </Text>
    </Pressable>
  );

  const renderLeftActions = () => {
    if (onRepeat == null) return null;
    return (
      <Pressable
        onPress={() => {
          onRepeat();
          close();
        }}
        style={{
          width: ACTION_WIDTH,
          backgroundColor: colors.accentGreen,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Feather name="repeat" size={20} color={colors.bg} />
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.bg, marginTop: 4 }}>
          Log again
        </Text>
      </Pressable>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      renderLeftActions={onRepeat != null ? renderLeftActions : undefined}
      friction={2}
      rightThreshold={40}
      leftThreshold={40}
    >
      {children}
    </Swipeable>
  );
}
