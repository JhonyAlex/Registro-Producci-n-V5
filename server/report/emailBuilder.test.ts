import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyReportEmail, chartContentId, validateCapturedCharts, type CapturedChart } from './emailBuilder';

const completeCharts = (): CapturedChart[] => ['impresion', 'laminacion', 'rebobinado'].flatMap((lineId) =>
  [1, 2, 3, 4].map((chartIndex) => ({
    lineId: lineId as CapturedChart['lineId'],
    chartIndex: chartIndex as CapturedChart['chartIndex'],
    content: Buffer.from(`${lineId}-${chartIndex}`),
  }))
);

describe('emailBuilder', () => {
  it('compone las doce imágenes CID en tablas compatibles con Outlook', () => {
    const email = buildWeeklyReportEmail({ from: '2026-08-31', to: '2026-09-06' }, completeCharts());
    assert.equal(email.attachments.length, 12);
    assert.match(email.html, /<table role="presentation"/);
    assert.match(email.html, /Buenos días, envío reporte de producción/);
    assert.match(email.html, /Impresión:/);
    assert.match(email.html, /Laminado:/);
    assert.match(email.html, /Rebobinado:/);
    for (const chart of completeCharts()) {
      const contentId = chartContentId(chart.lineId, chart.chartIndex);
      assert.match(email.html, new RegExp(`cid:${contentId}`));
      assert.equal(email.attachments.find((attachment) => attachment.contentId === contentId)?.content?.length, chart.content.length);
    }
  });

  it('rechaza capturas incompletas, duplicadas o vacías', () => {
    assert.throws(() => validateCapturedCharts(completeCharts().slice(0, 11)), /exactamente 12/);
    const duplicate = completeCharts();
    duplicate[11] = { ...duplicate[0] };
    assert.throws(() => validateCapturedCharts(duplicate), /duplicado/);
    const empty = completeCharts();
    empty[0] = { ...empty[0], content: Buffer.alloc(0) };
    assert.throws(() => validateCapturedCharts(empty), /vacía/);
  });
});
