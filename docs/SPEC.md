# leadscore — Especificación del producto

> **⚠️ OVERRIDE (2026-10-05, U1) — lee esto primero:** este documento reemplaza **por completo** la especificación anterior. El producto viejo (CRM Kanban con `@dnd-kit`, tabla única `leads`, Supabase, deploy en Vercel, route handlers de Next) está **retirado**: no hay Kanban, no hay drag & drop, no hay Supabase, no hay Vercel. Cualquier sección previa (resumen / alcance / stack / `leads` / API routes / UI Kanban / migración / env / fases / roadmap / desviaciones) queda anulada. Contrato de producto: `openspec/changes/prospeccion/proposal.md` (D1–D16, U1–U9).

## 0. Portada e intención

**leadscore = motor de prospección y calificación de negocios para vender servicios de NuncaCierro.** Entrada manual o por CSV → checks de presencia digital → score configurable → cola priorizada → outreach manual → outcome (cliente sí/no) → contador de resultados → dataset para ML futuro.

**Prioridad D15 (ordena todos los tradeoffs):**

| # | Prioridad | Significado |
|---|-----------|-------------|
| 1 | Negocio NuncaCierro | Herramienta para conseguir leads y clientes reales |
| 2 | Portfolio | Beneficio colateral, no objetivo |
| 3 | Escala / SaaS | Opción futura; los seams (tenancy, RLS, `source_channel`) ya están puestos sin construir la plataforma |

**Doble uso:** herramienta interna de NuncaCierro + pieza de portfolio con estándar de seguridad alto (multi-tenant-ready desde U2, aunque el MVP corre con 1 tenant y 1 usuario).

**Fuera de alcance en el MVP:** ML (ONNX/PyTorch, `ml_score` — slice futuro D9), Kanban/@dnd-kit, multiusuario con invites/billing, automatización de riesgo ToS (cold WhatsApp automation, scraping de Instagram), Playwright E2E (post-MVP), Supabase/Vercel/Prisma/Redux.

## 1. Flujo completo

```
captura → checks → score → cola → outreach manual → outcome → contador → dataset ML futuro
```

| # | Etapa | Qué ocurre | Persistencia |
|---|-------|------------|--------------|
| 1 | Captura | Alta manual (Maps/IG → form) o import de CSV de scraper | `businesses` (+`source_channel`) |
| 2 | Checks | Auto: HTTP de sitio, detección `wa.me`, Facebook. Manual: IG followers/posts, team, catálogo | `analysis_checks` |
| 3 | Score | `evaluateScore()` puro sobre `score_criteria` activos (polarity/weight/threshold/mode) | `score_evaluations` (`source='rules'`) |
| 4 | Cola | Tabla ordenada por score, dropdown de estado, filtros | UI (`apps/web`) |
| 5 | Outreach | **Manual**: saludo frío SIN oferta (asistencia de redacción, nunca automatizado) | `outreach` |
| 6 | Outcome | Cliente sí/no registrado a mano | `outcomes` |
| 7 | Contador | Contactados / cerrados / tasa, desglosado por `source_channel` | derivado de `outcomes` |
| 8 | Dataset | Evaluaciones + outcomes quedan listos para re-ranking ML híbrido | futuro (D9) |

Invariantes del flujo: el score **nunca** se guarda como booleanos por fila de negocio; el outreach **nunca** se envía automáticamente; el contador es **siempre** derivado, nunca contado a mano.

## 2. Captura (D4 / D14)

Dos vías de entrada, ambas convergen en `businesses` con `source_channel` (`referral | partner | maps-csv | inbound | ads`):

1. **Manual:** encontrar negocio en Google Maps o Instagram → formulario de alta → checks → score.
2. **Scraper externo → CSV → import:** exportar con una herramienta tipo **Outscraper** (pay-as-you-go, ~USD 3/1k, primeros 500 gratis — referencia, no dependencia) → subir CSV → parser tolerante → filas en `businesses`. El import es la costura universal: sirve para la semilla real y para cualquier export futuro.

### 2.1 Mapeo de columnas (CSV real del usuario, 24 columnas)

Header real: `Id,Nombre,Vertical,Ciudad,Score,WhatsApp,Instagram,Correo,Estado,Fecha de contacto,Próxima acción,>2 sedes,>4.5 estrellas,>500 follow Ig,Post constante,Sin sitio web,Sin rta Wa,Catalog,Team,Notes,,Campo,Propósito y Formato,Comportamiento`

| # | Columna CSV | Destino | Nota |
|---|-------------|---------|------|
| 1 | `Id` | `businesses.external_id` | Referencia del export; única por tenant |
| 2 | `Nombre` | `businesses.name` | Obligatorio |
| 3 | `Vertical` | `businesses.vertical` | Texto normalizado (ej. `restaurant`, `estetica`) |
| 4 | `Ciudad` | `businesses.city` | |
| 5 | `Score` | *no se importa* | Se **recalcula** con el preset → `score_evaluations` |
| 6 | `WhatsApp` | `businesses.whatsapp` | Normalizar a `wa.me/<número>` si aplica |
| 7 | `Instagram` | `businesses.instagram_url` | Handle o URL |
| 8 | `Correo` | `businesses.email` | |
| 9 | `Estado` | `businesses.status` | Mapear valor → enum (`new/contacted/client/discarded`) |
| 10 | `Fecha de contacto` | `outreach.sent_at` | Crea el primer registro de `outreach` |
| 11 | `Próxima acción` | `businesses.next_action` | Texto libre |
| 12 | `>2 sedes` | criterio `multi_site` → `score_evaluations.criteria` | TRUE/FALSE = `met` directo |
| 13 | `>4.5 estrellas` | criterio `rating_45` | ídem |
| 14 | `>500 follow Ig` | criterio `ig_followers_500` | ídem |
| 15 | `Post constante` | criterio `ig_posting` | ídem |
| 16 | `Sin sitio web` | criterio `no_website` (inverso) | TRUE = cumple = suma punto |
| 17 | `Sin rta Wa` | criterio `no_wa_reply` (inverso) | ídem |
| 18 | `Catalog` | criterio `has_catalog` | |
| 19 | `Team` | criterio `has_team` | |
| 20 | `Notes` | `businesses.notes` | |
| 21 | *(vacía)* | — | Separador: fin de datos |
| 22–24 | `Campo`, `Propósito y Formato`, `Comportamiento` | — | **Doc-columns embebidas: se descartan sin error** |

Reglas del parser (U4): tolerar **filas multilínea** (celdas con saltos entre comillas), header real = 24 columnas, columnas 22–24 ignoradas, errores por fila reportados sin abortar el lote. En import, TRUE/FALSE del CSV es el resultado del criterio (`met`); la `polarity` aplica a la señal **cruda** de los checks automáticos.

## 3. Arquitectura (D13)

Monorepo **npm workspaces** — árbol objetivo EXACTO:

```
leadscore/
├── package.json                 # "workspaces": ["apps/*", "packages/*"]
├── apps/
│   ├── web/                     # Next.js — SOLO UI (nunca importa pg ni toca la DB)
│   │   └── app/                 # (login) rutas por path: /, /demo, /crm/* (host único D16)
│   └── api/                     # Fastify + TypeScript — dueño ÚNICO de DB/auth/negocio
│       ├── src/                 # routes/, services/, db/ (helper withTenant)
│       └── db/migrations/0001_init.sql
└── packages/
    └── shared/                  # schemas zod + evaluateScore() puro (web ↔ api)
```

Comandos orientativos de scaffold (D8: **el usuario los ejecuta a mano**; la IA solo valida la estructura antes de U2):

```bash
npm init -y && npm pkg set private=true
# package.json raíz → "workspaces": ["apps/*", "packages/*"]
npx create-next-app@latest apps/web        # TypeScript, App Router
mkdir -p apps/api && cd apps/api && npm init -y
npm i fastify @fastify/cors pg zod argon2 && npm i -D typescript vitest
mkdir -p packages/shared && cd ../../packages/shared && npm init -y && npm i zod
```

### 3.1 Reglas innegociables

| Regla | Detalle |
|-------|---------|
| Fetch HTTP | Siempre `fetch(url, { credentials: 'include' })` desde `apps/web` |
| zod | Solo vive en `packages/shared` — una sola fuente de tipos para web y api |
| Datos | SOLO vía helper central `withTenant()` → transacción + `SET LOCAL app.current_tenant` |
| Score | SIEMPRE derivado de `score_criteria`; **cero** booleanos por fila de negocio |
| Fronteras | `apps/web` nunca importa `pg`/drivers; toda query de negocio nace en `apps/api` |
| Prohibido | Supabase, Vercel, Prisma, Redux/Zustand, `@dnd-kit`, tabla `leads` |

## 4. Modelo de datos

Migraciones versionadas vía dbmate (`dbmate new` / `up` / `rollback`); `db/migrations/0001_init.sql` es la primera (D7). **9 tablas**:

| Tabla | Columnas clave |
|-------|----------------|
| `tenants` | `id`, `slug` (**`demo` reservado**), `name`, `created_at` |
| `users` | `id`, `tenant_id NOT NULL`, `email` único, `password_hash` (argon2id) |
| `sessions` | `id`, `tenant_id NOT NULL`, `user_id`, `token_hash`, `expires_at` |
| `businesses` | `id`, `tenant_id NOT NULL`, `external_id`, `name`, `vertical`, `city`, `whatsapp`, `instagram_url`, `email`, `status`, `source_channel`, `next_action`, `notes` |
| `analysis_checks` | `id`, `tenant_id NOT NULL`, `business_id`, `check_type`, `result jsonb`, `checked_at` |
| `score_criteria` | `id`, `tenant_id NOT NULL`, `key`, `label`, `polarity`, `weight`, `threshold`, `mode`, `enabled`, `position` |
| `score_evaluations` | `id`, `tenant_id NOT NULL`, `business_id`, `source` (`rules/ml/hybrid`), `value`, `criteria jsonb`, `created_at` |
| `outreach` | `id`, `tenant_id NOT NULL`, `business_id`, `channel`, `draft`, `sent_at`, `created_at` |
| `outcomes` | `id`, `tenant_id NOT NULL`, `business_id`, `result` (`client/no_client`), `notes`, `created_at` |

Reglas de aislamiento (D11):

- `tenant_id NOT NULL` en **todas** las tablas de dominio (incluida la join a `tenants`).
- RLS con **`FORCE ROW LEVEL SECURITY`** aplicadas dentro de `0001_init.sql`.
- Políticas **default-deny**: `USING (tenant_id = current_setting('app.current_tenant', true)::uuid)` — si el tenant es `NULL` (rutas públicas sin sesión), la comparación es `NULL` → **0 filas**.
- Toda query pasa por `withTenant()`; ninguna ruta escribe fuera de esa transacción.
- El tenant `demo` queda reservado para `/demo` y `/api/classify`; el CRM real usa el tenant seed (`nuncacierro`).
- El score de la cola = último `score_evaluations.value` con `source='rules'`.

## 5. Auth (D5)

| Pieza | Decisión |
|-------|----------|
| Credenciales | Cookie `__Host-ls_session` (el prefijo `__Host-` la hace **rechazable por el navegador** si falta `Secure`, `Path=/` o tiene `Domain`): token firmado, `HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/`, sin `Domain` |
| Password | **argon2id** (nunca MD5/SHA crudo) |
| Sesión | Fila en `sessions` con `tenant_id` + `user_id` + `expires_at` |
| Guard | Middleware en `apps/api`: sin sesión válida → **401** en toda ruta CRM; allowlist pública = `/api/classify`, `/api/demo/*`, `/health` |
| Seed | 1 tenant (`nuncacierro`) + 1 usuario desde env (`SEED_USER_EMAIL` / `SEED_USER_PASSWORD`) |
| CORS dev | **Único escenario con CORS:** allowlist `http://localhost:3000` (+ puertos web), `credentials: true` (nunca `*` con credentials) |
| CORS prod | Single-origin (D16 opción D, path routing en Caddy): web y API comparten origen ⇒ **sin cabeceras CORS** en prod; el navegador no las exige |

Verificación mínima de U3: login → cookie → `GET /api/auth/me` 200 → `GET /api/businesses` 200 → sin cookie = 401.

## 6. Topología de URLs (D16 — obligatoria, opción D)

**UN solo hostname** `leadscore.nuncacierro.com` (registro único **PROXIED** en Cloudflare) sirve **todo** mediante **path routing en Caddy**. Motivo: Universal SSL free solo cubre subdominios de **un** nivel — un subdominio anidado (`app.leadscore.*`) NO obtendría certificado válido. Los subdominios `app.leadscore.*` y `api.leadscore.*` **NO existen** y no deben referenciarse.

| Ruta | Contenido | Auth |
|------|-----------|------|
| `/` | **Landing pública de venta**: qué es, motor en acción, CTA | No |
| `/demo` | **Demo interactivo**: cola, criterios activables, contador, con datos seed/sintéticos | No |
| `/crm/*` | **CRM real** (`apps/web`) | Sí |
| `/api/*` | **API** (`apps/api`) → `reverse_proxy` al contenedor Fastify | Sí (rutas CRM) |

- **Caddy** = único punto de entrada: enruta `/`, `/demo` y `/crm/*` al front (Next) y `/api/*` (más `/health`) al contenedor Fastify.
- **Single-origin ⇒ CORS cero en prod** (solo dev lo necesita, §5); cookies host-only con semántica `__Host-` válidas sin ajustes; la IP del origen queda oculta tras Cloudflare.
- **DNS:** registro `A` raíz → IP del server, **PROXIED** (creado 2026-10-05); con la topología D **no se requieren registros adicionales**.
- `/demo` y `/api/classify` están bindeados al tenant `demo` reservado: sin sesión, sin datos reales.

## 7. API surface (`apps/api`, Fastify)

Convención: JSON, zod en cada frontera (schemas de `shared`), errores `{ error, details? }`.

| Método | Ruta | Codes | Grupo |
|--------|------|-------|-------|
| POST | `/api/auth/login` | 201 cookie · 400 zod · 401 credenciales | auth |
| POST | `/api/auth/logout` | 204 · 401 | auth |
| GET | `/api/auth/me` | 200 · 401 | auth |
| GET | `/api/businesses` (sort/vertical/city/status) | 200 · 401 | intake/queue |
| POST | `/api/businesses` | 201 · 400 · 401 | intake |
| GET | `/api/businesses/:id` | 200 · 401 · 404 | intake |
| PATCH | `/api/businesses/:id` | 200 · 400 · 401 · 404 | intake/queue |
| POST | `/api/businesses/import` (CSV) | 201 + resumen · 400 filas inválidas · 401 | intake |
| GET | `/api/score/criteria` | 200 · 401 | scoring |
| POST | `/api/score/criteria` | 201 · 400 · 401 | scoring |
| PATCH | `/api/score/criteria/:id` | 200 · 400 · 401 · 404 | scoring |
| DELETE | `/api/score/criteria/:id` | 204 · 401 · 404 | scoring |
| POST | `/api/score/evaluate/:businessId` | 200 `value+breakdown` · 401 · 404 | scoring |
| GET | `/api/checks/:businessId` | 200 · 401 · 404 | checks |
| POST | `/api/checks/run/:businessId` (HTTP, wa.me, FB) | 200 resultados · 401 · 404 | checks |
| GET | `/api/outreach?businessId=` | 200 · 401 | outreach |
| POST | `/api/outreach/:businessId/draft` (saludo frío) | 200 texto · 401 · 404 · 422 si incluye oferta | outreach |
| POST | `/api/outreach/:businessId/contacted` | 200 · 401 · 404 | outreach |
| POST | `/api/outreach/:businessId/outcome` | 201 · 400 · 401 · 409 si ya cerrado | outcomes |
| GET | `/api/metrics/results` (total + por canal) | 200 · 401 | reporting |
| GET | `/api/demo/queue` (tenant `demo`) | 200 · 429 | público |
| POST | `/api/classify` (público, **rate-limit por IP**) | 200 score · 400 · **429** | público |

## 8. UI MVP (`apps/web`)

- **Tabla única ordenada por score desc** — sin Kanban, sin `@dnd-kit` (D1).
- **Dropdown de estado** por fila: `new → contacted → client / discarded` (edición inline → `PATCH /api/businesses/:id`).
- **Filtros:** vertical · ciudad · estado.
- **Form de criterios:** CRUD de `score_criteria` (polarity, weight, threshold, mode, enabled) + botón «re-evaluar».
- **Alta de negocio:** name, vertical, city, canales + **`source_channel` obligatorio** (D14).
- **Contador de resultados (D12):** tira visible en la cola — contactados · cerrados · tasa, **desglosada por `source_channel`** (referidos vs maps-csv vs otros) — derivado de `outcomes` (D12/D14).
- Vistas públicas (U9): landing `/`, demo `/demo` con motor en acción + CTA.

## 9. Preset de criterios (D2 — 8 criterios Excel)

| key | label | polarity | weight | threshold | mode |
|-----|-------|----------|--------|-----------|------|
| `multi_site` | Más de 2 sedes | positive | 1 | 2 | manual |
| `rating_45` | Rating > 4.5 | positive | 1 | 4.5 | manual |
| `ig_followers_500` | +500 followers IG | positive | 1 | 500 | manual |
| `ig_posting` | Posteo constante | positive | 1 | — | manual |
| `no_website` | Sin sitio web | **inverse** | 1 | — | **auto** (check HTTP) |
| `no_wa_reply` | Sin respuesta WhatsApp | **inverse** | 1 | — | manual |
| `has_catalog` | Tiene catálogo | positive | 1 | — | manual |
| `has_team` | Tiene equipo | positive | 1 | — | manual |

- `positive` = suma cuando la señal cruda cumple; `inverse` = suma cuando la señal **no** se cumple (los dos únicos inversos: `no_website`, `no_wa_reply`).
- Preset con `weight=1` → score = `n/8`, igual que el Excel. Todos `enabled=true`.
- `mode=auto` consume `analysis_checks`; `mode=manual` se captura/edita en la UI. Checks (Facebook, etc.) pueden existir sin criterio asociado.
- Fórmula: `value = Σ weight(met)` · `max = Σ weight(enabled)` → persistido en `score_evaluations`.

## 10. Capacidades (contrato Given/When/Then)

### business-intake
Alta manual y por CSV con `source_channel` y mapeo de columnas.
- **DADO** un negocio encontrado en Maps — **CUANDO** se da de alta vía form con canal `referral` — **ENTONCES** nace `status='new'`, aparece en la cola y responde 201.
- **DADO** el CSV real de 24 columnas con filas multilínea — **CUANDO** se importa — **ENTONCES** se crean los ~12 negocios, las doc-columns (22–24) se ignoran sin error y el detalle de filas malformadas se reporta sin abortar el lote.

### digital-presence-checks
Checks auto (HTTP, wa.me, Facebook) + manuales, con `checked_at`/payload.
- **DADO** un negocio sin sitio web — **CUANDO** corre `POST /api/checks/run/:id` — **ENTONCES** se registra `check_type=http_site` fallido con timestamp en `analysis_checks`.
- **DADO** un negocio con checks ya registrados — **CUANDO** se repite el run — **ENTONCES** se añaden registros nuevos con `checked_at` actualizado (historial, no sobrescritura).

### configurable-scoring
Tabla de criterios (polarity/weight/threshold/mode/enabled), preset de 8, evaluación `rules`.
- **DADO** el preset de 8 criterios — **CUANDO** se evalúa un negocio con 5 criterios cumplidos — **ENTONCES** devuelve `value=5`, `max=8` y el desglose por criterio.
- **DADO** un criterio `rating_45` con threshold 4.5 — **CUANDO** la señal cruda es 4.3 — **ENTONCES** el criterio NO cumple y el score baja; cambiar `enabled=false` lo excluye del `max`.
- **DADO** un criterio con `mode=manual` sin dato — **CUANDO** se evalúa — **ENTONCES** cuenta como no cumplido y queda marcado como pendiente en el breakdown.

### prioritized-queue
Tabla UI ordenada por score, dropdown de estado, filtros (vertical/ciudad/estado).
- **DADO** varios negocios con scores 7, 4, 6 — **CUANDO** se abre la cola — **ENTONCES** se listan 7, 6, 4 (score desc) sin drag & drop.
- **DADO** un negocio `new` — **CUANDO** se cambia a `contacted` por dropdown — **ENTONCES** persiste vía PATCH, devuelve 200 y la fila refleja el nuevo estado.

### outreach-outcomes
Asistencia de saludo frío (sin oferta), registro de contacto y outcome cliente sí/no → dataset.
- **DADO** un negocio en la cola — **CUANDO** se pide un draft — **ENTONCES** devuelve un saludo frío sin propuesta comercial (200); si el texto incluye oferta, el validador responde 422.
- **DADO** un negocio contactado — **CUANDO** se registra outcome `client` — **ENTONCES** el estado pasa a `client`, nace la fila en `outcomes` y el contador de cerrados sube 1.
- **DADO** un negocio ya cerrado — **CUANDO** se intenta otro outcome — **ENTONCES** responde 409 (no se pisa un cierre).

### demo-and-classify
Landing de venta en root + `/demo` público con datos sintéticos + `/api/classify` público rate-limited — sin autenticación (D16).
- **DADO** un visitante sin sesión en `leadscore.nuncacierro.com` — **CUANDO** abre `/demo` — **ENTONCES** ve cola, criterios activables y contador con datos del tenant `demo` (nunca datos reales).
- **DADO** un cliente HTTP — **CUANDO** llama `POST /api/classify` 11 veces en la ventana (límite 10) — **ENTONCES** las 10 primeras responden 200 y la 11ª responde **429** (fixed window por IP, en memoria).
- **DADO** un bug hipotético en ruta pública — **CUANDO** consulta con tenant NULL — **ENTONCES** RLS devuelve **0 filas** (default-deny).

### session-auth
Login httpOnly + argon2id sobre `users`, sesiones con `tenant_id`, guard 401 y aislamiento por tenant — una sola cuenta activa en el MVP.
- **DADO** credenciales válidas — **CUANDO** se hace login — **ENTONCES** se setea cookie `HttpOnly` y `/api/auth/me` responde 200 con el `tenant_id` de la sesión.
- **DADO** una cookie ausente o expirada — **CUANDO** se llama cualquier ruta CRM — **ENTONCES** responde 401 (sin body de datos).
- **DADO** una query ejecutada sin `SET LOCAL app.current_tenant` — **CUANDO** pasa por RLS `FORCE` — **ENTONCES** devuelve 0 filas aunque la conexión sea de superuser.

### results-reporting
Métricas de conversión (contactados/cerrados/tasa) derivadas de `outcomes`, con desglose por `source_channel`, en la cola y en el demo.
- **DADO** 10 contactados y 3 cerrados — **CUANDO** se llama `GET /api/metrics/results` — **ENTONCES** responde `contacted=10`, `closed=3`, `rate=0.3`.
- **DADO** cerrados repartidos por canal — **CUANDO** se pide el desglose — **ENTONCES** devuelve `by_channel[]` con tasa por `referral/partner/maps-csv/inbound/ads` y subtotal `total`.
- **DADO** el visitante del `/demo` — **CUANDO** ve el contador — **ENTONCES** muestra las mismas métricas calculadas sobre datos del tenant `demo`.

## 11. Variables de entorno

| Var | Workspace | Ejemplo / nota | Necesaria en |
|-----|-----------|----------------|--------------|
| `DATABASE_URL` | `apps/api` | `postgres://user:pass@localhost:5432/leadscore` | U2 |
| `SESSION_SECRET` | `apps/api` | secreto de firma de cookie (≥32 bytes) | U3 |
| `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | `apps/api` | cuenta única del MVP | U3 |
| `CORS_ORIGINS` | `apps/api` | `http://localhost:3000` (allowlist, dev) | U3 |
| `CLASSIFY_RATE_LIMIT` / `CLASSIFY_RATE_WINDOW` | `apps/api` | `10` / `60000` (fixed window por IP) | U9 |
| `DEMO_TENANT_ID` | `apps/api` | UUID del tenant `demo` (alimenta `/demo` y `/api/classify`) | U4/U9 |
| `NEXT_PUBLIC_API_URL` | `apps/web` | dev `http://localhost:8080`; prod mismo origen `https://leadscore.nuncacierro.com` (`/api/*` vía Caddy) | U7 |
| `NODE_ENV` | `ambos` | `development` \| `production` (prod: cookies `Secure`; CORS solo en dev) | U3 |
| `API_PORT` | `apps/api` | `8080` (puerto Fastify; coherente con `NEXT_PUBLIC_API_URL`) | U2 |

Nota: `.env` real es gitignored; `.env.example` (45 líneas) documenta estas claves exactas (U1).

## 12. Testing

- **vitest por unidad** (raíz: `npm test` ejecuta workspaces), mínimo por cada API route nueva.
- `packages/shared`: tests unitarios puros de `evaluateScore` (polarity, weight, threshold, mode, preset 8, inversos).
- `apps/api`: tests de ruta con `fastify.inject`; **test de aislamiento RLS** (sin tenant o tenant ajeno → 0 filas) en U2.
- `apps/web`: tests de componentes mínimos; **Playwright E2E queda para post-MVP**.
- Cada unidad debe dejar su suite verde antes del PR.

## 13. Unidades (Fase A docs → scaffold del usuario → Fase B código)

| Unit | Contenido | Fase |
|------|-----------|------|
| **U1** | Rewrite `docs/SPEC.md` (este doc) + `openspec/config.yaml` + `.env.example` | A (docs) |
| — | **BORDE:** usuario scaffoldea `apps/web` + `apps/api` + raíz workspaces; IA valida estructura | transición |
| **U2** | `0001_init.sql` (9 tablas + RLS FORCE) + schemas zod en shared + `withTenant()` | B |
| **U2b** | Hetzner/Docker/Caddy/GH Actions + DNS → **CAMBIO SEPARADO** (después de U2–U3) | infra |
| **U3** | Auth: login/session/argon2id + guard 401 + seed 1 tenant + 1 usuario | B |
| **U4** | Seed import CSV (parser tolerante) + datos sintéticos `/demo` | B |
| **U5** | Motor de score: CRUD criterios + evaluación rules + preset 8 + `/api/score/*` | B |
| **U6** | Checks auto (HTTP, wa.me, FB) + runner server-side → `analysis_checks` | B |
| **U7** | UI MVP: tabla + dropdown + form criterios + alta negocio + contador por canal | B |
| **U8** | Outreach: saludo frío (sin oferta) + captura outcome + export dataset | B |
| **U9** | Landing `/` + `/demo` + `/api/classify` (rate limit) sobre tenant `demo` | B |

Rollback Fase A: `git reset --hard 5f9ae83`. Cada unidad de Fase B = 1 PR convencional atómico (U2 y U7 pueden partirse en 2 PRs encadenados). ML = change separado cuando exista dataset de outcomes (D9).

## 14. Criterios de éxito

- [ ] `docs/SPEC.md` describe el producto nuevo — **cero** referencias a Kanban / `@dnd-kit` / Supabase / Vercel / tabla `leads`.
- [ ] Estructura monorepo exacta: `apps/web` (solo UI) + `apps/api` (dueño de DB) + `packages/shared` (zod + `evaluateScore`).
- [ ] `0001_init.sql` crea las 9 tablas con `tenant_id NOT NULL` y RLS `FORCE` default-deny; sin booleanos de score por fila de negocio.
- [ ] Test de aislamiento: sin tenant o con tenant ajeno → 0 filas.
- [ ] Seed: ~12 negocios reales importados con sus 8 criterios; `/demo` sirve datos sintéticos sin auth.
- [ ] Cola ordenada por score con dropdown de estado + contador contactados/cerrados/tasa desglosado por canal.
- [ ] Landing en root muestra el sistema por dentro sin autenticación (datos seed, contador, CTA) + `/demo` interactivo.
- [ ] `/api/classify` responde con rate limit (429); rutas CRM devuelven 401 sin sesión.
- [ ] `npm test` (vitest) verde por unidad; cada unidad ≤ 400 líneas cambiadas o partida en sub-PRs.

## 15. Próximo paso

Aprobar U1 → el usuario scaffoldea `apps/web` + `apps/api` + raíz workspaces (§3) → la IA valida la estructura → arranca **U2** (schema + RLS + zod + `withTenant`).
