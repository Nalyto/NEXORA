-- NEXORA Online Ordering: table service and customer status updates
-- Additive migration. Existing orders remain intact.
alter table public.online_stores
  add column if not exists table_number_enabled boolean not null default false,
  add column if not exists table_number_options text[] not null default '{}';

alter table public.online_orders
  add column if not exists table_number text;

alter table public.online_orders
  drop constraint if exists online_orders_order_status_check;

alter table public.online_orders
  add constraint online_orders_order_status_check
  check (order_status in ('awaiting_payment','awaiting_cash','awaiting_verification','queued','processing','ready','shipped','completed','cancelled'));

comment on column public.online_stores.table_number_enabled is 'Whether customer checkout requires a table number.';
comment on column public.online_stores.table_number_options is 'Optional predefined table labels; customers may also enter a custom value.';
comment on column public.online_orders.table_number is 'Customer-selected or manually entered table label.';
