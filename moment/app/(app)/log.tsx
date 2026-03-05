import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  SectionList,
  ActivityIndicator,
  Pressable,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { deleteFoodLogEntry } from "../../lib/api";
import { colors, fontFamily } from "../../lib/theme";

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
  date: string;
  data: FoodRow[];
  totalCal: number;
  totalP: number;
  totalC: number;
  totalF: number;
}

function formatDateLabel(dateStr: string): string {
  const todayStr = new Date().toISOString().split("T")[0];
  const yesterdayStr = new Date(Date.now() - 86400000)
    .toISOString()
    .split("T")[0];

  if (dateStr === todayStr) return "TODAY";
  if (dateStr === yesterdayStr) return "YESTERDAY";
  return new Date(dateStr)
    .toLocaleDateString("en-AU", {
      weekday: "long",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
}

function timeToMinutes(t: string | null): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function findDuplicateIds(data: FoodRow[]): Set<string> {
  const duplicateIds = new Set<string>();
  const sorted = [...data].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const diff = timeToMinutes(sorted[j].time) - timeToMinutes(sorted[i].time);
      if (diff > 3) break;
      const descA = (sorted[i].description ?? "").trim().toLowerCase();
      const descB = (sorted[j].description ?? "").trim().toLowerCase();
      if (descA && descA === descB) {
        duplicateIds.add(sorted[j].id);
        break;
      }
    }
  }
  return duplicateIds;
}

function groupByDate(rows: FoodRow[]): Section[] {
  const map = new Map<string, FoodRow[]>();
  for (const row of rows) {
    const key = row.date;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return Array.from(map.entries()).map(([date, data]) => {
    const totalCal = data.reduce((s, r) => s + (r.calories ?? 0), 0);
    const totalP = data.reduce((s, r) => s + (Number(r.protein_g) ?? 0), 0);
    const totalC = data.reduce((s, r) => s + (Number(r.carbs_g) ?? 0), 0);
    const totalF = data.reduce((s, r) => s + (Number(r.fat_g) ?? 0), 0);
    return {
      title: formatDateLabel(date),
      date,
      data,
      totalCal,
      totalP,
      totalC,
      totalF,
    };
  });
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
          backgroundColor: colors.bg,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 60 }} />
      </View>
    );
  }

  return (
    <SectionList
      style={{ backgroundColor: colors.bg }}
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
            color: colors.textPrimary,
            paddingHorizontal: 20,
            marginBottom: 24,
          }}
        >
          History
        </Text>
      }
      ListEmptyComponent={
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 14,
            color: colors.textTertiary,
            textAlign: "center",
            marginTop: 60,
          }}
        >
          nothing logged yet.
        </Text>
      }
      renderSectionHeader={({ section }: { section: Section }) => (
        <View
          style={{
            paddingHorizontal: 20,
            paddingVertical: 12,
            marginTop: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.borderSubtle,
          }}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
            <Text
              style={{
                fontFamily: fontFamily.regular,
                fontSize: 11,
                color: colors.textTertiary,
                letterSpacing: 1.5,
              }}
            >
              {section.title}
            </Text>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 11, color: colors.textTertiary }}>·</Text>
            <Text
              style={{
                fontFamily: fontFamily.regular,
                fontSize: 13,
                color: colors.textSecondary,
              }}
            >
              {section.totalCal} cal
            </Text>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 11, color: colors.textTertiary }}>·</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentGreen }} />
              <Text style={{ fontFamily: fontFamily.regular, fontSize: 12, color: colors.textSecondary }}>
                {Math.round(section.totalP)}g
              </Text>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentBlue }} />
              <Text style={{ fontFamily: fontFamily.regular, fontSize: 12, color: colors.textSecondary }}>
                {Math.round(section.totalC)}g
              </Text>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentOrange }} />
              <Text style={{ fontFamily: fontFamily.regular, fontSize: 12, color: colors.textSecondary }}>
                {Math.round(section.totalF)}g
              </Text>
            </View>
          </View>
        </View>
      )}
      renderItem={({ item, section }: { item: FoodRow; section: Section }) => {
        const duplicateIds = findDuplicateIds(section.data);
        const isDuplicate = duplicateIds.has(item.id);
        return (
          <View style={{ paddingHorizontal: 20, paddingVertical: 14 }}>
            {isDuplicate && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "rgba(255,149,0,0.15)",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                }}
              >
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textPrimary, flex: 1 }}>
                  Looks like a duplicate — did you mean to log this twice?
                </Text>
                <Pressable
                  onPress={() => {
                    Alert.alert("Remove duplicate", "Remove this entry?", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Remove duplicate", style: "destructive", onPress: async () => {
                        try {
                          await deleteFoodLogEntry(item.id);
                          load();
                        } catch (e) {
                          Alert.alert("Error", "Could not remove entry.");
                        }
                      } },
                    ]);
                  }}
                  style={{ marginLeft: 8 }}
                >
                  <Text style={{ fontFamily: fontFamily.bold, fontSize: 13, color: colors.accentOrange }}>Remove duplicate</Text>
                </Pressable>
              </View>
            )}
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
                  color: colors.textPrimary,
                }}
              >
                {item.description}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentGreen }} />
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>
                  {Math.round(item.protein_g ?? 0)}g
                </Text>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentBlue }} />
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>
                  {Math.round(item.carbs_g ?? 0)}g
                </Text>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentOrange }} />
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>
                  {Math.round(item.fat_g ?? 0)}g
                </Text>
                <View style={{ flex: 1 }} />
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 12, color: colors.textTertiary }}>
                  {item.time?.slice(0, 5) ?? ""}
                </Text>
              </View>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text
                style={{
                  fontFamily: fontFamily.bold,
                  fontSize: 17,
                  color: colors.textPrimary,
                }}
              >
                {item.calories ?? 0}
              </Text>
            </View>
          </View>
          <View
            style={{
              height: 1,
              backgroundColor: "rgba(255,255,255,0.06)",
              marginTop: 14,
            }}
          />
        </View>
        );
      }}
    />
  );
}
