// Test de aislamiento RLS — tarea 2.1 (WU1 · change prospeccion).
// Aceptación: session-auth:rls-sin-tenant, session-auth:tenant-ajeno,
//   demo-and-classify:publica-tenant-null-0, demo-and-classify:demo-solo-tenant-demo.
// Español prosa / identificadores en inglés.
//
// Precondiciones (una vez por máquina) — design §6: "dbmate up sobre la DB de test":
//   1. psql -c "CREATE DATABASE leadscore_test"
//   2. $env:DATABASE_URL = '<url con /leadscore_test>'; npx dbmate up
// El test deriva la URL de test de DATABASE_URL (respeta TEST_DATABASE_URL si existe)
// y la inyecta en process.env ANTES de importar el pool de la app.
//
// Nota binding (desviación documentada): PostgreSQL bypasea RLS SIEMPRE para un
// superuser real; FORCE sólo sujeta al dueño NO superuser (design §1.4: "el rol de la
// app MUST NO ser superuser"). Los queries de aislamiento corren bajo SET ROLE
// leadscore_app — rol NOLOGIN, dueño de las 9 tablas en la DB de test — de modo que
// FORCE queda ejercitado de verdad. El "aunque la conexión sea de superuser" del GWT
// se cumple en su intención: ni el rol de mayor privilegio de la app escapa al
// default-deny (vanilla PG no permite menos).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROLE = "leadscore_app";
const DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";

const TABLES = [
  "tenants",
  "users",
  "sessions",
  "score_criteria",
  "businesses",
  "analysis_checks",
  "score_evaluations",
  "outreach",
  "outcomes",
] as const;

// fixtures idempotentes (insertados como superuser en beforeAll): 1 usuario por
// tenant (design §6) + 1 sesión por usuario + 1 check — sostienen los tests negativos
// de users/sessions/analysis_checks (semillas §1.5 no incluyen esas tablas).
const FIXTURE = {
  demoUser: "00000000-0000-4000-8000-00000000f001",
  nzcUser: "00000000-0000-4000-8000-00000000f002",
  demoSession: "00000000-0000-4000-8000-00000000f003",
  nzcSession: "00000000-0000-4000-8000-00000000f004",
  demoCheck: "00000000-0000-4000-8000-00000000f005",
};

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(resolve(repoRoot, ".env"));
  } catch {
    // sin .env: se exige DATABASE_URL (o TEST_DATABASE_URL) en el entorno
  }
}
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  throw new Error("Falta DATABASE_URL (.env en la raíz o variable de entorno)");
}
function toTestUrl(url: string): string {
  const u = new URL(url);
  u.pathname = "/leadscore_test";
  return u.toString();
}
const testUrl = process.env.TEST_DATABASE_URL ?? toTestUrl(devUrl);
function redact(url: string): string {
  return url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");
}
// el pool de la app debe apuntar a la DB de test antes de importarlo
process.env.DATABASE_URL = testUrl;

const { pool } = await import("./pool.js");
const { withTenant } = await import("./withTenant.js");

let db: Client; // conexión de test (superuser) — arreglos y verdad de una sola vez
const nzcTenantId = { current: "" };
const truth = new Map<string, Map<string, number>>(); // tabla → (tenant → filas)

async function countsUnder(tenantId: string): Promise<Record<string, number>> {
  return await withTenant(tenantId, async (c) => {
    // el pool de test conecta como superuser (bypass); el rol de la app NO superuser
    // es quien debe quedar sujeto a RLS FORCE — ver nota al inicio del archivo.
    await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
    const out: Record<string, number> = {};
    for (const table of TABLES) {
      const r = await c.query(`SELECT count(*)::int AS n FROM ${table}`);
      out[table] = Number(r.rows[0]?.n ?? 0);
    }
    return out;
  });
}

beforeAll(async () => {
  db = new Client({ connectionString: testUrl });
  await db.connect();

  const regclass = await db.query<{ t: string | null }>(
    "SELECT to_regclass('public.businesses') AS t",
  );
  if (!regclass.rows[0]?.t) {
    throw new Error(
      `Sin esquema en ${redact(testUrl)} — crea la DB de test y migra: ` +
        `CREATE DATABASE leadscore_test; DATABASE_URL=<url test> npx dbmate up`,
    );
  }

  // rol de aplicación NO superuser y DUEÑO de las tablas: FORCE (design §1.4) es lo
  // único que lo sujeta a RLS — sin FORCE un dueño bypasearía.
  await db.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
      CREATE ROLE ${APP_ROLE} NOLOGIN;
    END IF;
  END $$;`);
  for (const table of TABLES) {
    await db.query(`ALTER TABLE ${table} OWNER TO ${APP_ROLE}`);
  }

  // fixtures idempotentes (fijos por id; ON CONFLICT los vuelve repetibles)
  await db.query(
    `INSERT INTO users (id, tenant_id, email, password_hash) VALUES
       ($1, (SELECT id FROM tenants WHERE slug = 'demo'), 'rls-fixture-demo@leadscore.test', 'argon2id-fixture'),
       ($2, (SELECT id FROM tenants WHERE slug = 'nuncacierro'), 'rls-fixture-nuncacierro@leadscore.test', 'argon2id-fixture')
     ON CONFLICT DO NOTHING`,
    [FIXTURE.demoUser, FIXTURE.nzcUser],
  );
  await db.query(
    `INSERT INTO sessions (id, tenant_id, user_id, token_hash, expires_at) VALUES
       ($1, (SELECT id FROM tenants WHERE slug = 'demo'), $3, 'fixture-token-hash-demo', now() + interval '30 days'),
       ($2, (SELECT id FROM tenants WHERE slug = 'nuncacierro'), $4, 'fixture-token-hash-nzc', now() + interval '30 days')
     ON CONFLICT DO NOTHING`,
    [FIXTURE.demoSession, FIXTURE.nzcSession, FIXTURE.demoUser, FIXTURE.nzcUser],
  );
  await db.query(
    `INSERT INTO analysis_checks (id, tenant_id, business_id, check_type, result)
     SELECT $1, b.tenant_id, b.id, 'http_site', '{"ok": false}'::jsonb
     FROM businesses b JOIN tenants t ON t.id = b.tenant_id
     WHERE t.slug = 'demo'
     ON CONFLICT DO NOTHING`,
    [FIXTURE.demoCheck],
  );

  // verdad superuser: filas reales por tenant en cada tabla (el 0 del test de
  // aislamiento viene de RLS, no de tablas vacías)
  const nzc = await db.query<{ id: string }>(
    "SELECT id FROM tenants WHERE slug = 'nuncacierro'",
  );
  nzcTenantId.current = nzc.rows[0]?.id ?? "";
  expect(nzcTenantId.current, "semilla §1.5: tenant nuncacierro").not.toBe("");

  for (const table of TABLES) {
    const groupCol = table === "tenants" ? "id" : "tenant_id";
    const r = await db.query<{ tid: string; n: number }>(
      `SELECT ${groupCol} AS tid, count(*)::int AS n FROM ${table} GROUP BY ${groupCol}`,
    );
    truth.set(
      table,
      new Map(r.rows.map((row) => [String(row.tid), Number(row.n)])),
    );
  }
  // seeds §1.5: demo tiene datos; nuncacierro queda sin dataset (0 en tablas de dominio)
  expect(truth.get("businesses")?.get(DEMO_TENANT_ID)).toBe(12);
  expect(truth.get("score_criteria")?.get(DEMO_TENANT_ID)).toBe(8);
  expect(truth.get("outcomes")?.get(DEMO_TENANT_ID)).toBe(5);
  expect(truth.get("users")?.get(nzcTenantId.current)).toBe(1);
});

afterAll(async () => {
  await db.end();
  await pool.end();
});

describe("rls — sin tenant → 0 filas en las 9 tablas (rls-sin-tenant · publica-tenant-null-0)", () => {
  it("rls: sin SET LOCAL app.current_tenant, cada tabla devuelve 0 filas", async () => {
    await db.query(`SET ROLE ${APP_ROLE}`);
    try {
      for (const table of TABLES) {
        const r = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${table}`,
        );
        expect(r.rows[0]?.n, `sin tenant, ${table} debe ser 0`).toBe(0);
      }
    } finally {
      await db.query("RESET ROLE");
    }
  });

  it("rls: como superuser las 9 tablas tienen filas — el 0 viene de RLS", async () => {
    for (const table of TABLES) {
      const r = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table}`,
      );
      expect(
        r.rows[0]?.n,
        `${table} sin seeds/fixtures: el 0 sería vacío, no aislamiento`,
      ).toBeGreaterThan(0);
    }
  });

  it("rls: las 9 tablas tienen ENABLE + FORCE ROW LEVEL SECURITY", async () => {
    const present = await db.query<{ relname: string }>(
      `SELECT relname FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
         AND relname = ANY($1)`,
      [[...TABLES]],
    );
    expect(present.rows).toHaveLength(9);

    const unforced = await db.query<{ relname: string }>(
      `SELECT relname FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
         AND relname = ANY($1) AND NOT (relrowsecurity AND relforcerowsecurity)`,
      [[...TABLES]],
    );
    expect(unforced.rows, "FORCE obliga incluso al dueño (§1.4)").toEqual([]);
  });
});

describe("rls — withTenant(A) no ve filas de B (tenant-ajeno · demo-solo-tenant-demo)", () => {
  it("rls: withTenant(demo) ve exactamente las filas de demo en las 9 tablas", async () => {
    const seen = await countsUnder(DEMO_TENANT_ID);
    for (const table of TABLES) {
      const expected = truth.get(table)?.get(DEMO_TENANT_ID) ?? 0;
      expect(seen[table], `demo en ${table}`).toBe(expected);
    }
    // el demo tiene dataset real (semillas §1.5) — su visibilidad no es trivial
    expect(seen.businesses).toBe(12);
    expect(seen.score_criteria).toBe(8);
    expect(seen.users).toBe(1);
  });

  it("rls: withTenant(nuncacierro) no ve ninguna fila de demo", async () => {
    const seen = await countsUnder(nzcTenantId.current);
    for (const table of TABLES) {
      const expected = truth.get(table)?.get(nzcTenantId.current) ?? 0;
      expect(seen[table], `nuncacierro en ${table}`).toBe(expected);
    }
    // nuncacierro no tiene negocios sembrados: ve 0 mientras demo ve 12 (B oculta)
    expect(seen.businesses).toBe(0);
    expect(truth.get("businesses")?.get(DEMO_TENANT_ID)).toBe(12);
    expect(seen.outreach).toBe(0);
    expect(seen.outcomes).toBe(0);
    expect(seen.analysis_checks).toBe(0);
  });

  it("rls: el pool no queda contaminado — SET LOCAL muere con la transacción", async () => {
    const r = await pool.query<{ u: string }>("SELECT current_user AS u");
    expect(r.rows[0]?.u).toBe("postgres");
  });
});
