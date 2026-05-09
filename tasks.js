const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let tasks         = [];
let currentFilter = 'all';
let ownerFilter   = 'all';
let priorityFilter = 'all';
let editingId     = null;

const STARTER_TASKS = [
  { title: 'Set overall budget',                  category: 'Planning',   priority: 'high',   assigned_to: 'Both'  },
  { title: 'Choose a wedding date',               category: 'Planning',   priority: 'high',   assigned_to: 'Both'  },
  { title: 'Agree on guest list size',            category: 'Guests',     priority: 'high',   assigned_to: 'Both'  },
  { title: 'Book ceremony & reception venue',     category: 'Venue',      priority: 'high',   assigned_to: 'Both'  },
  { title: 'Book officiant / registrar',          category: 'Admin',      priority: 'high',   assigned_to: 'Both'  },
  { title: 'Send save the dates',                 category: 'Guests',     priority: 'high',   assigned_to: 'Both'  },
  { title: 'Book photographer',                   category: 'Suppliers',  priority: 'high',   assigned_to: 'Both'  },
  { title: 'Book caterer',                        category: 'Suppliers',  priority: 'high',   assigned_to: 'Both'  },
  { title: 'Shop for wedding dress / outfit',     category: 'Attire',     priority: 'high',   assigned_to: 'Pepsi' },
  { title: 'Choose wedding party',                category: 'Planning',   priority: 'medium', assigned_to: 'Both'  },
  { title: 'Book music / entertainment',          category: 'Suppliers',  priority: 'medium', assigned_to: 'Both'  },
  { title: 'Buy wedding rings',                   category: 'Admin',      priority: 'medium', assigned_to: 'Both'  },
  { title: 'Plan honeymoon',                      category: 'Travel',     priority: 'medium', assigned_to: 'Both'  },
  { title: 'Send invitations',                    category: 'Guests',     priority: 'medium', assigned_to: 'Both'  },
  { title: 'Arrange guest accommodation',         category: 'Guests',     priority: 'medium', assigned_to: 'Both'  },
  { title: 'Book hair & makeup',                  category: 'Attire',     priority: 'medium', assigned_to: 'Pepsi' },
  { title: 'Order wedding cake',                  category: 'Suppliers',  priority: 'medium', assigned_to: 'Both'  },
  { title: 'Plan flowers & decoration',           category: 'Suppliers',  priority: 'low',    assigned_to: 'Both'  },
  { title: 'Arrange transport',                   category: 'Suppliers',  priority: 'low',    assigned_to: 'Both'  },
  { title: 'Finalise seating plan',               category: 'Guests',     priority: 'low',    assigned_to: 'Both'  },
];

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  document.getElementById('user-email').textContent = session.user.email;
  await loadTasks();
  bindEvents();
}

// ── DATA ──────────────────────────────────────────────────────────────────────

async function loadTasks() {
  const { data, error } = await client.from('tasks').select('*').order('created_at');
  if (error) { console.error(error); return; }
  tasks = data || [];
  renderTasks();
  updateCounts();
  updateProgress();
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function renderTasks() {
  const container = document.getElementById('task-list');

  let list = [...tasks];
  if (currentFilter !== 'all')   list = list.filter(t => t.status === currentFilter);
  if (ownerFilter !== 'all')     list = list.filter(t => t.assigned_to === ownerFilter);
  if (priorityFilter !== 'all')  list = list.filter(t => t.priority === priorityFilter);

  // Sort: incomplete first, then by priority, then by due date
  const pOrder = { high: 0, medium: 1, low: 2 };
  list.sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    if (pOrder[a.priority] !== pOrder[b.priority]) return pOrder[a.priority] - pOrder[b.priority];
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  });

  if (list.length === 0) {
    const isEmpty = tasks.length === 0;
    container.innerHTML = `
      <div class="empty-state">
        <h3>${isEmpty ? 'No tasks yet' : 'No tasks match this filter'}</h3>
        <p>${isEmpty ? 'Add your first task, or load the starter checklist above.' : 'Try a different filter.'}</p>
      </div>`;
    return;
  }

  container.innerHTML = list.map(t => {
    const done     = t.status === 'done';
    const overdue  = t.due_date && !done && t.due_date < new Date().toISOString().slice(0, 10);
    const dueFmt   = t.due_date ? formatDate(t.due_date) : '';

    return `
      <div class="task-row ${done ? 'task-done' : ''}" onclick="openEdit('${t.id}')">
        <button class="task-check ${done ? 'checked' : ''}" onclick="event.stopPropagation(); toggleDone('${t.id}')" title="${done ? 'Mark incomplete' : 'Mark complete'}">
          ${done ? '&#10003;' : ''}
        </button>
        <div class="task-main">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-meta">
            ${t.category ? `<span class="group-tag">${esc(t.category)}</span>` : ''}
            ${t.assigned_to ? `<span class="task-owner">${esc(t.assigned_to)}</span>` : ''}
            ${dueFmt ? `<span class="task-due ${overdue ? 'overdue' : ''}">${overdue ? 'Overdue · ' : ''}${dueFmt}</span>` : ''}
            ${t.notes ? `<span class="task-note-preview">${esc(t.notes)}</span>` : ''}
          </div>
        </div>
        <div class="task-right" onclick="event.stopPropagation()">
          <span class="priority-badge priority-${t.priority}">${t.priority}</span>
          <span class="status-badge status-task-${t.status}">${statusLabel(t.status)}</span>
          <button class="btn-icon danger" onclick="confirmDelete('${t.id}', '${esc(t.title).replace(/'/g, "\\'")}')">Delete</button>
        </div>
      </div>`;
  }).join('');
}

function statusLabel(s) {
  return { todo: 'To do', in_progress: 'In progress', done: 'Done' }[s] || s;
}

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function updateCounts() {
  document.getElementById('count-all').textContent         = tasks.length;
  document.getElementById('count-todo').textContent        = tasks.filter(t => t.status === 'todo').length;
  document.getElementById('count-in-progress').textContent = tasks.filter(t => t.status === 'in_progress').length;
  document.getElementById('count-done').textContent        = tasks.filter(t => t.status === 'done').length;
}

function updateProgress() {
  const total = tasks.length;
  const done  = tasks.filter(t => t.status === 'done').length;
  const pct   = total ? Math.round((done / total) * 100) : 0;
  document.getElementById('task-progress-fill').style.width = pct + '%';
  document.getElementById('task-progress-text').textContent =
    total ? `${done} of ${total} tasks complete (${pct}%)` : 'Track everything that needs doing';
}

// ── QUICK ACTIONS ─────────────────────────────────────────────────────────────

async function toggleDone(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  const newStatus = t.status === 'done' ? 'todo' : 'done';
  const { error } = await client.from('tasks').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id);
  if (!error) loadTasks();
}

async function addStarterTasks() {
  if (tasks.length > 0 && !confirm('This will add the starter checklist alongside your existing tasks. Continue?')) return;
  const { error } = await client.from('tasks').insert(
    STARTER_TASKS.map(t => ({ ...t, status: 'todo' }))
  );
  if (error) toast(`Error: ${error.message}`);
  else { toast('Starter checklist added.'); loadTasks(); }
}

// ── MODAL ─────────────────────────────────────────────────────────────────────

function openAdd() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'Add Task';
  document.getElementById('task-form').reset();
  document.getElementById('f-priority').value  = 'medium';
  document.getElementById('f-assigned').value  = 'Both';
  document.getElementById('f-status').value    = 'todo';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('f-title').focus();
}

function openEdit(id) {
  const t = editingId = id, task = tasks.find(t => t.id === id);
  if (!task) return;
  editingId = id;
  document.getElementById('modal-title').textContent   = 'Edit Task';
  document.getElementById('f-title').value             = task.title       || '';
  document.getElementById('f-category').value          = task.category    || '';
  document.getElementById('f-due-date').value          = task.due_date    || '';
  document.getElementById('f-assigned').value          = task.assigned_to || 'Both';
  document.getElementById('f-priority').value          = task.priority    || 'medium';
  document.getElementById('f-status').value            = task.status      || 'todo';
  document.getElementById('f-notes').value             = task.notes       || '';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('f-title').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  editingId = null;
}

// ── SAVE / DELETE ─────────────────────────────────────────────────────────────

async function saveTask(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save');
  btn.disabled = true; btn.textContent = 'Saving…';

  const payload = {
    title:       document.getElementById('f-title').value.trim(),
    category:    document.getElementById('f-category').value.trim() || null,
    due_date:    document.getElementById('f-due-date').value        || null,
    assigned_to: document.getElementById('f-assigned').value,
    priority:    document.getElementById('f-priority').value,
    status:      document.getElementById('f-status').value,
    notes:       document.getElementById('f-notes').value.trim()   || null,
    updated_at:  new Date().toISOString(),
  };

  let error;
  if (editingId) {
    ({ error } = await client.from('tasks').update(payload).eq('id', editingId));
  } else {
    ({ error } = await client.from('tasks').insert([payload]));
  }

  btn.disabled = false; btn.textContent = 'Save task';
  if (error) { toast(`Error: ${error.message}`); return; }
  closeModal();
  toast(editingId ? 'Task updated.' : 'Task added.');
  loadTasks();
}

async function confirmDelete(id, title) {
  if (!confirm(`Delete "${title}"?`)) return;
  const { error } = await client.from('tasks').delete().eq('id', id);
  if (error) toast('Could not delete task.');
  else { toast('Task deleted.'); loadTasks(); }
}

// ── EVENTS ────────────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('btn-add').addEventListener('click', openAdd);
  document.getElementById('btn-starter').addEventListener('click', addStarterTasks);
  document.getElementById('task-form').addEventListener('submit', saveTask);
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
      renderTasks();
    });
  });

  document.getElementById('owner-filter').addEventListener('change', e => {
    ownerFilter = e.target.value; renderTasks();
  });
  document.getElementById('priority-filter').addEventListener('change', e => {
    priorityFilter = e.target.value; renderTasks();
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
