-- NEXORA shared cloud product catalog
-- Products are company-wide in V1; all branches in the same company see the same stock.
create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  name text not null,
  type text not null default 'Produk' check (type in ('Produk','Layanan')),
  category text not null default 'Umum',
  price numeric(14,2) not null default 0 check (price >= 0),
  cost numeric(14,2) not null default 0 check (cost >= 0),
  stock numeric(14,3) not null default 0 check (stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create index if not exists products_company_active_name_idx
  on public.products(company_id, is_active, name);

alter table public.products enable row level security;

create or replace function public.nexora_adjust_product_stock(
  p_company_id uuid,
  p_legacy_id text,
  p_delta numeric default 0,
  p_set_stock numeric default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare new_stock numeric(14,3);
begin
  update public.products
     set stock = case
       when p_set_stock is not null then greatest(0, p_set_stock)
       else greatest(0, stock + coalesce(p_delta,0))
     end,
     updated_at = now()
   where company_id = p_company_id and legacy_id = p_legacy_id and is_active = true
   returning stock into new_stock;
  if new_stock is null then
    raise exception 'Produk tidak ditemukan atau sudah nonaktif.';
  end if;
  return new_stock;
end;
$$;

revoke all on function public.nexora_adjust_product_stock(uuid,text,numeric,numeric) from public, anon, authenticated;
grant execute on function public.nexora_adjust_product_stock(uuid,text,numeric,numeric) to service_role;

comment on table public.products is 'Shared NEXORA product and service catalog. Stock is company-wide across branches in V1.';

create or replace function public.nexora_apply_product_stock_changes(
  p_company_id uuid,
  p_changes jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare item jsonb; result jsonb := '[]'::jsonb; new_stock numeric(14,3);
begin
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'Format perubahan stok tidak valid.'; end if;
  for item in select * from jsonb_array_elements(p_changes) loop
    update public.products
       set stock = case
         when item ? 'setStock' and item->>'setStock' is not null then greatest(0,(item->>'setStock')::numeric)
         else greatest(0,stock + coalesce((item->>'delta')::numeric,0))
       end,
       updated_at = now()
     where company_id = p_company_id and legacy_id = item->>'legacyId' and is_active = true
     returning stock into new_stock;
    if new_stock is null then raise exception 'Produk tidak ditemukan: %', item->>'legacyId'; end if;
    result := result || jsonb_build_array(jsonb_build_object('legacyId',item->>'legacyId','stock',new_stock));
    new_stock := null;
  end loop;
  return result;
end;
$$;
revoke all on function public.nexora_apply_product_stock_changes(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.nexora_apply_product_stock_changes(uuid,jsonb) to service_role;
