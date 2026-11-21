'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SubmitPublicRatingResult {
  success?: boolean;
  alreadySubmitted?: boolean;
  ownerBlocked?: boolean;
  redirectedToGoogle?: boolean;
  googleReviewUrl?: string | null;
  error?: string;
}

const OWNER_FORBIDDEN_ERROR =
  '403 Forbidden: El propietario del negocio no puede calificar solicitudes de clientes.';

async function isRequestOwnedByCurrentUser(
  requestId: string
): Promise<boolean> {
  const supabase = await createClient();
  if (!supabase) {
    return false;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  const adminClient = createAdminClient();
  if (adminClient) {
    const { data: reqRow } = await adminClient
      .from('review_requests')
      .select('business_id')
      .eq('id', requestId)
      .maybeSingle();

    if (!reqRow) {
      return false;
    }

    const { data: bizRow } = await adminClient
      .from('businesses')
      .select('user_id')
      .eq('id', reqRow.business_id)
      .maybeSingle();

    return Boolean(bizRow && bizRow.user_id === user.id);
  }

  const { data: reqRow } = await supabase
    .from('review_requests')
    .select('business_id')
    .eq('id', requestId)
    .maybeSingle();

  if (!reqRow) {
    return false;
  }

  const { data: bizRow } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', reqRow.business_id)
    .eq('user_id', user.id)
    .maybeSingle();

  return Boolean(bizRow);
}

export async function submitPublicRatingAction(
  requestId: string,
  rating: number
): Promise<SubmitPublicRatingResult> {
  if (!UUID_REGEX.test(requestId)) {
    return { error: 'El enlace de calificación no es válido.' };
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: 'Selecciona una calificación entre 1 y 5 estrellas.' };
  }

  if (await isRequestOwnedByCurrentUser(requestId)) {
    return {
      ownerBlocked: true,
      error: OWNER_FORBIDDEN_ERROR,
    };
  }

  const adminClient = createAdminClient();
  const redirectedToGoogle = rating >= 4;

  if (adminClient) {
    const { data: reqRow, error: reqError } = await adminClient
      .from('review_requests')
      .select('id, business_id, status')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError || !reqRow) {
      return { error: 'No se encontró la solicitud de reseña.' };
    }

    const { data: existingFeedback } = await adminClient
      .from('feedback')
      .select('id')
      .eq('request_id', requestId)
      .maybeSingle();

    if (reqRow.status === 'completed' || existingFeedback) {
      return { alreadySubmitted: true };
    }

    const { data: businessRow } = await adminClient
      .from('businesses')
      .select('google_review_url')
      .eq('id', reqRow.business_id)
      .maybeSingle();

    const { error: insertError } = await adminClient.from('feedback').insert({
      request_id: requestId,
      business_id: reqRow.business_id,
      rating,
      comment: null,
      redirected_to_google: redirectedToGoogle,
    });

    if (insertError) {
      if (insertError.code === '23505') {
        return { alreadySubmitted: true };
      }
      return {
        error: 'No se pudo guardar tu calificación. Inténtalo nuevamente.',
      };
    }

    const { data: updatedRequest, error: statusUpdateError } = await adminClient
      .from('review_requests')
      .update({ status: 'completed' })
      .eq('id', requestId)
      .select('id')
      .maybeSingle();

    if (statusUpdateError || !updatedRequest) {
      console.error(
        '[PublicReview] Error al actualizar el estado de la solicitud a completed:',
        statusUpdateError?.message ?? 'Fila no encontrada'
      );
      await adminClient.from('feedback').delete().eq('request_id', requestId);
      return {
        error:
          'No se pudo completar el registro de tu calificación. Inténtalo nuevamente.',
      };
    }

    revalidatePath('/dashboard');
    revalidatePath(`/r/${requestId}`);

    return {
      success: true,
      redirectedToGoogle,
      googleReviewUrl: businessRow?.google_review_url ?? null,
    };
  }

  const supabase = await createClient();
  if (!supabase) {
    return { error: 'La conexión con el servicio no está disponible.' };
  }

  const { data, error } = await supabase.rpc('submit_public_feedback', {
    p_request_id: requestId,
    p_rating: rating,
    p_comment: null,
  });

  if (error) {
    console.error('[PublicReview] Error RPC submit_public_feedback:', error.message);
    return {
      error:
        'No se pudo registrar tu calificación en este momento. Inténtalo de nuevo en unos segundos.',
    };
  }

  const payload = data as {
    success?: boolean;
    error?: string;
    redirected_to_google?: boolean;
    google_review_url?: string | null;
  } | null;

  if (payload?.error === 'already_submitted') {
    return { alreadySubmitted: true };
  }

  if (payload?.error === 'owner_forbidden') {
    return {
      ownerBlocked: true,
      error: OWNER_FORBIDDEN_ERROR,
    };
  }

  if (payload?.error === 'not_found' || !payload?.success) {
    return { error: 'No se encontró la solicitud de reseña.' };
  }

  revalidatePath('/dashboard');
  revalidatePath(`/r/${requestId}`);

  return {
    success: true,
    redirectedToGoogle: Boolean(payload.redirected_to_google),
    googleReviewUrl: payload.google_review_url ?? null,
  };
}

export async function savePrivateFeedbackCommentAction(
  requestId: string,
  comment: string
): Promise<{ success?: boolean; error?: string }> {
  if (!UUID_REGEX.test(requestId)) {
    return { error: 'El enlace de calificación no es válido.' };
  }

  const cleanComment = comment.trim();
  if (cleanComment.length > 2000) {
    return { error: 'El comentario no puede superar los 2000 caracteres.' };
  }

  if (!cleanComment) {
    return { error: 'Escribe un comentario antes de enviarlo.' };
  }

  if (await isRequestOwnedByCurrentUser(requestId)) {
    return { error: OWNER_FORBIDDEN_ERROR };
  }

  const adminClient = createAdminClient();

  if (adminClient) {
    const { data: updatedFeedback, error } = await adminClient
      .from('feedback')
      .update({ comment: cleanComment })
      .eq('request_id', requestId)
      .lte('rating', 3)
      .is('comment', null)
      .select('id')
      .maybeSingle();

    if (error) {
      return {
        error: 'No se pudo guardar tu comentario. Inténtalo de nuevo.',
      };
    }

    if (!updatedFeedback) {
      const { data: existingFeedback } = await adminClient
        .from('feedback')
        .select('id, rating, comment')
        .eq('request_id', requestId)
        .maybeSingle();

      if (existingFeedback && existingFeedback.comment !== null) {
        return {
          error: 'Tu comentario privado ya fue enviado anteriormente.',
        };
      }

      return {
        error: 'No se encontró la calificación para agregar un comentario.',
      };
    }

    revalidatePath('/dashboard');
    revalidatePath(`/r/${requestId}`);
    return { success: true };
  }

  const supabase = await createClient();
  if (!supabase) {
    return { error: 'La conexión con el servicio no está disponible.' };
  }

  const { data, error } = await supabase.rpc(
    'update_public_feedback_comment',
    {
      p_request_id: requestId,
      p_comment: cleanComment,
    }
  );

  if (error) {
    return { error: 'No se pudo guardar tu comentario. Inténtalo de nuevo.' };
  }

  const payload = data as { success?: boolean; error?: string } | null;
  if (payload?.error === 'owner_forbidden') {
    return { error: OWNER_FORBIDDEN_ERROR };
  }

  if (payload?.error === 'already_commented') {
    return { error: 'Tu comentario privado ya fue enviado anteriormente.' };
  }

  if (payload?.error === 'empty_comment') {
    return { error: 'Escribe un comentario antes de enviarlo.' };
  }

  if (!payload?.success) {
    return { error: 'No se encontró la calificación para agregar un comentario.' };
  }

  revalidatePath('/dashboard');
  revalidatePath(`/r/${requestId}`);
  return { success: true };
}
