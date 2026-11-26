-- Compatibility migration for installations that already have a public.products table.
-- Preserve existing rows and add the columns required by the NEXORA cloud catalog API.
create extension if not exists pgcrypto;

alter table public.products add column if not exists id uuid default gen_random_uuid();
alter table public.products add column if not exists company_id uuid;
alter table public.products add column if not exists legacy_id text;
alter table public.products add column if not exists name text;
alter table public.products add column if not exists type text not null default 'Produk';
alter table public.products add column if not exists category text not null default 'Umum';
alter table public.products add column if not exists price numeric(14,2) not null default 0;
alter table public.products add column if not exists cost numeric(14,2) not null default 0;
alter table public.products add column if not exists stock numeric(14,3) not null default 0;
alter table public.products add column if not exists is_active boolean not null default true;
alter table public.products add column if not exists created_at timestamptz not null default now();
alter table public.products add column if not exists updated_at timestamptz not null default now();

-- Keep old rows intact. Their original primary key becomes the legacy identifier
-- when a dedicated legacy_id did not exist.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='id'
  ) then
    execute 'update public.products set legacy_id = id::text where legacy_id is null';
  end if;
end $$;

create unique index if not exists products_company_legacy_id_uidx
  on public.products(company_id, legacy_id);

create index if not exists products_company_active_name_idx
  on public.products(company_id, is_active, name);

alter table public.products enable row level security;

comment on table public.products is
  'NEXORA shared product catalog. Existing rows are preserved; cloud API uses company_id and legacy_id.';
