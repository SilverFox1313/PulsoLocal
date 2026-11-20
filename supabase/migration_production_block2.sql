-- ============================================================================
-- PulsoLocal — Migración de Producción (Bloque 2)
-- Permite el estado intermedio 'processing' en public.review_requests
-- para reserva atómica y prevención de envíos duplicados de WhatsApp.
-- ============================================================================

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.review_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format(
      'alter table public.review_requests drop constraint if exists %I',
      v_constraint_name
    );
  end loop;
end
$$;

alter table public.review_requests
  add constraint review_requests_status_check
  check (status in ('pending', 'processing', 'sent', 'clicked', 'completed'));
