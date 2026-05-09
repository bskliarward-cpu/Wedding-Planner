const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let items      = [];
let totalBudget = 0;
let editingId  = null;

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  document.getElementById('user-email').textContent = session.user.email;
  await Promise.all([loadTotalBudget(), loadItems()]);
  bindEvents();
}

// ── DATA ──────────────────────────────────────────────────────────────────────

async function loadTotalBudget() {
  const { data } = await client.from('settings').select('value').eq('key', 'total_budget').single();
  totalBudget = data ? parseInt(data.value) || 0 : 0;
  renderTotalBudget();
}

async function saveTotalBudget(amount) {
  totalBudget = amount;
  await client.from('settings').upsert({ key: 'total_budget', value: String(amount) });
  renderTotalBudget();
  updateSummary();
}

async function loadItems() {
  const { data, error } = await client.from('budget_items').select('*').order('created_at');
  if (error) { console.error(error); return; }
  items = data || [];
  renderItems();
  updateSummary();
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function renderTotalBudget() {
  const el = document.getElementById('total-amount-text');
  el.textContent = totalBudget ? `£${totalBudget.toLocaleString()}` : 'Not set — click to add';
}

function renderItems() {
  const tbody = document.getElementById('budget-tbody');
  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No budget items yet — add your first category.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(item => {
    const budgeted  = item.budgeted  || 0;
    const estimated = item.estimated ?? null;
    const actual    = item.actual    ?? null;
    const variance  = actual !== null ? actual - budgeted : null;

    const fmt = n => n !== null && n !== undefined ? `£${n.toLocaleString()}` : '—';

    let varianceHtml = '—';
    if (variance !== null) {
      const cls = variance > 0 ? 'variance-over' : variance < 0 ? 'variance-under' : '';
      const sign = variance > 0 ? '+' : '';
      varianceHtml = `<span class="${cls}">${sign}£${Math.abs(variance).toLocaleString()}</span>`;
    }

    return `
      <tr class="guest-row" onclick="openEdit('${item.id}')">
        <td class="guest-name">${esc(item.category)}</td>
        <td>${fmt(budgeted)}</td>
        <td>${fmt(estimated)}</td>
        <td>${fmt(actual)}</td>
        <td>${varianceHtml}</td>
        <td class="text-muted guest-notes-cell">${esc(item.notes || '')}</td>
        <td class="guest-actions" onclick="event.stopPropagation()">
          <button class="btn-icon" onclick="openEdit('${item.id}')">Edit</button>
          <button class="btn-icon danger" onclick="confirmDelete('${item.id}', '${esc(item.category).replace(/'/g, "\\'")}')">Delete</button>
        </td>
      </tr>`;
  }).join('');
}

function updateSummary() {
  const allocated = items.reduce((s, i) => s + (i.budgeted  || 0), 0);
  const estimated = items.reduce((s, i) => s + (i.estimated || 0), 0);
  const paid      = items.reduce((s, i) => s + (i.actual    || 0), 0);
  const remaining = totalBudget - paid;

  document.getElementById('s-allocated').textContent = `£${allocated.toLocaleString()}`;
  document.getElementById('s-estimated').textContent = `£${estimated.toLocaleString()}`;
  document.getElementById('s-paid').textContent      = `£${paid.toLocaleString()}`;
  document.getElementById('s-remaining').textContent = `£${Math.abs(remaining).toLocaleString()}${remaining < 0 ? ' over' : ''}`;

  const card = document.getElementById('remaining-card');
  card.classList.toggle('summary-danger', remaining < 0);
  card.classList.toggle('summary-highlight', remaining >= 0);

  // Progress bar
  const wrap = document.getElementById('budget-progress-wrap');
  if (totalBudget > 0) {
    const pct = Math.min((paid / totalBudget) * 100, 100);
    document.getElementById('budget-progress-fill').style.width = pct + '%';
    document.getElementById('budget-progress-fill').className =
      'budget-progress-fill' + (paid > totalBudget ? ' over' : paid / totalBudget > 0.8 ? ' warning' : '');
    document.getElementById('budget-progress-label').textContent =
      `${Math.round(pct)}% of total budget paid`;
    wrap.classList.remove('hidden');
  } else {
    wrap.classList.add('hidden');
  }
}

// ── TOTAL BUDGET EDIT ─────────────────────────────────────────────────────────

function showTotalEdit() {
  document.getElementById('total-display').classList.add('hidden');
  document.getElementById('total-edit').classList.remove('hidden');
  const input = document.getElementById('total-input');
  input.value = totalBudget || '';
  input.focus();
}

function hideTotalEdit() {
  document.getElementById('total-display').classList.remove('hidden');
  document.getElementById('total-edit').classList.add('hidden');
}

// ── MODAL ─────────────────────────────────────────────────────────────────────

function openAdd() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'Add Budget Item';
  document.getElementById('budget-form').reset();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('f-category').focus();
}

function openEdit(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  editingId = id;
  document.getElementById('modal-title').textContent = 'Edit Budget Item';
  document.getElementById('f-category').value  = item.category  || '';
  document.getElementById('f-budgeted').value  = item.budgeted  || '';
  document.getElementById('f-estimated').value = item.estimated || '';
  document.getElementById('f-actual').value    = item.actual    || '';
  document.getElementById('f-notes').value     = item.notes     || '';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('f-category').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  editingId = null;
}

// ── SAVE / DELETE ─────────────────────────────────────────────────────────────

async function saveItem(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save');
  btn.disabled = true; btn.textContent = 'Saving…';

  const payload = {
    category:  document.getElementById('f-category').value.trim(),
    budgeted:  parseInt(document.getElementById('f-budgeted').value)  || 0,
    estimated: parseInt(document.getElementById('f-estimated').value) || null,
    actual:    parseInt(document.getElementById('f-actual').value)    || null,
    notes:     document.getElementById('f-notes').value.trim()        || null,
    updated_at: new Date().toISOString(),
  };

  let error;
  if (editingId) {
    ({ error } = await client.from('budget_items').update(payload).eq('id', editingId));
  } else {
    ({ error } = await client.from('budget_items').insert([payload]));
  }

  btn.disabled = false; btn.textContent = 'Save';
  if (error) { toast(`Error: ${error.message}`); return; }
  closeModal();
  toast(editingId ? 'Item updated.' : 'Item added.');
  loadItems();
}

async function confirmDelete(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  const { error } = await client.from('budget_items').delete().eq('id', id);
  if (error) toast('Could not delete item.');
  else { toast('Item deleted.'); loadItems(); }
}

// ── EVENTS ────────────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('btn-add').addEventListener('click', openAdd);
  document.getElementById('budget-form').addEventListener('submit', saveItem);
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  document.getElementById('btn-edit-total').addEventListener('click', showTotalEdit);
  document.getElementById('total-amount-text').addEventListener('click', showTotalEdit);
  document.getElementById('btn-cancel-total').addEventListener('click', hideTotalEdit);
  document.getElementById('btn-save-total').addEventListener('click', async () => {
    const val = parseInt(document.getElementById('total-input').value) || 0;
    await saveTotalBudget(val);
    hideTotalEdit();
    toast('Total budget saved.');
  });
  document.getElementById('total-input').addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = parseInt(document.getElementById('total-input').value) || 0;
      await saveTotalBudget(val);
      hideTotalEdit();
    }
    if (e.key === 'Escape') hideTotalEdit();
  });

  document.getElementById('btn-signout').addEventListener('click', async () => {
    await client.auth.signOut();
    window.location.href = 'index.html';
  });
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

init();
