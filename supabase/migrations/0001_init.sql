-- LeadScore — Fase 0: esquema inicial
-- Fuente: docs/SPEC.md sección 3 (tabla + índices + RLS + trigger updated_at)
-- Aplicación manual: Supabase Dashboard → SQL Editor → Run
-- Nota: owner_id se agrega ANTES de la policy según la nota de la sección 3 del spec.

create table leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) default auth.uid(),

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

  -- score derivado (0-8): GENERATED ALWAYS AS ... STORED (DDL literal de la sección 3)
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

-- Row Level Security
alter table leads enable row level security;

create policy "Solo el owner ve sus leads"
  on leads for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Trigger updated_at
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
