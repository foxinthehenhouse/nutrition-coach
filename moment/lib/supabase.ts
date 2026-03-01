import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const isWeb = Platform.OS === "web";
const isWebServerRender = isWeb && typeof window === "undefined";

const auth = isWebServerRender
  ? {
      // Static rendering runs in Node (no window/localStorage).
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    }
  : {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: isWeb,
      ...(isWeb ? {} : { storage: AsyncStorage }),
    };

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth,
});
