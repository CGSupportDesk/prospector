const crypto = require('crypto');
const { CONFIG, getCountry, getStorageMode } = require('./_lib/config');
const { sendJson, sendError, readJson, cleanText } = require('./_lib/http');
const { createStore } = require('./_lib/store');
const {
  buildQueryObjects,
  serpapiGoogleSearch,
  platformFromUrl,
  businessNameFromResult,
  isRelevantInstagramLead,
  makeLeadReason
} = require('./_lib/scraper');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'Method not allowed.');
  }

  try {
    const payload = await readJson(req);
    const target = Math.max(1, Math.min(Number(payload.target_count || CONFIG.targetLeadsPerRun), 50));
    const categories = uniqueClean(payload.categories, 160);
    const locations = buildLocations(payload);
    const angles = uniqueClean(payload.angles || ['instagram'], 40).map((value) => value.toLowerCase());
    const extraKeywords = cleanText(payload.extra_keywords, 255);
    const countryCode = cleanText(payload.country || 'IN', 4).toUpperCase();
    const country = getCountry(countryCode);

    if (!categories.length) return sendError(res, 400, 'Select at least one business category.');
    if (!locations.length) return sendError(res, 400, 'Select at least one district or location.');
    if (!process.env.SERPAPI_API_KEY || process.env.SERPAPI_API_KEY.length < 20) {
      return sendError(res, 500, 'SERPAPI_API_KEY is not configured.');
    }

    const store = createStore();
    await store.init();

    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    await store.createRun({
      id: runId,
      requested_count: target,
      categories,
      locations,
      angles,
      extra_keywords: extraKeywords,
      status: 'running',
      created_at: now
    });

    const queryObjects = buildQueryObjects({ categories, locations, angles, extraKeywords, countryCode });
    const newLeads = [];
    const errors = [];
    let duplicateCount = 0;
    let rawUrlCount = 0;
    let queriesRun = 0;
    const seenThisRun = new Set();

    for (const queryObject of queryObjects) {
      if (newLeads.length >= target) break;
      queriesRun += 1;

      let results = [];
      try {
        results = await serpapiGoogleSearch(queryObject);
        rawUrlCount += results.length;
      } catch (error) {
        errors.push(`${queryObject.label}: ${error.message}`);
        continue;
      }

      for (const result of results) {
        if (newLeads.length >= target) break;
        if (seenThisRun.has(result.url_hash)) continue;
        seenThisRun.add(result.url_hash);

        const platform = platformFromUrl(result.url);
        if (platform === 'Instagram' && !isRelevantInstagramLead(queryObject.category, result)) continue;

        const lead = {
          run_id: runId,
          business_name: businessNameFromResult(result),
          platform,
          url: result.url,
          url_hash: result.url_hash,
          category: queryObject.category,
          location: queryObject.location,
          country: country.name,
          reason: makeLeadReason(queryObject.category, queryObject.location, platform, result.snippet),
          source_hint: `SerpApi Google Boolean: ${queryObject.query}`,
          generated_at: now
        };

        const inserted = await store.saveLead(lead);
        if (inserted) newLeads.push(stripPrivateFields(lead));
        else duplicateCount += 1;
      }
    }

    const status = newLeads.length >= target ? 'completed' : (errors.length && newLeads.length === 0 ? 'error' : 'partial');
    await store.completeRun(runId, {
      generated_count: newLeads.length,
      duplicate_count: duplicateCount,
      status,
      completed_at: new Date().toISOString(),
      notes: errors.slice(0, 6).join(' | ')
    });

    const databaseTotal = await store.countLeads();
    const message = newLeads.length >= target
      ? `Saved ${target} fresh non-duplicate URLs.`
      : `Saved ${newLeads.length} fresh unique URLs. SerpApi may have returned fewer profile URLs, most URLs were duplicates, or quota/rate limits were reached.`;

    sendJson(res, 200, {
      ok: true,
      mode: 'serpapi_google_boolean_instagram_prospector',
      storage_mode: getStorageMode(),
      run_id: runId,
      requested_count: target,
      generated_count: newLeads.length,
      duplicate_count: duplicateCount,
      database_total: databaseTotal,
      queries_run: queriesRun,
      raw_url_count: rawUrlCount,
      message,
      errors,
      queries: queryObjects,
      leads: newLeads
    });
  } catch (error) {
    sendError(res, error.statusCode || 500, error.message || 'Search failed.');
  }
};

function uniqueClean(values, max) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map((value) => cleanText(value, max)).filter(Boolean))];
}

function buildLocations(payload) {
  const explicit = uniqueClean(payload.locations, 160);
  if (explicit.length) return explicit;

  const countryCode = cleanText(payload.country || 'IN', 4).toUpperCase();
  const country = getCountry(countryCode).name;
  const region = cleanText(payload.region || (countryCode === 'GB' ? 'London' : 'Kerala'), 80);
  const districts = uniqueClean(payload.districts, 80);
  const customLocations = uniqueClean(payload.custom_locations, 120);

  const fromDistricts = districts.map((district) => {
    if (district.toLowerCase().includes(region.toLowerCase())) return `${district}, ${country}`;
    return `${district}, ${region}, ${country}`;
  });
  return [...new Set([...fromDistricts, ...customLocations])];
}

function stripPrivateFields(lead) {
  const { url_hash, ...safeLead } = lead;
  return safeLead;
}
