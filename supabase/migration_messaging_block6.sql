-- ============================================================================
-- PulsoLocal — Migración Bloque 6 (Cola de Mensajería, Anti-Duplicados y TOCTOU)
-- 1. Agrega estado 'failed' y columnas de trazabilidad (whatsapp_message_id, sent_at, last_error, attempts).
-- 2. Crea trigger BEFORE UPDATE para validar atómicamente el límite de 15 envíos del Plan Trial.
-- 3. Crea RPCs atómicas (claim_global_pending_review_requests y claim_user_pending_review_requests)
--    con FOR UPDATE SKIP LOCKED para evitar envíos duplicados, TOCTOU e inanición de la cola.
-- ============================================================================

alter table public.review_requests
  add column if not exists whatsapp_message_id text,
  add column if not exists sent_at timestamptz,
  add column if not exists last_error text,
  add column if not exists attempts integer not null default 0;

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'review_requests'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.review_requests drop constraint if exists %I', v_constraint_name);
  end loop;
end
$$;

alter table public.review_requests
  add constraint review_requests_status_check
  check (status in ('pending', 'processing', 'sent', 'clicked', 'completed', 'failed'));

drop index if exists idx_review_requests_processing_stuck;
create index if not exists idx_review_requests_processing_stuck
  on public.review_requests(processing_started_at)
  where status = 'processing' and whatsapp_message_id is null and sent_at is null;

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
  update public.review_requests rr
  set
    status = 'sent',
    processing_started_at = null,
    sent_at = coalesce(rr.sent_at, p_now)
  where rr.status = 'processing'
    and (rr.whatsapp_message_id is not null or rr.sent_at is not null);

  update public.review_requests rr
  set
    status = 'pending',
    processing_started_at = null
  where rr.status = 'processing'
    and rr.whatsapp_message_id is null
    and rr.sent_at is null
    and (rr.processing_started_at <= p_stale_before or rr.processing_started_at is null);

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
    for update;

    if v_biz_status = 'active' then
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

  select b.subscription_status, b.created_at, b.trial_restricted_reason
  into v_biz_status, v_biz_created_at, v_restricted_reason
  from public.businesses b
  where b.id = p_business_id
  for update;

  if not found then
    raise exception 'Negocio no encontrado.';
  end if;

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
