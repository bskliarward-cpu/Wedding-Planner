const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function init() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  document.getElementById('user-email').textContent = session.user.email;

  setGreeting();

  const [venues, guests, budgetItems, budgetSetting, tasks] = await Promise.all([
    client.from('venues').select('id,name,status,rating,location'),
    client.from('guests').select('id,status,plus_one,children_count'),
    client.from('budget_items').select('budgeted,estimated,actual'),
    client.from('settings').select('value').eq('key', 'total_budget').single(),
    client.from('tasks').select('id,title,status,priority,due_date,assigned_to,category'),
  ]);

  const v = venues.data   || [];
  const g = guests.data   || [];
  const b = budgetItems.data || [];
  const t = tasks.data    || [];
  const totalBudget = budgetSetting.data ? parseInt(budgetSetting.data.value) || 0 : 0;

  renderSummaryCards(v, g, b, totalBudget, t);
  renderUpcomingTasks(t);
  renderShortlistedVenues(v);

  document.getElementById('btn-signout').addEventListener('click', async () => {
    await client.auth.signOut();
    window.location.href = 'index.html';
  });
}

function setGreeting() {
  const h = new Date().getHours();
  const word = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('greeting').textContent = word;
}

function renderSummaryCards(v, g, b, totalBudget, t) {
  const shortlisted  = v.filter(x => x.status === 'shortlisted').length;
  const considering  = v.filter(x => x.status === 'considering').length;

  const definites    = g.filter(x => x.status === 'definite');
  const maybes       = g.filter(x => x.status === 'maybe');
  const headMin      = definites.length + definites.filter(x => x.plus_one).length + definites.reduce((s,x) => s+(x.children_count||0),0);
  const headMax      = headMin + maybes.length + maybes.filter(x => x.plus_one).length + maybes.reduce((s,x) => s+(x.children_count||0),0);

  const paid         = b.reduce((s, i) => s + (i.actual || 0), 0);
  const allocated    = b.reduce((s, i) => s + (i.budgeted || 0), 0);
  const remaining    = totalBudget - paid;
  const budgetPct    = totalBudget ? Math.round((paid / totalBudget) * 100) : null;

  const doneTasks    = t.filter(x => x.status === 'done').length;
  const overdue      = t.filter(x => x.due_date && x.status !== 'done' && x.due_date < today()).length;

  document.getElementById('dashboard-grid').innerHTML = `
    <a href="app.html" class="dash-card">
      <div class="dash-card-label">Venues</div>
      <div class="dash-card-value">${v.length}</div>
      <div class="dash-card-detail">
        ${shortlisted ? `<span class="status-badge status-shortlisted">${shortlisted} shortlisted</span>` : ''}
        ${considering ? `<span class="status-badge status-considering">${considering} considering</span>` : ''}
        ${!v.length ? '<span class="text-muted">None added yet</span>' : ''}
      </div>
    </a>

    <a href="guests.html" class="dash-card">
      <div class="dash-card-label">Guests</div>
      <div class="dash-card-value">${g.length}</div>
      <div class="dash-card-detail">
        ${g.length ? `<span class="text-muted" style="font-size:13px">Headcount ${headMin === headMax ? headMin : headMin + '–' + headMax}</span>` : '<span class="text-muted">None added yet</span>'}
        ${definites.length ? `<span class="status-badge status-shortlisted">${definites.length} definite</span>` : ''}
      </div>
    </a>

    <a href="budget.html" class="dash-card">
      <div class="dash-card-label">Budget</div>
      <div class="dash-card-value">${totalBudget ? '£' + totalBudget.toLocaleString() : '—'}</div>
      <div class="dash-card-detail">
        ${totalBudget
          ? `<span class="text-muted" style="font-size:13px">£${paid.toLocaleString()} paid · £${Math.abs(remaining).toLocaleString()} ${remaining >= 0 ? 'remaining' : 'over budget'}</span>`
          : '<span class="text-muted">Budget not set</span>'}
        ${budgetPct !== null ? `<span class="status-badge ${remaining < 0 ? 'status-rejected' : 'status-considering'}">${budgetPct}% spent</span>` : ''}
      </div>
    </a>

    <a href="tasks.html" class="dash-card">
      <div class="dash-card-label">Tasks</div>
      <div class="dash-card-value">${doneTasks}<span class="dash-card-total"> / ${t.length}</span></div>
      <div class="dash-card-detail">
        ${t.length ? `<span class="text-muted" style="font-size:13px">complete</span>` : '<span class="text-muted">None added yet</span>'}
        ${overdue ? `<span class="status-badge status-rejected">${overdue} overdue</span>` : ''}
        ${!overdue && t.length ? `<span class="status-badge status-shortlisted">On track</span>` : ''}
      </div>
    </a>
  `;
}

function renderUpcomingTasks(t) {
  const el = document.getElementById('upcoming-tasks');
  const upcoming = t
    .filter(x => x.status !== 'done')
    .sort((a, b) => {
      const pOrder = { high: 0, medium: 1, low: 2 };
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return pOrder[a.priority] - pOrder[b.priority];
    })
    .slice(0, 5);

  if (!upcoming.length) {
    el.innerHTML = `<p class="text-muted" style="font-size:14px">No pending tasks.</p>`;
    return;
  }

  el.innerHTML = upcoming.map(t => {
    const overdue = t.due_date && t.due_date < today();
    return `
      <div class="dash-task-row">
        <span class="priority-badge priority-${t.priority}">${t.priority}</span>
        <span class="dash-task-title">${esc(t.title)}</span>
        ${t.due_date ? `<span class="dash-task-due ${overdue ? 'overdue' : ''}">${overdue ? 'Overdue · ' : ''}${fmtDate(t.due_date)}</span>` : ''}
        <span class="dash-task-owner">${esc(t.assigned_to || '')}</span>
      </div>`;
  }).join('');
}

function renderShortlistedVenues(v) {
  const el = document.getElementById('shortlisted-venues');
  const list = v.filter(x => x.status === 'shortlisted');
  if (!list.length) {
    el.innerHTML = `<p class="text-muted" style="font-size:14px">No venues shortlisted yet.</p>`;
    return;
  }
  el.innerHTML = list.map(v => `
    <div class="dash-venue-row">
      <span class="dash-venue-name">${esc(v.name)}</span>
      ${v.location ? `<span class="text-muted" style="font-size:13px">${esc(v.location)}</span>` : ''}
      ${v.rating ? `<span style="color:var(--accent);font-size:13px">${'★'.repeat(v.rating)}</span>` : ''}
    </div>`
  ).join('');
}

function today() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
