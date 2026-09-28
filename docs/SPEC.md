# LeadScore — Spec de Desarrollo (SDD)
### CRM de prospección con scoring automático — de nuncacierro.com

---

## 0. Resumen ejecutivo

**Qué es:** Reemplazo del Google Sheet actual de prospección de nuncacierro por una app web (Kanban + scoring automático) que permite capturar, calificar y avanzar leads (restaurantes, spas, barberías, etc.) hacia el cierre de venta.

**Por qué:** Hoy el scoring (8 criterios booleanos) y el movimiento entre estados se hacen a mano en Sheets. Automatizar el scoring y visualizar el pipeline como Kanban acelera la operación y es reusable como producto (SaaS) para otros negocios que hacen outbound.

**V1 = uso interno para nuncacierro.** Multiusuario/SaaS queda en roadmap (sección 12), no en el MVP.

---

## 1. Alcance

### Dentro del alcance (V1)
- CRUD de leads (crear, editar, mover de estado, eliminar)
- Scoring automático calculado desde 8 booleanos (idéntico a las columnas del Sheet actual)
- Vista Kanban por estado: Pendiente → Contactado → En Conversación → Cliente / Descartado
- Vista de detalle de lead (notas, historial de fecha de contacto, próxima acción)
- Filtros: por vertical, ciudad, score mínimo, estado
- Importación inicial de los leads existentes del Sheet (migración one-time)
- Autenticación simple (un solo usuario: Nicolas — login con email/password vía Supabase Auth)
- Deploy en Vercel (free) + Supabase (free)

### Fuera de alcance (V1) — no construir todavía
- Scraping/enriquecimiento automático de Instagram/web (ver sección 12, Fase 2)
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
| Base de datos | Supabase (Postgres) | plan free |
| Auth | Supabase Auth (email/password) | un solo usuario en V1 |
| ORM/cliente DB | `@supabase/supabase-js` | + tipos generados con `supabase gen types typescript` |
| Hosting | Vercel (plan Hobby) | integración nativa Supabase-Vercel para env vars |
| Validación | `zod` | en cada API route y formulario |
| Testing | `vitest` (unit) + `playwright` (e2e básico) | mínimo indispensable, ver sección 10 |

**Restricción explícita:** no usar Prisma (evitar capa extra sobre Supabase en V1), no usar Redux/Zustand (el estado del Kanban se maneja con Server Components + `useOptimistic` o SWR).

---

## 3. Modelo de datos

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

  -- score derivado (0-8), calculado por trigger, NO editable manualmente
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

### Row Level Security (RLS)
```sql
alter table leads enable row level security;

create policy "Solo el owner ve sus leads"
  on leads for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
```
> Nota para el agente que implemente esto: agregar columna `owner_id uuid references auth.users(id) default auth.uid()` a la tabla antes de aplicar la policy. Aunque V1 es un solo usuario, dejar RLS bien hecho desde el día uno evita reescribir todo cuando se vuelva multiusuario (Fase 3).

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

Todas las rutas bajo `/app/api/leads/`. Todas devuelven JSON. Todas requieren sesión autenticada (verificar `supabase.auth.getUser()` al inicio de cada handler, devolver 401 si no hay sesión).

| Método | Ruta | Body / Query | Respuesta | Notas |
|---|---|---|---|---|
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
- Layout: barra superior con filtros (vertical, ciudad, score mínimo) + botón "Nuevo lead"
- Tablero Kanban con 5 columnas (una por `estado`), cada tarjeta muestra: nombre, vertical (chip de color), score como badge visual (ej. círculo con "7/8"), próxima acción
- Drag & drop entre columnas → dispara `PATCH /api/leads/:id` con el nuevo `estado`, optimista en UI (no esperar respuesta para mover la tarjeta)
- Click en tarjeta → abre panel lateral (Sheet/Drawer) con detalle completo y formulario de edición

### 5.2 Página `/login`
- Formulario simple email/password contra Supabase Auth
- Sin registro público (el usuario se crea manualmente desde el dashboard de Supabase)

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
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # solo server-side, nunca exponer al cliente
```
Inyectadas automáticamente por la integración Supabase-Vercel al conectar el proyecto — el agente de deploy debe verificar que existan en Vercel antes de hacer el primer deploy a producción.

---

## 8. Plan de fases para el orquestador (asignación a subagentes)

> Cada fase tiene un criterio de aceptación explícito. El orquestador no debe avanzar a la siguiente fase sin que el criterio se cumpla.

### Fase 0 — Setup de infraestructura
**Agente: `infra`**
- Crear proyecto Supabase, ejecutar el SQL de la sección 3 (tabla + RLS + trigger)
- Crear proyecto Next.js con TypeScript + Tailwind
- Conectar repo a Vercel, instalar integración Supabase-Vercel
- Generar tipos TS desde el schema de Supabase
- **Criterio de aceptación:** `npm run dev` levanta la app localmente y conecta a Supabase sin error; deploy inicial ("Hello World") visible en una URL de Vercel

### Fase 1 — Backend (API routes)
**Agente: `backend`**
- Implementar las 6 rutas de la sección 4, con el schema zod compartido
- Implementar middleware de auth (401 si no hay sesión) en cada ruta
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
- Verificar RLS realmente bloquea acceso sin sesión (probar con `curl` sin cookie de auth)
- **Criterio de aceptación:** ambos tests e2e pasan; request sin auth a `/api/leads` devuelve 401

**El producto final entregado al usuario debe incluir:** URL de producción en Vercel, credenciales del único usuario (email, no la password en texto plano — se comunica aparte), y este documento actualizado con cualquier decisión tomada durante la implementación que se haya desviado del spec.

---

## 9. Fuera del MVP pero documentado para no perder de vista (roadmap)

1. **Enriquecimiento automático:** cron job (Vercel Cron, free tier permite 1/día en Hobby) que visita Instagram/web del lead y auto-marca los booleanos de scoring, eliminando el llenado manual
2. **Multiusuario / SaaS:** agregar `owner_id` ya está contemplado en el schema (sección 3); falta UI de registro, invitaciones de equipo, y planes de pago (Stripe)
3. **Métricas de negocio:** portar la hoja "schedule" del Sheet (facturación, cobros pendientes) como módulo separado, reusando la misma base de Supabase
4. **Notificaciones:** WhatsApp/email automático cuando un lead lleva X días en "Esperando respuesta"

No implementar nada de esta sección en V1. Se documenta aquí para que el orquestador no lo mezcle con el alcance actual ni lo omita al planear la arquitectura de datos (por eso `owner_id` sí se agrega desde ya).
