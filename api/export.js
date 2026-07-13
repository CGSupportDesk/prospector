const { csvEscape, sendError, cleanText } = require('./_lib/http');
const { createStore } = require('./_lib/store');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'Method not allowed.');
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const runId = cleanText(url.searchParams.get('run_id') || '', 80);
    const store = createStore();
    await store.init();
    const rows = await store.exportRows(runId);
    const filename = runId ? `prospector-current-run-${runId}.csv` : `prospector-all-searches-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const header = [
      'Search ID',
      'Search Started Date',
      'Search Completed Date',
      'Generated Date',
      'Business Name',
      'Platform',
      'Category',
      'Location',
      'Country',
      'URL',
      'Why Pitch',
      'Source Hint',
      'Search Categories',
      'Search Locations',
      'Search Angles',
      'Extra Keywords',
      'Run Generated Count',
      'Run Duplicate Count',
      'Run Status'
    ];

    const csvRows = [header.map(csvEscape).join(',')];
    for (const row of rows) {
      const run = row.run || {};
      csvRows.push([
        row.run_id,
        run.created_at,
        run.completed_at,
        row.generated_at,
        row.business_name,
        row.platform,
        row.category,
        row.location,
        row.country,
        row.url,
        row.reason,
        row.source_hint,
        arrayText(run.categories),
        arrayText(run.locations),
        arrayText(run.angles),
        run.extra_keywords,
        run.generated_count,
        run.duplicate_count,
        run.status
      ].map(csvEscape).join(','));
    }
    res.end(csvRows.join('\n'));
  } catch (error) {
    sendError(res, 500, error.message || 'Export failed.');
  }
};

function arrayText(value) {
  if (Array.isArray(value)) return value.join(' | ');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.join(' | ');
    } catch {}
    return value;
  }
  return '';
}

