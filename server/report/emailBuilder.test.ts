import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyReportEmail, chartContentId, validateCapturedCharts, type CapturedChart } from './emailBuilder';

const completeCharts = (): CapturedChart[] => ['impresion', 'laminacion', 'rebobinado'].flatMap((lineId) =>
  [1, 2, 3, 4, 5, 6].map((chartIndex) => ({
    lineId: lineId as CapturedChart['lineId'],
    chartIndex: chartIndex as CapturedChart['chartIndex'],
    content: Buffer.from(`${lineId}-${chartIndex}`),
  }))
);

describe('emailBuilder', () => {
  it('compone las dieciocho imágenes CID en tablas compatibles con Outlook y en orden fijo', () => {
    const email = buildWeeklyReportEmail({ from: '2026-08-31', to: '2026-09-06' }, completeCharts());
    assert.equal(email.attachments.length, 18);
    assert.match(email.html, /<table role="presentation"/);
    assert.match(email.html, /Buenos días, envío reporte de producción correspondiente a la Semana 1 de septiembre de 2026 \(31\/08\/2026 al 06\/09\/2026\)\./);
    assert.equal(email.subject, 'Registro Producción Pigmea V5 — Semana 1 de septiembre de 2026 — 31/08/2026 al 06/09/2026');
    assert.ok(email.html.indexOf('Impresión:') < email.html.indexOf('Laminación:'));
    assert.ok(email.html.indexOf('Laminación:') < email.html.indexOf('Rebobinado:'));
    assert.match(email.html, /Cambios de pedido por Operario · Impresión/);
    assert.match(email.html, /Metros vs Cambios de pedido por Operario · Rebobinado/);
    // Tres filas por dos columnas: sin celdas de relleno.
    assert.doesNotMatch(email.html, /&nbsp;/);
    for (const chart of completeCharts()) {
      const contentId = chartContentId(chart.lineId, chart.chartIndex);
      assert.match(email.html, new RegExp(`cid:${contentId}`));
      assert.equal(email.attachments.find((attachment) => attachment.contentId === contentId)?.content?.length, chart.content.length);
    }
  });

  it('rechaza capturas incompletas, duplicadas o vacías', () => {
    assert.throws(() => validateCapturedCharts(completeCharts().slice(0, 17)), /exactamente 18/);
    const duplicate = completeCharts();
    duplicate[11] = { ...duplicate[0] };
    assert.throws(() => validateCapturedCharts(duplicate), /duplicado/);
    const empty = completeCharts();
    empty[0] = { ...empty[0], content: Buffer.alloc(0) };
    assert.throws(() => validateCapturedCharts(empty), /vacía/);
  });
});
