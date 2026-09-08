import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWeeklyReportArgs } from './weeklyReport';

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
});
