-- ============================================================================
-- PulsoLocal — Migración de Límites del Plan Trial y Anti-Abuso (Bloque 5)
-- 1. Agrega columnas y tabla trial_claims para detectar alias (+) y URLs repetidas.
-- 2. Actualiza handle_new_user() y protect_business_subscription().
-- 3. Restringe DELETE de review_requests a 'pending' y valida límite de 7 días / 15 solicitudes en INSERT.
-- ============================================================================

alter table public.businesses
  add column if not exists normalized_google_review_url text,
  add column if not exists canonical_email text,
  add column if not exists trial_restricted_reason text;

create index if not exists idx_businesses_normalized_google_url
  on public.businesses(normalized_google_review_url)
  where normalized_google_review_url is not null;

create index if not exists idx_businesses_canonical_email
  on public.businesses(canonical_email)
  where canonical_email is not null;

create table if not exists public.trial_claims (
  id uuid primary key default gen_random_uuid(),
  claim_type text not null check (claim_type in ('canonical_email', 'google_review_url')),
  claim_value text not null,
  business_id uuid,
  user_id uuid,
  created_at timestamptz not null default now(),
  unique (claim_type, claim_value)
);

alter table public.trial_claims enable row level security;
revoke all on public.trial_claims from anon, authenticated;

create or replace function public.canonicalize_email(p_email text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_email text;
  v_local text;
  v_domain text;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' or position('@' in v_email) = 0 then
    return null;
  end if;

  v_local := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);

  if v_local = '' or v_domain = '' then
    return null;
  end if;

  if position('+' in v_local) > 0 then
    v_local := split_part(v_local, '+', 1);
  end if;

  if v_domain = 'googlemail.com' then
    v_domain := 'gmail.com';
  end if;

  if v_domain = 'gmail.com' then
    v_local := replace(v_local, '.', '');
  end if;

  return v_local || '@' || v_domain;
end;
$$;

create or replace function public.has_email_subaddressing(p_email text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
begin
  return split_part(lower(trim(coalesce(p_email, ''))), '@', 1) like '%+%';
end;
$$;

create or replace function public.normalize_google_review_url(p_url text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_url text;
  v_no_scheme text;
  v_host text;
  v_rest text;
  v_path text;
  v_query text;
  v_clean_params text[];
begin
  v_url := trim(coalesce(p_url, ''));
  if v_url = '' or v_url !~* '^https?://' then
    return null;
  end if;

  v_no_scheme := regexp_replace(v_url, '^https?://', '', 'i');
  v_no_scheme := split_part(v_no_scheme, '#', 1);

  v_host := lower(split_part(split_part(v_no_scheme, '/', 1), '?', 1));
  v_host := regexp_replace(v_host, '^www\.', '', 'i');

  if position('/' in v_no_scheme) > 0 then
    v_rest := substring(v_no_scheme from position('/' in v_no_scheme));
  elsif position('?' in v_no_scheme) > 0 then
    v_rest := substring(v_no_scheme from position('?' in v_no_scheme));
  else
    v_rest := '';
  end if;

  v_path := split_part(v_rest, '?', 1);
  v_path := regexp_replace(v_path, '/{2,}', '/', 'g');
  v_path := regexp_replace(v_path, '/+$', '');

  if position('?' in v_rest) > 0 then
    v_query := split_part(v_rest, '?', 2);
    select array_agg(p order by p)
    into v_clean_params
    from unnest(string_to_array(v_query, '&')) as p
    where p <> ''
      and lower(split_part(p, '=', 1)) !~ '^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|hl$|gl$|source$|ved$|usg$|opi$|sca_esv$)';
  end if;

  if v_clean_params is not null and array_length(v_clean_params, 1) > 0 then
    return v_host || v_path || '?' || array_to_string(v_clean_params, '&');
  end if;

  return v_host || v_path;
end;
$$;

-- Backfill seguro de negocios existentes
update public.businesses b
set
  normalized_google_review_url = public.normalize_google_review_url(b.google_review_url),
  canonical_email = coalesce(
    b.canonical_email,
    (select public.canonicalize_email(u.email) from auth.users u where u.id = b.user_id)
  );

insert into public.trial_claims (claim_type, claim_value, business_id, user_id)
select 'canonical_email', b.canonical_email, b.id, b.user_id
from public.businesses b
where b.canonical_email is not null
  and b.trial_restricted_reason is null
on conflict (claim_type, claim_value) do nothing;

insert into public.trial_claims (claim_type, claim_value, business_id, user_id)
select 'google_review_url', b.normalized_google_review_url, b.id, b.user_id
from public.businesses b
where b.normalized_google_review_url is not null
  and b.trial_restricted_reason is null
on conflict (claim_type, claim_value) do nothing;

drop policy if exists "Users can insert their own business" on public.businesses;
create policy "Users can insert their own business"
  on public.businesses
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and subscription_status in ('trialing', 'inactive')
  );

create or replace function public.protect_business_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_email text;
  v_canonical text;
  v_has_plus boolean := false;
  v_norm_url text;
  v_duplicate_url boolean := false;
  v_duplicate_email boolean := false;
begin
  v_norm_url := public.normalize_google_review_url(new.google_review_url);
  new.normalized_google_review_url := v_norm_url;

  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') then
      if new.subscription_status not in ('trialing', 'inactive') then
        raise exception 'No tienes permisos para establecer el estado de suscripción directamente.';
      end if;
      new.created_at := now();
    end if;

    select email into v_user_email
    from auth.users
    where id = new.user_id;

    if v_user_email is not null then
      v_canonical := public.canonicalize_email(v_user_email);
      v_has_plus := public.has_email_subaddressing(v_user_email);
      new.canonical_email := coalesce(new.canonical_email, v_canonical);

      if new.subscription_status = 'trialing' then
        select (
          exists (
            select 1
            from public.trial_claims tc
            where tc.claim_type = 'canonical_email'
              and tc.claim_value = v_canonical
              and tc.user_id is distinct from new.user_id
          )
          or exists (
            select 1
            from public.businesses b
            where b.canonical_email = v_canonical
              and b.user_id is distinct from new.user_id
          )
        )
        into v_duplicate_email;

        if v_has_plus or v_duplicate_email then
          new.subscription_status := 'inactive';
          new.trial_restricted_reason := case
            when v_has_plus then 'El correo electrónico usa un alias con "+" y no califica para el Trial gratuito automático. Selecciona un plan para comenzar.'
            else 'Este correo ya utilizó una prueba gratuita anteriormente. Selecciona un plan de pago para continuar.'
          end;
        end if;
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if current_user in ('anon', 'authenticated') then
      if new.subscription_status is distinct from old.subscription_status then
        raise exception 'No tienes permisos para modificar el estado de suscripción.';
      end if;
      if new.user_id is distinct from old.user_id then
        raise exception 'No tienes permisos para cambiar el propietario del negocio.';
      end if;
      if new.created_at is distinct from old.created_at then
        raise exception 'No tienes permisos para modificar la fecha de creación del negocio.';
      end if;
      if new.canonical_email is distinct from old.canonical_email then
        raise exception 'No tienes permisos para modificar el correo canónico del negocio.';
      end if;
      if new.trial_restricted_reason is distinct from old.trial_restricted_reason then
        raise exception 'No tienes permisos para modificar la restricción del período de prueba.';
      end if;
    end if;

    if old.subscription_status = 'trialing'
       and new.subscription_status = 'trialing'
       and v_norm_url is not null
       and v_norm_url is distinct from old.normalized_google_review_url then
      select (
        exists (
          select 1
          from public.trial_claims tc
          where tc.claim_type = 'google_review_url'
            and tc.claim_value = v_norm_url
            and tc.business_id is distinct from new.id
        )
        or exists (
          select 1
          from public.businesses b
          where b.normalized_google_review_url = v_norm_url
            and b.id is distinct from new.id
        )
      )
      into v_duplicate_url;

      if v_duplicate_url then
        new.subscription_status := 'inactive';
        new.trial_restricted_reason := 'Este enlace de Google Reviews ya utilizó una prueba gratuita anteriormente. Activa un plan de pago para continuar.';
      else
        insert into public.trial_claims (claim_type, claim_value, business_id, user_id)
        values ('google_review_url', v_norm_url, new.id, new.user_id)
        on conflict (claim_type, claim_value) do nothing;
      end if;
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_business_subscription on public.businesses;
create trigger trg_protect_business_subscription
  before insert or update on public.businesses
  for each row
  execute function public.protect_business_subscription();

create or replace function public.record_business_trial_claims()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subscription_status = 'trialing' then
    if new.canonical_email is not null then
      insert into public.trial_claims (claim_type, claim_value, business_id, user_id)
      values ('canonical_email', new.canonical_email, new.id, new.user_id)
      on conflict (claim_type, claim_value) do nothing;
    end if;
    if new.normalized_google_review_url is not null then
      insert into public.trial_claims (claim_type, claim_value, business_id, user_id)
      values ('google_review_url', new.normalized_google_review_url, new.id, new.user_id)
      on conflict (claim_type, claim_value) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_record_business_trial_claims on public.businesses;
create trigger trg_record_business_trial_claims
  after insert on public.businesses
  for each row
  execute function public.record_business_trial_claims();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canonical text;
  v_has_plus boolean;
  v_duplicate_email boolean := false;
  v_status text := 'trialing';
  v_reason text := null;
begin
  v_canonical := public.canonicalize_email(new.email);
  v_has_plus := public.has_email_subaddressing(new.email);

  if v_canonical is not null then
    select (
      exists (
        select 1
        from public.trial_claims tc
        where tc.claim_type = 'canonical_email'
          and tc.claim_value = v_canonical
          and tc.user_id is distinct from new.id
      )
      or exists (
        select 1
        from public.businesses b
        where b.canonical_email = v_canonical
          and b.user_id is distinct from new.id
      )
    )
    into v_duplicate_email;
  end if;

  if v_has_plus or v_duplicate_email then
    v_status := 'inactive';
    v_reason := case
      when v_has_plus then 'El correo electrónico usa un alias con "+" y no califica para el Trial gratuito automático. Selecciona un plan para comenzar.'
      else 'Este correo ya utilizó una prueba gratuita anteriormente. Selecciona un plan de pago para continuar.'
    end;
  end if;

  insert into public.businesses (
    user_id,
    business_name,
    subscription_status,
    canonical_email,
    trial_restricted_reason
  )
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'business_name'), ''), 'Mi Negocio'),
    v_status,
    v_canonical,
    v_reason
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop policy if exists "Users can delete their own review requests" on public.review_requests;
create policy "Users can delete their own review requests"
  on public.review_requests
  for delete
  to authenticated
  using (
    status = 'pending'
    and exists (
      select 1
      from public.businesses b
      where b.id = review_requests.business_id
        and b.user_id = (select auth.uid())
    )
  );

create or replace function public.enforce_trial_limits_on_review_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_created_at timestamptz;
  v_restricted_reason text;
  v_total_requests integer;
begin
  select subscription_status, created_at, trial_restricted_reason
  into v_status, v_created_at, v_restricted_reason
  from public.businesses
  where id = new.business_id
  for update;

  if not found then
    raise exception 'Negocio no encontrado.';
  end if;

  if v_status = 'active' then
    return new;
  end if;

  if v_status <> 'trialing' then
    raise exception '%', coalesce(
      nullif(trim(v_restricted_reason), ''),
      'Tu suscripción no está activa. Activa un plan para crear solicitudes de reseña.'
    );
  end if;

  if now() - v_created_at >= interval '7 days' then
    raise exception 'Tu período de prueba de 7 días ha finalizado. Activa un plan para continuar.';
  end if;

  select count(*)::integer
  into v_total_requests
  from public.review_requests
  where business_id = new.business_id;

  if v_total_requests >= 15 then
    raise exception 'Has alcanzado el límite de 15 solicitudes incluidas en el Plan Trial.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_trial_limits_on_review_request on public.review_requests;
create trigger trg_enforce_trial_limits_on_review_request
  before insert on public.review_requests
  for each row
  execute function public.enforce_trial_limits_on_review_request();
