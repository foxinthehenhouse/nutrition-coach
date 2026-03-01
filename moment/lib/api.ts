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
