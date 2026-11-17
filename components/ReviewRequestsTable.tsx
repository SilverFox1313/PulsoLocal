'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Inbox,
  MousePointerClick,
  Search,
  Send,
} from 'lucide-react';
import FormattedDate from '@/components/FormattedDate';
import type { ReviewRequest, ReviewRequestStatus } from '@/types/database';

interface ReviewRequestsTableProps {
  requests: ReviewRequest[];
}

type FilterStatus = 'all' | 'pending' | 'sent';

const STATUS_META: Record<
  ReviewRequestStatus,
  { label: string; textClass: string; Icon: typeof Clock }
> = {
  pending: {
    label: 'Pendiente',
    textClass: 'text-amber-600 dark:text-amber-400',
    Icon: Clock,
  },
  sent: {
    label: 'Enviada',
    textClass: 'text-emerald-600 dark:text-emerald-400',
    Icon: Send,
  },
  clicked: {
    label: 'Clic registrado',
    textClass: 'text-sky-600 dark:text-sky-400',
    Icon: MousePointerClick,
  },
  completed: {
    label: 'Completada',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    Icon: CheckCircle2,
  },
};

export default function ReviewRequestsTable({
  requests,
}: ReviewRequestsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function handleCopyLink(requestId: string) {
    try {
      const url = `${window.location.origin}/r/${requestId}`;
      await navigator.clipboard.writeText(url);
      setCopiedId(requestId);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === requestId ? null : prev));
      }, 2000);
    } catch {
      // Silencioso si el portapapeles no está disponible
    }
  }

  const filteredRequests = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return requests.filter((item) => {
      if (statusFilter === 'pending' && item.status !== 'pending') {
        return false;
      }
      if (statusFilter === 'sent' && item.status === 'pending') {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        item.customer_name.toLowerCase().includes(query) ||
        item.customer_phone.toLowerCase().includes(query)
      );
    });
  }, [requests, searchQuery, statusFilter]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-xs transition-colors duration-300 ease-in-out dark:border-zinc-700/80 dark:bg-zinc-900/90 dark:shadow-none">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-700/80">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
            Historial de solicitudes
          </h2>
          <p className="mt-0.5 text-sm text-slate-600 tabular-nums dark:text-zinc-300">
            {requests.length}{' '}
            {requests.length === 1
              ? 'solicitud registrada'
              : 'solicitudes registradas'}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-zinc-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar cliente o teléfono..."
              aria-label="Buscar solicitudes por cliente o teléfono"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 sm:w-56 dark:border-zinc-700 dark:bg-zinc-800/90 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-amber-500/60"
            />
          </div>

          <div
            role="group"
            aria-label="Filtrar por estado"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-zinc-700 dark:bg-zinc-800/90"
          >
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-700 dark:text-white dark:shadow-none'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-zinc-100'
              }`}
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('pending')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'pending'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-700 dark:text-white dark:shadow-none'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-zinc-100'
              }`}
            >
              Pendientes
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('sent')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'sent'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-zinc-700 dark:text-white dark:shadow-none'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-zinc-100'
              }`}
            >
              Enviadas
            </button>
          </div>
        </div>
      </div>

      {filteredRequests.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 dark:border-zinc-700 dark:bg-zinc-800/90 dark:text-zinc-300">
            <Inbox className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-800 dark:text-zinc-200">
            {requests.length === 0
              ? 'Aún no hay solicitudes registradas'
              : 'No hay solicitudes que coincidan con tu búsqueda'}
          </p>
          <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-zinc-400">
            {requests.length === 0
              ? 'Completa el formulario superior con el nombre y teléfono de tu primer cliente para programar su envío.'
              : 'Prueba cambiando el filtro de estado o limpiando el campo de búsqueda.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-zinc-700/80 dark:text-zinc-300">
                <th scope="col" className="px-6 py-3">
                  Cliente
                </th>
                <th scope="col" className="px-6 py-3">
                  Teléfono
                </th>
                <th scope="col" className="px-6 py-3">
                  Estado actual
                </th>
                <th scope="col" className="px-6 py-3 text-right">
                  Fecha programada
                </th>
                <th scope="col" className="px-6 py-3 text-right">
                  Enlace público
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-zinc-700/70">
              {filteredRequests.map((item) => {
                const statusInfo =
                  STATUS_META[item.status] ?? STATUS_META.pending;
                const StatusIcon = statusInfo.Icon;
                const isCopied = copiedId === item.id;

                return (
                  <tr
                    key={item.id}
                    className="transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800/60"
                  >
                    <td className="px-6 py-3.5 font-medium text-slate-900 dark:text-zinc-100">
                      {item.customer_name}
                    </td>
                    <td className="px-6 py-3.5 font-mono text-xs tabular-nums text-slate-600 dark:text-zinc-300">
                      {item.customer_phone}
                    </td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium ${statusInfo.textClass}`}
                      >
                        <StatusIcon
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span>{statusInfo.label}</span>
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right font-mono text-xs tabular-nums text-slate-500 dark:text-zinc-300">
                      <FormattedDate dateString={item.scheduled_for} />
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyLink(item.id)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-zinc-600 dark:bg-zinc-800/90 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-white whitespace-nowrap shrink-0"
                        >
                          {isCopied ? (
                            <>
                              <Check
                                className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                                aria-hidden="true"
                              />
                              <span className="text-emerald-700 dark:text-emerald-300">
                                Copiado
                              </span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Copiar</span>
                            </>
                          )}
                        </button>
                        <Link
                          href={`/r/${item.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Abrir enlace de reseña para ${item.customer_name}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-slate-300 hover:text-amber-600 dark:border-zinc-600 dark:bg-zinc-800/90 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-amber-300"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
