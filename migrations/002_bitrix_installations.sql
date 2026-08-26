create table if not exists bitrix_installations (
  member_id text primary key check (length(trim(member_id)) > 0),
  domain text not null check (length(trim(domain)) > 0),
  token_bundle text not null,
  expires_at timestamptz,
  installed_by_bitrix_user_id bigint,
  installed_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists bitrix_installations_domain_idx
  on bitrix_installations (domain);
