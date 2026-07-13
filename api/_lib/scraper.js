const crypto = require('crypto');
const { CONFIG, getCountry } = require('./config');
const { cleanText } = require('./http');

const VALID_ANGLES = new Set(['instagram', 'website', 'directory']);
const INSTAGRAM_BLOCKED_SEGMENTS = new Set([
  'p', 'reel', 'reels', 'stories', 'explore', 'tv', 'direct', 'accounts',
  'about', 'developer', 'legal', 'privacy', 'terms', 'challenge'
]);

function hashUrl(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function buildQueryObjects({ categories, locations, angles, extraKeywords, countryCode }) {
  const country = getCountry(countryCode);
  const safeAngles = angles.filter((angle) => VALID_ANGLES.has(angle));
  const selectedAngles = safeAngles.length ? safeAngles : ['instagram'];
  const objects = [];

  for (const category of categories) {
    for (const location of locations) {
      for (const angle of selectedAngles) {
        const queryItems = buildGoogleBooleanQueries(category, location, angle, extraKeywords);
        for (const queryItem of queryItems) {
          for (const start of CONFIG.serpapiStartOffsets) {
            objects.push({
              category,
              location,
              country: country.name,
              country_code: countryCode,
              angle,
              label: `${titleCase(angle)} - ${category} - ${location} - ${queryItem.label}${start ? ` page ${Math.floor(start / CONFIG.serpapiResultsPerQuery) + 1}` : ''}`,
              query: queryItem.query,
              start,
              google_url: `https://www.google.com/search?num=${CONFIG.serpapiResultsPerQuery}&start=${start}&q=${encodeURIComponent(queryItem.query)}`
            });
          }
        }
      }
    }
  }

  return objects.slice(0, CONFIG.maxQueriesPerRun);
}

function buildGoogleBooleanQueries(category, location, angle, extraKeywords) {
  const categoryPart = `"${category}"`;
  const categoryLoose = cleanText(category, 160).replace(/[/"()]/g, ' ');
  const categoryOr = buildCategoryOrPart(category);
  const locationPart = buildLocationBooleanPart(location);
  const looseLocation = buildLooseLocationParts(location);
  const locationVariants = buildLocationVariants(location);
  const extraPart = extraKeywords ? ` ${extraKeywords}` : '';

  if (angle === 'instagram') {
    const profileNoiseBlock = '-inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/stories/ -inurl:/explore/ -inurl:/tv/';
    const items = [
      {
        label: 'profiles exact',
        query: `site:instagram.com "Followers" ${categoryPart} ${locationPart}${extraPart} ${profileNoiseBlock}`
      }
    ];

    for (const locationVariant of locationVariants) {
      items.push(
        {
          label: `profiles broad ${locationVariant.label}`,
          query: `site:instagram.com "Followers" ${categoryOr} ${locationVariant.query}${extraPart} ${profileNoiseBlock}`
        },
        {
          label: `photos videos ${locationVariant.label}`,
          query: `site:instagram.com "Instagram photos and videos" ${categoryOr} ${locationVariant.query}${extraPart} ${profileNoiseBlock}`
        },
        {
          label: `official pages ${locationVariant.label}`,
          query: `site:instagram.com (official OR contact OR booking OR WhatsApp) ${categoryOr} ${locationVariant.query}${extraPart} ${profileNoiseBlock}`
        },
        {
          label: `business profiles ${locationVariant.label}`,
          query: `site:instagram.com "Followers" ${categoryOr} ${locationVariant.query} (menu OR booking OR order OR services OR shop OR clinic OR studio OR store)${extraPart} ${profileNoiseBlock}`
        }
      );
    }

    return uniqueQueries(items);
  }

  if (angle === 'directory') {
    return [{
      label: 'directory',
      query: `${categoryPart} ${locationPart}${extraPart} (site:justdial.com OR site:sulekha.com OR site:indiamart.com OR site:yell.com OR site:tripadvisor.com OR site:zomato.com)`
    }];
  }

  return [{
    label: 'website',
    query: `${categoryPart} ${locationPart}${extraPart} (contact OR about OR services OR menu OR appointment OR address) -site:instagram.com -site:facebook.com -site:youtube.com -site:wikipedia.org`
  }];
}

function buildLocationBooleanPart(location) {
  const parts = String(location || '')
    .split(',')
    .map((part) => cleanText(part, 80))
    .filter(Boolean)
    .slice(0, 2);
  const selected = parts.length ? parts : [cleanText(location, 120)];
  return selected.map((part) => `"${part}"`).join(' ');
}

function buildLooseLocationParts(location) {
  return String(location || '')
    .split(',')
    .map((part) => cleanText(part, 80))
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
}

function buildLocationVariants(location) {
  const parts = String(location || '')
    .split(',')
    .map((part) => cleanText(part, 80))
    .filter(Boolean);
  const district = parts[0] || cleanText(location, 80);
  const region = parts[1] || '';
  const variants = new Set([`${district} ${region}`.trim()]);
  const lowerDistrict = district.toLowerCase();

  if (lowerDistrict.includes('thiruvananthapuram')) {
    variants.add(`Trivandrum ${region}`.trim());
    variants.add(`TVM ${region}`.trim());
  }
  if (lowerDistrict.includes('kochi')) {
    variants.add(`Cochin ${region}`.trim());
    variants.add(`Ernakulam ${region}`.trim());
  }
  if (lowerDistrict.includes('kozhikode')) variants.add(`Calicut ${region}`.trim());
  if (lowerDistrict.includes('alappuzha')) variants.add(`Alleppey ${region}`.trim());

  return [...variants].map((variant) => ({
    label: variant,
    query: variant
  }));
}

function buildCategoryOrPart(category) {
  const terms = categoryTerms(category);
  if (terms.length <= 1) return terms[0] || cleanText(category, 80);
  return `(${terms.map((term) => `"${term}"`).join(' OR ')})`;
}

function categoryTerms(category) {
  const raw = cleanText(category, 160).toLowerCase();
  const words = raw
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !['and', 'the', 'shop', 'store', 'studio', 'centre', 'center'].includes(part));

  const expansions = [];
  if (/cafe|coffee|restaurant|food|bakery|cake/i.test(raw)) expansions.push('cafe', 'coffee', 'restaurant', 'food', 'bakery', 'cakes');
  if (/salon|spa|beauty|makeup/i.test(raw)) expansions.push('salon', 'spa', 'beauty', 'makeup');
  if (/boutique|clothing|fashion|textile/i.test(raw)) expansions.push('boutique', 'clothing', 'fashion', 'textiles');
  if (/jewel/i.test(raw)) expansions.push('jewellery', 'jewelry', 'gold');
  if (/gym|fitness/i.test(raw)) expansions.push('gym', 'fitness', 'workout');
  if (/clinic|hospital|dental|doctor|ayur/i.test(raw)) expansions.push('clinic', 'doctor', 'hospital', 'ayurveda', 'dental');
  if (/wedding|event/i.test(raw)) expansions.push('wedding', 'events', 'planner');
  if (/photo/i.test(raw)) expansions.push('photography', 'photographer', 'studio');
  if (/real estate|property/i.test(raw)) expansions.push('real estate', 'property', 'realtor');
  if (/interior|furniture/i.test(raw)) expansions.push('interior', 'furniture', 'decor');

  return [...new Set([...words, ...expansions])].slice(0, 8);
}

function uniqueQueries(items) {
  const seen = new Set();
  const queries = [];
  for (const item of items) {
    const query = item.query.replace(/\s+/g, ' ').trim();
    if (!query || seen.has(query)) continue;
    seen.add(query);
    queries.push({ ...item, query });
  }
  return queries;
}

async function serpapiGoogleSearch(queryObject) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey || apiKey.length < 20) {
    const error = new Error('SERPAPI_API_KEY is not configured.');
    error.statusCode = 500;
    throw error;
  }

  const country = getCountry(queryObject.country_code);
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', queryObject.query);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('num', String(CONFIG.serpapiResultsPerQuery));
  if (queryObject.start) url.searchParams.set('start', String(queryObject.start));
  url.searchParams.set('hl', 'en');
  url.searchParams.set('gl', country.gl);
  url.searchParams.set('google_domain', country.google_domain);
  url.searchParams.set('safe', 'active');
  url.searchParams.set('no_cache', 'false');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.serpapiTimeoutMs);
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`SerpApi returned invalid JSON: ${text.slice(0, 180)}`);
  }

  if (!response.ok || data.error) {
    if (response.status === 401 || response.status === 403) throw new Error('SerpApi rejected the API key.');
    if (response.status === 429) throw new Error('SerpApi rate limit or monthly quota reached.');
    throw new Error(data.error ? `SerpApi error: ${cleanText(data.error, 300)}` : `SerpApi HTTP ${response.status}`);
  }

  const results = [];
  const seen = new Set();
  for (const item of data.organic_results || []) {
    addSerpResult(results, seen, item.link, item.title, item.snippet, queryObject.angle);
  }
  for (const place of data.local_results?.places || []) {
    addSerpResult(results, seen, place.website || place.links?.website, place.title || place.name, place.address, queryObject.angle);
    addSerpResult(results, seen, place.link, place.title || place.name, place.address, queryObject.angle);
  }
  addSerpResult(results, seen, data.knowledge_graph?.website, data.knowledge_graph?.title, data.knowledge_graph?.description, queryObject.angle);
  addSerpResult(results, seen, data.answer_box?.link, data.answer_box?.title, data.answer_box?.snippet, queryObject.angle);

  return results;
}

function addSerpResult(results, seen, rawUrl, title = '', snippet = '', angle = 'instagram') {
  const url = normalizeUrl(rawUrl);
  if (!isUsefulLeadUrl(url, angle)) return;
  const urlHash = hashUrl(url);
  if (seen.has(urlHash)) return;
  seen.add(urlHash);
  results.push({
    url,
    url_hash: urlHash,
    title: cleanText(title, 255),
    snippet: cleanText(snippet, 500)
  });
}

function normalizeUrl(rawUrl) {
  const input = cleanText(rawUrl, 1200);
  if (!input) return '';

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return '';
  }

  let host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return '';

  if (host === 'instagram.com') {
    const firstSegment = decodeURIComponent(parsed.pathname || '')
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)[0] || '';
    const username = firstSegment.replace(/^@/, '').toLowerCase();
    if (!username || INSTAGRAM_BLOCKED_SEGMENTS.has(username)) return '';
    if (!/^[a-z0-9._]{2,30}$/.test(username)) return '';
    return `https://instagram.com/${username}`;
  }

  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_|igsh|ref)/i.test(key)) parsed.searchParams.delete(key);
  }
  parsed.hostname = host;
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function isUsefulLeadUrl(url, angle) {
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (angle === 'instagram' && host !== 'instagram.com') return false;

  const blocked = [
    'google.', 'gstatic.', 'googleusercontent.', 'youtube.com', 'youtu.be',
    'wikipedia.org', 'wikimedia.org', 'linkedin.com', 'pinterest.', 'twitter.com',
    'x.com', 'reddit.com', 'quora.com', 'amazon.', 'flipkart.', 'medium.com',
    'apple.com', 'microsoft.com', 'support.google.com', 'maps.google.'
  ];
  if (blocked.some((item) => host.includes(item))) return false;
  return !/(\/search|\/preferences|\/setprefs|\/intl|\/sorry|\/accounts|\/url)\b/i.test(parsed.pathname);
}

function platformFromUrl(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes('instagram.com')) return 'Instagram';
  if (/(justdial|sulekha|indiamart|yell|tripadvisor|zomato|swiggy|magicpin)/i.test(host)) return 'Directory';
  return 'Website';
}

function businessNameFromResult(result) {
  const title = cleanText(result.title, 255)
    .replace(/\s*\(@[^)]*\)\s*/g, ' ')
    .replace(/\s*[-|•].*Instagram.*$/i, '')
    .replace(/\s*Instagram photos and videos\s*/i, '')
    .trim();
  if (title) return title;

  const parsed = new URL(result.url);
  if (parsed.hostname === 'instagram.com') {
    return parsed.pathname.replace(/\//g, '').replace(/[._]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) || 'Instagram business';
  }
  return parsed.hostname.replace(/^www\./, '').split('.')[0].replace(/[-_]/g, ' ');
}

function makeLeadReason(category, location, platform, snippet) {
  const base = platform === 'Instagram'
    ? `Likely ${category} Instagram profile around ${location}. Check bio, highlights, recent posting frequency, and contact options before pitching.`
    : `Potential local ${category} lead around ${location}. Check the site for contact details and social content gaps.`;
  return snippet ? `${base} Search note: ${cleanText(snippet, 260)}` : base;
}

function isRelevantInstagramLead(category, location, result) {
  const terms = categoryTerms(category);
  if (!terms.length) return true;
  const titleAndUrl = `${result.title || ''} ${result.url || ''}`.toLowerCase();
  const snippet = String(result.snippet || '').toLowerCase();
  const hasStrongCategorySignal = terms.some((term) => titleAndUrl.includes(term.toLowerCase()));
  if (hasStrongCategorySignal) return true;

  const hasSnippetCategorySignal = terms.some((term) => snippet.includes(term.toLowerCase()));
  if (!hasSnippetCategorySignal) return false;

  const locationSignals = buildLocationVariants(location)
    .flatMap((variant) => variant.query.split(/\s+/))
    .map((part) => part.toLowerCase())
    .filter((part) => part.length >= 3);
  return locationSignals.some((term) => snippet.includes(term));
}

function titleCase(value) {
  return String(value || '').replace(/\b\w/g, (char) => char.toUpperCase());
}

module.exports = {
  buildQueryObjects,
  serpapiGoogleSearch,
  platformFromUrl,
  businessNameFromResult,
  isRelevantInstagramLead,
  makeLeadReason
};
