import PublicReviewFlow from '@/components/PublicReviewFlow';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { sanitizeGoogleReviewUrl } from '@/lib/validation/google-review-url';
import { isValidUuid } from '@/lib/validation/uuid';
import type { PublicReviewRequestData } from '@/types/database';

export const dynamic = 'force-dynamic';

interface PublicReviewPageProps {
  params: Promise<{ requestId: string }>;
}

interface RpcPublicReviewRow {
  request_id: string;
  customer_name: string;
  business_id?: string;
  business_name: string;
  google_review_url: string | null;
  already_submitted: boolean;
  submitted_rating?: number | null;
  needs_private_comment?: boolean;
  is_owner?: boolean;
}

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createClient();
  if (!supabase) {
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

async function checkIsBusinessOwner(businessId: string): Promise<boolean> {
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
    const { data: bizRow } = await adminClient
      .from('businesses')
      .select('user_id')
      .eq('id', businessId)
      .maybeSingle();

    return Boolean(bizRow && bizRow.user_id === user.id);
  }

  const { data: ownedBiz } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .eq('user_id', user.id)
    .maybeSingle();

  return Boolean(ownedBiz);
}

async function fetchPublicReviewRequest(requestId: string): Promise<{
  data: PublicReviewRequestData | null;
  isOwner: boolean;
  error?: string;
}> {
  if (!isValidUuid(requestId, { strictVersion: true })) {
    return { data: null, isOwner: false, error: 'invalid_id' };
  }

  const adminClient = createAdminClient();
  if (adminClient) {
    const { data: reqRow, error: reqError } = await adminClient
      .from('review_requests')
      .select('id, customer_name, status, business_id')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError || !reqRow) {
      return { data: null, isOwner: false, error: 'not_found' };
    }

    const [{ data: businessRow }, { data: feedbackRow }, currentUserId] =
      await Promise.all([
        adminClient
          .from('businesses')
          .select('user_id, business_name, google_review_url')
          .eq('id', reqRow.business_id)
          .maybeSingle(),
        adminClient
          .from('feedback')
          .select('id, rating, comment')
          .eq('request_id', requestId)
          .maybeSingle(),
        getAuthenticatedUserId(),
      ]);

    if (!businessRow) {
      return { data: null, isOwner: false, error: 'not_found' };
    }

    const needsPrivateComment = Boolean(
      feedbackRow && feedbackRow.rating <= 3 && feedbackRow.comment === null
    );

    return {
      isOwner: Boolean(currentUserId && businessRow.user_id === currentUserId),
      data: {
        request_id: reqRow.id,
        customer_name: reqRow.customer_name,
        business_name: businessRow.business_name,
        google_review_url: sanitizeGoogleReviewUrl(
          businessRow.google_review_url
        ),
        already_submitted: reqRow.status === 'completed' || Boolean(feedbackRow),
        submitted_rating: needsPrivateComment
          ? (feedbackRow?.rating ?? null)
          : null,
        needs_private_comment: needsPrivateComment,
      },
    };
  }

  const supabase = await createClient();
  if (!supabase) {
    return { data: null, isOwner: false, error: 'not_configured' };
  }

  const { data, error } = await supabase.rpc('get_public_review_request', {
    p_request_id: requestId,
  });

  if (error) {
    return { data: null, isOwner: false, error: 'rpc_error' };
  }

  if (!data) {
    return { data: null, isOwner: false, error: 'not_found' };
  }

  const rpcData = data as RpcPublicReviewRow;
  const needsPrivateComment = Boolean(rpcData.needs_private_comment);
  const isOwner =
    typeof rpcData.is_owner === 'boolean'
      ? rpcData.is_owner
      : rpcData.business_id
        ? await checkIsBusinessOwner(rpcData.business_id)
        : false;

  return {
    isOwner,
    data: {
      request_id: rpcData.request_id,
      customer_name: rpcData.customer_name,
      business_name: rpcData.business_name,
      google_review_url: sanitizeGoogleReviewUrl(rpcData.google_review_url),
      already_submitted: Boolean(rpcData.already_submitted),
      submitted_rating: needsPrivateComment
        ? (rpcData.submitted_rating ?? null)
        : null,
      needs_private_comment: needsPrivateComment,
    },
  };
}

export default async function PublicReviewPage({
  params,
}: PublicReviewPageProps) {
  const { requestId } = await params;
  const { data, isOwner, error } = await fetchPublicReviewRequest(requestId);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 px-4 py-12 text-slate-900 transition-colors duration-200 dark:bg-black dark:text-zinc-100">
      <main className="flex flex-1 items-center justify-center">
        {data ? (
          <PublicReviewFlow data={data} isOwner={isOwner} />
        ) : (
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
              {error === 'invalid_id'
                ? 'Enlace no válido'
                : error === 'rpc_error'
                ? 'No se pudo cargar la encuesta'
                : 'Solicitud no encontrada'}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
              {error === 'invalid_id'
                ? 'El identificador de esta invitación no tiene un formato válido.'
                : error === 'rpc_error'
                ? 'No pudimos cargar esta invitación en este momento. Intenta recargar la página en unos segundos.'
                : 'Es posible que este enlace haya expirado o no exista.'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
