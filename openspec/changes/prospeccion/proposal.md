# Proposal: prospeccion — motor de prospección y calificación NuncaCierro

## Intent

Reemplazar el producto viejo (CRM Kanban pasivo, especs obsoletos en `docs/SPEC.md` y `openspec/config.yaml`) por **leadscore = motor de prospección y calificación de negocios para vender servicios de NuncaCierro**: entrada manual de negocios → checks de presencia digital → score configurable → cola priorizada → outreach manual con asistencia de redacción → outcome (cliente sí/no) → dataset → (futuro) re-ranking ML híbrido.

El repo está en Fase 0 a medias (scaffold Next committeado, 0 tests, 0 código de dominio, 0 infra). Evidencia del insight de producto: en la CSV real, el 8/8 está marcado `Descartado` → el score mide **fit, no conversión**; los outcomes son la ruta de calibración.

Diseñado como producto **multi-tenant-ready**: el MVP corre con un solo usuario y un solo tenant (el tuyo), pero el modelo de datos, la auth y la capa de acceso a datos ya llevan aislamiento por tenant + RLS desde U2. Prioridad explícita (D15): **negocio primero** — el propósito principal es conseguir leads y clientes para NuncaCierro; el portfolio es un beneficio colateral; la escala/SaaS es una opción futura, no un requisito del MVP. Estrategia de producto: (1) MVP personal → validar que funciona; (2) mostrar resultados reales (contador de outcomes) → argumento de venta; (3) ofrecer a clientes sobre un schema que ya escala. Doble uso: herramienta interna de NuncaCierro **y** pieza de portfolio con estándar de seguridad alto.

## Decisions record (confirmadas — no re-litigar)

> **Revisión 2026-10-05:** D5 reescrita (single-user → multi-tenant-ready + RLS en MVP); nuevas D11 (tenancy + RLS), D12 (contador de resultados), D13 (stack + monorepo), D14 (source_channel, por research web), D15 (prioridad de negocio) y D16 (landing+demo en root = escaparate de venta); D8 reescrita (front ya borrado por IA; scaffold = front+back separados).

| #   | Decisión                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | UI MVP = tabla ordenada por score + dropdown de estado. NO Kanban/drag&drop/@dnd-kit en MVP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D2  | Score = tabla de criterios configurable (id, label, polarity, weight, threshold, mode auto/manual, enabled). Preset = 8 criterios Excel: >2 sedes · >4.5 estrellas · >500 followers IG · post constante · sin sitio web (INVERSO) · sin rta WhatsApp (INVERSO) · catálogo · team.                                                                                                                                                                                                                                                                                                                                    |
| D3  | Auto checks MVP: HTTP de sitio, detección wa.me, presencia Facebook. Manual: IG followers/posts, team, catálogo, seeds. Sin automatización de riesgo ToS (no cold WhatsApp automation, no scraping IG).                                                                                                                                                                                                                                                                                                                                                                                                              |
| D4  | Seed: CSV real del usuario (~12 filas, restaurantes/estéticas, columnas: Id, Nombre, Vertical, Ciudad, Score `n/8`, WhatsApp, Instagram, Correo, Estado, Fechas, 8 criterios TRUE/FALSE, Notes) + datos sintéticos para `/demo` público. Flujos de captura documentados en SPEC: manual (Maps/IG → form) y **scraper externo → CSV → import** (Outscraper como ejemplo, mapeo de columnas).                                                                                                                                                                                                                          |
| D5  | Visibilidad Opción A: `/demo` público (sintético) + `/api/classify` público con rate limit, ambos **bindeados a un tenant `demo` reservado**; CRM real tras auth Fase 1 (cookie httpOnly + argon2id, tablas `users` + `tenants`, **una sola cuenta activa** en el MVP). Aislamiento por tenant vía D11. _(Revisada 2026-10-05.)_                                                                                                                                                                                                                                                                                     |
| D6  | `docs/SPEC.md` = single source of truth (rewrite en fase de docs, NO ahora); `openspec/` = config + artefactos de cambio.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D7  | `0001_init.sql` reescrito IN-PLACE (BD Supabase vieja borrada, nunca hubo DB self-hosted — confirmado). Modelo candidato: `businesses`, `analysis_checks`, `score_criteria`, `score_evaluations` (rules/ml/hybrid), `outreach`/`outcomes` — refinar, no copiar a ciegas.                                                                                                                                                                                                                                                                                                                                             |
| D8  | La IA borró el front viejo (2026-10-05); el usuario scaffoldea A MANO los proyectos `apps/web` (Next) y `apps/api` (Fastify) con npm workspaces tras aprobar los docs; la IA modifica después. Rollback = `5f9ae83`. El plan sitúa este límite explícitamente entre unidades doc y unidades de código.                                                                                                                                                                                                                                                                                                               |
| D9  | ML = slice futuro (ONNX runtime en contenedor Next, entrenamiento PyTorch local) — FUERA de las unidades de MVP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D10 | U2b (Hetzner, DNS pendiente) sobrevive al wipe; se secuencia DESPUÉS del scaffold nuevo. Ver recomendación en U8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D11 | **Tenancy + RLS desde el schema (nuevo 2026-10-05):** tabla `tenants`; `tenant_id NOT NULL` en todas las tablas de dominio; políticas RLS con `FORCE ROW LEVEL SECURITY` aplicadas **dentro de `0001_init.sql`**; toda query pasa por un helper central `withTenant()` (transacción + `SET LOCAL app.current_tenant`), política **default-deny** cuando el tenant es NULL. Justificación: los endpoints públicos (`/demo`, `/api/classify`) tocan DB sin sesión → RLS es la red de seguridad que impide que un bug en una ruta pública lea datos reales. Invites, multiusuario con UI de equipos y billing = fase 2. |
| D12 | **Contador de resultados en MVP (nuevo 2026-10-05):** tira de métricas en la cola — contactados / clientes cerrados / tasa — derivada de `outcomes`. Es el argumento de venta ("mira cuántos conseguí") y hace que el demo demuestre valor, no solo interfaz.                                                                                                                                                                                                                                                                                                                                                        |
| D13 | **Stack y estructura (nuevo 2026-10-05):** back = **Node + Fastify + TypeScript**; front = **Next.js**; monorepo **npm workspaces** con `apps/web` (solo UI, nunca toca la DB), `apps/api` (dueño único de DB, auth, negocio) y `packages/shared` (schemas zod + lógica pura compartida). El usuario scaffoldea los proyectos y revisa cómo crearlos; los docs definen la estructura objetivo. Descartados Go y .NET: no comparten tipos con el front, no encajan con el perfil AI Engineer ni con la ruta ML (ONNX runtime Node).                                                                                   |
| D14 | **`source_channel` + desglose por canal (nuevo 2026-10-05, por research web):** columna `source_channel` en `businesses` (referido / partner / maps-csv / inbound / ads) y el contador de resultados (D12) desglosa conversiones por canal. Motivación: la encuesta Promethean (91 agencias) pone los **referidos como canal #1** y el producto no mediría de dónde viene cada cliente. Además el flujo de captura documenta «scraper externo → CSV → import» (Outscraper: pay-as-you-go, ~USD 3/1k, primeros 500 gratis) — el import CSV existente es la costura universal.                                         |
| D15 | **Prioridad de producto (nuevo 2026-10-05, decisión del usuario):** este NO es un proyecto de diversión — es **herramienta de negocio para conseguir leads/clients para NuncaCierro**. Orden de prioridad: (1) negocio NC, (2) portfolio como beneficio colateral, (3) escala/SaaS como opción futura. Rige los tradeoffs: MVP rápido y validable > arquitectura aspiracional; los seams de escala (tenancy, RLS, source_channel) ya están puestos sin construir la plataforma. |
| D16 | **Topología de URLs y demo de venta (revisada 2026-10-05 — opción D, por límite de Universal SSL):** UN solo hostname `leadscore.nuncacierro.com` (registro único **PROXIED** en Cloudflare ✅) sirve TODO vía path routing en Caddy: `/` landing pública + `/demo` interactivo **SIN autenticación** (sistema por dentro: cola, criterios activables, contador, CTA, datos seed), `/crm/*` = CRM tras auth, `/api/*` → reverse_proxy al contenedor Fastify. Motivo del cambio: Universal SSL free solo cubre subdominios de **un** nivel → `app.leadscore.*` anidado rompería HTTPS; single-origin elimina CORS en prod (solo dev lo necesita), cookies `__Host-` host-only perfectas, IP del origen oculta tras CF. |

## Scope

### In Scope

- Reescritura de docs: `docs/SPEC.md` (producto nuevo) y `openspec/config.yaml` (context/rules/testin­g obsoletos).
- Estructura monorepo (D13): `apps/web` (Next), `apps/api` (Fastify), `packages/shared` (schemas zod + lógica pura) con npm workspaces — la crea el usuario; los docs definen la estructura objetivo.
- Modelo de datos `apps/api/db/migrations/0001_init.sql` (rewrite in-place, vive en el back) + schemas zod en `packages/shared`.
- Auth multi-tenant-ready: tablas `users` + `tenants` + `sessions` (login/session/argon2id, middleware 401), **una sola cuenta activa** en el MVP (D5).
- Aislamiento por tenant: `tenant_id NOT NULL` en todas las tablas de dominio, helper central `withTenant()` y políticas RLS `FORCE` en `0001_init.sql` (D11).
- Contador de resultados en la cola: contactados / cerrados / tasa (D12).
- Seed: import de la CSV real (12 filas) + datos sintéticos para `/demo`.
- Flujo de captura documentado (U1): manual (Maps/IG → form) y «scraper externo → CSV → import» (Outscraper como referencia) con mapeo de columnas.
- Campo `source_channel` (referido/partner/maps-csv/inbound/ads) + desglose del contador de resultados por canal (D14).
- Motor de score configurable (criterios CRUD + evaluación rules con polarity/weight/threshold/mode).
- Checks de presencia digital: HTTP site, wa.me, Facebook (runner server-side).
- Cola priorizada: tabla ordenada por score + dropdown de estado + edición manual de criterios.
- Asistencia de redacción de outreach (saludo frío, SIN oferta; EvoAPI es service-delivery, no cold prospecting) + captura de outcomes.
- Ruta pública: landing de venta en root (`/`) + `/demo` interactivo + `/api/classify` con rate limiting (D16).
- Infra de testing mínima (vitest en unidades de código; playwright queda para fase posterior).
- Forecast de review por unidad con límite de 400 líneas.

### Out of Scope

- Reescritura de SPEC/config en esta fase propose (solo se propone; ejecuta en unidad de docs).
- Ediciones de código, migración o SPEC en esta fase (read-only).
- ML: PyTorch/ONNX, `ml_score`, re-ranking híbrido → slice futuro (D9).
- Kanban/drag&drop/@dnd-kit → iteración posterior al MVP.
- Multiusuario con invites/UI de equipos, billing, white-label, Prisma, Redux/Zustand, Supabase, Vercel (prohibido). RLS y tenancy NO están prohibidos: son D11.
- Automatización de riesgo ToS: cold WhatsApp automation, scraping de Instagram.
- Import del Google Sheet viejo (la CSV ya es el export real; no hay Sheet que migrar).
- U2b como parte obligatoria de este cambio → ver U8 (recomendación: cambio separado).
- Playwright E2E y CI completo (llegan tras el MVP; ver riesgos).

## Capabilities

> `openspec/specs/` no existe todavía (primer cambio del proyecto) → todo es NEW.

### New Capabilities

- `business-intake`: alta/edición manual de negocios (nombre, vertical, ciudad, canales), `source_channel` y import de CSV semilla o export de scraper con mapeo de columnas.
- `digital-presence-checks`: checks auto (HTTP, wa.me, Facebook) + checks manuales registrados, con `checked_at`/payload.
- `configurable-scoring`: tabla de criterios (polarity/weight/threshold/mode/enabled), preset de 8, evaluación `rules_score`.
- `prioritized-queue`: tabla UI ordenada por score, dropdown de estado, filtros (vertical/ciudad/estado).
- `outreach-outcomes`: asistencia de saludo frío (sin oferta), registro de contacto y outcome cliente sí/no → dataset.
- `demo-and-classify`: landing de venta en root + `/demo` público con datos sintéticos + `/api/classify` público rate-limited — todo sin autenticación (D16).
- `session-auth`: login httpOnly + argon2id sobre `users`, sesiones con `tenant_id`, guard 401 y aislamiento por tenant (RLS) — una sola cuenta activa en el MVP.
- `results-reporting`: métricas de conversión (contactados / cerrados / tasa) derivadas de `outcomes`, con desglose por `source_channel`, visibles en la cola y como prueba en el demo.

### Modified Capabilities

- None (sin specs existentes).

## Approach

Fase doc → **scaffold del usuario** → fase código. Monorepo npm workspaces con dos aplicaciones separadas (D13): `apps/web` (Next.js, **solo UI — nunca toca la DB**) y `apps/api` (Fastify + TypeScript, **dueño único** de DB, auth y lógica de negocio). Schemas zod y lógica pura (motor de score) viven en `packages/shared` y los consume ambos lados. Acceso a datos SOLO en el back vía helper central `withTenant()`, zod en cada frontera, datos de score SIEMPRE derivados de `score_criteria` (nunca columnas booleanas hardcodeadas — fallo del schema viejo). Los outcomes alimentan el dataset futuro sin diseñar ML ahora (tablas ya prevén columna `source` rules/ml/hybrid).

### Staged units (límite wipe/scaffold explícito)

**FASE A — Docs (IA escribe, usuario aprueba). Rollback: `5f9ae83`.**

| Unit | Contenido                                                                                                                                                                          | Artefactos                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| U0   | Propuesta (este artefacto) + Engram                                                                                                                                                | `openspec/changes/prospeccion/proposal.md` |
| U1   | Rewrite `docs/SPEC.md` (flujo, captura manual + scraper→CSV, modelo, API nueva, UI tabla, §7 env, fases) + refresh `openspec/config.yaml` (context/rules/testing) + `.env.example` | docs only                                  |

**BORDE DE WIPE/SCAFFOLD:** ✅ **WIPE HECHO (2026-10-05, lo ejecutó la IA):** `app/`, `public/`, `.next/`, `node_modules/` y el scaffold Next de raíz (`package.json`, `tsconfig*`, `next.config.ts`, `eslint`, `postcss`, `.env.local` con claves Supabase muertas) eliminados — rollback `git checkout 5f9ae83`. **PENDIENTE (usuario, manual):** scaffoldear `apps/web` (Next) + `apps/api` (Fastify) + raíz con npm workspaces según la estructura que define el SPEC (U1), e instalar dependencias. **Toda unidad de abajo asume ese scaffold existente.**

**FASE B — Código (IA modifica sobre scaffold nuevo; tests por unidad con vitest):**

| Unit | Contenido                                                                                                                                                                                                                                                                 | Depende de |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| U2   | `apps/api/db/migrations/0001_init.sql` rewrite in-place (tenants, users, sessions, businesses [+`source_channel`], analysis_checks, score_criteria, score_evaluations, outreach, outcomes + RLS FORCE y policies) + `packages/shared` schemas zod + helper `withTenant()` | scaffold   |
| U3   | Auth: login/session/argon2id sobre users/sessions (sesión con `tenant_id`) + guard 401 + seed de 1 tenant y 1 usuario                                                                                                                                                     | U2         |
| U4   | Seed import (CSV real o export de scraper → tablas; parser tolerante + mapeo de columnas) + datos sintéticos `/demo`                                                                                                                                                      | U2         |
| U5   | Motor de score: CRUD criterios + evaluación rules + preset 8 + API `/api/score/*`                                                                                                                                                                                         | U2         |
| U6   | Checks auto (HTTP, wa.me, FB) + runner server-side + escritura en `analysis_checks`                                                                                                                                                                                       | U2, U5     |
| U7   | UI MVP (`apps/web`): tabla ordenada por score + dropdown estado + form manual de criterios + alta de negocio (con `source_channel`) + contador de resultados con desglose por canal (D12/D14)                                                                             | U3, U5     |
| U8   | Outreach: asistencia saludo frío (sin oferta) + captura outcome + export dataset                                                                                                                                                                                          | U3, U5     |
| U9   | Público (`apps/web`): landing de venta en root + `/demo` interactivo con motor en acción y `/api/classify` (`apps/api`) rate-limited — todo bindeado al tenant `demo` reservado, sin auth                                          | U4, U5, U6 |

**U2b (Hetzner/Docker/Caddy/GH Actions): recomendación = CAMBIO SEPARADO.** Rationale: (a) es infraestructural, no de dominio — reviewer distinto y presupuesto distinto; (b) el Dockerfile debe apuntar al scaffold NUEJO y a binarios nativos (argon2id ya en U3, onnxruntime futuro D9) → solo tiene sentido tras U2–U3 estables; (iii) DNS lo pende el usuario → bloqueo externo no debería frenar este cambio. Absorber solo si el usuario quiere deploy único al final.

**Slice futuro (NO unidades de MVP):** ONNX runtime en contenedor, `ml_score`, ranking híbrido `rules ⊕ ml_score` — change separado cuando haya dataset de outcomes.

## Affected Areas

| Área                                       | Impacto                      | Descripción                                                      |
| ------------------------------------------ | ---------------------------- | ---------------------------------------------------------------- |
| `docs/SPEC.md`                             | Rewritten (U1)               | Producto nuevo; single source of truth                           |
| `openspec/config.yaml`                     | Modified (U1)                | context/rules/testing del producto viejo → nuevos                |
| `db/migrations/0001_init.sql`              | Rewritten (U2)               | 9 tablas + RLS (FORCE); ubicación final `apps/api/db/migrations` |
| `app/`, `public/*.svg`, scaffold Next raíz | Removed (wipe IA 2026-10-05) | Scaffold viejo eliminado; rollback `5f9ae83`                     |
| `packages/shared/*`                        | New (U2)                     | Schemas zod + lógica pura compartida web↔api                     |
| `apps/api/src/*`                           | New (U2–U9)                  | Dominio: motor, checks, auth, API routes                         |
| `apps/web/app/*`                           | New (U7–U9)                  | Tabla cola, formularios, demo                                    |
| `.env.local`                               | Removed (wipe)               | Supabase muerto eliminado; `.env.example` nuevo                  |
| `Dockerfile`/compose/Caddy/Actions         | New (U2b, cambio separado)   | Deploy Hetzner                                                   |

## Risks

| Riesgo                                                                  | Prob. | Mitigación                                                                                                                 |
| ----------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| SPEC/config viejos se leen como autoridad → se re-propone el CRM Kanban | Alta  | Definición de producto en este artefacto OVERRIDE; U1 los reescribe antes de cualquier código                              |
| Scope creep de ML rompe budget 400 líneas                               | Alta  | D9: ML fuera de unidades; `score_evaluations` solo previene columna `source`                                               |
| Forecast total ≫ 400 líneas                                             | Alta  | Cadenas de PRs por unidad; ver forecast abajo; `ask-always` → decisión del usuario antes de apply                          |
| 0001 ya aplicada en BD real                                             | Baja  | Confirmado: nunca hubo DB self-hosted; rewrite in-place seguro; rollback git                                               |
| `.env.local` stale contamina scaffold nuevo                             | Baja  | Ya eliminado en el wipe (IA); `.env.example` documenta vars                                                                |
| Scaffold del usuario no coincide con la estructura del SPEC → rework    | Media | U1 documenta estructura exacta de workspaces + comandos; IA valida el scaffold antes de U2                                 |
| CORS/cookies rotas (401 fantasma)                    | Baja  | Opción D: prod = mismo origen por path routing (**cero CORS**); CORS solo en dev (allowlist localhost + credentials true); cookies `__Host-` host-only; test login→consulta en U3 |
| Dockerfile U2b ejecutado antes del scaffold nuevo → desfasado           | Media | U2b secuenciado después y recomendado como cambio separado                                                                 |
| CSV tiene columnas extra (doc-cols embebidas) y filas multilínea        | Media | Parser tolerante en U4: header real = 24 cols hasta la columna vacía; escapes de comillas                                  |
| Rate limit /api/classify ausente → abuso                                | Media | U9: límite por IP implícito en diseño (fixed window en memoria V1)                                                         |

## Rollback Plan

- Baseline git `5f9ae83` (= origin/main, tree limpio) cubre toda Fase A: `git reset --hard 5f9ae83`.
- Fase B: cada unidad = 1 PR convencional atómico; revert por PR. La migración vive en `0001_init.sql` rewritten in-place → ante fallo, `git revert` del PR + recrear BD desde cero (no hay datos productivos hasta que el usuario haga seed real).
- El wipe YA lo hizo la IA (2026-10-05) → rollback del wipe: `git checkout 5f9ae83 -- .` (todo estaba commiteado; `.env.local` era gitignored con claves Supabase muertas, sin valor).

## Dependencies

- Usuario: aprobar docs (U1) y scaffoldear `apps/web` + `apps/api` + raíz workspaces (borde). El usuario investiga cómo crear el proyecto; el SPEC define la estructura objetivo.
- Usuario: DNS en Cloudflare — root `leadscore.nuncacierro.com` ✅ creado y **PROXIED** (2026-10-05). Con la topología D **NO se requieren registros adicionales**.
- Paquetes por workspace: `apps/api` (fastify, pg, argon2, zod, vitest), `apps/web` (next, react), `packages/shared` (zod); después playwright.
- EvoAPI solo como asistente de redacción (sin oferta) — key como env server-side cuando llegue U8.

## Success Criteria

- [ ] `docs/SPEC.md` y `openspec/config.yaml` describen el producto nuevo (cero referencias a Kanban/@dnd-kit/Supabase).
- [ ] Estructura monorepo: `apps/web` (Next) + `apps/api` (Fastify) + `packages/shared` con schemas zod compartidos — un solo origen de tipos.
- [ ] `0001_init.sql` crea las 9 tablas (incluye `tenants`/`users`/`sessions`) con RLS `FORCE` activo; score se deriva de `score_criteria` (sin booleanos hardcodeados).
- [ ] Test de aislamiento de tenant: sin tenant o con tenant ajeno, RLS devuelve cero filas.
- [ ] Seed: los ~12 negocios reales del CSV importados con sus 8 criterios; `/demo` sirve datos sintéticos sin auth.
- [ ] Cola UI ordenada por score con cambio de estado vía dropdown (sin drag&drop) + contador de resultados visible, desglosado por `source_channel` (referidos vs maps-csv vs otros).
- [ ] Landing de venta en root (`leadscore.nuncacierro.com`) muestra el sistema por dentro sin autenticación (datos seed, contador, CTA) + `/demo` interactivo.
- [ ] `/api/classify` responde con rate limit; rutas de CRM devuelven 401 sin sesión.
- [ ] vitest corre con `npm test` y cubre las API routes de cada unidad.
- [ ] Cada unidad ≤ 400 líneas cambiadas o partida en sub-PRs encadenados.

## Review Workload Forecast

| Unit                               | Tipo    | Est. líneas cambiadas | Encadenar PRs                      | Decisión antes de apply                |
| ---------------------------------- | ------- | --------------------- | ---------------------------------- | -------------------------------------- |
| U0 propuesta                       | doc     | ~200 (ya escrito)     | —                                  | no                                     |
| U1 docs (SPEC+config+.env.example) | doc     | ~350–400              | dividir en 2 commits si >400       | sí (aprobar docs → usuario scaffoldea) |
| — scaffold manual (usuario)        | usuario | 0 (IA)                | —                                  | sí (usuario ejecuta)                   |
| U2 schema SQL+RLS+zod+helper       | código  | ~380–450              | SÍ (2a schema+RLS / 2b zod+helper) | no                                     |
| U3 auth                            | código  | ~280–330              | no                                 | no                                     |
| U4 seed CSV+demo data              | código  | ~200–250              | no                                 | no                                     |
| U5 motor score                     | código  | ~300–350              | no                                 | no                                     |
| U6 checks auto                     | código  | ~250–300              | no                                 | no                                     |
| U7 UI tabla+forms+contador         | código  | ~450–530              | SÍ (7a tabla+contador / 7b forms)  | no                                     |
| U8 outreach+outcomes               | código  | ~250–300              | no                                 | no                                     |
| U9 landing+demo+classify           | código  | ~350–450              | SÍ (9a landing / 9b demo+classify) | no                          |
| U2b deploy (cambio separado)       | infra   | ~250–300              | fuera de este change               | **sí** (¿separado o absorbido?)        |

- **Total estimado Fase A+B: ~3 100–3 700 líneas** → muy por encima del budget de 400.
- **Chained PRs recomendado: SÍ** (un PR por unidad, orden U2→U9; U2 y U7 parten en 2 PRs encadenados).
- **Decision needed before apply: SÍ** — (1) aprobar U1 (el wipe ya se hizo; habilita el scaffold del usuario), (2) confirmar corte de U7 en 2 PRs, (3) resolver U2b separado vs absorbido, (4) confirmar corte de U2 en 2 PRs.
- Estrategia `ask-always` del config: el forecast YA excede 400 → orquestador debe parar y pedir confirmación de slicing antes de lanzar apply.
