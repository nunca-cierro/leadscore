import type { PoolClient } from "pg";
import { uuidSchema } from "@leadscore/shared";
import { pool } from "./pool.js";

// withTenant(tenantId, fn) — design §1.4: dueño único de datos.
// BEGIN → SELECT set_config('app.current_tenant', $1, true) → fn(c)
//   → COMMIT/ROLLBACK → release().
// SET LOCAL (is_local=true) muere con la transacción → nunca contamina el
// pool; sin transacción no hay datos.
// Nota: `SET LOCAL p = $1` no es SQL válido (SET no admite bind parameters);
// set_config con is_local=true es el equivalente exacto de SET LOCAL.
// uuid validado con zod desde packages/shared (fuente única web ↔ api).
export async function withTenant<T>(
  tenantId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const tid = uuidSchema.parse(tenantId); // 400 zod antes de tocar la DB (§1.4)
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_tenant', $1, true)", [tid]);
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
