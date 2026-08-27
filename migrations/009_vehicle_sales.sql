alter table vehicles add column if not exists sold_at date;

alter table vehicles
  drop constraint if exists vehicles_status_check,
  drop constraint if exists vehicles_driver_status_check,
  drop constraint if exists vehicles_retirement_date_check;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'vehicles'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%status%FREE%'
        or pg_get_constraintdef(oid) ilike '%current_driver_id%'
        or pg_get_constraintdef(oid) ilike '%status%RETIRED%'
      )
  loop
    execute format('alter table vehicles drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

update vehicles
set sold_at = coalesce(sold_at, retired_at), status = 'SOLD'
where status = 'RETIRED';

alter table vehicles drop column if exists retired_at;

alter table vehicles
  add constraint vehicles_status_check
    check (status in ('FREE', 'ASSIGNED', 'TRANSFER_PENDING', 'RETURN_PENDING', 'SOLD')),
  add constraint vehicles_driver_status_check
    check (
      (status in ('FREE', 'SOLD') and current_driver_id is null)
      or (status not in ('FREE', 'SOLD') and current_driver_id is not null)
    ),
  add constraint vehicles_sale_date_check
    check ((status = 'SOLD' and sold_at is not null) or (status <> 'SOLD' and sold_at is null));
