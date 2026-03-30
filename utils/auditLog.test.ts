import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRecordAuditSnapshot,
  getRecordAuditChangedFields,
  hasRecordAuditChanges,
} from './auditLog';

test('treats identical record payloads as no-op updates', () => {
  const before = buildRecordAuditSnapshot({
    date: '2026-03-30',
    machine: 'WH1',
    shift: 'Mañana',
    boss: 'Cesar Ortega',
    bossUserId: 'boss-1',
    operator: 'Operario 1',
    operatorUserId: 'op-1',
    meters: 120,
    changesCount: 3,
    changesComment: '  ajuste fino  ',
    dynamicFieldsValues: { color: ' azul ', medidas: ['A', 'B'] },
    schemaVersionUsed: 4,
  });

  const after = buildRecordAuditSnapshot({
    date: '2026-03-30',
    machine: 'WH1',
    shift: 'Mañana',
    boss: 'Cesar Ortega',
    bossUserId: 'boss-1',
    operator: 'Operario 1',
    operatorUserId: 'op-1',
    meters: 120,
    changesCount: 3,
    changesComment: 'ajuste fino',
    dynamicFieldsValues: { medidas: ['A', 'B'], color: 'azul' },
    schemaVersionUsed: 4,
  });

  assert.equal(hasRecordAuditChanges(before, after), false);
  assert.deepEqual(getRecordAuditChangedFields(before, after), []);
});

test('detects dynamic field changes explicitly', () => {
  const before = buildRecordAuditSnapshot({
    date: '2026-03-30',
    machine: 'WH1',
    shift: 'Mañana',
    boss: 'Cesar Ortega',
    operator: 'Operario 1',
    meters: 120,
    changesCount: 3,
    changesComment: 'ajuste fino',
    dynamicFieldsValues: { color: 'azul', temperatura: 120 },
    schemaVersionUsed: 4,
  });

  const after = buildRecordAuditSnapshot({
    date: '2026-03-30',
    machine: 'WH1',
    shift: 'Mañana',
    boss: 'Cesar Ortega',
    operator: 'Operario 1',
    meters: 120,
    changesCount: 3,
    changesComment: 'ajuste fino',
    dynamicFieldsValues: { color: 'verde', temperatura: 120 },
    schemaVersionUsed: 4,
  });

  assert.equal(hasRecordAuditChanges(before, after), true);
  assert.deepEqual(getRecordAuditChangedFields(before, after), ['dynamicFieldsValues.color']);
});

test('detects schema version changes as audit-relevant', () => {
  const before = buildRecordAuditSnapshot({
    date: '2026-03-30',
    machine: 'WH1',
    shift: 'Mañana',
    boss: 'Cesar Ortega',
    operator: 'Operario 1',
    meters: 120,
    changesCount: 3,
    changesComment: 'ajuste fino',
    dynamicFieldsValues: {},
    schemaVersionUsed: 4,
  });

  const after = buildRecordAuditSnapshot({
    date: '2026-03-30',
    machine: 'WH1',
    shift: 'Mañana',
    boss: 'Cesar Ortega',
    operator: 'Operario 1',
    meters: 120,
    changesCount: 3,
    changesComment: 'ajuste fino',
    dynamicFieldsValues: {},
    schemaVersionUsed: 5,
  });

  assert.deepEqual(getRecordAuditChangedFields(before, after), ['schemaVersionUsed']);
});