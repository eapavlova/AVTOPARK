create table if not exists waybill_files (
  id text primary key,
  waybill_id text not null references waybills(id) on delete restrict,
  uploaded_by text not null references users(id) on delete restrict,
  original_name text not null check (length(trim(original_name)) > 0),
  mime_type text not null check (length(trim(mime_type)) > 0),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  storage_key text not null unique check (length(trim(storage_key)) > 0),
  created_at timestamptz not null
);

create index if not exists waybill_files_waybill_created_idx
  on waybill_files (waybill_id, created_at, id);
