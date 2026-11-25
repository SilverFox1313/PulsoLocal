-- ============================================================================
-- PulsoLocal — Automatizador de Reseñas y Reputación Local
-- Script SQL inicial para ejecutar en el SQL Editor de Supabase
-- ============================================================================

-- Extensión necesaria para gen_random_uuid() (habilitada por defecto en Supabase)
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. TABLA: businesses
-- Almacena la configuración de cada negocio vinculado a un usuario de auth.users
-- ----------------------------------------------------------------------------
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  business_name text not null default 'Mi Negocio',
  google_review_url text,
  normalized_google_review_url text,
  canonical_email text,
  trial_restricted_reason text,
  message_template text not null default 'Hola {nombre}, gracias por elegir {negocio}. ¿Cómo calificarías tu experiencia hoy? {enlace}',
  delay_minutes integer not null default 60 check (delay_minutes >= 0 and delay_minutes <= 10080),
  subscription_status text not null default 'trialing' check (subscription_status in ('trialing', 'active', 'past_due', 'canceled', 'inactive')),
  created_at timestamptz not null default now()
);

create index if not exists idx_businesses_user_id on public.businesses(user_id);
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

-- ----------------------------------------------------------------------------
-- 2. TABLA: review_requests
-- Registro de solicitudes de reseña enviadas o programadas para clientes
-- ----------------------------------------------------------------------------
create table if not exists public.review_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_name text not null,
  customer_phone text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'clicked', 'completed', 'failed')),
  whatsapp_message_id text,
  sent_at timestamptz,
  last_error text,
  attempts integer not null default 0,
  processing_started_at timestamptz,
  scheduled_for timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_review_requests_business_id on public.review_requests(business_id);
create index if not exists idx_review_requests_status_scheduled on public.review_requests(status, scheduled_for);
create index if not exists idx_review_requests_processing_stuck
  on public.review_requests(processing_started_at)
  where status = 'processing' and whatsapp_message_id is null and sent_at is null;

-- ----------------------------------------------------------------------------
-- 3. TABLA: feedback
-- Calificaciones (1-5) y comentarios internos capturados antes de redirigir a Google
-- ----------------------------------------------------------------------------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.review_requests(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  rating smallint not null check (rating >= 1 and rating <= 5),
  comment text,
  redirected_to_google boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_business_id on public.feedback(business_id);
create index if not exists idx_feedback_request_id on public.feedback(request_id);

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS)
-- Garantiza que cada usuario autenticado solo acceda a los datos de su negocio
-- ----------------------------------------------------------------------------
alter table public.businesses enable row level security;
alter table public.review_requests enable row level security;
alter table public.feedback enable row level security;

-- Políticas para businesses
drop policy if exists "Users can view their own business" on public.businesses;
create policy "Users can view their own business"
  on public.businesses
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own business" on public.businesses;
create policy "Users can insert their own business"
  on public.businesses
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and subscription_status in ('trialing', 'inactive')
  );

drop policy if exists "Users can update their own business" on public.businesses;
create policy "Users can update their own business"
  on public.businesses
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own business" on public.businesses;
create policy "Users can delete their own business"
  on public.businesses
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

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

-- Protección contra auto-asignación de suscripción, manipulación de campos sensibles y reutilización de Trial
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

-- Políticas para review_requests
drop policy if exists "Users can view their own review requests" on public.review_requests;
create policy "Users can view their own review requests"
  on public.review_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = review_requests.business_id
        and b.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert their own review requests" on public.review_requests;
create policy "Users can insert their own review requests"
  on public.review_requests
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.businesses b
      where b.id = review_requests.business_id
        and b.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can update their own review requests" on public.review_requests;
create policy "Users can update their own review requests"
  on public.review_requests
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = review_requests.business_id
        and b.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.businesses b
      where b.id = review_requests.business_id
        and b.user_id = (select auth.uid())
    )
  );

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

-- Límite estricto en PostgreSQL para Plan Trial (7 días y máximo 15 solicitudes; sin límite para 'active')
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

-- Bloqueo atómico en despacho (pending -> processing/sent) para evitar condición de carrera TOCTOU en límite de 15 envíos
create or replace function public.enforce_trial_limits_on_review_request_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_created_at timestamptz;
  v_restricted_reason text;
  v_dispatched_requests integer;
begin
  if old.status = 'pending' and new.status in ('processing', 'sent') then
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
        'Tu suscripción no está activa. Activa un plan para enviar mensajes por WhatsApp.'
      );
    end if;

    if now() - v_created_at >= interval '7 days' then
      raise exception 'Tu período de prueba de 7 días ha finalizado. Activa un plan para continuar.';
    end if;

    select count(*)::integer
    into v_dispatched_requests
    from public.review_requests
    where business_id = new.business_id
      and id <> new.id
      and status in ('processing', 'sent', 'clicked', 'completed');

    if v_dispatched_requests >= 15 then
      raise exception 'Has alcanzado el límite de 15 envíos por WhatsApp del Plan Trial.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_trial_limits_on_dispatch on public.review_requests;
create trigger trg_enforce_trial_limits_on_dispatch
  before update on public.review_requests
  for each row
  execute function public.enforce_trial_limits_on_review_request_dispatch();

-- RPC atómica para cola global de Cron: reconcilia envíos confirmados, rescata colas atascadas y evita inanición
create or replace function public.claim_global_pending_review_requests(
  p_limit integer default 10,
  p_now timestamptz default now(),
  p_stale_before timestamptz default (now() - interval '5 minutes')
)
returns table (
  id uuid,
  business_id uuid,
  customer_name text,
  customer_phone text,
  scheduled_for timestamptz,
  business_name text,
  message_template text,
  subscription_status text,
  business_created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_biz_status text;
  v_biz_created_at timestamptz;
  v_dispatched_count integer;
  v_eligible boolean;
  v_claimed integer := 0;
  v_target_limit integer := greatest(coalesce(p_limit, 10), 1);
begin
  -- 1. Reconciliar filas en 'processing' que ya tienen confirmación externa de Meta (evita reenvíos duplicados)
  update public.review_requests rr
  set
    status = 'sent',
    processing_started_at = null,
    sent_at = coalesce(rr.sent_at, p_now)
  where rr.status = 'processing'
    and (rr.whatsapp_message_id is not null or rr.sent_at is not null);

  -- 2. Rescatar únicamente filas atascadas sin confirmación de envío
  update public.review_requests rr
  set
    status = 'pending',
    processing_started_at = null
  where rr.status = 'processing'
    and rr.whatsapp_message_id is null
    and rr.sent_at is null
    and (rr.processing_started_at <= p_stale_before or rr.processing_started_at is null);

  -- 3. Seleccionar solo negocios elegibles en SQL para evitar inanición de la cola
  for v_row in
    select
      rr.id,
      rr.business_id,
      rr.customer_name,
      rr.customer_phone,
      rr.scheduled_for,
      b.business_name,
      b.message_template,
      b.subscription_status,
      b.created_at as business_created_at
    from public.review_requests rr
    inner join public.businesses b on b.id = rr.business_id
    where rr.status = 'pending'
      and rr.scheduled_for <= p_now
      and exists (
        select 1
        from auth.users u
        where u.id = b.user_id
          and u.email_confirmed_at is not null
      )
      and (
        b.subscription_status = 'active'
        or (
          b.subscription_status = 'trialing'
          and b.created_at > p_now - interval '7 days'
          and (
            select count(*)
            from public.review_requests r2
            where r2.business_id = b.id
              and r2.status in ('processing', 'sent', 'clicked', 'completed')
          ) < 15
        )
      )
    order by rr.scheduled_for asc
    for update of rr skip locked
    limit greatest(v_target_limit * 5, 50)
  loop
    select b.subscription_status, b.created_at
    into v_biz_status, v_biz_created_at
    from public.businesses b
    where b.id = v_row.business_id
      and exists (
        select 1
        from auth.users u
        where u.id = b.user_id
          and u.email_confirmed_at is not null
      )
    for update;

    if not found then
      v_eligible := false;
    elsif v_biz_status = 'active' then
      v_eligible := true;
    elsif v_biz_status = 'trialing' and v_biz_created_at > p_now - interval '7 days' then
      select count(*)::integer
      into v_dispatched_count
      from public.review_requests r2
      where r2.business_id = v_row.business_id
        and r2.status in ('processing', 'sent', 'clicked', 'completed');

      v_eligible := (v_dispatched_count < 15);
    else
      v_eligible := false;
    end if;

    if not v_eligible then
      continue;
    end if;

    update public.review_requests rr
    set
      status = 'processing',
      processing_started_at = p_now,
      attempts = coalesce(rr.attempts, 0) + 1
    where rr.id = v_row.id
      and rr.status = 'pending';

    if found then
      id := v_row.id;
      business_id := v_row.business_id;
      customer_name := v_row.customer_name;
      customer_phone := v_row.customer_phone;
      scheduled_for := v_row.scheduled_for;
      business_name := v_row.business_name;
      message_template := v_row.message_template;
      subscription_status := v_row.subscription_status;
      business_created_at := v_row.business_created_at;
      return next;

      v_claimed := v_claimed + 1;
      exit when v_claimed >= v_target_limit;
    end if;
  end loop;
end;
$$;

revoke all on function public.claim_global_pending_review_requests(integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_global_pending_review_requests(integer, timestamptz, timestamptz) to service_role;

-- RPC atómica para envío manual del usuario autenticado (con bloqueo FOR UPDATE sobre el negocio)
create or replace function public.claim_user_pending_review_requests(
  p_business_id uuid,
  p_include_future boolean default false,
  p_limit integer default 10,
  p_now timestamptz default now(),
  p_stale_before timestamptz default (now() - interval '5 minutes')
)
returns table (
  id uuid,
  business_id uuid,
  customer_name text,
  customer_phone text,
  scheduled_for timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_biz_status text;
  v_biz_created_at timestamptz;
  v_restricted_reason text;
  v_dispatched_count integer := 0;
  v_remaining integer;
  v_target_limit integer := greatest(coalesce(p_limit, 10), 1);
  v_row record;
begin
  if current_user in ('anon', 'authenticated') then
    if not exists (
      select 1
      from public.businesses b
      where b.id = p_business_id
        and b.user_id = auth.uid()
    ) then
      raise exception 'No autorizado para procesar solicitudes de este negocio.';
    end if;
  end if;

  if not exists (
    select 1
    from public.businesses b
    inner join auth.users u on u.id = b.user_id
    where b.id = p_business_id
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Debes confirmar tu correo electrónico antes de enviar solicitudes por WhatsApp.';
  end if;

  select b.subscription_status, b.created_at, b.trial_restricted_reason
  into v_biz_status, v_biz_created_at, v_restricted_reason
  from public.businesses b
  where b.id = p_business_id
  for update;

  if not found then
    raise exception 'Negocio no encontrado.';
  end if;

  -- Reconciliar envíos ya confirmados por Meta antes de rescatar atascados
  update public.review_requests rr
  set
    status = 'sent',
    processing_started_at = null,
    sent_at = coalesce(rr.sent_at, p_now)
  where rr.business_id = p_business_id
    and rr.status = 'processing'
    and (rr.whatsapp_message_id is not null or rr.sent_at is not null);

  update public.review_requests rr
  set
    status = 'pending',
    processing_started_at = null
  where rr.business_id = p_business_id
    and rr.status = 'processing'
    and rr.whatsapp_message_id is null
    and rr.sent_at is null
    and (rr.processing_started_at <= p_stale_before or rr.processing_started_at is null);

  if v_biz_status = 'active' then
    v_remaining := v_target_limit;
  elsif v_biz_status = 'trialing' then
    if p_now - v_biz_created_at >= interval '7 days' then
      raise exception 'Tu período de prueba de 7 días ha finalizado. Activa un plan para seguir enviando mensajes por WhatsApp.';
    end if;

    select count(*)::integer
    into v_dispatched_count
    from public.review_requests r2
    where r2.business_id = p_business_id
      and r2.status in ('processing', 'sent', 'clicked', 'completed');

    v_remaining := least(v_target_limit, greatest(0, 15 - v_dispatched_count));
    if v_remaining <= 0 then
      raise exception 'Has alcanzado el límite de 15 envíos por WhatsApp del Plan Trial. Activa un plan para continuar.';
    end if;
  else
    raise exception '%', coalesce(
      nullif(trim(v_restricted_reason), ''),
      'Tu suscripción no está activa. Selecciona un plan de pago para enviar mensajes por WhatsApp.'
    );
  end if;

  for v_row in
    select
      rr.id,
      rr.business_id,
      rr.customer_name,
      rr.customer_phone,
      rr.scheduled_for
    from public.review_requests rr
    where rr.business_id = p_business_id
      and rr.status = 'pending'
      and (p_include_future or rr.scheduled_for <= p_now)
    order by rr.scheduled_for asc
    for update of rr skip locked
    limit v_remaining
  loop
    update public.review_requests rr
    set
      status = 'processing',
      processing_started_at = p_now,
      attempts = coalesce(rr.attempts, 0) + 1
    where rr.id = v_row.id
      and rr.status = 'pending';

    if found then
      id := v_row.id;
      business_id := v_row.business_id;
      customer_name := v_row.customer_name;
      customer_phone := v_row.customer_phone;
      scheduled_for := v_row.scheduled_for;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.claim_user_pending_review_requests(uuid, boolean, integer, timestamptz, timestamptz) from public, anon;
grant execute on function public.claim_user_pending_review_requests(uuid, boolean, integer, timestamptz, timestamptz) to authenticated, service_role;

-- Políticas para feedback (solo lectura para el dueño; escrituras exclusivamente vía backend / funciones SECURITY DEFINER)
drop policy if exists "Users can view their own feedback" on public.feedback;
create policy "Users can view their own feedback"
  on public.feedback
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = feedback.business_id
        and b.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert their own feedback" on public.feedback;
drop policy if exists "Users can update their own feedback" on public.feedback;
drop policy if exists "Users can delete their own feedback" on public.feedback;

revoke all on public.feedback from anon;
revoke insert, update, delete on public.feedback from authenticated;
grant select on public.feedback to authenticated;

-- ----------------------------------------------------------------------------
-- 5. TRIGGER AUTOMÁTICO DE ONBOARDING
-- Crea la fila inicial en public.businesses cuando un usuario se registra en auth.users
-- ----------------------------------------------------------------------------
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 6. PASO 3: FUNCIONES PÚBLICAS SEGURAS PARA /r/[requestId]
-- ----------------------------------------------------------------------------
create unique index if not exists idx_feedback_unique_request_id
  on public.feedback(request_id);

create or replace function public.get_public_review_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select
    rr.id as request_id,
    rr.customer_name,
    rr.status,
    b.id as business_id,
    b.business_name,
    b.google_review_url,
    f.rating as feedback_rating,
    f.comment as feedback_comment
  into v_row
  from public.review_requests rr
  inner join public.businesses b on b.id = rr.business_id
  left join public.feedback f on f.request_id = rr.id
  where rr.id = p_request_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'request_id', v_row.request_id,
    'customer_name', v_row.customer_name,
    'status', v_row.status,
    'business_id', v_row.business_id,
    'business_name', v_row.business_name,
    'google_review_url', v_row.google_review_url,
    'already_submitted', (v_row.status = 'completed' or v_row.feedback_rating is not null),
    'submitted_rating', v_row.feedback_rating,
    'needs_private_comment', (
      v_row.feedback_rating is not null
      and v_row.feedback_rating <= 3
      and v_row.feedback_comment is null
    )
  );
end;
$$;

create or replace function public.submit_public_feedback(
  p_request_id uuid,
  p_rating smallint,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_redirected boolean;
  v_clean_comment text;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'La calificación debe estar entre 1 y 5 estrellas.';
  end if;

  select
    rr.id,
    rr.business_id,
    rr.status,
    b.user_id as owner_user_id,
    b.google_review_url
  into v_request
  from public.review_requests rr
  inner join public.businesses b on b.id = rr.business_id
  where rr.id = p_request_id
  for update of rr;

  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  if auth.uid() is not null and v_request.owner_user_id = auth.uid() then
    return jsonb_build_object('error', 'owner_forbidden');
  end if;

  if v_request.status = 'completed' or exists (
    select 1 from public.feedback f where f.request_id = p_request_id
  ) then
    return jsonb_build_object('error', 'already_submitted');
  end if;

  v_redirected := (p_rating >= 4);
  v_clean_comment := nullif(trim(coalesce(p_comment, '')), '');

  insert into public.feedback (
    request_id,
    business_id,
    rating,
    comment,
    redirected_to_google
  )
  values (
    p_request_id,
    v_request.business_id,
    p_rating,
    v_clean_comment,
    v_redirected
  );

  update public.review_requests
  set status = 'completed'
  where id = p_request_id;

  return jsonb_build_object(
    'success', true,
    'rating', p_rating,
    'redirected_to_google', v_redirected,
    'google_review_url', v_request.google_review_url
  );
end;
$$;

create or replace function public.update_public_feedback_comment(
  p_request_id uuid,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean_comment text;
  v_updated_id uuid;
  v_existing_comment text;
begin
  v_clean_comment := nullif(trim(coalesce(p_comment, '')), '');
  if v_clean_comment is null then
    return jsonb_build_object('error', 'empty_comment');
  end if;

  if auth.uid() is not null and exists (
    select 1
    from public.review_requests rr
    inner join public.businesses b on b.id = rr.business_id
    where rr.id = p_request_id
      and b.user_id = auth.uid()
  ) then
    return jsonb_build_object('error', 'owner_forbidden');
  end if;

  update public.feedback
  set comment = v_clean_comment
  where request_id = p_request_id
    and rating <= 3
    and comment is null
  returning id into v_updated_id;

  if v_updated_id is null then
    select f.comment
    into v_existing_comment
    from public.feedback f
    where f.request_id = p_request_id;

    if found and v_existing_comment is not null then
      return jsonb_build_object('error', 'already_commented');
    end if;

    return jsonb_build_object('error', 'not_found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.get_public_review_request(uuid) to anon, authenticated;
grant execute on function public.submit_public_feedback(uuid, smallint, text) to anon, authenticated;
grant execute on function public.update_public_feedback_comment(uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. SUPABASE REALTIME
-- Habilita eventos en tiempo real (incluyendo DELETE con filtros) para solicitudes y opiniones privadas
-- ----------------------------------------------------------------------------
alter table public.review_requests replica identity full;
alter table public.feedback replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'review_requests'
    ) then
      alter publication supabase_realtime add table public.review_requests;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'feedback'
    ) then
      alter publication supabase_realtime add table public.feedback;
    end if;
  end if;
end
$$;
