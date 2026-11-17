'use client';

import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Loader2, UserPlus } from 'lucide-react';
import { createReviewRequestAction } from '@/app/dashboard/actions';
import type { ReviewRequest } from '@/types/database';

interface ReviewRequestFormProps {
  delayMinutes: number;
  onCreated: (request: ReviewRequest) => void;
}

export default function ReviewRequestForm({
  delayMinutes,
  onCreated,
}: ReviewRequestFormProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const trimmedName = customerName.trim();
    const trimmedPhone = customerPhone.trim();

    if (trimmedName.length < 2) {
      setError('Ingresa el nombre completo del cliente.');
      return;
    }

    const digits = trimmedPhone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      setError('Ingresa un teléfono válido (ej. +52 55 1234 5678).');
      return;
    }

    setSubmitting(true);

    const result = await createReviewRequestAction({
      customerName: trimmedName,
      customerPhone: trimmedPhone,
    });

    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.request) {
      onCreated(result.request);
      setCustomerName('');
      setCustomerPhone('');
      setSuccessMessage(
        `Solicitud programada para ${result.request.customer_name}.`
      );
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs transition-colors duration-300 ease-in-out sm:p-8 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-lg dark:shadow-black/30">
      <div className="flex flex-col gap-1 border-b border-slate-200 pb-5 sm:flex-row sm:items-baseline sm:justify-between dark:border-zinc-700">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
            Añadir cliente para reseña
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-zinc-300">
            Registra un cliente atendido para programar su solicitud automática.
          </p>
        </div>

        <p className="text-xs text-slate-500 tabular-nums dark:text-zinc-300">
          Retraso configurado:{' '}
          <span className="font-mono text-slate-800 dark:text-zinc-200">
            {delayMinutes === 0 ? 'Inmediato (0 min)' : `${delayMinutes} min`}
          </span>
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
            aria-hidden="true"
          />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="mt-5 flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200"
        >
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <span>{successMessage}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="mt-6 grid gap-4 md:grid-cols-12 md:items-end"
        noValidate
      >
        <div className="md:col-span-5">
          <label
            htmlFor="customer-name"
            className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
          >
            Nombre del cliente
          </label>
          <input
            id="customer-name"
            name="customerName"
            type="text"
            required
            disabled={submitting}
            value={customerName}
            onChange={(e) => {
              setSuccessMessage(null);
              setCustomerName(e.target.value);
            }}
            placeholder="Ej. Carlos Mendoza"
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800/90 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-amber-500/60"
          />
        </div>

        <div className="md:col-span-4">
          <label
            htmlFor="customer-phone"
            className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
          >
            Teléfono (WhatsApp / SMS)
          </label>
          <input
            id="customer-phone"
            name="customerPhone"
            type="tel"
            required
            disabled={submitting}
            value={customerPhone}
            onChange={(e) => {
              setSuccessMessage(null);
              setCustomerPhone(e.target.value);
            }}
            placeholder="+52 55 1234 5678"
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 font-mono text-sm tabular-nums text-slate-900 placeholder:font-sans placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800/90 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-amber-500/60"
          />
        </div>

        <div className="md:col-span-3">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-4 text-sm font-semibold text-zinc-900 shadow-md shadow-amber-500/20 transition-all hover:from-amber-400 hover:to-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 dark:text-white disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Registrando...</span>
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                <span>Programar envío</span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
