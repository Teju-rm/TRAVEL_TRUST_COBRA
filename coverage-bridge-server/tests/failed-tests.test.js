const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coveragecapture-failed-tests-test-'));
process.env.COVERAGECAPTURE_DB_PATH = path.join(directory, 'coverage.db');

const database = require('../coverage-database');
const origin = 'http://localhost:3000';

database.saveTestResults({
  siteOrigin: origin,
  environment: 'Development',
  testSuite: 'CI',
  buildVersion: '1.0.0',
  results: [
    { testName: 'quote flow', status: 'failed', error: 'Expected quote confirmation', startedAt: '2026-01-01T00:00:00.000Z', stoppedAt: '2026-01-01T00:00:03.000Z' },
    { testName: 'contact flow', status: 'passed', startedAt: '2026-01-01T00:00:04.000Z', stoppedAt: '2026-01-01T00:00:05.000Z' },
  ],
});

assert.deepEqual(database.listFailedTests(origin, 'Development').map((test) => test.testName), ['quote flow']);

database.saveTestResults({
  siteOrigin: origin,
  environment: 'Development',
  testSuite: 'CI',
  buildVersion: '1.0.1',
  results: [
    { testName: 'quote flow', status: 'passed', startedAt: '2026-01-02T00:00:00.000Z', stoppedAt: '2026-01-02T00:00:01.000Z' },
    { testName: 'claim flow', status: 'timedOut', startedAt: '2026-01-02T00:00:02.000Z', stoppedAt: '2026-01-02T00:00:32.000Z' },
  ],
});

const failures = database.listFailedTests(origin, 'Development');
assert.equal(failures.length, 1);
assert.equal(failures[0].testName, 'claim flow');
assert.equal(failures[0].status, 'timedOut');
assert.deepEqual(database.listFailedTests(origin, 'Development', { mode: 'fixed', start: '2026-01-01', end: '2026-01-01' }), []);
assert.deepEqual(database.listFailedTests(origin, 'Development', { mode: 'open-ended', start: '2026-01-02' }).map((test) => test.testName), ['claim flow']);

console.log('Current failed tests are tracked by latest unique test result.');
