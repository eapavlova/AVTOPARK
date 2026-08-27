alter table waybills
  add column if not exists reported_end_odometer numeric(14, 3),
  add column if not exists reported_end_fuel numeric(14, 3);

alter table waybills
  drop constraint if exists waybills_reported_end_odometer_check,
  drop constraint if exists waybills_reported_end_fuel_check;

alter table waybills
  add constraint waybills_reported_end_odometer_check
    check (reported_end_odometer is null or reported_end_odometer >= 0),
  add constraint waybills_reported_end_fuel_check
    check (reported_end_fuel is null or reported_end_fuel >= 0);
