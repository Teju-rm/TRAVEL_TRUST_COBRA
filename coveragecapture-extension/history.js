const STORAGE_KEY = 'coverageHistory';
const COVERAGE_BAR_GOOD_PERCENT = 70;
const DEFAULT_QUALITY_GATE_THRESHOLDS = {
  overallCoveragePercent: 70,
  codeChangesCoveragePercent: 80,
  failedTests: 0,
  untestedCodeChanges: 0,
};
const BRIDGE_SERVER_URL = 'http://localhost:4000';

const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const dateRangeMode = document.getElementById('dateRangeMode');
const dateStartInput = document.getElementById('dateStartInput');
const dateEndInput = document.getElementById('dateEndInput');
const testSuiteFilter = document.getElementById('testSuiteFilter');
const environmentFilter = document.getElementById('environmentFilter');
const layerFilter = document.getElementById('layerFilter');
const buildVersionFilter = document.getElementById('buildVersionFilter');
const coverageStatusFilter = document.getElementById('coverageStatusFilter');
const viewSelect = document.getElementById('viewSelect');
const saveViewBtn = document.getElementById('saveViewBtn');
const deleteViewBtn = document.getElementById('deleteViewBtn');
const overallGateInput = document.getElementById('overallGateInput');
const changesGateInput = document.getElementById('changesGateInput');
const untestedGateInput = document.getElementById('untestedGateInput');
const failedGateInput = document.getElementById('failedGateInput');
const exportBtn = document.getElementById('exportBtn');
const resetFiltersBtn = document.getElementById('resetFiltersBtn');
const clearBtn = document.getElementById('clearBtn');
const backBtn = document.getElementById('backBtn');
const summaryText = document.getElementById('summaryText');
const historyBody = document.getElementById('historyBody');
const emptyState = document.getElementById('emptyState');
const dashboardCards = document.getElementById('dashboardCards');
const dashboardScopeNote = document.getElementById('dashboardScopeNote');
const scopeStrip = document.getElementById('scopeStrip');
const buildSummaryBody = document.getElementById('buildSummaryBody');
const buildSummaryEmpty = document.getElementById('buildSummaryEmpty');
const overallFiles = document.getElementById('overallFiles');
const viewOverallBtn = document.getElementById('viewOverallBtn');
const deltaResults = document.getElementById('deltaResults');
const deltaIntro = document.getElementById('deltaIntro');
const automaticDeltaBtn = document.getElementById('automaticDeltaBtn');
const manualDeltaBtn = document.getElementById('manualDeltaBtn');
const baselineBuildSelect = document.getElementById('baselineBuildSelect');
const comparisonBuildSelect = document.getElementById('comparisonBuildSelect');
const refreshDeltaBtn = document.getElementById('refreshDeltaBtn');
const viewHistoryBtn = document.getElementById('viewHistoryBtn');
const deltaReportMeta = document.getElementById('deltaReportMeta');
const deltaRefreshStatus = document.getElementById('deltaRefreshStatus');
const primaryNavButtons = [...document.querySelectorAll('[data-primary-view]')];
const dashboardPanel = document.getElementById('dashboardPanel');
const testGapsPanel = document.getElementById('testGapsPanel');
const qualityAnalyticsPanel = document.getElementById('qualityAnalyticsPanel');
const testOptimizationPanel = document.getElementById('testOptimizationPanel');
const actionHistoryPanel = document.getElementById('actionHistoryPanel');
const testGapsContent = document.getElementById('testGapsContent');
const qualityAnalyticsContent = document.getElementById('qualityAnalyticsContent');
const testOptimizationContent = document.getElementById('testOptimizationContent');

let coverageHistory = [];
let bridgeHistoryLoaded = false;
let uploadedDelta = null;
let currentFailedTests = [];
let selectedSort = 'date-desc';
let selectedBaselineBuild = '';
let selectedComparisonBuild = '';
let deltaViewMode = 'automatic';
let selectedDateRange = { mode: '', start: '', end: '' };
let qualityGateThresholds = { ...DEFAULT_QUALITY_GATE_THRESHOLDS };
let savedViews = [];
let selectedViewId = '';
let selectedLayer = '';
let activePrimaryView = 'dashboard';
const historyParameters = new URLSearchParams(window.location.search);
const historySiteOrigin = historyParameters.get('origin');
const historyJobId = historyParameters.get('jobId');
const historySuite = historyParameters.get('suite');
const historyAction = historyParameters.get('action') || '';
let defaultTestSuiteFilter = historySuite || '';
// Older History links did not include an environment. Default local usage to
// Development so the report remains isolated instead of falling back to an
// empty, unscoped view.
const historyEnvironment = normalizeEnvironment(historyParameters.get('environment') || 'development');
let selectedFilters = { testSuite: defaultTestSuiteFilter, environment: historyEnvironment || '', buildVersion: '' };
let selectedCoverageStatus = '';
const deltaOnlyView = historyParameters.get('view') === 'delta';
let focusCoverageDelta = deltaOnlyView;

if (historyAction) searchInput.value = historyAction;

if (deltaOnlyView) {
  document.body.classList.add('delta-only');
}

function normalizeEnvironment(value) {
  const aliases = { dev: 'Development', development: 'Development', qa: 'QA', test: 'QA', uat: 'UAT', staging: 'UAT', prod: 'Production', production: 'Production' };
  const environment = String(value || '').trim();
  return aliases[environment.toLowerCase()] || environment;
}

function getSiteHistory() {
  // The bridge request is already scoped to the selected origin/environment.
  // Keep its results intact: UI labels use "Development" while the bridge
  // stores the canonical value "development".
  const scoped = historyJobId ? coverageHistory.filter((record) => record.jobId === historyJobId) : coverageHistory;
  if (bridgeHistoryLoaded) return scoped;
  return historySiteOrigin && historyEnvironment
    ? scoped.filter((record) => record.siteOrigin === historySiteOrigin && normalizeEnvironment(getRecordMetadata(record).environment) === historyEnvironment)
    : [];
}

function getRecordMetadata(record) {
  return {
    testSuite: record.testSuite || 'Manual',
    environment: record.environment || 'Unspecified',
    buildVersion: record.buildVersion || 'Not provided',
  };
}

function populateFilterOptions(records) {
  const filters = [
    { element: testSuiteFilter, key: 'testSuite', allLabel: 'All test suites' },
    { element: environmentFilter, key: 'environment', allLabel: 'All environments' },
    { element: buildVersionFilter, key: 'buildVersion', allLabel: 'All builds' },
  ];

  filters.forEach(({ element, key, allLabel }) => {
    const values = [...new Set(records.map((record) => getRecordMetadata(record)[key]))].sort((first, second) => first.localeCompare(second));
    const selected = selectedFilters[key];
    element.replaceChildren(new Option(allLabel, ''));
    values.forEach((value) => element.add(new Option(value, value)));
    selectedFilters[key] = values.includes(selected) ? selected : '';
    element.value = selectedFilters[key];
  });
}

function applyDefaultSuiteFromLatest(records) {
  if (historySuite || selectedFilters.testSuite || !records.length) return;
  const latestSuite = getRecordMetadata(sortNewestFirst(records)[0]).testSuite;
  defaultTestSuiteFilter = latestSuite || '';
  selectedFilters.testSuite = latestSuite || '';
}

function recordMatchesSearch(record, query) {
  if (!query) return true;
  return `${record.testName || ''} ${record.testDescription || ''}`.toLowerCase().includes(query);
}

function getFilteredHistory(records = getSiteHistory()) {
  const query = searchInput.value.trim().toLowerCase();
  return records.filter((record) => {
    const metadata = getRecordMetadata(record);
    return isRecordInSelectedDateRange(record)
      && recordMatchesSearch(record, query)
      && (!selectedFilters.testSuite || metadata.testSuite === selectedFilters.testSuite)
      && (!selectedFilters.environment || metadata.environment === selectedFilters.environment)
      && (!selectedFilters.buildVersion || metadata.buildVersion === selectedFilters.buildVersion)
      && (!selectedCoverageStatus || getActionCoverageStatus(record) === selectedCoverageStatus);
  });
}

function getDeltaScopeHistory(records = getSiteHistory()) {
  const query = searchInput.value.trim().toLowerCase();
  return records.filter((record) => {
    const metadata = getRecordMetadata(record);
    return isRecordInSelectedDateRange(record)
      && recordMatchesSearch(record, query)
      && (!selectedFilters.testSuite || metadata.testSuite === selectedFilters.testSuite)
      && (!selectedFilters.environment || metadata.environment === selectedFilters.environment);
  });
}

function inferSiteOrigin(record) {
  for (const file of record.files || []) {
    try {
      const origin = new URL(file.url).origin;
      if (origin !== 'null') return origin;
    } catch {
      // Ignore non-URL and browser-internal script entries.
    }
  }
  return '';
}

const formatDate = (value) => Number.isNaN(new Date(value).getTime()) ? value || 'Unknown' : new Date(value).toLocaleString();
const formatDuration = (durationMs) => `${(Number(durationMs || 0) / 1000).toFixed(2)}s`;
const percentNumber = (covered, total) => total ? Math.round((covered / total) * 1000) / 10 : 0;
const getCoveragePercent = (covered, total) => `${percentNumber(covered, total)}%`;
const getLineNumber = (location) => String(location).split(':')[0];
const getRecordTimestamp = (record) => Date.parse(record.capturedAt || record.stoppedAt || record.startedAt) || 0;
const sortNewestFirst = (records) => [...records].sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());

function localDateBoundary(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  const timestamp = date.getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getDateRangeBounds() {
  const now = Date.now();
  if (selectedDateRange.mode === 'last-7-days') return { start: now - (7 * 24 * 60 * 60 * 1000), end: now };
  if (selectedDateRange.mode === 'last-30-days') return { start: now - (30 * 24 * 60 * 60 * 1000), end: now };
  if (selectedDateRange.mode === 'open-ended') return { start: localDateBoundary(selectedDateRange.start), end: null };
  if (selectedDateRange.mode === 'fixed') return { start: localDateBoundary(selectedDateRange.start), end: localDateBoundary(selectedDateRange.end, true) };
  return { start: null, end: null };
}

function isRecordInSelectedDateRange(record) {
  const { start, end } = getDateRangeBounds();
  if (!start && !end) return true;
  const timestamp = getRecordTimestamp(record);
  return timestamp && (!start || timestamp >= start) && (!end || timestamp <= end);
}

function describeDateRange() {
  if (selectedDateRange.mode === 'last-7-days') return 'last 7 days';
  if (selectedDateRange.mode === 'last-30-days') return 'last 30 days';
  if (selectedDateRange.mode === 'open-ended' && selectedDateRange.start) return `since ${selectedDateRange.start}`;
  if (selectedDateRange.mode === 'fixed' && selectedDateRange.start && selectedDateRange.end) return `${selectedDateRange.start} through ${selectedDateRange.end}`;
  return 'all dates';
}

function normalizeQualityGateThresholds(value = {}) {
  const percent = (candidate, fallback) => {
    const number = Number(candidate);
    return Number.isFinite(number) ? Math.min(Math.max(Math.round(number), 0), 100) : fallback;
  };
  const count = (candidate, fallback) => {
    const number = Number(candidate);
    return Number.isFinite(number) ? Math.max(Math.round(number), 0) : fallback;
  };
  return {
    overallCoveragePercent: percent(value.overallCoveragePercent, DEFAULT_QUALITY_GATE_THRESHOLDS.overallCoveragePercent),
    codeChangesCoveragePercent: percent(value.codeChangesCoveragePercent, DEFAULT_QUALITY_GATE_THRESHOLDS.codeChangesCoveragePercent),
    failedTests: count(value.failedTests, DEFAULT_QUALITY_GATE_THRESHOLDS.failedTests),
    untestedCodeChanges: count(value.untestedCodeChanges, DEFAULT_QUALITY_GATE_THRESHOLDS.untestedCodeChanges),
  };
}

function renderQualityGateInputs() {
  overallGateInput.value = String(qualityGateThresholds.overallCoveragePercent);
  changesGateInput.value = String(qualityGateThresholds.codeChangesCoveragePercent);
  untestedGateInput.value = String(qualityGateThresholds.untestedCodeChanges);
  failedGateInput.value = String(qualityGateThresholds.failedTests);
}

function getGateRulesText(thresholds = qualityGateThresholds) {
  return `overall >= ${thresholds.overallCoveragePercent}%, changed code >= ${thresholds.codeChangesCoveragePercent}%, untested changes <= ${thresholds.untestedCodeChanges}, failed tests <= ${thresholds.failedTests}`;
}

function getBridgeDateRangeParams() {
  const params = new URLSearchParams();
  if (!selectedDateRange.mode && !selectedDateRange.start && !selectedDateRange.end) return params;
  params.set('dateRangeMode', selectedDateRange.mode || '');
  if (selectedDateRange.start) params.set('startDate', selectedDateRange.start);
  if (selectedDateRange.end) params.set('endDate', selectedDateRange.end);
  return params;
}

function buildBridgeUrl(pathName, params = {}) {
  const query = new URLSearchParams(params);
  getBridgeDateRangeParams().forEach((value, key) => query.set(key, value));
  return `${BRIDGE_SERVER_URL}${pathName}?${query.toString()}`;
}

function getCurrentViewConfig() {
  return {
    dateRange: { ...selectedDateRange },
    filters: { ...selectedFilters },
    layer: selectedLayer,
    coverageStatus: selectedCoverageStatus,
    sort: selectedSort,
    deltaViewMode,
    qualityGateThresholds: { ...qualityGateThresholds },
  };
}

function applyViewConfig(config = {}) {
  selectedDateRange = { mode: '', start: '', end: '', ...(config.dateRange || {}) };
  selectedFilters = { testSuite: defaultTestSuiteFilter, environment: historyEnvironment || '', buildVersion: '', ...(config.filters || {}) };
  selectedLayer = config.layer || '';
  selectedCoverageStatus = config.coverageStatus || '';
  selectedSort = config.sort || 'date-desc';
  deltaViewMode = config.deltaViewMode || 'automatic';
  qualityGateThresholds = normalizeQualityGateThresholds(config.qualityGateThresholds || DEFAULT_QUALITY_GATE_THRESHOLDS);

  dateRangeMode.value = selectedDateRange.mode || '';
  dateStartInput.value = selectedDateRange.start || '';
  dateEndInput.value = selectedDateRange.end || '';
  layerFilter.value = selectedLayer;
  sortSelect.value = selectedSort;
  coverageStatusFilter.value = selectedCoverageStatus;
  renderQualityGateInputs();
}

function populateViewOptions() {
  viewSelect.replaceChildren(new Option('Unsaved working view', ''));
  savedViews.forEach((view) => viewSelect.add(new Option(view.name, String(view.id))));
  viewSelect.value = savedViews.some((view) => String(view.id) === String(selectedViewId)) ? String(selectedViewId) : '';
  deleteViewBtn.disabled = !viewSelect.value;
}

async function loadCoverageViews() {
  if (!historySiteOrigin) return;
  try {
    const response = await fetch(`${BRIDGE_SERVER_URL}/coverage-views?origin=${encodeURIComponent(historySiteOrigin)}`);
    savedViews = response.ok ? (await response.json()).views || [] : [];
  } catch {
    savedViews = [];
  }
  populateViewOptions();
}

function getRecordCoverage(record) {
  const files = getScopedFiles(record);
  const total = files.reduce((sum, file) => sum + Number(file.totalFunctions || (file.functions || []).length), 0);
  const covered = files.reduce((sum, file) => sum + Number(file.coveredFunctions || 0), 0);
  return { covered, total, percent: percentNumber(covered, total) };
}

function getActionCoverageStatus(record) {
  const { covered, total } = getRecordCoverage(record);
  if (!covered) return 'uncovered';
  if (covered >= total) return 'covered';
  return 'partial';
}

function getDeltaInventoryTotal() {
  const total = Number(uploadedDelta?.delta?.inventory?.currentFunctions);
  return Number.isFinite(total) && total > 0 ? total : null;
}

function getChangeCoverageSummary(records = getFilteredHistory()) {
  const delta = uploadedDelta?.delta || null;
  if (delta) {
    const changed = [...(delta.functionsAdded || []), ...(delta.functionsModified || [])];
    const changedKeys = new Set(changed.map((fn) => fn.logicalId || fn.id).filter(Boolean));
    const executedKeys = new Set((delta.newFunctionsExecuted || []).map((fn) => fn.logicalId || fn.id).filter(Boolean));
    const covered = changedKeys.size ? [...changedKeys].filter((key) => executedKeys.has(key)).length : executedKeys.size;
    const total = changedKeys.size || covered;
    return { covered, total, untested: Math.max(total - covered, 0), percent: percentNumber(covered, total) };
  }

  if (selectedBaselineBuild && selectedComparisonBuild && selectedBaselineBuild !== selectedComparisonBuild) {
    const deltaFromRecords = getCoverageDelta(records);
    return {
      covered: deltaFromRecords.addedCovered.length,
      total: deltaFromRecords.added.length,
      untested: deltaFromRecords.addedUntested.length,
      percent: percentNumber(deltaFromRecords.addedCovered.length, deltaFromRecords.added.length),
    };
  }

  return { covered: 0, total: 0, untested: 0, percent: 0 };
}

function isActionFocusedScope(records = getFilteredHistory(), actionRecord = null) {
  if (actionRecord || historyJobId) return true;
  if (selectedFilters.testSuite === 'Manual') return true;
  return records.length > 0 && records.every((record) => getRecordMetadata(record).testSuite === 'Manual');
}

function getQualityGateEvaluation({ overallPercent, changeSummary, failedTests, enforceOverallCoverage = true, actionCovered = 0 }) {
  const thresholds = qualityGateThresholds;
  const hasData = Boolean(overallPercent || actionCovered || changeSummary.total || failedTests.length);
  const checks = [
    {
      label: enforceOverallCoverage ? 'Overall coverage' : 'Action coverage',
      actual: enforceOverallCoverage ? `${overallPercent || 0}%` : `${actionCovered} methods`,
      target: enforceOverallCoverage ? `>= ${thresholds.overallCoveragePercent}%` : 'captured',
      passed: enforceOverallCoverage ? Number(overallPercent || 0) >= thresholds.overallCoveragePercent : Number(actionCovered || 0) > 0,
      active: hasData,
    },
    {
      label: 'Code changes coverage',
      actual: changeSummary.total ? `${changeSummary.percent}%` : 'No changes',
      target: `>= ${thresholds.codeChangesCoveragePercent}%`,
      passed: !changeSummary.total || changeSummary.percent >= thresholds.codeChangesCoveragePercent,
      active: hasData,
    },
    {
      label: 'Untested code changes',
      actual: changeSummary.total ? String(changeSummary.untested) : 'No changes',
      target: `<= ${thresholds.untestedCodeChanges}`,
      passed: changeSummary.untested <= thresholds.untestedCodeChanges,
      active: hasData,
    },
    {
      label: 'Failed tests',
      actual: String(failedTests.length),
      target: `<= ${thresholds.failedTests}`,
      passed: failedTests.length <= thresholds.failedTests,
      active: hasData,
    },
  ];
  const failedChecks = checks.filter((check) => check.active && !check.passed);
  return {
    status: hasData ? (failedChecks.length ? 'Failed' : 'Passed') : 'Missing Data',
    checks,
    failedChecks,
  };
}

function getQualityGateStatus(input) {
  return getQualityGateEvaluation(input).status;
}

function getQualityGateClass(status) {
  if (status === 'Passed') return 'passed';
  if (status === 'Failed') return 'failed';
  return 'missing';
}

function getLatestBuild(records) {
  return sortHistoryRecords(records)[0]?.buildVersion || uploadedDelta?.buildVersion || 'local';
}

function getReferenceBuild() {
  return uploadedDelta?.baselineRef || selectedBaselineBuild || 'Previous build';
}

function getTestTimestamp(test) {
  return Date.parse(test?.stoppedAt || test?.startedAt || test?.updatedAt) || 0;
}

function isTestInSelectedDateRange(test) {
  const { start, end } = getDateRangeBounds();
  if (!start && !end) return true;
  const timestamp = getTestTimestamp(test);
  return timestamp && (!start || timestamp >= start) && (!end || timestamp <= end);
}

function getVisibleFailedTests() {
  return currentFailedTests.filter((test) => isTestInSelectedDateRange(test) && (!selectedFilters.testSuite || test.testSuite === selectedFilters.testSuite));
}

function fileMatchesLayer(file) {
  return !selectedLayer || String(file?.layer || 'frontend') === selectedLayer;
}

function getScopedFiles(record) {
  return (record.files || []).filter(fileMatchesLayer);
}

function getStageLabel(value) {
  return String(value || 'Manual');
}

function getScopeSummary() {
  return [
    ['Lab', selectedFilters.environment || historyEnvironment || 'All environments'],
    ['Layer', selectedLayer ? selectedLayer[0].toUpperCase() + selectedLayer.slice(1) : 'All layers'],
    ['Stage', selectedFilters.testSuite || 'All test stages'],
    ['Date', describeDateRange()],
  ];
}

function renderScopeStrip() {
  scopeStrip.replaceChildren();
  getScopeSummary().forEach(([label, value]) => {
    const pill = document.createElement('span');
    pill.className = 'scope-pill';
    pill.textContent = `${label}: ${value}`;
    scopeStrip.appendChild(pill);
  });
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function createAnalysisCard(title, value, note) {
  const card = document.createElement('section');
  card.className = 'analysis-card';
  card.append(
    createTextElement('h3', 'analysis-card-title', title),
    createTextElement('div', 'analysis-card-value', value),
    createTextElement('div', 'analysis-card-note', note)
  );
  return card;
}

function createAnalysisRow(title, metric, note) {
  const row = document.createElement('div');
  row.className = 'analysis-row';
  const titleRow = document.createElement('div');
  titleRow.className = 'analysis-row-title';
  titleRow.append(createTextElement('span', '', title), createTextElement('span', '', metric));
  row.append(titleRow, createTextElement('div', 'analysis-row-meta', note));
  return row;
}

function renderAnalysisSummary(container, cards) {
  const grid = document.createElement('div');
  grid.className = 'analysis-grid';
  cards.forEach((card) => grid.appendChild(createAnalysisCard(...card)));
  container.appendChild(grid);
}

function getAnalysisCoverage(records = getFilteredHistory()) {
  const files = buildCoverage(uniqueActionRecords(records));
  const total = files.reduce((sum, file) => sum + file.total, 0);
  const covered = files.reduce((sum, file) => sum + file.covered, 0);
  const untested = Math.max(total - covered, 0);
  return { files, total, covered, untested, percent: percentNumber(covered, total) };
}

function renderTestGapsPanel(records = getFilteredHistory()) {
  testGapsContent.replaceChildren();
  const coverage = getAnalysisCoverage(records);
  renderAnalysisSummary(testGapsContent, [
    ['Untested Methods', String(coverage.untested), `${coverage.covered} executed / ${coverage.total || 0} total methods`],
    ['Files With Gaps', String(coverage.files.filter((file) => file.total > file.covered).length), `${coverage.percent}% coverage in current scope`],
    ['Changed Gaps', String(getChangeCoverageSummary(records).untested || 0), 'Untested changed methods from the active delta'],
  ]);

  const list = document.createElement('div');
  list.className = 'analysis-list';
  const filesWithGaps = coverage.files
    .map((file) => ({ ...file, untested: Math.max(file.total - file.covered, 0) }))
    .filter((file) => file.untested > 0)
    .sort((a, b) => b.untested - a.untested || a.url.localeCompare(b.url));

  if (!filesWithGaps.length) {
    list.appendChild(createAnalysisRow('No test gaps found', 'Complete', 'Every observed method in this scope has been executed.'));
  } else {
    filesWithGaps.forEach((file) => {
      const row = createAnalysisRow(formatFileUrl(file.url), `${file.untested} untested`, `${file.covered} executed / ${file.total} total methods`);
      row.appendChild(createFunctionList(file.functions, true));
      list.appendChild(row);
    });
  }
  testGapsContent.appendChild(list);
}

function renderQualityAnalyticsPanel(records = getFilteredHistory()) {
  qualityAnalyticsContent.replaceChildren();
  const coverage = getAnalysisCoverage(records);
  const changeSummary = getChangeCoverageSummary(records);
  const failedTests = getVisibleFailedTests();
  const actionFocused = isActionFocusedScope(records);
  const gateEvaluation = getQualityGateEvaluation({
    overallPercent: coverage.percent,
    changeSummary,
    failedTests,
    enforceOverallCoverage: !actionFocused,
    actionCovered: actionFocused ? coverage.covered : 0,
  });
  renderAnalysisSummary(qualityAnalyticsContent, [
    ['Quality Gate', gateEvaluation.status, getGateRulesText()],
    ['Current Coverage', coverage.total ? `${coverage.percent}%` : '-', `${coverage.covered} executed / ${coverage.total || 0} total methods`],
    ['Failed Tests', String(failedTests.length), failedTests.length ? failedTests.slice(0, 2).map((test) => test.testName || 'Untitled test').join(', ') : 'No failed tests in selected scope'],
  ]);

  const list = document.createElement('div');
  list.className = 'analysis-list';
  gateEvaluation.checks.forEach((check) => {
    list.appendChild(createAnalysisRow(check.label, check.active && !check.passed ? 'Needs attention' : 'Passing', `${check.actual} / target ${check.target}`));
  });
  getStageCoverageSummaries(records).forEach((stage) => {
    list.appendChild(createAnalysisRow(`Stage: ${stage.stage}`, `${stage.percent}%`, `${stage.records.length} scenario${stage.records.length === 1 ? '' : 's'} | ${stage.covered} / ${stage.total} methods executed`));
  });
  qualityAnalyticsContent.appendChild(list);
}

function renderTestOptimizationPanel(records = getFilteredHistory()) {
  testOptimizationContent.replaceChildren();
  const sorted = sortHistoryRecords(records);
  const candidates = sorted.map((record) => {
    const coverage = getRecordCoverage(record);
    const missing = Math.max(coverage.total - coverage.covered, 0);
    return { record, coverage, missing };
  }).sort((a, b) => b.missing - a.missing || Number(b.record.durationMs || 0) - Number(a.record.durationMs || 0));
  const lowestCoverage = candidates.reduce((lowest, candidate) => (
    !lowest || candidate.coverage.percent < lowest.coverage.percent ? candidate : lowest
  ), null);

  renderAnalysisSummary(testOptimizationContent, [
    ['Recorded Scenarios', String(sorted.length), 'Actions available for optimization in this scope'],
    ['Lowest Coverage', lowestCoverage ? `${lowestCoverage.coverage.percent}%` : '-', 'Lowest scenario coverage in the selected result set'],
    ['Highest Gap', candidates.length ? String(candidates[0].missing) : '-', 'Largest unexecuted-method opportunity'],
  ]);

  const list = document.createElement('div');
  list.className = 'analysis-list';
  if (!candidates.length) {
    list.appendChild(createAnalysisRow('No scenarios to optimize', '-', 'Record or import coverage sessions to generate recommendations.'));
  } else {
    candidates.slice(0, 8).forEach(({ record, coverage, missing }) => {
      const duration = formatDuration(record.durationMs);
      const recommendation = missing
        ? 'Add assertions or user steps that execute the remaining methods in this flow.'
        : 'Covered well; keep this scenario as a smoke/regression candidate.';
      list.appendChild(createAnalysisRow(record.testName || 'Untitled test', `${coverage.percent}%`, `${missing} unexecuted methods | ${duration} | ${recommendation}`));
    });
  }
  testOptimizationContent.appendChild(list);
}

function renderPrimaryViewPanels(records = getFilteredHistory()) {
  renderTestGapsPanel(records);
  renderQualityAnalyticsPanel(records);
  renderTestOptimizationPanel(records);
}

function setPrimaryView(view) {
  activePrimaryView = view || 'dashboard';
  const labels = {
    dashboard: ['Coverage Dashboard', 'Application Coverage Analysis'],
    gaps: ['Coverage Dashboard / Test Gaps', 'Test Gaps'],
    quality: ['Coverage Dashboard / Quality Analytics', 'Quality Analytics'],
    optimization: ['Coverage Dashboard / Test Optimization', 'Test Optimization'],
  };
  primaryNavButtons.forEach((button) => {
    const active = button.dataset.primaryView === activePrimaryView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  dashboardPanel.hidden = activePrimaryView !== 'dashboard';
  testGapsPanel.hidden = activePrimaryView !== 'gaps';
  qualityAnalyticsPanel.hidden = activePrimaryView !== 'quality';
  testOptimizationPanel.hidden = activePrimaryView !== 'optimization';
  actionHistoryPanel.hidden = activePrimaryView !== 'dashboard';
  document.querySelector('.breadcrumb').textContent = labels[activePrimaryView]?.[0] || labels.dashboard[0];
  document.querySelector('.report-title').textContent = labels[activePrimaryView]?.[1] || labels.dashboard[1];
}

function appendCoverageCell(row, covered, total) {
  const cell = document.createElement('td');
  cell.className = 'coverage-cell';
  const percent = percentNumber(covered, total);
  cell.append(
    createTextElement('span', 'metric-strong', total ? `${percent}%` : '-'),
    document.createTextNode(total ? ` (${covered} / ${total})` : ' No data'),
    createBar(covered, total)
  );
  row.appendChild(cell);
}

function getStageCoverageSummaries(records) {
  const byStage = new Map();
  records.forEach((record) => {
    const stage = getStageLabel(record.testSuite);
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage).push(record);
  });
  return [...byStage.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([stage, stageRecords]) => {
    const files = buildCoverage(stageRecords);
    const total = files.reduce((sum, file) => sum + file.total, 0);
    const covered = files.reduce((sum, file) => sum + file.covered, 0);
    return { stage, records: stageRecords, files, total, covered, percent: percentNumber(covered, total) };
  });
}

function renderBuildGatePanel(gateEvaluation, failedTests) {
  const panel = document.createElement('div');
  panel.className = 'build-gate-panel';
  panel.appendChild(createTextElement('h3', 'stage-files-title', 'Quality gate checks'));
  const rules = document.createElement('div');
  rules.className = 'gate-rule-list';
  gateEvaluation.checks.forEach((check) => {
    const item = document.createElement('div');
    item.className = `gate-check ${check.active && !check.passed ? 'failed' : 'passed'}`;
    item.append(
      createTextElement('span', 'gate-check-name', check.label),
      createTextElement('span', 'gate-check-result', `${check.actual} / ${check.target}`)
    );
    rules.appendChild(item);
  });
  panel.appendChild(rules);
  if (failedTests.length) {
    const failedList = document.createElement('div');
    failedList.className = 'failed-test-list';
    failedList.appendChild(createTextElement('h3', 'stage-files-title', 'Failed tests'));
    failedTests.slice(0, 5).forEach((test) => {
      failedList.appendChild(createTextElement('div', 'failed-test-item', `${test.testSuite || 'CI'} / ${test.testName || 'Untitled test'}`));
    });
    if (failedTests.length > 5) failedList.appendChild(createTextElement('div', 'failed-test-item', `+${failedTests.length - 5} more`));
    panel.appendChild(failedList);
  }
  return panel;
}

function renderBuildDetail(buildVersion, buildRecords, detailId, gateEvaluation, failedTests) {
  const row = document.createElement('tr');
  row.className = 'build-detail-row';
  row.id = detailId;
  row.hidden = true;
  const cell = document.createElement('td');
  cell.className = 'build-detail-cell';
  cell.colSpan = 9;
  const panel = document.createElement('div');
  panel.className = 'build-detail-panel';
  const stageList = document.createElement('div');
  stageList.className = 'stage-list';
  stageList.appendChild(createTextElement('h3', 'stage-files-title', 'Test stages'));
  const stages = getStageCoverageSummaries(buildRecords);
  if (!stages.length) {
    stageList.appendChild(createTextElement('div', 'stage-card-note', 'No test stages reported for this build.'));
  } else {
    stages.forEach((stage) => {
      const card = document.createElement('section');
      card.className = 'stage-card';
      card.append(
        createTextElement('div', 'stage-card-title', stage.stage),
        createTextElement('div', 'stage-card-note', `${stage.records.length} scenario${stage.records.length === 1 ? '' : 's'} | ${stage.percent}% method coverage`),
        createBar(stage.covered, stage.total)
      );
      stageList.appendChild(card);
    });
  }

  const filesPanel = document.createElement('div');
  filesPanel.className = 'stage-files';
  filesPanel.appendChild(createTextElement('h3', 'stage-files-title', `${buildVersion || 'Build'} method coverage by file`));
  const fileList = document.createElement('div');
  renderFilePanel(fileList, buildCoverage(uniqueActionRecords(buildRecords)));
  filesPanel.appendChild(fileList);
  panel.append(stageList, filesPanel, renderBuildGatePanel(gateEvaluation, failedTests));
  cell.appendChild(panel);
  row.appendChild(cell);
  return row;
}

function renderBuildSummary(records = getFilteredHistory()) {
  buildSummaryBody.replaceChildren();
  const actionFocused = isActionFocusedScope(records);
  const grouped = new Map();
  records.forEach((record) => {
    const build = getRecordMetadata(record).buildVersion;
    if (!grouped.has(build)) grouped.set(build, []);
    grouped.get(build).push(record);
  });

  const entries = [...grouped.entries()].sort(([, firstRecords], [, secondRecords]) => getRecordTimestamp(sortHistoryRecords(secondRecords)[0]) - getRecordTimestamp(sortHistoryRecords(firstRecords)[0]));
  buildSummaryEmpty.style.display = entries.length ? 'none' : 'block';

  entries.forEach(([buildVersion, buildRecords], index) => {
    const detailId = `build-detail-${index}`;
    const row = document.createElement('tr');
    row.className = 'build-row';
    const files = buildCoverage(uniqueActionRecords(buildRecords));
    const observedTotal = files.reduce((sum, file) => sum + file.total, 0);
    const inventoryTotal = index === 0 ? getDeltaInventoryTotal() : null;
    const total = inventoryTotal || observedTotal;
    const covered = Math.min(files.reduce((sum, file) => sum + file.covered, 0), total);
    const overallPercent = percentNumber(covered, total);
    const failedTests = getVisibleFailedTests().filter((test) => !test.buildVersion || test.buildVersion === buildVersion);
    const changeSummary = index === 0 ? getChangeCoverageSummary(records) : { covered: 0, total: 0, untested: 0, percent: 0 };
    const gateEvaluation = getQualityGateEvaluation({
      overallPercent,
      changeSummary,
      failedTests,
      enforceOverallCoverage: !actionFocused,
      actionCovered: covered,
    });
    const gateStatus = gateEvaluation.status;
    const appCell = document.createElement('td');
    const appWrap = document.createElement('div');
    appWrap.className = 'app-cell';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'build-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', detailId);
    toggle.textContent = '+';
    appWrap.append(
      (() => {
        const line = document.createElement('span');
        line.className = 'app-name';
        line.append(toggle, document.createTextNode('TravelTrust Insurance'));
        return line;
      })(),
      createTextElement('span', 'app-origin', historySiteOrigin || 'Local application')
    );
    appCell.appendChild(appWrap);
    row.appendChild(appCell);
    row.append(
      createTextElement('td', '', selectedFilters.environment || historyEnvironment || 'Development'),
      createTextElement('td', 'metric-strong', buildVersion || 'Not provided'),
      createTextElement('td', '', index === 0 ? getReferenceBuild() : 'Previous build')
    );
    appendCoverageCell(row, covered, total);
    appendCoverageCell(row, changeSummary.covered, changeSummary.total);
    row.append(
      createTextElement('td', changeSummary.untested ? 'metric-strong' : '', String(changeSummary.total ? changeSummary.untested : '-')),
      createTextElement('td', failedTests.length ? 'metric-strong' : '', String(failedTests.length))
    );
    const gateCell = document.createElement('td');
    gateCell.appendChild(createTextElement('span', `quality-status ${getQualityGateClass(gateStatus)}`, gateStatus));
    row.appendChild(gateCell);
    const detailRow = renderBuildDetail(buildVersion, buildRecords, detailId, gateEvaluation, failedTests);
    const toggleDetail = () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      toggle.textContent = expanded ? '+' : '-';
      detailRow.hidden = expanded;
    };
    toggle.addEventListener('click', (event) => { event.stopPropagation(); toggleDetail(); });
    row.addEventListener('click', toggleDetail);
    buildSummaryBody.appendChild(row);
    buildSummaryBody.appendChild(detailRow);
  });
}

function sortHistoryRecords(records) {
  const sorted = [...records];
  sorted.sort((first, second) => {
    let firstValue;
    let secondValue;
    let direction = -1;

    switch (selectedSort) {
      case 'date-asc':
        direction = 1;
        // Falls through to use the same date values as the default option.
      case 'date-desc':
        firstValue = getRecordTimestamp(first);
        secondValue = getRecordTimestamp(second);
        break;
      case 'duration-asc':
        direction = 1;
        // Falls through to use the same duration values as the descending option.
      case 'duration-desc':
        firstValue = Number(first.durationMs || 0);
        secondValue = Number(second.durationMs || 0);
        break;
      case 'coverage-asc':
        direction = 1;
        // Falls through to use the same coverage values as the descending option.
      case 'coverage-desc':
        firstValue = getRecordCoverage(first).percent;
        secondValue = getRecordCoverage(second).percent;
        break;
      default:
        firstValue = getRecordTimestamp(first);
        secondValue = getRecordTimestamp(second);
    }

    if (firstValue === secondValue) {
      return getRecordTimestamp(second) - getRecordTimestamp(first);
    }
    return (firstValue - secondValue) * direction;
  });
  return sorted;
}

function uniqueActionRecords(records) {
  const latestByAction = new Map();
  sortHistoryRecords(records).forEach((record) => {
    const actionName = String(record.testName || 'Untitled test').trim().toLowerCase();
    if (!latestByAction.has(actionName)) latestByAction.set(actionName, record);
  });
  return [...latestByAction.values()];
}

function formatFileUrl(url) {
  if (!url) return 'Unknown file';
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) ? `${parsed.pathname}${parsed.search}` : url;
  } catch {
    return url;
  }
}

function isAnonymous(name) {
  return !name || /^\(?anonymous\)?$/i.test(String(name).trim()) || /anonymous/i.test(String(name));
}

function getCoverageFunctionKey(fileUrl, fn) {
  const name = fn.name || '(anonymous)';
  const location = String(fn.location || '');
  return `${fileUrl}|${isAnonymous(name) ? 'anonymous' : 'name'}:${name}:${location}`;
}

function buildCoverage(records) {
  const files = new Map();
  records.forEach((record) => (record.files || []).forEach((file) => {
    if (!fileMatchesLayer(file)) return;
    // Older history may contain both localhost URLs and path-only URLs for one file.
    const url = formatFileUrl(file.url);
    if (!files.has(url)) files.set(url, { url, layer: file.layer || 'frontend', functions: new Map(), stages: new Map() });
    const target = files.get(url);
    const stageName = getStageLabel(record.testSuite);
    (file.functions || []).forEach((fn) => {
      if (!fn) return;
      const name = fn.name || '(anonymous)';
      const location = String(fn.location || '');
      // Use source location so repeated observations of the same callback merge.
      const key = getCoverageFunctionKey(url, fn);
      const existing = target.functions.get(key);
      const stageCoverage = new Map(existing?.stageCoverage || []);
      stageCoverage.set(stageName, Boolean(stageCoverage.get(stageName) || fn.covered));
      target.functions.set(key, {
        name,
        covered: Boolean(existing?.covered || fn.covered),
        location: existing?.location || location,
        stageCoverage,
      });
    });
  }));
  return [...files.values()].map((file) => {
    const functions = [...file.functions.values()].map((fn) => ({ ...fn, stageCoverage: Object.fromEntries(fn.stageCoverage || []) }));
    const covered = functions.filter((fn) => fn.covered).length;
    const stages = getStageSummaries(functions);
    return { ...file, functions, stages, covered, total: functions.length, percent: percentNumber(covered, functions.length) };
  }).sort((a, b) => a.url.localeCompare(b.url));
}

function getStageSummaries(functions) {
  const stageNames = [...new Set(functions.flatMap((fn) => Object.keys(fn.stageCoverage || {})))].sort();
  return stageNames.map((stage) => {
    const total = functions.filter((fn) => Object.prototype.hasOwnProperty.call(fn.stageCoverage || {}, stage)).length;
    const covered = functions.filter((fn) => fn.stageCoverage?.[stage]).length;
    return { stage, covered, total, percent: percentNumber(covered, total) };
  });
}

function getBuildVersions(records) {
  const latestByBuild = new Map();
  records.forEach((record) => {
    const build = getRecordMetadata(record).buildVersion;
    const timestamp = Date.parse(record.capturedAt || record.stoppedAt || record.startedAt) || 0;
    latestByBuild.set(build, Math.max(latestByBuild.get(build) || 0, timestamp));
  });
  return [...latestByBuild.keys()].sort((first, second) => (latestByBuild.get(second) - latestByBuild.get(first)) || first.localeCompare(second));
}

function selectLatestBuildPair(records) {
  const builds = getBuildVersions(records);
  selectedComparisonBuild = builds[0] || '';
  selectedBaselineBuild = builds[1] || '';
}

function populateDeltaBuildOptions(records) {
  const builds = getBuildVersions(records);
  [baselineBuildSelect, comparisonBuildSelect].forEach((select) => {
    select.replaceChildren(new Option('Select a build', ''));
    builds.forEach((build) => select.add(new Option(build, build)));
    select.disabled = builds.length < 2;
  });
  if (!builds.includes(selectedComparisonBuild)) selectedComparisonBuild = builds[0] || '';
  if (!builds.includes(selectedBaselineBuild) || selectedBaselineBuild === selectedComparisonBuild) {
    selectedBaselineBuild = builds.find((build) => build !== selectedComparisonBuild) || '';
  }
  baselineBuildSelect.value = selectedBaselineBuild;
  comparisonBuildSelect.value = selectedComparisonBuild;
}

function functionIdentity(file, fn, index) {
  const name = String(fn?.name || '(anonymous)').trim();
  const location = String(fn?.location || '').trim();
  const fileUrl = formatFileUrl(file.url);

  // A named function remains the same function when code is inserted above
  // it, even when V8's offsets move. Anonymous callbacks have no stable name,
  // so retain their location/index as the fallback identity.
  if (!isAnonymous(name)) return `${fileUrl}\u0000name:${name}`;
  return `${fileUrl}\u0000anonymous:${location || index}`;
}

function buildSnapshot(records) {
  const functions = new Map();
  records.forEach((record) => (record.files || []).forEach((file) => {
    (file.functions || []).forEach((fn, index) => {
      if (!fn) return;
      const key = functionIdentity(file, fn, index);
      const existing = functions.get(key);
      functions.set(key, {
        key,
        file: formatFileUrl(file.url),
        name: fn.name || '(anonymous)',
        location: fn.location || '',
        covered: Boolean(existing?.covered || fn.covered),
      });
    });
  }));
  const entries = [...functions.values()];
  return { functions, total: entries.length, covered: entries.filter((fn) => fn.covered).length };
}

function getCoverageDelta(records) {
  const baselineRecords = records.filter((record) => getRecordMetadata(record).buildVersion === selectedBaselineBuild);
  const comparisonRecords = records.filter((record) => getRecordMetadata(record).buildVersion === selectedComparisonBuild);
  const baseline = buildSnapshot(baselineRecords);
  const comparison = buildSnapshot(comparisonRecords);
  const added = [...comparison.functions.values()].filter((fn) => !baseline.functions.has(fn.key));
  const removed = [...baseline.functions.values()].filter((fn) => !comparison.functions.has(fn.key));
  const newlyCoveredExisting = [...comparison.functions.values()].filter((fn) => baseline.functions.has(fn.key) && fn.covered && !baseline.functions.get(fn.key).covered);
  return {
    baseline, comparison, added, removed, newlyCoveredExisting,
    addedCovered: added.filter((fn) => fn.covered),
    addedUntested: added.filter((fn) => !fn.covered),
  };
}

function renderDeltaFunctionList(functions) {
  const list = document.createElement('div');
  list.className = 'delta-files';
  const byFile = new Map();
  (Array.isArray(functions) ? functions : []).forEach((fn) => {
    const file = String(fn?.file || 'Unknown file');
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(fn || {});
  });
  [...byFile.entries()].sort(([first], [second]) => first.localeCompare(second)).forEach(([file, entries]) => {
    const details = document.createElement('details'); details.className = 'delta-file';
    const summary = document.createElement('summary'); summary.textContent = `${file} (${entries.length})`;
    const content = document.createElement('div');
    entries.sort((first, second) => String(first.name || '').localeCompare(String(second.name || ''))).forEach((fn) => {
      const item = document.createElement('div'); item.className = 'delta-function';
      item.textContent = `${fn.covered ? 'Executed' : 'Unexecuted'} — ${fn.name}${fn.location ? ` (${fn.location})` : ''}`;
      item.textContent = '';
      const status = document.createElement('span');
      status.className = `delta-function-status ${fn.covered ? 'executed' : 'untested'}`;
      status.textContent = fn.covered ? 'Executed' : 'Unexecuted';
      const name = document.createElement('span');
      name.className = 'delta-function-name';
      name.textContent = fn.name;
      item.append(status, name);
      content.appendChild(item);
    });
    details.append(summary, content); list.appendChild(details);
  });
  return list;
}

function renderBuildFunctionSnapshot(label, buildVersion, snapshot) {
  const functions = snapshot?.functions instanceof Map
    ? [...snapshot.functions.values()]
    : Array.isArray(snapshot?.functions) ? snapshot.functions : [];
  const executedFunctions = functions.filter((fn) => fn?.covered);
  const section = document.createElement('section');
  section.className = 'delta-build';
  const heading = document.createElement('h3');
  heading.className = 'delta-build-heading';
  heading.textContent = label;
  const build = document.createElement('p');
  build.className = 'delta-build-version';
  build.textContent = buildVersion;
  const summary = document.createElement('p');
  summary.className = 'delta-note';
  summary.textContent = `${executedFunctions.length} executed functions.`;
  section.append(heading, build, summary, renderDeltaFunctionList(executedFunctions));
  return section;
}

function renderUploadedDelta(deltaAnalysis, records = getSiteHistory()) {
  const delta = deltaAnalysis?.delta || {};
  const cumulative = buildCoverage(records);
  const executedUnique = cumulative.reduce((sum, file) => sum + file.covered, 0);
  const inventory = delta.inventory || {};
  const currentTotal = Number(inventory.currentFunctions) || cumulative.reduce((sum, file) => sum + file.total, 0);
  const executed = Math.min(executedUnique, currentTotal);
  const unexecuted = Math.max(currentTotal - executed, 0);
  const overview = document.createElement('div'); overview.className = 'delta-summary';
  [[currentTotal, 'Total inventory functions', ''], [executed, 'Cumulative executed functions', 'executed'], [unexecuted, 'Cumulative unexecuted functions', 'untested']].forEach(([value, label, tone]) => {
    const metric = document.createElement('div'); metric.className = `delta-metric ${tone}`;
    const big = document.createElement('div'); big.className = 'delta-value'; big.textContent = value;
    const title = document.createElement('div'); title.className = 'delta-label'; title.textContent = label;
    metric.append(big, title); overview.appendChild(metric);
  });
  deltaResults.replaceChildren(overview);
}

function renderTestingCycle(cycle, title) {
  const section = document.createElement('section'); section.className = 'testing-cycle';
  const heading = document.createElement('h3'); heading.textContent = title;
  if (!cycle) {
    const note = document.createElement('p'); note.className = 'delta-note'; note.textContent = 'No active testing cycle. The next detected code change will start one.';
    section.append(heading, note); return section;
  }
  const metrics = [
    [cycle.added, 'Functions added', 'added'], [cycle.modified, 'Functions modified', 'modified'],
    [cycle.tested, 'Functions executed', 'executed'], [cycle.untested, 'Functions unexecuted', 'untested'],
    [cycle.status === 'completed' ? 'Completed' : 'Pending', 'Status', cycle.status],
  ];
  const grid = document.createElement('div'); grid.className = 'delta-summary';
  metrics.forEach(([value, label, tone]) => { const card = document.createElement('div'); card.className = `delta-metric ${tone}`; const big = document.createElement('div'); big.className = 'delta-value'; big.textContent = value; const labelEl = document.createElement('div'); labelEl.className = 'delta-label'; labelEl.textContent = label; card.append(big, labelEl); grid.append(card); });
  section.append(heading, grid);
  if (cycle.untested) section.append(renderDeltaFunctionList(cycle.functions || []));
  return section;
}

function renderDeltaReportMeta(deltaAnalysis) {
  deltaReportMeta.replaceChildren();
  if (!deltaAnalysis) return;
  const details = [
    ['Last checked', formatDate(deltaAnalysis.createdAt)],
    ['Build', deltaAnalysis.buildVersion || 'Current build'],
    ['Baseline', deltaAnalysis.baselineRef || 'Saved baseline'],
  ];
  details.forEach(([label, value]) => {
    const item = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = `${label}: `;
    item.append(title, document.createTextNode(value));
    deltaReportMeta.appendChild(item);
  });
}

function renderCoverageDelta(records = getDeltaScopeHistory()) {
  deltaResults.replaceChildren();
  const automatic = deltaViewMode === 'automatic';
  refreshDeltaBtn.disabled = !historySiteOrigin || !historyEnvironment;
  refreshDeltaBtn.hidden = !historySiteOrigin || !historyEnvironment;
  document.body.classList.toggle('delta-uploaded', Boolean(uploadedDelta) || automatic);
  if (uploadedDelta) {
    deltaIntro.textContent = 'Automated code and coverage comparison for the selected environment.';
    renderDeltaReportMeta(uploadedDelta);
    renderUploadedDelta(uploadedDelta, getSiteHistory());
    return;
  }
  renderDeltaReportMeta(null);
  document.body.classList.toggle('delta-automatic', automatic);
  automaticDeltaBtn.setAttribute('aria-pressed', String(automatic));
  manualDeltaBtn.setAttribute('aria-pressed', String(!automatic));
  if (automatic) {
    deltaIntro.textContent = 'Automated code and coverage comparison for the selected environment.';
    renderUploadedDelta({ buildVersion: 'the current build', baselineRef: 'its saved baseline', delta: {} }, records);
    return;
  }
  deltaIntro.textContent = 'Choose two recorded build versions to compare their observed function coverage.';
  if (!selectedBaselineBuild || !selectedComparisonBuild || selectedBaselineBuild === selectedComparisonBuild) {
    deltaResults.textContent = 'Coverage Delta will appear after coverage is captured for two detected builds.';
    deltaResults.className = '';
    return;
  }
  const delta = getCoverageDelta(records);
  const metrics = [
    [delta.added.length, 'Functions added', 'added'],
    [delta.addedCovered.length, 'New functions executed', 'executed'],
    [delta.addedUntested.length, 'New functions unexecuted', 'untested'],
  ];
  const summary = document.createElement('div'); summary.className = 'delta-summary';
  metrics.forEach(([value, label, tone]) => {
    const metric = document.createElement('div'); metric.className = `delta-metric ${tone}`;
    const big = document.createElement('div'); big.className = 'delta-value'; big.textContent = value;
    const title = document.createElement('div'); title.className = 'delta-label'; title.textContent = label;
    metric.append(big, title); summary.appendChild(metric);
  });
  const note = document.createElement('p'); note.className = 'delta-note';
  note.textContent = `New build ${selectedComparisonBuild} is compared with ${selectedBaselineBuild}. ${delta.addedCovered.length} of ${delta.added.length} newly added functions were executed.`;
  deltaResults.className = '';
  deltaResults.append(summary, note);
  const buildSnapshots = document.createElement('div');
  buildSnapshots.className = 'delta-builds';
  buildSnapshots.append(
    renderBuildFunctionSnapshot('Previous build · executed functions', selectedBaselineBuild, delta.baseline),
    renderBuildFunctionSnapshot('New build · executed functions', selectedComparisonBuild, delta.comparison)
  );
  deltaResults.append(buildSnapshots);
  if (delta.added.length) {
    const heading = document.createElement('p'); heading.className = 'delta-note'; heading.textContent = 'Functions added in the new build';
    deltaResults.append(heading, renderDeltaFunctionList(delta.added));
  }
}

function createCell(text, className) {
  const cell = document.createElement('td'); cell.textContent = text; if (className) cell.className = className; return cell;
}

function createBar(covered, total) {
  const wrap = document.createElement('div');
  const bar = document.createElement('span');
  const value = percentNumber(covered, total);
  wrap.className = 'coverage-bar'; bar.className = `coverage-fill ${value >= COVERAGE_BAR_GOOD_PERCENT ? 'good' : value >= 40 ? 'warning' : 'poor'}`;
  bar.style.width = `${value}%`; wrap.appendChild(bar); return wrap;
}

function createFunctionList(functions, uncoveredOnly = false, coveredOnly = false) {
  const list = document.createElement('div'); list.className = 'function-list';
  const shown = functions.filter((fn) => (!uncoveredOnly || !fn.covered) && (!coveredOnly || fn.covered)).sort((a, b) => a.name.localeCompare(b.name));
  if (!shown.length) { list.textContent = uncoveredOnly ? 'No observed unexecuted functions.' : coveredOnly ? 'No observed executed functions.' : 'No functions recorded.'; return list; }
  shown.forEach((fn) => {
    const item = document.createElement('div'); item.className = `function-item ${fn.covered ? 'function-covered' : 'function-uncovered'}`;
    const icon = document.createElement('span'); icon.textContent = fn.covered ? '✓' : '○';
    const name = document.createElement('span'); name.className = 'function-name'; name.textContent = fn.name;
    const location = document.createElement('span'); location.className = 'function-location'; location.textContent = fn.location ? `line ${getLineNumber(fn.location)}` : '';
    item.append(icon, name, location); list.appendChild(item);
  });
  return list;
}

function createFunctionColumns(functions) {
  const list = document.createElement('div');
  list.className = 'function-list function-columns executed-only';
  const column = document.createElement('div');
  column.className = 'function-column function-covered';
  const heading = document.createElement('div');
  heading.className = 'function-column-heading';
  const executed = functions.filter((fn) => fn.covered).sort((a, b) => a.name.localeCompare(b.name));
  heading.textContent = `Executed (${executed.length})`;
  const entries = document.createElement('div');
  entries.className = 'function-column-entries';
  if (!executed.length) {
    entries.textContent = 'No executed functions.';
  } else {
    executed.forEach((fn) => {
      const item = document.createElement('div'); item.className = 'function-item function-covered';
      const icon = document.createElement('span'); icon.textContent = '✓';
      const name = document.createElement('span'); name.className = 'function-name'; name.textContent = fn.name;
      const location = document.createElement('span'); location.className = 'function-location'; location.textContent = fn.location ? `line ${getLineNumber(fn.location)}` : '';
      item.append(icon, name, location);
      if (fn.newlyCovered) { const badge = document.createElement('span'); badge.className = 'newly-covered'; badge.textContent = 'New'; item.appendChild(badge); }
      entries.appendChild(item);
    });
  }
  column.append(heading, entries);
  list.appendChild(column);
  return list;
  /*
  list.className = 'function-list function-columns';
  const groups = [
    { title: 'Executed', functions: functions.filter((fn) => fn.covered), covered: true },
    { title: 'Unexecuted', functions: functions.filter((fn) => !fn.covered), covered: false },
  ];

  groups.forEach((group) => {
    const column = document.createElement('div');
    column.className = `function-column ${group.covered ? 'function-covered' : 'function-uncovered'}`;
    const heading = document.createElement('div');
    heading.className = 'function-column-heading';
    heading.textContent = `${group.title} (${group.functions.length})`;
    const entries = document.createElement('div');
    entries.className = 'function-column-entries';
    const sorted = group.functions.sort((a, b) => a.name.localeCompare(b.name));
    if (!sorted.length) {
      entries.textContent = `No ${group.title.toLowerCase()} functions.`;
    } else {
      sorted.forEach((fn) => {
        const item = document.createElement('div'); item.className = `function-item ${group.covered ? 'function-covered' : 'function-uncovered'}`;
        const icon = document.createElement('span'); icon.textContent = group.covered ? '✓' : '○';
        const name = document.createElement('span'); name.className = 'function-name'; name.textContent = fn.name;
        const location = document.createElement('span'); location.className = 'function-location'; location.textContent = fn.location ? `line ${getLineNumber(fn.location)}` : '';
        item.append(icon, name, location);
        if (fn.newlyCovered) { const badge = document.createElement('span'); badge.className = 'newly-covered'; badge.textContent = 'New'; item.appendChild(badge); }
        entries.appendChild(item);
      });
    }
    column.append(heading, entries); list.appendChild(column);
  });
  return list;
  */
}

function renderFilePanel(container, files, untestedOnly = false) {
  container.replaceChildren();
  const visibleFiles = untestedOnly ? files : files.filter((file) => file.covered > 0);
  if (!visibleFiles.length) { container.textContent = 'No executed functions yet.'; return; }
  visibleFiles.forEach((file) => {
    const details = document.createElement('details'); details.className = `overall-file${untestedOnly ? ' untested-file' : ''}`;
    const summary = document.createElement('summary');
    const untested = file.total - file.covered;
    if (untestedOnly) {
      summary.textContent = `${formatFileUrl(file.url)} (${untested} unexecuted)`;
      details.append(summary, createFunctionList(file.functions, true));
      container.appendChild(details);
      return;
    }
    const title = document.createElement('span'); title.textContent = formatFileUrl(file.url);
    const metric = document.createElement('span');
    metric.textContent = `${file.covered} / ${file.total} functions (${file.percent}%)`;
    summary.append(title, metric);
    details.append(summary, createFunctionList(file.functions, false, true)); container.appendChild(details);
  });
}

function getExecutedFunctionSet(record) {
  const functions = new Map();
  buildCoverage([record]).forEach((file) => file.functions.filter((fn) => fn.covered).forEach((fn) => {
    functions.set(getCoverageFunctionKey(file.url, fn), fn);
  }));
  return functions;
}

function renderDashboard(records = getFilteredHistory(), actionRecord = null) {
  const primaryRecord = actionRecord || sortHistoryRecords(records)[0] || null;
  const actionFiles = primaryRecord ? buildCoverage([primaryRecord]) : [];
  const cumulativeRecords = uniqueActionRecords(records);
  const cumulativeFiles = buildCoverage(cumulativeRecords);
  const actionObservedTotal = actionFiles.reduce((sum, file) => sum + file.total, 0);
  const cumulativeObservedTotal = cumulativeFiles.reduce((sum, file) => sum + file.total, 0);
  const inventoryTotal = getDeltaInventoryTotal();
  const actionTotal = inventoryTotal || actionObservedTotal;
  const actionCovered = Math.min(actionFiles.reduce((sum, file) => sum + file.covered, 0), actionTotal);
  const actionPct = percentNumber(actionCovered, actionTotal);
  const cumulativeTotal = inventoryTotal || cumulativeObservedTotal;
  const cumulativeCovered = Math.min(cumulativeFiles.reduce((sum, file) => sum + file.covered, 0), cumulativeTotal);
  const cumulativePct = percentNumber(cumulativeCovered, cumulativeTotal);
  const actionName = primaryRecord?.testName || 'Latest action';
  const failedTests = getVisibleFailedTests();
  const changeSummary = getChangeCoverageSummary(records);
  const actionFocused = isActionFocusedScope(records, actionRecord);
  const gateEvaluation = getQualityGateEvaluation({
    overallPercent: cumulativePct,
    changeSummary,
    failedTests,
    enforceOverallCoverage: !actionFocused,
    actionCovered: actionFocused ? cumulativeCovered : actionCovered,
  });
  const gateStatus = gateEvaluation.status;
  const latestRecord = sortHistoryRecords(records)[0];
  const dataAsOf = latestRecord?.capturedAt || latestRecord?.stoppedAt || latestRecord?.startedAt || new Date().toISOString();
  const cardData = [
    { label: actionFocused ? 'Action Coverage' : 'Overall Coverage', value: `${actionFocused ? actionPct : cumulativePct}%`, note: actionFocused ? `${actionCovered} methods captured in ${actionName}; whole-app % is informational` : `${cumulativeCovered} tested / ${cumulativeTotal} total methods; target ${qualityGateThresholds.overallCoveragePercent}%`, tone: 'primary-coverage-card' },
    { label: 'Code Changes Coverage', value: changeSummary.total ? `${changeSummary.percent}%` : '-', note: changeSummary.total ? `${changeSummary.covered} tested / ${changeSummary.total} changed methods; target ${qualityGateThresholds.codeChangesCoveragePercent}%` : 'No detected code changes in scope', tone: changeSummary.untested ? 'warning-card' : '' },
    { label: 'Untested Code Changes', value: changeSummary.total ? changeSummary.untested : '-', note: changeSummary.total ? `Target <= ${qualityGateThresholds.untestedCodeChanges}` : 'Waiting for a delta comparison', tone: changeSummary.untested > qualityGateThresholds.untestedCodeChanges ? 'risk-card' : 'pass-card' },
    { label: 'Failed Tests', value: failedTests.length, note: failedTests.length ? failedTests.slice(0, 3).map((test) => test.testName).join(', ') : `Target <= ${qualityGateThresholds.failedTests}`, tone: failedTests.length > qualityGateThresholds.failedTests ? 'risk-card' : 'pass-card' },
    { label: 'Quality Gate', value: gateStatus, note: gateEvaluation.failedChecks.length ? gateEvaluation.failedChecks.map((check) => check.label).join(', ') : `Latest action focus: ${actionName} (${actionPct}% action coverage)`, tone: gateStatus === 'Passed' ? 'pass-card' : gateStatus === 'Failed' ? 'risk-card' : 'warning-card' },
  ];
  dashboardCards.replaceChildren();
  cardData.forEach(({ label, value, note, tone }) => {
    const card = document.createElement('div'); card.className = `dashboard-card ${tone || ''}`.trim();
    const big = document.createElement('div'); big.className = 'card-value'; big.textContent = value;
    const title = document.createElement('div'); title.className = 'card-label'; title.textContent = label;
    const detail = document.createElement('div'); detail.className = 'card-note'; detail.textContent = note;
    card.append(big, title, detail);
    dashboardCards.appendChild(card);
  });
  renderFilePanel(overallFiles, actionFiles);
  dashboardScopeNote.textContent = actionFocused
    ? `Manual action scope: small recordings are judged by captured methods, changed-code coverage when available, and failed tests. Whole-application coverage remains visible but does not fail the gate. Date range: ${describeDateRange()}. Data as of ${formatDate(dataAsOf)}.`
    : `Quality gate: ${getGateRulesText()}. Date range: ${describeDateRange()}. Data as of ${formatDate(dataAsOf)}.`;
  renderScopeStrip();
  renderBuildSummary(records);
  viewOverallBtn.textContent = primaryRecord ? 'Current Action Coverage' : 'Overall Coverage';
  viewOverallBtn.setAttribute('aria-selected', 'true');
}

function createDetailsRow(record) {
  const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 10; cell.className = 'details-cell';
  const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = `File Coverage Breakdown (${(record.files || []).length})`;
  const list = document.createElement('div'); list.className = 'file-list';
  const actionCoverage = getRecordCoverage(record);
  const actionTotal = getDeltaInventoryTotal() || actionCoverage.total;
  const recordTime = getRecordTimestamp(record);
  const previouslyCovered = new Set();
  getSiteHistory().filter((candidate) => getRecordTimestamp(candidate) < recordTime).forEach((candidate) => {
    getExecutedFunctionSet(candidate).forEach((fn, key) => previouslyCovered.add(key));
  });
  const actionSummary = document.createElement('div'); actionSummary.className = 'coverage-count';
  actionSummary.textContent = `Action coverage: ${actionCoverage.covered} executed / ${actionTotal} total Delta functions (${getCoveragePercent(actionCoverage.covered, actionTotal)})`;
  list.appendChild(actionSummary);
  const interactions = Array.isArray(record.interactions) ? record.interactions : [];
  if (interactions.length) {
    const steps = document.createElement('div'); steps.className = 'recorded-steps';
    const title = document.createElement('strong'); title.textContent = 'Recorded test steps';
    const entries = document.createElement('ol');
    interactions.forEach((interaction) => { const item = document.createElement('li'); item.textContent = interaction?.text || String(interaction); entries.appendChild(item); });
    steps.append(title, entries); list.appendChild(steps);
  }
  (record.files || []).forEach((file) => {
    const functions = (file.functions || []).map((fn) => ({ ...fn, newlyCovered: Boolean(fn.covered && !previouslyCovered.has(getCoverageFunctionKey(formatFileUrl(file.url), fn))) })); const rowEl = document.createElement('div'); rowEl.className = 'file-row';
    const url = document.createElement('div'); url.className = 'file-url'; url.textContent = formatFileUrl(file.url);
    const coveredFunctions = Number(file.coveredFunctions || 0);
    const count = document.createElement('div'); count.className = 'coverage-count'; count.textContent = `${coveredFunctions} action-level executed functions`;
    const pct = document.createElement('div'); pct.className = 'coverage-percent'; pct.textContent = getCoveragePercent(coveredFunctions, actionTotal);
    rowEl.append(url, count, pct, createFunctionColumns(functions)); list.appendChild(rowEl);
  });
  if (!(record.files || []).length) list.textContent = 'No file coverage details saved for this test.';
  details.addEventListener('toggle', () => {
    if (details.open) renderDashboard(getFilteredHistory(), record);
    else renderDashboard(getFilteredHistory());
  });
  details.append(summary, list); cell.appendChild(details); row.appendChild(cell); return row;
}

function renderHistory() {
  const siteHistory = getSiteHistory();
  populateFilterOptions(siteHistory);
  const deltaRecords = getDeltaScopeHistory(siteHistory);
  if (deltaViewMode === 'automatic') selectLatestBuildPair(deltaRecords);
  else populateDeltaBuildOptions(deltaRecords);
  const filtered = getFilteredHistory(siteHistory);
  const sorted = sortHistoryRecords(filtered);
  historyBody.replaceChildren(); emptyState.style.display = sorted.length ? 'none' : 'block'; exportBtn.disabled = !siteHistory.length; clearBtn.disabled = !siteHistory.length;
  summaryText.textContent = historySiteOrigin && historyEnvironment
    ? `${filtered.length} of ${siteHistory.length} ${historyJobId ? 'action session' : 'actions'} shown for ${historyEnvironment} at ${historySiteOrigin} across ${describeDateRange()}. Cumulative dashboard coverage is deduplicated across these actions; each row shows action-level coverage.`
    : 'Open History from a website tab to view its environment-scoped coverage history.';
  sorted.forEach((record) => {
    const { covered, total: observedTotal } = getRecordCoverage(record);
    const total = getDeltaInventoryTotal() || observedTotal;
    const row = document.createElement('tr'); row.dataset.jobId = String(record.jobId || ''); const coverage = document.createElement('td'); coverage.className = 'row-coverage'; const status = getActionCoverageStatus(record); coverage.append(createBar(covered, total), document.createTextNode(`${getCoveragePercent(covered, total)} · ${status}`));
    const testName = record.testName || 'Untitled test';
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button'; deleteButton.className = 'delete-test-btn';
    deleteButton.title = `Remove ${testName}`; deleteButton.setAttribute('aria-label', `Remove ${testName}`);
    const trashIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    trashIcon.setAttribute('viewBox', '0 0 24 24'); trashIcon.setAttribute('aria-hidden', 'true');
    const trashPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    trashPath.setAttribute('d', 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5');
    trashIcon.appendChild(trashPath); deleteButton.appendChild(trashIcon);
    deleteButton.addEventListener('click', () => deleteHistoryRecord(record));
    const actionsCell = createCell('', 'row-actions'); actionsCell.append(deleteButton);
    const startedAt = record.startedAt || record.capturedAt;
    const stoppedAt = record.stoppedAt || record.capturedAt;
    row.append(
      createCell(testName, 'test-name'),
      createCell(record.testDescription || '', 'description'),
      createCell(record.testSuite || 'Manual'),
      createCell(record.environment || 'Unspecified'),
      createCell(record.buildVersion || 'Not provided'),
      createCell(formatDate(startedAt), 'date'),
      createCell(formatDate(stoppedAt), 'date'),
      createCell(formatDuration(record.durationMs), 'duration'),
      coverage,
      actionsCell
    );
    historyBody.append(row, createDetailsRow(record));
  });
  renderDashboard(filtered);
  renderPrimaryViewPanels(filtered);
  setPrimaryView(activePrimaryView);
  renderCoverageDelta(deltaRecords);
  if (focusCoverageDelta) {
    focusCoverageDelta = false;
    if (!deltaOnlyView) {
      requestAnimationFrame(() => {
        document.getElementById('deltaHeading')?.closest('.delta-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }
}

function showOverall() { renderDashboard(getFilteredHistory()); }
async function loadHistory() {
  if (historySiteOrigin) {
    try {
      if (!historyEnvironment) throw new Error('An environment is required to load coverage history.');
      const response = await fetch(buildBridgeUrl('/coverage-sessions', { origin: historySiteOrigin, environment: historyEnvironment }));
      if (!response.ok) throw new Error(`Bridge server returned ${response.status}`);
      const { sessions } = await response.json();
      coverageHistory = Array.isArray(sessions) ? sessions.map((session) => ({
        ...session,
        files: session.result?.files || [],
        interactions: session.result?.interactions || [],
        durationMs: Date.parse(session.stoppedAt) - Date.parse(session.startedAt),
        capturedAt: session.stoppedAt || session.startedAt,
      })) : [];
      bridgeHistoryLoaded = true;
      applyDefaultSuiteFromLatest(coverageHistory);
      const deltaResponse = await fetch(buildBridgeUrl('/delta-analysis', { origin: historySiteOrigin, environment: historyEnvironment }));
      uploadedDelta = deltaResponse.ok ? await deltaResponse.json() : null;
      const failedTestsResponse = await fetch(buildBridgeUrl('/failed-tests', { origin: historySiteOrigin, environment: historyEnvironment }));
      currentFailedTests = failedTestsResponse.ok ? (await failedTestsResponse.json()).failedTests || [] : [];
      await loadCoverageViews();
      renderHistory();
      return;
    } catch (error) {
      console.warn('Could not load SQLite coverage history; using local history instead.', error);
    }
  }
  const result = await chrome.storage.local.get(STORAGE_KEY);
  uploadedDelta = null;
  const savedHistory = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  let migrated = false;
  coverageHistory = savedHistory.map((record) => {
    if (record.siteOrigin) return record;
    const siteOrigin = inferSiteOrigin(record);
    if (!siteOrigin) return record;
    migrated = true;
    return { ...record, siteOrigin };
  });
  applyDefaultSuiteFromLatest(coverageHistory);
  if (migrated) await chrome.storage.local.set({ [STORAGE_KEY]: coverageHistory });
  await loadCoverageViews();
  renderHistory();
}
async function deleteHistoryRecord(record) {
  const testName = record.testName || 'Untitled test';
  if (!window.confirm(`Remove "${testName}" from CoverageCapture history? This cannot be undone.`)) return;
  const recordIndex = coverageHistory.indexOf(record);
  if (recordIndex === -1) return;
  if (record.jobId) {
    const response = await fetch(`${BRIDGE_SERVER_URL}/coverage-sessions/${encodeURIComponent(record.jobId)}?environment=${encodeURIComponent(historyEnvironment)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error(`Could not remove saved session (${response.status}).`);
  }
  coverageHistory = coverageHistory.filter((_, index) => index !== recordIndex);
  await chrome.storage.local.set({ [STORAGE_KEY]: coverageHistory });
  renderHistory();
}

function pdfSafeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/[\\()]/g, '\\$&');
}

function wrapPdfText(value, maxLength = 88) {
  const words = pdfSafeText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach((word) => {
    if (`${line} ${word}`.trim().length > maxLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  });
  if (line || !lines.length) lines.push(line || '-');
  return lines;
}

function buildPdfDocument(pages) {
  const pageCount = pages.length;
  const pageObjectStart = 3;
  const contentObjectStart = pageObjectStart + pageCount;
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, index) => `${pageObjectStart + index} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  pages.forEach((content, index) => {
    const pageObject = pageObjectStart + index;
    const contentObject = contentObjectStart + index;
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${contentObjectStart + pageCount} 0 R /F2 ${contentObjectStart + pageCount + 1} 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objects[contentObjectStart + pageCount] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[contentObjectStart + pageCount + 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  let pdf = '%PDF-1.4\n%----\n';
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = pdf.length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

function exportHistory() {
  const siteHistory = getFilteredHistory();
  const files = buildCoverage(siteHistory);
  const totalFunctions = files.reduce((sum, file) => sum + file.total, 0);
  const coveredFunctions = files.reduce((sum, file) => sum + file.covered, 0);
  const coveragePercent = percentNumber(coveredFunctions, totalFunctions);
  const reportLines = [
    { text: 'CoverageCapture Coverage History Report', size: 18, bold: true, gap: 26 },
    { text: `Generated: ${new Date().toLocaleString()}`, size: 9, gap: 18 },
    { text: 'Dashboard Summary', size: 14, bold: true, gap: 18 },
    { text: `Overall Coverage: ${coveragePercent}% (${coveredFunctions} / ${totalFunctions} functions)`, size: 11, gap: 15 },
    { text: `Total Functions: ${totalFunctions}`, size: 11, gap: 15 },
    { text: `Website: ${historySiteOrigin || 'Unknown'}`, size: 9, gap: 18 },
    { text: `Selected Tests (${siteHistory.length})`, size: 14, bold: true, gap: 18 },
  ];
  sortNewestFirst(siteHistory).forEach((record, index) => {
    const recordFiles = record.files || [];
    const total = recordFiles.reduce((sum, file) => sum + Number(file.totalFunctions || (file.functions || []).length), 0);
    const covered = recordFiles.reduce((sum, file) => sum + Number(file.coveredFunctions || 0), 0);
    reportLines.push({ text: `${index + 1}. ${record.testName || 'Untitled test'} - ${getCoveragePercent(covered, total)} (${covered} / ${total} functions)`, size: 11, bold: true, gap: 15 });
    reportLines.push({ text: `   Suite: ${record.testSuite || 'Manual'} | Environment: ${record.environment || 'Unspecified'} | Build: ${record.buildVersion || 'Not provided'}`, size: 9, gap: 13 });
    if (record.testDescription) reportLines.push({ text: `   ${record.testDescription}`, size: 9, gap: 13 });
  });

  const pages = [];
  let commands = [];
  let y = 748;
  const startPage = () => { commands = ['0.04 0.12 0.27 rg']; y = 748; };
  const finishPage = () => { pages.push(commands.join('\n')); };
  startPage();
  reportLines.forEach((entry) => {
    const lines = wrapPdfText(entry.text);
    const lineHeight = entry.size + 4;
    if (y - (lines.length * lineHeight) - entry.gap < 42) { finishPage(); startPage(); }
    lines.forEach((line) => { commands.push(`BT /F${entry.bold ? 2 : 1} ${entry.size} Tf 48 ${y} Td (${line}) Tj ET`); y -= lineHeight; });
    y -= entry.gap - lineHeight;
  });
  finishPage();

  const url = URL.createObjectURL(buildPdfDocument(pages));
  const link = document.createElement('a');
  link.href = url;
  link.download = `coveragecapture-history-${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function clearHistory() {
  const siteHistory = getSiteHistory();
  if (!siteHistory.length || !window.confirm(`Clear CoverageCapture history for ${historySiteOrigin}? This cannot be undone.`)) return;
  const response = await fetch(`${BRIDGE_SERVER_URL}/coverage-sessions?origin=${encodeURIComponent(historySiteOrigin)}&environment=${encodeURIComponent(historyEnvironment)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Could not clear saved sessions (${response.status}).`);
  coverageHistory = coverageHistory.filter((record) => record.siteOrigin !== historySiteOrigin || getRecordMetadata(record).environment !== historyEnvironment);
  await chrome.storage.local.set({ [STORAGE_KEY]: coverageHistory });
  renderHistory();
}

async function saveCurrentView() {
  if (!historySiteOrigin) return;
  const current = savedViews.find((view) => String(view.id) === String(viewSelect.value));
  const name = window.prompt('Save this Coverage Analysis view as:', current?.name || 'Sprint Readiness');
  if (!name || !name.trim()) return;
  const response = await fetch(`${BRIDGE_SERVER_URL}/coverage-views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteOrigin: historySiteOrigin, name: name.trim(), config: getCurrentViewConfig() }),
  });
  if (!response.ok) throw new Error(`Could not save view (${response.status}).`);
  const saved = await response.json();
  selectedViewId = String(saved.id || '');
  await loadCoverageViews();
}

async function deleteSelectedView() {
  const view = savedViews.find((entry) => String(entry.id) === String(viewSelect.value));
  if (!view || !window.confirm(`Delete "${view.name}"?`)) return;
  const response = await fetch(`${BRIDGE_SERVER_URL}/coverage-views/${encodeURIComponent(view.id)}?origin=${encodeURIComponent(historySiteOrigin)}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(`Could not delete view (${response.status}).`);
  selectedViewId = '';
  await loadCoverageViews();
  renderHistory();
}

function refreshAfterDateRangeChange() {
  if (bridgeHistoryLoaded && historySiteOrigin) loadHistory();
  else renderHistory();
}

function updateQualityGateThreshold(key, value) {
  qualityGateThresholds = normalizeQualityGateThresholds({ ...qualityGateThresholds, [key]: value });
  renderQualityGateInputs();
  renderHistory();
}

renderQualityGateInputs();
primaryNavButtons.forEach((button) => {
  button.addEventListener('click', () => setPrimaryView(button.dataset.primaryView));
});
searchInput.addEventListener('input', renderHistory);
sortSelect.addEventListener('change', () => { selectedSort = sortSelect.value; renderHistory(); });
dateRangeMode.addEventListener('change', () => { selectedDateRange.mode = dateRangeMode.value; refreshAfterDateRangeChange(); });
dateStartInput.addEventListener('change', () => { selectedDateRange.start = dateStartInput.value; refreshAfterDateRangeChange(); });
dateEndInput.addEventListener('change', () => { selectedDateRange.end = dateEndInput.value; refreshAfterDateRangeChange(); });
overallGateInput.addEventListener('change', () => updateQualityGateThreshold('overallCoveragePercent', overallGateInput.value));
changesGateInput.addEventListener('change', () => updateQualityGateThreshold('codeChangesCoveragePercent', changesGateInput.value));
untestedGateInput.addEventListener('change', () => updateQualityGateThreshold('untestedCodeChanges', untestedGateInput.value));
failedGateInput.addEventListener('change', () => updateQualityGateThreshold('failedTests', failedGateInput.value));
testSuiteFilter.addEventListener('change', () => { selectedFilters.testSuite = testSuiteFilter.value; renderHistory(); });
environmentFilter.addEventListener('change', () => { selectedFilters.environment = environmentFilter.value; renderHistory(); });
buildVersionFilter.addEventListener('change', () => { selectedFilters.buildVersion = buildVersionFilter.value; renderHistory(); });
layerFilter.addEventListener('change', () => { selectedLayer = layerFilter.value; renderHistory(); });
coverageStatusFilter.addEventListener('change', () => { selectedCoverageStatus = coverageStatusFilter.value; renderHistory(); });
viewSelect.addEventListener('change', () => {
  selectedViewId = viewSelect.value;
  const selectedView = savedViews.find((view) => String(view.id) === String(selectedViewId));
  if (selectedView) applyViewConfig(selectedView.config);
  populateViewOptions();
  refreshAfterDateRangeChange();
});
saveViewBtn.addEventListener('click', () => saveCurrentView().catch((error) => window.alert(error.message)));
deleteViewBtn.addEventListener('click', () => deleteSelectedView().catch((error) => window.alert(error.message)));
resetFiltersBtn.addEventListener('click', () => {
  searchInput.value = '';
  sortSelect.value = 'date-desc';
  dateRangeMode.value = '';
  dateStartInput.value = '';
  dateEndInput.value = '';
  layerFilter.value = '';
  selectedSort = 'date-desc';
  selectedDateRange = { mode: '', start: '', end: '' };
  selectedLayer = '';
  selectedViewId = '';
  viewSelect.value = '';
  selectedFilters = { testSuite: defaultTestSuiteFilter, environment: historyEnvironment || '', buildVersion: '' };
  selectedCoverageStatus = '';
  qualityGateThresholds = { ...DEFAULT_QUALITY_GATE_THRESHOLDS };
  renderQualityGateInputs();
  populateViewOptions();
  refreshAfterDateRangeChange();
});
baselineBuildSelect.addEventListener('change', () => { selectedBaselineBuild = baselineBuildSelect.value; renderCoverageDelta(getDeltaScopeHistory()); });
comparisonBuildSelect.addEventListener('change', () => { selectedComparisonBuild = comparisonBuildSelect.value; renderCoverageDelta(getDeltaScopeHistory()); });
automaticDeltaBtn.addEventListener('click', () => { deltaViewMode = 'automatic'; renderHistory(); });
manualDeltaBtn.addEventListener('click', () => { deltaViewMode = 'manual'; renderHistory(); });
refreshDeltaBtn.addEventListener('click', async () => {
  if (!historySiteOrigin || !historyEnvironment) return;
  refreshDeltaBtn.disabled = true;
  deltaRefreshStatus.className = 'delta-refresh-status';
  deltaRefreshStatus.textContent = 'Running automated coverage and delta check…';
  try {
    const response = await fetch(`${BRIDGE_SERVER_URL}/run-delta-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteOrigin: historySiteOrigin, environment: historyEnvironment }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || `Run failed with ${response.status}`);
    uploadedDelta = result.analysis || null;
    deltaRefreshStatus.textContent = '';
    renderHistory();
  } catch (error) {
    deltaRefreshStatus.className = 'delta-refresh-status error';
    deltaRefreshStatus.textContent = `Could not refresh delta check: ${error.message}`;
  } finally {
    refreshDeltaBtn.disabled = false;
  }
});
backBtn.addEventListener('click', () => {
  if (!historySiteOrigin || !historyEnvironment) return;
  const suiteQuery = selectedFilters.testSuite ? `&suite=${encodeURIComponent(selectedFilters.testSuite)}` : '';
  const query = `?origin=${encodeURIComponent(historySiteOrigin)}&environment=${encodeURIComponent(historyEnvironment)}&view=delta${suiteQuery}`;
  window.open(chrome.runtime.getURL(`history.html${query}`), '_blank');
});
viewHistoryBtn.addEventListener('click', () => {
  if (!historySiteOrigin || !historyEnvironment) return;
  const suiteQuery = selectedFilters.testSuite ? `&suite=${encodeURIComponent(selectedFilters.testSuite)}` : '';
  const query = `?origin=${encodeURIComponent(historySiteOrigin)}&environment=${encodeURIComponent(historyEnvironment)}${suiteQuery}`;
  window.open(chrome.runtime.getURL(`history.html${query}`), '_blank');
});
exportBtn.addEventListener('click', exportHistory); clearBtn.addEventListener('click', clearHistory); viewOverallBtn.addEventListener('click', showOverall); loadHistory();
