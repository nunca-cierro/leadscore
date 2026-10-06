# U0 — Scaffold del monorepo: validación (bitácora)

**Cierre: U0 DONE ✅ (2026-10-06).** El scaffold del usuario (tarea 0.1) y su validación por IA (tarea 0.2) están completos: estructura exacta vs `design §4`, `.env.example` conforme a `design §7`, `strict_tdd` re-evaluado en `openspec/config.yaml`, y las tres puertas de calidad verdes (`typecheck`, `test`, `lint`) más runtime verificado (`GET /health` → 200 y Next sirviendo en `:3000`). Dos hallazgos de dependencias detectados en la validación fueron **resueltos el mismo día** con aprobación del usuario (§5.6); quedan como follow-ups el audit de `braces` y los majors mayores (§5). Siguiente unidad: **WU1** — migración dbmate + RLS (PR1).

> **Cómo leer esta bitácora** — secciones cortas, una decisión o verificación por sección; identificadores en inglés, prosa en español. Todo ❌/⚠ incluye evidencia reproducible. La IA **no** editó scaffold (`apps/**`, `packages/**`, `package.json`, `tsconfig*`, `vitest.workspace.ts`).

---

## 1. Objetivo

U0 es el borde Fase A → Fase B (`docs/SPEC.md §13`): el usuario crea el scaffold, la IA sólo valida (D8).

| Tarea | Owner | Resultado |
|---|---|---|
| **0.1** scaffold monorepo (SPEC §13 / design §4) | USER | ✅ hecho y verificado hoy |
| **0.2** validación de estructura + `.env.example` + re-evaluación de `strict_tdd` | IA | ✅ esta bitácora |

AC de cierre: `docs/SPEC.md §14` — "Estructura monorepo exacta".

## 2. Fuentes oficiales consultadas

| Fuente | Qué se verificó |
|---|---|
| npm workspaces docs | `npm init -w`, `npm install -w <dir>`, scripts con `--workspaces --if-present` |
| Fastify TypeScript guide | comandos de instalación, `target ≥ es2017`, split `createApp()` / `listen` |
| Next.js `create-next-app` CLI | flags `--ts --app --eslint --tailwind --use-npm --no-src-dir --import-alias` (verificados contra la fuente del CLI) |
| Next.js + TypeScript | requisito mínimo v5.1.0, sin versión máxima |

## 3. Decisiones y por qué

| Decisión | Por qué |
|---|---|
| Workspaces por **glob** (`apps/*`, `packages/*`) | `npm init -w` escribe rutas explícitas exactas; con rutas escritas a mano el scaffold falló (`No workspaces found --workspace=apps/web`). Globs = un paquete nuevo entra al workspace solo al crearse. |
| **TypeScript unificado a 5.9.3** en todo el monorepo | Una sola versión de TS = una sola semántica de tipos. El template de Next trae `^5` (resuelve 5.9.3) y la regla del borde es "scaffold aburrido": nada de majors nuevos. **TS 7.0.2 (latest en registry) RECHAZADO por ahora** — adopción de TS7 = cambio deliberado futuro con su propio PR. La prueba de unificación FALLÓ en la validación (huérfano 7.0.2 en apps/api) y se reparó el mismo día — ver §5.6 ✅. |
| `apps/api`: `"type": "module"` + `moduleResolution: NodeNext` | `tsc` emite a `dist/` y Node ESM exige `.js` en imports relativos. El error `TS2835` fue el aprendizaje: vitest/tsx son tolerantes (resuelven sin extensión) = falso sentido de seguridad; sólo `tsc --noEmit` y el runtime de Node lo revelan. |
| `createApp()` separado de `listen` | Habilita tests con `fastify.inject` sin abrir puerto. `NODE_ENV=test` salta el bloque de arranque en `server.ts` (el test de `/health` nunca toca el `:8080`). |
| Scripts raíz con `--workspaces --if-present` | Orquestación: el raíz delega en cada workspace y un paquete sin ese script se salta sin romper la cadena (hoy `apps/web` no tiene `test` → omitido hasta U7). |

## 4. Incidencias resueltas

| Síntoma | Causa raíz | Fix |
|---|---|---|
| `ETARGET next@16.4.0` | caché npm stale | el registry **sí** tiene 16.4.0 (verificado `npm view next dist-tags`); fix = install desde la raíz |
| `No workspaces found --workspace=apps/web` | workspaces explícitos no incluían `apps/web` | cambiar a globs `apps/*`, `packages/*` |
| Instrucciones pegadas dentro de `server.ts` | copiado accidental de la guía de arranque | archivo limpio reescrito (hoy: 18 líneas — `createApp()` + bloque de arranque con guarda `NODE_ENV`) |
| `.gitignore` con patrones anclados (`/node_modules`) | git sólo anclaba la raíz → `apps/api/node_modules` **no** ignorado | patrones sin barra inicial (`node_modules/`, `dist/`, …). Verificado con `git status -uall` + `git check-ignore` (5 rutas) + `.env.example` sigue **no** ignorado (`.env*` + `!.env.example`) |

## 5. Verificación de dependencias (2026-10-06)

Comandos ejecutados **en la validación** (2026-10-06); outputs reales (recortados). La validación **no** auto-reparó nada: los fixes de §5.1/§5.2 se ejecutaron después, con aprobación del usuario (§5.6).

### 5.1 `npm ls --depth=0` → exit **1** (`ELSPROBLEMS`) — ❌ estado inicial, RESUELTO en §5.6

```text
leadscore@1.0.0 D:\Documentos\Repositories\leadscore
├─┬ @leadscore/api@1.0.0 -> .\apps\api
│ ├── fastify@5.12.5
│ ├── typescript@7.0.2 invalid: "^5.9.3" from apps/api          ← ❌
│ └── vitest@5.0.3 invalid: "^4" from packages/shared            ← ❌
├─┬ @leadscore/shared@1.0.0 -> .\packages\shared
│ ├── typescript@5.9.3 deduped
│ └── vitest@5.0.3 deduped invalid: "^4" from packages/shared
├── typescript@5.9.3
└─┬ web@0.1.0 -> .\apps\web
  ├── next@16.4.0
  ├── typescript@5.9.3 deduped
  └── vitest@5.0.3 deduped
npm error code ELSPROBLEMS
npm error invalid: typescript@7.0.2 ...\apps\api\node_modules\typescript
npm error invalid: vitest@5.0.3 ...\node_modules\vitest
```

### 5.2 Unificación TypeScript — ❌ la prueba FALLÓ (resuelta en §5.6)

La decisión (§3) es **una sola versión de TS en todo el árbol**. La evidencia dice que hoy no se cumple en `apps/api`:

| Verificación | Resultado |
|---|---|
| `node_modules/.bin/tsc --version` (root) | `Version 5.9.3` ✅ |
| `apps/api/node_modules/.bin/tsc --version` | `Version 7.0.2` ❌ (nativo; instala `@typescript/typescript-*` por plataforma) |
| `npm ls typescript` | root/shared/web = `5.9.3 deduped` ✅ · apps/api = `7.0.2 invalid: "^5.9.3"` ❌ |
| `npm explain typescript@7.0.2` | `typescript@7.0.2 dev → apps/api/node_modules/typescript` — **sin dependiente que lo justifique** (instalación huérfana; el spec `^5.9.3` nunca lo habría resuelto) |

**Impacto:** `npm run typecheck -w apps/api` corre con el compilador **7.0.2** mientras `shared`/`web`/root corren **5.9.3** → dos semánticas de tipos en el mismo monorepo, exactamente lo que la decisión buscaba evitar. `npm install --dry-run` (sólo lectura) **no planea repararlo** — su plan sólo añade `vitest@4.1.11` para `packages/shared` (ver §5.5), así que la reparación es **manual**. Antes de U2b (CI con `npm ci`, `design §5.3`) hay que verificar el comportamiento de `npm ci` con este lockfile.

**Fix (NO ejecutado en la validación — scaffold del usuario):** `npm i -w apps/api typescript@5.9.3` y confirmar `npm ls` → exit 0. **Aplicado el mismo día — ver §5.6.**

### 5.3 `npm ls typescript vitest next fastify` (recortado)

```text
├── fastify@5.12.5
├── next@16.4.0
├── vitest@5.0.3   (root; inválido para spec "^4" de packages/shared)
├── typescript@5.9.3 (root, shared, web — deduped)
└── typescript@7.0.2 invalid (apps/api)
```

### 5.4 `npm outdated` → exit 1 (9 filas)

| Package | Current | Wanted | Latest | Depended by |
|---|---|---|---|---|
| typescript | 7.0.2 | 5.9.3 | 7.0.2 | api (❌ anidado, ver §5.2) |
| typescript | 5.9.3 | 5.9.3 | 7.0.2 | root / shared / web ✅ |
| vitest | 5.0.3 | 4.1.11 | 5.0.3 | shared (spec `^4` desalineado) |
| eslint | 9.39.5 | 9.39.5 | 10.12.0 | api, web |
| @eslint/js | 9.39.5 | 9.39.5 | 10.0.1 | api |
| @types/node | 20.19.43 | 20.19.43 | 26.6.4 | web |

### 5.5 `npm audit` → exit 1 — 5 high

```text
braces * — stack-exhaustion DoS (GHSA-vfj7-8cjw-p6xm)
  micromatch → fast-glob → @next/eslint-plugin-next → eslint-config-next
fix available via `npm audit fix --force` → instalaría eslint-config-next@14.2.35 (BREAKING)
```

`npm install --dry-run` (sólo lectura) planea **añadir 17 paquetes** (`vitest@4.1.11` + deps para `packages/shared`) y **no** toca `typescript`. No se ejecutó `npm install` real.

### 5.6 Reparación (mismo día, aprobada por el usuario)

| Fix | Comando | Evidencia |
|---|---|---|
| Huérfano TS 7.0.2 podado | `npm i -D typescript@5.9.3 -w apps/api` | `removed 2 packages`; `apps/api/node_modules/.bin/tsc` ya **no existe** → api usa el tsc 5.9.3 hoisted |
| Spec de vitest en shared | `npm pkg set devDependencies.vitest="^5.0.3" -w packages/shared` | spec `"vitest": "^5.0.3"` |

Verificación posterior ejecutada por el usuario:

```text
$ npm ls typescript vitest next fastify   → exit 0 (sin ELSPROBLEMS)
  typescript@5.9.3 deduped ×4 nodos · vitest@5.0.3 · next@16.4.0 · fastify@5.12.5
$ npm run typecheck                        → exit 0 (3 workspaces, tsc 5.9.3)
$ npm ls --all                             → exit 0 (revisado en la revisión fresh-context pre-commit)
```

**Unificación TypeScript PROBADA**: un solo `typescript@5.9.3` en todo el árbol.

### Follow-ups (estado al cierre de U0)

- [x] Reparar el `typescript@7.0.2` huérfano en `apps/api` — **HECHO 2026-10-06** (§5.6): `npm i -D typescript@5.9.3 -w apps/api` → `npm ls` exit 0. Verificar `npm ci` antes de U2b.
- [x] Alinear spec de `vitest` en `packages/shared` (`^4` → `^5.0.3`) — **HECHO 2026-10-06** (§5.6).
- [ ] Decidir sobre `braces`/`eslint-config-next` (el fix propone downgrade breaking → revisar, no auto-fix).
- [ ] Mayores mayores (`eslint@10`, `@types/node@26`) = cambios deliberados, fuera de U0.

## 6. Resultados de validación 0.2

### 6.1 Checklist (evidencia = comando/grep ejecutado hoy)

| # | Check | Resultado | Evidencia |
|---|---|---|---|
| 1 | Raíz: `package.json` + `tsconfig.base.json` + `vitest.workspace.ts` | ✅ | los 3 existen; `workspaces: ["apps/*","packages/*"]`; `defineWorkspace(["apps/api","apps/web","packages/shared"])` |
| 2 | `apps/web/app/` + `next.config.ts` | ✅ | `app/{page.tsx,layout.tsx,globals.css,favicon.ico}` + `next.config.ts` |
| 3 | `apps/api/src/{server.ts, routes/, services/, db/}` | ⏳ | `server.ts` ✅ (18 líneas, `createApp()` + `listen` con guarda `NODE_ENV`); `routes/ services/ db/` **diferido a WU1+** (tareas 2.5/3.x los crean) — no es fallo |
| 4 | `packages/shared/src/{schemas.ts, scoring.ts}` | ✅ | ambos existen (+ `index.ts`, `smoke.test.ts`) |
| 5 | Scripts raíz `dev`/`build`/`test`/`lint`/`typecheck` delegando a workspaces | ✅ | los 5 usan `npm run <x> --workspaces --if-present` |
| 6 | `tsconfig.base.json` con `strict: true` | ✅ | `"strict": true` (+ `noUncheckedIndexedAccess`); `apps/web` no extiende el base pero declara `strict: true` propio (template create-next-app) |
| 7 | `apps/web` **sin** import de `pg` | ✅ | grep `from ['"]pg\|require(['"]pg` en `apps/web/` → **0 matches** |
| 8 | `apps/api` **sin** React/JSX | ✅ | grep `react\|jsx` en `apps/api/` → **0 matches** |
| 9 | `packages/shared` **sin** I/O (`fs`/`http`/`pg`/`fetch`/`process.env`) | ✅ | grep en `packages/shared/` → **0 matches** |
| 10 | Imports relativos de `apps/api` con extensión `.js` (NodeNext) | ✅ | `server.test.ts`: `import { createApp } from "./server.js"` |
| 11 | `.env.example` SIN `EVO_API_KEY` (design §7) | ✅ | `Select-String EVO_API_KEY` → **0 matches** |
| 12 | `.env.example` CON `DEMO_TENANT_ID` / `CLASSIFY_RATE_LIMIT` / `CLASSIFY_RATE_WINDOW` | ✅ | `DEMO_TENANT_ID=` · `CLASSIFY_RATE_LIMIT=10` · `CLASSIFY_RATE_WINDOW=60000` |
| 13 | Re-evaluar `strict_tdd` en `openspec/config.yaml` con `npm test` operativo | ✅ | `testing:` actualizado (2026-10-06); `strict_tdd` **permanece `false`** — vínculo del header de `tasks.md`: "test-first por unidad, sin ciclo RED/GREEN formal obligatorio" |
| 14 | Dependencias del monorepo (§5) | ✅ | ❌ en la validación (`npm ls` exit 1: huérfano TS 7.0.2 + spec vitest `^4`) → **resuelto mismo día** (§5.6): `npm ls` exit 0, TS único 5.9.3 |

Nota (deferred, no fallo): `apps/web` **no** tiene script `test` aunque `design §4` lo lista — los tests de web llegan en U7 (7.1) y el `--if-present` raíz lo omite sin romper.

Gaps conocidos detectados por la **revisión fresh-context pre-commit** (fuera de la checklist 0.2, no bloquean este commit):

- **⏳ `npm run dev` raíz NO es concurrente** — `--workspaces` ejecuta en serie y `tsx watch` (api) bloquea `next dev` (web); `design §4` exige "web + api concurrentes". Fix: `concurrently` en el script raíz — pendiente.
- **⏳ `vitest.workspace.ts` es config inerte** — vitest 5 eliminó `defineWorkspace` (verificado: `typeof defineWorkspace = undefined`); el root `npm test` no usa el archivo. Migrar a `test.projects` en un `vitest.config` raíz al llegar la config de entorno de `apps/web` (U7).

### 6.2 Puertas de calidad (re-ejecutadas ahora)

```text
$ npm run typecheck   → exit 0  (tsc --noEmit en @leadscore/api, web, @leadscore/shared)
$ npm test            → exit 0  (vitest 5.0.3: api 1/1 + shared 1/1 = 2 tests verdes;
                                 apps/web omitido — sin script, llega en U7)
$ npm run lint        → exit 0  (ESLint flat: apps/api, apps/web, packages/shared)
```

✅ Sin salvedad: tras la reparación de §5.6 los 3 workspaces corren `tsc` **5.9.3** (binario anidado de apps/api eliminado).

### 6.3 Runtime harness

| Escenario | Resultado |
|---|---|
| Arranque `apps/api` (`tsx src/server.ts`) → `GET http://localhost:8080/health` | ✅ `200` → `{"ok":true}` |
| Arranque `apps/web` (`next dev`) → `GET http://localhost:3000` | ✅ `200` |
| Teardown | ✅ puertos 8080/3000 libres tras la verificación |

## 7. Estado al cierre

- **U0 DONE** — 0.1 (USER) ✅ + 0.2 (IA) ✅; ambos checkboxes marcados en `openspec/changes/prospeccion/tasks.md`.
- `openspec/config.yaml` → `testing:` refleja la realidad actual (unit ✅ · integration/RLS ❌ U2 · E2E ❌ post-MVP · lint/typecheck ✅).
- Follow-ups de dependencias: 2 resueltos el mismo día (§5.6), 2 pendientes (audit `braces`, majors mayores) + gaps conocidos de §6.1 (`dev` concurrente, `vitest.workspace.ts` inerte).
- **Siguiente: WU1** — PR1 con `dbmate` migration + RLS (tareas 2.1–2.4, 2.8) · ⚠ `size:exception` (est. ~710 líneas > budget 400) · chain: `feature-branch-chain` con tracker `develop`.
