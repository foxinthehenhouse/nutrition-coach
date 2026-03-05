/**
 * Dynamic calorie and protein range from base targets, WHOOP strain, and recovery.
 * Strain bands: 0–8 (×0.88), 8–13 (×1), 13–18 (×1.10), 18–21 (×1.22).
 * Recovery: <33% (−5%), 33–66% (0), >66% (+5%).
 */

function strainMultiplier(strain: number): number {
  if (strain < 8) return 0.88;
  if (strain <= 13) return 1;
  if (strain <= 18) return 1.1;
  return 1.22;
}

function recoveryModifier(recoveryPct: number): number {
  if (recoveryPct < 33) return -0.05;
  if (recoveryPct <= 66) return 0;
  return 0.05;
}

export type RangeTargets = {
  calMin: number;
  calMax: number;
  proteinMin: number;
  proteinMax: number;
  calMid: number;
  proteinMid: number;
};

export function getRangeTargets(
  baseCalories: number,
  baseProtein: number,
  strain: number,
  recoveryPct: number
): RangeTargets {
  const strainMult = strainMultiplier(strain);
  const recMod = recoveryModifier(recoveryPct);
  const factor = strainMult * (1 + recMod);
  const calMid = Math.round(baseCalories * factor);
  const proteinMid = Math.round(baseProtein * factor);
  const bandPct = 0.034;
  const calMin = Math.round(calMid * (1 - bandPct));
  const calMax = Math.round(calMid * (1 + bandPct));
  const proteinMin = Math.max(0, Math.round(proteinMid * (1 - bandPct)));
  const proteinMax = Math.round(proteinMid * (1 + bandPct));
  return { calMin, calMax, proteinMin, proteinMax, calMid, proteinMid };
}
