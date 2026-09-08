import puppeteer from 'puppeteer-core';
import { detectChromiumExecutable } from './chromiumDetector';
import { REPORT_LINES, type CapturedChart, validateCapturedCharts } from './emailBuilder';
import type { ReportDateRange } from './periodHelper';

export interface CaptureWeeklyReportOptions {
  baseUrl: string;
  secret: string;
  range: ReportDateRange;
  executablePath?: string;
}

export async function captureWeeklyReportCharts(options: CaptureWeeklyReportOptions): Promise<CapturedChart[]> {
  if (!options.secret.trim()) throw new Error('REPORT_RENDER_SECRET no está configurado.');
  const browser = await puppeteer.launch({
    executablePath: options.executablePath || detectChromiumExecutable(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1120, height: 900, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({ 'X-Report-Secret': options.secret });
    const url = new URL('/report-render', options.baseUrl);
    url.searchParams.set('from', options.range.from);
    url.searchParams.set('to', options.range.to);
    await page.goto(url.toString(), { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.waitForFunction(
      () => Boolean((window as any).__REPORT_READY__) || Boolean((window as any).__REPORT_ERROR__),
      { timeout: 15_000 }
    );
    const renderError = await page.evaluate(() => (window as any).__REPORT_ERROR__ as string | undefined);
    if (renderError) throw new Error(`El renderizador de reporte falló: ${renderError}`);

    const charts: CapturedChart[] = [];
    for (const line of REPORT_LINES) {
      for (const chartIndex of [1, 2, 3, 4] as const) {
        const selector = `#chart-${line.id}-${chartIndex}`;
        const element = await page.$(selector);
        if (!element) throw new Error(`No se encontró el contenedor requerido ${selector}.`);
        const content = Buffer.from(await element.screenshot({ type: 'png' }));
        charts.push({ lineId: line.id, chartIndex, content });
      }
    }
    validateCapturedCharts(charts);
    return charts;
  } finally {
    await browser.close();
  }
}
