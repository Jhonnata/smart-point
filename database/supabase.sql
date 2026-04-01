create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  base_salary numeric default 2500,
  monthly_hours integer default 220,
  daily_journey numeric default 8,
  weekly_limit numeric default 3,
  night_cutoff text default '22:00',
  percent_50 numeric default 50,
  percent_100 numeric default 100,
  percent_night numeric default 25,
  ai_provider text default 'gemini',
  gemini_api_key text,
  gemini_model text default 'gemini-3-flash-preview',
  openai_api_key text,
  openai_model text,
  codex_api_key text,
  codex_model text,
  employee_name text,
  employee_code text,
  role text,
  location text,
  company_name text,
  company_cnpj text,
  card_number text,
  dependentes integer default 0,
  adiantamento_percent numeric default 40,
  adiantamento_ir numeric default 0,
  saturday_compensation boolean default false,
  cycle_start_day integer default 15,
  comp_days text default '1,2,3,4',
  work_start text default '12:00',
  lunch_start text default '17:00',
  lunch_end text default '18:00',
  work_end text default '21:00',
  saturday_work_start text default '12:00',
  saturday_work_end text default '16:00',
  overtime_discount_enabled boolean default true,
  overtime_discount_threshold_one_hours numeric default 4,
  overtime_discount_minutes_one integer default 15,
  overtime_discount_threshold_two_hours numeric default 6,
  overtime_discount_minutes_two integer default 60,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_settings add column if not exists overtime_discount_enabled boolean default true;
alter table public.app_settings add column if not exists overtime_discount_threshold_one_hours numeric default 4;
alter table public.app_settings add column if not exists overtime_discount_minutes_one integer default 15;
alter table public.app_settings add column if not exists overtime_discount_threshold_two_hours numeric default 6;
alter table public.app_settings add column if not exists overtime_discount_minutes_two integer default 60;

create table if not exists public.references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month integer not null check (month between 1 and 12),
  year integer not null,
  company_name text,
  company_cnpj text,
  employee_name text,
  employee_code text,
  role text,
  location text,
  card_number text,
  front_image text,
  back_image text,
  front_image_he text,
  back_image_he text,
  has_normal_card boolean not null default false,
  has_overtime_card boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month, year)
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cnpj text not null,
  name text,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, cnpj)
);

create table if not exists public.reference_entries (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.references(id) on delete cascade,
  card_type text not null check (card_type in ('normal', 'overtime')),
  work_date date not null,
  day text not null,
  entry1 text,
  exit1 text,
  entry2 text,
  exit2 text,
  entry_extra text,
  exit_extra text,
  total_hours text,
  is_dp_annotation boolean not null default false,
  annotation_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reference_id, card_type, work_date)
);

alter table public.reference_entries add column if not exists annotation_text text;

create table if not exists public.banco_horas (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.references(id) on delete cascade,
  date date,
  minutes numeric,
  type text not null default 'extra',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.simulator_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reference text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, reference)
);

create index if not exists idx_references_user_month_year on public.references(user_id, year desc, month desc);
create index if not exists idx_companies_user_cnpj on public.companies(user_id, cnpj);
create index if not exists idx_reference_entries_reference_type_date on public.reference_entries(reference_id, card_type, work_date);
create index if not exists idx_banco_horas_reference_date on public.banco_horas(reference_id, date);
create index if not exists idx_simulator_plans_user_reference on public.simulator_plans(user_id, reference);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_app_settings on public.app_settings;
create trigger set_updated_at_app_settings
before update on public.app_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_references on public.references;
create trigger set_updated_at_references
before update on public.references
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_companies on public.companies;
create trigger set_updated_at_companies
before update on public.companies
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_reference_entries on public.reference_entries;
create trigger set_updated_at_reference_entries
before update on public.reference_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_banco_horas on public.banco_horas;
create trigger set_updated_at_banco_horas
before update on public.banco_horas
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_simulator_plans on public.simulator_plans;
create trigger set_updated_at_simulator_plans
before update on public.simulator_plans
for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
alter table public.references enable row level security;
alter table public.companies enable row level security;
alter table public.reference_entries enable row level security;
alter table public.banco_horas enable row level security;
alter table public.simulator_plans enable row level security;

drop policy if exists "app_settings_owner_all" on public.app_settings;
create policy "app_settings_owner_all" on public.app_settings
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "references_owner_all" on public.references;
create policy "references_owner_all" on public.references
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "companies_owner_all" on public.companies;
create policy "companies_owner_all" on public.companies
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "reference_entries_owner_all" on public.reference_entries;
create policy "reference_entries_owner_all" on public.reference_entries
for all
using (
  exists (
    select 1
    from public.references r
    where r.id = reference_id
      and r.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.references r
    where r.id = reference_id
      and r.user_id = auth.uid()
  )
);

drop policy if exists "banco_horas_owner_all" on public.banco_horas;
create policy "banco_horas_owner_all" on public.banco_horas
for all
using (
  exists (
    select 1
    from public.references r
    where r.id = reference_id
      and r.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.references r
    where r.id = reference_id
      and r.user_id = auth.uid()
  )
);

drop policy if exists "simulator_plans_owner_all" on public.simulator_plans;
create policy "simulator_plans_owner_all" on public.simulator_plans
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
