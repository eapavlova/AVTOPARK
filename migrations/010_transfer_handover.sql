alter table vehicle_transfers add column if not exists handover jsonb;

create table if not exists transfer_files (
  id text primary key,
  transfer_id text not null references vehicle_transfers(id) on delete restrict,
  uploaded_by text not null references users(id) on delete restrict,
  category text not null check (category in ('VEHICLE', 'DASHBOARD', 'EXTRA')),
  original_name text not null check (length(trim(original_name)) > 0),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  storage_key text not null unique check (length(trim(storage_key)) > 0),
  created_at timestamptz not null
);

create index if not exists transfer_files_transfer_created_idx
  on transfer_files (transfer_id, created_at, id);
