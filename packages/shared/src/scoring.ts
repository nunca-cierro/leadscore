// evaluateScore() puro — design §1.5 / SPEC configurable-scoring. Sin I/O
// (design §4: packages/shared no hace fetch, no toca la DB).
//
// Contrato:
//   value = Σ weight(met) · max = Σ weight(enabled)
//   - positive suma cuando la señal cruda cumple; inverse SOLO cuando la señal
//     NO cumple (únicos inversos: no_website, no_wa_reply).
//   - threshold se compara SIEMPRE contra la señal cruda (4.3 vs 4.5 → false).
//   - sin dato (mode=manual sin capturar o mode=auto sin check) → met:false,
//     pending:true; sigue contando en max si el criterio está enabled.
//   - enabled=false queda fuera de value, max y breakdown.
// El orden del breakdown es el orden de entrada (la ruta ordena por position).

import type { Mode, Polarity } from "./enums.js";

export interface ScoreCriterion {
  key: string;
  polarity: Polarity;
  weight: number;
  threshold: number | null;
  mode: Mode;
  enabled: boolean;
}

export type RawSignal = boolean | number;

export interface CriterionBreakdown {
  key: string;
  met: boolean;
  pending: boolean;
  weight: number;
}

export interface ScoreResult {
  value: number;
  max: number;
  breakdown: CriterionBreakdown[];
}

function signalComplies(raw: RawSignal, threshold: number | null): boolean {
  if (threshold !== null) return Number(raw) >= threshold;
  if (typeof raw === "boolean") return raw;
  return raw !== 0;
}

export function evaluateScore(
  criteria: ScoreCriterion[],
  signals: Record<string, RawSignal | null | undefined>,
): ScoreResult {
  let value = 0;
  let max = 0;
  const breakdown: CriterionBreakdown[] = [];
  for (const c of criteria) {
    if (!c.enabled) continue;
    max += c.weight;
    const raw = signals[c.key];
    if (raw === null || raw === undefined) {
      breakdown.push({ key: c.key, met: false, pending: true, weight: c.weight });
      continue;
    }
    const complies = signalComplies(raw, c.threshold);
    const met = c.polarity === "inverse" ? !complies : complies;
    if (met) value += c.weight;
    breakdown.push({ key: c.key, met, pending: false, weight: c.weight });
  }
  return { value, max, breakdown };
}
