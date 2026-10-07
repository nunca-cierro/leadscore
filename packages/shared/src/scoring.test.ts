// Tests de evaluateScore() — tarea 2.7 (WU2 · change prospeccion).
// Aceptación: configurable-scoring:evaluate-5-de-8, :threshold-deshabilitado,
//   :manual-sin-dato, :criterio-inverso — nivel unidad, puro, sin I/O (design §6).

import { describe, expect, it } from "vitest";
import { evaluateScore, type ScoreCriterion } from "./scoring";

// Preset de 8 criterios (design §1.5 / SPEC §9): weight=1, enabled=true, position 0–7
const preset: ScoreCriterion[] = [
  { key: "multi_site", polarity: "positive", weight: 1, threshold: 2, mode: "manual", enabled: true },
  { key: "rating_45", polarity: "positive", weight: 1, threshold: 4.5, mode: "manual", enabled: true },
  { key: "ig_followers_500", polarity: "positive", weight: 1, threshold: 500, mode: "manual", enabled: true },
  { key: "ig_posting", polarity: "positive", weight: 1, threshold: null, mode: "manual", enabled: true },
  { key: "no_website", polarity: "inverse", weight: 1, threshold: null, mode: "auto", enabled: true },
  { key: "no_wa_reply", polarity: "inverse", weight: 1, threshold: null, mode: "manual", enabled: true },
  { key: "has_catalog", polarity: "positive", weight: 1, threshold: null, mode: "manual", enabled: true },
  { key: "has_team", polarity: "positive", weight: 1, threshold: null, mode: "manual", enabled: true },
];

describe("evaluateScore — preset de 8 (configurable-scoring)", () => {
  it("evaluate-5-de-8: 5 cumplidos → value=5, max=8 y desglose por criterio", () => {
    const r = evaluateScore(preset, {
      multi_site: 3, // 3 sedes ≥ 2 → cumple
      rating_45: 4.7, // 4.7 ≥ 4.5 → cumple
      ig_followers_500: 800, // 800 ≥ 500 → cumple
      ig_posting: true, // señal booleana → cumple
      no_website: false, // inverso: NO tiene web → cumple
      // no_wa_reply sin dato → pendiente, cuenta en max
      has_catalog: false,
      has_team: false,
    });
    expect(r.value).toBe(5);
    expect(r.max).toBe(8);
    expect(r.breakdown).toHaveLength(8);
    expect(r.breakdown.map((c) => c.key)).toEqual(preset.map((c) => c.key));
    expect(r.breakdown.find((c) => c.key === "no_wa_reply")).toEqual({
      key: "no_wa_reply",
      met: false,
      pending: true,
      weight: 1,
    });
  });

  it("threshold-deshabilitado: 4.3 vs 4.5 NO cumple; enabled=false lo excluye del max", () => {
    const signals = {
      multi_site: 3,
      rating_45: 4.3, // umbral no alcanzado → el score baja a 4
      ig_followers_500: 800,
      ig_posting: true,
      no_website: false,
      has_catalog: false,
      has_team: false,
    };
    const r = evaluateScore(preset, signals);
    expect(r.value).toBe(4);
    expect(r.max).toBe(8);
    expect(r.breakdown.find((c) => c.key === "rating_45")).toEqual({
      key: "rating_45",
      met: false,
      pending: false,
      weight: 1,
    });

    const withoutRating = preset.map((c) =>
      c.key === "rating_45" ? { ...c, enabled: false } : c,
    );
    const r2 = evaluateScore(withoutRating, signals);
    expect(r2.max).toBe(7); // fuera del max
    expect(r2.value).toBe(4);
    expect(r2.breakdown).toHaveLength(7);
  });

  it("manual-sin-dato: sin señales → met:false + pending:true en los 8 y siguen en max", () => {
    const r = evaluateScore(preset, {});
    expect(r.value).toBe(0);
    expect(r.max).toBe(8);
    expect(r.breakdown).toHaveLength(8);
    expect(r.breakdown.every((c) => !c.met && c.pending)).toBe(true);
  });

  it("criterio-inverso: no_website puntúa SOLO cuando la señal NO cumple", () => {
    const withWebsite = evaluateScore(preset, { no_website: true });
    expect(withWebsite.value).toBe(0);
    expect(withWebsite.breakdown.find((c) => c.key === "no_website")).toEqual({
      key: "no_website",
      met: false,
      pending: false,
      weight: 1,
    });

    const withoutWebsite = evaluateScore(preset, { no_website: false });
    expect(withoutWebsite.value).toBe(1);
    expect(withoutWebsite.breakdown.find((c) => c.key === "no_website")?.met).toBe(true);
  });

  it("value y max suman weight, no criterios: un criterio con weight=3 cuenta triple", () => {
    const weighted = preset.map((c) =>
      c.key === "has_team" ? { ...c, weight: 3 } : c,
    );
    const r = evaluateScore(weighted, { has_team: true });
    expect(r.value).toBe(3);
    expect(r.max).toBe(10); // 7×1 + 3
  });
});
