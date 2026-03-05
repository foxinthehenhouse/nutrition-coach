import React, { useRef } from "react";
import {
  View,
  TextInput,
  Pressable,
  Animated,
  ActivityIndicator,
  type NativeSyntheticEvent,
  type TextInputFocusEventData,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fontFamily, radius, holoGradients } from "../../lib/theme";

type InputBarProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: (text: string) => void;
  onCamera: () => void;
  onVoice: () => void;
  isRecording?: boolean;
  voiceLoading?: boolean;
  placeholder?: string;
};

const ICON_COLOR = "rgba(255,255,255,0.35)";
const SEND_BTN_SIZE = 32;

export function InputBar({
  value,
  onChangeText,
  onSend,
  onCamera,
  onVoice,
  isRecording,
  voiceLoading,
  placeholder = "what did you eat?",
}: InputBarProps) {
  const [focused, setFocused] = React.useState(false);
  const sendScale = useRef(new Animated.Value(1)).current;
  const hasText = value.trim().length > 0;

  const handleFocus = (e: NativeSyntheticEvent<TextInputFocusEventData>) => {
    setFocused(true);
  };

  const handleBlur = (e: NativeSyntheticEvent<TextInputFocusEventData>) => {
    setFocused(false);
  };

  const handleSendPressIn = () => {
    Animated.timing(sendScale, {
      toValue: 0.96,
      duration: 100,
      useNativeDriver: true,
    }).start();
  };

  const handleSendPressOut = () => {
    Animated.timing(sendScale, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start();
  };

  const handleSend = () => {
    if (hasText) onSend(value);
  };

  const micColor = isRecording ? colors.accentRed : ICON_COLOR;

  return (
    <View
      style={[
        {
          height: 56,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: colors.surfaceElevated,
          borderWidth: 1,
          borderColor: focused ? "rgba(91,156,246,0.6)" : "rgba(255,255,255,0.1)",
          borderRadius: radius.inputBar,
          paddingLeft: 16,
          paddingRight: 12,
        },
        focused && {
          shadowColor: colors.accentBlue,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.2,
          shadowRadius: 12,
          elevation: 4,
        },
      ]}
    >
      <Pressable onPress={onCamera} hitSlop={12} style={{ padding: 8 }} accessibilityLabel="Log meal with camera">
        <Feather name="camera" size={20} color={ICON_COLOR} />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.3)"
        style={{
          flex: 1,
          fontFamily: fontFamily.regular,
          fontSize: 16,
          color: colors.textPrimary,
          marginHorizontal: 12,
          paddingVertical: 0,
        }}
        returnKeyType="send"
        onSubmitEditing={() => hasText && onSend(value)}
      />
      <Pressable onPress={onVoice} hitSlop={12} style={{ padding: 8 }} accessibilityLabel="Voice input">
        {voiceLoading ? (
          <ActivityIndicator size="small" color={ICON_COLOR} />
        ) : (
          <Feather name="mic" size={20} color={micColor} />
        )}
      </Pressable>
      <Animated.View style={{ transform: [{ scale: sendScale }] }}>
        <Pressable
          onPress={handleSend}
          onPressIn={handleSendPressIn}
          onPressOut={handleSendPressOut}
          hitSlop={12}
          disabled={!hasText}
          style={{
            width: SEND_BTN_SIZE,
            height: SEND_BTN_SIZE,
            borderRadius: SEND_BTN_SIZE / 2,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
          }}
          accessibilityLabel="Send"
        >
          {hasText ? (
            <LinearGradient
              colors={[...holoGradients.primary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                position: "absolute",
                width: SEND_BTN_SIZE,
                height: SEND_BTN_SIZE,
                borderRadius: SEND_BTN_SIZE / 2,
              }}
            />
          ) : (
            <View
              style={{
                position: "absolute",
                width: SEND_BTN_SIZE,
                height: SEND_BTN_SIZE,
                borderRadius: SEND_BTN_SIZE / 2,
                backgroundColor: "rgba(255,255,255,0.1)",
              }}
            />
          )}
          <Feather name="arrow-right" size={16} color={hasText ? colors.textPrimary : "rgba(255,255,255,0.5)"} />
        </Pressable>
      </Animated.View>
    </View>
  );
}
