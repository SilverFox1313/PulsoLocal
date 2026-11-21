'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  HeartHandshake,
  Info,
  Loader2,
  Send,
  Star,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  savePrivateFeedbackCommentAction,
  submitPublicRatingAction,
} from '@/app/r/[requestId]/actions';
import type { PublicReviewRequestData } from '@/types/database';

interface PublicReviewFlowProps {
  data: PublicReviewRequestData;
  isOwner?: boolean;
}

type FlowStep =
  | 'rate'
  | 'redirect_google'
  | 'private_comment'
  | 'empathetic_done'
  | 'already_submitted';

const RATING_LABELS: Record<number, string> = {
  1: 'Muy mala experiencia',
  2: 'Por debajo de lo esperado',
  3: 'Experiencia regular',
  4: 'Muy buena experiencia',
  5: 'Excelente experiencia',
};

function isSafeHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function PublicReviewFlow({
  data,
  isOwner = false,
}: PublicReviewFlowProps) {
  const shouldResumePrivateComment =
    !isOwner && Boolean(data.needs_private_comment);

  const [step, setStep] = useState<FlowStep>(
    shouldResumePrivateComment
      ? 'private_comment'
      : data.already_submitted
      ? 'already_submitted'
      : 'rate'
  );
  const [ownerBlocked, setOwnerBlocked] = useState(isOwner);
  const [hoveredRating, setHoveredRating] = useState<number>(0);
  const [selectedRating, setSelectedRating] = useState<number>(
    shouldResumePrivateComment && typeof data.submitted_rating === 'number'
      ? data.submitted_rating
      : 0
  );
  const [googleReviewUrl, setGoogleReviewUrl] = useState<string | null>(
    data.google_review_url
  );
  const [countdown, setCountdown] = useState<number>(3);

  const [comment, setComment] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeGoogleReviewUrl = isSafeHttpUrl(googleReviewUrl)
    ? googleReviewUrl.trim()
    : null;

  useEffect(() => {
    if (step !== 'redirect_google' || !safeGoogleReviewUrl || countdown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [step, safeGoogleReviewUrl, countdown]);

  useEffect(() => {
    if (step !== 'redirect_google' || !safeGoogleReviewUrl || countdown > 0) {
      return;
    }

    window.location.assign(safeGoogleReviewUrl);
  }, [step, safeGoogleReviewUrl, countdown]);

  async function handleSelectRating(rating: number) {
    if (submittingRating || ownerBlocked) return;
    setError(null);
    setSelectedRating(rating);
    setSubmittingRating(true);

    const result = await submitPublicRatingAction(data.request_id, rating);

    setSubmittingRating(false);

    if (result.alreadySubmitted) {
      setStep('already_submitted');
      return;
    }

    if (result.ownerBlocked) {
      setOwnerBlocked(true);
      setError(result.error ?? null);
      setSelectedRating(0);
      setHoveredRating(0);
      return;
    }

    if (result.error) {
      setError(result.error);
      setSelectedRating(0);
      return;
    }

    if (result.googleReviewUrl !== undefined) {
      setGoogleReviewUrl(result.googleReviewUrl);
    }

    if (result.redirectedToGoogle) {
      setCountdown(3);
      setStep('redirect_google');
    } else {
      setStep('private_comment');
    }
  }

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!comment.trim()) {
      setStep('empathetic_done');
      return;
    }

    setSubmittingComment(true);
    const result = await savePrivateFeedbackCommentAction(
      data.request_id,
      comment
    );
    setSubmittingComment(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setStep('empathetic_done');
  }

  const activeStarPreview = hoveredRating || selectedRating;

  if (step === 'already_submitted') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10 dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="mt-5 text-xs font-medium tracking-wide text-slate-500 dark:text-zinc-300">
          {data.business_name}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
          Tu opinión ya fue registrada
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
          Muchas gracias por tomarte el tiempo de compartir tu experiencia con
          nosotros.
        </p>

        {safeGoogleReviewUrl && (
          <div className="mt-7 border-t border-slate-200 pt-6 dark:border-white/[0.04]">
            <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
              Si además deseas dejar una reseña pública en Google, puedes
              hacerlo aquí:
            </p>
            <a
              href={safeGoogleReviewUrl}
              rel="noopener noreferrer"
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-5 text-sm font-semibold text-zinc-900 shadow-md shadow-amber-500/20 transition-all hover:from-amber-400 hover:to-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 dark:text-white"
            >
              <span>Publicar reseña en Google Maps</span>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        )}
      </motion.div>
    );
  }

  if (step === 'redirect_google') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10 dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-500 dark:text-amber-400">
          <Star className="h-6 w-6 fill-amber-500 dark:fill-amber-400" aria-hidden="true" />
        </div>

        <p className="mt-5 text-xs font-medium text-slate-500 dark:text-zinc-300">
          {data.business_name} · {selectedRating} de 5 estrellas
        </p>

        <h1 className="mt-2 text-balance text-2xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
          ¡Muchas gracias, {data.customer_name}!
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
          Nos alegra muchísimo saber que tuviste una excelente experiencia. Tu
          reseña pública ayuda a que más personas nos conozcan.
        </p>

        {safeGoogleReviewUrl ? (
          <div className="mt-8 space-y-4">
            <a
              href={safeGoogleReviewUrl}
              rel="noopener noreferrer"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-5 text-sm font-semibold text-zinc-900 shadow-md shadow-amber-500/20 transition-all hover:from-amber-400 hover:to-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 dark:text-white"
            >
              <span>Publicar reseña en Google Maps</span>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>

            <p className="text-xs text-slate-500 tabular-nums dark:text-zinc-400">
              {countdown > 0
                ? `Redirigiendo automáticamente a Google en ${countdown} s...`
                : 'Abriendo Google Maps...'}
            </p>
          </div>
        ) : (
          <p className="mt-6 text-xs text-slate-500 dark:text-zinc-400">
            Tu valoración ha sido guardada correctamente.
          </p>
        )}
      </motion.div>
    );
  }

  if (step === 'private_comment') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9 dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60"
      >
        <p className="text-xs font-medium text-slate-500 dark:text-zinc-300">
          {data.business_name} · {selectedRating} de 5 estrellas
        </p>
        <h1 className="mt-2 text-balance text-2xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
          Lamentamos que tu experiencia no haya sido ideal
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
          Cuéntanos qué pasó para mejorar y atender tu caso de inmediato. Tu
          comentario llegará directamente a nuestro equipo.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-700 dark:text-red-200"
          >
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
              aria-hidden="true"
            />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleCommentSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="private-feedback-comment"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
            >
              ¿Cómo podemos mejorar? (opcional)
            </label>
            <textarea
              id="private-feedback-comment"
              rows={4}
              disabled={submittingComment}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Escribe aquí tu experiencia o sugerencia..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              disabled={submittingComment}
              onClick={() => setStep('empathetic_done')}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:opacity-60 dark:border-none dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 hover:dark:bg-[#32323A] whitespace-nowrap shrink-0"
            >
              Omitir
            </button>
            <button
              type="submit"
              disabled={submittingComment}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-5 text-sm font-semibold text-zinc-900 shadow-md shadow-amber-500/20 transition-all hover:from-amber-400 hover:to-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 dark:text-white disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {submittingComment ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Enviando...</span>
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" aria-hidden="true" />
                  <span>Enviar comentario</span>
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    );
  }

  if (step === 'empathetic_done') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10 dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-600 dark:border-transparent dark:bg-[#27272E] dark:text-amber-400 dark:shadow-sm dark:shadow-black/40">
          <HeartHandshake className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="mt-5 text-xs font-medium text-slate-500 dark:text-zinc-300">
          {data.business_name}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
          Gracias por compartir tu opinión con nosotros
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
          Tu valoración nos ayuda mucho a mejorar. Nuestro equipo revisará tu
          caso de manera interna para ofrecerte un mejor servicio.
        </p>

        {safeGoogleReviewUrl && (
          <div className="mt-7 border-t border-slate-200 pt-6 dark:border-white/[0.04]">
            <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
              Si además deseas dejar una reseña pública en Google, puedes
              hacerlo aquí:
            </p>
            <a
              href={safeGoogleReviewUrl}
              rel="noopener noreferrer"
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-5 text-sm font-semibold text-zinc-900 shadow-md shadow-amber-500/20 transition-all hover:from-amber-400 hover:to-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 dark:text-white"
            >
              <span>Publicar reseña en Google Maps</span>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10 dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60"
    >
      <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
        {data.business_name}
      </p>

      <h1 className="mt-3 text-balance text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-zinc-50">
        Hola, {data.customer_name}. ¿Cómo fue tu experiencia?
      </h1>

      <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
        Toca una estrella para calificar la atención recibida. Solo te tomará un
        segundo.
      </p>

      {ownerBlocked && (
        <div
          role="status"
          className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-300/80 bg-amber-50/90 px-3.5 py-3 text-left text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <span>
            Estás viendo este enlace con tu sesión de propietario. Las
            calificaciones solo pueden ser enviadas por el cliente.
          </span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-left text-sm text-red-700 dark:text-red-200"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
            aria-hidden="true"
          />
          <span>{error}</span>
        </div>
      )}

      <div
        role="radiogroup"
        aria-label="Calificación de 1 a 5 estrellas"
        onMouseLeave={() => setHoveredRating(0)}
        className="mt-8 flex items-center justify-center gap-2 sm:gap-3"
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const isActive = !ownerBlocked && star <= activeStarPreview;
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={selectedRating === star}
              aria-label={`Calificar con ${star} ${
                star === 1 ? 'estrella' : 'estrellas'
              }`}
              disabled={submittingRating || ownerBlocked}
              onMouseEnter={() => {
                if (!ownerBlocked) setHoveredRating(star);
              }}
              onFocus={() => {
                if (!ownerBlocked) setHoveredRating(star);
              }}
              onBlur={() => setHoveredRating(0)}
              onClick={() => handleSelectRating(star)}
              className={`group flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-50 sm:h-14 sm:w-14 dark:border-transparent dark:bg-[#27272E] dark:shadow-sm dark:shadow-black/40 ${
                ownerBlocked
                  ? ''
                  : 'hover:scale-105 hover:border-amber-500/60 hover:dark:bg-[#32323A]'
              }`}
            >
              <Star
                className={`h-6 w-6 transition-colors sm:h-7 sm:w-7 ${
                  isActive
                    ? 'fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400'
                    : ownerBlocked
                    ? 'text-slate-300 dark:text-zinc-600'
                    : 'text-slate-300 group-hover:text-slate-400 dark:text-zinc-500 dark:group-hover:text-zinc-300'
                }`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      <div className="mt-5 min-h-[24px]">
        {ownerBlocked ? (
          <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">
            Vista de propietario · Votación deshabilitada
          </p>
        ) : submittingRating ? (
          <p className="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-300">
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-amber-500 dark:text-amber-400"
              aria-hidden="true"
            />
            <span>Guardando tu calificación...</span>
          </p>
        ) : (
          <p className="text-xs font-medium text-slate-500 dark:text-zinc-300">
            {activeStarPreview
              ? RATING_LABELS[activeStarPreview]
              : 'Selecciona de 1 a 5 estrellas'}
          </p>
        )}
      </div>
    </motion.div>
  );
}
