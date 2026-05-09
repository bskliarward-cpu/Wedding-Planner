const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let venues          = [];
let currentFilter   = 'all';
let currentSort     = 'created_at_desc';
let editingId       = null;
let selectedRating  = 0;
let activePriceType = 'fixed';
let editingRooms    = [];

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
    .select('*, venue_rooms(*)')
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
      case 'price_asc':   return (effectiveMinPrice(a) || 0) - (effectiveMinPrice(b) || 0);
      case 'price_desc':  return (effectiveMinPrice(b) || 0) - (effectiveMinPrice(a) || 0);
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

function effectiveMinPrice(v) {
  const rooms = v.venue_rooms || [];
  if (rooms.length) {
    const mins = rooms.filter(r => r.price_min).map(r => r.price_min);
    return mins.length ? Math.min(...mins) : null;
  }
  return v.price_min;
}

function venueCard(v) {
  const filled = '★'.repeat(v.rating || 0);
  const empty  = '☆'.repeat(5 - (v.rating || 0));
  const stars  = v.rating
    ? `<span style="color:var(--accent)">${filled}</span><span style="color:#d9d0c0">${empty}</span>`
    : '—';

  const rooms = v.venue_rooms || [];
  let capacityDisplay, priceDisplay;

  if (rooms.length) {
    const caps  = rooms.filter(r => r.capacity).map(r => r.capacity);
    const label = rooms.length === 1 && rooms[0].name ? esc(rooms[0].name) : `${rooms.length} room${rooms.length > 1 ? 's' : ''}`;
    capacityDisplay = caps.length ? `${label} · up to ${Math.max(...caps).toLocaleString()}` : label;

    const mins  = rooms.filter(r => r.price_min).map(r => r.price_min);
    const maxes = rooms.map(r => r.price_max || r.price_min).filter(Boolean);
    const anyPP = rooms.some(r => r.price_type === 'per_person');
    priceDisplay = mins.length
      ? fmtPrice(Math.min(...mins), maxes.length ? Math.max(...maxes) : null, anyPP ? 'per_person' : 'fixed')
      : '—';
  } else {
    capacityDisplay = v.capacity ? v.capacity.toLocaleString() + ' guests' : '—';
    priceDisplay    = fmtPrice(v.price_min, v.price_max, v.price_type);
  }

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
            <span class="meta-label">${rooms.length ? 'Spaces' : 'Capacity'}</span>
            <span class="meta-value">${capacityDisplay}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Price</span>
            <span class="meta-value">${priceDisplay}</span>
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

function fmtPrice(min, max, type) {
  if (!min && !max) return '—';
  const pp = type === 'per_person' ? ' pp' : '';
  const lo = `£${Number(min).toLocaleString()}`;
  const hi = max && max !== min ? `£${Number(max).toLocaleString()}` : null;
  return hi ? `${lo}–${hi}${pp}` : `${lo}${pp}`;
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
  editingRooms = [];
  document.getElementById('modal-title').textContent = 'Add Venue';
  document.getElementById('venue-form').reset();
  document.getElementById('f-fetch-url').value = '';
  document.getElementById('fetch-status').className = 'fetch-status hidden';
  setImageField('');
  paintStars(0);
  setPriceType('fixed');
  renderRooms();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('f-fetch-url').focus();
}

function openEdit(id) {
  const v = venues.find(v => v.id === id);
  if (!v) return;

  editingId      = id;
  selectedRating = v.rating || 0;
  editingRooms   = (v.venue_rooms || []).map(r => ({ ...r }));

  document.getElementById('modal-title').textContent = 'Edit Venue';
  document.getElementById('f-fetch-url').value = '';
  document.getElementById('fetch-status').className = 'fetch-status hidden';
  setImageField(v.image_url || '');
  document.getElementById('f-name').value      = v.name        || '';
  document.getElementById('f-location').value  = v.location    || '';
  document.getElementById('f-website').value   = v.website_url || '';
  document.getElementById('f-capacity').value  = v.capacity    || '';
  document.getElementById('f-price-min').value = v.price_min   || '';
  document.getElementById('f-price-max').value = v.price_max   || '';
  document.getElementById('f-status').value    = v.status      || 'considering';
  document.getElementById('f-notes').value     = v.notes       || '';
  setPriceType(v.price_type || 'fixed');
  paintStars(selectedRating);
  renderRooms();

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('f-name').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  editingId = null;
}

function setPriceType(type) {
  activePriceType = type;
  document.querySelectorAll('.price-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  const pp = type === 'per_person';
  document.getElementById('lbl-price-min').textContent = pp ? 'Per person from (£)' : 'From (£)';
  document.getElementById('lbl-price-max').textContent = pp ? 'Per person to (£)' : 'To (£)';
}

// ── ROOMS ─────────────────────────────────────────────────────────────────────

function renderRooms() {
  const list = document.getElementById('rooms-list');

  if (!editingRooms.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = editingRooms.map((room, i) => `
    <div class="room-row" data-idx="${i}">
      <div class="room-fields">
        <input type="text" class="room-name" placeholder="Room name (e.g. Great Hall)" value="${esc(room.name || '')}">
        <div class="room-row-2">
          <input type="number" class="room-capacity" placeholder="Capacity" min="1" value="${room.capacity || ''}">
          <div class="room-prices">
            <input type="number" class="room-price-min" placeholder="From £" min="0" value="${room.price_min || ''}">
            <input type="number" class="room-price-max" placeholder="To £" min="0" value="${room.price_max || ''}">
            <label class="room-pp-label">
              <input type="checkbox" class="room-pp" ${room.price_type === 'per_person' ? 'checked' : ''}>
              <span>pp</span>
            </label>
          </div>
        </div>
      </div>
      <button type="button" class="btn-icon danger room-delete" data-idx="${i}">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.room-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      editingRooms.splice(parseInt(btn.dataset.idx), 1);
      renderRooms();
    });
  });

  list.querySelectorAll('.room-row').forEach(row => {
    const idx = parseInt(row.dataset.idx);
    const sync = () => {
      editingRooms[idx] = {
        ...editingRooms[idx],
        name:       row.querySelector('.room-name').value,
        capacity:   parseInt(row.querySelector('.room-capacity').value)   || null,
        price_min:  parseInt(row.querySelector('.room-price-min').value)  || null,
        price_max:  parseInt(row.querySelector('.room-price-max').value)  || null,
        price_type: row.querySelector('.room-pp').checked ? 'per_person' : 'fixed',
      };
    };
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', sync));
    row.querySelectorAll('input[type="checkbox"]').forEach(inp => inp.addEventListener('change', sync));
  });
}

function addRoom() {
  editingRooms.push({ name: '', capacity: null, price_min: null, price_max: null, price_type: 'fixed' });
  renderRooms();
  const rows = document.querySelectorAll('.room-row');
  if (rows.length) rows[rows.length - 1].querySelector('.room-name').focus();
}

// ── SAVE / DELETE ─────────────────────────────────────────────────────────────

async function saveVenue(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const payload = {
    name:        document.getElementById('f-name').value.trim(),
    location:    document.getElementById('f-location').value.trim()  || null,
    website_url: document.getElementById('f-website').value.trim()   || null,
    capacity:    parseInt(document.getElementById('f-capacity').value)  || null,
    price_min:   parseInt(document.getElementById('f-price-min').value) || null,
    price_max:   parseInt(document.getElementById('f-price-max').value) || null,
    price_type:  activePriceType,
    status:      document.getElementById('f-status').value,
    rating:      selectedRating || null,
    notes:       document.getElementById('f-notes').value.trim()     || null,
    image_url:   document.getElementById('f-image-url').value.trim() || null,
    updated_at:  new Date().toISOString(),
  };

  let venueId = editingId;
  let error;

  if (editingId) {
    ({ error } = await client.from('venues').update(payload).eq('id', editingId));
  } else {
    const { data: { user } } = await client.auth.getUser();
    let data;
    ({ data, error } = await client
      .from('venues')
      .insert([{ ...payload, added_by: user.id }])
      .select('id')
      .single());
    if (!error && data) venueId = data.id;
  }

  if (error) {
    btn.disabled = false;
    btn.textContent = 'Save venue';
    toast(`Could not save venue — ${error.message}`);
    console.error(error);
    return;
  }

  if (venueId) await saveRooms(venueId);

  btn.disabled = false;
  btn.textContent = 'Save venue';
  closeModal();
  toast(editingId ? 'Venue updated.' : 'Venue added.');
  loadVenues();
}

async function saveRooms(venueId) {
  await client.from('venue_rooms').delete().eq('venue_id', venueId);
  const valid = editingRooms.filter(r => r.name?.trim());
  if (!valid.length) return;
  await client.from('venue_rooms').insert(valid.map(r => ({
    venue_id:   venueId,
    name:       r.name.trim(),
    capacity:   r.capacity  || null,
    price_min:  r.price_min || null,
    price_max:  r.price_max || null,
    price_type: r.price_type || 'fixed',
  })));
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
    name: meta('og:title') || meta('twitter:title') || doc.title || '',
    notes: meta('og:description') || meta('description') || meta('twitter:description') || '',
    image: meta('og:image') || meta('twitter:image') || '',
    location: '', capacity: '', priceMin: '', priceMax: '',
  };

  doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try {
      [].concat(JSON.parse(s.textContent)).forEach(item => {
        [].concat(item['@graph'] || item).forEach(node => {
          if (!node || typeof node !== 'object') return;
          if (!raw.location && node.address) {
            const a = node.address;
            raw.location = typeof a === 'string'
              ? a : [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(', ');
          }
          if (!raw.capacity && node.maximumAttendeeCapacity)
            raw.capacity = String(node.maximumAttendeeCapacity);
          if (!raw.priceMin && node.priceRange) {
            const nums = node.priceRange.replace(/,/g, '').match(/\d+/g);
            if (nums) { raw.priceMin = nums[0]; raw.priceMax = nums[1] || ''; }
          }
          if (!raw.name  && node.name)  raw.name = node.name;
          if (!raw.image && node.image) {
            raw.image = typeof node.image === 'string' ? node.image
              : (node.image.url || node.image[0]?.url || '');
          }
        });
      });
    } catch (_) {}
  });

  raw.name = raw.name.replace(/\s*[|·—–-]\s*.{0,50}$/, '').trim();
  if (raw.image && !raw.image.startsWith('http')) {
    try { raw.image = new URL(raw.image, url).href; } catch (_) { raw.image = ''; }
  }

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

  if (raw.image && !document.getElementById('f-image-url').value) {
    setImageField(raw.image);
    filled++;
  }

  statusEl.className = filled === 0 ? 'fetch-status partial' : 'fetch-status success';
  statusEl.textContent = filled === 0
    ? 'Page loaded but not much could be extracted — fill in manually.'
    : `Filled in ${filled} field${filled > 1 ? 's' : ''}${raw.image ? ' (including a photo)' : ''} — check and adjust as needed.`;

  btn.disabled = false;
  btn.textContent = 'Fill in';
}

// ── EVENTS ────────────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('btn-add').addEventListener('click', openAdd);
  document.getElementById('btn-fetch').addEventListener('click', fetchVenueDetails);
  document.getElementById('btn-add-room').addEventListener('click', addRoom);
  document.getElementById('btn-clear-image').addEventListener('click', () => setImageField(''));
  document.getElementById('f-image-url').addEventListener('input', e => setImageField(e.target.value.trim()));
  document.getElementById('f-fetch-url').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); fetchVenueDetails(); }
  });
  document.getElementById('venue-form').addEventListener('submit', saveVenue);
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.querySelectorAll('.price-type-btn').forEach(btn => {
    btn.addEventListener('click', () => setPriceType(btn.dataset.type));
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

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

// ── IMAGE FIELD ───────────────────────────────────────────────────────────────

function setImageField(url) {
  const input   = document.getElementById('f-image-url');
  const wrap    = document.getElementById('image-preview-wrap');
  const preview = document.getElementById('image-preview');
  input.value = url;
  if (url) {
    preview.src = url;
    wrap.classList.remove('hidden');
  } else {
    preview.src = '';
    wrap.classList.add('hidden');
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
