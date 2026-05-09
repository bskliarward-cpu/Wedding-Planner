const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let items         = [];
let activeType    = 'image';
let selectedColor = '#fef9ec';
let fetchedImgUrl = '';

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  document.getElementById('user-email').textContent = session.user.email;
  await loadItems();
  bindEvents();
}

// ── DATA ──────────────────────────────────────────────────────────────────────

async function loadItems() {
  const { data, error } = await client
    .from('mood_items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  items = data || [];
  renderItems();
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function renderItems() {
  const grid = document.getElementById('mood-grid');
  if (items.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>Nothing here yet</h3>
        <p>Add images, notes, and websites for inspiration.</p>
      </div>`;
    return;
  }
  grid.innerHTML = items.map(renderCard).join('');
}

function renderCard(item) {
  if (item.type === 'image') {
    return `
      <div class="mood-card mood-card-image" data-id="${item.id}">
        <img src="${esc(item.image_url)}" alt="${esc(item.title || '')}" loading="lazy"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="mood-img-error">Could not load image</div>
        ${item.title ? `<div class="mood-card-caption">${esc(item.title)}</div>` : ''}
        <button class="mood-delete" onclick="deleteItem('${item.id}',event)" title="Remove">&times;</button>
      </div>`;
  }
  if (item.type === 'note') {
    return `
      <div class="mood-card mood-card-note" style="background:${esc(item.color || '#fef9ec')}" data-id="${item.id}">
        <div class="mood-note-text">${esc(item.content).replace(/\n/g, '<br>')}</div>
        <button class="mood-delete" onclick="deleteItem('${item.id}',event)" title="Remove">&times;</button>
      </div>`;
  }
  if (item.type === 'link') {
    let domain = item.content;
    try { domain = new URL(item.content).hostname.replace(/^www\./, ''); } catch {}
    return `
      <div class="mood-card mood-card-link" data-id="${item.id}" onclick="window.open('${esc(item.content)}','_blank')">
        ${item.image_url ? `<img src="${esc(item.image_url)}" alt="${esc(item.title || '')}" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="mood-link-body">
          ${item.title ? `<div class="mood-link-title">${esc(item.title)}</div>` : ''}
          <div class="mood-link-domain">${esc(domain)}</div>
        </div>
        <button class="mood-delete" onclick="deleteItem('${item.id}',event)" title="Remove">&times;</button>
      </div>`;
  }
  return '';
}

// ── SAVE / DELETE ─────────────────────────────────────────────────────────────

async function saveItem() {
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  let payload = { type: activeType };

  if (activeType === 'image') {
    const url = document.getElementById('f-image-url').value.trim();
    if (!url) { toast('Please enter an image URL.'); reset(btn); return; }
    payload.image_url = url;
    payload.title = document.getElementById('f-image-caption').value.trim() || null;

  } else if (activeType === 'note') {
    const text = document.getElementById('f-note-text').value.trim();
    if (!text) { toast('Please write something.'); reset(btn); return; }
    payload.content = text;
    payload.color   = selectedColor;

  } else if (activeType === 'link') {
    const url = document.getElementById('f-link-url').value.trim();
    if (!url) { toast('Please enter a URL.'); reset(btn); return; }
    payload.content   = url;
    payload.title     = document.getElementById('f-link-title').value.trim() || null;
    payload.image_url = fetchedImgUrl || null;
  }

  const { error } = await client.from('mood_items').insert([payload]);
  reset(btn);
  if (error) { toast('Could not save — ' + error.message); return; }
  closeModal();
  toast('Added to mood board.');
  loadItems();
}

function reset(btn) {
  btn.disabled = false;
  btn.textContent = 'Add to board';
}

async function deleteItem(id, e) {
  e.stopPropagation();
  if (!confirm('Remove this from the mood board?')) return;
  const { error } = await client.from('mood_items').delete().eq('id', id);
  if (error) { toast('Could not remove.'); return; }
  toast('Removed.');
  loadItems();
}

// ── LINK FETCH ────────────────────────────────────────────────────────────────

async function fetchLink() {
  const url = document.getElementById('f-link-url').value.trim();
  if (!url) return;
  const btn = document.getElementById('btn-fetch-link');
  btn.textContent = 'Fetching…';
  btn.disabled = true;
  fetchedImgUrl = '';

  const proxies = [
    () => fetch(`https://corsproxy.io/?url=${encodeURIComponent(url)}`).then(r => { if (!r.ok) throw new Error(); return r.text(); }),
    () => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`).then(r => { if (!r.ok) throw new Error(); return r.text(); }),
  ];

  let html = null;
  for (const proxy of proxies) { try { html = await proxy(); break; } catch {} }

  btn.textContent = 'Fetch';
  btn.disabled = false;

  if (!html) { toast('Could not fetch that page.'); return; }

  const doc   = new DOMParser().parseFromString(html, 'text/html');
  const meta  = prop => doc.querySelector(`meta[property="${prop}"]`)?.content
                      || doc.querySelector(`meta[name="${prop}"]`)?.content || '';

  const title = meta('og:title') || doc.title || '';
  const image = meta('og:image') || '';

  document.getElementById('f-link-title').value = title;
  fetchedImgUrl = image;

  if (image) {
    document.getElementById('link-preview').src = image;
    document.getElementById('link-preview-wrap').classList.remove('hidden');
  }

  toast('Details fetched.');
}

// ── MODAL ─────────────────────────────────────────────────────────────────────

function openModal() {
  activeType    = 'image';
  fetchedImgUrl = '';
  selectedColor = '#fef9ec';

  ['f-image-url','f-image-caption','f-note-text','f-link-url','f-link-title'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('image-preview-wrap').classList.add('hidden');
  document.getElementById('link-preview-wrap').classList.add('hidden');

  document.querySelectorAll('.mood-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'image'));
  document.querySelectorAll('.mood-fields').forEach(f => f.classList.add('hidden'));
  document.getElementById('fields-image').classList.remove('hidden');
  document.querySelectorAll('.note-color-btn').forEach(b => b.classList.toggle('active', b.dataset.color === selectedColor));

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('f-image-url').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ── EVENTS ────────────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('btn-add').addEventListener('click', openModal);
  document.getElementById('btn-save').addEventListener('click', saveItem);
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  document.getElementById('btn-fetch-link').addEventListener('click', fetchLink);

  document.querySelectorAll('.mood-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeType = btn.dataset.type;
      document.querySelectorAll('.mood-type-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.mood-fields').forEach(f => f.classList.add('hidden'));
      document.getElementById(`fields-${activeType}`).classList.remove('hidden');
    });
  });

  document.querySelectorAll('.note-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedColor = btn.dataset.color;
      document.querySelectorAll('.note-color-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  document.getElementById('f-image-url').addEventListener('input', e => {
    const url = e.target.value.trim();
    if (url) {
      document.getElementById('image-preview').src = url;
      document.getElementById('image-preview-wrap').classList.remove('hidden');
    } else {
      document.getElementById('image-preview-wrap').classList.add('hidden');
    }
  });

  document.getElementById('btn-signout').addEventListener('click', async () => {
    await client.auth.signOut();
    window.location.href = 'index.html';
  });
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
