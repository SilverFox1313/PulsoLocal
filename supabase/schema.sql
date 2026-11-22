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
  message_template text not null default 'Hola {nombre}, gracias por elegir {negocio}. ¿Cómo calificarías tu experiencia hoy? {enlace}',
  delay_minutes integer not null default 60 check (delay_minutes >= 0 and delay_minutes <= 10080),
  subscription_status text not null default 'trialing' check (subscription_status in ('trialing', 'active', 'past_due', 'canceled', 'inactive')),
  created_at timestamptz not null default now()
);

create index if not exists idx_businesses_user_id on public.businesses(user_id);

-- ----------------------------------------------------------------------------
-- 2. TABLA: review_requests
-- Registro de solicitudes de reseña enviadas o programadas para clientes
-- ----------------------------------------------------------------------------
create table if not exists public.review_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_name text not null,
  customer_phone text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'clicked', 'completed')),
  processing_started_at timestamptz,
  scheduled_for timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_review_requests_business_id on public.review_requests(business_id);
create index if not exists idx_review_requests_status_scheduled on public.review_requests(status, scheduled_for);
create index if not exists idx_review_requests_processing_stuck
  on public.review_requests(processing_started_at)
  where status = 'processing';

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
    and subscription_status = 'trialing'
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

-- Protección contra auto-asignación de suscripción o manipulación de campos sensibles
create or replace function public.protect_business_subscription()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.subscription_status is distinct from 'trialing' then
        raise exception 'No tienes permisos para establecer el estado de suscripción directamente.';
      end if;
      new.created_at := now();
    elsif tg_op = 'UPDATE' then
      if new.subscription_status is distinct from old.subscription_status then
        raise exception 'No tienes permisos para modificar el estado de suscripción.';
      end if;
      if new.user_id is distinct from old.user_id then
        raise exception 'No tienes permisos para cambiar el propietario del negocio.';
      end if;
      if new.created_at is distinct from old.created_at then
        raise exception 'No tienes permisos para modificar la fecha de creación del negocio.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_business_subscription on public.businesses;
create trigger trg_protect_business_subscription
  before insert or update on public.businesses
  for each row
  execute function public.protect_business_subscription();

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
    exists (
      select 1
      from public.businesses b
      where b.id = review_requests.business_id
        and b.user_id = (select auth.uid())
    )
  );

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
begin
  insert into public.businesses (user_id, business_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'business_name'), ''), 'Mi Negocio')
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
