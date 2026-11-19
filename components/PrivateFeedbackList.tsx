'use client';

import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  MessageSquareOff,
  Search,
  Star,
} from 'lucide-react';
import FormattedDate from '@/components/FormattedDate';
import type { PrivateFeedbackItem } from '@/types/database';

interface PrivateFeedbackListProps {
  items: PrivateFeedbackItem[];
}

type RatingFilter = 'negative' | 'all';

const PAGE_SIZE = 10;

function getPageNumbers(
  current: number,
  total: number
): Array<number | 'ellipsis'> {
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

export default function PrivateFeedbackList({
  items,
}: PrivateFeedbackListProps) {
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('negative');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setCurrentPage(1);
  }

  function handleRatingFilterChange(nextFilter: RatingFilter) {
    setRatingFilter(nextFilter);
    setCurrentPage(1);
  }

  const negativeCount = useMemo(
    () => items.filter((item) => item.rating <= 3).length,
    [items]
  );

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (ratingFilter === 'negative' && item.rating > 3) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        item.customer_name.toLowerCase().includes(query) ||
        item.customer_phone.toLowerCase().includes(query) ||
        (item.comment ?? '').toLowerCase().includes(query)
      );
    });
  }, [items, ratingFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedItems = filteredItems.slice(
    startIndex,
    startIndex + PAGE_SIZE
  );
  const showingFrom = filteredItems.length === 0 ? 0 : startIndex + 1;
  const showingTo = Math.min(startIndex + PAGE_SIZE, filteredItems.length);
  const pageNumbers = getPageNumbers(safePage, totalPages);

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-xs transition-colors duration-300 ease-in-out dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.04]">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
            Opiniones privadas
          </h2>
          <p className="mt-0.5 text-sm text-slate-600 tabular-nums dark:text-zinc-300">
            {negativeCount}{' '}
            {negativeCount === 1
              ? 'calificación privada de 1 a 3 estrellas'
              : 'calificaciones privadas de 1 a 3 estrellas'}
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
              placeholder="Buscar cliente o comentario"
              aria-label="Buscar opiniones privadas"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 sm:w-64 sm:min-w-[260px] dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
            />
          </div>

          <div
            role="group"
            aria-label="Filtrar calificaciones"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-transparent dark:bg-[#27272E] dark:shadow-inner dark:shadow-black/30"
          >
            <button
              type="button"
              onClick={() => handleRatingFilterChange('negative')}
              className={`rounded-md px-3 py-1 text-xs transition-colors whitespace-nowrap shrink-0 ${
                ratingFilter === 'negative'
                  ? 'bg-white text-slate-900 font-semibold shadow-xs dark:bg-[#383842] dark:text-white dark:shadow-md dark:shadow-black/50'
                  : 'font-medium text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-zinc-100 hover:dark:bg-[#32323A]/70'
              }`}
            >
              Solo 1–3 estrellas
            </button>
            <button
              type="button"
              onClick={() => handleRatingFilterChange('all')}
              className={`rounded-md px-3 py-1 text-xs transition-colors whitespace-nowrap shrink-0 ${
                ratingFilter === 'all'
                  ? 'bg-white text-slate-900 font-semibold shadow-xs dark:bg-[#383842] dark:text-white dark:shadow-md dark:shadow-black/50'
                  : 'font-medium text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-zinc-100 hover:dark:bg-[#32323A]/70'
              }`}
            >
              Todas (1–5)
            </button>
          </div>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-300 dark:shadow-sm dark:shadow-black/40">
            <MessageSquareOff className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-800 dark:text-zinc-200">
            {items.length === 0
              ? 'Todavía no hay opiniones registradas'
              : ratingFilter === 'negative' && searchQuery === ''
              ? 'Sin calificaciones de 1 a 3 estrellas'
              : 'No hay opiniones que coincidan con tu búsqueda'}
          </p>
          <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-zinc-400">
            {items.length === 0
              ? 'Cuando tus clientes respondan su enlace de calificación, las opiniones internas de 1 a 3 estrellas aparecerán aquí para que puedas atenderlas a tiempo.'
              : ratingFilter === 'negative' && searchQuery === ''
              ? 'Todas tus respuestas hasta ahora han sido positivas (4 o 5 estrellas).'
              : 'Prueba con otro término de búsqueda o cambia el filtro.'}
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
                  Calificación
                </th>
                <th scope="col" className="px-6 py-3">
                  Comentario
                </th>
                <th scope="col" className="px-6 py-3 text-right">
                  Fecha
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/[0.04]">
              {paginatedItems.map((item) => (
                <tr
                  key={item.id}
                  className="transition-colors hover:bg-orange-500/[0.08] dark:hover:bg-orange-500/[0.08]"
                >
                  <td className="px-6 py-3.5 font-medium text-slate-900 whitespace-nowrap dark:text-zinc-100">
                    {item.customer_name}
                  </td>
                  <td className="px-6 py-3.5 font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap dark:text-zinc-300">
                    {item.customer_phone || '—'}
                  </td>
                  <td className="px-6 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div
                        className="flex items-center gap-0.5"
                        aria-label={`${item.rating} de 5 estrellas`}
                      >
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={`h-3.5 w-3.5 ${
                              star <= item.rating
                                ? item.rating <= 3
                                  ? 'fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400'
                                  : 'fill-emerald-500 text-emerald-500 dark:fill-emerald-400 dark:text-emerald-400'
                                : 'text-slate-300 dark:text-zinc-700'
                            }`}
                            aria-hidden="true"
                          />
                        ))}
                      </div>
                      <span className="font-mono text-xs font-medium tabular-nums text-slate-700 dark:text-zinc-300">
                        {item.rating}/5
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                      {item.redirected_to_google
                        ? 'Flujo directo a Google'
                        : 'Seguimiento privado + enlace a Google'}
                    </p>
                  </td>
                  <td className="min-w-[240px] max-w-md px-6 py-3.5 text-sm leading-relaxed">
                    <span
                      className={
                        item.comment
                          ? 'text-slate-700 dark:text-zinc-200'
                          : 'italic text-slate-400 dark:text-zinc-400'
                      }
                    >
                      {item.comment ||
                        'El cliente no dejó comentarios adicionales.'}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-right font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap dark:text-zinc-300">
                    <FormattedDate dateString={item.created_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filteredItems.length > PAGE_SIZE && (
        <div className="flex flex-col gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.04]">
          <p className="text-xs text-slate-600 tabular-nums dark:text-zinc-300">
            Mostrando{' '}
            <span className="font-medium text-slate-900 dark:text-zinc-100">
              {showingFrom}–{showingTo}
            </span>{' '}
            de{' '}
            <span className="font-medium text-slate-900 dark:text-zinc-100">
              {filteredItems.length}
            </span>{' '}
            opiniones
          </p>

          <nav
            aria-label="Paginación de opiniones privadas"
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
    </section>
  );
}
