const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const express = require('express');
const cors = require('cors');
const {
  DATABASE_PATH,
  createSession,
  completeCoverageSession,
  getCoverageSession,
  listCoverageSessions,
  removeCoverageSession,
  removeCoverageSessionsForOrigin,
  saveDeltaCoverage,
  getDeltaCoverage,
  getTestingCycles,
  saveTestResults,
  listFailedTests,
  saveCoverageView,
  listCoverageViews,
  removeCoverageView,
} = require('./coverage-database');
const { requireEnvironment } = require('./environment');

const app = express();
const port = 4000;
const travelTrustRoot = path.resolve(__dirname, '..', 'travel-trust-insurance');
let deltaCheckInProgress = false;

app.use(cors());
app.use(express.json({ limit: '25mb' }));

function isLocalOrigin(value) {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname); }
  catch { return false; }
}

function getDateRangeFromQuery(query) {
  const mode = String(query.dateRangeMode || query.mode || '').trim();
  const rollingDays = Number(query.rollingDays || query.days || 0);
  if (mode === 'last-7-days') return { mode: 'rolling', days: 7 };
  if (mode === 'last-30-days') return { mode: 'rolling', days: 30 };
  if (mode === 'rolling' || rollingDays > 0) return { mode: 'rolling', days: rollingDays };
  if (mode === 'open-ended') return { mode, start: query.start || query.startDate };
  if (mode === 'fixed') return { mode, start: query.start || query.startDate, end: query.end || query.endDate };
  return { start: query.start || query.startDate, end: query.end || query.endDate };
}

function runProjectScript(script, environment, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join('scripts', script)], {
      cwd: travelTrustRoot,
      env: {
        ...process.env,
        COVERAGE_PORT: '3101',
        COVERAGE_HISTORY_ORIGIN: environment.siteOrigin,
        COVERAGE_ENVIRONMENT: environment.name,
        COVERAGE_TEST_GREP: options.testFilter || '',
        COVERAGE_REQUIRE_GREP: options.requireFilter ? '1' : '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`${script} failed (exit ${code}). ${output.trim()}`)));
  });
}

app.post('/run-delta-check', async (req, res) => {
  const siteOrigin = String(req.body?.siteOrigin || '');
  let environment;
  try { environment = requireEnvironment(req.body?.environment); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (!isLocalOrigin(siteOrigin)) return res.status(400).json({ error: 'Run Delta Check is available only for localhost applications.' });
  if (deltaCheckInProgress) return res.status(409).json({ error: 'A delta check is already running.' });

  deltaCheckInProgress = true;
  try {
    await runProjectScript('coverage-playwright.cjs', { siteOrigin, name: environment });
    await runProjectScript('create-coverage-delta.cjs', { siteOrigin, name: environment });
    return res.json({ analysis: { ...getDeltaCoverage(siteOrigin, environment), testingCycles: getTestingCycles(siteOrigin, environment) } });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  } finally {
    deltaCheckInProgress = false;
  }
});

app.post('/run-automatic-coverage', async (req, res) => {
  const siteOrigin = String(req.body?.siteOrigin || '');
  const testName = String(req.body?.testName || '').trim();
  const testDescription = String(req.body?.testDescription || '').trim();
  const testFilter = testName || testDescription;
  let environment;
  try { environment = requireEnvironment(req.body?.environment); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (!isLocalOrigin(siteOrigin)) return res.status(400).json({ error: 'Automatic Coverage is available only for localhost applications.' });
  if (!testFilter) return res.status(400).json({ error: 'Enter a test scenario so automatic coverage can run only that action.' });
  if (deltaCheckInProgress) return res.status(409).json({ error: 'An automated coverage or delta check is already running.' });

  deltaCheckInProgress = true;
  try {
    const beforeIds = new Set(listCoverageSessions(siteOrigin, environment).map((session) => session.jobId));
    const output = await runProjectScript('coverage-playwright.cjs', { siteOrigin, name: environment }, { testFilter, requireFilter: true });
    const sessions = listCoverageSessions(siteOrigin, environment);
    const matchingSessions = sessions.filter((session) => !beforeIds.has(session.jobId));
    return res.json({ sessions, uploadedSessions: matchingSessions.length, failedTests: listFailedTests(siteOrigin, environment), testFilter, output });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  } finally {
    deltaCheckInProgress = false;
  }
});

app.post('/delta-analysis', (req, res) => {
  const { siteOrigin = '', environment, buildVersion = '', baselineRef = '', delta } = req.body || {};
  if (!siteOrigin || !delta || typeof delta !== 'object') return res.status(400).json({ error: 'siteOrigin, environment, and delta are required.' });
  let saved;
  try { saved = saveDeltaCoverage({ siteOrigin, environment, buildVersion, baselineRef, delta }); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  return res.status(201).json(saved);
});

app.post('/automated-sessions', (req, res) => {
  const { testName = '', testDescription = '', testSuite = 'CI', environment, buildVersion = '', siteOrigin = '', startedAt, stoppedAt, coverage = [], files = [], status = 'passed', error = '' } = req.body || {};
  if (!environment || !startedAt || !stoppedAt || !Array.isArray(files)) return res.status(400).json({ error: 'environment, timestamps, and files are required.' });
  try {
    const jobId = crypto.randomUUID();
    createSession({ jobId, testName, testDescription, testSuite, environment, buildVersion, siteOrigin, startedAt });
    const session = completeCoverageSession({ jobId, coverage, files, startTimestamp: startedAt, stopTimestamp: stoppedAt });
    if (testName) {
      saveTestResults({ siteOrigin, environment, testSuite, buildVersion, results: [{ testName, testSuite, status, error, startedAt, stoppedAt }] });
    }
    return res.status(201).json({ jobId: session.jobId, status: session.status });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/test-results', (req, res) => {
  const { siteOrigin = '', environment, testSuite = 'CI', buildVersion = '', results = [] } = req.body || {};
  if (!siteOrigin || !environment || !Array.isArray(results)) return res.status(400).json({ error: 'siteOrigin, environment, and results are required.' });
  try { return res.status(201).json(saveTestResults({ siteOrigin, environment, testSuite, buildVersion, results })); }
  catch (error) { return res.status(400).json({ error: error.message }); }
});

app.get('/delta-analysis', (req, res) => {
  const siteOrigin = String(req.query.origin || '');
  const environment = String(req.query.environment || '');
  if (!siteOrigin || !environment) return res.status(400).json({ error: 'origin and environment are required.' });
  let analysis;
  try { analysis = getDeltaCoverage(siteOrigin, environment, getDateRangeFromQuery(req.query)); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (!analysis) return res.status(404).json({ error: 'No delta analysis found.' });
  return res.json({ ...analysis, testingCycles: getTestingCycles(siteOrigin, environment) });
});

app.get('/failed-tests', (req, res) => {
  const siteOrigin = String(req.query.origin || '');
  const environment = String(req.query.environment || '');
  if (!siteOrigin || !environment) return res.status(400).json({ error: 'origin and environment are required.' });
  try { return res.json({ failedTests: listFailedTests(siteOrigin, environment, getDateRangeFromQuery(req.query)) }); }
  catch (error) { return res.status(400).json({ error: error.message }); }
});

app.get('/coverage-views', (req, res) => {
  const siteOrigin = String(req.query.origin || '');
  if (!siteOrigin) return res.status(400).json({ error: 'origin is required.' });
  try { return res.json({ views: listCoverageViews(siteOrigin) }); }
  catch (error) { return res.status(400).json({ error: error.message }); }
});

app.post('/coverage-views', (req, res) => {
  const { siteOrigin = '', name = '', config = {} } = req.body || {};
  try { return res.status(201).json(saveCoverageView({ siteOrigin, name, config })); }
  catch (error) { return res.status(400).json({ error: error.message }); }
});

app.delete('/coverage-views/:id', (req, res) => {
  const siteOrigin = String(req.query.origin || '');
  if (!siteOrigin) return res.status(400).json({ error: 'origin is required.' });
  try {
    if (!removeCoverageView(req.params.id, siteOrigin)) return res.status(404).json({ error: 'View not found' });
    return res.status(204).end();
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/manual-sessions', (req, res) => {
  const { testName = '', testDescription = '', testSuite = 'Manual', environment, buildVersion = '', siteOrigin = '' } = req.body || {};
  let normalizedEnvironment;
  try { normalizedEnvironment = requireEnvironment(environment); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const jobId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const job = createSession({ jobId, testName, testDescription, testSuite, environment: normalizedEnvironment, buildVersion, siteOrigin, startedAt });
  console.log(`Manual coverage recording started: jobId=${jobId}`);
  res.status(201).json({ jobId, status: job.status, startedAt });
});

app.post('/manual-sessions/:jobId/coverage', (req, res) => {
  const job = getCoverageSession(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'recording') return res.status(409).json({ error: `Job is already ${job.status}` });
  const { coverage, files, interactions = [], startTimestamp, stopTimestamp } = req.body || {};
  if (!Array.isArray(coverage) || !Array.isArray(files) || !startTimestamp || !stopTimestamp) return res.status(400).json({ error: 'coverage, files, startTimestamp, and stopTimestamp are required.' });
  const savedJob = completeCoverageSession({
    jobId: job.jobId,
    coverage,
    files,
    interactions,
    startTimestamp,
    stopTimestamp,
  });
  if (!savedJob) return res.status(409).json({ error: `Job is already ${job.status}` });
  console.log(`Manual coverage recording finished: jobId=${job.jobId}`);
  return res.json({ jobId: savedJob.jobId, status: savedJob.status, startedAt: savedJob.startedAt, stoppedAt: savedJob.stoppedAt });
});

app.get('/job-status/:jobId', (req, res) => {
  const job = getCoverageSession(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json(job);
});

app.get('/coverage-sessions', (req, res) => {
  const siteOrigin = String(req.query.origin || '');
  const environment = String(req.query.environment || '');
  if (!siteOrigin || !environment) return res.status(400).json({ error: 'origin and environment are required.' });
  try { return res.json({ sessions: listCoverageSessions(siteOrigin, environment, getDateRangeFromQuery(req.query)) }); }
  catch (error) { return res.status(400).json({ error: error.message }); }
});

app.delete('/coverage-sessions/:jobId', (req, res) => {
  const environment = String(req.query.environment || '');
  if (!environment) return res.status(400).json({ error: 'environment is required.' });
  try {
    if (!removeCoverageSession(req.params.jobId, environment)) return res.status(404).json({ error: 'Session not found' });
  } catch (error) { return res.status(400).json({ error: error.message }); }
  return res.status(204).end();
});

app.delete('/coverage-sessions', (req, res) => {
  const siteOrigin = String(req.query.origin || '');
  const environment = String(req.query.environment || '');
  if (!siteOrigin || !environment) return res.status(400).json({ error: 'origin and environment are required.' });
  let deleted;
  try { deleted = removeCoverageSessionsForOrigin(siteOrigin, environment); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  return res.json({ deleted });
});

app.listen(port, '127.0.0.1', () => console.log(`Coverage bridge server listening on port ${port} using SQLite database ${DATABASE_PATH}`));
