export interface TemplateParams {
  customerName: string;
  businessName: string;
  reviewLink: string;
}

export function buildReviewLink(origin: string, requestId: string): string {
  const configuredBase = process.env.APP_URL?.trim();
  const base =
    configuredBase && configuredBase.startsWith('http')
      ? configuredBase.replace(/\/+$/, '')
      : origin.replace(/\/+$/, '');

  return `${base}/r/${requestId}`;
}

export function buildReminderMessage(
  template: string,
  { customerName, businessName, reviewLink }: TemplateParams
): string {
  const baseTemplate =
    template.trim() ||
    'Hola {nombre}, gracias por elegir {negocio}. ¿Cómo calificarías tu experiencia? {enlace}';

  const hasLinkToken =
    baseTemplate.includes('{enlace}') ||
    baseTemplate.includes('{{review_link}}');

  let message = baseTemplate
    .replaceAll('{nombre}', customerName)
    .replaceAll('{{customer_name}}', customerName)
    .replaceAll('{negocio}', businessName)
    .replaceAll('{{business_name}}', businessName)
    .replaceAll('{enlace}', reviewLink)
    .replaceAll('{{review_link}}', reviewLink);

  if (!hasLinkToken) {
    message = `${message} ${reviewLink}`;
  }

  return message;
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim()
  );
}

export interface DeliveryResult {
  ok: boolean;
  mode: 'twilio' | 'simulated';
  externalId?: string;
  error?: string;
}

export async function sendSmsOrSimulate(
  toPhone: string,
  body: string
): Promise<DeliveryResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();

  if (!accountSid || !authToken || !fromNumber) {
    return {
      ok: true,
      mode: 'simulated',
    };
  }

  try {
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      accountSid
    )}/Messages.json`;

    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString(
      'base64'
    );

    const formBody = new URLSearchParams({
      To: toPhone,
      From: fromNumber,
      Body: body,
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
    };

    if (!response.ok) {
      return {
        ok: false,
        mode: 'twilio',
        error:
          payload.message ||
          `Twilio respondió con estado HTTP ${response.status}.`,
      };
    }

    return {
      ok: true,
      mode: 'twilio',
      externalId: payload.sid,
    };
  } catch (err) {
    return {
      ok: false,
      mode: 'twilio',
      error:
        err instanceof Error
          ? err.message
          : 'Error de red al intentar enviar SMS con Twilio.',
    };
  }
}
