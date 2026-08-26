create table if not exists vehicle_sync_outbox (
  id text primary key,
  portal_id text not null,
  vehicle_id text not null references vehicles(id) on delete restrict,
  event_type text not null check (length(trim(event_type)) > 0),
  status text not null check (status in ('PENDING', 'SENT', 'FAILED')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null,
  synced_at timestamptz
);

create index if not exists vehicle_sync_outbox_pending_idx
  on vehicle_sync_outbox (portal_id, created_at)
  where status = 'PENDING';
