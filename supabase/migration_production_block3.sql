-- ============================================================================
-- PulsoLocal — Migración de Producción (Bloque 3)
-- 1. Configura REPLICA IDENTITY FULL para eventos DELETE filtrados en Realtime
-- 2. Actualiza get_public_review_request para recuperar comentario pendiente al recargar
-- 3. Endurece update_public_feedback_comment (solo si comment IS NULL y no vacío)
-- ============================================================================

alter table public.review_requests replica identity full;
alter table public.feedback replica identity full;

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
grant execute on function public.update_public_feedback_comment(uuid, text) to anon, authenticated;
