'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CalendarClock,
  Loader2,
  Save,
  Send,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { updateReviewRequestAction } from '@/app/dashboard/actions';
import {
  COUNTRY_DIAL_CODES,
  normalizePhoneToE164,
  parseInternationalInput,
} from '@/lib/messaging/phone';
import type { ReviewRequest } from '@/types/database';

interface EditReviewRequestModalProps {
  request: ReviewRequest;
  onClose: () => void;
  onSaved: (updated: ReviewRequest) => void;
}

function toLocalDateTimeInputValue(dateInput: Date | string): string {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getInitialPhoneState(rawPhone: string): {
  dialCode: string;
  localPhone: string;
} {
  const parsed = parseInternationalInput(rawPhone);
  if (parsed.hasExplicitPlus) {
    if (parsed.matchedCode) {
      return { dialCode: parsed.matchedCode, localPhone: parsed.localPart };
    }
    return { dialCode: 'custom', localPhone: parsed.collapsedRaw };
  }
  return { dialCode: '+1', localPhone: rawPhone };
}

export default function EditReviewRequestModal({
  request,
  onClose,
  onSaved,
}: EditReviewRequestModalProps) {
  const [initialPhoneState] = useState(() =>
    getInitialPhoneState(request.customer_phone)
  );
  const [customerName, setCustomerName] = useState(request.customer_name);
  const [dialCode, setDialCode] = useState(initialPhoneState.dialCode);
  const [customerPhone, setCustomerPhone] = useState(
    initialPhoneState.localPhone
  );
  const [scheduledLocal, setScheduledLocal] = useState(() =>
    toLocalDateTimeInputValue(request.scheduled_for)
  );
  const [savingMode, setSavingMode] = useState<'save' | 'sendNow' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedDialOption =
    COUNTRY_DIAL_CODES.find((option) => option.code === dialCode) ??
    COUNTRY_DIAL_CODES[0];

  const isSaving = savingMode !== null;

  const localTimezone =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'Local';

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSaving) {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSaving, onClose]);

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

  function validateCustomerFields(): {
    name: string;
    phone: string;
  } | null {
    const trimmedName = customerName.trim();
    const trimmedPhone = customerPhone.trim();

    if (trimmedName.length < 2 || trimmedName.length > 50) {
      setError('El nombre del cliente debe tener entre 2 y 50 caracteres.');
      return null;
    }

    const normalizedPhone = normalizePhoneToE164(trimmedPhone, dialCode);
    if (!normalizedPhone) {
      setError(
        'Ingresa un teléfono válido con código de país (ej. +1 809 555 0199).'
      );
      return null;
    }

    return { name: trimmedName, phone: normalizedPhone };
  }

  async function submitUpdate(sendNow: boolean) {
    if (isSaving) return;
    setError(null);
    const validFields = validateCustomerFields();
    if (!validFields) {
      return;
    }

    let scheduledForIso: string | undefined;
    if (!sendNow) {
      const parsedLocal = new Date(scheduledLocal);
      if (!scheduledLocal || Number.isNaN(parsedLocal.getTime())) {
        setError('Selecciona una fecha y hora programada válida.');
        return;
      }
      scheduledForIso = parsedLocal.toISOString();
    }

    setSavingMode(sendNow ? 'sendNow' : 'save');

    try {
      const result = await updateReviewRequestAction({
        requestId: request.id,
        customerName: validFields.name,
        customerPhone: validFields.phone,
        scheduledForIso,
        sendNow,
      });

      if (result.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }

      if (result.request) {
        onSaved(result.request);
        toast.success(
          sendNow
            ? `Envío programado ahora para ${result.request.customer_name}`
            : `Solicitud de ${result.request.customer_name} actualizada`
        );
        onClose();
      }
    } catch {
      const msg =
        'No se pudieron guardar los cambios por un problema de conexión. Inténtalo nuevamente.';
      setError(msg);
      toast.error(msg);
    } finally {
      setSavingMode(null);
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitUpdate(false);
  }

  function handleFillNow() {
    setError(null);
    setScheduledLocal(toLocalDateTimeInputValue(new Date()));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-request-modal-title"
      onClick={() => {
        if (!isSaving) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl transition-colors dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-white/[0.04]">
          <div>
            <h3
              id="edit-request-modal-title"
              className="text-base font-semibold tracking-tight text-slate-900 dark:text-zinc-50"
            >
              Editar solicitud pendiente
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
              Ajusta los datos del cliente o reprograma el envío por WhatsApp.
            </p>
          </div>

          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            aria-label="Cerrar ventana de edición"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 dark:border-none dark:bg-[#27272E] dark:text-zinc-300 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] dark:hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-4 px-6 py-5" noValidate>
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-200"
            >
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
                aria-hidden="true"
              />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="edit-customer-name"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
            >
              Nombre del cliente
            </label>
            <input
              id="edit-customer-name"
              type="text"
              required
              maxLength={50}
              disabled={isSaving}
              value={customerName}
              onChange={(e) => {
                setError(null);
                setCustomerName(e.target.value);
              }}
              placeholder="Ej. Carlos Mendoza"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
            />
          </div>

          <div>
            <label
              htmlFor="edit-customer-phone"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
            >
              Teléfono (WhatsApp)
            </label>
            <div className="flex h-10 w-full overflow-hidden rounded-lg border border-slate-300 bg-white transition-colors focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/30 dark:border-transparent dark:bg-[#27272E] dark:shadow-sm dark:shadow-black/40 dark:focus-within:bg-[#32323A] dark:focus-within:border-amber-500/60">
              <select
                id="edit-customer-phone-country"
                aria-label="Código de país"
                disabled={isSaving}
                value={dialCode}
                onChange={(e) => {
                  setError(null);
                  setDialCode(e.target.value);
                }}
                className="h-full shrink-0 cursor-pointer border-r border-slate-200 bg-slate-50 px-2.5 font-mono text-xs font-medium text-slate-700 transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.08] dark:bg-[#202027] dark:text-zinc-200"
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
                id="edit-customer-phone"
                type="tel"
                required
                disabled={isSaving}
                value={customerPhone}
                onChange={(e) => handlePhoneInputChange(e.target.value)}
                placeholder={selectedDialOption.placeholder}
                className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-sm tabular-nums text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-100 dark:placeholder:text-zinc-400"
              />
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Se guarda en formato internacional limpio (ej. +1 809 555 0199).
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="edit-scheduled-for"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-zinc-300"
              >
                <CalendarClock
                  className="h-4 w-4 text-slate-500 dark:text-zinc-400"
                  aria-hidden="true"
                />
                <span>Fecha y hora programada</span>
              </label>

              <button
                type="button"
                disabled={isSaving}
                onClick={handleFillNow}
                className="rounded-md px-2 py-0.5 text-xs font-medium text-orange-600 transition-colors hover:bg-orange-500/10 hover:text-orange-700 disabled:opacity-50 dark:text-orange-400 dark:hover:text-orange-300"
              >
                Usar hora actual
              </button>
            </div>

            <input
              id="edit-scheduled-for"
              type="datetime-local"
              required
              disabled={isSaving}
              value={scheduledLocal}
              onChange={(e) => {
                setError(null);
                setScheduledLocal(e.target.value);
              }}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3.5 font-mono text-sm text-slate-900 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              Se muestra según tu zona horaria local ({localTimezone}).
            </p>
          </div>

          <div className="flex flex-col-reverse gap-2.5 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.04]">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void submitUpdate(true)}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3.5 text-xs font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-none dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] whitespace-nowrap shrink-0"
            >
              {savingMode === 'sendNow' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>Programando...</span>
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <span>Enviar ahora</span>
                </>
              )}
            </button>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                disabled={isSaving}
                onClick={onClose}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-none dark:bg-[#27272E] dark:text-zinc-200 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] whitespace-nowrap shrink-0"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-orange-500 bg-transparent px-4 text-sm font-semibold shadow-xs transition-all hover:bg-orange-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {savingMode === 'save' ? (
                  <>
                    <Loader2
                      className="h-4 w-4 shrink-0 animate-spin text-orange-500 dark:text-orange-400"
                      aria-hidden="true"
                    />
                    <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent font-semibold dark:from-orange-400 dark:to-amber-400">
                      Guardando...
                    </span>
                  </>
                ) : (
                  <>
                    <Save
                      className="h-4 w-4 shrink-0 text-orange-500 dark:text-orange-400"
                      aria-hidden="true"
                    />
                    <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent font-semibold dark:from-orange-400 dark:to-amber-400">
                      Guardar cambios
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
