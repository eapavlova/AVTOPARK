create table if not exists notification_outbox (
  id text primary key,
  portal_id text not null,
  bitrix_user_id bigint not null check (bitrix_user_id > 0),
  event_type text not null check (length(trim(event_type)) > 0),
  message text not null check (length(trim(message)) > 0),
  tag text not null check (length(trim(tag)) > 0),
  status text not null check (status in ('PENDING', 'SENT', 'FAILED')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null,
  sent_at timestamptz
);

create index if not exists notification_outbox_pending_idx
  on notification_outbox (portal_id, created_at)
  where status = 'PENDING';
