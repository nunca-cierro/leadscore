# Tasks: Prospección (leadscore)

> Español prosa / identificadores en inglés. Aceptación = 8 deltas (20 requisitos, **34 escenarios GWT** — verificado `grep '^#### Scenario:'` = 34; el brief anunciaba 36 → discrepancia anotada en riesgos). Design §7 binding: `contacted` = `outreach.sent_at` · DELETE criteria se mantiene · dbmate en `db/migrations/` · classify `{business?, signals}` · `new→discarded` directa · `EVO_API_KEY` fuera del MVP. `strict_tdd: false` → test-first por unidad (test antes que su implementación), sin ciclo RED/GREEN formal obligatorio. **U1 (docs) = DONE**; U2b infra = cambio separado (no está aquí).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~5.900 (IA; excluye scaffold del usuario ~2.500) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 13 PRs encadenados + scaffold usuario; 9/13 slices ⚠ >400 (ver tabla) |
| Delivery strategy | ask-always (≈ ask-on-risk) |
| Chain strategy | pending (elegir: stacked-to-main / feature-branch-chain / size-exception) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal (tareas) | Likely PR | Focused test command | Runtime harness | Rollback boundary | Est. |
|------|---------------|-----------|----------------------|-----------------|-------------------|------|
| U0 | Scaffold monorepo (USUARIO) + validación IA | — (usuario) | `npm test` + `npm run typecheck` raíz | `npm run dev` (web+api) | git del usuario | ~2.500 / IA 5 |
| WU1 | 2.1–2.4, 2.8: migración dbmate (tablas+RLS+triggers+seeds) + test RLS | PR1 ⚠ size:exception | `npx dbmate up && npm test -w apps/api -t rls` | DB de test local `dbmate up` | revert `db/migrations/0001_init.sql` | ~710 |
| WU2 | 2.5–2.7, 2.9: withTenant + shared (zod+evaluateScore) + docs-enmienda | PR2 | `npm test -w packages/shared` | N/A (unit puro) | revert `apps/api/src/db/`, `packages/shared/`, `docs/SPEC.md` | ~390 |
| WU3 | 3.1–3.5: auth (login/guard/me/logout/seed) | PR3 ⚠ | `npm test -w apps/api -t auth` | `npm run dev` + `curl -i POST /api/auth/login` | revert `routes/auth.ts`, `plugins/guard.ts`, `db/seed.ts` | ~565 |
| WU4 | 4.1, 4.2, 4.6: alta + GET cola + PATCH :id | PR4 ⚠ | `npm test -w apps/api -t businesses` | `curl POST/GET /api/businesses` | revert `routes/businesses.ts` | ~505 |
| WU5 | 4.3–4.5: parser CSV tolerante + import | PR5 ⚠ | `npm test -w apps/api -t csv` | import fixture sintético (header real 24 cols; CSV real gitignored) | revert `services/csv.ts` | ~450 |
| WU6 | 5.1–5.3: CRUD criterios + evaluate | PR6 ⚠ | `npm test -w apps/api -t score` | `curl POST /api/score/evaluate/:id` | revert `routes/score.ts` | ~435 |
| WU7 | 6.1–6.3: checks runner + historial | PR7 | `npm test -w apps/api -t checks` | `curl POST /api/checks/run/:id` | revert `services/checks.ts`, `routes/checks.ts` | ~365 |
| WU8 | 7.1, 7.2, 7.5: web shell + cola + dropdown | PR8 ⚠ | `npm test -w apps/web` | UI en `npm run dev` con API up | revert `app/crm/cola/`, componentes cola | ~465 |
| WU9 | 7.3, 7.4: forms (alta, criterios) + contador strip (mock) | PR9 ⚠ | `npm test -w apps/web` | UI forms con API up | revert `app/crm/alta/`, `app/crm/criterios/`, strip | ~410 |
| WU10 | 8.1, 8.2: outreach (draft/contacted/outcome) | PR10 ⚠ | `npm test -w apps/api -t outreach` | `curl POST /api/outreach/:id/outcome` | revert `routes/outreach.ts`, `services/drafts.ts` | ~530 |
| WU11 | 8.3, 8.4: /api/metrics/results + wiring strip | PR11 | `npm test -w apps/api -t metrics` | `curl GET /api/metrics/results` | revert `routes/metrics.ts` | ~150 |
| WU12 | 9.1–9.4: rate limit + classify + rutas demo | PR12 ⚠ | `npm test -w apps/api -t demo` | 11× `curl POST /api/classify` → 429 | revert `services/rateLimit.ts`, `routes/classify.ts`, `routes/demo.ts` | ~540 |
| WU13 | 9.5, 9.6: landing `/` + `/demo` + smoke público | PR13 | `npm test -w apps/web && npm test -t smoke` | smoke sin auth (inject) | revert `app/page.tsx`, `app/demo/`, smoke test | ~320 |

### Notas de orden (dependencias reales, binding en apply)

- **evaluateScore vive en U2 (2.7), no U5:** U4 import debe recalcular el score con el preset (`business-intake:doc-columns-score-no-importado`); sin evaluador no hay import. U5 queda = CRUD + ruta evaluate + cola-deriva.
- **GET cola (`GET /api/businesses`) va en U4 (4.2):** `business-intake:alta-formulario-canal` exige "aparece en la cola" en el mismo delta que el alta.
- **Contador strip:** componente + test con fetch mockeado en U7 (7.3/7.4); endpoint real `/api/metrics/results` en U8 (8.3); wiring real 8.4.
- **docs-enmienda = solo 2.9** (SPEC §4 dbmate + §7 DELETE route), bundle en U2 — única tarea docs de la fase de código. Riesgo: design §1.1 dice "enmienda NO en este run" → **RESUELTO en apply WU2 (2026-10-07)**: el orquestador confirmó que la decisión de usuario ratificada en design §7 (2026-10-05, "enmienda SPEC §4 en U2") prevalece sobre la nota §1.1 obsoleta.
- **U2b (Docker/Caddy/GH Actions)** NO está en este plan: es cambio separado post U2–U3 (SPEC §13).

## U0 — Borde: scaffold del usuario (Fase A → Fase B)

- [x] **0.1** (U0 · **OWNER: USER**) Scaffoldear monorepo según SPEC §13 / design §4: `package.json` raíz (workspaces `apps/*`, `packages/*`, scripts dev/build/test/lint/typecheck), `tsconfig.base.json`, `vitest.workspace.ts`, `apps/web` (Next.js App Router), `apps/api` (Fastify + TS, `createApp()` separado de `listen`), `packages/shared`, ESLint flat por paquete, `.env` gitignored. La IA NO edita este scaffold. — Dep: ninguno — ~2.500 líneas (usuario)
- [x] **0.2** (U0 · IA) Validar estructura vs design §4 (árbol, scripts, TS strict, `apps/web` sin import `pg`, `apps/api` sin React, `packages/shared` sin I/O), verificar `.env.example` SIN `EVO_API_KEY` (§7) y con `DEMO_TENANT_ID`/`CLASSIFY_*`, re-evaluar `strict_tdd` en `openspec/config.yaml` con `npm test` raíz operativo. — AC (borde): SPEC §14 "Estructura monorepo exacta" — Dep: 0.1 — ~5 líneas

## U2 — Esquema + migración dbmate + RLS + withTenant + shared + docs

- [x] **2.1** (U2 · test-first) Escribir test de aislamiento en `apps/api/src/db/rls.test.ts`: sin `SET LOCAL app.current_tenant` → 0 filas en las 9 tablas (conexión superuser de test); `withTenant(A)` no ve filas de `B`. — AC: session-auth:rls-sin-tenant, session-auth:tenant-ajeno, demo-and-classify:publica-tenant-null-0 — Dep: 0.2 — ~90 líneas
- [x] **2.2** (U2) Reemplazar ÍNTEGRO `db/migrations/0001_init.sql` (dbmate, raíz): 9 tablas §1.2 con `tenant_id NOT NULL`, FK hijo→padre `ON DELETE CASCADE`, CHECKs (`status`, `source_channel`, `polarity`, `mode`, `result`, `check_type`, `source`), UNIQUE (`outcomes(tenant_id,business_id)`, `score_criteria(tenant_id,key)`, `businesses(tenant_id,external_id)`, `sessions.token_hash`, `users.email`) e índices §1.2; elimina esquema V1 prohibido (tabla `leads`, booleanos por fila, `score` GENERATED, sin RLS). — AC: outreach-outcomes:409-al-cerrar (base UNIQUE), business-intake:source-channel-invalido, prioritized-queue:estado-fuera-enum (**base CHECK en SQL; el mapeo a `400` zod llega en 2.6**) — Dep: 2.1 — ~260 líneas
- [x] **2.3** (U2) En `db/migrations/0001_init.sql`: políticas `p_<tabla>_tenant` (USING+WITH CHECK = expr `T`; `tenants` → `id = T`; `users` → `T OR escape app.auth_email` §1.3), `ENABLE`+`FORCE ROW LEVEL SECURITY` como últimas sentencias (orden CREATE → POLICY → seeds → FORCE §1.4), triggers `set_updated_at` y `enforce_status_transition` con matriz §1.4 (`new→discarded` ✅ directa, `new→client` ❌→409, terminales ❌→409). — AC: session-auth:rls-sin-tenant, session-auth:tenant-ajeno, demo-and-classify:publica-tenant-null-0 — Dep: 2.2 — ~150 líneas
- [x] **2.4** (U2) Seeds SQL en `db/migrations/0001_init.sql` ANTES de `FORCE` (§1.5): tenants `demo` (id literal fijo = `DEMO_TENANT_ID` de `.env.example`) + `nuncacierro`; preset 8 criterios §1.5 ×2 tenants (16 filas: weight=1, enabled=true, positions 0–7); dataset sintético SOLO tenant `demo` (~12 businesses, 1–2 `score_evaluations` rules, ~8 `outreach`, ~5 `outcomes`; 0 filas en `nuncacierro`). — AC: demo-and-classify:demo-sin-sesion (datos base), results-reporting:visitante-demo-contador (contador ≠ 0), configurable-scoring (seed del preset 8) — Dep: 2.3 — ~200 líneas
- [x] **2.5** (U2) `apps/api/src/db/pool.ts` + `apps/api/src/db/withTenant.ts`: pool `pg`; `withTenant(tenantId, fn)` = `BEGIN` → `SET LOCAL app.current_tenant` (uuid validado zod) → `fn(c)` → `COMMIT`/`ROLLBACK` → `release()` (§1.4; sin transacción no hay datos). — AC: soporte session-auth:rls-sin-tenant (escritura) · base de todas las rutas §2 — Dep: 2.2 — ~60 líneas · **WU1 dejó la versión mínima** (`set_config` transaccional + regex uuid como soporte de 2.1); cierre completo con zod en WU2.
- [x] **2.6** (U2) `packages/shared/src/schemas.ts` + `packages/shared/src/enums.ts`: schemas zod (login, business create/patch, score criteria, classify `{business?, signals}` §7, outcome) + enums (`status`, `source_channel`, `polarity`, `mode`) + tipos derivados — fuente única web↔api. — AC: business-intake:source-channel-invalido, prioritized-queue:estado-fuera-enum (capa de validación) — Dep: 0.2 — ~150 líneas
- [x] **2.7** (U2) `packages/shared/src/scoring.ts` + `packages/shared/src/scoring.test.ts`: `evaluateScore()` puro — `value=Σweight(met)`, `max=Σweight(enabled)`, threshold vs señal cruda, `inverse` suma SOLO si la señal NO cumple, `mode=manual` sin dato → `met:false, pending:true`; tests preset 8 sin I/O. — AC: configurable-scoring:evaluate-5-de-8, :threshold-deshabilitado, :manual-sin-dato, :criterio-inverso (nivel unidad) — Dep: 0.2 — ~170 líneas
- [x] **2.8** (U2 · verify) `npx dbmate up` sobre DB de test + correr 2.1 → verde en las 9 tablas con superuser. — AC: session-auth:rls-sin-tenant, session-auth:tenant-ajeno, demo-and-classify:publica-tenant-null-0 — Dep: 2.1–2.5 (**parcial WU1**: `pool`+`withTenant` mínimo implementado como soporte de 2.1; la validación zod de 2.5 queda en WU2 — ver desviación declarada) — ~10 líneas
- [x] **2.9** (U2 · **docs-enmienda**) `docs/SPEC.md`: §4 "migración única … rewrite in-place" → "migraciones versionadas vía dbmate (`new`/`up`/`rollback`); `0001_init.sql` es la primera"; §7 añadir superficie `DELETE /api/score/criteria/:id`. Solo docs (§7 decisiones binding). — Dep: 2.2 — ~10 líneas

## U3 — Auth: login, sesión, guard 401, seed usuario

- [ ] **3.1** (U3 · test-first) Tests auth en `apps/api/src/routes/auth.test.ts` (fastify.inject sobre `createApp()`): login-correcto (201 + `Set-Cookie` con HttpOnly/Secure/SameSite=Lax/Path=/ sin Domain + `/api/auth/me` 200 con `tenant_id`), credenciales-incorrectas (401, 0 sesiones, sin cookie), guard-401-cookie-ausente (401 **sin body de datos**), allowlist-publica (`/api/classify`, `/health` no responden 401 por auth), logout (204; sesión ya revocada → 401). — AC: session-auth:login-correcto, :credenciales-incorrectas, :guard-401-cookie-ausente, :allowlist-publica — Dep: 2.5, 2.6 — ~160 líneas
- [ ] **3.2** (U3) `apps/api/src/services/auth.ts` + `apps/api/src/routes/auth.ts`: argon2id verify; cookie `__Host-ls_session` = `base64url({sid,uid,tid,exp}).hmac-sha256(payload, SESSION_SECRET)`; `sessions.token_hash = sha256(cookie completo)`; `POST /api/auth/login` (BEGIN → `SET LOCAL app.auth_email` → escape §1.3 → verify argon2id → `SET LOCAL app.current_tenant` → INSERT sesión → Set-Cookie), `GET /api/auth/me`, `POST /api/auth/logout` (204 + borra fila sesión + expira cookie), `GET /health` (200 sin DB, §2.9). — AC: session-auth:login-correcto, :credenciales-incorrectas — Dep: 3.1 — ~230 líneas
- [ ] **3.3** (U3) `apps/api/src/plugins/guard.ts` + wiring en `apps/api/src/server.ts`: HMAC en memoria (firma inválida → 401 SIN tocar DB) → BEGIN → `SET LOCAL app.current_tenant` → lookup `sessions` (expirada/revocada → 0 filas → 401 sin body); allowlist pública EXACTA = `/api/classify`, `/api/demo/*`, `/health`. — AC: session-auth:guard-401-cookie-ausente, :allowlist-publica — Dep: 3.2 — ~120 líneas
- [ ] **3.4** (U3) `apps/api/src/db/seed.ts` idempotente de arranque: si 0 filas para `SEED_USER_EMAIL` → INSERT `password_hash = argon2id(SEED_USER_PASSWORD)` dentro de `withTenant(nuncacierro)` (§1.5; una sola cuenta en el MVP). — Dep: 3.2 — ~50 líneas
- [ ] **3.5** (U3 · verify) Suite auth verde: `npm test -w apps/api`. — Dep: 3.1–3.4 — ~5 líneas

## U4 — Intake: alta manual, cola priorizada, import CSV

- [ ] **4.1** (U4 · test-first) Tests en `apps/api/src/routes/businesses.test.ts`: alta-formulario-canal (201, `status='new'`, GET de cola lo contiene), source-channel-invalido (400 zod, 0 negocios creados), orden-score-desc (7,6,4), filtros-combinados (AND vertical+city+status), contactar-nuevo-dropdown (PATCH → 200 y fila refleja `contacted`), estado-fuera-enum (400, conserva anterior), 401 sin sesión, 404 0 filas bajo RLS, 409 `new→client` (trigger). — AC: business-intake:alta-formulario-canal, :source-channel-invalido; prioritized-queue:orden-score-desc, :filtros-combinados, :contactar-nuevo-dropdown, :estado-fuera-enum — Dep: 3.5 — ~220 líneas
- [ ] **4.2** (U4) `apps/api/src/routes/businesses.ts` (+ service): `POST /api/businesses` (201, `source_channel` obligatorio, `external_id` duplicado → 400 con `details`); `GET /api/businesses` (sort=`score|name|created_at` default score, order desc, filtros AND, LEFT JOIN último `score_evaluations` `source='rules'`, `score:0` fallback, `{items,total,page,limit}` 25/100, filtro vacío → `200 items:[]`); `GET/PATCH /api/businesses/:id` (zod 400 → trigger 409 `{error:'transition'}` → 404 0 filas). — AC: server de business-intake:alta-formulario-canal ("aparece en la cola"), :source-channel-invalido; prioritized-queue:orden-score-desc, :filtros-combinados, :contactar-nuevo-dropdown, :estado-fuera-enum — Dep: 4.1 — ~280 líneas
- [ ] **4.3** (U4 · test-first) Tests en `apps/api/src/services/csv.test.ts` con fixture sintético `apps/api/src/__fixtures__/leads-sample.csv` — header EXACTO de 24 columnas del CSV real + ~12 filas con multilínea entre comillas y cols 22–24 (el CSV real `docs/Nuncacierro - leads.csv` está gitignored; import del archivo real = smoke manual del usuario): import-csv-real (~12 negocios, filas multilínea entre comillas, `invalid_rows` sin abortar el lote), doc-columns-score-no-importado (cols 22–24 descartadas sin error, `Score` NO persiste → score proviene del preset). — AC: business-intake:import-csv-real, :doc-columns-score-no-importado — Dep: 4.2, 2.7 — ~130 líneas
- [ ] **4.4** (U4) `apps/api/src/services/csv.ts`: parser tolerante 24 columnas; mapeo §1.2.1 (`Id`→`external_id`, `Nombre`→`name`, `Estado`→enum, `Fecha de contacto`→INSERT `outreach` con `sent_at` (canal inferido), cols 12–19 → desglose `criteria` met, 21–24 descartadas); fila dup/malformada → `invalid_rows` y el lote CONTINÚA; `Score` NO importado → `evaluateScore(preset)` → INSERT `score_evaluations` (`source='rules'`). — AC: business-intake:import-csv-real, :doc-columns-score-no-importado — Dep: 4.3 — ~250 líneas
- [ ] **4.5** (U4) `POST /api/businesses/import` en `apps/api/src/routes/businesses.ts` (multipart/form-data, CSV UTF-8): `201 {created, duplicates, invalid_rows:[{row,error}]}`; `400` parser falla o 0 filas válidas; `401` sin sesión. — AC: business-intake:import-csv-real (ruta) — Dep: 4.4 — ~70 líneas
- [ ] **4.6** (U4 · verify) Suite intake+cola verde: `npm test -w apps/api`. — Dep: 4.1–4.5 — ~5 líneas

## U5 — Motor de score: CRUD criterios + evaluate + cola-deriva

- [ ] **5.1** (U5 · test-first) Tests en `apps/api/src/routes/score.test.ts`: CRUD criterios (201; 400 `weight<=0` / `polarity`/`mode` fuera de enum / `key` duplicada con `details`; 404), `POST /evaluate` 200 + INSERT append, cola-deriva-ultima-rules (con evaluaciones múltiples la cola usa el último `value` con `source='rules'`), 401 sin sesión. — AC: configurable-scoring:cola-deriva-ultima-rules (+ códigos CRUD §2.4) — Dep: 4.6 — ~170 líneas
- [ ] **5.2** (U5) `apps/api/src/routes/score.ts`: `GET/POST /api/score/criteria` (orden `position`), `PATCH/DELETE /api/score/criteria/:id` (204; evaluaciones previas conservan snapshot `criteria` jsonb, sin FK), `POST /api/score/evaluate/:businessId` (señales `mode=manual` del caller + check más reciente de `analysis_checks` para `mode=auto` → `evaluateScore()` → `200 {value,max,breakdown}` + INSERT append no idempotente). — AC: configurable-scoring:evaluate-5-de-8 (HTTP 200 `value=5,max=8`), :threshold-deshabilitado, :manual-sin-dato, :criterio-inverso, :cola-deriva-ultima-rules — Dep: 5.1, 2.7 — ~260 líneas
- [ ] **5.3** (U5 · verify) Suite scoring verde: `npm test -w apps/api` + `npm test -w packages/shared`. — Dep: 5.1, 5.2 — ~5 líneas

## U6 — Checks de presencia digital

- [ ] **6.1** (U6 · test-first) Tests en `apps/api/src/routes/checks.test.ts`: check-sitio-fallido (negocio sin web → fila `http_site` con `result.ok=false` + `checked_at` en 200), negocio-inexistente-404 (0 filas → 404 y **0 escrituras**), re-ejecucion-append (registros NUEVOS con `checked_at` actualizado, 0 sobrescrituras), fallo externo (timeout/5xx/DNS) = dato `ok:false` en 200, nunca error HTTP. — AC: digital-presence-checks:check-sitio-fallido, :negocio-inexistente-404, :re-ejecucion-append — Dep: 5.3 — ~130 líneas
- [ ] **6.2** (U6) `apps/api/src/services/checks.ts` + `apps/api/src/routes/checks.ts`: runner server-side (fetch HTTP del sitio con timeout, detección `wa.me`, Facebook) → INSERT append `analysis_checks` (`check_type`, `result` jsonb, `checked_at`); `GET /api/checks/:businessId` (historial completo `checked_at DESC`), `POST /api/checks/run/:businessId` (200 `{checks:[...]}`). — AC: digital-presence-checks:check-sitio-fallido, :re-ejecucion-append, :negocio-inexistente-404; señales `mode=auto` (p.ej. `no_website`) alimentan 5.2 — Dep: 6.1 — ~230 líneas
- [ ] **6.3** (U6 · verify) Suite checks verde + re-evaluate de un negocio con checks (señal auto entra al breakdown): `npm test -w apps/api`. — AC: digital-presence-checks (3 escenarios) + configurable-scoring:criterio-inverso (vía check auto) — Dep: 6.1, 6.2 — ~5 líneas

## U7 — Frontend MVP (CRM): tabla, dropdown, forms, contador (2 PRs)

- [ ] **7.1** (U7 · test-first) Tests de componentes en `apps/web` (fetch mockeado, vitest): tabla ordenada (7,6,4 sin drag&drop), dropdown de estado (PATCH 200 → refleja nuevo estado; 400 → conserva el anterior en UI; 409 → mensaje de conflicto), todo con `fetch(url, {credentials:'include'})`. — AC: prioritized-queue:orden-score-desc (UI), :contactar-nuevo-dropdown (UI), :estado-fuera-enum (UI conserva) — Dep: 6.3 — ~160 líneas
- [ ] **7.2** (U7) Shell App Router en `apps/web/app/`: `layout.tsx`, `/crm/cola/page.tsx` (tabla única + filtros vertical/ciudad/estado + dropdown que persiste PATCH), `next.config.ts` con rewrite dev `/api/*` → `http://localhost:8080` (§5.2). — AC: prioritized-queue:orden-score-desc (UI), :filtros-combinados (UI), :contactar-nuevo-dropdown (UI) — Dep: 7.1 — ~300 líneas
- [ ] **7.3** (U7 · test-first) Tests de forms/contador con fetch mockeado en `apps/web`: alta de negocio (`source_channel` obligatorio → muestra 400 zod sin crear), form de criterios (CRUD), contador strip (renderiza contactados·cerrados·tasa + `by_channel[]` desde respuesta simulada). — AC: business-intake:alta-formulario-canal (UI), results-reporting:by-channel-desglose (UI strip) — Dep: 7.2 — ~130 líneas
- [ ] **7.4** (U7) `apps/web/app/crm/alta/page.tsx` (form alta con canal de origen), `apps/web/app/crm/criterios/page.tsx` (form CRUD de criterios), componente contador strip (fetch a `/api/metrics/results`, dato real llega en 8.3). — AC: business-intake:alta-formulario-canal (UI), configuración de criterios (superficie CRUD) — Dep: 7.3 — ~280 líneas
- [ ] **7.5** (U7 · verify) Suite web verde: `npm test -w apps/web` + `npm run typecheck`. — Dep: 7.1–7.4 — ~5 líneas

## U8 — Outreach, outcomes y métricas (2 PRs)

- [ ] **8.1** (U8 · test-first) Tests en `apps/api/src/routes/outreach.test.ts` + `apps/api/src/routes/metrics.test.ts`: draft-sin-oferta (200, saludo frío sin propuesta), draft-oferta-422 (precio/descuento/promoción → 422 y NO se persiste), outcome-cliente (201 → estado `client`, fila en `outcomes`, cerrados +1), 409-al-cerrar (segundo outcome → 409, `outcomes` conserva el original), contacted idempotente (200) y estado terminal → 409, tasa-conversion (10 contactados/3 cerrados → `rate=0.3`), sin-contactados-rate-0 (`contacted=0`, `closed=0`, `rate=0` sin división por cero), by-channel-desglose (5 canales + subtotal `total`), 401 sin sesión. — AC: outreach-outcomes:draft-sin-oferta, :draft-oferta-422, :outcome-cliente, :409-al-cerrar; results-reporting:tasa-conversion, :sin-contactados-rate-0, :by-channel-desglose — Dep: 7.5 — ~250 líneas
- [ ] **8.2** (U8) `apps/api/src/services/drafts.ts` + `apps/api/src/routes/outreach.ts`: plantillas deterministas de saludo frío SIN oferta (§7: `EVO_API_KEY` fuera del MVP) + validador de oferta → 422 antes del INSERT; `GET /api/outreach?businessId=`, `POST /:businessId/draft`, `POST /:businessId/contacted` (INSERT `outreach.sent_at=now()` + `status→contacted`; solo terminales dan 409), `POST /:businessId/outcome` (UNA transacción: INSERT `outcomes` → UPDATE `businesses`; 409 → ROLLBACK total, nunca cierre a medias). — AC: outreach-outcomes (4 escenarios) — Dep: 8.1 — ~280 líneas
- [ ] **8.3** (U8) `apps/api/src/routes/metrics.ts`: `GET /api/metrics/results` — agregados SQL en request (D12): `contacted = COUNT(outreach WHERE sent_at IS NOT NULL)` (§7 decisión binding), `closed = COUNT(outcomes)`, `rate = contacted>0 ? closed/contacted : 0`, `by_channel` agrupado por `businesses.source_channel` (5 canales + `total`); `401` sin sesión. — AC: results-reporting:tasa-conversion, :sin-contactados-rate-0, :by-channel-desglose — Dep: 8.2 — ~90 líneas
- [ ] **8.4** (U8 · wiring + verify) Contador strip real en `/crm/cola` consume `/api/metrics/results`; suite verde `npm test -w apps/api` + `npm test -w apps/web`. — Dep: 8.3, 7.4 — ~60 líneas

## U9 — Demo, classify, reportes públicos, rate limit (2 PRs)

- [ ] **9.1** (U9 · test-first) Tests en `apps/api/src/routes/demo.test.ts` + `apps/api/src/routes/classify.test.ts`: demo-sin-sesion (sin cookie → cola + criterios + contador solo tenant `demo`), rate-limit-429 (10 primeras 200, 11ª → 429 con `Retry-After`), publica-tenant-null-0 (query con tenant NULL → 0 filas bajo FORCE), demo-solo-tenant-demo (0 filas de `nuncacierro` en `/api/demo/queue`), visitante-demo-contador (mismo shape de métricas sobre `demo`), classify 200/400 zod, smoke CRM sin cookie → 401. — AC: demo-and-classify:demo-sin-sesion, :rate-limit-429, :publica-tenant-null-0, :demo-solo-tenant-demo; results-reporting:visitante-demo-contador — Dep: 8.4 — ~220 líneas
- [ ] **9.2** (U9) `apps/api/src/services/rateLimit.ts`: fixed window por IP en memoria (`CLASSIFY_RATE_LIMIT=10`, `CLASSIFY_RATE_WINDOW=60000`), bucket COMPARTIDO por rutas públicas (`/api/classify` + `/api/demo/*`), 429 con `Retry-After` = segundos restantes, sin persistencia (se vacía al reiniciar). — AC: demo-and-classify:rate-limit-429 — Dep: 9.1 — ~80 líneas
- [ ] **9.3** (U9) `apps/api/src/routes/classify.ts`: `POST /api/classify` — body `{business?, signals}` (§7 binding), zod 400 (clave desconocida o tipo inválido), `withTenant(DEMO_TENANT_ID)` → criterios del tenant `demo` → `evaluateScore()` puro **sin escritura**, `200 {value,max,breakdown}`. — AC: demo-and-classify (classify 200/400 + rate limit), reuso configurable-scoring — Dep: 9.2, 2.7 — ~110 líneas
- [ ] **9.4** (U9) `apps/api/src/routes/demo.ts`: `GET /api/demo/queue` (cola sintética `demo` con score, mismos query params que §2.3), `GET /api/demo/criteria` (criterios activables), `GET /api/demo/metrics` (contador mismo shape §2.7 sobre tenant `demo`) — todos con `withTenant(DEMO_TENANT_ID)` + rate limit compartido. **Inferido:** §2.8 enumera sólo `queue`+`classify`, pero el GWT demo-sin-sesion exige cola+criterios+contador (§2.7 "el contador del /demo consumen esta misma respuesta"). — AC: demo-and-classify:demo-sin-sesion, :demo-solo-tenant-demo, :publica-tenant-null-0; results-reporting:visitante-demo-contador — Dep: 9.3 — ~130 líneas
- [ ] **9.5** (U9) Frontend público en `apps/web/app/page.tsx` (landing `/`: sistema por dentro con datos seed + contador + CTA, sin auth) y `apps/web/app/demo/page.tsx` (`/demo`: cola + criterios + contador sobre tenant `demo`, sin auth). — AC: demo-and-classify:demo-sin-sesion (UI), results-reporting:visitante-demo-contador (UI) — Dep: 9.4 — ~260 líneas
- [ ] **9.6** (U9 · verify) Smoke público con fastify.inject (sin Playwright, SPEC §12): `/api/demo/queue` → 200 solo datos `demo`, `/api/classify` ×11 → 429, CRM sin cookie → 401, `/health` → 200; suites raíz verdes `npm test`. — AC: cierre demo-and-classify (4 escenarios) + smoke SPEC §14 — Dep: 9.5 — ~60 líneas

## Coverage checklist — 34 escenarios GWT → tareas

| # | Escenario (delta) | Tareas |
|---|-------------------|--------|
| 1 | business-intake:alta-formulario-canal | 4.1, 4.2, 7.3, 7.4 |
| 2 | business-intake:source-channel-invalido | 2.6, 4.1, 4.2 |
| 3 | business-intake:import-csv-real | 4.3, 4.4, 4.5 |
| 4 | business-intake:doc-columns-score-no-importado | 4.3, 4.4 |
| 5 | session-auth:login-correcto | 3.1, 3.2 |
| 6 | session-auth:credenciales-incorrectas | 3.1, 3.2 |
| 7 | session-auth:guard-401-cookie-ausente | 3.1, 3.3 |
| 8 | session-auth:allowlist-publica | 3.1, 3.3 |
| 9 | session-auth:rls-sin-tenant | 2.1, 2.3, 2.8 |
| 10 | session-auth:tenant-ajeno | 2.1, 2.3, 2.8 |
| 11 | configurable-scoring:evaluate-5-de-8 | 2.7, 5.1, 5.2 |
| 12 | configurable-scoring:cola-deriva-ultima-rules | 4.2, 5.1, 5.2 |
| 13 | configurable-scoring:threshold-deshabilitado | 2.7, 5.1, 5.2 |
| 14 | configurable-scoring:manual-sin-dato | 2.7, 5.1, 5.2 |
| 15 | configurable-scoring:criterio-inverso | 2.7, 5.1, 5.2, 6.3 |
| 16 | demo-and-classify:demo-sin-sesion | 2.4, 9.1, 9.4, 9.5 |
| 17 | demo-and-classify:rate-limit-429 | 9.1, 9.2 |
| 18 | demo-and-classify:publica-tenant-null-0 | 2.1, 2.3, 9.1 |
| 19 | demo-and-classify:demo-solo-tenant-demo | 2.1, 9.1, 9.4 |
| 20 | prioritized-queue:orden-score-desc | 4.1, 4.2, 7.1, 7.2 |
| 21 | prioritized-queue:filtros-combinados | 4.1, 4.2, 7.2 |
| 22 | prioritized-queue:contactar-nuevo-dropdown | 4.1, 4.2, 7.1, 7.2 |
| 23 | prioritized-queue:estado-fuera-enum | 2.6, 4.1, 4.2, 7.1 |
| 24 | digital-presence-checks:check-sitio-fallido | 6.1, 6.2 |
| 25 | digital-presence-checks:negocio-inexistente-404 | 6.1, 6.2 |
| 26 | digital-presence-checks:re-ejecucion-append | 6.1, 6.2 |
| 27 | outreach-outcomes:draft-sin-oferta | 8.1, 8.2 |
| 28 | outreach-outcomes:draft-oferta-422 | 8.1, 8.2 |
| 29 | outreach-outcomes:outcome-cliente | 8.1, 8.2 |
| 30 | outreach-outcomes:409-al-cerrar | 2.2 (UNIQUE), 8.1, 8.2 |
| 31 | results-reporting:tasa-conversion | 8.1, 8.3 |
| 32 | results-reporting:sin-contactados-rate-0 | 8.1, 8.3 |
| 33 | results-reporting:by-channel-desglose | 7.3, 8.1, 8.3 |
| 34 | results-reporting:visitante-demo-contador | 2.4, 9.1, 9.4, 9.5 |

**Totals:** 43 tareas (U0:2, U2:9, U3:5, U4:6, U5:3, U6:3, U7:5, U8:4, U9:6) · 20/20 requisitos · 34/34 escenarios cubiertos · 1 sola docs-enmienda (2.9) · 1 tarea user-owned (0.1).

