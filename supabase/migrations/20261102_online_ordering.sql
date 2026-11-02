-- NEXORA Online Ordering foundation
-- Safe, additive migration: creates new objects only. Does not alter or delete existing POS data.
-- Apply in Supabase SQL Editor after reviewing the project backup.

create extension if not exists pgcrypto;

create table if not exists public.online_stores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  slug text not null unique,
  display_name text,
  description text,
  is_published boolean not null default false,
  qris_image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, branch_id)
);

create table if not exists public.online_store_products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.online_stores(id) on delete cascade,
  source_product_id text not null,
  name text not null,
  description text,
  category text,
  image_url text,
  price numeric(14,2) not null default 0 check (price >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  synced_at timestamptz not null default now(),
  unique(store_id, source_product_id)
);

create table if not exists public.online_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.online_stores(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  order_number text not null,
  public_token uuid not null default gen_random_uuid() unique,
  customer_name text not null,
  customer_phone text not null,
  customer_note text,
  subtotal numeric(14,2) not null check (subtotal >= 0),
  total numeric(14,2) not null check (total >= 0),
  payment_method text not null default 'qris_static' check (payment_method = 'qris_static'),
  payment_status text not null default 'awaiting_payment'
    check (payment_status in ('awaiting_payment','proof_submitted','approved','rejected')),
  order_status text not null default 'awaiting_payment'
    check (order_status in ('awaiting_payment','awaiting_verification','queued','processing','ready','completed','cancelled')),
  payment_proof_path text,
  payment_submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, order_number)
);

create table if not exists public.online_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.online_orders(id) on delete cascade,
  source_product_id text,
  product_name text not null,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists online_stores_company_branch_idx
  on public.online_stores(company_id, branch_id);
create index if not exists online_store_products_store_active_idx
  on public.online_store_products(store_id, is_active, sort_order);
create index if not exists online_orders_company_status_created_idx
  on public.online_orders(company_id, order_status, created_at desc);
create index if not exists online_orders_branch_status_created_idx
  on public.online_orders(branch_id, order_status, created_at desc);
create index if not exists online_order_items_order_idx
  on public.online_order_items(order_id);

-- These tables are accessed through authenticated Vercel API routes using the
-- server-side Supabase secret key. Do not expose that key in browser code.
alter table public.online_stores enable row level security;
alter table public.online_store_products enable row level security;
alter table public.online_orders enable row level security;
alter table public.online_order_items enable row level security;

-- Private bucket: Vercel API routes upload/read QRIS and payment proof files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nexora-online-ordering',
  'nexora-online-ordering',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

comment on table public.online_stores is 'NEXORA public ordering storefront settings per company branch.';
comment on table public.online_store_products is 'Cloud mirror of active NEXORA products displayed in a storefront.';
comment on table public.online_orders is 'Online customer orders and manual QRIS payment verification state.';
comment on table public.online_order_items is 'Immutable product/price snapshots for each online order.';
