const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coveragecapture-views-test-'));
process.env.COVERAGECAPTURE_DB_PATH = path.join(directory, 'coverage.db');

const database = require('../coverage-database');
const origin = 'http://localhost:3000';

const sprintView = database.saveCoverageView({
  siteOrigin: origin,
  name: 'Sprint Readiness',
  config: {
    dateRange: { mode: 'open-ended', start: '2026-09-01', end: '' },
    filters: { testSuite: 'CI', environment: 'QA', buildVersion: '' },
    coverageStatus: 'partial',
  },
});

assert.equal(sprintView.name, 'Sprint Readiness');
assert.equal(sprintView.config.filters.environment, 'QA');

database.saveCoverageView({
  siteOrigin: origin,
  name: 'Sprint Readiness',
  config: {
    dateRange: { mode: 'last-7-days', start: '', end: '' },
    filters: { testSuite: '', environment: 'Development', buildVersion: '' },
    coverageStatus: '',
  },
});

const views = database.listCoverageViews(origin);
assert.equal(views.length, 1);
assert.equal(views[0].config.dateRange.mode, 'last-7-days');
assert.equal(database.removeCoverageView(views[0].id, origin), true);
assert.equal(database.listCoverageViews(origin).length, 0);

console.log('Coverage views are saved, updated, and removed by origin.');
