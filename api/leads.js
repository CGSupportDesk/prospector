const { sendJson, sendError, cleanText } = require('./_lib/http');
const { createStore } = require('./_lib/store');
const { getStorageMode } = require('./_lib/config');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'Method not allowed.');
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 100), 500));
    const runId = cleanText(url.searchParams.get('run_id') || '', 80);
    const store = createStore();
    await store.init();
    const leads = await store.listLeads({ limit, runId });
    sendJson(res, 200, {
      ok: true,
      storage_mode: getStorageMode(),
      database_total: await store.countLeads(),
      leads
    });
  } catch (error) {
    sendError(res, 500, error.message || 'Could not load leads.');
  }
};

