alter table vehicles add column if not exists retired_at date;

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
        or pg_get_constraintdef(oid) ilike '%status%SOLD%'
      )
  loop
    execute format('alter table vehicles drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

update vehicles
set retired_at = coalesce(retired_at, sold_at), status = 'RETIRED'
where status = 'SOLD';

alter table vehicles drop column if exists sold_at;

alter table vehicles
  add constraint vehicles_status_check
    check (status in ('FREE', 'ASSIGNED', 'TRANSFER_PENDING', 'RETURN_PENDING', 'RETIRED')),
  add constraint vehicles_driver_status_check
    check (
      (status in ('FREE', 'RETIRED') and current_driver_id is null)
      or (status not in ('FREE', 'RETIRED') and current_driver_id is not null)
    ),
  add constraint vehicles_retirement_date_check
    check ((status = 'RETIRED' and retired_at is not null) or (status <> 'RETIRED' and retired_at is null));
