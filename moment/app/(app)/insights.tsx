import { useState, useEffect } from "react";
import { View, Text, ScrollView, Dimensions, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import {
  colors,
  fontFamily,
  recoveryColor,
  holoGradient,
} from "../../lib/theme";
import { supabase } from "../../lib/supabase";

const DAY_LABELS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const CHART_WIDTH = Dimensions.get("window").width - 48;

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: fontFamily.regular,
        fontSize: 10,
        color: "#282828",
        textTransform: "uppercase",
        letterSpacing: 3,
        marginBottom: 14,
      }}
    >
      {children}
    </Text>
  );
}

function StatBlock({
  value,
  label,
  align,
}: {
  value: string;
  label: string;
  align: "flex-start" | "flex-end";
}) {
  return (
    <View style={{ alignItems: align }}>
      <Text
        style={{ fontFamily: fontFamily.bold, fontSize: 20, color: "#f0f0f0" }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 12,
          color: "#444444",
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function getLast7Dates(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split("T")[0];
  });
}

function dayAbbr(dateStr: string): string {
  const day = new Date(dateStr).getDay();
  return DAY_LABELS[day === 0 ? 6 : day - 1];
}

interface CalDay {
  date: string;
  calories: number;
  protein: number;
}

interface WhoopDay {
  date: string;
  recovery_score: number | null;
}

interface WeekSummary {
  summary: {
    avg_calories: number;
    avg_protein_g: number;
    protein_consistency_pct: number;
    avg_recovery: number | null;
  };
}

export default function Insights() {
  const insets = useSafeAreaInsets();
  const todayStr = new Date().toISOString().split("T")[0];
  const today = new Date()
    .toLocaleDateString("en-AU", {
      weekday: "long",
      month: "short",
      day: "numeric",
    })
    .toLowerCase();

  const [calData, setCalData] = useState<CalDay[]>([]);
  const [whoopData, setWhoopData] = useState<WhoopDay[]>([]);
  const [weekSummary, setWeekSummary] = useState<WeekSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const dates = getLast7Dates();

    Promise.all([
      supabase
        .from("food_log")
        .select("date, calories, protein_g")
        .in("date", dates)
        .order("date", { ascending: true }),
      supabase
        .from("whoop_cache")
        .select("date, recovery_score, hrv_rmssd, strain_score")
        .in("date", dates)
        .order("date", { ascending: true }),
      supabase
        .from("pattern_summaries")
        .select("*")
        .eq("period_type", "weekly")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(([foodRes, whoopRes, patternRes]) => {
      const agg = new Map<string, { calories: number; protein: number }>();
      for (const d of dates) agg.set(d, { calories: 0, protein: 0 });
      for (const row of (foodRes.data as any[]) ?? []) {
        const entry = agg.get(row.date);
        if (entry) {
          entry.calories += row.calories ?? 0;
          entry.protein += Number(row.protein_g) ?? 0;
        }
      }
      setCalData(
        dates.map((d) => ({
          date: d,
          calories: agg.get(d)!.calories,
          protein: agg.get(d)!.protein,
        }))
      );

      setWhoopData(
        dates.map((d) => {
          const row = ((whoopRes.data as any[]) ?? []).find(
            (r: any) => r.date === d
          );
          return {
            date: d,
            recovery_score: row?.recovery_score ?? null,
          };
        })
      );

      setWeekSummary(patternRes.data as WeekSummary | null);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <ScrollView
        style={{ backgroundColor: "#080808" }}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 24,
          paddingBottom: 60,
        }}
      >
        <Text
          style={{
            fontFamily: fontFamily.bold,
            fontSize: 26,
            color: "#f0f0f0",
          }}
        >
          this week
        </Text>
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 13,
            color: "#444444",
            marginTop: 4,
          }}
        >
          {today}
        </Text>
        <ActivityIndicator
          color="#22c55e"
          size="small"
          style={{ marginTop: 60, alignSelf: "center" }}
        />
      </ScrollView>
    );
  }

  const maxCal = Math.max(...calData.map((d) => d.calories), 1);
  const maxProtein = Math.max(...calData.map((d) => d.protein), 1);
  const weekCalTotal = calData.reduce((s, d) => s + d.calories, 0);
  const daysWithCal = calData.filter((d) => d.calories > 0).length;
  const avgCal = Math.round(weekCalTotal / Math.max(daysWithCal, 1));
  const daysHitProtein = calData.filter((d) => d.protein >= 160).length;

  const hasRecovery = whoopData.some((d) => d.recovery_score != null);

  return (
    <ScrollView
      style={{ backgroundColor: "#080808" }}
      contentContainerStyle={{
        paddingHorizontal: 24,
        paddingTop: insets.top + 24,
        paddingBottom: 60,
      }}
    >
      <Text
        style={{
          fontFamily: fontFamily.bold,
          fontSize: 26,
          color: "#f0f0f0",
        }}
      >
        this week
      </Text>
      <Text
        style={{
          fontFamily: fontFamily.regular,
          fontSize: 13,
          color: "#444444",
          marginTop: 4,
        }}
      >
        {today}
      </Text>

      {/* Calories */}
      <View style={{ marginTop: 40 }}>
        <SectionLabel>calories</SectionLabel>
        <View
          style={{
            flexDirection: "row",
            height: 80,
            alignItems: "flex-end",
          }}
        >
          {calData.map((d) => {
            const barH = Math.max((d.calories / maxCal) * 80, d.calories > 0 ? 2 : 0);
            const isToday = d.date === todayStr;
            const barColor =
              d.calories > 0
                ? isToday
                  ? "#a8edea"
                  : "#3b82f6"
                : "#111111";
            return (
              <View
                key={d.date}
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "flex-end",
                }}
              >
                <View
                  style={{
                    width: "60%",
                    height: barH,
                    backgroundColor: barColor,
                    borderTopLeftRadius: 3,
                    borderTopRightRadius: 3,
                  }}
                />
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", marginTop: 6 }}>
          {calData.map((d) => (
            <View key={d.date} style={{ flex: 1, alignItems: "center" }}>
              <Text
                style={{
                  fontFamily: fontFamily.regular,
                  fontSize: 10,
                  color: "#282828",
                }}
              >
                {dayAbbr(d.date)}
              </Text>
            </View>
          ))}
        </View>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginTop: 16,
          }}
        >
          <StatBlock value={`${avgCal}`} label="avg / day" align="flex-start" />
          <StatBlock
            value={`${weekCalTotal}`}
            label="week total"
            align="flex-end"
          />
        </View>
      </View>

      {/* Protein */}
      <View style={{ marginTop: 40 }}>
        <SectionLabel>protein</SectionLabel>
        <View
          style={{
            flexDirection: "row",
            height: 60,
            alignItems: "flex-end",
          }}
        >
          {calData.map((d) => {
            const barH = Math.max(
              (d.protein / maxProtein) * 60,
              d.protein > 0 ? 2 : 0
            );
            let barColor = "#111111";
            if (d.protein >= 160) barColor = "#22c55e";
            else if (d.protein >= 120) barColor = "#f59e0b";
            else if (d.protein > 0) barColor = "#ef4444";
            return (
              <View
                key={d.date}
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "flex-end",
                }}
              >
                <View
                  style={{
                    width: "60%",
                    height: barH,
                    backgroundColor: barColor,
                    borderTopLeftRadius: 3,
                    borderTopRightRadius: 3,
                  }}
                />
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", marginTop: 6 }}>
          {calData.map((d) => (
            <View key={d.date} style={{ flex: 1, alignItems: "center" }}>
              <Text
                style={{
                  fontFamily: fontFamily.regular,
                  fontSize: 10,
                  color: "#282828",
                }}
              >
                {dayAbbr(d.date)}
              </Text>
            </View>
          ))}
        </View>
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: 13,
            color: "#444444",
            marginTop: 14,
          }}
        >
          {`${daysHitProtein}/7 days on target`}
        </Text>
      </View>

      {/* Recovery */}
      {hasRecovery && (
        <View style={{ marginTop: 40 }}>
          <SectionLabel>recovery</SectionLabel>
          <Svg width={CHART_WIDTH} height={48}>
            {(() => {
              const points: { x: number; y: number; score: number }[] = [];
              whoopData.forEach((d, i) => {
                if (d.recovery_score != null) {
                  points.push({
                    x: (i / 6) * CHART_WIDTH,
                    y: 44 - (d.recovery_score / 100) * 40,
                    score: d.recovery_score,
                  });
                }
              });
              const pathD = points
                .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`)
                .join(" ");
              return (
                <>
                  {pathD && (
                    <Path
                      d={pathD}
                      stroke="#1c1c1c"
                      strokeWidth={1}
                      fill="none"
                    />
                  )}
                  {points.map((p, i) => (
                    <Circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={4}
                      fill={recoveryColor(p.score)}
                    />
                  ))}
                </>
              );
            })()}
          </Svg>
        </View>
      )}

      {/* Patterns */}
      {weekSummary && (
        <View style={{ marginTop: 40 }}>
          <SectionLabel>patterns</SectionLabel>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
            {[
              {
                value: `${weekSummary.summary.avg_calories}`,
                label: "avg cal / day",
              },
              {
                value: `${Math.round(weekSummary.summary.avg_protein_g)}g`,
                label: "avg protein",
              },
              {
                value: `${weekSummary.summary.protein_consistency_pct}%`,
                label: "protein consistency",
              },
              {
                value:
                  weekSummary.summary.avg_recovery != null
                    ? `${weekSummary.summary.avg_recovery}%`
                    : "–",
                label: "avg recovery",
              },
            ].map((block) => (
              <View
                key={block.label}
                style={{
                  backgroundColor: "#0f0f0f",
                  borderWidth: 1,
                  borderColor: "#111111",
                  borderRadius: 12,
                  padding: 14,
                  width: (CHART_WIDTH - 16) / 2,
                }}
              >
                <Text
                  style={{
                    fontFamily: fontFamily.bold,
                    fontSize: 22,
                    color: "#f0f0f0",
                  }}
                >
                  {block.value}
                </Text>
                <Text
                  style={{
                    fontFamily: fontFamily.regular,
                    fontSize: 12,
                    color: "#444444",
                    marginTop: 4,
                  }}
                >
                  {block.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Holographic reward line */}
      {weekSummary && weekSummary.summary.avg_recovery != null && (
        <LinearGradient
          colors={holoGradient as unknown as string[]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ height: 1, width: "100%", marginTop: 40 }}
        />
      )}
    </ScrollView>
  );
}
