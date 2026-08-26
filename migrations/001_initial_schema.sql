create table if not exists app_metadata (
  singleton boolean primary key default true check (singleton),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists app_counters (
  name text primary key,
  value bigint not null check (value >= 0)
);

create table if not exists users (
  id text primary key,
  portal_id text not null default 'local',
  bitrix_user_id bigint,
  name text not null check (length(trim(name)) > 0),
  role text not null check (role in ('DRIVER', 'FLEET_MANAGER', 'ADMIN', 'ACCOUNTANT')),
  unique (portal_id, bitrix_user_id)
);

create table if not exists vehicles (
  id text primary key,
  portal_id text not null default 'local',
  plate_number text not null check (length(trim(plate_number)) > 0),
  title text not null check (length(trim(title)) > 0),
  status text not null check (status in ('FREE', 'ASSIGNED', 'TRANSFER_PENDING', 'RETURN_PENDING')),
  current_driver_id text references users(id),
  start_odometer numeric(14, 3) not null check (start_odometer >= 0),
  start_fuel numeric(14, 3) not null check (start_fuel >= 0),
  start_at date not null,
  start_recorded_by text not null references users(id),
  start_recorded_at timestamptz not null,
  bitrix_item_id bigint,
  unique (portal_id, plate_number),
  check (
    (status = 'FREE' and current_driver_id is null)
    or (status <> 'FREE' and current_driver_id is not null)
  )
);

create table if not exists assignments (
  id text primary key,
  vehicle_id text not null references vehicles(id) on delete restrict,
  driver_id text not null references users(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz,
  check (end_at is null or end_at >= start_at)
);

create table if not exists vehicle_transfers (
  id text primary key,
  type text not null check (type in ('DRIVER_TO_DRIVER', 'RETURN_TO_FLEET')),
  status text not null check (status in ('PENDING', 'ACCEPTED', 'REJECTED', 'CONFIRMED')),
  vehicle_id text not null references vehicles(id) on delete restrict,
  from_driver_id text not null references users(id) on delete restrict,
  to_driver_id text references users(id) on delete restrict,
  created_by text not null references users(id) on delete restrict,
  created_at timestamptz not null,
  resolved_at timestamptz,
  reason text,
  check (
    (type = 'DRIVER_TO_DRIVER' and to_driver_id is not null)
    or (type = 'RETURN_TO_FLEET' and to_driver_id is null)
  ),
  check (resolved_at is null or resolved_at >= created_at)
);

create table if not exists waybills (
  id text primary key,
  vehicle_id text not null references vehicles(id) on delete restrict,
  driver_id text not null references users(id) on delete restrict,
  waybill_date date not null,
  created_at timestamptz not null,
  status text not null check (status in ('DRAFT', 'ACCOUNTING_REVIEW', 'DRIVER_CORRECTION', 'PROCESSED', 'REJECTED')),
  distance_km numeric(14, 3) not null check (distance_km >= 0),
  fuel_added numeric(14, 3) not null check (fuel_added >= 0),
  fuel_spent numeric(14, 3) not null check (fuel_spent >= 0),
  start_odometer numeric(14, 3),
  end_odometer numeric(14, 3),
  start_fuel numeric(14, 3),
  end_fuel numeric(14, 3),
  note text not null default '',
  check (start_odometer is null or start_odometer >= 0),
  check (end_odometer is null or end_odometer >= 0),
  check (start_fuel is null or start_fuel >= 0),
  check (end_fuel is null or end_fuel >= 0)
);

create table if not exists audit_log (
  id text primary key,
  actor_id text not null references users(id) on delete restrict,
  action text not null check (length(trim(action)) > 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create unique index if not exists assignments_one_open_per_vehicle_idx
  on assignments (vehicle_id)
  where end_at is null;

create unique index if not exists vehicle_transfers_one_pending_per_vehicle_idx
  on vehicle_transfers (vehicle_id)
  where status = 'PENDING';

create index if not exists assignments_driver_date_idx
  on assignments (driver_id, start_at, end_at);

create index if not exists assignments_vehicle_date_idx
  on assignments (vehicle_id, start_at, end_at);

create index if not exists vehicle_transfers_recipient_pending_idx
  on vehicle_transfers (to_driver_id, created_at)
  where status = 'PENDING';

create index if not exists waybills_vehicle_date_idx
  on waybills (vehicle_id, waybill_date, created_at);

create index if not exists waybills_driver_status_idx
  on waybills (driver_id, status, waybill_date);

create index if not exists waybills_accounting_queue_idx
  on waybills (status, waybill_date, created_at)
  where status in ('ACCOUNTING_REVIEW', 'DRIVER_CORRECTION');

create index if not exists audit_log_actor_created_idx
  on audit_log (actor_id, created_at desc);

create or replace function enforce_ordinary_driver_assignment_limit()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from users
    where id = new.driver_id and role = 'DRIVER'
  ) and exists (
    select 1
    from assignments
    where driver_id = new.driver_id
      and end_at is null
      and id <> new.id
  ) then
    raise exception 'Обычный водитель уже имеет активный автомобиль.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists assignments_driver_limit_trigger on assignments;
create trigger assignments_driver_limit_trigger
before insert or update of driver_id, end_at on assignments
for each row
when (new.end_at is null)
execute function enforce_ordinary_driver_assignment_limit();
