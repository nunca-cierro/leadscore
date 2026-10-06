# Design: Prospección

> Español prosa / identificadores en inglés. RFC2119.

## 0. Índice

1. §1 Esquema Postgres — migraciones, tablas, bootstrap de sesión, triggers/RLS, métricas, seeds, diagrama · 2. §2 Contratos de API — 22 endpoints, auth, errores, allowlist pública.
3. §3 Seguridad transversal (CSRF) · 4. §4 Estructura del monorepo · 5. §5 Infraestructura (Docker/Caddy/GH Actions) · 6. §6 Estrategia de testing · 7. §7 Open questions.

## 1. Esquema Postgres

9 tablas (SPEC §4) — ninguna tabla nueva: `classify` y `reportes` son consultas derivadas (§1.5–§1.6). FKs hijo→padre con `ON DELETE CASCADE`; toda tabla de dominio lleva `tenant_id uuid NOT NULL`. Expresión RLS canónica (abreviada `T` en las tablas):

```sql
tenant_id = current_setting('app.current_tenant', true)::uuid   -- NULL → 0 filas (default-deny)
```

### 1.1 Decisión de migraciones: dbmate (elegido) vs psql

| Criterio | `dbmate` | `psql -f` vanilla |
|---|---|---|
| Orden y tracking | `schema_migrations` + archivos `NNNN_*.sql`; `dbmate up` es idempotente | sin registro; re-ejecutar es a ciegas |
| Rollback | `dbmate rollback` ejecuta el bloque `-- down` por migración | inexistente |
| Simplicidad | SQL plano, binario único, sin ORM (cumple D13; no está en la lista forbidden) | plano, pero manual |

**Veredicto: `dbmate`**, con migraciones en `db/migrations/` (dir default de dbmate; el archivo ya existe) y `DATABASE_URL` de SPEC §11. Evidencia: research del cambio + `openspec/config.yaml` (context: *"migraciones SQL versionadas en `db/migrations` con dbmate — SPEC §4 aún define rewrite in-place; reconciliar en U2"*). Rewrite in-place es riesgo directo en prod: pisar la migración única no tiene rollback.
**Enmienda follow-up (NO en este run — SPEC.md intacto):** SPEC §4 *"Migración única … rewrite in-place"* → *"migraciones versionadas vía dbmate (`dbmate new` / `up` / `rollback`); `0001_init.sql` es la primera"*.
⚠ `db/migrations/0001_init.sql` actual contiene el esquema V1 **prohibido** (tabla `leads`, 8 booleanos por fila, `score` GENERATED, sin RLS): se REEMPLAZA íntegro en U2.

### 1.2 Tablas — grupo A (identidad + criterios)

| Tabla | Columnas clave (tipo) | PK / FK / UNIQUE / CHECK | Índices | Política RLS (granularidad) |
|---|---|---|---|---|
| `tenants` | `id uuid PK DEFAULT gen_random_uuid()`, `slug text NOT NULL`, `name text NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()` | PK `id`; **UNIQUE `slug`** (reservado: `demo`) | UNIQUE `(slug)` | **global con cláusula id-propia**: `id = current_setting('app.current_tenant', true)::uuid` — sin tenant seteado → 0 filas |
| `users` | `id uuid PK`, `tenant_id uuid NOT NULL → tenants`, `email text NOT NULL`, `password_hash text NOT NULL` (argon2id), `created_at timestamptz NOT NULL DEFAULT now()` | PK `id`; FK `tenant_id`; **UNIQUE `email` global** (login llega sin contexto de tenant; MVP con una sola cuenta) | UNIQUE `(email)`, `(tenant_id)` | tenant-scoped `T` **+ cláusula bootstrap** `app.auth_email` (única excepción, §1.3) |
| `sessions` | `id uuid PK`, `tenant_id uuid NOT NULL → tenants`, `user_id uuid NOT NULL → users ON DELETE CASCADE`, `token_hash text NOT NULL` (sha256 hex del cookie completo), `expires_at timestamptz NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()` | PK `id`; FK `tenant_id`, `user_id`; **UNIQUE `token_hash`** | UNIQUE `(token_hash)`, `(expires_at)` limpieza, `(user_id)` | tenant-scoped `T` **puro** — el guard setea el tenant desde el cookie firmado ANTES de leer (§1.3) |
| `score_criteria` | `id uuid PK`, `tenant_id uuid NOT NULL → tenants`, `key text NOT NULL`, `label text NOT NULL`, `polarity text NOT NULL` (`positive\|inverse`), `weight int NOT NULL`, `threshold numeric(10,3) NULL`, `mode text NOT NULL` (`manual\|auto`), `enabled boolean NOT NULL DEFAULT true`, `position int NOT NULL DEFAULT 0`, `created_at`, `updated_at` | PK `id`; FK `tenant_id`; **UNIQUE `(tenant_id, key)`**; CHECK `polarity IN ('positive','inverse')`, `mode IN ('manual','auto')`, `weight > 0`, `position >= 0` | UNIQUE `(tenant_id, key)`, `(tenant_id, enabled, position)` | tenant-scoped `T` — **NO global**: `/demo` alterna sus criterios sin tocar los del CRM (aislamiento D16) |

### 1.2 Tablas — grupo B (entidades de las 8 capacidades)

| Tabla | Columnas clave (tipo) | PK / FK / UNIQUE / CHECK | Índices | Política RLS (granularidad) |
|---|---|---|---|---|
| `businesses` (intake + cola) | `id uuid PK`, `tenant_id uuid NOT NULL → tenants`, `external_id text NULL`, `name text NOT NULL`, `vertical text NULL`, `city text NULL`, `whatsapp text NULL`, `instagram_url text NULL`, `email text NULL`, `status text NOT NULL DEFAULT 'new'`, `source_channel text NOT NULL`, `next_action text NULL`, `notes text NULL`, `created_at`, `updated_at` | PK `id`; FK `tenant_id`; **UNIQUE `(tenant_id, external_id)`** (NULLs repetidos libres → intake manual sin external_id); CHECK `status IN ('new','contacted','client','discarded')`, `source_channel IN ('referral','partner','maps-csv','inbound','ads')` | UNIQUE `(tenant_id, external_id)`, `(tenant_id, status)`, `(tenant_id, vertical)`, `(tenant_id, city)`, `(tenant_id, source_channel)` | tenant-scoped `T` — 404 = 0 filas (tenant ajeno o id inexistente, indistinguibles por diseño) |
| `analysis_checks` (presencia) | `id uuid PK`, `tenant_id uuid NOT NULL → tenants`, `business_id uuid NOT NULL → businesses`, `check_type text NOT NULL` (`http_site\|wa_me\|facebook`), `result jsonb NOT NULL`, `checked_at timestamptz NOT NULL DEFAULT now()` | PK `id`; FK `tenant_id`, `business_id`; CHECK `check_type IN ('http_site','wa_me','facebook')`, `jsonb_typeof(result->'ok') = 'boolean'`; **sin UNIQUE** (historial append, nunca sobrescribe) | `(tenant_id, business_id, checked_at DESC)` | tenant-scoped `T` |
| `score_evaluations` (scoring) | `id uuid PK`, `tenant_id uuid NOT NULL → tenants`, `business_id uuid NOT NULL → businesses`, `source text NOT NULL` (`rules\|ml\|hybrid`), `value int NOT NULL`, `max int NOT NULL`, `criteria jsonb NOT NULL` (`[{key,met,pending,weight}]`), `created_at timestamptz NOT NULL DEFAULT now()` | PK `id`; FK `tenant_id`, `business_id`; CHECK `source IN ('rules','ml','hybrid')`, `value >= 0`, `max >= 0`, `value <= max`; append-only (nunca UPDATE) | `(tenant_id, business_id, source, created_at DESC)` — alimenta la cola: último `value` con `source='rules'` | tenant-scoped `T` |
| `outreach` (saludo frío manual) | `id uuid PK`, `tenant_id uuid NOT NULL → tenants`, `business_id uuid NOT NULL → businesses`, `channel text NOT NULL` (`whatsapp\|instagram\|email\|other`), `draft text NULL`, `sent_at timestamptz NULL` (`NULL` = solo borrador; NOT NULL = primer contacto registrado), `created_at timestamptz NOT NULL DEFAULT now()` | PK `id`; FK `tenant_id`, `business_id`; CHECK `channel IN ('whatsapp','instagram','email','other')` | `(tenant_id, business_id, sent_at)` | tenant-scoped `T` |
| `outcomes` (cierre) | `id uuid PK`, `tenant_id uuid NOT NULL → tenants`, `business_id uuid NOT NULL → businesses`, `result text NOT NULL` (`client\|no_client`), `notes text NULL`, `created_at timestamptz NOT NULL DEFAULT now()` | PK `id`; FK `tenant_id`, `business_id`; CHECK `result IN ('client','no_client')`; **UNIQUE `(tenant_id, business_id)` → garantiza el 409** ("un cierre nunca se pisa", a nivel DB) | UNIQUE `(tenant_id, business_id)`, `(tenant_id, created_at)`, `(tenant_id, result)` | tenant-scoped `T` |

### 1.2.1 Mapeo CSV (24 columnas) → columnas (U4, business-intake)

| # Columnas CSV | Destino |
|---|---|
| `Id` (1) | `businesses.external_id` (UNIQUE por tenant → fila duplicada = error de fila, sin abortar el lote) |
| `Nombre` (2) | `businesses.name` NOT NULL; `Vertical` (3), `Ciudad` (4) → `vertical`, `city` |
| `Score` (5) | **NO importa** — se recalcula con el preset → INSERT en `score_evaluations` (`source='rules'`) |
| `WhatsApp`/`Instagram`/`Correo` (6–8) | `whatsapp` (normalizar `wa.me/<n>`), `instagram_url`, `email` |
| `Estado` (9) | `status` (mapear variante → enum `new/contacted/client/discarded`) |
| `Fecha de contacto` (10) | INSERT en `outreach` con `sent_at` (canal inferido: whatsapp → instagram → email → `other`) |
| `Próxima acción` (11), `Notes` (20) | `next_action`, `notes` |
| `>2 sedes`…`Team` (12–19) | desglose de `score_evaluations.criteria`: `TRUE/FALSE = met` para `multi_site`, `rating_45`, `ig_followers_500`, `ig_posting`, `no_website`, `no_wa_reply`, `has_catalog`, `has_team` |
| vacía (21), `Campo`/`Propósito y Formato`/`Comportamiento` (22–24) | descartadas sin error |

### 1.3 Bootstrap de sesión y login (cómo RLS convive con auth)

El huevo-y-gallina de RLS: `sessions` y `users` exigen un tenant que aún no existe. Se resuelve SIN tocar la granularidad del dominio:

- **Cookie** `__Host-ls_session` = `base64url(payload) "." hmac-sha256(payload, SESSION_SECRET)`; `payload = {sid, uid, tid, exp}` (SPEC §5: *"token firmado"*; `SESSION_SECRET` = *"secreto de firma de cookie"*). `sessions.token_hash` = sha256 hex del **cookie completo recibido**.
- **Guard CRM (antes de cualquier query):** 1) verificar HMAC en memoria (sin DB) → payload; 2) `BEGIN`; 3) `SET LOCAL app.current_tenant = payload.tid`; 4) `SELECT … FROM sessions WHERE token_hash = sha256(cookie) AND user_id = payload.uid AND expires_at > now()` — RLS `T` la deja ver porque el tenant ya coincide; 5) 0 filas → 401 (firma inválida, revocada o expirada). Firma inválida → 401 sin tocar DB.
- **Login (`POST /api/auth/login`):** `BEGIN` → `SET LOCAL app.auth_email = email` (zod: lowercased) → `SELECT id, tenant_id, password_hash FROM users WHERE email = …` vía la **única cláusula escape** de todo el esquema:

```sql
-- users: USING (tenant_id = T OR (current_setting('app.current_tenant', true) IS NULL
--                                AND current_setting('app.auth_email', true) = email))
```

  El escape sólo opera con tenant NULL (pre-auth) y sólo expone la fila del email reclamado; verificar argon2id sigue siendo requisito. Luego `SET LOCAL app.current_tenant = user.tenant_id` → INSERT de `sessions` → cookie. Búsqueda: `grep app.auth_email` ⇒ 1 uso.
- **Rutas públicas:** `/api/demo/*` y `/api/classify` llaman `withTenant(DEMO_TENANT_ID)` (env de SPEC §11) — jamás sin tenant; si un bug omite el SET, RLS devuelve 0 filas. `/health` no toca la DB.
- **Alternativas rechazadas:** rol `BYPASSRLS` dedicado (2 pools + rol de infra, más moving parts para el MVP); `users` sin RLS (deja la tabla más sensible sin defensa); tenant fijo por env en login (rompe multi-tenant futuro, exige env var nueva).

### 1.4 Triggers, RLS FORCE y `withTenant()`

**Triggers (único archivo de migración):**

| Trigger | Tabla | Comportamiento |
|---|---|---|
| `trg_…_updated_at` → `set_updated_at()` | `businesses`, `score_criteria` | `BEFORE UPDATE`: `NEW.updated_at = now()` |
| `trg_businesses_status_transition` → `enforce_status_transition()` | `businesses` | `BEFORE UPDATE` sólo: aplica la matriz de transiciones ↓; `RAISE` en violación → app responde **409**. `INSERT` (import CSV) no se afecta |
| contador de resultados | — | **NO aplica**: `contacted`/`closed`/`rate` son consultas derivadas (§1.5), nunca columnas contadas a mano |
| auditoría | — | **NO aplica**: ninguno de los 8 deltas pide historial de auditoría |

Matriz de transiciones (decisión §7: descarte directo `new → discarded` habilitado; `client` exige pasar por `contacted`):

| De \ a | `contacted` | `client` | `discarded` |
|---|---|---|---|
| `new` | ✅ | ❌ 409 | ✅ |
| `contacted` | — | ✅ | ✅ |
| `client` / `discarded` | ❌ terminal | ❌ terminal → 409 | ❌ terminal → 409 |

**RLS FORCE por tabla:** `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` en las 9 tablas; una policy `p_<tabla>_tenant` con `USING` **y** `WITH CHECK` = expresión `T` (grupo A/B: la columna "Política RLS"). Para `tenants`, la cláusula es `id = T`. Para `users`, `T OR (escape §1.3)`. **Orden dentro de `0001_init.sql`:** `CREATE TABLE` → `CREATE POLICY` → `INSERT` de seeds (el owner aún NO está sujeto: FORCE va al final) → `ALTER TABLE … FORCE` (últimas sentencias del archivo). `FORCE` incluye al owner ⇒ el rol de la app MUST NO ser superuser (infra, §5).

**`withTenant(tenantId, fn)` (dueño único de datos, `apps/api/src/db/`):**

```ts
const c = await pool.connect();
try {
  await c.query('BEGIN');
  await c.query(`SET LOCAL app.current_tenant = $1`, [uuid.parse(tenantId)]); // zod valida uuid
  const r = await fn(c);          // TODAS las queries de la request pasan por aquí
  await c.query('COMMIT'); return r;
} catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
// SET LOCAL muere con la transacción → nunca contamina el pool; sin transacción no hay datos.
```

**Mapeo HTTP → capa (para U2):** `401` = guard/cookie (sin DB) · `400` = zod antes de tocar DB · `404` = 0 filas bajo RLS · `409` = `UNIQUE (tenant_id, business_id)` de `outcomes` o trigger de transición · `422` = validador de oferta en app sobre `draft` (no se persiste; sin constraint DB) · `429` = rate limit fijo en memoria (sin tabla).

### 1.5 Seeds

Orden: seeds en SQL **ANTES** de `ALTER … FORCE` (§1.4, el owner aún no está sujeto a RLS) salvo el usuario, cuyo hash argon2id no puede calcularse en SQL plano.

| Qué | Dónde se inserta | Detalle |
|---|---|---|
| Tenants (2 filas) | migración SQL | `demo` (slug `demo` reservado §1.2; **id literal fijo** = `DEMO_TENANT_ID` de `.env.example` — misma constante en migración y env, evita UUID aleatorio irreproducible) y `nuncacierro` (CRM real, SPEC §5) |
| Usuario admin | seed de arranque de `apps/api` (U3), idempotente | 0 filas para `SEED_USER_EMAIL` (por `UNIQUE email`) → INSERT `password_hash` = argon2id(`SEED_USER_PASSWORD`) dentro de `withTenant(nuncacierro)` (policy `users` se satisface vía `T`; no necesita el escape §1.3). Una sola cuenta activa en el MVP |
| Preset de 8 criterios | migración SQL | **16 filas = 8 × 2 tenants** — `demo` y CRM obtienen copias independientes (aislamiento D16: `/demo` altera las suyas sin tocar el CRM, §1.2). `weight=1`, `enabled=true`, `position` 0–7, `threshold NULL` donde el preset no define umbral |
| Dataset sintético del demo | migración SQL (tenant `demo` EXCLUSIVAMENTE) | ~12 `businesses` (variados en `vertical`/`city`/`status`/`source_channel`), 1–2 `score_evaluations` `rules` por negocio (la última alimenta la cola), ~8 `outreach` y ~5 `outcomes` (`client`/`no_client`) para que el contador del `/demo` muestre `contactados · cerrados · tasa` ≠ 0. Cero filas en `nuncacierro` (datos reales llegan por alta manual/CSV) |

**Preset exacto (SPEC §9):**

| # | `key` | `label` | `polarity` | `weight` | `threshold` | `mode` | `position` |
|---|---|---|---|---|---|---|---|
| 1 | `multi_site` | Más de 2 sedes | `positive` | 1 | 2 | `manual` | 0 |
| 2 | `rating_45` | Rating > 4.5 | `positive` | 1 | 4.5 | `manual` | 1 |
| 3 | `ig_followers_500` | +500 followers IG | `positive` | 1 | 500 | `manual` | 2 |
| 4 | `ig_posting` | Posteo constante | `positive` | 1 | NULL | `manual` | 3 |
| 5 | `no_website` | Sin sitio web | **`inverse`** | 1 | NULL | **`auto`** (check HTTP) | 4 |
| 6 | `no_wa_reply` | Sin respuesta WhatsApp | **`inverse`** | 1 | NULL | `manual` | 5 |
| 7 | `has_catalog` | Tiene catálogo | `positive` | 1 | NULL | `manual` | 6 |
| 8 | `has_team` | Tiene equipo | `positive` | 1 | NULL | `manual` | 7 |

Reglas del evaluador (contrato `evaluateScore()` puro, configurable-scoring): `value = Σ weight(met)` · `max = Σ weight(enabled)` → con preset intacto = `n/8` (igual que el Excel); `positive` suma cuando la señal cruda cumple, `inverse` sólo cuando NO se cumple (únicos inversos: `no_website`, `no_wa_reply`); `mode=auto` consume `analysis_checks`, `mode=manual` sin dato → `pending: true` en el breakdown y cuenta como no cumplido.

### 1.6 Diagrama de relaciones

```text
tenants ──┬─< users ──< sessions           token_hash = sha256(cookie __Host-ls_session)
          ├─< score_criteria               UNIQUE (tenant_id, key); preset §1.5
          └─< businesses ──┬─< analysis_checks      append (historial, checked_at)
                           ├─< score_evaluations    append (último source='rules' = score de cola)
                           ├─< outreach             sent_at NULL = borrador, NOT NULL = 1er contacto
                           └─< outcomes             UNIQUE (tenant_id, business_id) → 409 "cierre no se pisa"

Todas las flechas = FK hijo→padre con ON DELETE CASCADE; toda tabla con tenant_id + RLS FORCE T
(404 = 0 filas). Consultas derivadas — sin tablas extra:
  cola      = businesses ⋈ último score_evaluations(rules)   · filtros vertical/city/status
  contador  = agregado de outcomes (contacted · closed · rate · by_channel)
  classify  = evaluateScore() puro sobre inputs del caller + criterios del tenant demo (sin escritura)
```

## 2. Contratos de API

Convención (SPEC §7): JSON, zod en cada frontera (`packages/shared`), errores `{ error, details? }`. Todo bajo `/api/*` (D16 path routing; prod same-origin ⇒ sin CORS). `Auth`: **cookie** = guard `__Host-ls_session` (§1.3) · **ninguna** = allowlist pública (`/api/classify`, `/api/demo/*`, `/health`).

Reglas globales de código (contrato bloqueado, §1.4): `401` guard sin sesión · `400` zod antes de tocar DB · `404` = 0 filas bajo RLS (id inexistente y tenant ajeno indistinguibles) · `409` **SOLO** `UNIQUE (tenant_id, business_id)` de `outcomes` o trigger de transición · `422` validador de oferta sobre `draft` · `429` fixed-window en memoria. Duplicados de UNIQUE secundarias (`businesses.external_id`, `score_criteria.key`) → `400` con `details` (el 409 queda reservado). Listas: `{ items, total, page, limit }` con `limit` default 25 / máx 100.

### 2.1 session-auth

| Endpoint | Método | Auth | Request | Response | Códigos ↔ escenarios GWT |
|---|---|---|---|---|---|
| `/api/auth/login` | POST | ninguna (pre-auth) | `{email, password}` (zod; email lowercased) | `201` + `Set-Cookie: __Host-ls_session` (HttpOnly, Secure, SameSite=Lax, Path=/, sin Domain) y `{user:{id,email,tenant_id}}` | `201` login OK → `/api/auth/me` 200 con `tenant_id` · `400` zod · `401` password incorrecto → 0 sesiones, sin cookie |
| `/api/auth/logout` | POST | cookie | — | `204` (borra fila `sessions` + expira cookie) | `204` · `401` sin cookie o expirada |
| `/api/auth/me` | GET | cookie | — | `200 {id,email,tenant_id,expires_at}` | `200` sesión válida · `401` cookie ausente/expirada, **sin body de datos** |

- Guard CRM: HMAC en memoria → `SET LOCAL app.current_tenant` → lookup `sessions` (§1.3); allowlist pública exacta = `/api/classify`, `/api/demo/*`, `/health` — esas rutas responden según su contrato, nunca `401` por auth.
- Firma inválida → `401` sin tocar DB; expirada/revocada → `401` (0 filas). `logout` sobre sesión ya revocada → `401`.

### 2.2 business-intake

| Endpoint | Método | Auth | Request | Response | Códigos ↔ escenarios GWT |
|---|---|---|---|---|---|
| `/api/businesses` | POST | cookie | `{name, source_channel, vertical?, city?, whatsapp?, instagram_url?, email?, external_id?, next_action?, notes?}` | `201 {business}` con `status='new'` | `201` alta `referral` → nace `new`, aparece en la cola · `400` zod: `source_channel` ausente/fuera de enum o `external_id` duplicado (`details`) → 0 negocios creados · `401` |
| `/api/businesses/import` | POST | cookie | `multipart/form-data {file: CSV UTF-8, 24 col}` | `201 {created, duplicates, invalid_rows:[{row, error}]}` | `201` CSV real multilínea → ~12 negocios; doc-cols 22–24 descartadas sin error; filas malformadas en `invalid_rows` **sin abortar el lote**; `Score` NO importado (recalculado → `score_evaluations`) · `400` parser falla o 0 filas válidas · `401` |
| `/api/businesses/:id` | GET | cookie | — | `200 {business}` | `200` · `401` · `404` 0 filas bajo RLS |
| `/api/businesses/:id` | PATCH | cookie | parcial `{status?, vertical?, city?, whatsapp?, instagram_url?, email?, next_action?, notes?}` | `200 {business}` | `200` edición/ dropdown · `400` zod (estado fuera del enum ⇒ conserva el anterior) · `401` · `404` · `409` transición prohibida (trigger §1.4) |

- Import: fila con `Id` duplicado dentro del tenant → va a `duplicates`/`invalid_rows` (UNIQUE, §1.2.1); el lote continúa siempre.
- `PATCH status` valida primero zod (`400`) y luego la matriz de transiciones (`409`); cualquier `UPDATE` violado por trigger → `409` con `{error:'transition'}`.

### 2.3 prioritized-queue

| Endpoint | Método | Auth | Request | Response | Códigos ↔ escenarios GWT |
|---|---|---|---|---|---|
| `/api/businesses` | GET | cookie | query: `sort=score\|name\|created_at` (default `score`), `order=desc` (default), `vertical`, `city`, `status`, `page=1`, `limit=25` | `200 {items:[{...business, score, breakdown}], total, page, limit}` | `200` scores 7, 4, 6 → lista 7, 6, 4 (desc), sin drag&drop · `200` filtros `vertical`+`city`+`status` combinados (AND) → sólo cumplidores · `401` |

- `score` = último `score_evaluations.value` con `source='rules'` (LEFT JOIN por `created_at DESC`); sin evaluación → `score: 0` y va al final del orden desc.
- Filtro sin resultados → `200` con `items:[]` y `total:0` (las listas NO devuelven `404`; el `404` es sólo de ruta con `:id`).
- La cola es la misma ruta que intake (`GET /api/businesses`): una sola query parametrizada, sin endpoint duplicado (SPEC §7).

### 2.4 configurable-scoring

| Endpoint | Método | Auth | Request | Response | Códigos ↔ escenarios GWT |
|---|---|---|---|---|---|
| `/api/score/criteria` | GET | cookie | — | `200 [{id,key,label,polarity,weight,threshold,mode,enabled,position}]` orden `position` | `200` · `401` |
| `/api/score/criteria` | POST | cookie | `{key,label,polarity,weight,threshold?,mode,enabled?,position?}` | `201 {criterio}` | `201` · `400` zod (`weight<=0`, `polarity`/`mode` fuera de enum, `key` duplicada en tenant → `details`) · `401` |
| `/api/score/criteria/:id` | PATCH | cookie | parcial de los campos anteriores | `200 {criterio}` | `200` (`enabled=false` ⇒ excluido del `max` en la siguiente evaluación) · `400` · `401` · `404` |
| `/api/score/criteria/:id` | DELETE | cookie | — | `204` | `204` (evaluaciones previas conservan su snapshot `criteria` jsonb — sin FK) · `401` · `404` |
| `/api/score/evaluate/:businessId` | POST | cookie | — (evaluación `rules` pura) | `200 {value,max,breakdown:[{key,met,pending,weight}]}` + INSERT `score_evaluations` | `200` preset, 5 de 8 cumplidos → `value=5, max=8` + desglose · `401` · `404` |

- **Validación inversa:** `polarity='inverse'` suma sólo cuando la señal NO cumple (`no_website`, `no_wa_reply`); el `threshold` se compara SIEMPRE contra la señal cruda (4.3 vs 4.5 → `met:false`, score baja). `mode=manual` sin dato → `met:false, pending:true` (cuenta en `max` si `enabled`).
- El botón «re-evaluar» de la UI reutiliza `POST /api/score/evaluate/:businessId`: cada llamada añade una fila (append-only, §1.2) — no es idempotente por diseño; la cola siempre lee la última.

### 2.5 digital-presence-checks

| Endpoint | Método | Auth | Request | Response | Códigos ↔ escenarios GWT |
|---|---|---|---|---|---|
| `/api/checks/:businessId` | GET | cookie | — | `200 {items:[{check_type,result,checked_at}]}` historial completo orden `checked_at DESC` | `200` · `401` · `404` |
| `/api/checks/run/:businessId` | POST | cookie | — | `200 {checks:[{check_type http_site\|wa_me\|facebook, result, checked_at}]}` (INSERT append) | `200` negocio sin web → `http_site` fallido con timestamp · `200` re-run → registros NUEVOS con `checked_at` actualizado, 0 sobrescrituras · `401` · `404` 0 filas → **0 escrituras** |

- Fallo del check externo (timeout/5xx/DNS) = **dato** `result.ok:false` en `200`, nunca error HTTP (el contrato sólo contempla 200/401/404).
- Los criterios `mode=auto` (p. ej. `no_website`) leen el check más reciente de `analysis_checks` como señal cruda en la siguiente `evaluate`.

### 2.6 outreach-outcomes

| Endpoint | Método | Auth | Request | Response | Códigos ↔ escenarios GWT |
|---|---|---|---|---|---|
| `/api/outreach?businessId=` | GET | cookie | query `businessId` (opcional) | `200 {items:[{id,business_id,channel,draft,sent_at,created_at}]}` | `200` (lista vacía si sin filtro) · `401` |
| `/api/outreach/:businessId/draft` | POST | cookie | `{channel?}` (`whatsapp\|instagram\|email\|other`) | `200 {draft}` saludo frío sin oferta · `422 {error,details}` oferta detectada | `200` draft sin propuesta comercial · `401` · `404` · `422` precio/descuento/promoción en el texto ⇒ **no se persiste** |
| `/api/outreach/:businessId/contacted` | POST | cookie | — | `200 {business, outreach}` (INSERT `sent_at=now()` + `status→contacted`) | `200` primer contacto registrado, contador de contactados +1 · `401` · `404` · `409` estado terminal (trigger §1.4) |
| `/api/outreach/:businessId/outcome` | POST | cookie | `{result:'client'\|'no_client', notes?}` | `201 {outcome, business}` (INSERT `outcomes` + `status→client\|discarded`) | `201` outcome cliente → estado `client`, fila nueva, cerrados +1 · `400` zod · `401` · `404` · `409` ya cerrado (UNIQUE) o transición `new→client` prohibida ⇒ `outcomes` conserva el original |

- Outcome corre en **una transacción** (INSERT `outcomes` → UPDATE `businesses`); cualquier `409` ⇒ ROLLBACK total — nunca queda cierre a medias.
- El `draft` 422 se evalúa en app antes del INSERT (§1.4); outreach es SIEMPRE manual — la API no envía mensajes.
- `contacted` es idempotente sobre negocio ya `contacted` (update sin cambio, `200`); sólo estados terminales dan `409`.

### 2.7 results-reporting

| Endpoint | Método | Auth | Request | Response | Códigos ↔ escenarios GWT |
|---|---|---|---|---|---|
| `/api/metrics/results` | GET | cookie | — | `200 {contacted, closed, rate, by_channel:[{channel,contacted,closed,rate} × 5 canales, {channel:'total',…}]}` | `200` 10 contactados / 3 cerrados → `rate=0.3` · `200` `contacted=0` ⇒ `rate=0` (**sin división por cero**) · `200` cerrados repartidos → `by_channel[]` con subtotal `total` · `401` |

- Todo agregado **por SQL en request** (D12): `closed = COUNT(outcomes)` · `contacted = COUNT(outreach WHERE sent_at IS NOT NULL)` · `rate = contacted>0 ? closed/contacted : 0` — 0 columnas contadas a mano, 0 triggers de contador (§1.4).
- `by_channel` agrupa por `businesses.source_channel` (los 5 valores del CHECK, siempre presentes) + subtotal `total`; la tira de la cola y el contador del `/demo` consumen esta misma respuesta.

### 2.8 demo-and-classify (público)

| Endpoint | Método | Auth | Request | Response | Códigos ↔ escenarios GWT |
|---|---|---|---|---|---|
| `/api/demo/queue` | GET | ninguna | query opcionales: `sort`, `vertical`, `city`, `status`, `page`, `limit` | `200 {items,total,page,limit}` — cola sintética del tenant `demo` vía `withTenant(DEMO_TENANT_ID)` | `200` visitante sin sesión ve cola/criterios/contador **sólo del `demo`** (nunca datos reales) · `429` rate limit público excedido |
| `/api/classify` | POST | ninguna | `{business:{name?,vertical?,city?,whatsapp?,instagram_url?}, signals:{[criterionKey]: valor_bruto}}` | `200 {value,max,breakdown:[{key,met,pending,weight}]}` — `evaluateScore()` puro sobre los criterios del tenant `demo`, **sin escritura** | `200` score calculado · `400` zod (signals con clave desconocida o tipo inválido) · **`429` 11ª llamada en la ventana** (10 primeras → `200`) |

- Rate limit: fixed window **por IP en memoria** — `CLASSIFY_RATE_LIMIT=10` / `CLASSIFY_RATE_WINDOW=60000` (SPEC §11), bucket compartido por las rutas públicas (`/api/classify` y `/api/demo/queue`, que SPEC §7 lista con `429`); respuesta `429` con `Retry-After` = segundos restantes de ventana; sin persistencia ⇒ se vacía al reiniciar (aceptable MVP).
- Ambas rutas pasan por `withTenant(DEMO_TENANT_ID)` (§1.3): un bug que omita el SET ⇒ RLS `FORCE` devuelve 0 filas (default-deny), jamás datos de `nuncacierro`.

### 2.9 health y seed

| Endpoint | Método | Auth | Request | Response | Códigos ↔ escenarios GWT |
|---|---|---|---|---|---|
| `/health` | GET | ninguna | — | `200 {status:'ok'}` — **sin DB** (§1.3) | `200` siempre (liveness para Caddy/contenedor) |

- **Seed NO es endpoint HTTP**: ocurre como migración dbmate + seed de arranque idempotente (§1.5); no se expone por la red.

## 3. Seguridad transversal

### 3.1 Postura CSRF

**Decisión: `SameSite=Lax` + cookie host-only `__Host-ls_session` como defensa primaria; SIN token CSRF.** Justificación: en prod todo es **mismo origen** por path routing (D16, §5.2; `CORS_ORIGINS` vacío) — no hay cross-site que explotar; `Lax` ya excluye la cookie en POST cross-site y el prefijo `__Host-` fuerza `Secure` + `Path=/` + sin `Domain` junto a `HttpOnly` (SPEC §5). Dev: CORS por allowlist estricta (`CORS_ORIGINS`, nunca `*`). Token doble-submit descartado: estado y código extra sin amenaza real en un MVP single-origin. Allowlist pública `demo` ya listada en §2.1/§2.8 (`/api/classify`, `/api/demo/*`, `/health`, siempre con `withTenant(DEMO_TENANT_ID)`).

## 4. Estructura del monorepo

Árbol **objetivo** (D13; el scaffold lo ejecuta el usuario antes de U2 y la IA sólo valida la estructura — D8). Hoy el repo sólo contiene `docs/`, `openspec/`, `db/migrations/` y `.env.example`:

```text
leadscore/
├── package.json + tsconfig.base.json + vitest.workspace.ts  # workspaces, strict, suites (§6)
├── db/migrations/0001_init.sql     # dbmate en RAÍZ (§1.1) — NO dentro de apps/api
├── apps/web/          # Next.js App Router — SOLO UI (nunca importa `pg`)
│   ├── app/           # page.tsx: `/` landing, `/demo`, `/crm/*`  (path routing D16)
│   ├── next.config.ts # dev: rewrite `/api/*` → localhost:8080 (§5.2)
│   └── package.json
├── apps/api/          # Fastify — dueño ÚNICO de DB/auth/negocio
│   ├── src/server.ts  # `createApp()` separado de `listen` → `fastify.inject` (§6)
│   ├── src/routes/  src/services/    # 1 archivo por capacidad (§2) | CSV, checks, validador 422, rate limit
│   ├── src/db/        # pool + `withTenant()` (§1.4) + seed idempotente (§1.5)
│   └── package.json
└── packages/shared/   # SIN I/O — fuente única de tipos web ↔ api
    ├── src/schemas.ts  src/scoring.ts    # zod (auth/business/criteria/classify) + `evaluateScore()` puro
    └── package.json
```

| Paquete | Vive aquí | Prohibido aquí |
|---|---|---|
| `packages/shared` | schemas zod + tipos derivados, enums (`status`, `source_channel`), `evaluateScore()` (§1.5) | `pg`, `fetch`, cualquier I/O, React |
| `apps/api` | rutas (§2), guard de sesión (§1.3), pool + `withTenant`, import CSV, checks, `seed.ts` | JSX/React, copias de la lógica de score |
| `apps/web` | páginas App Router, componentes (tabla, dropdown, form criterios), `fetch(url, {credentials:'include'})` | `pg`, queries, re-implementar `evaluateScore` |

**Scripts npm:** raíz `dev` (web + api concurrentes), `build`, `test` (→ workspaces), `lint`, `typecheck` · `apps/api`: `dev` (watch), `start`, `test` · `apps/web`: `dev`, `build`, `test`. `dbmate up|new|rollback` se ejecuta con `DATABASE_URL` en el shell (sin wrapper: el comando queda a la vista). ESLint flat por paquete; `.env` en raíz y gitignored.

## 5. Infraestructura (U2b — cambio separado, después de U2–U3)

### 5.1 Docker Compose — 4 servicios

| Servicio | Imagen / build | Puertos | Env | Healthcheck | Volúmenes |
|---|---|---|---|---|---|
| `caddy` | `caddy:2` + `./deploy/Caddyfile` | `80,443` — **única entrada publicada** (D16) | — | `caddy version` | `caddy_data` |
| `web` | build `apps/web` (`next build` → `next start`) | `3000` interna | `NEXT_PUBLIC_API_URL` (**build ARG** ↓) | `wget -q localhost:3000` | — |
| `api` | build `apps/api` (`tsc` → `node dist`) | `8080` interna | `DATABASE_URL`, `SESSION_SECRET`, `SEED_*`, `CLASSIFY_*`, `DEMO_TENANT_ID`, `CORS_ORIGINS=`, `NODE_ENV=production` — vía `env_file`, **jamás dentro de la imagen** (`.dockerignore` barre `.env*`) | `GET /health` (§2.9) | — |
| `postgres` | `postgres:16-alpine` | `5432` interna | `POSTGRES_USER/PASSWORD/DB` | `pg_isready -U …` | `pgdata` |

### 5.2 Caddyfile — path routing D16

```caddyfile
leadscore.nuncacierro.com {
    # single-origin: CORS cero en prod; HTTPS sólo en el edge CF→Caddy; app.*/api.* NO existen (D16)
    handle /api/*  { reverse_proxy api:8080 }
    handle /health { reverse_proxy api:8080 }
    handle        { reverse_proxy web:3000 }  # `/`, `/demo`, `/crm/*` → Next (app/ por path, sin rewrite)
}
```

### 5.3 Pipeline GH Actions (por unidad de §13)

`ci.yml` en **cada PR**: `npm ci → lint → typecheck → test → build` (scripts raíz, §4). `deploy.yml` en **push a main** (recién desde U2b): `docker compose build → dbmate up → compose up -d → curl /health` (gate; rollback = imagen anterior + `dbmate rollback`, §1.1). U2–U9 no despliegan: U2b es cambio separado.

### 5.4 `.env.example` → servicios

| Var | Consumidor |
|---|---|
| `DATABASE_URL`, `POSTGRES_*`, `NODE_ENV`, `API_PORT` | `postgres` (init) · `api` (runtime, prod `production`/8080) · dbmate en release |
| `SESSION_SECRET`, `SEED_USER_EMAIL/PASSWORD` | `api` — login (§1.3) y seed idempotente U3 (§1.5) |
| `CLASSIFY_RATE_LIMIT/WINDOW`, `DEMO_TENANT_ID` | `api` — rate limit (§2.8), rutas públicas (§1.3) |
| `CORS_ORIGINS` | `api` — **vacío en prod**, sólo dev (single-origin D16) |
| `NEXT_PUBLIC_API_URL` | `web` — **build ARG**: Next hornea `NEXT_PUBLIC_*` al construir; dev `http://localhost:8080`, prod vacío → `/api/*` relativo |

## 6. Estrategia de testing (vitest, SPEC §12)

| Dónde | Qué y cómo |
|---|---|
| `packages/shared` | `evaluateScore()` puro: polaridad, weight, threshold, `mode`, preset 8, inversos, `pending` — sin I/O |
| `apps/api` | cada ruta (§2) vía `fastify.inject` sobre `createApp()` (sin `listen`): escenarios GWT → 400/401/404/409/422/429; DB de test real |
| `apps/api` | **RLS**: sin `SET LOCAL` → 0 filas · tenant ajeno → 0 filas (404) · `withTenant(A)` no ve filas de `B` — queries negativas en las 9 tablas (U2) |
| `apps/web` | componentes (tabla ordenada, dropdown con 409, form criterios) con `fetch` mockeado |

**Fixtures:** `dbmate up` sobre la DB de test + seed idempotente (§1.5) → mismos datos que dev; 2 tenants (`demo`, `nuncacierro`) y 1 usuario por tenant sostienen los tests negativos.

**Cobertura U1–U9 (SPEC §13/§14):** U2 RLS+zod · U3 auth 400/401/201 · U4 parser CSV (dup, filas inválidas, cols 22–24) · U5 CRUD criterios+evaluate · U6 checks (fallo externo = dato en 200) · U7 componentes · U8 draft 422 + outcome 409 · U9 classify 10ª→200 / 11ª→429. **E2E mínimo:** smoke del demo público (sin auth: `/`, `/demo`, `/api/demo/queue` → 200 sólo con datos `demo`; CRM sin cookie → 401); Playwright completo = post-MVP (SPEC §12). Cada unidad deja `npm test` verde antes del PR.

## 7. Decisiones de diseño (resueltas con el usuario — 2026-10-05)

- [x] **`contacted` de las métricas (§2.7):** fuente de verdad = `outreach.sent_at IS NOT NULL`; el "derivado de outcomes" del delta es el resultado posterior, no el hecho de contacto.
- [x] **`DELETE /api/score/criteria/:id` (§2.4):** se mantiene en el contrato (el delta exige CRUD completo) — SPEC §7 requiere enmienda de superficie: añadir la ruta DELETE.
- [x] **SPEC §4 vs dbmate (§1.1):** dbmate confirmado; enmendar SPEC §4 (migración única psql → dbmate en `db/migrations/` en U2).
- [x] **`POST /api/classify` (§2.8):** body `{business?, signals}` confirmado; validar contra la UI del demo en U2.
- [x] **Transición `new → discarded` (§1.4):** habilitada directa — ningún escenario GWT exige 409 en esa transición (el único 409 aplicable es "cierre ya cerrado" en outcomes) y `contacted` no se contamina (fuente = `outreach.sent_at`). `new → client` sigue ❌ 409: un cliente exige pasar por `contacted`.
- [x] **`EVO_API_KEY` (U8):** MVP con draft determinista por plantillas (sigue siendo la "asistencia de redacción" de SPEC §2); variable ELIMINADA de `.env.example` y SPEC §11; reintegrar key server-side cuando U8 evalúe EvoAPI (proposal: "cuando llegue U8").
