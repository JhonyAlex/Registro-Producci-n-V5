import { Resend } from 'resend';
import type { Attachment } from 'resend';

export interface EmailAttachment {
  filename: string;
  content?: string | Buffer;
  path?: string;
  contentType?: string;
  contentId?: string;
}

export interface SendEmailOptions {
  from?: string;
  to?: string | string[];
  replyTo?: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  id: string;
}

export const DEFAULT_EMAIL_CONFIG = {
  from: 'Producción Pigmea <produccion@notificaciones.pigmea.click>',
  to: 'jaalvarez@pigmea.es',
  replyTo: 'jaalvarez@pigmea.es',
} as const;

export function getEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.REPORT_FROM?.trim() || DEFAULT_EMAIL_CONFIG.from;
  const to = process.env.REPORT_TO?.trim() || DEFAULT_EMAIL_CONFIG.to;
  const replyTo = process.env.REPORT_REPLY_TO?.trim() || DEFAULT_EMAIL_CONFIG.replyTo;

  return {
    apiKey,
    from,
    to,
    replyTo,
  };
}

export function validateEmailConfig(config = getEmailConfig()): { apiKey: string } {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error('Configuración incompleta: RESEND_API_KEY no está configurada o está vacía.');
  }
  return { apiKey };
}

let resendClientInstance: Resend | null = null;
let lastApiKeyUsed: string | null = null;

export function getResendClient(apiKey?: string): Resend {
  const key = apiKey || validateEmailConfig().apiKey;
  if (!resendClientInstance || lastApiKeyUsed !== key) {
    resendClientInstance = new Resend(key);
    lastApiKeyUsed = key;
  }
  return resendClientInstance;
}

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const config = getEmailConfig();
  const { apiKey } = validateEmailConfig(config);

  const from = options.from || config.from;
  const to = options.to || config.to;
  const replyTo = options.replyTo || config.replyTo;
  const subject = options.subject?.trim();
  const html = options.html?.trim();

  if (!from) {
    throw new Error('Validación fallida: "from" es obligatorio.');
  }

  if (!to || (Array.isArray(to) && to.length === 0)) {
    throw new Error('Validación fallida: "to" es obligatorio.');
  }

  if (!subject) {
    throw new Error('Validación fallida: "subject" es obligatorio.');
  }

  if (!html) {
    throw new Error('Validación fallida: "html" es obligatorio.');
  }

  const resend = getResendClient(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      replyTo: replyTo || undefined,
      subject,
      html,
      text: options.text,
      attachments: options.attachments as Attachment[] | undefined,
    });

    if (error) {
      const errorMsg = error.message || 'Error desconocido de Resend';
      const errorName = error.name || 'ResendSendError';
      console.error(`[ResendEmailService] Error en llamada a Resend: [${errorName}] ${errorMsg}`);
      throw new Error(`Resend rechazó el envío: [${errorName}] ${errorMsg}`);
    }

    if (!data?.id) {
      console.error('[ResendEmailService] Respuesta sin id devuelto');
      throw new Error('Resend no devolvió un ID de correo válido.');
    }

    console.log(`[ResendEmailService] Correo enviado exitosamente. Resend ID: ${data.id}`);
    return { id: data.id };
  } catch (err: any) {
    const rawMessage = String(err?.message || err);
    // Garantizar que la API key nunca se filtre en logs o mensajes de excepción
    const cleanMessage = rawMessage.replace(apiKey, '[REDACTED_API_KEY]');
    if (err instanceof Error) {
      err.message = cleanMessage;
      throw err;
    }
    throw new Error(cleanMessage);
  }
}
