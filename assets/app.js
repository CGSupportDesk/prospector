const DEFAULT_CATEGORIES = [
  'Bakery',
  'Restaurant',
  'Cafe',
  'Salon',
  'Spa',
  'Boutique',
  'Jewellery store',
  'Gym',
  'Ayurvedic clinic',
  'Dental clinic',
  'Interior designer',
  'Wedding planner',
  'Photography studio',
  'Real estate agency',
  'Coaching centre'
];

const LOCATION_PRESETS = {
  IN: {
    label: 'India',
    regions: {
      Kerala: [
        'Thiruvananthapuram',
        'Kochi',
        'Ernakulam',
        'Kozhikode',
        'Thrissur',
        'Kollam',
        'Alappuzha',
        'Kottayam',
        'Kannur',
        'Malappuram',
        'Palakkad',
        'Wayanad'
      ]
    }
  },
  GB: {
    label: 'UK',
    regions: {
      London: [
        'Central London',
        'East London',
        'West London',
        'North London',
        'South London',
        'Camden',
        'Hackney',
        'Islington',
        'Kensington',
        'Westminster',
        'Croydon',
        'Greenwich'
      ]
    }
  }
};

const selectedCategories = new Set(['Cafe']);
const selectedDistricts = new Set(['Kochi']);
const customLocations = new Set();
let selectedCountry = 'IN';
let latestRunId = null;

const els = {
  categoryGrid: document.getElementById('categoryGrid'),
  selectedCategories: document.getElementById('selectedCategories'),
  categoryCount: document.getElementById('categoryCount'),
  customCategory: document.getElementById('customCategory'),
  addCategoryBtn: document.getElementById('addCategoryBtn'),
  regionSelect: document.getElementById('regionSelect'),
  districtGrid: document.getElementById('districtGrid'),
  selectedLocations: document.getElementById('selectedLocations'),
  locationCount: document.getElementById('locationCount'),
  customLocation: document.getElementById('customLocation'),
  addLocationBtn: document.getElementById('addLocationBtn'),
  extraKeywords: document.getElementById('extraKeywords'),
  runBtn: document.getElementById('runBtn'),
  loadBtn: document.getElementById('loadBtn'),
  downloadCsvBtn: document.getElementById('downloadCsvBtn'),
  downloadAllCsvBtn: document.getElementById('downloadAllCsvBtn'),
  statusBox: document.getElementById('statusBox'),
  resultsBody: document.getElementById('resultsBody'),
  tableWrap: document.getElementById('tableWrap'),
  emptyState: document.getElementById('emptyState'),
  leadCount: document.getElementById('leadCount'),
  dbCount: document.getElementById('dbCount'),
  runMeta: document.getElementById('runMeta'),
  queryPanel: document.getElementById('queryPanel'),
  queryList: document.getElementById('queryList'),
  storageBadge: document.getElementById('storageBadge')
};

const apiBase = window.location.pathname.startsWith('/prospector') ? '/prospector/api' : 'api';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setStatus(message, type = 'ok') {
  els.statusBox.classList.remove('hidden', 'error', 'warn');
  els.statusBox.classList.toggle('error', type === 'error');
  els.statusBox.classList.toggle('warn', type === 'warn');
  els.statusBox.textContent = message;
}

function clearStatus() {
  els.statusBox.classList.add('hidden');
  els.statusBox.textContent = '';
}

function renderCategoryGrid() {
  els.categoryGrid.innerHTML = '';
  DEFAULT_CATEGORIES.forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = category;
    button.classList.toggle('active', selectedCategories.has(category));
    button.addEventListener('click', () => {
      toggleSet(selectedCategories, category);
      renderSelections();
      renderCategoryGrid();
    });
    els.categoryGrid.appendChild(button);
  });
}

function renderCountryOptions() {
  document.querySelectorAll('.country-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.country === selectedCountry);
  });
}

function renderRegions() {
  const preset = LOCATION_PRESETS[selectedCountry];
  const current = els.regionSelect.value;
  els.regionSelect.innerHTML = '';
  Object.keys(preset.regions).forEach((region) => {
    const option = document.createElement('option');
    option.value = region;
    option.textContent = region;
    els.regionSelect.appendChild(option);
  });
  if (current && preset.regions[current]) els.regionSelect.value = current;
}

function renderDistrictGrid() {
  const districts = LOCATION_PRESETS[selectedCountry].regions[els.regionSelect.value] || [];
  els.districtGrid.innerHTML = '';
  districts.forEach((district) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = district;
    button.classList.toggle('active', selectedDistricts.has(district));
    button.addEventListener('click', () => {
      toggleSet(selectedDistricts, district);
      renderSelections();
      renderDistrictGrid();
    });
    els.districtGrid.appendChild(button);
  });
}

function addCategory(value) {
  const category = value.trim();
  if (!category) return;
  selectedCategories.add(category);
  els.customCategory.value = '';
  renderSelections();
  renderCategoryGrid();
}

function addLocation(value) {
  const raw = value.trim();
  if (!raw) return;
  raw.split(',').map((item) => item.trim()).filter(Boolean).forEach((location) => customLocations.add(location));
  els.customLocation.value = '';
  renderSelections();
}

function renderSelections() {
  els.selectedCategories.innerHTML = '';
  selectedCategories.forEach((category) => {
    els.selectedCategories.appendChild(makeTag(category, () => {
      selectedCategories.delete(category);
      renderSelections();
      renderCategoryGrid();
    }));
  });

  els.selectedLocations.innerHTML = '';
  selectedDistricts.forEach((district) => {
    els.selectedLocations.appendChild(makeTag(district, () => {
      selectedDistricts.delete(district);
      renderSelections();
      renderDistrictGrid();
    }));
  });
  customLocations.forEach((location) => {
    els.selectedLocations.appendChild(makeTag(location, () => {
      customLocations.delete(location);
      renderSelections();
    }));
  });

  els.categoryCount.textContent = `${selectedCategories.size} selected`;
  els.locationCount.textContent = `${selectedDistricts.size + customLocations.size} selected`;
}

function makeTag(label, onRemove) {
  const tag = document.createElement('span');
  tag.className = 'tag';
  const text = document.createElement('span');
  text.textContent = label;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'x';
  remove.setAttribute('aria-label', `Remove ${label}`);
  remove.addEventListener('click', onRemove);
  tag.appendChild(text);
  tag.appendChild(remove);
  return tag;
}

function toggleSet(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function getAngles() {
  return Array.from(document.querySelectorAll('input[name="angle"]:checked')).map((input) => input.value);
}

function syncAngleStyles() {
  document.querySelectorAll('input[name="angle"]').forEach((input) => {
    input.closest('.angle').classList.toggle('checked', input.checked);
  });
}

function renderQueries(queries) {
  const list = Array.isArray(queries) ? queries : [];
  els.queryList.innerHTML = '';
  list.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'query-item';
    const query = document.createElement('code');
    query.textContent = item.query || '';
    const link = document.createElement('a');
    link.href = item.google_url || `https://www.google.com/search?q=${encodeURIComponent(item.query || '')}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open Google';
    row.appendChild(query);
    row.appendChild(link);
    els.queryList.appendChild(row);
  });
  els.queryPanel.classList.toggle('hidden', list.length === 0);
}

function renderLeads(leads, meta = {}) {
  els.resultsBody.innerHTML = '';
  const list = Array.isArray(leads) ? leads : [];

  list.forEach((lead) => {
    const platform = String(lead.platform || 'Website').toLowerCase();
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(formatDate(lead.generated_at || lead.generated_date || ''))}</td>
      <td><strong>${escapeHtml(lead.business_name || lead.name || 'Untitled')}</strong></td>
      <td><span class="platform ${escapeHtml(platform)}">${escapeHtml(lead.platform || 'Website')}</span></td>
      <td>${escapeHtml(lead.category || '')}</td>
      <td>${escapeHtml(lead.location || '')}</td>
      <td><a class="lead-link" href="${escapeHtml(lead.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(lead.url || '')}</a></td>
      <td>${escapeHtml(lead.reason || lead.snippet || '')}</td>
    `;
    els.resultsBody.appendChild(row);
  });

  els.leadCount.textContent = list.length;
  if (typeof meta.database_total !== 'undefined') els.dbCount.textContent = meta.database_total;

  els.tableWrap.classList.toggle('hidden', list.length === 0);
  els.emptyState.classList.toggle('hidden', list.length > 0);

  if (meta.run_id) {
    latestRunId = meta.run_id;
    els.downloadCsvBtn.href = `${apiBase}/export?run_id=${encodeURIComponent(latestRunId)}`;
    els.downloadCsvBtn.classList.remove('disabled');
  } else {
    latestRunId = null;
    els.downloadCsvBtn.href = '#';
    els.downloadCsvBtn.classList.add('disabled');
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    throw new Error(`Server returned invalid JSON. ${plain.slice(0, 180) || text.slice(0, 180)}`);
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.message || `Request failed with ${response.status}`);
  }
  return data;
}

async function runSearch() {
  const categories = Array.from(selectedCategories);
  const districts = Array.from(selectedDistricts);
  const custom_locations = Array.from(customLocations);
  const angles = getAngles();

  if (!categories.length) return setStatus('Select at least one business category.', 'error');
  if (!districts.length && !custom_locations.length) return setStatus('Select at least one district or add a custom place.', 'error');
  if (!angles.length) return setStatus('Select at least one source angle.', 'error');

  els.runBtn.disabled = true;
  els.runBtn.textContent = 'Scraping...';
  setStatus('Building Google Boolean queries, calling SerpApi, normalizing profile URLs, and skipping URLs already saved.', 'warn');

  try {
    const data = await requestJson(`${apiBase}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_count: 50,
        country: selectedCountry,
        region: els.regionSelect.value,
        districts,
        custom_locations,
        categories,
        angles,
        extra_keywords: els.extraKeywords.value.trim()
      })
    });

    renderLeads(data.leads, data);
    renderQueries(data.queries);
    els.runMeta.textContent = `Run ${data.run_id || ''}: ${data.generated_count || 0} new unique URL(s), ${data.duplicate_count || 0} duplicate(s), ${data.raw_url_count || 0} raw URL(s), ${data.queries_run || 0} Boolean search(es).`;
    setStatus(data.message || `Scraped ${data.generated_count || 0} URLs.`, (data.generated_count || 0) >= 50 ? 'ok' : 'warn');
    if (Array.isArray(data.errors) && data.errors.length) {
      console.warn('Prospector search notes:', data.errors);
    }
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    els.runBtn.disabled = false;
    els.runBtn.textContent = 'Scrape 50 URLs';
  }
}

async function loadSavedLeads() {
  clearStatus();
  els.loadBtn.disabled = true;
  try {
    const data = await requestJson(`${apiBase}/leads?limit=100`);
    renderLeads(data.leads, data);
    renderQueries([]);
    els.runMeta.textContent = 'Showing latest saved leads.';
    setStatus(`Loaded ${data.leads.length} saved leads.`, 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    els.loadBtn.disabled = false;
  }
}

async function loadHealth() {
  try {
    const data = await requestJson(`${apiBase}/health`);
    const support = data.support || {};
    els.storageBadge.textContent = support.persistent_storage
      ? `${support.storage_mode} duplicate protection`
      : 'Local storage only';
    if (!support.persistent_storage) {
      els.storageBadge.classList.add('warn-badge');
    }
    if (typeof support.database_total !== 'undefined') els.dbCount.textContent = support.database_total;
  } catch (error) {
    els.storageBadge.textContent = 'Server needs config';
    els.storageBadge.classList.add('warn-badge');
    setStatus(error.message, 'warn');
  }
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function switchCountry(country) {
  selectedCountry = country;
  selectedDistricts.clear();
  customLocations.clear();
  if (country === 'GB') selectedDistricts.add('Central London');
  else selectedDistricts.add('Kochi');
  renderCountryOptions();
  renderRegions();
  renderDistrictGrid();
  renderSelections();
}

els.addCategoryBtn.addEventListener('click', () => addCategory(els.customCategory.value));
els.customCategory.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addCategory(els.customCategory.value);
  }
});

els.addLocationBtn.addEventListener('click', () => addLocation(els.customLocation.value));
els.customLocation.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addLocation(els.customLocation.value);
  }
});

document.querySelectorAll('.country-option').forEach((button) => {
  button.addEventListener('click', () => switchCountry(button.dataset.country));
});

els.regionSelect.addEventListener('change', () => {
  selectedDistricts.clear();
  renderDistrictGrid();
  renderSelections();
});

document.querySelectorAll('input[name="angle"]').forEach((input) => {
  input.addEventListener('change', syncAngleStyles);
});

els.downloadCsvBtn.addEventListener('click', (event) => {
  if (els.downloadCsvBtn.classList.contains('disabled')) {
    event.preventDefault();
    setStatus('Generate leads first, then download the current run CSV. Use Download all CSV to export the full saved database.', 'warn');
  }
});

els.downloadAllCsvBtn.href = `${apiBase}/export`;
els.runBtn.addEventListener('click', runSearch);
els.loadBtn.addEventListener('click', loadSavedLeads);

renderCategoryGrid();
renderRegions();
renderDistrictGrid();
renderCountryOptions();
renderSelections();
syncAngleStyles();
loadHealth();

