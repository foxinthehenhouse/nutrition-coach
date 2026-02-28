import React, { useRef } from "react";
import {
  View,
  TextInput,
  Pressable,
  Animated,
  type NativeSyntheticEvent,
  type TextInputFocusEventData,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, fontFamily } from "../../lib/theme";

type InputBarProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: (text: string) => void;
  onCamera: () => void;
  onVoice: () => void;
};

export function InputBar({
  value,
  onChangeText,
  onSend,
  onCamera,
  onVoice,
}: InputBarProps) {
  const [focused, setFocused] = React.useState(false);
  const sendScale = useRef(new Animated.Value(1)).current;

  const handleFocus = (e: NativeSyntheticEvent<TextInputFocusEventData>) => {
    setFocused(true);
  };

  const handleBlur = (e: NativeSyntheticEvent<TextInputFocusEventData>) => {
    setFocused(false);
  };

  const handleSendPressIn = () => {
    Animated.timing(sendScale, {
      toValue: 0.92,
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
    onSend(value);
  };

  const iconColor = focused ? colors.textPrimary : colors.textDim;

  return (
    <View>
      <View
        style={{
          backgroundColor: "transparent",
          borderWidth: 1,
          borderColor: focused ? "rgba(168,237,234,0.3)" : colors.border,
          borderRadius: 20,
          padding: 18,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="what did you eat?"
          placeholderTextColor={colors.textDim}
          multiline
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 16,
            color: colors.textPrimary,
            minHeight: 24,
            maxHeight: 120,
          }}
        />
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <Pressable onPress={onCamera} hitSlop={12}>
            <Feather name="camera" size={22} color={iconColor} />
          </Pressable>
          <Pressable onPress={onVoice} hitSlop={12}>
            <Feather name="mic" size={22} color={iconColor} />
          </Pressable>
          <Animated.View style={{ transform: [{ scale: sendScale }] }}>
            <Pressable
              onPress={handleSend}
              onPressIn={handleSendPressIn}
              onPressOut={handleSendPressOut}
              hitSlop={12}
            >
              <Feather name="send" size={22} color={iconColor} />
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}
