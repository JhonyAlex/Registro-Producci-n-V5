import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWeeklyReportArgs, recipientsFromEnvironment } from './weeklyReport';

describe('weeklyReport CLI', () => {
  it('acepta rango, force y dry-run', () => {
    assert.deepEqual(parseWeeklyReportArgs(['--from', '2026-08-31', '--to', '2026-09-06', '--force', '--dry-run']), {
      from: '2026-08-31', to: '2026-09-06', force: true, dryRun: true,
    });
  });

  it('rechaza valores ausentes y opciones desconocidas', () => {
    assert.throws(() => parseWeeklyReportArgs(['--from']), /Falta el valor/);
    assert.throws(() => parseWeeklyReportArgs(['--unexpected']), /Opción desconocida/);
  });

  it('usa el destinatario semanal por defecto cuando REPORT_TO no está definido', () => {
    const original = process.env.REPORT_TO;
    delete process.env.REPORT_TO;
    try {
      assert.deepEqual(recipientsFromEnvironment(), ['jhonyalexalvarez@gmail.com']);
    } finally {
      if (original === undefined) delete process.env.REPORT_TO;
      else process.env.REPORT_TO = original;
    }
  });
});
