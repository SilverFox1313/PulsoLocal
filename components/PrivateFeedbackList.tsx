'use client';

import { useMemo, useState } from 'react';
import { MessageSquareOff, Search, Star } from 'lucide-react';
import type { PrivateFeedbackItem } from '@/types/database';

interface PrivateFeedbackListProps {
  items: PrivateFeedbackItem[];
}

type RatingFilter = 'negative' | 'all';

const DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

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
    <section className="rounded-xl border border-zinc-800 bg-[#111114]">
      <div className="flex flex-col gap-4 border-b border-zinc-800/80 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-50">
            Opiniones privadas
          </h2>
          <p className="mt-0.5 text-sm text-zinc-400 tabular-nums">
            {negativeCount}{' '}
            {negativeCount === 1
              ? 'calificación privada de 1 a 3 estrellas'
              : 'calificaciones privadas de 1 a 3 estrellas'}
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
              placeholder="Buscar cliente o comentario..."
              aria-label="Buscar opiniones privadas"
              className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-amber-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 sm:w-56"
            />
          </div>

          <div
            role="group"
            aria-label="Filtrar calificaciones"
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1"
          >
            <button
              type="button"
              onClick={() => setRatingFilter('negative')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                ratingFilter === 'negative'
                  ? 'bg-zinc-800 text-zinc-50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Solo 1–3 estrellas
            </button>
            <button
              type="button"
              onClick={() => setRatingFilter('all')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                ratingFilter === 'all'
                  ? 'bg-zinc-800 text-zinc-50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Todas (1–5)
            </button>
          </div>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-500">
            <MessageSquareOff className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm font-medium text-zinc-200">
            {items.length === 0
              ? 'Todavía no hay opiniones registradas'
              : ratingFilter === 'negative' && searchQuery === ''
              ? 'Sin quejas o calificaciones de 1 a 3 estrellas'
              : 'No hay opiniones que coincidan con tu búsqueda'}
          </p>
          <p className="mt-1 max-w-sm text-xs text-zinc-500">
            {items.length === 0
              ? 'Cuando tus clientes respondan su enlace de calificación, las opiniones de 1 a 3 estrellas aparecerán aquí de forma privada.'
              : ratingFilter === 'negative' && searchQuery === ''
              ? 'Todas tus respuestas hasta ahora han sido positivas (4 o 5 estrellas).'
              : 'Prueba con otro término de búsqueda o cambia el filtro.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800/70">
          {filteredItems.map((item) => (
            <li key={item.id} className="px-6 py-5 transition-colors hover:bg-zinc-900/35">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                  <span className="text-sm font-semibold text-zinc-100">
                    {item.customer_name}
                  </span>
                  {item.customer_phone && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-zinc-400">
                        {item.customer_phone}
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-zinc-500">
                    {DATE_FORMATTER.format(new Date(item.created_at))}
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
                              ? 'fill-amber-400 text-amber-400'
                              : 'fill-emerald-400 text-emerald-400'
                            : 'text-zinc-700'
                        }`}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                  <span className="font-mono text-xs font-medium tabular-nums text-zinc-300">
                    {item.rating}/5
                  </span>
                  <span aria-hidden="true" className="text-zinc-700">
                    ·
                  </span>
                  <span className="text-xs text-zinc-400">
                    {item.redirected_to_google
                      ? 'Enviado a Google'
                      : 'Contenido privado'}
                  </span>
                </div>
              </div>

              <p
                className={`mt-3 text-sm leading-relaxed ${
                  item.comment ? 'text-zinc-200' : 'italic text-zinc-500'
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
