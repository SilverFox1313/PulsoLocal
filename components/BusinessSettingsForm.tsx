'use client';

import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Save } from 'lucide-react';
import { updateBusinessSettingsAction } from '@/app/dashboard/actions';
import type { Business } from '@/types/database';

interface BusinessSettingsFormProps {
  business: Business;
  onUpdated: (updated: Business) => void;
}

const TEMPLATE_VARIABLES = [
  { token: '{nombre}', label: '+ {nombre}' },
  { token: '{negocio}', label: '+ {negocio}' },
  { token: '{enlace}', label: '+ {enlace}' },
];

export default function BusinessSettingsForm({
  business,
  onUpdated,
}: BusinessSettingsFormProps) {
  const [businessName, setBusinessName] = useState(business.business_name);
  const [googleReviewUrl, setGoogleReviewUrl] = useState(
    business.google_review_url ?? ''
  );
  const [messageTemplate, setMessageTemplate] = useState(
    business.message_template
  );
  const [delayMinutes, setDelayMinutes] = useState(
    String(business.delay_minutes)
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  function insertVariable(token: string) {
    setSavedMessage(null);
    setMessageTemplate((prev) => {
      const separator =
        prev.length === 0 || prev.endsWith(' ') || prev.endsWith('\n')
          ? ''
          : ' ';
      return `${prev}${separator}${token}`;
    });
  }

  function renderPreview(): string {
    const sampleBusiness = businessName.trim() || 'Tu Negocio';
    return messageTemplate
      .replaceAll('{nombre}', 'María')
      .replaceAll('{{customer_name}}', 'María')
      .replaceAll('{negocio}', sampleBusiness)
      .replaceAll('{{business_name}}', sampleBusiness)
      .replaceAll('{enlace}', 'https://pulsolocal.app/r/ejemplo')
      .replaceAll('{{review_link}}', 'https://pulsolocal.app/r/ejemplo');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSavedMessage(null);

    const parsedDelay = Number(delayMinutes);
    if (
      delayMinutes.trim() === '' ||
      !Number.isInteger(parsedDelay) ||
      parsedDelay < 0 ||
      parsedDelay > 10080
    ) {
      setError(
        'Ingresa un retraso válido en minutos (número entero entre 0 y 10080).'
      );
      return;
    }

    setSaving(true);

    const result = await updateBusinessSettingsAction({
      businessName,
      googleReviewUrl,
      messageTemplate,
      delayMinutes: parsedDelay,
    });

    setSaving(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.business) {
      onUpdated(result.business);
      setBusinessName(result.business.business_name);
      setGoogleReviewUrl(result.business.google_review_url ?? '');
      setMessageTemplate(result.business.message_template);
      setDelayMinutes(String(result.business.delay_minutes));
      setSavedMessage('Cambios guardados correctamente.');
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs transition-colors duration-300 ease-in-out sm:p-8 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-lg dark:shadow-black/30">
      <div className="border-b border-slate-200 pb-5 dark:border-zinc-700">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
          Configuración del negocio
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-zinc-300">
          Define el nombre visible, tu enlace de Google Maps y la plantilla de
          invitación para tus clientes.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
            aria-hidden="true"
          />
          <span>{error}</span>
        </div>
      )}

      {savedMessage && (
        <div
          role="status"
          className="mt-6 flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200"
        >
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <span>{savedMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-6" noValidate>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label
              htmlFor="settings-business-name"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
            >
              Nombre del negocio
            </label>
            <input
              id="settings-business-name"
              name="businessName"
              type="text"
              required
              disabled={saving}
              value={businessName}
              onChange={(e) => {
                setSavedMessage(null);
                setBusinessName(e.target.value);
              }}
              placeholder="Ej. Clínica Dental Norte"
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800/90 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-amber-500/60"
            />
          </div>

          <div>
            <label
              htmlFor="settings-delay-minutes"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
            >
              Minutos de retraso antes de enviar
            </label>
            <input
              id="settings-delay-minutes"
              name="delayMinutes"
              type="number"
              min={0}
              max={10080}
              step={1}
              required
              disabled={saving}
              value={delayMinutes}
              onChange={(e) => {
                setSavedMessage(null);
                setDelayMinutes(e.target.value);
              }}
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 font-mono text-sm tabular-nums text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800/90 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-amber-500/60"
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-zinc-400">
              Usa{' '}
              <span className="font-mono tabular-nums text-slate-700 dark:text-zinc-300">
                0
              </span>{' '}
              para programar el envío inmediato o define minutos de espera (ej.{' '}
              <span className="font-mono tabular-nums text-slate-700 dark:text-zinc-300">
                60
              </span>{' '}
              para 1 hora).
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor="settings-google-url"
            className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
          >
            Enlace directo de reseñas en Google Maps
          </label>
          <input
            id="settings-google-url"
            name="googleReviewUrl"
            type="url"
            disabled={saving}
            value={googleReviewUrl}
            onChange={(e) => {
              setSavedMessage(null);
              setGoogleReviewUrl(e.target.value);
            }}
            placeholder="https://g.page/r/tu-codigo-de-google/review"
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 font-mono text-sm text-slate-900 placeholder:font-sans placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800/90 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-amber-500/60"
          />
          <p className="mt-1.5 text-xs text-slate-500 dark:text-zinc-400">
            Copia este enlace desde tu perfil de Google Business Profile en la
            opción &ldquo;Solicitar reseñas&rdquo;.
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="settings-message-template"
              className="block text-sm font-medium text-slate-700 dark:text-zinc-300"
            >
              Plantilla del mensaje de texto
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {TEMPLATE_VARIABLES.map((item) => (
                <button
                  key={item.token}
                  type="button"
                  disabled={saving}
                  onClick={() => insertVariable(item.token)}
                  className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 font-mono text-xs text-slate-700 transition-colors hover:border-slate-300 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800/90 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-amber-300 whitespace-nowrap shrink-0"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            id="settings-message-template"
            name="messageTemplate"
            rows={4}
            required
            disabled={saving}
            value={messageTemplate}
            onChange={(e) => {
              setSavedMessage(null);
              setMessageTemplate(e.target.value);
            }}
            placeholder="Hola {nombre}, gracias por visitarnos en {negocio}. ¿Cómo calificarías tu experiencia? {enlace}"
            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800/90 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-amber-500/60"
          />

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/80">
            <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">
              Vista previa con datos de ejemplo
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-700 dark:text-zinc-200">
              {renderPreview() || 'Escribe un mensaje para previsualizarlo.'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end border-t border-slate-200 pt-5 dark:border-zinc-700">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-5 text-sm font-semibold text-zinc-900 shadow-md shadow-amber-500/20 transition-all hover:from-amber-400 hover:to-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 dark:text-white disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Guardando...</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" aria-hidden="true" />
                <span>Guardar cambios</span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
