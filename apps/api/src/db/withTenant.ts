import type { PoolClient } from "pg";
import { pool } from "./pool.js";

// withTenant(tenantId, fn) — design §1.4: dueño único de datos.
// BEGIN → SET LOCAL app.current_tenant → fn(c) → COMMIT/ROLLBACK → release().
// SET LOCAL muere con la transacción → nunca contamina el pool;
// sin transacción no hay datos.
//
// Desviaciones mínimas respecto al pseudocódigo del design (soporte de 2.1;
// la versión completa con zod uuid de packages/shared llega en 2.5/WU2):
//   1. `SET LOCAL p = $1` no es SQL válido (SET no admite bind parameters) →
//      se usa `SELECT set_config(p, $1, true)`, equivalente exacto de SET LOCAL.
//   2. `uuid.parse` (zod) → regex uuid aquí para no arrastrar zod a apps/api
//      antes de que packages/shared exponga los schemas (tarea 2.6/WU2).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(
  tenantId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new TypeError(`tenantId no es un uuid: ${tenantId}`);
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantId,
    ]);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
