'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { deleteReviewRequestAction } from '@/app/dashboard/actions';
import type { ReviewRequest } from '@/types/database';

interface DeleteReviewRequestModalProps {
  request: ReviewRequest;
  onClose: () => void;
  onDeleted: (deletedId: string) => void;
}

export default function DeleteReviewRequestModal({
  request,
  onClose,
  onDeleted,
}: DeleteReviewRequestModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !deleting) {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleting, onClose]);

  async function handleConfirmDelete() {
    if (deleting) return;
    setError(null);
    setDeleting(true);

    try {
      const result = await deleteReviewRequestAction(request.id);

      if (result.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }

      if (result.deletedId) {
        onDeleted(result.deletedId);
        toast.success(`Solicitud de ${request.customer_name} eliminada`);
        onClose();
      }
    } catch {
      const msg =
        'No se pudo eliminar la solicitud por un problema de conexión. Inténtalo nuevamente.';
      setError(msg);
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-request-modal-title"
      onClick={() => {
        if (!deleting) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl transition-colors dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-white/[0.04]">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-400">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h3
                id="delete-request-modal-title"
                className="text-base font-semibold tracking-tight text-slate-900 dark:text-zinc-50"
              >
                ¿Eliminar la solicitud pendiente de {request.customer_name}?
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                Esta acción eliminará el registro pendiente ({request.customer_phone}) y no se puede deshacer.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={deleting}
            onClick={onClose}
            aria-label="Cerrar confirmación"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 dark:border-none dark:bg-[#27272E] dark:text-zinc-300 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] dark:hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 py-4">
          {error && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-200"
            >
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
                aria-hidden="true"
              />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              disabled={deleting}
              onClick={onClose}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-none dark:bg-[#27272E] dark:text-zinc-200 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] whitespace-nowrap shrink-0"
            >
              Cancelar
            </button>

            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleConfirmDelete()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-red-600 dark:hover:bg-red-500 dark:focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Eliminando...</span>
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span>Eliminar</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
