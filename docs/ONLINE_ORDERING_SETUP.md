# NEXORA Online Ordering — Phase 1

This phase adds a separate, additive Supabase schema foundation for the public customer ordering page.

## Included
- One online storefront per company branch.
- Storefront product mirror, intended to be synced from every active NEXORA product.
- Customer orders and immutable item/price snapshots.
- Manual QRIS proof-submission and Owner approval statuses.
- A private Supabase Storage bucket for QRIS images and payment proofs.

## Safety
- No existing NEXORA tables or POS/localStorage records are altered or deleted.
- New tables use the `online_` prefix.
- The storage bucket is private.
- Row Level Security is enabled; browser clients must not access these tables directly.
- Future Vercel API routes must authenticate Owners/authorized staff and use the server-side Supabase secret key. Never put that key in browser code.
- Payment approval is manual in this version. An uploaded screenshot is not proof that funds were received; Owner must verify the merchant account before approval.

## Apply the migration
1. Open the correct Supabase project.
2. Open SQL Editor and create a new query.
3. Paste the contents of `supabase/migrations/20261102_online_ordering.sql`.
4. Run it once. The statements are designed to be re-runnable.
5. Confirm that these four tables exist: `online_stores`, `online_store_products`, `online_orders`, `online_order_items`.
6. Confirm Storage contains a **private** bucket named `nexora-online-ordering`.

Do not create or expose any new public/service-role key. Keep `SUPABASE_SECRET_KEY` only in Vercel server environment variables.

## Next phase
Build the Owner settings UI (store slug, publish/unpublish, QRIS upload), server-side product sync for all active products, public storefront, customer order creation, proof upload, and authenticated verification/queue APIs. Do not mark an order as paid or queued merely because a proof image was uploaded.
