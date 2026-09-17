const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { once } = require('events');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.COVERAGE_PORT || 3100);
const baseUrl = process.env.COVERAGE_BASE_URL || `http://127.0.0.1:${port}`;
const artifacts = path.join(root, 'coverage-artifacts');
const testArtifacts = path.join(artifacts, 'playwright-tests');
const bridgeUrl = (process.env.COVERAGE_BRIDGE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const requestedTestFilter = String(process.env.COVERAGE_TEST_GREP || '').trim();
const requireTestFilter = process.env.COVERAGE_REQUIRE_GREP === '1';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function caseInsensitiveWord(value) {
  return escapeRegExp(value).replace(/[a-z]/gi, (char) => {
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    return lower === upper ? char : `[${lower}${upper}]`;
  });
}

function buildGrepPattern(filter) {
  const words = String(filter || '').trim().match(/[a-z0-9]+/gi) || [];
  if (!words.length) return '';
  return words.map(caseInsensitiveWord).join('[^a-zA-Z0-9]+');
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(baseUrl)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`TravelTrust did not start at ${baseUrl}`);
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode) return;
  server.kill('SIGTERM');
  await once(server, 'exit');
}

async function upload(record) {
  const response = await fetch(`${bridgeUrl}/automated-sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
  });
  if (!response.ok) throw new Error(`Bridge server returned ${response.status}: ${await response.text()}`);
}

async function uploadTestResults(report) {
  const results = report.records.map((record) => ({
    testName: record.testName,
    testSuite: record.testSuite || report.testSuite,
    buildVersion: record.buildVersion || report.buildVersion,
    status: record.status || 'passed',
    error: record.error || '',
    startedAt: record.startedAt,
    stoppedAt: record.stoppedAt,
  }));
  const response = await fetch(`${bridgeUrl}/test-results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siteOrigin: report.siteOrigin,
      environment: report.environment,
      testSuite: report.testSuite,
      buildVersion: report.buildVersion,
      results,
    }),
  });
  if (!response.ok) throw new Error(`Bridge server returned ${response.status}: ${await response.text()}`);
}

function aggregateFiles(records, layer) {
  const byUrl = new Map();
  for (const record of records) {
    for (const file of record.files.filter((entry) => entry.layer === layer)) {
      const existing = byUrl.get(file.url) || { ...file, functions: [] };
      const functions = new Map(existing.functions.map((fn) => [fn.name + ':' + fn.location, fn]));
      for (const fn of file.functions) {
        const key = fn.name + ':' + fn.location;
        functions.set(key, { ...fn, covered: Boolean(functions.get(key)?.covered || fn.covered) });
      }
      existing.functions = [...functions.values()];
      existing.totalFunctions = existing.functions.length;
      existing.coveredFunctions = existing.functions.filter((fn) => fn.covered).length;
      byUrl.set(file.url, existing);
    }
  }
  return [...byUrl.values()];
}

async function run() {
  if (requireTestFilter && !requestedTestFilter) {
    throw new Error('Automatic coverage requires a test scenario filter. Refusing to run the full suite.');
  }
  fs.rmSync(testArtifacts, { recursive: true, force: true });
  fs.mkdirSync(testArtifacts, { recursive: true });
  const server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port), COVERAGE_AGENT: '1', COVERAGE_BASE_URL: baseUrl, COVERAGE_TEST_ARTIFACTS: testArtifacts },
  });
  let stopped = false;
  try {
    await waitForServer();
    const testArgs = [require.resolve('@playwright/test/cli'), 'test', '--project=chromium', '--workers=1'];
    const grepPattern = buildGrepPattern(requestedTestFilter);
    if (grepPattern) testArgs.push('--grep', grepPattern);
    if (requestedTestFilter) console.log(`Running Playwright coverage only for action: "${requestedTestFilter}"`);
    const testProcess = spawn(process.execPath, testArgs, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, COVERAGE_BASE_URL: baseUrl, COVERAGE_TEST_ARTIFACTS: testArtifacts, COVERAGE_ENVIRONMENT: process.env.COVERAGE_ENVIRONMENT || 'Development' },
    });
    const [exitCode] = await once(testProcess, 'close');
    const records = fs.readdirSync(testArtifacts).filter((file) => file.endsWith('.json')).map((file) => JSON.parse(fs.readFileSync(path.join(testArtifacts, file), 'utf8')));
    const report = {
      testName: 'Playwright Chromium coverage', testSuite: 'CI', environment: process.env.COVERAGE_ENVIRONMENT || 'Development',
      buildVersion: process.env.BUILD_VERSION || 'local', siteOrigin: process.env.COVERAGE_HISTORY_ORIGIN || new URL(baseUrl).origin,
      records, files: aggregateFiles(records, 'frontend'),
      backendCoverage: records.flatMap((record) => record.coverage.backend || []),
    };
    fs.writeFileSync(path.join(artifacts, 'ci-coverage.json'), JSON.stringify(report, null, 2));
    if (requestedTestFilter && !records.length) throw new Error(`No Playwright tests matched "${requestedTestFilter}". Rename the scenario or add a matching test title.`);
    for (const record of records) await upload(record);
    await uploadTestResults(report);
    console.log(`Captured and uploaded ${records.length} Playwright test coverage sessions.`);
    if (exitCode !== 0) throw new Error(`Playwright coverage run failed with exit code ${exitCode}.`);
  } finally {
    if (!stopped) await stopServer(server);
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
