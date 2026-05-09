const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let venues         = [];
let currentFilter  = 'all';
let currentSort    = 'created_at_desc';
let editingId      = null;
let selectedRating = 0;
let fetchedImage   = null;

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  document.getElementById('user-email').textContent = session.user.email;
  await loadVenues();
  bindEvents();
  bindStars();
}

// ── DATA ──────────────────────────────────────────────────────────────────────

async function loadVenues() {
  const { data, error } = await client
    .from('venues')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  venues = data || [];
  renderVenues();
  updateCounts();
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function renderVenues() {
  const grid = document.getElementById('venues-grid');

  let list = currentFilter === 'all'
    ? [...venues]
    : venues.filter(v => v.status === currentFilter);

  list.sort((a, b) => {
    switch (currentSort) {
      case 'name_asc':    return a.name.localeCompare(b.name);
      case 'rating_desc': return (b.rating || 0) - (a.rating || 0);
      case 'price_asc':   return (a.price_min || 0) - (b.price_min || 0);
      case 'price_desc':  return (b.price_min || 0) - (a.price_min || 0);
      default:            return new Date(b.created_at) - new Date(a.created_at);
    }
  });

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>${currentFilter === 'all' ? 'No venues yet' : 'No venues here'}</h3>
        <p>${currentFilter === 'all' ? 'Add your first venue to get started.' : 'Try a different filter.'}</p>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(venueCard).join('');
}

function venueCard(v) {
  const filled = '★'.repeat(v.rating || 0);
  const empty  = '☆'.repeat(5 - (v.rating || 0));
  const stars  = v.rating
    ? `<span style="color:var(--accent)">${filled}</span><span style="color:#d9d0c0">${empty}</span>`
    : '—';

  const price = (v.price_min || v.price_max)
    ? `£${(v.price_min || '?').toLocaleString()}${v.price_max ? '–£' + v.price_max.toLocaleString() : '+'}`
    : '—';

  const capacity = v.capacity ? v.capacity.toLocaleString() + ' guests' : '—';

  const imageUrl = v.image_url
    || (v.website_url ? `https://image.thum.io/get/width/600/crop/400/noanimate/${v.website_url}` : null);
  const imageBanner = imageUrl
    ? `<div class="venue-image" style="background-image:url('${esc(imageUrl)}')"></div>`
    : '';

  let domainHtml = '';
  if (v.website_url) {
    const domain = parseDomain(v.website_url);
    domainHtml = `
      <a href="${esc(v.website_url)}" class="venue-website" target="_blank" rel="noopener" onclick="event.stopPropagation()">
        <img src="https://www.google.com/s2/favicons?domain=${domain}&sz=16" width="14" height="14"
             style="vertical-align:middle;border-radius:2px" onerror="this.style.display='none'">
        ${esc(domain)}
      </a>`;
  }

  return `
    <div class="venue-card" onclick="openEdit('${v.id}')">
      ${imageBanner}
      <div class="venue-card-header">
        <div class="venue-card-top">
          <div class="venue-name">${esc(v.name)}</div>
          <span class="status-badge status-${v.status}">${v.status}</span>
        </div>
        ${v.location ? `<div class="venue-location">${esc(v.location)}</div>` : ''}
      </div>
      <div class="venue-card-body">
        <div class="venue-meta">
          <div class="meta-item">
            <span class="meta-label">Capacity</span>
            <span class="meta-value">${capacity}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Price</span>
            <span class="meta-value">${price}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Rating</span>
            <span class="meta-value">${stars}</span>
          </div>
        </div>
        ${v.notes ? `<div class="venue-notes">${esc(v.notes)}</div>` : ''}
      </div>
      <div class="venue-card-footer">
        ${domainHtml || '<span></span>'}
        <div class="card-actions" onclick="event.stopPropagation()">
          <button class="btn-icon" onclick="openEdit('${v.id}')">Edit</button>
          <button class="btn-icon danger" onclick="confirmDelete('${v.id}', '${esc(v.name).replace(/'/g, "\\'")}')">Delete</button>
        </div>
      </div>
    </div>`;
}

function updateCounts() {
  document.getElementById('count-all').textContent         = venues.length;
  document.getElementById('count-considering').textContent = venues.filter(v => v.status === 'considering').length;
  document.getElementById('count-shortlisted').textContent = venues.filter(v => v.status === 'shortlisted').length;
  document.getElementById('count-rejected').textContent    = venues.filter(v => v.status === 'rejected').length;
}

// ── MODAL ─────────────────────────────────────────────────────────────────────

function openAdd() {
  editingId = null;
  selectedRating = 0;
  fetchedImage = null;
  document.getElementById('modal-title').textContent = 'Add Venue';
  document.getElementById('venue-form').reset();
  document.getElementById('f-fetch-url').value = '';
  document.getElementById('fetch-status').className = 'fetch-status hidden';
  paintStars(0);
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('f-fetch-url').focus();
}

function openEdit(id) {
  const v = venues.find(v => v.id === id);
  if (!v) return;

  editingId = id;
  selectedRating = v.rating || 0;
  fetchedImage = v.image_url || null;

  document.getElementById('modal-title').textContent = 'Edit Venue';
  document.getElementById('f-fetch-url').value = '';
  document.getElementById('fetch-status').className = 'fetch-status hidden';
  document.getElementById('f-name').value      = v.name        || '';
  document.getElementById('f-location').value  = v.location    || '';
  document.getElementById('f-website').value   = v.website_url || '';
  document.getElementById('f-capacity').value  = v.capacity    || '';
  document.getElementById('f-price-min').value = v.price_min   || '';
  document.getElementById('f-price-max').value = v.price_max   || '';
  document.getElementById('f-status').value    = v.status      || 'considering';
  document.getElementById('f-notes').value     = v.notes       || '';
  paintStars(selectedRating);

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('f-name').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  fetchedImage = null;
  editingId = null;
}

// ── SAVE / DELETE ─────────────────────────────────────────────────────────────

async function saveVenue(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const payload = {
    name:        document.getElementById('f-name').value.trim(),
    location:    document.getElementById('f-location').value.trim()   || null,
    website_url: document.getElementById('f-website').value.trim()    || null,
    capacity:    parseInt(document.getElementById('f-capacity').value)   || null,
    price_min:   parseInt(document.getElementById('f-price-min').value)  || null,
    price_max:   parseInt(document.getElementById('f-price-max').value)  || null,
    status:      document.getElementById('f-status').value,
    rating:      selectedRating || null,
    notes:       document.getElementById('f-notes').value.trim()      || null,
    image_url:   fetchedImage || null,
    updated_at:  new Date().toISOString(),
  };

  let error;
  if (editingId) {
    ({ error } = await client.from('venues').update(payload).eq('id', editingId));
  } else {
    const { data: { user } } = await client.auth.getUser();
    ({ error } = await client.from('venues').insert([{ ...payload, added_by: user.id }]));
  }

  btn.disabled = false;
  btn.textContent = 'Save venue';

  if (error) {
    toast(`Could not save venue — ${error.message}`);
    console.error(error);
  } else {
    closeModal();
    toast(editingId ? 'Venue updated.' : 'Venue added.');
    loadVenues();
  }
}

async function confirmDelete(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  const { error } = await client.from('venues').delete().eq('id', id);
  if (error) toast('Could not delete venue.');
  else { toast('Venue deleted.'); loadVenues(); }
}

// ── STARS ─────────────────────────────────────────────────────────────────────

function bindStars() {
  const btns = document.querySelectorAll('.star-btn');
  btns.forEach(btn => {
    const n = parseInt(btn.dataset.star);
    btn.addEventListener('click', () => {
      selectedRating = selectedRating === n ? 0 : n;
      paintStars(selectedRating);
    });
    btn.addEventListener('mouseenter', () => paintStars(n));
  });
  document.getElementById('star-input')
    .addEventListener('mouseleave', () => paintStars(selectedRating));
}

function paintStars(n) {
  document.querySelectorAll('.star-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.star) <= n);
  });
}

// ── URL FETCH ────────────────────────────────────────────────────────────────

async function fetchVenueDetails() {
  const urlInput = document.getElementById('f-fetch-url');
  const statusEl = document.getElementById('fetch-status');
  const btn      = document.getElementById('btn-fetch');
  const url      = urlInput.value.trim();
  if (!url) return;

  btn.disabled = true;
  btn.textContent = 'Fetching…';
  statusEl.className = 'fetch-status loading';
  statusEl.textContent = 'Fetching page…';
  statusEl.classList.remove('hidden');

  // Try two CORS proxies in sequence
  const proxies = [
    () => fetch(`https://corsproxy.io/?url=${encodeURIComponent(url)}`).then(r => { if (!r.ok) throw new Error(); return r.text(); }),
    () => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`).then(r => { if (!r.ok) throw new Error(); return r.text(); }),
  ];

  let html = null;
  for (const attempt of proxies) {
    try { html = await attempt(); break; } catch (_) {}
  }

  if (!html) {
    statusEl.className = 'fetch-status error';
    statusEl.textContent = 'Could not reach that page — check the URL or fill in manually.';
    btn.disabled = false;
    btn.textContent = 'Fill in';
    return;
  }

  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const meta = (prop) =>
    doc.querySelector(`meta[property="${prop}"]`)?.content ||
    doc.querySelector(`meta[name="${prop}"]`)?.content || '';

  const raw = {
    name:     meta('og:title') || meta('twitter:title') || doc.title || '',
    notes:    meta('og:description') || meta('description') || meta('twitter:description') || '',
    image:    meta('og:image') || meta('twitter:image') || '',
    location: '',
    capacity: '',
    priceMin: '',
    priceMax: '',
  };

  // JSON-LD structured data — the richest source
  doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try {
      [].concat(JSON.parse(s.textContent)).forEach(item => {
        [].concat(item['@graph'] || item).forEach(node => {
          if (!node || typeof node !== 'object') return;

          if (!raw.location && node.address) {
            const a = node.address;
            raw.location = typeof a === 'string'
              ? a
              : [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
                  .filter(Boolean).join(', ');
          }
          if (!raw.capacity && node.maximumAttendeeCapacity)
            raw.capacity = String(node.maximumAttendeeCapacity);

          if (!raw.priceMin && node.priceRange) {
            const nums = node.priceRange.replace(/,/g, '').match(/\d+/g);
            if (nums) { raw.priceMin = nums[0]; raw.priceMax = nums[1] || ''; }
          }
          if (!raw.name && node.name) raw.name = node.name;
          if (!raw.image && node.image) {
            raw.image = typeof node.image === 'string' ? node.image
              : (node.image.url || node.image[0]?.url || '');
          }
        });
      });
    } catch (_) {}
  });

  // Strip site-name suffix from title
  raw.name = raw.name.replace(/\s*[|·—–-]\s*.{0,50}$/, '').trim();

  // Make relative image URLs absolute
  if (raw.image && !raw.image.startsWith('http')) {
    try { raw.image = new URL(raw.image, url).href; } catch (_) { raw.image = ''; }
  }

  // Populate empty fields only
  let filled = 0;
  const fill = (id, value) => {
    if (!value) return;
    const el = document.getElementById(id);
    if (!el.value) { el.value = value; filled++; }
  };

  fill('f-name',      raw.name);
  fill('f-location',  raw.location);
  fill('f-notes',     raw.notes);
  fill('f-capacity',  raw.capacity);
  fill('f-price-min', raw.priceMin);
  fill('f-price-max', raw.priceMax);

  const websiteEl = document.getElementById('f-website');
  if (!websiteEl.value) { websiteEl.value = url; filled++; }

  if (raw.image && !fetchedImage) {
    fetchedImage = raw.image;
    filled++;
  }

  if (filled === 0) {
    statusEl.className = 'fetch-status partial';
    statusEl.textContent = 'Page loaded but not much could be extracted — fill in manually.';
  } else {
    const imgNote = raw.image ? ' (including a photo)' : '';
    statusEl.className = 'fetch-status success';
    statusEl.textContent = `Filled in ${filled} field${filled > 1 ? 's' : ''}${imgNote} — check and adjust as needed.`;
  }

  btn.disabled = false;
  btn.textContent = 'Fill in';
}

// ── EVENTS ────────────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('btn-add').addEventListener('click', openAdd);
  document.getElementById('btn-fetch').addEventListener('click', fetchVenueDetails);
  document.getElementById('f-fetch-url').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); fetchVenueDetails(); }
  });
  document.getElementById('venue-form').addEventListener('submit', saveVenue);
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderVenues();
    });
  });

  document.getElementById('sort-select').addEventListener('change', e => {
    currentSort = e.target.value;
    renderVenues();
  });

  document.getElementById('btn-signout').addEventListener('click', async () => {
    await client.auth.signOut();
    window.location.href = 'index.html';
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── GO ────────────────────────────────────────────────────────────────────────

init();
