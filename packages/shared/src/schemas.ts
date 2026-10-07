// Schemas zod — validación en cada frontera, fuente única de tipos web ↔ api
// (design §2, §4; SPEC §7). Paquete SIN I/O: sólo contratos.
// Importaciones relativas con extensión `.js` (estilo NodeNext) para que
// apps/api pueda incluir este paquete en su programa TypeScript.
import { z } from "zod";
import { MODES, POLARITIES, SOURCE_CHANNELS, STATUSES } from "./enums.js";

// uuid — design §1.4: withTenant valida el tenantId con zod antes de tocar la DB
export const uuidSchema = z.uuid();

// Enum schemas (values en enums.ts). AC: business-intake:source-channel-invalido
// y prioritized-queue:estado-fuera-enum → 400 zod en la frontera
export const statusSchema = z.enum(STATUSES);
export const sourceChannelSchema = z.enum(SOURCE_CHANNELS);
export const polaritySchema = z.enum(POLARITIES);
export const modeSchema = z.enum(MODES);

// session-auth (§2.1): email lowercased en la frontera
export const loginSchema = z.object({
  email: z.email().transform((v) => v.toLowerCase()),
  password: z.string().min(1),
});

// business-intake (§2.2): el servidor nace con status='new' (no viene del caller)
export const businessCreateSchema = z.object({
  name: z.string().min(1),
  source_channel: sourceChannelSchema,
  vertical: z.string().nullish(),
  city: z.string().nullish(),
  whatsapp: z.string().nullish(),
  instagram_url: z.string().nullish(),
  email: z.string().nullish(),
  external_id: z.string().nullish(),
  next_action: z.string().nullish(),
  notes: z.string().nullish(),
});

// prioritized-queue (§2.2): PATCH parcial — status valida contra el enum ANTES
// que la matriz de transiciones del trigger (400 zod → luego 409)
export const businessPatchSchema = z.object({
  status: statusSchema.optional(),
  vertical: z.string().nullish(),
  city: z.string().nullish(),
  whatsapp: z.string().nullish(),
  instagram_url: z.string().nullish(),
  email: z.string().nullish(),
  next_action: z.string().nullish(),
  notes: z.string().nullish(),
});

// configurable-scoring (§2.4): weight>0 y position>=0 replican los CHECK de la DB
export const scoreCriterionCreateSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  polarity: polaritySchema,
  weight: z.number().int().positive(),
  threshold: z.number().nullable().optional(),
  mode: modeSchema,
  enabled: z.boolean().optional(),
  position: z.number().int().nonnegative().optional(),
});
export const scoreCriterionPatchSchema = scoreCriterionCreateSchema.partial();

// outreach-outcomes (§2.6)
export const outcomeCreateSchema = z.object({
  result: z.enum(["client", "no_client"]),
  notes: z.string().nullish(),
});

// demo-and-classify (§2.8): body {business?, signals} — strictObject rechaza
// claves desconocidas del body (400); las claves dentro de `signals` se
// contrastan contra los criterios del tenant en la ruta (WU12), no aquí.
export const classifySchema = z.strictObject({
  business: z
    .strictObject({
      name: z.string().optional(),
      vertical: z.string().optional(),
      city: z.string().optional(),
      whatsapp: z.string().optional(),
      instagram_url: z.string().optional(),
    })
    .optional(),
  signals: z.record(z.string(), z.union([z.boolean(), z.number()])),
});

// Tipos derivados — una sola fuente para web y api
export type Uuid = z.infer<typeof uuidSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type BusinessCreateInput = z.infer<typeof businessCreateSchema>;
export type BusinessPatchInput = z.infer<typeof businessPatchSchema>;
export type ScoreCriterionCreateInput = z.infer<typeof scoreCriterionCreateSchema>;
export type ScoreCriterionPatchInput = z.infer<typeof scoreCriterionPatchSchema>;
export type OutcomeCreateInput = z.infer<typeof outcomeCreateSchema>;
export type ClassifyInput = z.infer<typeof classifySchema>;
