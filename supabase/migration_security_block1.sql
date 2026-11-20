-- ============================================================================
-- PulsoLocal — Migración de Seguridad (Bloque 1)
-- Ejecuta este script en el SQL Editor de Supabase sobre una base existente
-- ============================================================================

-- 1. Proteger public.businesses contra auto-asignación de suscripción
drop policy if exists "Users can insert their own business" on public.businesses;
create policy "Users can insert their own business"
  on public.businesses
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and subscription_status = 'trialing'
  );

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

-- 2. Blindar public.feedback contra escritura directa desde cliente (conservar SELECT del dueño)
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

-- 3. Sincronizar funciones públicas RPC para /r/[requestId] (incluye owner_forbidden)
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
    exists (
      select 1 from public.feedback f where f.request_id = rr.id
    ) as has_feedback
  into v_row
  from public.review_requests rr
  inner join public.businesses b on b.id = rr.business_id
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
    'already_submitted', (v_row.status = 'completed' or v_row.has_feedback)
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
begin
  v_clean_comment := nullif(trim(coalesce(p_comment, '')), '');

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
  returning id into v_updated_id;

  if v_updated_id is null then
    return jsonb_build_object('error', 'not_found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.get_public_review_request(uuid) to anon, authenticated;
grant execute on function public.submit_public_feedback(uuid, smallint, text) to anon, authenticated;
grant execute on function public.update_public_feedback_comment(uuid, text) to anon, authenticated;
