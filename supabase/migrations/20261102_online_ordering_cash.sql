-- NEXORA Online Ordering: cash payment and cancellation (additive only)
alter table public.online_orders
  add column if not exists unique_code text,
  add column if not exists cash_received_amount numeric(14,2),
  add column if not exists cash_change numeric(14,2),
  add column if not exists cash_received_by uuid references auth.users(id) on delete set null,
  add column if not exists cash_received_at timestamptz;

alter table public.online_orders
  drop constraint if exists online_orders_payment_method_check;
alter table public.online_orders
  add constraint online_orders_payment_method_check
  check (payment_method in ('qris_static','cash'));

alter table public.online_orders
  drop constraint if exists online_orders_payment_status_check;
alter table public.online_orders
  add constraint online_orders_payment_status_check
  check (payment_status in ('awaiting_payment','proof_submitted','approved','rejected','awaiting_cash'));

alter table public.online_orders
  drop constraint if exists online_orders_order_status_check;
alter table public.online_orders
  add constraint online_orders_order_status_check
  check (order_status in ('awaiting_payment','awaiting_verification','awaiting_cash','queued','processing','ready','completed','cancelled'));

create unique index if not exists online_orders_unique_code_idx
  on public.online_orders(unique_code) where unique_code is not null;

create index if not exists online_orders_cashier_queue_idx
  on public.online_orders(company_id, branch_id, payment_method, payment_status, created_at desc);
