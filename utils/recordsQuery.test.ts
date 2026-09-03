import test from 'node:test';
import assert from 'node:assert/strict';

// Helper function mirroring query param and pagination calculations
function parsePagination(totalCount: number, limit: number, page: number) {
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.max(1, Math.ceil(totalCount / safeLimit));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const offset = (safePage - 1) * safeLimit;
  return { safeLimit, totalPages, safePage, offset };
}

function buildRecordQueryString(params: {
  page?: number;
  limit?: number | 'all';
  startDate?: string;
  endDate?: string;
  machine?: string;
  machines?: string[];
  boss?: string;
  operator?: string;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}) {
  const query = new URLSearchParams();
  query.set('paginate', 'true');
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.boss) query.set('boss', params.boss);
  if (params.operator) query.set('operator', params.operator);
  if (params.machines && params.machines.length > 0) {
    query.set('machines', params.machines.join(','));
  } else if (params.machine) {
    query.set('machine', params.machine);
  }
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortDirection) query.set('sortDirection', params.sortDirection);
  return query.toString();
}

test('calculates pagination pages and offsets correctly', () => {
  // 100 items, 25 per page -> 4 pages
  const p1 = parsePagination(100, 25, 1);
  assert.equal(p1.totalPages, 4);
  assert.equal(p1.offset, 0);

  const p2 = parsePagination(100, 25, 2);
  assert.equal(p2.offset, 25);

  // 101 items, 25 per page -> 5 pages
  const p3 = parsePagination(101, 25, 5);
  assert.equal(p3.totalPages, 5);
  assert.equal(p3.offset, 100);

  // 0 items -> 1 page, offset 0
  const p0 = parsePagination(0, 25, 1);
  assert.equal(p0.totalPages, 1);
  assert.equal(p0.offset, 0);
});

test('builds record query string correctly with all filter options', () => {
  const qs = buildRecordQueryString({
    page: 2,
    limit: 25,
    startDate: '2026-01-01',
    endDate: '2026-03-30',
    boss: 'Cesar Ortega',
    operator: 'Operario 1',
    machines: ['WH1', 'WH2'],
    sortBy: 'recordedAt',
    sortDirection: 'desc',
  });

  const parsed = new URLSearchParams(qs);
  assert.equal(parsed.get('paginate'), 'true');
  assert.equal(parsed.get('page'), '2');
  assert.equal(parsed.get('limit'), '25');
  assert.equal(parsed.get('startDate'), '2026-01-01');
  assert.equal(parsed.get('endDate'), '2026-03-30');
  assert.equal(parsed.get('boss'), 'Cesar Ortega');
  assert.equal(parsed.get('operator'), 'Operario 1');
  assert.equal(parsed.get('machines'), 'WH1,WH2');
  assert.equal(parsed.get('sortBy'), 'recordedAt');
  assert.equal(parsed.get('sortDirection'), 'desc');
});

test('supports dynamic field sort key in query string', () => {
  const qs = buildRecordQueryString({
    sortBy: 'dynamic:velocidad',
    sortDirection: 'asc',
  });

  const parsed = new URLSearchParams(qs);
  assert.equal(parsed.get('sortBy'), 'dynamic:velocidad');
  assert.equal(parsed.get('sortDirection'), 'asc');
});
