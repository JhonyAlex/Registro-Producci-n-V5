import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { pathToFileURL } from 'url';
import { Pool } from 'pg';
import { sendEmail } from '../server/email/resendEmailService';
import { buildWeeklyReportEmail } from '../server/report/emailBuilder';
import { resolveReportRange } from '../server/report/periodHelper';
import { markReportRunFailed, markReportRunSuccess, startOrUpdateReportRun } from '../server/report/reportRunRepository';
import { captureWeeklyReportCharts } from '../server/report/weeklyReportCapture';

interface CliOptions {
  from?: string;
  to?: string;
  force: boolean;
  dryRun: boolean;
}

export function parseWeeklyReportArgs(args: string[]): CliOptions {
  const result: CliOptions = { force: false, dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--force') result.force = true;
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--from' || arg === '--to') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Falta el valor para ${arg}.`);
      result[arg.slice(2) as 'from' | 'to'] = value;
      index += 1;
    } else {
      throw new Error(`Opción desconocida: ${arg}. Use --from, --to, --force o --dry-run.`);
    }
  }
  return result;
}

function recipientsFromEnvironment(): string[] {
  const recipients = (process.env.REPORT_TO || '')
    .split(',')
    .map((recipient) => recipient.trim().toLowerCase())
    .filter(Boolean);
  if (recipients.length === 0) throw new Error('REPORT_TO debe contener al menos un destinatario.');
  return [...new Set(recipients)];
}

async function healthIsReady(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/api/health', baseUrl));
    if (!response.ok) return false;
    const body = await response.json() as { ok?: boolean; isDbConnected?: boolean };
    return body.ok === true && body.isDbConnected === true;
  } catch {
    return false;
  }
}

async function waitForHealth(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthIsReady(baseUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`El servidor no estuvo listo en ${timeoutMs / 1000} segundos (${baseUrl}).`);
}

async function ensureLocalServer(baseUrl: string): Promise<{ child?: ChildProcess }> {
  if (await healthIsReady(baseUrl)) return {};
  // Invoke the local tsx CLI through Node instead of npm.cmd. Node cannot
  // spawn .cmd files directly on Windows without a shell, and a shell would
  // unnecessarily complicate argument handling here.
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(process.execPath, [tsxCli, 'server.ts'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => process.stdout.write(`[report-server] ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`[report-server] ${chunk}`));
  try {
    await waitForHealth(baseUrl);
    return { child };
  } catch (error) {
    await stopLocalServer(child);
    throw error;
  }
}

async function stopLocalServer(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform !== 'win32') {
    child.kill();
    return;
  }

  // tsx can create a child process on Windows. Terminating the known process
  // tree ensures a failed preflight never leaves a server listening on :3000.
  await new Promise<void>((resolve) => {
    const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    taskkill.once('close', () => resolve());
    taskkill.once('error', () => {
      child.kill();
      resolve();
    });
  });
}

async function writePreview(
  range: { from: string; to: string },
  html: string,
  charts: Awaited<ReturnType<typeof captureWeeklyReportCharts>>
): Promise<{ directory: string; totalBytes: number }> {
  const suffix = `${range.from}_${range.to}_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const directory = path.join(process.cwd(), 'temp', 'report-preview', suffix);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'report.html'), html, 'utf8');
  await Promise.all(charts.map((chart) =>
    fs.writeFile(path.join(directory, `chart-${chart.lineId}-${chart.chartIndex}.png`), chart.content)
  ));
  return { directory, totalBytes: charts.reduce((sum, chart) => sum + chart.content.length, 0) };
}

async function main(): Promise<void> {
  const options = parseWeeklyReportArgs(process.argv.slice(2));
  const range = resolveReportRange(options.from, options.to);
  const baseUrl = process.env.REPORT_BASE_URL?.trim() || 'http://127.0.0.1:3000';
  const secret = process.env.REPORT_RENDER_SECRET?.trim();
  if (!secret) throw new Error('REPORT_RENDER_SECRET no está configurado.');

  const server = await ensureLocalServer(baseUrl);
  try {
    const charts = await captureWeeklyReportCharts({ baseUrl, secret, range });
    const email = buildWeeklyReportEmail(range, charts);

    if (options.dryRun) {
      const preview = await writePreview(range, email.html, charts);
      console.log(`Dry run completado: 12 PNG y report.html en ${preview.directory}`);
      console.log(`Peso total de las gráficas: ${preview.totalBytes} bytes.`);
      return;
    }

    const recipients = recipientsFromEnvironment();
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pigmea',
      connectionTimeoutMillis: 3_000,
    });
    try {
      for (const recipient of recipients) {
        const { run, alreadySent } = await startOrUpdateReportRun(
          pool, 'production-weekly', range.from, range.to, recipient, options.force
        );
        if (alreadySent) {
          console.log(`No enviado a ${recipient}: el periodo ya figura como enviado. Use --force para reenviar.`);
          continue;
        }
        try {
          const suffix = options.force ? `/force-${run.attempts}` : '';
          const result = await sendEmail({
            to: recipient,
            subject: email.subject,
            html: email.html,
            text: email.text,
            attachments: email.attachments,
            idempotencyKey: `production-weekly/${range.from}_${range.to}/${recipient}${suffix}`,
          });
          await markReportRunSuccess(pool, run.id, result.id);
          console.log(`Reporte enviado a ${recipient}. Resend ID: ${result.id}`);
        } catch (error) {
          const message = String(error instanceof Error ? error.message : error).slice(0, 2_000);
          await markReportRunFailed(pool, run.id, message);
          throw error;
        }
      }
    } finally {
      await pool.end();
    }
  } finally {
    if (server.child) await stopLocalServer(server.child);
  }
}

const invokedFile = process.argv[1];
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  main().catch((error) => {
    console.error(`El reporte semanal no se completó: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
