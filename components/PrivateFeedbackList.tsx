'use client';

import { useMemo, useState } from 'react';
import { MessageSquareOff, Search, Star } from 'lucide-react';
import FormattedDate from '@/components/FormattedDate';
import type { PrivateFeedbackItem } from '@/types/database';

interface PrivateFeedbackListProps {
  items: PrivateFeedbackItem[];
}

type RatingFilter = 'negative' | 'all';

export default function PrivateFeedbackList({ items }: PrivateFeedbackListProps) {
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('negative');
  const [searchQuery, setSearchQuery] = useState('');

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
              onChange={(e) => setSearchQuery(e.target.value)}
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
              onClick={() => setRatingFilter('negative')}
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
              onClick={() => setRatingFilter('all')}
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
        <ul className="divide-y divide-slate-200 dark:divide-white/[0.04]">
          {filteredItems.map((item) => (
            <li
              key={item.id}
              className="px-6 py-5 transition-colors hover:bg-slate-50 dark:hover:bg-[#27272E]/60"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-zinc-300">
                  <span className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                    {item.customer_name}
                  </span>
                  {item.customer_phone && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-600 dark:text-zinc-300">
                        {item.customer_phone}
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-slate-500 dark:text-zinc-400">
                    <FormattedDate dateString={item.created_at} />
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
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
                  <span aria-hidden="true" className="text-slate-300 dark:text-zinc-700">
                    ·
                  </span>
                  <span className="text-xs text-slate-500 dark:text-zinc-300">
                    {item.redirected_to_google
                      ? 'Flujo directo a Google'
                      : 'Seguimiento privado + enlace a Google'}
                  </span>
                </div>
              </div>

              <p
                className={`mt-3 text-sm leading-relaxed ${
                  item.comment
                    ? 'text-slate-700 dark:text-zinc-200'
                    : 'italic text-slate-400 dark:text-zinc-400'
                }`}
              >
                {item.comment || 'El cliente no dejó comentarios adicionales.'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
