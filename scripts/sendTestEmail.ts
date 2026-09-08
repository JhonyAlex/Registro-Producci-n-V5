import dotenv from 'dotenv';
import { sendEmail, DEFAULT_EMAIL_CONFIG } from '../server/email/resendEmailService';

dotenv.config();

async function runTestEmail(): Promise<void> {
  const subject = '[TEST] Registro Producción Pigmea V5 — Resend';
  const plainText = 'Prueba correcta de envío desde Registro Producción Pigmea V5 mediante Resend.\n\nhttps://produccion-nuevo.pigmea.click/';
  const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; background-color: #f8fafc; color: #1e293b;">
  <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    <h2 style="margin-top: 0; color: #0f172a; font-size: 20px; font-weight: 600;">Registro Producción Pigmea V5</h2>
    <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px;">
      Prueba correcta de envío desde Registro Producción Pigmea V5 mediante Resend.
    </p>
    <p style="margin-bottom: 28px;">
      <a href="https://produccion-nuevo.pigmea.click/" 
         style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 500; font-size: 14px;">
        Abrir Registro Producción Pigmea
      </a>
    </p>
    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
    <p style="font-size: 12px; color: #64748b; margin: 0;">
      Enlace directo: <a href="https://produccion-nuevo.pigmea.click/" style="color: #0284c7;">https://produccion-nuevo.pigmea.click/</a>
    </p>
  </div>
</body>
</html>
  `.trim();

  try {
    const result = await sendEmail({
      subject,
      html: htmlContent,
      text: plainText,
    });

    console.log(`Prueba de envío exitosa.`);
    console.log(`Resend ID: ${result.id}`);
    process.exit(0);
  } catch (error: any) {
    const rawError = error?.message || String(error);
    // Redactar cualquier clave que accidentalmente coincida con patrón re_...
    const sanitizedError = rawError.replace(/re_[a-zA-Z0-9_-]+/g, '[REDACTED_API_KEY]');
    console.error(`Error en la prueba de envío: ${sanitizedError}`);
    process.exit(1);
  }
}

runTestEmail();
