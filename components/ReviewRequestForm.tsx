'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Loader2,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  checkCustomerPhoneHistoryAction,
  createReviewRequestAction,
  type CustomerPhoneHistoryResult,
} from '@/app/dashboard/actions';
import {
  COUNTRY_DIAL_CODES,
  normalizePhoneToE164,
  parseInternationalInput,
} from '@/lib/messaging/phone';
import {
  REVIEW_STATUS_LABELS_ES,
  type PendingRequestDuplicateAlert,
} from '@/lib/messaging/request-history';
import type { ReviewRequest } from '@/types/database';

interface ReviewRequestFormProps {
  businessId?: string;
  delayMinutes: number;
  blockedReason?: string | null;
  trialUsageLabel?: string | null;
  pendingDuplicateAlerts?: PendingRequestDuplicateAlert[];
  requestsSyncHash?: number;
  onCreated: (request: ReviewRequest) => void;
}

function formatHistoryDate(dateIso: string | null): string | null {
  if (!dateIso) return null;
  const parsed = new Date(dateIso);
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

export default function ReviewRequestForm({
  businessId,
  delayMinutes,
  blockedReason = null,
  trialUsageLabel = null,
  pendingDuplicateAlerts = [],
  requestsSyncHash = 0,
  onCreated,
}: ReviewRequestFormProps) {
  const [customerName, setCustomerName] = useState('');
  const [dialCode, setDialCode] = useState('+1');
  const [customerPhone, setCustomerPhone] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneHistory, setPhoneHistory] = useState<{
    matchedE164: string;
    result: CustomerPhoneHistoryResult;
  } | null>(null);

  const lookupSeqRef = useRef(0);

  const selectedDialOption =
    COUNTRY_DIAL_CODES.find((option) => option.code === dialCode) ??
    COUNTRY_DIAL_CODES[0];

  const trimmedPhone = customerPhone.trim();
  const rawDigits = trimmedPhone.replace(/\D/g, '');
  const normalizedE164 =
    rawDigits.length >= 7
      ? normalizePhoneToE164(trimmedPhone, dialCode)
      : null;
  const canLookupPhone = Boolean(
    !blockedReason && !submitting && normalizedE164
  );

  useEffect(() => {
    if (!canLookupPhone || !normalizedE164) {
      lookupSeqRef.current += 1;
      return;
    }

    const requestSeq = ++lookupSeqRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await checkCustomerPhoneHistoryAction({
            businessId,
            phone: trimmedPhone,
            dialCode,
          });

          if (lookupSeqRef.current !== requestSeq) {
            return;
          }

          if (result.error || !result.hasPreviousRequests) {
            setPhoneHistory(null);
            return;
          }

          setPhoneHistory({
            matchedE164: normalizedE164,
            result,
          });
        } catch {
          if (lookupSeqRef.current === requestSeq) {
            setPhoneHistory(null);
          }
        }
      })();
    }, 280);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    businessId,
    canLookupPhone,
    dialCode,
    normalizedE164,
    requestsSyncHash,
    trimmedPhone,
  ]);

  function handlePhoneInputChange(rawValue: string) {
    setError(null);

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
      lookupSeqRef.current += 1;
      setPhoneHistory(null);
      onCreated(result.request);
      setCustomerName('');
      setDialCode('+1');
      setCustomerPhone('');
      const msg = `Solicitud programada para ${result.request.customer_name}`;
      toast.success(msg);
    }
  }

  const activePhoneHistory =
    canLookupPhone &&
    phoneHistory?.matchedE164 === normalizedE164 &&
    phoneHistory.result.hasPreviousRequests
      ? phoneHistory.result
      : null;

  const latestStatusLabel = activePhoneHistory?.latestStatus
    ? REVIEW_STATUS_LABELS_ES[activePhoneHistory.latestStatus] ?? 'Pendiente'
    : null;
  const latestFormattedDate = activePhoneHistory
    ? formatHistoryDate(
        activePhoneHistory.latestCreatedAt ??
          activePhoneHistory.latestScheduledFor
      )
    : null;

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

      <form
        onSubmit={handleSubmit}
        className="mt-6 grid w-full max-w-full grid-cols-1 gap-4 md:grid-cols-12 md:items-end"
        noValidate
      >
        <div className="order-1 min-w-0 w-full max-w-full md:col-span-5">
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
              setCustomerName(e.target.value);
            }}
            placeholder="Ej. Carlos Mendoza"
            className="box-border h-11 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
          />
        </div>

        <div className="order-2 min-w-0 w-full max-w-full md:col-span-4">
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

        {activePhoneHistory && latestStatusLabel && (
          <div
            role="status"
            aria-live="polite"
            className="order-3 flex min-w-0 w-full max-w-full items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50/90 px-4 py-3 text-sm text-amber-900 md:order-4 md:col-span-12 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-0.5 leading-relaxed">
              <p className="font-medium">
                {activePhoneHistory.totalCount === 1
                  ? 'Este número ya tiene 1 envío previo registrado en este negocio.'
                  : `Este número ya tiene ${activePhoneHistory.totalCount} envíos previos registrados en este negocio.`}
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-200/90">
                Último estado:{' '}
                <span className="font-semibold">{latestStatusLabel}</span>
                {latestFormattedDate ? ` (${latestFormattedDate})` : ''}. Puedes
                continuar si deseas enviar otra invitación o verificar el
                historial para evitar duplicados.
              </p>
            </div>
          </div>
        )}

        <div className="order-4 min-w-0 w-full max-w-full md:order-3 md:col-span-3">
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

      {pendingDuplicateAlerts.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="mt-5 flex min-w-0 w-full max-w-full items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          {pendingDuplicateAlerts.length === 1 ? (() => {
            const item = pendingDuplicateAlerts[0];
            const statusLabel =
              REVIEW_STATUS_LABELS_ES[item.latestStatus] ?? 'Pendiente';
            const noun =
              item.previousSentCount > 0 || item.latestStatus !== 'pending'
                ? item.previousCount === 1
                  ? 'envío previo'
                  : 'envíos previos'
                : item.previousCount === 1
                  ? 'solicitud previa'
                  : 'solicitudes previas';

            return (
              <p className="min-w-0 break-words leading-relaxed">
                <span className="font-semibold">Aviso de envío previo:</span>{' '}
                Tienes una solicitud pendiente para{' '}
                <span className="font-semibold">{item.customerName}</span> (
                <span className="font-mono text-xs tabular-nums">
                  {item.customerPhone}
                </span>
                ) que ya cuenta con{' '}
                <span className="font-semibold tabular-nums">
                  {item.previousCount} {noun}
                </span>{' '}
                (último estado:{' '}
                <span className="font-semibold">{statusLabel}</span>). Revisa
                antes del envío si deseas conservarla o eliminarla.
              </p>
            );
          })() : (
            <div className="min-w-0 flex-1 space-y-1.5 leading-relaxed">
              <p className="font-medium break-words">
                <span className="font-semibold">Aviso de envío previo:</span>{' '}
                Tienes {pendingDuplicateAlerts.length} solicitudes pendientes
                que ya cuentan con historial previo en este negocio:
              </p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-amber-900 dark:text-amber-100/90">
                {pendingDuplicateAlerts.map((item) => {
                  const statusLabel =
                    REVIEW_STATUS_LABELS_ES[item.latestStatus] ?? 'Pendiente';
                  const noun =
                    item.previousSentCount > 0 ||
                    item.latestStatus !== 'pending'
                      ? item.previousCount === 1
                        ? 'envío previo'
                        : 'envíos previos'
                      : item.previousCount === 1
                        ? 'solicitud previa'
                        : 'solicitudes previas';

                  return (
                    <li key={item.pendingRequestId} className="break-words">
                      <span className="font-semibold">{item.customerName}</span>{' '}
                      (
                      <span className="font-mono tabular-nums">
                        {item.customerPhone}
                      </span>
                      ) — {item.previousCount} {noun} · último estado:{' '}
                      <span className="font-semibold">{statusLabel}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-amber-800 dark:text-amber-200/90">
                Revisa antes del envío si deseas conservarlas o eliminarlas.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
