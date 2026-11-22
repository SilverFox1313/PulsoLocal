-- ============================================================================
-- PulsoLocal — Migración de Producción (Bloque 4 / Rescate de cola)
-- Agrega processing_started_at en public.review_requests para rescatar
-- automáticamente solicitudes atascadas en 'processing' tras más de 5 minutos.
-- ============================================================================

alter table public.review_requests
  add column if not exists processing_started_at timestamptz;

create index if not exists idx_review_requests_processing_stuck
  on public.review_requests(processing_started_at)
  where status = 'processing';
