import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecipient, startOrUpdateReportRun } from './reportRunRepository';

const run = {
  id: 'run-1', reportType: 'production-weekly', startDate: '2026-08-31', endDate: '2026-09-06',
  recipient: 'a@pigmea.es', status: 'processing', attempts: 1, createdAt: new Date(), updatedAt: new Date(),
};

describe('reportRunRepository', () => {
  it('normaliza varios destinatarios de forma determinista', () => {
    assert.equal(normalizeRecipient(' B@Pigmea.es, a@pigmea.es, '), 'a@pigmea.es, b@pigmea.es');
  });

  it('crea el run si no existe', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return sql.includes('SELECT id') ? { rows: [] } : { rows: [run] };
      },
    };
    const result = await startOrUpdateReportRun(pool as any, 'production-weekly', '2026-08-31', '2026-09-06', 'a@pigmea.es');
    assert.equal(result.alreadySent, false);
    assert.equal(result.run.id, 'run-1');
    assert.ok(queries.some((sql) => sql.includes('INSERT INTO report_email_runs')));
  });

  it('no reenvía un periodo que ya está marcado como sent sin --force', async () => {
    const pool = {
      query: async () => ({ rows: [{ ...run, status: 'sent' }] }),
    };
    const result = await startOrUpdateReportRun(pool as any, 'production-weekly', '2026-08-31', '2026-09-06', 'a@pigmea.es');
    assert.equal(result.alreadySent, true);
    assert.equal(result.run.status, 'sent');
  });

  it('reinicia un sent cuando se solicita --force', async () => {
    let call = 0;
    const pool = {
      query: async () => ({ rows: call++ === 0 ? [{ ...run, status: 'sent' }] : [{ ...run, attempts: 2 }] }),
    };
    const result = await startOrUpdateReportRun(pool as any, 'production-weekly', '2026-08-31', '2026-09-06', 'a@pigmea.es', true);
    assert.equal(result.alreadySent, false);
    assert.equal(result.run.attempts, 2);
  });
});
