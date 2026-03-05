import { supabase } from "./supabase";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

export async function logFood(description: string): Promise<{ message: string; logged?: Record<string, unknown> }> {
  if (!API_URL?.trim()) {
    throw new Error("Backend API URL not configured (EXPO_PUBLIC_API_URL)");
  }
  const res = await fetch(`${API_URL}/api/food`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed: ${res.status}`);
  }
  return data;
}

export async function deleteFoodLogEntry(id: string): Promise<void> {
  const { error } = await supabase.from("food_log").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateFoodLogEntry(
  id: string,
  payload: { description?: string; calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number }
): Promise<void> {
  const { error } = await supabase.from("food_log").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}
