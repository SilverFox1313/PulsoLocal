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

create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  hits timestamptz[] not null default '{}',
  expires_at timestamptz not null
);

create index if not exists idx_rate_limit_buckets_expires_at
  on public.rate_limit_buckets(expires_at);

alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from public, anon, authenticated;

create or replace function public.check_and_consume_rate_limit(
  p_key text,
  p_max_requests integer,
  p_window_ms integer,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_max integer := greatest(coalesce(p_max_requests, 1), 1);
  v_window_ms integer := greatest(coalesce(p_window_ms, 1000), 1000);
  v_window interval := (v_window_ms::text || ' milliseconds')::interval;
  v_window_start timestamptz := v_now - v_window;
  v_hits timestamptz[];
  v_recent timestamptz[];
  v_retry_after integer;
begin
  if p_key is null or trim(p_key) = '' then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'retry_after_seconds', 60
    );
  end if;

  insert into public.rate_limit_buckets (bucket_key, hits, expires_at)
  values (p_key, '{}'::timestamptz[], v_now + v_window)
  on conflict (bucket_key) do nothing;

  select hits
  into v_hits
  from public.rate_limit_buckets
  where bucket_key = p_key
  for update;

  select coalesce(array_agg(ts order by ts), '{}'::timestamptz[])
  into v_recent
  from unnest(coalesce(v_hits, '{}'::timestamptz[])) as ts
  where ts > v_window_start;

  if coalesce(array_length(v_recent, 1), 0) >= v_max then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (v_recent[1] + v_window - v_now)))::integer
    );

    update public.rate_limit_buckets
    set
      hits = v_recent,
      expires_at = v_recent[1] + v_window
    where bucket_key = p_key;

    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'retry_after_seconds', v_retry_after
    );
  end if;

  v_recent := array_append(v_recent, v_now);

  update public.rate_limit_buckets
  set
    hits = v_recent,
    expires_at = v_now + v_window
  where bucket_key = p_key;

  delete from public.rate_limit_buckets
  where bucket_key in (
    select b.bucket_key
    from public.rate_limit_buckets b
    where b.expires_at < v_now - interval '5 minutes'
    limit 25
  );

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(0, v_max - array_length(v_recent, 1)),
    'retry_after_seconds', 0
  );
end;
$$;

create or replace function public.reset_rate_limit_bucket(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is not null and trim(p_key) <> '' then
    delete from public.rate_limit_buckets
    where bucket_key = p_key;
  end if;
end;
$$;

revoke all on function public.check_and_consume_rate_limit(text, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.check_and_consume_rate_limit(text, integer, integer, timestamptz) to service_role;
revoke all on function public.reset_rate_limit_bucket(text) from public, anon, authenticated;
grant execute on function public.reset_rate_limit_bucket(text) to service_role;

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

create or replace function public.current_user_email_confirmed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.current_user_email_confirmed() from public, anon;
grant execute on function public.current_user_email_confirmed() to authenticated, service_role;

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
  with check (
    (select auth.uid()) = user_id
    and delay_minutes >= 0
    and delay_minutes <= 10080
  );

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

create or replace function public.is_valid_google_review_url(p_url text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_url text;
  v_after_scheme text;
  v_before_hash_query text;
  v_authority text;
  v_host text;
  v_path text;
  v_lower_path text;
  v_tld text;
  v_google_tlds text[] := array[
    'com','ad','ae','al','am','as','at','az','ba','be','bg','bi','bj','bs','bt','by',
    'ca','cat','cd','cf','cg','ch','ci','cl','cm','cn','co.ao','co.bw','co.ck','co.cr',
    'co.id','co.il','co.in','co.jp','co.ke','co.kr','co.ls','co.ma','co.mz','co.nz',
    'co.th','co.tz','co.ug','co.uk','co.uz','co.ve','co.vi','co.za','co.zm','co.zw',
    'com.af','com.ag','com.ai','com.ar','com.au','com.bd','com.bh','com.bn','com.bo',
    'com.br','com.bz','com.co','com.cu','com.cy','com.do','com.ec','com.eg','com.et',
    'com.fj','com.gh','com.gi','com.gt','com.hk','com.jm','com.kh','com.kw','com.lb',
    'com.lc','com.ly','com.mm','com.mt','com.mx','com.my','com.na','com.nf','com.ng',
    'com.ni','com.np','com.om','com.pa','com.pe','com.pg','com.ph','com.pk','com.pr',
    'com.py','com.qa','com.sa','com.sb','com.sg','com.sl','com.sv','com.tj','com.tr',
    'com.tw','com.ua','com.uy','com.vc','com.vn','cv','cz','de','dj','dk','dm','dz',
    'ee','es','fi','fm','fr','ga','ge','gg','gl','gm','gp','gr','gy','hn','hr','ht',
    'hu','ie','im','iq','is','it','je','jo','kg','ki','kz','la','li','lk','lt','lu',
    'lv','md','me','mg','mk','ml','mn','ms','mu','mv','mw','ne','nl','no','nr','nu',
    'pl','pn','ps','pt','ro','rs','ru','rw','sc','se','sh','si','sk','sm','sn','so',
    'sr','st','td','tg','tk','tl','tm','tn','to','tt','vg','vu','ws'
  ];
begin
  v_url := trim(coalesce(p_url, ''));
  if v_url = '' or char_length(v_url) > 2048 then
    return false;
  end if;

  if v_url ~ E'[\\x01-\\x20\\x7F-\\x9F\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u206F\\uFEFF]' then
    return false;
  end if;

  if v_url !~* '^https://' then
    return false;
  end if;

  v_after_scheme := regexp_replace(v_url, '^https://', '', 'i');
  v_before_hash_query := split_part(split_part(v_after_scheme, '#', 1), '?', 1);
  v_authority := split_part(v_before_hash_query, '/', 1);

  if v_authority = ''
     or position('@' in v_authority) > 0
     or position(':' in v_authority) > 0
     or right(v_authority, 1) = '.' then
    return false;
  end if;

  v_host := lower(v_authority);

  if position('/' in v_before_hash_query) > 0 then
    v_path := substring(v_before_hash_query from position('/' in v_before_hash_query));
  else
    v_path := '/';
  end if;

  v_lower_path := lower(v_path);

  if v_lower_path in ('/url', '/aclk', '/amp')
     or v_lower_path like '/url/%'
     or v_lower_path like '/aclk/%'
     or v_lower_path like '/amp/%' then
    return false;
  end if;

  if v_host in ('g.page', 'www.g.page') then
    return char_length(v_path) > 1;
  end if;

  if v_host = 'maps.app.goo.gl' then
    return char_length(v_path) > 1;
  end if;

  if v_host in ('goo.gl', 'www.goo.gl') then
    return v_lower_path like '/maps/%' and char_length(v_path) > 6;
  end if;

  if v_host like 'maps.google.%' then
    v_tld := substring(v_host from length('maps.google.') + 1);
    return v_tld = any(v_google_tlds);
  end if;

  if v_host like 'search.google.%' then
    v_tld := substring(v_host from length('search.google.') + 1);
    return v_tld = any(v_google_tlds)
      and (
        v_lower_path in ('/local/writereview', '/local/reviews')
        or v_lower_path like '/local/writereview/%'
        or v_lower_path like '/local/reviews/%'
      );
  end if;

  if v_host like 'www.google.%' then
    v_tld := substring(v_host from length('www.google.') + 1);
    return v_tld = any(v_google_tlds)
      and (
        v_lower_path in ('/maps', '/local/writereview', '/local/reviews')
        or v_lower_path like '/maps/%'
        or v_lower_path like '/local/writereview/%'
        or v_lower_path like '/local/reviews/%'
      );
  end if;

  if v_host like 'google.%' then
    v_tld := substring(v_host from length('google.') + 1);
    return v_tld = any(v_google_tlds)
      and (
        v_lower_path in ('/maps', '/local/writereview', '/local/reviews')
        or v_lower_path like '/maps/%'
        or v_lower_path like '/local/writereview/%'
        or v_lower_path like '/local/reviews/%'
      );
  end if;

  return false;
end;
$$;

create or replace function public.sanitize_and_validate_template_name(
  p_raw text,
  p_field_label text default 'nombre',
  p_max_len integer default 50
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_trimmed text;
  v_cleaned text;
begin
  v_trimmed := trim(coalesce(p_raw, ''));

  if v_trimmed ~ E'[\\x01-\\x1F\\x7F-\\x9F\\u2028-\\u202E\\u2066-\\u2069]' then
    raise exception 'El % no puede contener saltos de línea ni caracteres de control.', p_field_label;
  end if;

  v_cleaned := regexp_replace(
    v_trimmed,
    E'[\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0]',
    '',
    'g'
  );
  v_cleaned := regexp_replace(
    v_cleaned,
    E'[\\u00A0\\u2000-\\u200A\\u202F\\u205F\\u3000]',
    ' ',
    'g'
  );
  v_cleaned := trim(regexp_replace(v_cleaned, ' {2,}', ' ', 'g'));

  if char_length(v_cleaned) < 2 or char_length(v_cleaned) > greatest(coalesce(p_max_len, 50), 2) then
    raise exception 'El % debe tener entre 2 y % caracteres.', p_field_label, greatest(coalesce(p_max_len, 50), 2);
  end if;

  if v_cleaned ~ '[<>]' then
    raise exception 'El % no puede contener etiquetas HTML ni los símbolos < o >.', p_field_label;
  end if;

  if v_cleaned ~* '(https?://|ftp://|mailto:|tel:|whatsapp:|\mwww\.|\mwa\.me/|\mt\.me/|\mbit\.ly\M|\mtinyurl\.com\M|\mgoo\.gl\M)'
     or v_cleaned ~* '\m[a-z0-9-]{2,}\.(com|net|org|edu|gov|io|co|app|dev|me|info|biz|xyz|top|online|site|store|shop|club|vip|link|ly|gg|cc|tv|click|live|pro|cloud|ai|es|mx|ar|cl|pe|ec|do|gt|cr|pa|us|uk|ca|br|fr|de|ru|cn|tk|ml|ga|cf|gq)\M'
     or v_cleaned ~* '\m[a-z0-9-]{2,}\.[a-z]{2,10}/\S*' then
    raise exception 'El % no puede contener enlaces, URLs ni nombres de dominio.', p_field_label;
  end if;

  return v_cleaned;
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
  v_effective_role text := coalesce(nullif(auth.role(), ''), current_user);
  v_is_client boolean := (
    v_effective_role in ('anon', 'authenticated')
    and current_setting('pulsolocal.trusted_rpc', true) is distinct from 'on'
  );
begin
  if v_is_client then
    new.business_name := public.sanitize_and_validate_template_name(
      new.business_name,
      'nombre del negocio',
      50
    );

    if new.google_review_url is not null and trim(new.google_review_url) <> '' then
      new.google_review_url := trim(new.google_review_url);
      if not public.is_valid_google_review_url(new.google_review_url) then
        raise exception 'El enlace no es válido. Copia y pega el enlace de reseñas directo desde Google Maps o tu perfil de negocio de Google.';
      end if;
    else
      new.google_review_url := null;
    end if;

    if new.delay_minutes is null or new.delay_minutes < 0 or new.delay_minutes > 10080 then
      raise exception 'El retraso en minutos debe ser un número entero entre 0 y 10080 (7 días).';
    end if;
  end if;

  v_norm_url := public.normalize_google_review_url(new.google_review_url);
  new.normalized_google_review_url := v_norm_url;

  if tg_op = 'INSERT' then
    if v_is_client then
      if new.subscription_status not in ('trialing', 'inactive') then
        raise exception 'No tienes permisos para establecer el estado de suscripción directamente.';
      end if;
      new.created_at := now();
      new.trial_restricted_reason := null;
    end if;

    select email into v_user_email
    from auth.users
    where id = new.user_id;

    if v_user_email is not null then
      v_canonical := public.canonicalize_email(v_user_email);
      v_has_plus := public.has_email_subaddressing(v_user_email);
      if v_is_client then
        new.canonical_email := v_canonical;
      else
        new.canonical_email := coalesce(new.canonical_email, v_canonical);
      end if;

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
      elsif new.subscription_status = 'inactive' and v_has_plus and new.trial_restricted_reason is null then
        new.trial_restricted_reason := 'El correo electrónico usa un alias con "+" y no califica para el Trial gratuito automático. Selecciona un plan para comenzar.';
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if v_is_client then
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
      if new.message_template is distinct from old.message_template then
        raise exception 'No tienes permisos para modificar la plantilla base de mensajes.';
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
    status = 'pending'
    and whatsapp_message_id is null
    and sent_at is null
    and last_error is null
    and coalesce(attempts, 0) = 0
    and processing_started_at is null
    and scheduled_for >= now() - interval '5 minutes'
    and scheduled_for <= now() + interval '30 days'
    and public.current_user_email_confirmed()
    and exists (
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
    status = 'pending'
    and public.current_user_email_confirmed()
    and exists (
      select 1
      from public.businesses b
      where b.id = review_requests.business_id
        and b.user_id = (select auth.uid())
    )
  )
  with check (
    status = 'pending'
    and whatsapp_message_id is null
    and sent_at is null
    and last_error is null
    and processing_started_at is null
    and scheduled_for >= now() - interval '5 minutes'
    and scheduled_for <= now() + interval '30 days'
    and public.current_user_email_confirmed()
    and exists (
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

-- Límite estricto atómico en PostgreSQL al crear solicitudes (TOCTOU, pendientes simultáneas 50/500, ráfagas 10/min y 60/h, Trial)
create or replace function public.enforce_trial_limits_on_review_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
  v_status text;
  v_created_at timestamptz;
  v_restricted_reason text;
  v_total_requests integer;
  v_pending_requests integer;
  v_pending_limit integer;
  v_recent_minute integer;
  v_recent_hour integer;
  v_effective_role text := coalesce(nullif(auth.role(), ''), current_user);
  v_is_client boolean := (
    v_effective_role in ('anon', 'authenticated')
    and current_setting('pulsolocal.trusted_rpc', true) is distinct from 'on'
  );
begin
  select user_id, subscription_status, created_at, trial_restricted_reason
  into v_owner_user_id, v_status, v_created_at, v_restricted_reason
  from public.businesses
  where id = new.business_id
  for update;

  if not found then
    raise exception 'Negocio no encontrado.';
  end if;

  if v_is_client then
    if not exists (
      select 1
      from auth.users u
      where u.id = v_owner_user_id
        and u.email_confirmed_at is not null
    ) then
      raise exception 'Debes confirmar tu correo electrónico antes de programar o enviar solicitudes de reseña.';
    end if;

    new.customer_name := public.sanitize_and_validate_template_name(
      new.customer_name,
      'nombre del cliente',
      50
    );

    new.customer_phone := trim(coalesce(new.customer_phone, ''));
    if new.customer_phone !~ '^\+[1-9][0-9]{6,14}$' then
      raise exception 'Ingresa un número de teléfono válido (entre 7 y 15 dígitos, con código de país).';
    end if;

    if new.scheduled_for is null
       or new.scheduled_for < now() - interval '5 minutes'
       or new.scheduled_for > now() + interval '30 days' then
      raise exception 'La fecha de envío programada debe estar dentro de los próximos 30 días.';
    end if;

    new.status := 'pending';
    new.whatsapp_message_id := null;
    new.sent_at := null;
    new.last_error := null;
    new.attempts := 0;
    new.processing_started_at := null;
    new.created_at := now();

    select count(*)::integer
    into v_recent_minute
    from public.review_requests
    where business_id = new.business_id
      and created_at >= now() - interval '1 minute';

    if v_recent_minute >= 10 then
      raise exception 'Has alcanzado el límite temporal de creación de solicitudes. Espera un momento antes de continuar.';
    end if;

    select count(*)::integer
    into v_recent_hour
    from public.review_requests
    where business_id = new.business_id
      and created_at >= now() - interval '1 hour';

    if v_recent_hour >= 60 then
      raise exception 'Has alcanzado el límite temporal de creación de solicitudes. Espera un momento antes de continuar.';
    end if;
  end if;

  if v_status <> 'active' then
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
  end if;

  v_pending_limit := case when v_status = 'active' then 500 else 50 end;

  select count(*)::integer
  into v_pending_requests
  from public.review_requests
  where business_id = new.business_id
    and status = 'pending';

  if v_pending_requests >= v_pending_limit then
    raise exception 'Has alcanzado el máximo de % solicitudes pendientes simultáneas en cola. Envía o elimina solicitudes pendientes antes de agregar más.', v_pending_limit;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_trial_limits_on_review_request on public.review_requests;
create trigger trg_enforce_trial_limits_on_review_request
  before insert on public.review_requests
  for each row
  execute function public.enforce_trial_limits_on_review_request();

-- Bloqueo atómico en actualización y despacho de solicitudes
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
  v_effective_role text := coalesce(nullif(auth.role(), ''), current_user);
  v_is_client boolean := (
    v_effective_role in ('anon', 'authenticated')
    and current_setting('pulsolocal.trusted_rpc', true) is distinct from 'on'
  );
begin
  if v_is_client then
    if old.status <> 'pending' or new.status <> 'pending' then
      raise exception 'Solo se pueden editar solicitudes pendientes (ya fue procesada).';
    end if;
    if new.id is distinct from old.id
       or new.business_id is distinct from old.business_id
       or new.created_at is distinct from old.created_at
       or new.attempts is distinct from old.attempts
       or new.whatsapp_message_id is distinct from old.whatsapp_message_id
       or new.sent_at is distinct from old.sent_at
       or new.last_error is distinct from old.last_error
       or new.processing_started_at is distinct from old.processing_started_at then
      raise exception 'No tienes permisos para modificar campos internos de la solicitud.';
    end if;

    new.customer_name := public.sanitize_and_validate_template_name(
      new.customer_name,
      'nombre del cliente',
      50
    );

    new.customer_phone := trim(coalesce(new.customer_phone, ''));
    if new.customer_phone !~ '^\+[1-9][0-9]{6,14}$' then
      raise exception 'Ingresa un número de teléfono válido (entre 7 y 15 dígitos, con código de país).';
    end if;

    if new.scheduled_for is null
       or new.scheduled_for < now() - interval '5 minutes'
       or new.scheduled_for > now() + interval '30 days' then
      raise exception 'La fecha programada debe estar dentro de los próximos 30 días.';
    end if;
  end if;

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

-- RPC atómica para cola global de Cron: reconcilia envíos confirmados, cierra intentos agotados, rescata atascados y evita inanición
drop function if exists public.claim_global_pending_review_requests(integer, timestamptz, timestamptz);
drop function if exists public.claim_global_pending_review_requests(integer, timestamptz, timestamptz, integer);

create or replace function public.claim_global_pending_review_requests(
  p_limit integer default 10,
  p_now timestamptz default now(),
  p_stale_before timestamptz default (now() - interval '5 minutes'),
  p_max_attempts integer default 3
)
returns table (
  id uuid,
  business_id uuid,
  customer_name text,
  customer_phone text,
  scheduled_for timestamptz,
  attempts integer,
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
  v_locked_id uuid;
  v_biz_status text;
  v_biz_created_at timestamptz;
  v_dispatched_count integer;
  v_eligible boolean;
  v_claimed integer := 0;
  v_target_limit integer := greatest(coalesce(p_limit, 10), 1);
  v_max_attempts integer := greatest(coalesce(p_max_attempts, 3), 1);
  v_new_attempts integer;
begin
  perform set_config('pulsolocal.trusted_rpc', 'on', true);

  -- 1. Reconciliar filas en 'processing' que ya tienen confirmación externa de Meta (evita reenvíos duplicados)
  update public.review_requests rr
  set
    status = 'sent',
    processing_started_at = null,
    sent_at = coalesce(rr.sent_at, p_now),
    last_error = null
  where rr.status = 'processing'
    and (rr.whatsapp_message_id is not null or rr.sent_at is not null);

  -- 2a. Cerrar como 'failed' las filas atascadas que ya alcanzaron el límite de reintentos
  update public.review_requests rr
  set
    status = 'failed',
    processing_started_at = null,
    last_error = coalesce(
      nullif(trim(rr.last_error), ''),
      'Se alcanzó el límite máximo de 3 intentos de envío por WhatsApp.'
    )
  where rr.status = 'processing'
    and rr.whatsapp_message_id is null
    and rr.sent_at is null
    and coalesce(rr.attempts, 0) >= v_max_attempts
    and (rr.processing_started_at <= p_stale_before or rr.processing_started_at is null);

  -- 2b. Rescatar únicamente filas atascadas sin confirmación de envío y con intentos disponibles
  update public.review_requests rr
  set
    status = 'pending',
    processing_started_at = null
  where rr.status = 'processing'
    and rr.whatsapp_message_id is null
    and rr.sent_at is null
    and coalesce(rr.attempts, 0) < v_max_attempts
    and (rr.processing_started_at <= p_stale_before or rr.processing_started_at is null);

  -- 2c. Limpiar filas en 'pending' que ya excedieron el máximo de intentos para que no bloqueen el lote
  update public.review_requests rr
  set
    status = 'failed',
    processing_started_at = null,
    last_error = coalesce(
      nullif(trim(rr.last_error), ''),
      'Se alcanzó el límite máximo de 3 intentos de envío por WhatsApp.'
    )
  where rr.status = 'pending'
    and coalesce(rr.attempts, 0) >= v_max_attempts;

  -- 3. Selección round-robin por negocio elegible (evita inanición y mantiene orden de bloqueo businesses -> review_requests)
  for v_row in
    with eligible_businesses as (
      select
        b.id,
        b.business_name,
        b.message_template,
        b.subscription_status,
        b.created_at,
        case
          when b.subscription_status = 'active' then v_target_limit
          else greatest(
            0,
            least(
              v_target_limit,
              15 - (
                select count(*)::integer
                from public.review_requests r2
                where r2.business_id = b.id
                  and r2.status in ('processing', 'sent', 'clicked', 'completed')
              )
            )
          )
        end as biz_allowance
      from public.businesses b
      inner join auth.users u on u.id = b.user_id
      where u.email_confirmed_at is not null
        and (
          b.subscription_status = 'active'
          or (
            b.subscription_status = 'trialing'
            and b.created_at > p_now - interval '7 days'
          )
        )
    ),
    ranked_candidates as (
      select
        rr.id,
        rr.business_id,
        rr.customer_name,
        rr.customer_phone,
        rr.scheduled_for,
        rr.created_at,
        eb.business_name,
        eb.message_template,
        eb.subscription_status,
        eb.created_at as business_created_at,
        eb.biz_allowance,
        row_number() over (
          partition by rr.business_id
          order by rr.scheduled_for asc, rr.created_at asc
        ) as biz_rank
      from public.review_requests rr
      inner join eligible_businesses eb on eb.id = rr.business_id
      where eb.biz_allowance > 0
        and rr.status = 'pending'
        and coalesce(rr.attempts, 0) < v_max_attempts
        and rr.scheduled_for <= p_now
    )
    select
      rc.id,
      rc.business_id,
      rc.customer_name,
      rc.customer_phone,
      rc.scheduled_for,
      rc.business_name,
      rc.message_template,
      rc.subscription_status,
      rc.business_created_at
    from ranked_candidates rc
    where rc.biz_rank <= rc.biz_allowance
    order by rc.biz_rank asc, rc.scheduled_for asc, rc.created_at asc
    limit greatest(v_target_limit * 5, 100)
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

    select rr.id
    into v_locked_id
    from public.review_requests rr
    where rr.id = v_row.id
      and rr.status = 'pending'
      and coalesce(rr.attempts, 0) < v_max_attempts
    for update skip locked;

    if not found then
      continue;
    end if;

    update public.review_requests rr
    set
      status = 'processing',
      processing_started_at = p_now,
      attempts = coalesce(rr.attempts, 0) + 1
    where rr.id = v_locked_id
      and rr.status = 'pending'
      and coalesce(rr.attempts, 0) < v_max_attempts
    returning rr.attempts into v_new_attempts;

    if found then
      id := v_row.id;
      business_id := v_row.business_id;
      customer_name := v_row.customer_name;
      customer_phone := v_row.customer_phone;
      scheduled_for := v_row.scheduled_for;
      attempts := v_new_attempts;
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

revoke all on function public.claim_global_pending_review_requests(integer, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_global_pending_review_requests(integer, timestamptz, timestamptz, integer) to service_role;

-- RPC atómica para envío manual del usuario autenticado (con bloqueo FOR UPDATE sobre el negocio)
drop function if exists public.claim_user_pending_review_requests(uuid, boolean, integer, timestamptz, timestamptz);
drop function if exists public.claim_user_pending_review_requests(uuid, boolean, integer, timestamptz, timestamptz, integer);

create or replace function public.claim_user_pending_review_requests(
  p_business_id uuid,
  p_include_future boolean default false,
  p_limit integer default 10,
  p_now timestamptz default now(),
  p_stale_before timestamptz default (now() - interval '5 minutes'),
  p_max_attempts integer default 3
)
returns table (
  id uuid,
  business_id uuid,
  customer_name text,
  customer_phone text,
  scheduled_for timestamptz,
  attempts integer
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
  v_max_attempts integer := greatest(coalesce(p_max_attempts, 3), 1);
  v_new_attempts integer;
  v_row record;
  v_effective_role text := coalesce(nullif(auth.role(), ''), current_user);
begin
  if v_effective_role in ('anon', 'authenticated') then
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

  perform set_config('pulsolocal.trusted_rpc', 'on', true);

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
    sent_at = coalesce(rr.sent_at, p_now),
    last_error = null
  where rr.business_id = p_business_id
    and rr.status = 'processing'
    and (rr.whatsapp_message_id is not null or rr.sent_at is not null);

  update public.review_requests rr
  set
    status = 'failed',
    processing_started_at = null,
    last_error = coalesce(
      nullif(trim(rr.last_error), ''),
      'Se alcanzó el límite máximo de 3 intentos de envío por WhatsApp.'
    )
  where rr.business_id = p_business_id
    and rr.status = 'processing'
    and rr.whatsapp_message_id is null
    and rr.sent_at is null
    and coalesce(rr.attempts, 0) >= v_max_attempts
    and (rr.processing_started_at <= p_stale_before or rr.processing_started_at is null);

  update public.review_requests rr
  set
    status = 'pending',
    processing_started_at = null
  where rr.business_id = p_business_id
    and rr.status = 'processing'
    and rr.whatsapp_message_id is null
    and rr.sent_at is null
    and coalesce(rr.attempts, 0) < v_max_attempts
    and (rr.processing_started_at <= p_stale_before or rr.processing_started_at is null);

  update public.review_requests rr
  set
    status = 'failed',
    processing_started_at = null,
    last_error = coalesce(
      nullif(trim(rr.last_error), ''),
      'Se alcanzó el límite máximo de 3 intentos de envío por WhatsApp.'
    )
  where rr.business_id = p_business_id
    and rr.status = 'pending'
    and coalesce(rr.attempts, 0) >= v_max_attempts;

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
      and coalesce(rr.attempts, 0) < v_max_attempts
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
      and rr.status = 'pending'
      and coalesce(rr.attempts, 0) < v_max_attempts
    returning rr.attempts into v_new_attempts;

    if found then
      id := v_row.id;
      business_id := v_row.business_id;
      customer_name := v_row.customer_name;
      customer_phone := v_row.customer_phone;
      scheduled_for := v_row.scheduled_for;
      attempts := v_new_attempts;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.claim_user_pending_review_requests(uuid, boolean, integer, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.claim_user_pending_review_requests(uuid, boolean, integer, timestamptz, timestamptz, integer) to authenticated, service_role;

-- RPC atómica para confirmar entrega en Meta y limpiar marcas de procesamiento
create or replace function public.complete_review_request_delivery(
  p_request_id uuid,
  p_external_id text default null,
  p_sent_at timestamptz default now(),
  p_business_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_role text := coalesce(nullif(auth.role(), ''), current_user);
  v_updated_id uuid;
begin
  if v_effective_role in ('anon', 'authenticated') then
    if not exists (
      select 1
      from public.review_requests rr
      inner join public.businesses b on b.id = rr.business_id
      where rr.id = p_request_id
        and (p_business_id is null or rr.business_id = p_business_id)
        and b.user_id = auth.uid()
    ) then
      return jsonb_build_object('ok', false, 'error', 'No autorizado.');
    end if;
  end if;

  perform set_config('pulsolocal.trusted_rpc', 'on', true);

  update public.review_requests rr
  set
    status = 'sent',
    whatsapp_message_id = coalesce(nullif(trim(p_external_id), ''), rr.whatsapp_message_id),
    sent_at = coalesce(rr.sent_at, p_sent_at, now()),
    processing_started_at = null,
    last_error = null
  where rr.id = p_request_id
    and (p_business_id is null or rr.business_id = p_business_id)
    and rr.status in ('processing', 'sent')
  returning rr.id into v_updated_id;

  if v_updated_id is null then
    return jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada o en estado no modificable.');
  end if;

  return jsonb_build_object('ok', true, 'id', v_updated_id);
end;
$$;

revoke all on function public.complete_review_request_delivery(uuid, text, timestamptz, uuid) from public, anon;
grant execute on function public.complete_review_request_delivery(uuid, text, timestamptz, uuid) to authenticated, service_role;

-- RPC atómica para registrar fallo o devolver a cola respetando el límite máximo de intentos
create or replace function public.fail_or_requeue_review_request(
  p_request_id uuid,
  p_retryable boolean,
  p_error text default null,
  p_max_attempts integer default 3,
  p_business_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_role text := coalesce(nullif(auth.role(), ''), current_user);
  v_attempts integer;
  v_max_attempts integer := greatest(coalesce(p_max_attempts, 3), 1);
  v_target_status text;
  v_clean_error text := left(coalesce(trim(p_error), ''), 500);
begin
  if v_effective_role in ('anon', 'authenticated') then
    if not exists (
      select 1
      from public.review_requests rr
      inner join public.businesses b on b.id = rr.business_id
      where rr.id = p_request_id
        and (p_business_id is null or rr.business_id = p_business_id)
        and b.user_id = auth.uid()
    ) then
      return jsonb_build_object('ok', false, 'error', 'No autorizado.');
    end if;
  end if;

  select coalesce(rr.attempts, 1)
  into v_attempts
  from public.review_requests rr
  where rr.id = p_request_id
    and (p_business_id is null or rr.business_id = p_business_id)
    and rr.status = 'processing'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada en procesamiento.');
  end if;

  v_target_status := case
    when coalesce(p_retryable, false) and v_attempts < v_max_attempts then 'pending'
    else 'failed'
  end;

  perform set_config('pulsolocal.trusted_rpc', 'on', true);

  update public.review_requests rr
  set
    status = v_target_status,
    processing_started_at = null,
    last_error = nullif(v_clean_error, '')
  where rr.id = p_request_id;

  return jsonb_build_object('ok', true, 'status', v_target_status, 'attempts', v_attempts);
end;
$$;

revoke all on function public.fail_or_requeue_review_request(uuid, boolean, text, integer, uuid) from public, anon;
grant execute on function public.fail_or_requeue_review_request(uuid, boolean, text, integer, uuid) to authenticated, service_role;

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

  v_clean_comment := nullif(trim(coalesce(p_comment, '')), '');
  if v_clean_comment is not null and char_length(v_clean_comment) > 500 then
    return jsonb_build_object('error', 'comment_too_long');
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

  begin
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
  exception
    when unique_violation then
      return jsonb_build_object('error', 'already_submitted');
  end;

  perform set_config('pulsolocal.trusted_rpc', 'on', true);

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

  if char_length(v_clean_comment) > 500 then
    return jsonb_build_object('error', 'comment_too_long');
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
