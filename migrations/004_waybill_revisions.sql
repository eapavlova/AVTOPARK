create table if not exists waybill_revisions (
  id text primary key,
  waybill_id text not null references waybills(id) on delete restrict,
  actor_id text not null references users(id) on delete restrict,
  waybill_status text not null check (waybill_status in ('DRAFT', 'ACCOUNTING_REVIEW', 'DRIVER_CORRECTION', 'PROCESSED', 'REJECTED')),
  before_data jsonb not null,
  after_data jsonb not null,
  created_at timestamptz not null
);

create index if not exists waybill_revisions_waybill_created_idx
  on waybill_revisions (waybill_id, created_at, id);
