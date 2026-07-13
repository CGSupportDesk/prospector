const COUNTRIES = {
  IN: {
    name: 'India',
    gl: 'in',
    google_domain: 'google.co.in'
  },
  GB: {
    name: 'United Kingdom',
    gl: 'uk',
    google_domain: 'google.co.uk'
  }
};

const CONFIG = {
  targetLeadsPerRun: 50,
  maxQueriesPerRun: 60,
  serpapiResultsPerQuery: 20,
  serpapiStartOffsets: [0, 20, 40],
  serpapiTimeoutMs: 30000,
  timezone: 'Asia/Kolkata'
};

function getCountry(code) {
  return COUNTRIES[String(code || 'IN').toUpperCase()] || COUNTRIES.IN;
}

function getStorageMode() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return 'kv';
  if (process.env.POSTGRES_URL || process.env.DATABASE_URL) return 'postgres';
  return 'file';
}

module.exports = {
  CONFIG,
  COUNTRIES,
  getCountry,
  getStorageMode
};
