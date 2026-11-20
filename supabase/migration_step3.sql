-- ============================================================================
-- PulsoLocal — Paso 3: Funciones públicas seguras para /r/[requestId]
-- Ejecuta este script en el SQL Editor de Supabase
-- ============================================================================

-- Evita respuestas duplicadas para una misma solicitud de reseña
create unique index if not exists idx_feedback_unique_request_id
  on public.feedback(request_id);

-- 1. Obtener datos públicos seguros de una solicitud de reseña (sin exponer teléfono ni user_id)
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

-- 2. Registrar calificación (1-5 estrellas) y retornar enlace oficial de Google
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

-- 3. Guardar comentario privado adicional tras seleccionar 1-3 estrellas
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
