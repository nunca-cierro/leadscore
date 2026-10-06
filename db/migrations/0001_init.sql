-- LeadScore — 0001_init: esquema Prospección (Postgres vanilla, dbmate)
-- Fuente binding: openspec/changes/prospeccion/design.md §1 (tablas §1.2, RLS §1.3,
--   orden/triggers §1.4, seeds §1.5) y docs/SPEC.md §4.
-- Tareas 2.2 (9 tablas + CHECKs/UNIQUE/índices), 2.3 (políticas + triggers + FORCE),
--   2.4 (seeds) — reemplaza ÍNTEGRO el esquema V1 prohibido (tabla leads, booleanos
--   por fila, score GENERATED, sin RLS).
-- Orden binding (§1.4): CREATE TABLE → CREATE POLICY → INSERT seeds → ALTER … FORCE
--   (últimas sentencias del bloque up; el owner aún no está sujeto durante los seeds).
-- Español prosa / identificadores en inglés.

-- migrate:up

-- ============================================================ §1.2 grupo A: identidad + criterios

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  constraint tenants_slug_key unique (slug) -- slug 'demo' reservado
);

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  email text not null,
  password_hash text not null, -- argon2id (U3)
  created_at timestamptz not null default now(),
  constraint users_email_key unique (email) -- login pre-auth: sin contexto de tenant
);
create index users_tenant_id_idx on users (tenant_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null, -- sha256 hex del cookie completo
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint sessions_token_hash_key unique (token_hash)
);
create index sessions_expires_at_idx on sessions (expires_at);
create index sessions_user_id_idx on sessions (user_id);

create table score_criteria (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  key text not null,
  label text not null,
  polarity text not null check (polarity in ('positive', 'inverse')),
  weight integer not null check (weight > 0),
  threshold numeric(10, 3),
  mode text not null check (mode in ('manual', 'auto')),
  enabled boolean not null default true,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint score_criteria_tenant_id_key_key unique (tenant_id, key)
);
create index score_criteria_tenant_enabled_position_idx
  on score_criteria (tenant_id, enabled, position);

-- ============================================================ §1.2 grupo B: entidades de las 8 capacidades

create table businesses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  external_id text, -- NULL repetido libre (alta manual); import CSV lo fija
  name text not null,
  vertical text,
  city text,
  whatsapp text,
  instagram_url text,
  email text,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'client', 'discarded')),
  source_channel text not null
    check (source_channel in ('referral', 'partner', 'maps-csv', 'inbound', 'ads')),
  next_action text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_tenant_id_external_id_key unique (tenant_id, external_id)
);
create index businesses_tenant_status_idx on businesses (tenant_id, status);
create index businesses_tenant_vertical_idx on businesses (tenant_id, vertical);
create index businesses_tenant_city_idx on businesses (tenant_id, city);
create index businesses_tenant_source_channel_idx on businesses (tenant_id, source_channel);

create table analysis_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  check_type text not null check (check_type in ('http_site', 'wa_me', 'facebook')),
  result jsonb not null check (jsonb_typeof(result -> 'ok') = 'boolean'),
  checked_at timestamptz not null default now()
  -- sin UNIQUE: historial append, nunca sobrescribe
);
create index analysis_checks_tenant_business_checked_idx
  on analysis_checks (tenant_id, business_id, checked_at desc);

create table score_evaluations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  source text not null check (source in ('rules', 'ml', 'hybrid')),
  value integer not null check (value >= 0),
  max integer not null check (max >= 0),
  criteria jsonb not null, -- [{key, met, pending, weight}] — snapshot, sin FK
  constraint score_evaluations_value_lte_max check (value <= max),
  created_at timestamptz not null default now()
  -- append-only: nunca UPDATE; la cola lee el último source='rules'
);
create index score_evaluations_tenant_business_source_created_idx
  on score_evaluations (tenant_id, business_id, source, created_at desc);

create table outreach (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'instagram', 'email', 'other')),
  draft text, -- saludo frío sin oferta
  sent_at timestamptz, -- NULL = solo borrador; NOT NULL = primer contacto registrado
  created_at timestamptz not null default now()
);
create index outreach_tenant_business_sent_at_idx on outreach (tenant_id, business_id, sent_at);

create table outcomes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  result text not null check (result in ('client', 'no_client')),
  notes text,
  created_at timestamptz not null default now(),
  constraint outcomes_tenant_id_business_id_key unique (tenant_id, business_id) -- un cierre nunca se pisa → 409
);
create index outcomes_tenant_created_at_idx on outcomes (tenant_id, created_at);
create index outcomes_tenant_result_idx on outcomes (tenant_id, result);

-- ============================================================ §1.4 triggers (único archivo de migración)

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Matriz de transiciones (§1.4; decisión §7: new→discarded directa habilitada;
-- new→client exige pasar por contacted → 409 vía RAISE; terminales no transicionan).
-- PATCH que no cambia status (notas, contacted→contacted) no está sujeto a la matriz.
create or replace function enforce_status_transition() returns trigger as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if old.status = 'new' and new.status in ('contacted', 'discarded') then
    return new;
  end if;
  if old.status = 'contacted' and new.status in ('client', 'discarded') then
    return new;
  end if;
  raise exception 'transition % -> % not allowed', old.status, new.status;
end;
$$ language plpgsql;

create trigger trg_businesses_updated_at
  before update on businesses
  for each row execute function set_updated_at();

create trigger trg_score_criteria_updated_at
  before update on score_criteria
  for each row execute function set_updated_at();

create trigger trg_businesses_status_transition
  before update on businesses
  for each row execute function enforce_status_transition();

-- ============================================================ §1.3/§1.4 políticas p_<tabla>_tenant (default-deny)
-- Expresión T: tenant_id = current_setting('app.current_tenant', true)::uuid
-- NULL → 0 filas. Sólo dos desviaciones: tenants (id = T) y users (escape §1.3).

create policy p_tenants_tenant on tenants
  using (id = current_setting('app.current_tenant', true)::uuid)
  with check (id = current_setting('app.current_tenant', true)::uuid);

create policy p_users_tenant on users
  using (
    tenant_id = current_setting('app.current_tenant', true)::uuid
    or (
      current_setting('app.current_tenant', true) is null
      and current_setting('app.auth_email', true) = email
    )
  )
  with check (
    tenant_id = current_setting('app.current_tenant', true)::uuid
    or (
      current_setting('app.current_tenant', true) is null
      and current_setting('app.auth_email', true) = email
    )
  );

create policy p_sessions_tenant on sessions
  using (tenant_id = current_setting('app.current_tenant', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant', true)::uuid);

create policy p_score_criteria_tenant on score_criteria
  using (tenant_id = current_setting('app.current_tenant', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant', true)::uuid);

create policy p_businesses_tenant on businesses
  using (tenant_id = current_setting('app.current_tenant', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant', true)::uuid);

create policy p_analysis_checks_tenant on analysis_checks
  using (tenant_id = current_setting('app.current_tenant', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant', true)::uuid);

create policy p_score_evaluations_tenant on score_evaluations
  using (tenant_id = current_setting('app.current_tenant', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant', true)::uuid);

create policy p_outreach_tenant on outreach
  using (tenant_id = current_setting('app.current_tenant', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant', true)::uuid);

create policy p_outcomes_tenant on outcomes
  using (tenant_id = current_setting('app.current_tenant', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ============================================================ §1.5 seeds (ANTES de ENABLE/FORCE)

-- Tenants (2). El id literal fijo del demo = DEMO_TENANT_ID (.env/.env.example):
-- misma constante en migración y env, evita UUID aleatorio irreproducible.
insert into tenants (id, slug, name) values
  ('11111111-1111-4111-8111-111111111111', 'demo', 'Demo pública'),
  (gen_random_uuid(), 'nuncacierro', 'NuncaCierro');

-- Preset de 8 criterios (§1.5 / SPEC §9): 16 filas = 8 × 2 tenants independientes
-- (aislamiento D16: /demo altera las suyas sin tocar las del CRM).
insert into score_criteria (tenant_id, key, label, polarity, weight, threshold, mode, position)
select t.id, p.key, p.label, p.polarity, 1, p.threshold, p.mode, p.position
from tenants t
join (values
  ('multi_site',      'Más de 2 sedes',      'positive', 2::numeric,    'manual', 0),
  ('rating_45',       'Rating > 4.5',        'positive', 4.5::numeric,  'manual', 1),
  ('ig_followers_500', '+500 followers IG',  'positive', 500::numeric,  'manual', 2),
  ('ig_posting',      'Posteo constante',    'positive', null::numeric, 'manual', 3),
  ('no_website',      'Sin sitio web',       'inverse',  null::numeric, 'auto',   4),
  ('no_wa_reply',     'Sin respuesta WhatsApp', 'inverse', null::numeric, 'manual', 5),
  ('has_catalog',     'Tiene catálogo',      'positive', null::numeric, 'manual', 6),
  ('has_team',        'Tiene equipo',        'positive', null::numeric, 'manual', 7)
) as p (key, label, polarity, threshold, mode, position)
  on t.slug in ('demo', 'nuncacierro');

-- Dataset sintético — EXCLUSIVAMENTE tenant demo (12 negocios variados;
-- 0 filas en nuncacierro: los datos reales llegan por alta manual/CSV).
insert into businesses
  (tenant_id, external_id, name, vertical, city, whatsapp, instagram_url, email,
   status, source_channel, next_action, notes)
select t.id, b.external_id, b.name, b.vertical, b.city, b.whatsapp, b.instagram_url,
       b.email, b.status, b.source_channel, b.next_action, b.notes
from tenants t
cross join (values
  ('demo-001', 'Café El Parque',      'restaurante',    'Bogotá',       '573001110001', '@cafeloparque',   'hola@cafeloparque.co',    'new',       'maps-csv', 'Enviar saludo',       'Del CSV de demo'),
  ('demo-002', 'Barbería Norte',      'barberia',       'Medellín',     '573001110002', '@barberianorte',  null,                     'new',       'referral', 'Enviar saludo',       'Referido por Ana'),
  ('demo-003', 'Hotel Mirador',       'hotel',          'Cartagena',    null,           '@hotelmirador',   'reservas@mirador.co',    'new',       'partner',  'Primer contacto',     null),
  ('demo-004', 'Gym FitMax',          'gimnasio',       'Bogotá',       '573001110004', '@gymfitmax',      null,                     'new',       'inbound',  'Primer contacto',     'Pidió info por IG'),
  ('demo-005', 'Estética Glow',       'salud_estetica', 'Cali',         '573001110005', '@esteticaglow',   'citas@glow.co',          'new',       'ads',      'Primer contacto',     null),
  ('demo-006', 'Restaurante Sabor',   'restaurante',    'Barranquilla', null,           null,              null,                     'new',       'maps-csv', 'Enriquecer datos',    null),
  ('demo-007', 'Spa Relax',           'salud_estetica', 'Medellín',     '573001110007', '@sparelax',       null,                     'contacted', 'referral', 'Seguimiento',         'Contactado hace 1 semana'),
  ('demo-008', 'Peluquería Style',    'barberia',       'Bucaramanga',  '573001110008', '@peluqueriastyle', null,                    'client',    'partner',  null,                  'Cerró tras 2 visitas'),
  ('demo-009', 'Hotel Plaza',         'hotel',          'Bogotá',       '573001110009', '@hotelplaza',     'info@plaza.co',          'client',    'inbound',  null,                  'Plan corporativo'),
  ('demo-010', 'Clínica Dental Sonrisa', 'salud_estetica', 'Pereira',   '573001110010', '@dentalsorrisa',  null,                     'client',    'ads',      null,                  'Campaña de implantes'),
  ('demo-011', 'Gimnasio Urban',      'gimnasio',       'Bello',        '573001110011', '@gimnasiourban',  null,                     'discarded', 'maps-csv', null,                  'No responde'),
  ('demo-012', 'Cafetería Aroma',     'restaurante',    'Manizales',    '573001110012', '@cafearoma',      null,                     'discarded', 'referral', null,                  'Cierre perdido')
) as b (external_id, name, vertical, city, whatsapp, instagram_url, email,
        status, source_channel, next_action, notes)
where t.slug = 'demo';

-- Score evaluations rules (1–2 por negocio; la última alimenta la cola).
-- criteria = snapshot del preset con los primeros `value` criterios como met.
insert into score_evaluations (tenant_id, business_id, source, value, max, criteria, created_at)
select b.tenant_id, b.id, 'rules', e.value, 8,
  (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('key', k.key, 'met', k.rn <= e.value, 'pending', false, 'weight', 1)
        order by k.rn),
      '[]'::jsonb)
    from (
      select sc.key, row_number() over (order by sc.position) as rn
      from score_criteria sc
      where sc.tenant_id = b.tenant_id and sc.enabled
    ) as k
  ),
  now() - make_interval(mins => e.ago)
from (values
  ('demo-001', 3, 120), ('demo-001', 7, 60),  -- última = 7
  ('demo-002', 7, 120), ('demo-002', 6, 60),  -- última = 6
  ('demo-003', 4, 60),
  ('demo-004', 8, 60),
  ('demo-005', 3, 60),
  ('demo-006', 5, 60),
  ('demo-007', 6, 60),
  ('demo-008', 7, 60),
  ('demo-009', 8, 60),
  ('demo-010', 2, 60),
  ('demo-011', 5, 60),
  ('demo-012', 4, 60)
) as e (external_id, value, ago)
join businesses b on b.external_id = e.external_id;

-- Outreach (8 filas): 6 sent (sent_at NOT NULL → contactados ≠ 0) + 2 borradores.
insert into outreach (tenant_id, business_id, channel, draft, sent_at)
select b.tenant_id, b.id, o.channel, o.draft,
       case when o.sent_days is null then null
            else now() - make_interval(days => o.sent_days) end
from (values
  ('demo-001', 'whatsapp',  'Hola, buen día! Vimos su café en el mapa y nos encantó la carta.', null::integer),
  ('demo-002', 'instagram', '¡Hola! Viendo su perfil de barbería…',                             null::integer),
  ('demo-007', 'whatsapp',  'Hola! Cómo va la semana? Teníamos una idea para su spa.',         7),
  ('demo-008', 'whatsapp',  'Hola! Un saludo rápido para presentarnos.',                        10),
  ('demo-009', 'email',     'Buenas, les escribimos por el formulario del hotel.',              12),
  ('demo-010', 'instagram', 'Hola! Vimos su campaña de implantes.',                            14),
  ('demo-011', 'whatsapp',  'Hola! Cómo está el gym? Le contamos qué hacemos.',                5),
  ('demo-012', 'whatsapp',  'Hola! Pasamos por su cafetería ayer…',                            3)
) as o (external_id, channel, draft, sent_days)
join businesses b on b.external_id = o.external_id;

-- Outcomes (5): 3 client + 2 no_client → cerrados = 5, tasa = 5/6 ≠ 0 (§1.5).
insert into outcomes (tenant_id, business_id, result, notes)
select b.tenant_id, b.id, o.result, o.notes
from (values
  ('demo-008', 'client',    'Cerró tras dos visitas'),
  ('demo-009', 'client',    'Plan corporativo firmado'),
  ('demo-010', 'client',    'Campaña de implantes cerrada'),
  ('demo-011', 'no_client', 'No responde tras 3 intentos'),
  ('demo-012', 'no_client', 'Cierre perdido: precio')
) as o (external_id, result, notes)
join businesses b on b.external_id = o.external_id;

-- ============================================================ §1.4 ENABLE + FORCE (últimas sentencias)
-- Orden binding: seeds anteriores corren con el owner aún NO sujeto; FORCE
-- (incluye al owner) queda al final. El rol de la app MUST NO ser superuser (§5).

alter table tenants            enable row level security, force row level security;
alter table users              enable row level security, force row level security;
alter table sessions           enable row level security, force row level security;
alter table score_criteria     enable row level security, force row level security;
alter table businesses         enable row level security, force row level security;
alter table analysis_checks    enable row level security, force row level security;
alter table score_evaluations  enable row level security, force row level security;
alter table outreach           enable row level security, force row level security;
alter table outcomes           enable row level security, force row level security;

-- migrate:down

drop table if exists outcomes, outreach, score_evaluations, analysis_checks,
  businesses, score_criteria, sessions, users, tenants cascade;
drop function if exists enforce_status_transition();
drop function if exists set_updated_at();
