import { useState, useEffect, useCallback } from "react";
import { View, Text, ScrollView, Dimensions, ActivityIndicator, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import {
  colors,
  fontFamily,
  recoveryColor,
  holoGradient,
  calorieBarColor,
  proteinBarColor,
} from "../../lib/theme";
import { supabase } from "../../lib/supabase";

const DAY_LABELS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const CHART_WIDTH = Dimensions.get("window").width - 40;
const BAR_WIDTH = 28;
const CHART_HEIGHT = 80;
const PROTEIN_TARGET_DEFAULT = 190;
const CALORIE_TARGET_DEFAULT = 2900;

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: fontFamily.regular,
        fontSize: 11,
        color: colors.textTertiary,
        textTransform: "uppercase",
        letterSpacing: 1.5,
        marginBottom: 10,
      }}
    >
      {children}
    </Text>
  );
}

function getWeekDates(weekOffset: number): string[] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset + weekOffset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().split("T")[0];
  });
}

function formatWeekRange(dates: string[]): string {
  if (dates.length < 2) return "";
  const first = new Date(dates[0]);
  const last = new Date(dates[dates.length - 1]);
  return `${first.getDate()} – ${last.getDate()} ${last.toLocaleDateString("en-AU", { month: "short" }).toLowerCase()}`;
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
  const [weekOffset, setWeekOffset] = useState(0);
  const dates = getWeekDates(weekOffset);
  const weekRangeLabel = formatWeekRange(dates);

  const [calData, setCalData] = useState<CalDay[]>([]);
  const [whoopData, setWhoopData] = useState<WhoopDay[]>([]);
  const [weekSummary, setWeekSummary] = useState<WeekSummary | null>(null);
  const [calorieTarget, setCalorieTarget] = useState(CALORIE_TARGET_DEFAULT);
  const [proteinTarget, setProteinTarget] = useState(PROTEIN_TARGET_DEFAULT);
  const [loading, setLoading] = useState(true);

  const loadWeek = useCallback(async () => {
    setLoading(true);
    const [foodRes, whoopRes, patternRes, userRes] = await Promise.all([
      supabase.from("food_log").select("date, calories, protein_g").in("date", dates).order("date", { ascending: true }),
      supabase.from("whoop_cache").select("date, recovery_score, hrv_rmssd, strain_score").in("date", dates).order("date", { ascending: true }),
      supabase.from("pattern_summaries").select("*").eq("period_type", "weekly").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.auth.getUser(),
    ]);
    const userMeta = userRes.data?.user?.user_metadata ?? {};
    setCalorieTarget(userMeta.calorie_target ?? CALORIE_TARGET_DEFAULT);
    setProteinTarget(userMeta.protein_target ?? PROTEIN_TARGET_DEFAULT);

    const agg = new Map<string, { calories: number; protein: number }>();
    for (const d of dates) agg.set(d, { calories: 0, protein: 0 });
    for (const row of (foodRes.data as any[]) ?? []) {
      const entry = agg.get(row.date);
      if (entry) {
        entry.calories += row.calories ?? 0;
        entry.protein += Number(row.protein_g) ?? 0;
      }
    }
    setCalData(dates.map((d) => ({ date: d, calories: agg.get(d)!.calories, protein: agg.get(d)!.protein })));
    setWhoopData(
      dates.map((d) => {
        const row = ((whoopRes.data as any[]) ?? []).find((r: any) => r.date === d);
        return { date: d, recovery_score: row?.recovery_score ?? null };
      })
    );
    setWeekSummary(patternRes.data as WeekSummary | null);
    setLoading(false);
  }, [dates.join(",")]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  if (loading) {
    return (
      <ScrollView
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: insets.top + 24,
          paddingBottom: 60,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable onPress={() => setWeekOffset((o) => o - 1)} hitSlop={12}>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 18, color: colors.textSecondary }}>←</Text>
          </Pressable>
          <Text style={{ fontFamily: fontFamily.bold, fontSize: 18, color: colors.textPrimary }}>this week</Text>
          <Pressable onPress={() => setWeekOffset((o) => o + 1)} hitSlop={12}>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 18, color: colors.textSecondary }}>→</Text>
          </Pressable>
        </View>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary, marginTop: 4, textAlign: "center" }}>
          {weekRangeLabel}
        </Text>
        <ActivityIndicator color={colors.accentGreen} size="small" style={{ marginTop: 60, alignSelf: "center" }} />
      </ScrollView>
    );
  }

  const maxCal = Math.max(...calData.map((d) => d.calories), calorieTarget, 1);
  const maxProtein = Math.max(...calData.map((d) => d.protein), proteinTarget, 1);
  const weekCalTotal = calData.reduce((s, d) => s + d.calories, 0);
  const daysWithCal = calData.filter((d) => d.calories > 0).length;
  const avgCal = Math.round(weekCalTotal / Math.max(daysWithCal, 1));
  const daysHitProtein = calData.filter((d) => d.protein >= proteinTarget).length;
  const weekTargetCal = calorieTarget * 7;
  const targetLineY = calorieTarget <= maxCal ? CHART_HEIGHT - (calorieTarget / maxCal) * CHART_HEIGHT : CHART_HEIGHT + 5;
  const bestProteinDay = calData.reduce((best, d) => (d.protein > (best?.protein ?? 0) ? d : best), null as CalDay | null);

  const hasRecovery = whoopData.some((d) => d.recovery_score != null);

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: insets.top + 24,
        paddingBottom: 60,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Pressable onPress={() => setWeekOffset((o) => o - 1)} hitSlop={12}>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 18, color: colors.textSecondary }}>←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.bold, fontSize: 18, color: colors.textPrimary }}>this week</Text>
        <Pressable onPress={() => setWeekOffset((o) => o + 1)} hitSlop={12}>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 18, color: colors.textSecondary }}>→</Text>
        </Pressable>
      </View>
      <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary, marginTop: 4, textAlign: "center" }}>
        {weekRangeLabel}
      </Text>

      {/* AI Weekly Summary */}
      <View
        style={{
          marginTop: 24,
          backgroundColor: colors.surface,
          borderRadius: 16,
          padding: 16,
          marginHorizontal: 0,
          borderWidth: 1,
          borderColor: colors.borderSubtle,
        }}
      >
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 12, color: colors.textTertiary, letterSpacing: 1.5, marginBottom: 6 }}>
          THIS WEEK AT A GLANCE
        </Text>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, color: colors.textPrimary, lineHeight: 22 }}>
          {(() => {
            const pctCal = calorieTarget > 0 ? Math.round((avgCal / calorieTarget) * 100) : 0;
            const bestRecovery = whoopData.filter((d) => d.recovery_score != null).sort((a, b) => (b.recovery_score ?? 0) - (a.recovery_score ?? 0))[0];
            const bestProteinDay = calData.reduce((best, d) => (d.protein > (best?.protein ?? 0) ? d : best), null as CalDay | null);
            let line = `You're eating at ${pctCal}% of your calorie target.`;
            if (bestRecovery && bestProteinDay && bestProteinDay.protein >= proteinTarget) {
              const dayName = dayAbbr(bestProteinDay.date);
              line += ` Your best recovery (${Math.round(bestRecovery.recovery_score ?? 0)}%) came the day after your highest protein day. Hit protein 4+ days next week to see that improve.`;
            } else {
              line += ` Hit protein ${proteinTarget}g on 4+ days next week to support recovery.`;
            }
            return line;
          })()}
        </Text>
      </View>

      {/* Calories */}
      <View style={{ marginTop: 24 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 11, color: colors.textTertiary, letterSpacing: 1.5 }}>CALORIES</Text>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>
            avg {avgCal} / target {calorieTarget}
            {avgCal < calorieTarget ? ` (+${Math.round(((calorieTarget - avgCal) / calorieTarget) * 100)}% to go)` : ""}
          </Text>
        </View>
        <View style={{ height: CHART_HEIGHT + 20, position: "relative" }}>
          {/* Target line */}
          {calorieTarget <= maxCal && (
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: targetLineY,
                height: 0,
                borderStyle: "dashed",
                borderTopWidth: 1.5,
                borderColor: "rgba(255,255,255,0.25)",
              }}
            />
          )}
          <View style={{ flexDirection: "row", height: CHART_HEIGHT, alignItems: "flex-end", justifyContent: "space-between" }}>
            {calData.map((d) => {
              const barH = Math.max((d.calories / maxCal) * CHART_HEIGHT, d.calories > 0 ? 2 : 0);
              const pct = calorieTarget > 0 ? d.calories / calorieTarget : 0;
              const barColor = d.calories > 0 ? calorieBarColor(pct) : "rgba(255,255,255,0.1)";
              return (
                <View key={d.date} style={{ width: BAR_WIDTH, alignItems: "center", justifyContent: "flex-end" }}>
                  <View
                    style={{
                      width: BAR_WIDTH,
                      height: barH,
                      backgroundColor: barColor,
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                    }}
                  />
                </View>
              );
            })}
          </View>
        </View>
        <View style={{ flexDirection: "row", marginTop: 6, justifyContent: "space-between" }}>
          {calData.map((d) => (
            <View key={d.date} style={{ width: BAR_WIDTH, alignItems: "center" }}>
              <Text style={{ fontFamily: fontFamily.regular, fontSize: 10, color: colors.textTertiary }}>{dayAbbr(d.date)}</Text>
            </View>
          ))}
        </View>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary, marginTop: 10 }}>
          {avgCal} avg · {weekCalTotal} total · target: {weekTargetCal}
        </Text>
      </View>

      {/* Protein */}
      <View style={{ marginTop: 24 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 11, color: colors.textTertiary, letterSpacing: 1.5 }}>PROTEIN</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentRed }} />
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 11, color: colors.textSecondary }}>&lt;95g</Text>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentOrange }} />
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 11, color: colors.textSecondary }}>95–170g</Text>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentGreen }} />
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 11, color: colors.textSecondary }}>170g+</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", height: 60, alignItems: "flex-end", justifyContent: "space-between" }}>
          {calData.map((d) => {
            const barH = Math.max((d.protein / maxProtein) * 60, d.protein > 0 ? 2 : 0);
            const pct = proteinTarget > 0 ? d.protein / proteinTarget : 0;
            const barColor = d.protein > 0 ? proteinBarColor(pct) : "rgba(255,255,255,0.1)";
            return (
              <View key={d.date} style={{ width: BAR_WIDTH, alignItems: "center", justifyContent: "flex-end" }}>
                <View
                  style={{
                    width: BAR_WIDTH,
                    height: barH,
                    backgroundColor: barColor,
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                  }}
                />
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", marginTop: 6, justifyContent: "space-between" }}>
          {calData.map((d) => (
            <View key={d.date} style={{ width: BAR_WIDTH, alignItems: "center" }}>
              <Text style={{ fontFamily: fontFamily.regular, fontSize: 10, color: colors.textTertiary }}>{dayAbbr(d.date)}</Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
          {calData.map((d) => {
            const pct = proteinTarget > 0 ? d.protein / proteinTarget : 0;
            const fill = pct >= 0.9 ? colors.accentGreen : pct >= 0.5 ? colors.accentOrange : d.protein > 0 ? colors.accentRed : colors.borderSubtle;
            return (
              <View key={d.date} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: fill, borderWidth: 1, borderColor: colors.borderSubtle }} />
            );
          })}
        </View>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary, marginTop: 6 }}>
          {daysHitProtein} of 7 days on target
        </Text>
        {bestProteinDay && bestProteinDay.protein >= proteinTarget && (
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.accentGreen, marginTop: 4 }}>
            Your best day was {dayAbbr(bestProteinDay.date)} — {Math.round(bestProteinDay.protein)}g protein
          </Text>
        )}
      </View>

      {/* Recovery vs nutrition overlay */}
      {hasRecovery && (
        <View style={{ marginTop: 24 }}>
          <SectionLabel>Recovery vs nutrition</SectionLabel>
          <Svg width={CHART_WIDTH} height={100}>
            {calData.map((d, i) => {
              const maxP = Math.max(...calData.map((x) => x.protein), 1);
              const barH = (d.protein / maxP) * 60;
              const x = (i / 6) * CHART_WIDTH - BAR_WIDTH / 2;
              const y = 78 - barH;
              return (
                <Rect
                  key={d.date}
                  x={x}
                  y={y}
                  width={BAR_WIDTH}
                  height={barH}
                  rx={4}
                  ry={4}
                  fill="rgba(255,255,255,0.15)"
                />
              );
            })}
            {whoopData.filter((d) => d.recovery_score != null).length >= 2 && (
              <Path
                d={whoopData
                  .map((d, i) => {
                    const y = 78 - ((d.recovery_score ?? 0) / 100) * 60;
                    const x = (i / 6) * CHART_WIDTH;
                    return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
                  })
                  .join(" ")}
                stroke={colors.accentGold}
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {whoopData.map((d, i) => {
              if (d.recovery_score == null) return null;
              const y = 78 - (d.recovery_score / 100) * 60;
              const x = (i / 6) * CHART_WIDTH;
              return <Circle key={d.date} cx={x} cy={y} r={4} fill={colors.accentGold} />;
            })}
          </Svg>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, color: colors.textSecondary, marginTop: 8 }}>
            {bestProteinDay && whoopData.some((d) => d.recovery_score != null)
              ? "Your recovery trend alongside protein — see the pattern?"
              : "Recovery and nutrition over the week."}
          </Text>
        </View>
      )}

      {/* Recovery */}
      {hasRecovery && (
        <View style={{ marginTop: 24 }}>
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
              const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" ");
              return (
                <>
                  {pathD && <Path d={pathD} stroke={colors.border} strokeWidth={1} fill="none" />}
                  {points.map((p, i) => (
                    <Circle key={i} cx={p.x} cy={p.y} r={4} fill={recoveryColor(p.score)} />
                  ))}
                </>
              );
            })()}
          </Svg>
        </View>
      )}

      {/* Patterns */}
      {weekSummary && (
        <View style={{ marginTop: 24 }}>
          <SectionLabel>patterns</SectionLabel>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {[
              { value: `${weekSummary.summary.avg_calories}`, label: "avg cal / day" },
              { value: `${Math.round(weekSummary.summary.avg_protein_g)}g`, label: "avg protein" },
              { value: `${weekSummary.summary.protein_consistency_pct}%`, label: "protein consistency" },
              {
                value: weekSummary.summary.avg_recovery != null ? `${weekSummary.summary.avg_recovery}%` : "–",
                label: "avg recovery",
              },
            ].map((block) => (
              <View
                key={block.label}
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.borderSubtle,
                  borderRadius: 12,
                  padding: 14,
                  width: (CHART_WIDTH - 16) / 2,
                }}
              >
                <Text style={{ fontFamily: fontFamily.bold, fontSize: 22, color: colors.textPrimary }}>{block.value}</Text>
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>{block.label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {weekSummary && weekSummary.summary.avg_recovery != null && (
        <LinearGradient
          colors={holoGradient as unknown as string[]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ height: 1, width: "100%", marginTop: 24 }}
        />
      )}
    </ScrollView>
  );
}
