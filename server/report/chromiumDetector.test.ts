import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chromiumCandidates, detectChromiumExecutable } from './chromiumDetector';

describe('chromiumDetector', () => {
  it('prioriza PUPPETEER_EXECUTABLE_PATH', () => {
    const found = detectChromiumExecutable({ PUPPETEER_EXECUTABLE_PATH: '/custom/chromium' }, (candidate) => candidate === '/custom/chromium');
    assert.equal(found, '/custom/chromium');
  });

  it('informa todas las rutas comprobadas cuando no encuentra ejecutable', () => {
    assert.throws(() => detectChromiumExecutable({}, () => false), /No se encontró Chromium/);
    assert.ok(chromiumCandidates({}).length > 0);
  });
});
