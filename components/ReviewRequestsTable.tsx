'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Inbox,
  MousePointerClick,
  Pencil,
  Search,
  Send,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import DeleteReviewRequestModal from '@/components/DeleteReviewRequestModal';
import EditReviewRequestModal from '@/components/EditReviewRequestModal';
import FormattedDate from '@/components/FormattedDate';
import type { ReviewRequest, ReviewRequestStatus } from '@/types/database';

interface ReviewRequestsTableProps {
  requests: ReviewRequest[];
  onRequestUpdated?: (updated: ReviewRequest) => void;
  onRequestDeleted?: (deletedId: string) => void;
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

const PAGE_SIZE = 10;

function getPageNumbers(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, idx) => idx + 1);
  }

  const pages: Array<number | 'ellipsis'> = [1];

  if (current > 3) {
    pages.push('ellipsis');
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let p = start; p <= end; p += 1) {
    pages.push(p);
  }

  if (current < total - 2) {
    pages.push('ellipsis');
  }

  pages.push(total);
  return pages;
}

export default function ReviewRequestsTable({
  requests,
  onRequestUpdated,
  onRequestDeleted,
}: ReviewRequestsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingRequest, setEditingRequest] = useState<ReviewRequest | null>(
    null
  );
  const [deletingRequest, setDeletingRequest] = useState<ReviewRequest | null>(
    null
  );

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setCurrentPage(1);
  }

  function handleStatusFilterChange(nextFilter: FilterStatus) {
    setStatusFilter(nextFilter);
    setCurrentPage(1);
  }

  async function handleCopyLink(requestId: string) {
    try {
      const url = `${window.location.origin}/r/${requestId}`;
      await navigator.clipboard.writeText(url);
      setCopiedId(requestId);
      toast.info('Enlace copiado al portapapeles');
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === requestId ? null : prev));
      }, 2000);
    } catch {
      toast.error('No se pudo copiar el enlace al portapapeles');
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

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedRequests = filteredRequests.slice(
    startIndex,
    startIndex + PAGE_SIZE
  );
  const showingFrom = filteredRequests.length === 0 ? 0 : startIndex + 1;
  const showingTo = Math.min(startIndex + PAGE_SIZE, filteredRequests.length);
  const pageNumbers = getPageNumbers(safePage, totalPages);

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-xs transition-colors duration-300 ease-in-out dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.04]">
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
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Buscar cliente o teléfono..."
              aria-label="Buscar solicitudes por cliente o teléfono"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 sm:w-64 sm:min-w-[260px] dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
            />
          </div>

          <div
            role="group"
            aria-label="Filtrar por estado"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-transparent dark:bg-[#27272E] dark:shadow-inner dark:shadow-black/30"
          >
            <button
              type="button"
              onClick={() => handleStatusFilterChange('all')}
              className={`rounded-md px-3 py-1 text-xs transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'all'
                  ? 'bg-white text-slate-900 font-semibold shadow-xs dark:bg-[#383842] dark:text-white dark:shadow-md dark:shadow-black/50'
                  : 'font-medium text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-zinc-100 hover:dark:bg-[#32323A]/70'
              }`}
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => handleStatusFilterChange('pending')}
              className={`rounded-md px-3 py-1 text-xs transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'pending'
                  ? 'bg-white text-slate-900 font-semibold shadow-xs dark:bg-[#383842] dark:text-white dark:shadow-md dark:shadow-black/50'
                  : 'font-medium text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-zinc-100 hover:dark:bg-[#32323A]/70'
              }`}
            >
              Pendientes
            </button>
            <button
              type="button"
              onClick={() => handleStatusFilterChange('sent')}
              className={`rounded-md px-3 py-1 text-xs transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'sent'
                  ? 'bg-white text-slate-900 font-semibold shadow-xs dark:bg-[#383842] dark:text-white dark:shadow-md dark:shadow-black/50'
                  : 'font-medium text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-zinc-100 hover:dark:bg-[#32323A]/70'
              }`}
            >
              Enviadas
            </button>
          </div>
        </div>
      </div>

      {filteredRequests.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-300 dark:shadow-sm dark:shadow-black/40">
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
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-white/[0.04] dark:text-zinc-300">
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
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/[0.04]">
              {paginatedRequests.map((item) => {
                const statusInfo =
                  STATUS_META[item.status] ?? STATUS_META.pending;
                const StatusIcon = statusInfo.Icon;
                const isCopied = copiedId === item.id;

                return (
                  <tr
                    key={item.id}
                    className="transition-colors hover:bg-orange-500/[0.08] dark:hover:bg-orange-500/[0.08]"
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
                        {item.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => setEditingRequest(item)}
                            aria-label={`Editar solicitud de ${item.customer_name}`}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 transition-colors hover:border-amber-400 hover:bg-amber-500/10 hover:text-amber-600 dark:border-none dark:bg-[#27272E] dark:text-zinc-200 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] dark:hover:text-amber-300 whitespace-nowrap shrink-0"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Editar</span>
                          </button>
                        )}
                        {item.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => setDeletingRequest(item)}
                            aria-label={`Eliminar solicitud pendiente de ${item.customer_name}`}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 transition-colors hover:border-red-400 hover:bg-red-500/10 hover:text-red-600 dark:border-none dark:bg-[#27272E] dark:text-zinc-200 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] dark:hover:text-red-300 whitespace-nowrap shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Borrar</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleCopyLink(item.id)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 transition-colors hover:border-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-600 dark:border-none dark:bg-[#27272E] dark:text-zinc-200 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] dark:hover:text-emerald-300 whitespace-nowrap shrink-0"
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
                          onClick={() =>
                            toast.info(`Abriendo enlace de ${item.customer_name}`)
                          }
                          aria-label={`Abrir enlace de reseña para ${item.customer_name}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 transition-colors hover:border-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-600 dark:border-none dark:bg-[#27272E] dark:text-zinc-200 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] dark:hover:text-cyan-300 whitespace-nowrap shrink-0"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Abrir</span>
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

      {filteredRequests.length > PAGE_SIZE && (
        <div className="flex flex-col gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.04]">
          <p className="text-xs text-slate-600 tabular-nums dark:text-zinc-300">
            Mostrando <span className="font-medium text-slate-900 dark:text-zinc-100">{showingFrom}–{showingTo}</span> de{' '}
            <span className="font-medium text-slate-900 dark:text-zinc-100">{filteredRequests.length}</span> solicitudes
          </p>

          <nav
            aria-label="Paginación de solicitudes"
            className="flex flex-wrap items-center justify-between gap-2 sm:justify-end"
          >
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-45 dark:border-none dark:bg-[#27272E] dark:text-zinc-200 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] whitespace-nowrap shrink-0"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Anterior</span>
            </button>

            <div className="hidden items-center gap-1 sm:inline-flex">
              {pageNumbers.map((entry, idx) =>
                entry === 'ellipsis' ? (
                  <span
                    key={`ellipsis-${idx}`}
                    className="px-1.5 text-xs text-slate-400 dark:text-zinc-500"
                    aria-hidden="true"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => setCurrentPage(entry)}
                    aria-current={safePage === entry ? 'page' : undefined}
                    className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-medium tabular-nums transition-colors ${
                      safePage === entry
                        ? 'border-orange-500 bg-orange-500/10 text-orange-600 dark:border-none dark:bg-orange-500/20 dark:text-orange-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-none dark:bg-[#27272E] dark:text-zinc-300 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] dark:hover:text-white'
                    }`}
                  >
                    {entry}
                  </button>
                )
              )}
            </div>

            <span className="text-xs font-medium tabular-nums text-slate-600 sm:hidden dark:text-zinc-300">
              Página {safePage} de {totalPages}
            </span>

            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() =>
                setCurrentPage((prev) => Math.min(totalPages, prev + 1))
              }
              className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-45 dark:border-none dark:bg-[#27272E] dark:text-zinc-200 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] whitespace-nowrap shrink-0"
            >
              <span>Siguiente</span>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </nav>
        </div>
      )}

      {editingRequest && (
        <EditReviewRequestModal
          key={editingRequest.id}
          request={editingRequest}
          onClose={() => setEditingRequest(null)}
          onSaved={(updated) => {
            onRequestUpdated?.(updated);
          }}
        />
      )}

      {deletingRequest && (
        <DeleteReviewRequestModal
          key={deletingRequest.id}
          request={deletingRequest}
          onClose={() => setDeletingRequest(null)}
          onDeleted={(deletedId) => {
            const nextCount = Math.max(0, filteredRequests.length - 1);
            const nextTotalPages = Math.max(1, Math.ceil(nextCount / PAGE_SIZE));
            if (currentPage > nextTotalPages) {
              setCurrentPage(nextTotalPages);
            }
            onRequestDeleted?.(deletedId);
          }}
        />
      )}
    </section>
  );
}
