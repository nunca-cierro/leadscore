# LeadScore — Spec de Desarrollo (SDD)
### CRM de prospección con scoring automático — de nuncacierro.com

---

## 0. Resumen ejecutivo

**Qué es:** Reemplazo del Google Sheet actual de prospección de nuncacierro por una app web (Kanban + scoring automático) que permite capturar, calificar y avanzar leads (restaurantes, spas, barberías, etc.) hacia el cierre de venta.

**Por qué:** Hoy el scoring (8 criterios booleanos) y el movimiento entre estados se hacen a mano en Sheets. Automatizar el scoring y visualizar el pipeline como Kanban acelera la operación y es reusable como producto (SaaS) para otros negocios que hacen outbound.

**V1 = uso interno para nuncacierro, un solo usuario (Nicolas).** Multiusuario/SaaS queda completamente fuera de alcance (sección 1): no hay roadmap prometido, ni `owner_id`, ni RLS en V1.

---

## 1. Alcance

### Dentro del alcance (V1)
- CRUD de leads (crear, editar, mover de estado, eliminar)
- Scoring automático calculado desde 8 booleanos (idéntico a las columnas del Sheet actual)
- Vista Kanban por estado: Pendiente → Contactado → En Conversación → Cliente / Descartado
- Vista de detalle de lead (notas, historial de fecha de contacto, próxima acción)
- Filtros: por vertical, ciudad, score mínimo, estado
- Importación inicial de los leads existentes del Sheet (migración one-time)
- Autenticación simple (un solo usuario: Nicolas — login con email/password vía sesión propia: cookie httpOnly firmada + password con argon2id)
- Deploy self-hosted en Hetzner (Docker Compose + Caddy), con Postgres corriendo en contenedor propio en el mismo servidor

### Fuera de alcance (V1) — no construir todavía
- Scraping/enriquecimiento automático de Instagram/web (ver sección 9, roadmap)
- Multiusuario / equipos / roles
- Notificaciones automáticas (email/WhatsApp)
- Facturación y métricas de negocio (la hoja "schedule" del Sheet) — módulo aparte, futuro
- App móvil

---

## 2. Stack técnico (fijo, no negociable para el orquestador)

| Capa | Tecnología | Versión / notas |
|---|---|---|
| Frontend | Next.js (App Router) | v14+, TypeScript estricto |
| Estilos | Tailwind CSS | sin librerías de componentes pesadas |
| Drag & drop Kanban | `@dnd-kit/core` | más liviano que react-beautiful-dnd |
| Backend | Next.js Route Handlers (`/app/api/*`) | sin servidor separado |
| Base de datos | Postgres (contenedor propio en Hetzner, Docker Compose) | una sola instancia compartida con el resto de servicios del servidor; accedida solo server-side |
| Auth | Sesión propia (cookie httpOnly firmada + argon2id) | un solo usuario en V1: no hace falta un proveedor de auth |
| Cliente DB | `pg` (pool server-side) | la DB se habla solo desde Route Handlers; el navegador nunca conecta a la DB |
| Hosting | Self-hosted Hetzner (Docker Compose + Caddy) | las env vars se gestionan en el entorno de despliegue (.env del servidor / secrets de GitHub Actions) |
| Validación | `zod` | en cada API route y formulario |
| Testing | `vitest` (unit) + `playwright` (e2e básico) | mínimo indispensable, ver sección 8 (Fases 1 y 4) |

**Restricción explícita:** no usar Prisma (evitar una capa extra sobre Postgres en V1), no usar Redux/Zustand (el estado del Kanban se maneja con Server Components + `useOptimistic` o SWR).

---

## 3. Modelo de datos

> El DDL completo vive en `db/migrations/0001_init.sql` (Postgres vanilla, sin dependencias de ningún BaaS). Se aplica contra el contenedor propio con `psql "$DATABASE_URL" -f db/migrations/0001_init.sql`. No hay RLS ni `owner_id`: V1 es de un solo usuario y la DB solo se toca desde el backend.

### Tabla `leads`

```sql
create table leads (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  vertical text not null check (vertical in ('restaurante','salud_estetica','barberia','hotel','gimnasio','otro')),
  ciudad text not null default 'Bogotá',
  whatsapp text,
  instagram text,
  correo text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','contactado','en_conversacion','cliente','descartado')),
  fecha_contacto timestamptz,
  proxima_accion text,

  -- criterios de scoring (booleanos, idénticos al Sheet)
  mas_2_sedes boolean not null default false,
  mas_4_5_estrellas boolean not null default false,
  mas_500_followers_ig boolean not null default false,
  post_constante boolean not null default false,
  sin_sitio_web boolean not null default false,
  sin_respuesta_wa boolean not null default false,
  tiene_catalogo boolean not null default false,
  tiene_equipo boolean not null default false,

  -- score derivado (0-8): columna GENERATED ALWAYS AS ... STORED, NO editable manualmente
  score integer generated always as (
    (mas_2_sedes::int + mas_4_5_estrellas::int + mas_500_followers_ig::int +
     post_constante::int + sin_sitio_web::int + sin_respuesta_wa::int +
     tiene_catalogo::int + tiene_equipo::int)
  ) stored,

  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_leads_estado on leads(estado);
create index idx_leads_vertical on leads(vertical);
create index idx_leads_score on leads(score desc);
```

### Trigger `updated_at`
```sql
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_leads_updated_at
  before update on leads
  for each row execute function set_updated_at();
```

---

## 4. Contratos de API (Route Handlers)

Rutas de leads bajo `/app/api/leads/`; la autenticación vive en `/api/auth/`. Todas devuelven JSON. Todas requieren sesión autenticada (verificar la sesión propia — cookie httpOnly firmada — al inicio de cada handler, devolver 401 si no hay sesión), excepto el login. El acceso a la DB es siempre server-side vía pool `pg`; el navegador nunca habla con la base de datos.

| Método | Ruta | Body / Query | Respuesta | Notas |
|---|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | `204` + `Set-Cookie` (httpOnly) | única ruta sin sesión previa; 401 en credenciales inválidas; sin registro público (usuario seed) |
| GET | `/api/leads` | query: `estado?`, `vertical?`, `score_min?`, `ciudad?` | `Lead[]` | filtros combinables |
| GET | `/api/leads/:id` | — | `Lead` | 404 si no existe |
| POST | `/api/leads` | `LeadInput` (zod schema, sin `id`/`score`) | `Lead` (201) | valida con zod antes de insertar |
| PATCH | `/api/leads/:id` | `Partial<LeadInput>` | `Lead` | usado para mover de estado (drag&drop) y editar campos |
| DELETE | `/api/leads/:id` | — | `{ success: true }` (204) | soft-delete NO es necesario en V1 |
| POST | `/api/leads/import` | `{ rows: LeadInput[] }` | `{ imported: number, errors: [...] }` | usado una sola vez para migrar el Sheet |

**Schema zod `LeadInput`** (debe vivir en `lib/schemas/lead.ts` y ser importado tanto por el frontend como por las API routes, sin duplicar):

```ts
export const LeadInputSchema = z.object({
  nombre: z.string().min(1),
  vertical: z.enum(['restaurante','salud_estetica','barberia','hotel','gimnasio','otro']),
  ciudad: z.string().default('Bogotá'),
  whatsapp: z.string().optional(),
  instagram: z.string().url().optional().or(z.literal('')),
  correo: z.string().email().optional().or(z.literal('')),
  estado: z.enum(['pendiente','contactado','en_conversacion','cliente','descartado']).default('pendiente'),
  fecha_contacto: z.string().datetime().optional(),
  proxima_accion: z.string().optional(),
  mas_2_sedes: z.boolean().default(false),
  mas_4_5_estrellas: z.boolean().default(false),
  mas_500_followers_ig: z.boolean().default(false),
  post_constante: z.boolean().default(false),
  sin_sitio_web: z.boolean().default(false),
  sin_respuesta_wa: z.boolean().default(false),
  tiene_catalogo: z.boolean().default(false),
  tiene_equipo: z.boolean().default(false),
  notas: z.string().optional(),
});
```

---

## 5. UI / Frontend

### 5.1 Página principal `/` (protegida, redirige a `/login` si no hay sesión)
- El guard lo hace el middleware propio de sesión (cookie httpOnly): sin sesión válida → redirect a `/login`
- Layout: barra superior con filtros (vertical, ciudad, score mínimo) + botón "Nuevo lead"
- Tablero Kanban con 5 columnas (una por `estado`), cada tarjeta muestra: nombre, vertical (chip de color), score como badge visual (ej. círculo con "7/8"), próxima acción
- Drag & drop entre columnas → dispara `PATCH /api/leads/:id` con el nuevo `estado`, optimista en UI (no esperar respuesta para mover la tarjeta)
- Click en tarjeta → abre panel lateral (Sheet/Drawer) con detalle completo y formulario de edición

### 5.2 Página `/login`
- Formulario simple email/password contra el endpoint propio de login (`POST /api/auth/login`)
- Sin registro público (el usuario único se crea en el seed inicial: script `db/seed` o `INSERT` manual)

### 5.3 Componente de badge de score
- Visual tipo gauge/círculo de progreso (0-8), color semáforo: rojo (0-3), amarillo (4-6), verde (7-8)
- Reusa esta lógica de color en un solo lugar (`lib/scoring.ts`), no la dupliques en componentes

### 5.4 Responsive
- Mobile: columnas del Kanban se muestran como tabs horizontales en vez de scroll lateral infinito

---

## 6. Migración de datos existentes

Antes de dar por cerrada la Fase 1, el agente encargado debe:
1. Exportar la hoja `leads` del Google Sheet a CSV
2. Escribir un script one-time (`scripts/migrate-sheet.ts`) que lea el CSV, transforme cada fila al `LeadInputSchema`, y haga POST a `/api/leads/import`
3. Mapeo de campos Sheet → DB:
   - `Estado` del Sheet usa "Descartado", "Contactado", "En Conversación", "Pendiente" → normalizar a los valores en minúscula/snake_case del enum (`descartado`, `contactado`, `en_conversacion`, `pendiente`)
   - `Score` del sheet (ej. "7/8") se ignora — se recalcula solo desde los booleanos
   - Verificar manualmente después de migrar que el conteo de leads importados coincide con las filas no vacías del Sheet

---

## 7. Variables de entorno

```
DATABASE_URL=            # server-side ONLY (pool de pg en las Route Handlers)
SESSION_SECRET=          # server-side ONLY (firma de la cookie de sesión)
NEXT_PUBLIC_SITE_URL=    # única candidata a NEXT_PUBLIC_* (URL pública del sitio)
```

Todas se gestionan **manualmente** en el entorno de despliegue (archivo `.env` del servidor / secrets de GitHub Actions) — no las inyecta ninguna integración — y el agente de deploy debe verificar que existan **ahí** antes de hacer el primer deploy a producción.

> `DATABASE_URL` y `SESSION_SECRET` **nunca** van bajo `NEXT_PUBLIC_*`: cualquier `NEXT_PUBLIC_*` queda expuesta en el bundle del cliente. Ninguna credencial de la DB sale del servidor.

---

## 8. Plan de fases para el orquestador (asignación a subagentes)

> Cada fase tiene un criterio de aceptación explícito. El orquestador no debe avanzar a la siguiente fase sin que el criterio se cumpla.

### Fase 0 — Setup de infraestructura
**Agente: `infra`**
- Crear la base de datos en el contenedor Postgres propio (Docker Compose del servidor) y aplicar `db/migrations/0001_init.sql` con `psql "$DATABASE_URL" -f db/migrations/0001_init.sql` (tabla + índices + trigger)
- Proyecto Next.js con TypeScript + Tailwind *(hecho: scaffold commiteado)*
- Escribir `Dockerfile` multi-stage con `output: 'standalone'` de Next.js
- Agregar el servicio de la app **y el servicio `postgres`** al Docker Compose del servidor, y la ruta correspondiente en Caddy (reverse proxy con Let's Encrypt)
- Crear el workflow de GitHub Actions que despliega en el servidor (con los secrets `DATABASE_URL` y `SESSION_SECRET` definidos ahí)
- **Criterio de aceptación:** `npm run dev` levanta la app localmente sin error; deploy inicial ("Hello World") visible en https://leadscore.nuncacierro.com

### Fase 1 — Backend (API routes)
**Agente: `backend`**
- Implementar las 6 rutas de la sección 4, con el schema zod compartido y pool `pg` server-side
- Implementar middleware de sesión propia (401 si no hay cookie válida) en cada ruta
- **Criterio de aceptación:** suite de tests con `vitest` cubre cada ruta (happy path + 401 + 400 por validación fallida) y pasa en verde

### Fase 2 — Frontend (Kanban)
**Agente: `frontend`**
- Implementar página `/login`
- Implementar tablero Kanban con drag&drop (sección 5.1)
- Implementar panel de detalle/edición de lead
- Implementar filtros
- **Criterio de aceptación:** flujo manual completo (login → crear lead → arrastrar entre columnas → editar → ver cambio persistido tras refresh) funciona sin errores en consola

### Fase 3 — Migración de datos
**Agente: `data`**
- Ejecutar el proceso de la sección 6
- **Criterio de aceptación:** número de leads en la app == número de filas no vacías del Sheet original; spot-check manual de 3 leads al azar comparando todos los campos

### Fase 4 — QA y deploy final
**Agente: `qa`**
- Correr `playwright` con al menos 2 flujos e2e: login+crear lead, mover lead de estado
- Verificar que la sesión propia bloquea el acceso sin cookie (probar con `curl` sin cookie de sesión)
- **Criterio de aceptación:** ambos tests e2e pasan; request sin auth a `/api/leads` devuelve 401

**El producto final entregado al usuario debe incluir:** URL de producción (https://leadscore.nuncacierro.com), credenciales del único usuario (email, no la password en texto plano — se comunica aparte), y este documento actualizado con cualquier decisión tomada durante la implementación que se haya desviado del spec.

---

## 9. Fuera del MVP pero documentado para no perder de vista (roadmap)

1. **Enriquecimiento automático:** cron job en el servidor (n8n ya corre en la misma máquina Hetzner, o un timer de systemd) que visita Instagram/web del lead y auto-marca los booleanos de scoring, eliminando el llenado manual
2. **Métricas de negocio:** portar la hoja "schedule" del Sheet (facturación, cobros pendientes) como módulo separado, reusando la misma base de datos
3. **Notificaciones:** WhatsApp/email automático cuando un lead lleva X días en "Esperando respuesta"

No implementar nada de esta sección en V1. Se documenta aquí para que el orquestador no lo mezcle con el alcance actual: la arquitectura de datos de V1 es de un solo usuario (sin `owner_id`, sin RLS).

---

## Decisiones de implementación (desviaciones del spec)

Dos desviaciones, ambas con fecha 2026-10-02: el hosting original (Vercel Hobby) se reemplaza por self-hosted, y Supabase se retira del stack por completo. Detalle a continuación.

| Aspecto | Detalle |
|---|---|
| **Fecha** | 2026-10-02 |
| **Decisión** | Self-hosted en el servidor Hetzner existente (Ubuntu, Docker Compose + Caddy como reverse proxy con Let's Encrypt, DNS vía Cloudflare proxy) |
| **Motivo** | Centralizar la infraestructura en un servidor ya existente y operado (mismo stack que NuncaCierro); se elimina la dependencia de una plataforma externa adicional |
| **Subdominio** | leadscore.nuncacierro.com |
| **Impacto** | Las variables de entorno ya no las inyecta ninguna integración: se gestionan en el entorno de despliegue (`.env` del servidor / secrets de GitHub Actions). El cron del roadmap pasa de Vercel Cron a n8n/systemd en el servidor |

| Aspecto | Detalle |
|---|---|
| **Fecha** | 2026-10-02 |
| **Decisión** | Supabase reemplazado por Postgres self-hosted + auth de sesión propia |
| **Motivo** | Centralización total en Hetzner + V1 single-user hace innecesario PostgREST/GoTrue/RLS |
| **Impacto** | Ver secciones afectadas: §1 (alcance/auth), §2 (stack: fila DB/Auth/cliente), §3 (schema sin RLS ni `owner_id`, migración movida a `db/migrations/0001_init.sql` aplicada con psql), §4 (handlers con verificación de sesión propia + pool `pg`), §5 (login contra `POST /api/auth/login`), §7 (env vars `DATABASE_URL`/`SESSION_SECRET`), §8 (Fase 0 sobre el contenedor propio), §9 (roadmap sin Multiusuario/SaaS). Código: eliminados `lib/supabase/`, `lib/database.types.ts` y el directorio `supabase/`; dependencia `@supabase/supabase-js` fuera de `package.json` |
