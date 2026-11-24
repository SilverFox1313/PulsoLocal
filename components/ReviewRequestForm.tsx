'use client';

import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { createReviewRequestAction } from '@/app/dashboard/actions';
import {
  COUNTRY_DIAL_CODES,
  normalizePhoneToE164,
  parseInternationalInput,
} from '@/lib/messaging/phone';
import type { ReviewRequest } from '@/types/database';

interface ReviewRequestFormProps {
  delayMinutes: number;
  blockedReason?: string | null;
  trialUsageLabel?: string | null;
  onCreated: (request: ReviewRequest) => void;
}

export default function ReviewRequestForm({
  delayMinutes,
  blockedReason = null,
  trialUsageLabel = null,
  onCreated,
}: ReviewRequestFormProps) {
  const [customerName, setCustomerName] = useState('');
  const [dialCode, setDialCode] = useState('+1');
  const [customerPhone, setCustomerPhone] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const selectedDialOption =
    COUNTRY_DIAL_CODES.find((option) => option.code === dialCode) ??
    COUNTRY_DIAL_CODES[0];

  function handlePhoneInputChange(rawValue: string) {
    setError(null);
    setSuccessMessage(null);

    const trimmedStart = rawValue.trimStart();
    if (trimmedStart.startsWith('+')) {
      const parsed = parseInternationalInput(trimmedStart);
      if (parsed.matchedCode && trimmedStart.length > 4) {
        setDialCode(parsed.matchedCode);
        setCustomerPhone(parsed.localPart);
        return;
      }
      setDialCode('custom');
      setCustomerPhone(parsed.collapsedRaw);
      return;
    }

    setCustomerPhone(rawValue);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (blockedReason) {
      setError(blockedReason);
      toast.error(blockedReason);
      return;
    }

    const trimmedName = customerName.trim();
    const trimmedPhone = customerPhone.trim();

    if (trimmedName.length < 2) {
      const msg = 'Ingresa el nombre completo del cliente.';
      setError(msg);
      toast.error(msg);
      return;
    }

    const normalizedPhone = normalizePhoneToE164(trimmedPhone, dialCode);
    if (!normalizedPhone) {
      const msg = 'Ingresa un teléfono válido (ej. +1 809 555 0199).';
      setError(msg);
      toast.error(msg);
      return;
    }

    setSubmitting(true);

    const result = await createReviewRequestAction({
      customerName: trimmedName,
      customerPhone: normalizedPhone,
    });

    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      toast.error(result.error);
      return;
    }

    if (result.request) {
      onCreated(result.request);
      setCustomerName('');
      setDialCode('+1');
      setCustomerPhone('');
      const msg = `Solicitud programada para ${result.request.customer_name}`;
      setSuccessMessage(`${msg}.`);
      toast.success(msg);
    }
  }

  return (
    <section className="w-full max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition-colors duration-300 ease-in-out sm:p-8 dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60">
      <div className="flex min-w-0 flex-col gap-2 border-b border-slate-200 pb-5 sm:flex-row sm:items-baseline sm:justify-between dark:border-white/[0.04]">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
            Añadir cliente para reseña
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-zinc-300">
            Registra un cliente atendido para programar su solicitud automática.
          </p>
        </div>

        <div className="flex min-w-0 shrink-0 flex-col items-start gap-1 text-xs text-slate-500 tabular-nums sm:items-end dark:text-zinc-300">
          <p>
            Tiempo de envío:{' '}
            <span className="font-mono text-slate-800 dark:text-zinc-200">
              {delayMinutes === 0 ? 'Inmediato (0 min)' : `${delayMinutes} min`}
            </span>
          </p>
          {trialUsageLabel && (
            <p className="font-medium text-amber-700 dark:text-amber-300">
              {trialUsageLabel}
            </p>
          )}
        </div>
      </div>

      {blockedReason && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <span>{blockedReason}</span>
        </div>
      )}

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
        className="mt-6 grid w-full max-w-full grid-cols-1 gap-4 md:grid-cols-12 md:items-end"
        noValidate
      >
        <div className="min-w-0 w-full max-w-full md:col-span-5">
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
            disabled={submitting || Boolean(blockedReason)}
            value={customerName}
            onChange={(e) => {
              setSuccessMessage(null);
              setCustomerName(e.target.value);
            }}
            placeholder="Ej. Carlos Mendoza"
            className="box-border h-11 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
          />
        </div>

        <div className="min-w-0 w-full max-w-full md:col-span-4">
          <label
            htmlFor="customer-phone"
            className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
          >
            Teléfono (WhatsApp)
          </label>
          <div className="box-border flex h-11 w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-slate-300 bg-white transition-colors focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/30 dark:border-transparent dark:bg-[#27272E] dark:shadow-sm dark:shadow-black/40 dark:focus-within:bg-[#32323A] dark:focus-within:border-amber-500/60">
            <select
              id="customer-phone-country"
              aria-label="Código de país"
              disabled={submitting || Boolean(blockedReason)}
              value={dialCode}
              onChange={(e) => {
                setError(null);
                setSuccessMessage(null);
                setDialCode(e.target.value);
              }}
              className="box-border h-full max-w-[44%] min-w-0 shrink-0 cursor-pointer truncate border-r border-slate-200 bg-slate-50 px-2 font-mono text-xs font-medium text-slate-700 transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-none sm:px-2.5 dark:border-white/[0.08] dark:bg-[#202027] dark:text-zinc-200"
            >
              {COUNTRY_DIAL_CODES.map((option) => (
                <option
                  key={option.code}
                  value={option.code}
                  className="bg-white text-slate-900 dark:bg-[#27272E] dark:text-zinc-100"
                >
                  {option.label}
                </option>
              ))}
            </select>
            <input
              id="customer-phone"
              name="customerPhone"
              type="tel"
              required
              disabled={submitting || Boolean(blockedReason)}
              value={customerPhone}
              onChange={(e) => handlePhoneInputChange(e.target.value)}
              placeholder={selectedDialOption.placeholder}
              className="box-border h-full w-full min-w-0 flex-1 bg-transparent px-3 font-mono text-sm tabular-nums text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-100 dark:placeholder:text-zinc-400"
            />
          </div>
        </div>

        <div className="min-w-0 w-full max-w-full md:col-span-3">
          <button
            type="submit"
            disabled={submitting || Boolean(blockedReason)}
            className="box-border inline-flex h-11 w-full min-w-0 max-w-full items-center justify-center gap-2 rounded-lg border border-orange-500 bg-transparent px-4 text-sm font-semibold shadow-xs transition-all hover:bg-orange-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-orange-500 dark:text-orange-400" aria-hidden="true" />
                <span className="truncate bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent font-semibold dark:from-orange-400 dark:to-amber-400">
                  Registrando...
                </span>
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4 shrink-0 text-orange-500 dark:text-orange-400" aria-hidden="true" />
                <span className="truncate bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent font-semibold dark:from-orange-400 dark:to-amber-400">
                  Programar envío
                </span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
