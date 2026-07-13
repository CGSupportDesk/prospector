const { sendJson, sendError } = require('./_lib/http');
const { createStore } = require('./_lib/store');
const { getStorageMode } = require('./_lib/config');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'Method not allowed.');
  }

  const storageMode = getStorageMode();
  const report = {
    node_version: process.version,
    serpapi_key_configured: Boolean(process.env.SERPAPI_API_KEY && process.env.SERPAPI_API_KEY.length >= 20),
    groq_key_configured: Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.length >= 20),
    storage_mode: storageMode,
    persistent_storage: storageMode === 'kv' || storageMode === 'postgres',
    time: new Date().toISOString()
  };

  try {
    const store = createStore();
    await store.init();
    report.database_total = await store.countLeads();
    sendJson(res, report.serpapi_key_configured ? 200 : 500, {
      ok: report.serpapi_key_configured,
      message: report.serpapi_key_configured ? 'Prospector API ready.' : 'SERPAPI_API_KEY is missing.',
      support: report
    });
  } catch (error) {
    sendError(res, 500, error.message || 'Health check failed.', { support: report });
  }
};

