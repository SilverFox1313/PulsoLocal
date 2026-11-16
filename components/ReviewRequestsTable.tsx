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
    textClass: 'text-amber-400',
    Icon: Clock,
  },
  sent: {
    label: 'Enviada',
    textClass: 'text-emerald-400',
    Icon: Send,
  },
  clicked: {
    label: 'Clic registrado',
    textClass: 'text-sky-400',
    Icon: MousePointerClick,
  },
  completed: {
    label: 'Completada',
    textClass: 'text-emerald-300',
    Icon: CheckCircle2,
  },
};

const DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

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
    <section className="rounded-xl border border-zinc-800 bg-[#111114]">
      <div className="flex flex-col gap-4 border-b border-zinc-800/80 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-50">
            Historial de solicitudes
          </h2>
          <p className="mt-0.5 text-sm text-zinc-400 tabular-nums">
            {requests.length}{' '}
            {requests.length === 1
              ? 'solicitud registrada'
              : 'solicitudes registradas'}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar cliente o teléfono..."
              aria-label="Buscar solicitudes por cliente o teléfono"
              className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-amber-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 sm:w-56"
            />
          </div>

          <div
            role="group"
            aria-label="Filtrar por estado"
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1"
          >
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'all'
                  ? 'bg-zinc-800 text-zinc-50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('pending')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'pending'
                  ? 'bg-zinc-800 text-zinc-50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Pendientes
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('sent')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'sent'
                  ? 'bg-zinc-800 text-zinc-50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Enviadas
            </button>
          </div>
        </div>
      </div>

      {filteredRequests.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-500">
            <Inbox className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm font-medium text-zinc-200">
            {requests.length === 0
              ? 'Aún no hay solicitudes registradas'
              : 'No hay solicitudes que coincidan con tu búsqueda'}
          </p>
          <p className="mt-1 max-w-sm text-xs text-zinc-500">
            {requests.length === 0
              ? 'Completa el formulario superior con el nombre y teléfono de tu primer cliente para programar su envío.'
              : 'Prueba cambiando el filtro de estado o limpiando el campo de búsqueda.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800/80 text-xs font-medium text-zinc-400">
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
            <tbody className="divide-y divide-zinc-800/60">
              {filteredRequests.map((item) => {
                const statusInfo =
                  STATUS_META[item.status] ?? STATUS_META.pending;
                const StatusIcon = statusInfo.Icon;
                const isCopied = copiedId === item.id;

                return (
                  <tr
                    key={item.id}
                    className="transition-colors hover:bg-zinc-900/50"
                  >
                    <td className="px-6 py-3.5 font-medium text-zinc-100">
                      {item.customer_name}
                    </td>
                    <td className="px-6 py-3.5 font-mono text-xs tabular-nums text-zinc-300">
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
                    <td className="px-6 py-3.5 text-right font-mono text-xs tabular-nums text-zinc-400">
                      {DATE_FORMATTER.format(new Date(item.scheduled_for))}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyLink(item.id)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100 whitespace-nowrap shrink-0"
                        >
                          {isCopied ? (
                            <>
                              <Check
                                className="h-3.5 w-3.5 text-emerald-400"
                                aria-hidden="true"
                              />
                              <span className="text-emerald-300">Copiado</span>
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
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-amber-300"
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
