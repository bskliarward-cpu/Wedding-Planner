const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let guests        = [];
let currentFilter = 'all';
let currentSearch = '';
let editingId     = null;
let sortCol       = null;
let sortDir       = 'asc';

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  document.getElementById('user-email').textContent = session.user.email;
  await loadGuests();
  bindEvents();
}

// ── DATA ──────────────────────────────────────────────────────────────────────

async function loadGuests() {
  const { data, error } = await client
    .from('guests')
    .select('*')
    .order('name', { ascending: true });
  if (error) { console.error(error); return; }
  guests = data || [];
  renderGuests();
  updateSummary();
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function renderGuests() {
  const tbody = document.getElementById('guest-tbody');

  let list = [...guests];
  if (currentFilter !== 'all') list = list.filter(g => g.status === currentFilter);
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(g => g.name.toLowerCase().includes(q));
  }

  if (sortCol) {
    list.sort((a, b) => {
      let av = a[sortCol] ?? '';
      let bv = b[sortCol] ?? '';
      if (typeof av === 'boolean') { av = av ? 1 : 0; bv = bv ? 1 : 0; }
      const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  document.querySelectorAll('.sort-th').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.col === sortCol) {
      arrow.textContent = sortDir === 'asc' ? ' ↑' : ' ↓';
      th.classList.add('sort-active');
    } else {
      arrow.textContent = '';
      th.classList.remove('sort-active');
    }
  });

  if (list.length === 0) {
    const msg = guests.length === 0
      ? 'No guests yet — add your first guest to get started.'
      : 'No guests match this filter.';
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(g => {
    const guestTags = [];
    if (g.plus_one) guestTags.push('<span class="plus-one-badge">+1</span>');
    if (g.children_count > 0) guestTags.push(`<span class="children-badge">${g.children_count} child${g.children_count > 1 ? 'ren' : ''}</span>`);
    return `
    <tr class="guest-row" onclick="openEdit('${g.id}')">
      <td class="guest-name">${esc(g.name)}</td>
      <td>${g.group_name ? `<span class="group-tag">${esc(g.group_name)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td class="text-muted">${g.side ? esc(g.side) + '&rsquo;s side' : '—'}</td>
      <td>${guestTags.length ? guestTags.join(' ') : '<span class="text-muted">—</span>'}</td>
      <td><span class="status-badge status-${g.status}">${statusLabel(g.status)}</span></td>
      <td class="text-muted guest-notes-cell">${esc(g.notes || '')}</td>
      <td class="guest-actions" onclick="event.stopPropagation()">
        <button class="btn-icon" onclick="openEdit('${g.id}')">Edit</button>
        <button class="btn-icon danger" onclick="confirmDelete('${g.id}', '${esc(g.name).replace(/'/g, "\\'")}')">Remove</button>
      </td>
    </tr>`;
  }).join('');
}

function statusLabel(s) {
  return { definite: 'Definite', maybe: 'Maybe', not_inviting: 'Not inviting' }[s] || s;
}

function updateSummary() {
  const definites    = guests.filter(g => g.status === 'definite');
  const maybes       = guests.filter(g => g.status === 'maybe');
  const notInviting  = guests.filter(g => g.status === 'not_inviting');

  const headCount = gs => gs.length
    + gs.filter(g => g.plus_one).length
    + gs.reduce((sum, g) => sum + (g.children_count || 0), 0);
  const definiteHeads = headCount(definites);
  const maybeHeads    = headCount(maybes);

  document.getElementById('s-definite').textContent    = definites.length;
  document.getElementById('s-maybe').textContent       = maybes.length;
  document.getElementById('s-not-inviting').textContent = notInviting.length;
  document.getElementById('s-headcount').textContent   = maybeHeads === 0
    ? definiteHeads
    : `${definiteHeads}–${definiteHeads + maybeHeads}`;

  document.getElementById('count-all').textContent          = guests.length;
  document.getElementById('count-definite').textContent     = definites.length;
  document.getElementById('count-maybe').textContent        = maybes.length;
  document.getElementById('count-not-inviting').textContent = notInviting.length;
}

// ── MODAL ─────────────────────────────────────────────────────────────────────

function openAdd() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'Add Guest';
  document.getElementById('guest-form').reset();
  document.getElementById('f-status').value = 'maybe';
  setChildrenUI(false, '');
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('f-name').focus();
}

function openEdit(id) {
  const g = guests.find(g => g.id === id);
  if (!g) return;
  editingId = id;
  document.getElementById('modal-title').textContent  = 'Edit Guest';
  document.getElementById('f-name').value       = g.name       || '';
  document.getElementById('f-status').value     = g.status     || 'maybe';
  document.getElementById('f-group').value      = g.group_name || '';
  document.getElementById('f-side').value       = g.side       || '';
  document.getElementById('f-plus-one').checked = g.plus_one   || false;
  document.getElementById('f-notes').value      = g.notes      || '';
  setChildrenUI(g.children_count > 0, g.children_count || '');
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('f-name').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  editingId = null;
}

// ── SAVE / DELETE ─────────────────────────────────────────────────────────────

async function saveGuest(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const payload = {
    name:       document.getElementById('f-name').value.trim(),
    status:     document.getElementById('f-status').value,
    group_name: document.getElementById('f-group').value    || null,
    side:       document.getElementById('f-side').value.trim() || null,
    plus_one:       document.getElementById('f-plus-one').checked,
    children_count: document.getElementById('f-has-children').checked
                      ? (parseInt(document.getElementById('f-children-count').value) || 1)
                      : 0,
    notes:      document.getElementById('f-notes').value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  let error;
  if (editingId) {
    ({ error } = await client.from('guests').update(payload).eq('id', editingId));
  } else {
    ({ error } = await client.from('guests').insert([payload]));
  }

  btn.disabled = false;
  btn.textContent = 'Save guest';

  if (error) {
    toast(`Could not save guest — ${error.message}`);
    console.error(error);
  } else {
    closeModal();
    toast(editingId ? 'Guest updated.' : 'Guest added.');
    loadGuests();
  }
}

async function confirmDelete(id, name) {
  if (!confirm(`Remove "${name}" from the guest list?`)) return;
  const { error } = await client.from('guests').delete().eq('id', id);
  if (error) toast('Could not remove guest.');
  else { toast('Guest removed.'); loadGuests(); }
}

// ── EVENTS ────────────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('btn-add').addEventListener('click', openAdd);
  document.getElementById('guest-form').addEventListener('submit', saveGuest);
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGuests();
    });
  });

  document.getElementById('f-has-children').addEventListener('change', e => {
    document.getElementById('children-count-wrap').classList.toggle('hidden', !e.target.checked);
    if (!e.target.checked) document.getElementById('f-children-count').value = '';
  });

  document.getElementById('guest-search').addEventListener('input', e => {
    currentSearch = e.target.value.trim();
    renderGuests();
  });

  document.querySelectorAll('.sort-th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = 'asc';
      }
      renderGuests();
    });
  });

  document.getElementById('btn-signout').addEventListener('click', async () => {
    await client.auth.signOut();
    window.location.href = 'index.html';
  });
}

function setChildrenUI(hasChildren, count) {
  document.getElementById('f-has-children').checked = hasChildren;
  document.getElementById('f-children-count').value = count;
  document.getElementById('children-count-wrap').classList.toggle('hidden', !hasChildren);
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
