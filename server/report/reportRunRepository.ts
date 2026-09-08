import { Pool } from 'pg';

export interface ReportRunRecord {
  id: string;
  reportType: string;
  startDate: string;
  endDate: string;
  recipient: string;
  status: 'processing' | 'sent' | 'failed';
  resendId?: string | null;
  attempts: number;
  createdAt: Date;
  lastAttemptAt?: Date | null;
  sentAt?: Date | null;
  updatedAt: Date;
  errorMessage?: string | null;
}

export function normalizeRecipient(recipient: string | string[]): string {
  if (Array.isArray(recipient)) {
    return recipient
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join(', ');
  }
  return recipient
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(', ');
}

export async function getReportRun(
  pool: Pool,
  reportType: string,
  startDate: string,
  endDate: string,
  recipient: string
): Promise<ReportRunRecord | null> {
  const normRecipient = normalizeRecipient(recipient);
  const result = await pool.query(
    `SELECT id,
            report_type as "reportType",
            start_date as "startDate",
            end_date as "endDate",
            recipient,
            status,
            resend_id as "resendId",
            attempts,
            created_at as "createdAt",
            last_attempt_at as "lastAttemptAt",
            sent_at as "sentAt",
            updated_at as "updatedAt",
            error_message as "errorMessage"
     FROM report_email_runs
     WHERE report_type = $1 AND start_date = $2 AND end_date = $3 AND recipient = $4
     LIMIT 1`,
    [reportType, startDate, endDate, normRecipient]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

export async function startOrUpdateReportRun(
  pool: Pool,
  reportType: string,
  startDate: string,
  endDate: string,
  recipient: string,
  force: boolean = false
): Promise<{ run: ReportRunRecord; alreadySent: boolean }> {
  const normRecipient = normalizeRecipient(recipient);

  const existing = await getReportRun(pool, reportType, startDate, endDate, normRecipient);

  if (existing) {
    if (existing.status === 'sent' && !force) {
      return { run: existing, alreadySent: true };
    }

    const updateResult = await pool.query(
      `UPDATE report_email_runs
       SET status = 'processing',
           attempts = attempts + 1,
           last_attempt_at = NOW(),
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id,
                 report_type as "reportType",
                 start_date as "startDate",
                 end_date as "endDate",
                 recipient,
                 status,
                 resend_id as "resendId",
                 attempts,
                 created_at as "createdAt",
                 last_attempt_at as "lastAttemptAt",
                 sent_at as "sentAt",
                 updated_at as "updatedAt",
                 error_message as "errorMessage"`,
      [existing.id]
    );

    return { run: updateResult.rows[0], alreadySent: false };
  }

  const insertResult = await pool.query(
    `INSERT INTO report_email_runs (
       report_type, start_date, end_date, recipient, status, attempts, last_attempt_at
     )
     VALUES ($1, $2, $3, $4, 'processing', 1, NOW())
     ON CONFLICT (report_type, start_date, end_date, recipient)
     DO UPDATE SET
       status = 'processing',
       attempts = report_email_runs.attempts + 1,
       last_attempt_at = NOW(),
       error_message = NULL,
       updated_at = NOW()
     RETURNING id,
               report_type as "reportType",
               start_date as "startDate",
               end_date as "endDate",
               recipient,
               status,
               resend_id as "resendId",
               attempts,
               created_at as "createdAt",
               last_attempt_at as "lastAttemptAt",
               sent_at as "sentAt",
               updated_at as "updatedAt",
               error_message as "errorMessage"`,
    [reportType, startDate, endDate, normRecipient]
  );

  return { run: insertResult.rows[0], alreadySent: false };
}

export async function markReportRunSuccess(
  pool: Pool,
  id: string,
  resendId: string
): Promise<void> {
  await pool.query(
    `UPDATE report_email_runs
     SET status = 'sent',
         resend_id = $2,
         sent_at = NOW(),
         error_message = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [id, resendId]
  );
}

export async function markReportRunFailed(
  pool: Pool,
  id: string,
  errorMessage: string
): Promise<void> {
  await pool.query(
    `UPDATE report_email_runs
     SET status = 'failed',
         error_message = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [id, errorMessage]
  );
}
