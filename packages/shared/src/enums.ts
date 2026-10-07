// Enums compartidos — fuente única web ↔ api (design §4).
// Valores idénticos a los CHECK de db/migrations/0001_init.sql (design §1.2).

export const STATUSES = ["new", "contacted", "client", "discarded"] as const;
export const SOURCE_CHANNELS = [
  "referral",
  "partner",
  "maps-csv",
  "inbound",
  "ads",
] as const;
export const POLARITIES = ["positive", "inverse"] as const;
export const MODES = ["manual", "auto"] as const;

export type Status = (typeof STATUSES)[number];
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];
export type Polarity = (typeof POLARITIES)[number];
export type Mode = (typeof MODES)[number];
