import type { EmailAttachment } from '../email/resendEmailService';
import { formatReportSubject, type ReportDateRange } from './periodHelper';

export const REPORT_LINES = [
  { id: 'impresion', label: 'Impresión' },
  { id: 'laminacion', label: 'Laminado' },
  { id: 'rebobinado', label: 'Rebobinado' },
] as const;

export const REPORT_CHARTS = [
  'Producción por Máquina',
  'Producción por turno',
  'Metros por Operario',
  'Tendencia',
] as const;

export interface CapturedChart {
  lineId: (typeof REPORT_LINES)[number]['id'];
  chartIndex: 1 | 2 | 3 | 4;
  content: Buffer;
}

export function chartContentId(lineId: string, chartIndex: number): string {
  return `chart-${lineId}-${chartIndex}`;
}

export function validateCapturedCharts(charts: CapturedChart[]): void {
  if (charts.length !== 12) {
    throw new Error(`La captura debe contener exactamente 12 gráficas; se recibieron ${charts.length}.`);
  }

  const expected = new Set(
    REPORT_LINES.flatMap((line) => [1, 2, 3, 4].map((chartIndex) => chartContentId(line.id, chartIndex)))
  );
  const received = new Set<string>();

  for (const chart of charts) {
    const id = chartContentId(chart.lineId, chart.chartIndex);
    if (!expected.has(id) || received.has(id)) {
      throw new Error(`Identificador de gráfica inválido o duplicado: ${id}.`);
    }
    if (!Buffer.isBuffer(chart.content) || chart.content.length === 0) {
      throw new Error(`La gráfica ${id} está vacía.`);
    }
    received.add(id);
  }

  if (received.size !== expected.size) {
    throw new Error('Faltan gráficas requeridas en la captura.');
  }
}

export function buildWeeklyReportEmail(range: ReportDateRange, charts: CapturedChart[]) {
  validateCapturedCharts(charts);
  const byId = new Map(charts.map((chart) => [chartContentId(chart.lineId, chart.chartIndex), chart]));
  const attachments: EmailAttachment[] = [];

  const sections = REPORT_LINES.map((line) => {
    const cells = [1, 2, 3, 4].map((chartIndex) => {
      const contentId = chartContentId(line.id, chartIndex);
      const chart = byId.get(contentId)!;
      attachments.push({
        filename: `${contentId}.png`,
        content: chart.content,
        contentType: 'image/png',
        contentId,
      });
      return `<td width="50%" valign="top" style="padding:8px;"><img src="cid:${contentId}" alt="${REPORT_CHARTS[chartIndex - 1]} · ${line.label}" width="460" style="display:block;width:100%;max-width:460px;height:auto;border:0;outline:none;text-decoration:none;" /></td>`;
    });
    return `<h2 style="margin:28px 0 8px;font-family:Arial,sans-serif;font-size:18px;color:#1e293b;">${line.label}:</h2><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr>${cells[0]}${cells[1]}</tr><tr>${cells[2]}${cells[3]}</tr></table>`;
  }).join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td style="padding:20px;"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:980px;"><tr><td style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#0f172a;"><p>Buenos días, envío reporte de producción.</p><p><a href="https://produccion-nuevo.pigmea.click/">https://produccion-nuevo.pigmea.click/</a></p><p>Por línea de producción</p>${sections}</td></tr></table></td></tr></table></body></html>`;
  const text = `Buenos días, envío reporte de producción.\n\nhttps://produccion-nuevo.pigmea.click/\n\nPor línea de producción\n\nImpresión\nLaminado\nRebobinado`;

  return { subject: formatReportSubject(range.from, range.to), html, text, attachments };
}
