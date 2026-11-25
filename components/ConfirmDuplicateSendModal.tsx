'use client';

import { useEffect } from 'react';
import { AlertTriangle, Loader2, Send, X } from 'lucide-react';
import {
  REVIEW_STATUS_LABELS_ES,
  type PendingRequestDuplicateAlert,
} from '@/lib/messaging/request-history';
import type { ReviewRequestStatus } from '@/types/database';

interface ConfirmDuplicateSendModalProps {
  alerts: PendingRequestDuplicateAlert[];
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

function formatAlertDate(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Intl.DateTimeFormat('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(parsed);
}

function getStatusTextClass(status: ReviewRequestStatus): string {
  switch (status) {
    case 'completed':
    case 'sent':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'clicked':
      return 'text-sky-700 dark:text-sky-300';
    case 'failed':
      return 'text-red-700 dark:text-red-300';
    case 'processing':
    case 'pending':
    default:
      return 'text-amber-800 dark:text-amber-300';
  }
}

export default function ConfirmDuplicateSendModal({
  alerts,
  submitting = false,
  onCancel,
  onConfirm,
}: ConfirmDuplicateSendModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, submitting]);

  const count = alerts.length;
  const hasSentOrCompleted = alerts.some(
    (item) => item.hasPriorSentOrCompleted
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-duplicate-send-title"
      onClick={() => {
        if (!submitting) {
          onCancel();
        }
      }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl transition-colors dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-white/[0.04]">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h3
                id="confirm-duplicate-send-title"
                className="text-base font-semibold tracking-tight text-slate-900 dark:text-zinc-50"
              >
                {count === 1
                  ? 'Confirmar envío a cliente con historial previo'
                  : `Confirmar envío a ${count} clientes con historial previo`}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                {hasSentOrCompleted
                  ? 'Detectamos solicitudes pendientes cuyo teléfono ya recibió al menos una invitación anterior en tu negocio. Confirma si deseas enviarles nuevamente o cancela para revisar o eliminar duplicados.'
                  : 'Detectamos solicitudes pendientes cuyo teléfono ya figura registrado previamente en el historial de tu negocio. Confirma si deseas continuar con el envío o cancela para revisar antes de procesar.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            aria-label="Cerrar confirmación de envío"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 dark:border-none dark:bg-[#27272E] dark:text-zinc-300 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] dark:hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 py-4">
          <div className="max-h-64 space-y-2.5 overflow-y-auto pr-1">
            {alerts.map((item) => {
              const statusLabel =
                REVIEW_STATUS_LABELS_ES[item.latestStatus] ?? 'Pendiente';
              const dateLabel = formatAlertDate(
                item.latestCreatedAt ?? item.latestScheduledFor
              );
              const sentLabel =
                item.previousSentCount > 0
                  ? item.previousSentCount === 1
                    ? '1 envío previo completado/enviado'
                    : `${item.previousSentCount} envíos previos completados/enviados`
                  : item.previousCount === 1
                    ? '1 registro previo'
                    : `${item.previousCount} registros previos`;

              return (
                <div
                  key={item.pendingRequestId}
                  className="rounded-lg border border-amber-200/80 bg-amber-50/70 px-3.5 py-3 text-sm dark:border-amber-500/25 dark:bg-amber-500/10"
                >
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 break-words font-semibold text-slate-900 dark:text-zinc-100">
                      {item.customerName || 'Cliente'}
                    </span>
                    <span className="font-mono text-sm tabular-nums text-slate-700 dark:text-slate-300">
                      {item.customerPhone}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700 dark:text-slate-300">
                    <span className="font-medium tabular-nums">
                      {sentLabel}
                      {item.previousSentCount > 0 &&
                      item.previousCount > item.previousSentCount
                        ? ` (${item.previousCount} en total)`
                        : ''}
                    </span>
                    <span aria-hidden="true" className="text-slate-600 dark:text-slate-300">
                      ·
                    </span>
                    <span>
                      Último estado:{' '}
                      <span
                        className={`font-semibold ${getStatusTextClass(
                          item.latestStatus
                        )}`}
                      >
                        {statusLabel}
                      </span>
                    </span>
                    {dateLabel && (
                      <>
                        <span aria-hidden="true" className="text-slate-600 dark:text-slate-300">
                          ·
                        </span>
                        <span className="text-slate-600 dark:text-slate-300">
                          {dateLabel}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-end dark:border-white/[0.04]">
            <button
              type="button"
              disabled={submitting}
              onClick={onCancel}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-none dark:bg-[#27272E] dark:text-zinc-200 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] whitespace-nowrap shrink-0"
            >
              Cancelar y revisar
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={onConfirm}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-orange-500 bg-gradient-to-r from-amber-500 to-orange-500 px-4 text-sm font-semibold text-white shadow-xs transition-all hover:from-amber-600 hover:to-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Enviando...</span>
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" aria-hidden="true" />
                  <span>Enviar de todas formas</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
