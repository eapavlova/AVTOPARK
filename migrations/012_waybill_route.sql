alter table waybills
  add column if not exists route text not null default '';
