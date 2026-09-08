/**
 * Utilidades de cálculo temporal y validación de rangos para reportes de producción.
 * Garantiza cálculo determinista en zona horaria Europe/Madrid sin depender del UTC del host.
 */

export interface ReportDateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

const MADRID_TZ = 'Europe/Madrid';

const WEEKDAY_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/**
 * Suma o resta días a una fecha en formato YYYY-MM-DD de forma puramente matemática UTC,
 * evitando desviaciones horarias de cambios de horario de verano/invierno.
 */
export function addDaysToYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);

  const y = utcDate.getUTCFullYear();
  const m = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Obtiene la fecha YYYY-MM-DD y día de la semana (1=Lunes .. 7=Domingo) en Europe/Madrid.
 */
export function getMadridDateInfo(date: Date = new Date()): { ymd: string; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MADRID_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const ymd = formatter.format(date); // en-CA produce YYYY-MM-DD

  const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MADRID_TZ,
    weekday: 'short',
  });
  const weekdayStr = weekdayFormatter.format(date); // Mon, Tue, etc.
  const dayOfWeek = WEEKDAY_MAP[weekdayStr] || 1;

  return { ymd, dayOfWeek };
}

/**
 * Calcula la semana natural anterior completa (Lunes a Domingo) en Europe/Madrid
 * a partir de una fecha de referencia (por defecto: ahora).
 */
export function getPreviousWeekRange(referenceDate: Date = new Date()): ReportDateRange {
  const { ymd, dayOfWeek } = getMadridDateInfo(referenceDate);

  // Lunes de la semana anterior: restar (dayOfWeek - 1) + 7 días
  const daysToPrevMonday = -((dayOfWeek - 1) + 7);
  // Domingo de la semana anterior: restar (dayOfWeek - 1) + 1 día
  const daysToPrevSunday = -((dayOfWeek - 1) + 1);

  const from = addDaysToYmd(ymd, daysToPrevMonday);
  const to = addDaysToYmd(ymd, daysToPrevSunday);

  return { from, to };
}

/**
 * Valida si una cadena es una fecha válida YYYY-MM-DD.
 */
export function isValidYmd(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return false;
  }
  const [year, month, day] = str.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Resuelve el rango de fechas para el reporte:
 * Si se proporcionan from y to, los valida y asegura from <= to.
 * Si se omite ambos, calcula la semana natural anterior en Europe/Madrid.
 * Si solo se especifica uno, lanza un error claro.
 */
export function resolveReportRange(
  fromStr?: string | null,
  toStr?: string | null,
  referenceDate: Date = new Date()
): ReportDateRange {
  const hasFrom = Boolean(fromStr && fromStr.trim());
  const hasTo = Boolean(toStr && toStr.trim());

  if (hasFrom && hasTo) {
    const from = fromStr!.trim();
    const to = toStr!.trim();

    if (!isValidYmd(from)) {
      throw new Error(`Fecha de inicio inválida: '${from}'. Debe tener formato YYYY-MM-DD.`);
    }
    if (!isValidYmd(to)) {
      throw new Error(`Fecha de fin inválida: '${to}'. Debe tener formato YYYY-MM-DD.`);
    }
    if (from > to) {
      throw new Error(`Rango inválido: la fecha de inicio (${from}) no puede ser posterior a la fecha de fin (${to}).`);
    }

    return { from, to };
  }

  if (hasFrom || hasTo) {
    throw new Error('Debe proporcionar ambos parámetros (--from YYYY-MM-DD y --to YYYY-MM-DD) o ninguno.');
  }

  return getPreviousWeekRange(referenceDate);
}

/**
 * Convierte YYYY-MM-DD a DD/MM/YYYY.
 */
export function formatToSpanishDate(ymd: string): string {
  const [year, month, day] = ymd.split('-');
  return `${day}/${month}/${year}`;
}

const SPANISH_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

export interface ReportWeekOfMonth {
  week: number;
  month: string;
  year: number;
}

/**
 * Devuelve la semana del mes que corresponde al final del periodo. El reporte
 * siempre termina en domingo, por lo que no depende del mes del lunes inicial.
 */
export function getWeekOfMonth(endDate: string): ReportWeekOfMonth {
  if (!isValidYmd(endDate)) {
    throw new Error(`Fecha de fin inválida: '${endDate}'. Debe tener formato YYYY-MM-DD.`);
  }
  const [year, month, day] = endDate.split('-').map(Number);
  return {
    week: Math.ceil(day / 7),
    month: SPANISH_MONTHS[month - 1],
    year,
  };
}

export function formatReportWeekLabel(endDate: string): string {
  const { week, month, year } = getWeekOfMonth(endDate);
  return `Semana ${week} de ${month} de ${year}`;
}

/**
 * Genera el asunto estándar del reporte:
 * "Registro Producción Pigmea V5 — Semana N de mes de YYYY — DD/MM/YYYY al DD/MM/YYYY"
 */
export function formatReportSubject(startDate: string, endDate: string): string {
  const startDisplay = formatToSpanishDate(startDate);
  const endDisplay = formatToSpanishDate(endDate);
  return `Registro Producción Pigmea V5 — ${formatReportWeekLabel(endDate)} — ${startDisplay} al ${endDisplay}`;
}
