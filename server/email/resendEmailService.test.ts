import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEmailConfig,
  validateEmailConfig,
  sendEmail,
  DEFAULT_EMAIL_CONFIG,
} from './resendEmailService';

test('getEmailConfig uses defaults when environment variables are not set', () => {
  const originalEnv = { ...process.env };
  delete process.env.RESEND_API_KEY;
  delete process.env.REPORT_FROM;
  delete process.env.REPORT_TO;
  delete process.env.REPORT_REPLY_TO;

  try {
    const config = getEmailConfig();
    assert.equal(config.from, DEFAULT_EMAIL_CONFIG.from);
    assert.equal(config.to, DEFAULT_EMAIL_CONFIG.to);
    assert.equal(config.replyTo, DEFAULT_EMAIL_CONFIG.replyTo);
    assert.equal(config.apiKey, undefined);
  } finally {
    process.env = originalEnv;
  }
});

test('validateEmailConfig throws descriptive error when RESEND_API_KEY is missing', () => {
  assert.throws(
    () => validateEmailConfig({ apiKey: undefined, from: 'a', to: 'b', replyTo: 'c' }),
    /RESEND_API_KEY no está configurada/
  );

  assert.throws(
    () => validateEmailConfig({ apiKey: '   ', from: 'a', to: 'b', replyTo: 'c' }),
    /RESEND_API_KEY no está configurada/
  );
});

test('validateEmailConfig succeeds when RESEND_API_KEY is provided', () => {
  const result = validateEmailConfig({ apiKey: 're_test_key_123', from: 'a', to: 'b', replyTo: 'c' });
  assert.equal(result.apiKey, 're_test_key_123');
});

test('sendEmail fails fast on missing required fields', async () => {
  const originalEnv = { ...process.env };
  process.env.RESEND_API_KEY = 're_dummy_test_key';

  try {
    // Missing subject
    await assert.rejects(
      async () => {
        await sendEmail({
          subject: '',
          html: '<p>Test</p>',
        });
      },
      /Validación fallida: "subject" es obligatorio/
    );

    // Missing html
    await assert.rejects(
      async () => {
        await sendEmail({
          subject: 'Test Subject',
          html: '',
        });
      },
      /Validación fallida: "html" es obligatorio/
    );
  } finally {
    process.env = originalEnv;
  }
});
