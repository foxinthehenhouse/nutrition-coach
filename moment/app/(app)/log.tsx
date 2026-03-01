import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  SectionList,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { fontFamily } from "../../lib/theme";

interface FoodRow {
  id: string;
  date: string;
  time: string | null;
  description: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

interface Section {
  title: string;
  data: FoodRow[];
}

function formatDateLabel(dateStr: string): string {
  const todayStr = new Date().toISOString().split("T")[0];
  const yesterdayStr = new Date(Date.now() - 86400000)
    .toISOString()
    .split("T")[0];

  if (dateStr === todayStr) return "today";
  if (dateStr === yesterdayStr) return "yesterday";

  return new Date(dateStr)
    .toLocaleDateString("en-AU", {
      weekday: "long",
      month: "short",
      day: "numeric",
    })
    .toLowerCase();
}

function groupByDate(rows: FoodRow[]): Section[] {
  const map = new Map<string, FoodRow[]>();
  for (const row of rows) {
    const key = row.date;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return Array.from(map.entries()).map(([date, data]) => ({
    title: formatDateLabel(date),
    data,
  }));
}

export default function Log() {
  const insets = useSafeAreaInsets();
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("food_log")
      .select("*")
      .order("date", { ascending: false })
      .order("time", { ascending: false })
      .limit(200);
    setSections(groupByDate((data as FoodRow[]) ?? []));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#080808",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator color="#22c55e" style={{ marginTop: 60 }} />
      </View>
    );
  }

  return (
    <SectionList
      style={{ backgroundColor: "#080808" }}
      contentContainerStyle={{
        paddingBottom: insets.bottom + 60,
        paddingTop: insets.top + 24,
      }}
      sections={sections}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <Text
          style={{
            fontFamily: fontFamily.bold,
            fontSize: 26,
            color: "#f0f0f0",
            paddingHorizontal: 24,
            marginBottom: 24,
          }}
        >
          log
        </Text>
      }
      ListEmptyComponent={
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 14,
            color: "#282828",
            textAlign: "center",
            marginTop: 60,
          }}
        >
          nothing logged yet.
        </Text>
      }
      renderSectionHeader={({ section }) => (
        <View
          style={{
            paddingHorizontal: 24,
            paddingVertical: 10,
            marginTop: 8,
          }}
        >
          <Text
            style={{
              fontFamily: fontFamily.regular,
              fontSize: 11,
              color: "#282828",
              textTransform: "uppercase",
              letterSpacing: 3,
            }}
          >
            {section.title}
          </Text>
        </View>
      )}
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: 24, paddingVertical: 14 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text
                numberOfLines={2}
                style={{
                  fontFamily: fontFamily.regular,
                  fontSize: 15,
                  color: "#f0f0f0",
                }}
              >
                {item.description}
              </Text>
              <Text
                style={{
                  fontFamily: fontFamily.regular,
                  fontSize: 12,
                  color: "#2a2a2a",
                  marginTop: 4,
                }}
              >
                {`P${Math.round(item.protein_g ?? 0)}  C${Math.round(item.carbs_g ?? 0)}  F${Math.round(item.fat_g ?? 0)}`}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text
                style={{
                  fontFamily: fontFamily.bold,
                  fontSize: 15,
                  color: "#f0f0f0",
                }}
              >
                {`${item.calories ?? 0}`}
              </Text>
              <Text
                style={{
                  fontFamily: fontFamily.regular,
                  fontSize: 11,
                  color: "#282828",
                  marginTop: 2,
                }}
              >
                {item.time?.slice(0, 5) ?? ""}
              </Text>
            </View>
          </View>
          <View
            style={{
              height: 1,
              backgroundColor: "#0f0f0f",
              marginTop: 14,
            }}
          />
        </View>
      )}
    />
  );
}
