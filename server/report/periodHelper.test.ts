import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysToYmd,
  formatReportSubject,
  formatToSpanishDate,
  getMadridDateInfo,
  getPreviousWeekRange,
  isValidYmd,
  resolveReportRange,
} from './periodHelper';

describe('periodHelper - Cálculo temporal y rangos de reporte', () => {
  describe('addDaysToYmd', () => {
    it('debe sumar días correctamente dentro del mismo mes', () => {
      assert.equal(addDaysToYmd('2026-09-01', 5), '2026-09-06');
    });

    it('debe manejar cruces de mes hacia atrás', () => {
      assert.equal(addDaysToYmd('2026-09-02', -5), '2026-08-28');
    });

    it('debe manejar cruces de año hacia atrás', () => {
      assert.equal(addDaysToYmd('2026-01-02', -5), '2025-12-28');
    });

    it('debe respetar años bisiestos correctamente', () => {
      assert.equal(addDaysToYmd('2024-03-01', -1), '2024-02-29');
      assert.equal(addDaysToYmd('2023-03-01', -1), '2023-02-28');
    });
  });

  describe('getMadridDateInfo', () => {
    it('debe respetar la zona horaria Europe/Madrid frente a UTC', () => {
      // 2026-09-07 a las 23:30 UTC es 2026-09-08 a la 01:30 CEST (Martes)
      const dateUtc = new Date('2026-09-07T23:30:00.000Z');
      const info = getMadridDateInfo(dateUtc);
      assert.equal(info.ymd, '2026-09-08');
      assert.equal(info.dayOfWeek, 2); // Martes
    });
  });

  describe('getPreviousWeekRange', () => {
    it('calcula la semana anterior desde un Martes (08/09/2026)', () => {
      // 2026-09-08 es Martes
      const ref = new Date('2026-09-08T10:00:00.000Z');
      const range = getPreviousWeekRange(ref);
      assert.equal(range.from, '2026-08-31'); // Lunes
      assert.equal(range.to, '2026-09-06');   // Domingo
    });

    it('calcula la semana anterior desde un Lunes (07/09/2026)', () => {
      // 2026-09-07 es Lunes
      const ref = new Date('2026-09-07T09:00:00.000Z');
      const range = getPreviousWeekRange(ref);
      assert.equal(range.from, '2026-08-31'); // Lunes anterior
      assert.equal(range.to, '2026-09-06');   // Domingo anterior
    });

    it('calcula la semana anterior desde un Domingo (13/09/2026)', () => {
      // 2026-09-13 es Domingo
      const ref = new Date('2026-09-13T18:00:00.000Z');
      const range = getPreviousWeekRange(ref);
      assert.equal(range.from, '2026-08-31');
      assert.equal(range.to, '2026-09-06');
    });

    it('calcula la semana anterior en transición de año (Lunes 05/01/2026)', () => {
      // 2026-01-05 es Lunes
      const ref = new Date('2026-01-05T12:00:00.000Z');
      const range = getPreviousWeekRange(ref);
      assert.equal(range.from, '2025-12-29'); // Lunes
      assert.equal(range.to, '2026-01-04');   // Domingo
    });
  });

  describe('isValidYmd', () => {
    it('valida fechas correctas', () => {
      assert.equal(isValidYmd('2026-09-08'), true);
      assert.equal(isValidYmd('2024-02-29'), true);
    });

    it('invalida formatos incorrectos o fechas inexistentes', () => {
      assert.equal(isValidYmd('08/09/2026'), false);
      assert.equal(isValidYmd('2026-9-8'), false);
      assert.equal(isValidYmd('2023-02-29'), false);
      assert.equal(isValidYmd('2026-04-31'), false);
      assert.equal(isValidYmd('invalid-date'), false);
    });
  });

  describe('resolveReportRange', () => {
    it('acepta rango manual válido si se proporcionan ambos parámetros', () => {
      const range = resolveReportRange('2026-08-01', '2026-08-15');
      assert.equal(range.from, '2026-08-01');
      assert.equal(range.to, '2026-08-15');
    });

    it('falla si solo se proporciona --from o --to', () => {
      assert.throws(() => resolveReportRange('2026-08-01', null), /Debe proporcionar ambos/);
      assert.throws(() => resolveReportRange(null, '2026-08-15'), /Debe proporcionar ambos/);
    });

    it('falla si from > to', () => {
      assert.throws(() => resolveReportRange('2026-08-20', '2026-08-10'), /no puede ser posterior/);
    });

    it('falla con formato inválido', () => {
      assert.throws(() => resolveReportRange('2026-8-1', '2026-08-10'), /Fecha de inicio inválida/);
    });

    it('recae en semana natural anterior si no se pasa ningún argumento', () => {
      const ref = new Date('2026-09-08T10:00:00.000Z');
      const range = resolveReportRange(undefined, undefined, ref);
      assert.equal(range.from, '2026-08-31');
      assert.equal(range.to, '2026-09-06');
    });
  });

  describe('formatReportSubject y formatToSpanishDate', () => {
    it('formatea fechas a DD/MM/YYYY', () => {
      assert.equal(formatToSpanishDate('2026-08-31'), '31/08/2026');
      assert.equal(formatToSpanishDate('2026-09-06'), '06/09/2026');
    });

    it('genera el asunto con el formato exigido', () => {
      const subject = formatReportSubject('2026-08-31', '2026-09-06');
      assert.equal(subject, 'Registro Producción Pigmea V5 — 31/08/2026 al 06/09/2026');
    });
  });
});
