const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STORAGE_BUCKET  = 'mood-images';
const STORAGE_PREFIX  = 'storage:'; // prefix stored in DB to flag uploaded images

let items            = [];
let signedUrls       = {}; // { itemId: signedUrl } — resolved each load, not stored in DB
let activeType       = 'image';
let selectedColor    = '#fef9ec';
let fetchedImgUrl    = '';
let selectedFile     = null;
let currentView      = localStorage.getItem('moodView') || 'masonry';
let editingId        = null;
let activeTag        = 'all';
let currentUserEmail = '';
let lightboxIndex    = -1;
let lightboxItems    = [];
let touchStartX      = 0;

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  currentUserEmail = session.user.email;
  document.getElementById('user-email').textContent = session.user.email;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
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
  signedUrls = {};
  items = (data || []).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  await resolveSignedUrls(items);
  renderTagFilter();
  renderItems();
}

async function resolveSignedUrls(itemList) {
  const needsSigning = itemList.filter(i => i.image_url?.startsWith(STORAGE_PREFIX));
  if (!needsSigning.length) return;

  const paths = needsSigning.map(i => i.image_url.slice(STORAGE_PREFIX.length));
  const { data } = await client.storage.from(STORAGE_BUCKET).createSignedUrls(paths, 3600);
  if (!data) return;

  needsSigning.forEach((item, idx) => {
    if (data[idx]?.signedUrl) signedUrls[item.id] = data[idx].signedUrl;
  });
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function renderTagFilter() {
  const bar = document.getElementById('mood-filter-bar');
  const allTags = new Set();
  items.forEach(i => (i.tags || []).forEach(t => t && allTags.add(t)));

  if (allTags.size === 0) { bar.innerHTML = ''; return; }

  bar.innerHTML = ['all', ...allTags].map(tag => `
    <button class="mood-filter-chip ${tag === activeTag ? 'active' : ''}"
            onclick="setTagFilter('${esc(tag)}')">${tag === 'all' ? 'All' : esc(tag)}</button>
  `).join('');
}

function renderItems() {
  const grid = document.getElementById('mood-grid');
  grid.className = `mood-grid mood-grid-${currentView}`;

  const filtered = activeTag === 'all'
    ? items
    : items.filter(i => (i.tags || []).includes(activeTag));

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>${activeTag === 'all' ? 'Nothing here yet' : 'No items tagged \u201c' + esc(activeTag) + '\u201d'}</h3>
        <p>${activeTag === 'all' ? 'Add images, notes, websites, and colours for inspiration.' : 'Try a different tag or add more items.'}</p>
      </div>`;
    return;
  }
  grid.innerHTML = filtered.map(renderCard).join('');
  grid.querySelectorAll('.mood-card').forEach((card, i) => {
    card.style.animationDelay = `${Math.min(i, 20) * 0.045}s`;
  });
}

// ── CARD HELPERS ──────────────────────────────────────────────────────────────

function seededRand(id, seed) {
  let h = seed * 2654435761;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 2654435761);
  return (h >>> 0) / 0xffffffff;
}

function cardMods(id) {
  const r0 = seededRand(id, 0);
  const r1 = seededRand(id, 1);
  const isWide = currentView === 'mosaic' && r1 > 0.42;
  const rot    = currentView === 'scatter' ? (r0 - 0.5) * 14 : 0;
  return {
    cls:   isWide ? ' card-wide' : '',
    style: rot ? ` style="transform:rotate(${rot.toFixed(2)}deg)"` : '',
    rot,
  };
}

function overlayHTML(item) {
  const pinned   = item.pinned || false;
  const reactions = item.reactions || {};
  const myReacted = !!reactions[currentUserEmail];
  return `
    <div class="mood-card-overlay">
      <button class="mood-action-btn ${pinned ? 'pinned' : ''}"
              onclick="togglePin('${item.id}',event)" title="${pinned ? 'Unpin' : 'Pin to top'}">&#128204;</button>
      <button class="mood-action-btn"
              onclick="editItem('${item.id}',event)" title="Edit">&#9998;</button>
      <button class="mood-action-btn mood-action-heart ${myReacted ? 'reacted' : ''}"
              onclick="toggleReaction('${item.id}',event)"
              title="${myReacted ? 'Unlike' : 'Like'}">&#9829;</button>
      <button class="mood-action-btn mood-action-del"
              onclick="deleteItem('${item.id}',event)" title="Remove">&times;</button>
    </div>
    ${pinned ? '<div class="mood-pin-indicator">&#128204;</div>' : ''}`;
}

function tagsHTML(item) {
  const tags = (item.tags || []).filter(Boolean);
  if (!tags.length) return '';
  return `<div class="mood-card-tags">${tags.map(t => `<span class="mood-tag">${esc(t)}</span>`).join('')}</div>`;
}

function nameFromEmail(email) {
  if (!email) return '?';
  const local = email.split('@')[0];
  return local.charAt(0).toUpperCase() + (local.charAt(1) || '').toUpperCase();
}

// Small persistent indicator shown only when someone has liked — no interactive element
function likedIndicatorHTML(item) {
  const reactions = item.reactions || {};
  const reactors  = Object.keys(reactions).filter(e => reactions[e]);
  if (!reactors.length) return '';
  const chips = reactors.map(e => `
    <span class="reactor-chip ${e === currentUserEmail ? 'me' : ''}">${esc(nameFromEmail(e))}</span>
  `).join('');
  return `<div class="mood-liked-indicator" onclick="event.stopPropagation()">&#9829; ${chips}</div>`;
}

// ── RENDER CARDS ──────────────────────────────────────────────────────────────

function renderCard(item) {
  const { cls, style, rot } = cardMods(item.id);

  if (item.type === 'image') {
    const imgSrc = esc(signedUrls[item.id] || item.image_url || '');
    return `
      <div class="mood-card mood-card-image${cls}"${style} data-id="${item.id}" onclick="openLightbox('${item.id}')">
        <img src="${imgSrc}" alt="${esc(item.title || '')}" loading="lazy"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="mood-img-error">Could not load image</div>
        ${overlayHTML(item)}
        ${tagsHTML(item)}
        ${item.title ? `<div class="mood-card-caption">${esc(item.title)}</div>` : ''}
        ${likedIndicatorHTML(item)}
      </div>`;
  }

  if (item.type === 'note') {
    const bg = item.color || '#fef9ec';
    const rotStyle = currentView === 'scatter'
      ? `;transform:rotate(${((seededRand(item.id, 0) - 0.5) * 14).toFixed(2)}deg)` : '';
    return `
      <div class="mood-card mood-card-note${cls}" style="background:${esc(bg)}${rotStyle}" data-id="${item.id}">
        ${overlayHTML(item)}
        <div class="mood-note-text">${esc(item.content).replace(/\n/g, '<br>')}</div>
        ${tagsHTML(item)}
        ${likedIndicatorHTML(item)}
      </div>`;
  }

  if (item.type === 'link') {
    let domain = item.content;
    try { domain = new URL(item.content).hostname.replace(/^www\./, ''); } catch {}
    return `
      <div class="mood-card mood-card-link${cls}"${style} data-id="${item.id}"
           onclick="window.open('${esc(item.content)}','_blank')">
        ${item.image_url ? `<img src="${esc(item.image_url)}" alt="${esc(item.title || '')}" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="mood-link-body">
          ${item.title ? `<div class="mood-link-title">${esc(item.title)}</div>` : ''}
          <div class="mood-link-domain">${esc(domain)}</div>
        </div>
        ${overlayHTML(item)}
        ${tagsHTML(item)}
        ${likedIndicatorHTML(item)}
      </div>`;
  }

  if (item.type === 'color') {
    return `
      <div class="mood-card mood-card-color${cls}"${style} data-id="${item.id}">
        <div class="mood-color-swatch" style="background:${esc(item.color || '#cccccc')}"></div>
        <div class="mood-color-info">
          <div class="mood-color-hex">${esc(item.color || '')}</div>
          ${item.title ? `<div class="mood-color-label-text">${esc(item.title)}</div>` : ''}
        </div>
        ${overlayHTML(item)}
        ${tagsHTML(item)}
        ${likedIndicatorHTML(item)}
      </div>`;
  }

  return '';
}

// ── VIEW / TAG FILTER ─────────────────────────────────────────────────────────

function setView(view) {
  currentView = view;
  localStorage.setItem('moodView', view);
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  renderItems();
}

function setTagFilter(tag) {
  activeTag = tag;
  renderTagFilter();
  renderItems();
}

// ── EDIT ──────────────────────────────────────────────────────────────────────

function editItem(id, e) {
  e.stopPropagation();
  const item = items.find(i => i.id === id);
  if (item) openModal(item);
}

// ── PIN ───────────────────────────────────────────────────────────────────────

async function togglePin(id, e) {
  e.stopPropagation();
  const item = items.find(i => i.id === id);
  if (!item) return;
  const { error } = await client.from('mood_items').update({ pinned: !item.pinned }).eq('id', id);
  if (error) { toast('Could not update.'); return; }
  toast(item.pinned ? 'Unpinned.' : 'Pinned to top.');
  loadItems();
}

// ── REACTIONS ─────────────────────────────────────────────────────────────────

async function toggleReaction(id, e) {
  e.stopPropagation();
  const item = items.find(i => i.id === id);
  if (!item) return;
  const reactions = { ...(item.reactions || {}) };
  if (reactions[currentUserEmail]) {
    delete reactions[currentUserEmail];
  } else {
    reactions[currentUserEmail] = true;
  }
  const { error } = await client.from('mood_items').update({ reactions }).eq('id', id);
  if (error) { toast('Could not update.'); return; }
  item.reactions = reactions; // optimistic local update
  renderItems();
}

// ── SAVE / DELETE ─────────────────────────────────────────────────────────────

async function saveItem() {
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const tagsRaw = document.getElementById('f-tags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  let payload = { type: activeType, tags };

  if (activeType === 'image') {
    const urlInput  = document.getElementById('f-image-url').value.trim();
    const existing  = editingId ? items.find(i => i.id === editingId) : null;
    if (selectedFile) {
      btn.textContent = 'Uploading…';
      try {
        // Delete old storage file if replacing an uploaded image
        if (existing) {
          const oldPath = storagePath(existing.image_url);
          if (oldPath) await client.storage.from(STORAGE_BUCKET).remove([oldPath]);
        }
        payload.image_url = await uploadImage(selectedFile);
      } catch (err) {
        toast('Upload failed — ' + err.message); resetBtn(btn); return;
      }
    } else if (urlInput) {
      payload.image_url = urlInput;
    } else if (existing?.image_url) {
      payload.image_url = existing.image_url; // keep existing image unchanged
    } else {
      toast('Please upload an image or paste a URL.'); resetBtn(btn); return;
    }
    payload.title = document.getElementById('f-image-caption').value.trim() || null;

  } else if (activeType === 'note') {
    const text = document.getElementById('f-note-text').value.trim();
    if (!text) { toast('Please write something.'); resetBtn(btn); return; }
    payload.content = text;
    payload.color   = selectedColor;

  } else if (activeType === 'link') {
    const url = document.getElementById('f-link-url').value.trim();
    if (!url) { toast('Please enter a URL.'); resetBtn(btn); return; }
    payload.content   = url;
    payload.title     = document.getElementById('f-link-title').value.trim() || null;
    payload.image_url = fetchedImgUrl || null;

  } else if (activeType === 'color') {
    const hex = document.getElementById('f-color-hex-text').value.trim();
    if (!hex) { toast('Please pick a colour.'); resetBtn(btn); return; }
    payload.color = hex;
    payload.title = document.getElementById('f-color-label').value.trim() || null;
  }

  let error;
  if (editingId) {
    ({ error } = await client.from('mood_items').update(payload).eq('id', editingId));
  } else {
    ({ error } = await client.from('mood_items').insert([payload]));
  }

  resetBtn(btn);
  if (error) { toast('Could not save — ' + error.message); return; }
  closeModal();
  toast(editingId ? 'Updated.' : 'Added to mood board.');
  loadItems();
}

function resetBtn(btn) {
  btn.disabled = false;
  btn.textContent = editingId ? 'Save changes' : 'Add to board';
}

async function deleteItem(id, e) {
  e.stopPropagation();
  if (!confirm('Remove this from the mood board?')) return;
  const item = items.find(i => i.id === id);
  const { error } = await client.from('mood_items').delete().eq('id', id);
  if (error) { toast('Could not remove.'); return; }
  // Clean up storage file if the image was uploaded
  if (item?.image_url) {
    const path = storagePath(item.image_url);
    if (path) await client.storage.from(STORAGE_BUCKET).remove([path]);
  }
  toast('Removed.');
  loadItems();
}

// ── IMAGE UPLOAD ──────────────────────────────────────────────────────────────

async function uploadImage(file) {
  const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await client.storage.from(STORAGE_BUCKET).upload(path, file);
  if (error) throw error;
  return STORAGE_PREFIX + path; // stored in DB as "storage:filename.ext"
}

function storagePath(imageUrl) {
  return imageUrl?.startsWith(STORAGE_PREFIX) ? imageUrl.slice(STORAGE_PREFIX.length) : null;
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

  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const meta = prop => doc.querySelector(`meta[property="${prop}"]`)?.content
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

function openModal(item = null) {
  editingId     = item ? item.id : null;
  fetchedImgUrl = '';
  selectedFile  = null;
  selectedColor = '#fef9ec';

  // Clear all inputs
  document.getElementById('f-image-file').value = '';
  document.getElementById('upload-filename').textContent = '';
  document.getElementById('upload-filename').classList.add('hidden');
  ['f-image-url','f-image-caption','f-note-text','f-link-url','f-link-title','f-color-label','f-tags'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('f-color-hex-text').value = '#b8965a';
  document.getElementById('f-color-hex').value      = '#b8965a';
  document.getElementById('image-preview-wrap').classList.add('hidden');
  document.getElementById('link-preview-wrap').classList.add('hidden');

  const tabs      = document.getElementById('mood-type-tabs');
  const titleEl   = document.getElementById('modal-title');
  const saveBtn   = document.getElementById('btn-save');

  if (item) {
    // Edit mode — hide type tabs, pre-fill fields
    titleEl.textContent  = 'Edit item';
    saveBtn.textContent  = 'Save changes';
    tabs.classList.add('hidden');
    activeType = item.type;

    document.getElementById('f-tags').value = (item.tags || []).join(', ');

    if (item.type === 'image') {
      // For storage items don't put the "storage:path" value in the URL field
      const isStorageItem = item.image_url?.startsWith(STORAGE_PREFIX);
      if (!isStorageItem) document.getElementById('f-image-url').value = item.image_url || '';
      document.getElementById('f-image-caption').value = item.title || '';
      const previewUrl = signedUrls[item.id] || (!isStorageItem ? item.image_url : null);
      if (previewUrl) {
        document.getElementById('image-preview').src = previewUrl;
        document.getElementById('image-preview-wrap').classList.remove('hidden');
      }
    } else if (item.type === 'note') {
      document.getElementById('f-note-text').value = item.content || '';
      selectedColor = item.color || '#fef9ec';
      document.querySelectorAll('.note-color-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.color === selectedColor));
    } else if (item.type === 'link') {
      document.getElementById('f-link-url').value   = item.content || '';
      document.getElementById('f-link-title').value = item.title   || '';
      fetchedImgUrl = item.image_url || '';
      if (item.image_url) {
        document.getElementById('link-preview').src = item.image_url;
        document.getElementById('link-preview-wrap').classList.remove('hidden');
      }
    } else if (item.type === 'color') {
      const hex = item.color || '#b8965a';
      document.getElementById('f-color-hex-text').value = hex;
      document.getElementById('f-color-hex').value      = hex;
      document.getElementById('f-color-label').value    = item.title || '';
    }

    document.querySelectorAll('.mood-fields').forEach(f => f.classList.add('hidden'));
    document.getElementById(`fields-${activeType}`).classList.remove('hidden');

  } else {
    // Add mode
    titleEl.textContent = 'Add to Mood Board';
    saveBtn.textContent = 'Add to board';
    tabs.classList.remove('hidden');
    activeType = 'image';

    document.querySelectorAll('.mood-type-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.type === 'image'));
    document.querySelectorAll('.mood-fields').forEach(f => f.classList.add('hidden'));
    document.getElementById('fields-image').classList.remove('hidden');
    document.querySelectorAll('.note-color-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.color === selectedColor));
  }

  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => {
    document.getElementById(`fields-${activeType}`)?.querySelector('input,textarea')?.focus();
  }, 50);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  editingId = null;
}

// ── LIGHTBOX ──────────────────────────────────────────────────────────────────

function openLightbox(itemId) {
  const filtered = activeTag === 'all'
    ? items : items.filter(i => (i.tags || []).includes(activeTag));
  lightboxItems = filtered.filter(i => i.type === 'image');
  lightboxIndex = lightboxItems.findIndex(i => i.id === itemId);
  if (lightboxIndex === -1) return;
  showLightboxAt(lightboxIndex);
  document.getElementById('lightbox-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function showLightboxAt(idx) {
  const item = lightboxItems[idx];
  const src  = signedUrls[item.id] || item.image_url || '';
  const img  = document.getElementById('lightbox-img');
  img.style.opacity = '0';
  img.src = src;
  img.onload = () => { img.style.opacity = '1'; };

  const tags  = (item.tags || []).filter(Boolean);
  let meta = '';
  if (item.title) meta += `<div class="lightbox-caption">${esc(item.title)}</div>`;
  if (tags.length) meta += `<div class="lightbox-tags">${tags.map(t => `<span class="mood-tag">${esc(t)}</span>`).join('')}</div>`;
  document.getElementById('lightbox-meta').innerHTML = meta;

  const total = lightboxItems.length;
  document.getElementById('lightbox-counter').textContent = total > 1 ? `${idx + 1} / ${total}` : '';
  document.getElementById('lightbox-prev').style.opacity = idx > 0 ? '1' : '0.2';
  document.getElementById('lightbox-next').style.opacity = idx < total - 1 ? '1' : '0.2';
  document.getElementById('lightbox-prev').style.pointerEvents = idx > 0 ? '' : 'none';
  document.getElementById('lightbox-next').style.pointerEvents = idx < total - 1 ? '' : 'none';
}

function closeLightbox() {
  document.getElementById('lightbox-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  lightboxIndex = -1;
}

function lightboxNav(dir) {
  const next = lightboxIndex + dir;
  if (next >= 0 && next < lightboxItems.length) {
    lightboxIndex = next;
    showLightboxAt(lightboxIndex);
  }
}

// ── CLIPBOARD PASTE ───────────────────────────────────────────────────────────

function pasteFromClipboard() {
  showPasteTarget();
}

function showPasteTarget() {
  const overlay = document.createElement('div');
  overlay.className = 'paste-target-overlay';
  overlay.innerHTML = `
    <div class="paste-target-box">
      <p class="paste-target-hint">On mobile: tap and hold the box, then tap <strong>Paste</strong><br>On desktop: click the box and press <strong>Ctrl+V</strong></p>
      <div class="paste-target-area" id="paste-target-area" contenteditable="true"></div>
      <button class="btn-secondary paste-target-cancel" id="paste-target-cancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('paste-target-area')?.focus(), 80);

  document.getElementById('paste-target-area').addEventListener('paste', e => {
    const clipItems = e.clipboardData?.items || [];
    for (const ci of clipItems) {
      if (ci.type.startsWith('image/')) {
        const file = ci.getAsFile();
        overlay.remove();
        openModal();
        applyPastedFile(file);
        toast('Image pasted — add a caption and save.');
        return;
      }
    }
    // If only text was pasted, clear it and re-focus
    document.getElementById('paste-target-area').textContent = '';
    toast('That was text, not an image. Try copying a photo first.');
  });

  document.getElementById('paste-target-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function applyPastedFile(file) {
  selectedFile = file;
  document.getElementById('upload-filename').textContent = file.name || 'pasted image';
  document.getElementById('upload-filename').classList.remove('hidden');
  document.getElementById('f-image-url').value = '';
  document.getElementById('image-preview').src = URL.createObjectURL(file);
  document.getElementById('image-preview-wrap').classList.remove('hidden');
}

// ── EVENTS ────────────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('btn-add').addEventListener('click', () => openModal());
  document.getElementById('btn-paste').addEventListener('click', pasteFromClipboard);
  document.getElementById('btn-save').addEventListener('click', saveItem);
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Lightbox events
  document.getElementById('lightbox-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeLightbox();
  });
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-prev').addEventListener('click', e => { e.stopPropagation(); lightboxNav(-1); });
  document.getElementById('lightbox-next').addEventListener('click', e => { e.stopPropagation(); lightboxNav(1); });

  // Touch swipe for lightbox
  const lb = document.getElementById('lightbox-overlay');
  lb.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend',   e => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) lightboxNav(diff > 0 ? 1 : -1);
  });

  // Keyboard: Escape + arrow keys
  document.addEventListener('keydown', e => {
    const lbOpen = !document.getElementById('lightbox-overlay').classList.contains('hidden');
    if (e.key === 'Escape') { lbOpen ? closeLightbox() : closeModal(); return; }
    if (lbOpen) {
      if (e.key === 'ArrowLeft')  lightboxNav(-1);
      if (e.key === 'ArrowRight') lightboxNav(1);
    }
  });

  // Clipboard paste — anywhere on the page opens add modal with image pre-loaded
  document.addEventListener('paste', e => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const clipItems = e.clipboardData?.items || [];
    for (const ci of clipItems) {
      if (ci.type.startsWith('image/')) {
        const file = ci.getAsFile();
        if (!file) return;
        e.preventDefault();
        const modalOpen = !document.getElementById('modal-overlay').classList.contains('hidden');
        if (!modalOpen || activeType !== 'image') openModal();
        // Set after openModal (which clears selectedFile)
        applyPastedFile(file);
        toast('Image pasted — add a caption and save.');
        return;
      }
    }
  });

  document.getElementById('btn-fetch-link').addEventListener('click', fetchLink);

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

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

  document.getElementById('f-image-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    selectedFile = file;
    document.getElementById('upload-filename').textContent = file.name;
    document.getElementById('upload-filename').classList.remove('hidden');
    // Preview the local file and clear the URL input
    document.getElementById('f-image-url').value = '';
    document.getElementById('image-preview').src = URL.createObjectURL(file);
    document.getElementById('image-preview-wrap').classList.remove('hidden');
  });

  document.getElementById('f-image-url').addEventListener('input', e => {
    const url = e.target.value.trim();
    if (url) {
      // Clear any selected file when a URL is typed
      selectedFile = null;
      document.getElementById('f-image-file').value = '';
      document.getElementById('upload-filename').classList.add('hidden');
      document.getElementById('image-preview').src = url;
      document.getElementById('image-preview-wrap').classList.remove('hidden');
    } else {
      document.getElementById('image-preview-wrap').classList.add('hidden');
    }
  });

  // Colour picker ↔ hex text sync
  document.getElementById('f-color-hex').addEventListener('input', e => {
    document.getElementById('f-color-hex-text').value = e.target.value;
  });
  document.getElementById('f-color-hex-text').addEventListener('input', e => {
    const val = e.target.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      document.getElementById('f-color-hex').value = val;
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
