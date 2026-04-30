// ==========================================
// 🥔 土豆记账 - Frontend App
// ==========================================

// --- State ---
let accounts = [];
let categories = [];
let records = [];
let currentMonth = new Date().toISOString().slice(0, 7); // "2026-04"
let currentType = 'expense'; // 'expense' | 'income'
let selectedCategoryId = null;
let selectedAccountId = 'acc_1';
let amountStr = '0';
let filterType = 'all';
let recurringRecords = [];

// --- Helpers ---
function localDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}
function todayStr() { return localDateStr(new Date()); }

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- API ---
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  const text = await res.text();
  if (!res.ok || !text.trimStart().startsWith('{') && !text.trimStart().startsWith('[')) {
    console.warn('API error:', res.status, text.slice(0, 100));
    return { success: false, message: '网络异常' };
  }
  return JSON.parse(text);
}

// --- Load Data ---
async function loadAll() {
  await Promise.all([loadAccounts(), loadCategories(), loadRecords(), loadRecurring()]);
  // Auto-generate recurring records on page load
  await generateRecurring();
  // Reload records after generation to include newly created recurring records.
  // This is intentional — generateRecurring may create new records from recurring
  // templates, so we need a fresh fetch to reflect them in the UI.
  await loadRecords();
  renderHome();
}

async function loadAccounts() {
  const r = await api('GET', '/accounts');
  if (r.success) accounts = r.data;
}

async function loadCategories() {
  const r = await api('GET', '/categories');
  if (r.success) categories = r.data;
}

async function loadRecords() {
  const r = await api('GET', '/records');
  if (r.success) records = r.data;
}

// --- Render Home ---
function renderHome() {
  // Month display
  const [y, m] = currentMonth.split('-');
  $('#current-month').textContent = `${y}年${parseInt(m)}月`;

  // Monthly stats
  const monthRecords = records.filter(r => r.date && r.date.startsWith(currentMonth));
  let totalIncome = 0, totalExpense = 0;
  monthRecords.forEach(r => {
    if (r.type === 'income') totalIncome += r.amount;
    else totalExpense += r.amount;
  });

  $('#total-expense').textContent = totalExpense.toFixed(2);
  $('#total-income').textContent = totalIncome.toFixed(2);
  $('#total-balance').textContent = (totalIncome - totalExpense).toFixed(2);

  // Today records
  const today = todayStr();
  const todayRecords = records.filter(r => r.date === today);
  renderRecordList('#today-records', todayRecords, true);

  // Recent records (last 7 days, excluding today)
  const recentRecords = records.filter(r => {
    if (!r.date || r.date === today) return false;
    const d = new Date(r.date);
    const now = new Date();
    const diff = (now - d) / 86400000;
    return diff <= 7;
  }).slice(0, 20);
  renderRecordList('#recent-records', recentRecords, false);
}

function renderRecordList(selector, list, showEmpty) {
  const el = $(selector);
  if (!list || list.length === 0) {
    if (showEmpty) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><div class="empty-text">今天还没有记录</div></div>';
    } else {
      el.innerHTML = '';
    }
    return;
  }

  // Group by date
  const groups = {};
  list.forEach(r => {
    const key = r.date || 'no-date';
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  let html = '';
  const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  const today = todayStr();
  const yesterday = localDateStr(new Date(Date.now() - 86400000));

  sortedKeys.forEach(dateKey => {
    const [y, m, d] = dateKey.split('-');
    let label = `${parseInt(m)}月${parseInt(d)}日`;
    if (dateKey === today) label = '今天';
    else if (dateKey === yesterday) label = '昨天';

    const dayRecords = groups[dateKey];
    let dayIncome = 0, dayExpense = 0;
    dayRecords.forEach(r => {
      if (r.type === 'income') dayIncome += r.amount;
      else dayExpense += r.amount;
    });

    html += `<div class="record-date-group">
      <div class="record-date-label">${label}
        <span style="float:right;font-size:11px;color:#B2BEC3">支出 ${dayExpense.toFixed(2)}  收入 ${dayIncome.toFixed(2)}</span>
      </div>`;

    dayRecords.forEach(r => {
      const cat = categories.find(c => c.id === r.categoryId) || {};
      html += `<div class="record-item" onclick="editRecord('${r.id}')">
        <div class="record-icon" style="background:${cat.color || '#95A5A6'}20">
          ${cat.icon || '📦'}
        </div>
        <div class="record-info">
          <div class="record-title">${escapeHtml(cat.name || '未分类')}${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
          <div class="record-meta">${escapeHtml(r.time || '')}</div>
        </div>
        <div class="record-amount ${r.type}">
          ${r.type === 'expense' ? '-' : '+'}${r.amount.toFixed(2)}
        </div>
      </div>`;
    });

    html += '</div>';
  });

  el.innerHTML = html;
}

// --- Records Page ---
function renderRecords() {
  let filtered = records;
  if (filterType === 'expense') filtered = records.filter(r => r.type === 'expense');
  if (filterType === 'income') filtered = records.filter(r => r.type === 'income');

  renderRecordList('#all-records', filtered.slice(0, 100), true);
}

// --- Stats Page ---
function renderStats() {
  const monthRecords = records.filter(r => r.date && r.date.startsWith(currentMonth));

  // Category breakdown
  const byCat = {};
  monthRecords.filter(r => r.type === 'expense').forEach(r => {
    const catId = r.categoryId || 'unknown';
    if (!byCat[catId]) byCat[catId] = 0;
    byCat[catId] += r.amount;
  });

  const sorted = Object.entries(byCat)
    .map(([id, amount]) => {
      const cat = categories.find(c => c.id === id);
      return { id, amount, name: cat ? cat.name : '未分类', icon: cat ? cat.icon : '📦', color: cat ? cat.color : '#95A5A6' };
    })
    .sort((a, b) => b.amount - a.amount);

  const totalExpense = sorted.reduce((s, c) => s + c.amount, 0);

  // Draw pie chart
  drawPieChart('category-chart', sorted, totalExpense);

  // Category list
  let catHtml = '';
  sorted.forEach(cat => {
    const pct = totalExpense > 0 ? (cat.amount / totalExpense * 100).toFixed(1) : 0;
    catHtml += `<div class="cat-stat-item">
      <span class="cat-stat-icon">${cat.icon}</span>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between">
          <span class="cat-stat-name">${escapeHtml(cat.name)}</span>
          <span class="cat-stat-amount">¥${cat.amount.toFixed(2)} (${pct}%)</span>
        </div>
        <div class="cat-stat-bar" style="width:${pct}%;background:${cat.color}"></div>
      </div>
    </div>`;
  });
  if (sorted.length === 0) catHtml = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">本月暂无支出记录</div></div>';
  $('#category-list').innerHTML = catHtml;

  // Daily trend
  const dailyTrend = {};
  monthRecords.forEach(r => {
    if (!r.date) return;
    if (!dailyTrend[r.date]) dailyTrend[r.date] = { income: 0, expense: 0 };
    if (r.type === 'income') dailyTrend[r.date].income += r.amount;
    else dailyTrend[r.date].expense += r.amount;
  });
  drawTrendChart('trend-chart', dailyTrend);
}

function drawPieChart(canvasId, data, total) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = Math.min(canvas.parentElement.clientWidth - 32, 280);
  canvas.width = size * 2;
  canvas.height = size * 2;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(2, 2);

  const cx = size / 2, cy = size / 2, r = size / 2 - 10;
  if (total === 0 || data.length === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#E8ECEF';
    ctx.fill();
    ctx.fillStyle = '#B2BEC3';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无数据', cx, cy + 5);
    return;
  }

  let startAngle = -Math.PI / 2;
  data.forEach(cat => {
    const sliceAngle = (cat.amount / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = cat.color;
    ctx.fill();
    startAngle += sliceAngle;
  });

  // Inner circle (donut)
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  // Center text
  ctx.fillStyle = '#2D3436';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('¥' + total.toFixed(0), cx, cy + 5);
}

function drawTrendChart(canvasId, dailyTrend) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.parentElement.clientWidth - 32;
  const h = 160;
  canvas.width = w * 2;
  canvas.height = h * 2;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(2, 2);

  const days = Object.keys(dailyTrend).sort();
  if (days.length === 0) {
    ctx.fillStyle = '#B2BEC3';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无数据', w / 2, h / 2);
    return;
  }

  const maxVal = Math.max(...days.map(d => Math.max(dailyTrend[d].expense, dailyTrend[d].income)), 1);
  const barWidth = Math.min((w - 20) / days.length - 4, 20);
  const chartH = h - 30;

  days.forEach((day, i) => {
    const x = 10 + i * (barWidth + 4);
    const expH = (dailyTrend[day].expense / maxVal) * chartH;
    const incH = (dailyTrend[day].income / maxVal) * chartH;

    // Expense bar
    ctx.fillStyle = '#FF6B6B';
    ctx.fillRect(x, h - 20 - expH, barWidth / 2 - 1, expH);

    // Income bar
    ctx.fillStyle = '#2ECC71';
    ctx.fillRect(x + barWidth / 2 + 1, h - 20 - incH, barWidth / 2 - 1, incH);

    // Day label
    ctx.fillStyle = '#B2BEC3';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    const dayNum = day.split('-')[2];
    if (days.length <= 15 || i % 2 === 0) {
      ctx.fillText(parseInt(dayNum), x + barWidth / 2, h - 6);
    }
  });
}

// --- Accounts Page ---
function renderAccounts() {
  let html = '';
  accounts.forEach(acc => {
    const balance = records
      .filter(r => r.accountId === acc.id)
      .reduce((sum, r) => sum + (r.type === 'income' ? r.amount : -r.amount), 0);
    html += `<div class="account-card">
      <div class="account-top">
        <span class="account-icon">${acc.icon}</span>
        <span class="account-name">${acc.name}</span>
      </div>
      <div class="account-balance" style="color:${balance >= 0 ? 'var(--text)' : 'var(--expense)'}">
        ¥${balance.toFixed(2)}
      </div>
    </div>`;
  });
  $('#accounts-list').innerHTML = html;
}

// --- Budget Page ---
async function renderBudget() {
  const r = await api('GET', '/budgets?month=' + currentMonth);
  const budgets = r.success ? r.data : [];

  const monthRecords = records.filter(r => r.date && r.date.startsWith(currentMonth) && r.type === 'expense');
  const totalExpense = monthRecords.reduce((s, r) => s + r.amount, 0);

  // Total budget
  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);

  let html = '';
  if (totalBudget > 0) {
    const pct = Math.min(totalExpense / totalBudget * 100, 100);
    const color = pct > 90 ? '#E74C3C' : pct > 70 ? '#F39C12' : '#2ECC71';
    html += `<div class="budget-card">
      <div class="budget-header">
        <span class="budget-cat-name" style="font-size:16px">📊 总预算</span>
        <span class="budget-amounts"><span>¥${totalExpense.toFixed(0)}</span> / ¥${totalBudget.toFixed(0)}</span>
      </div>
      <div class="budget-progress-bar">
        <div class="budget-progress-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div style="text-align:right;font-size:12px;color:var(--text-secondary);margin-top:4px">
        剩余 ¥${(totalBudget - totalExpense).toFixed(2)}
      </div>
    </div>`;
  }

  budgets.forEach(b => {
    const pct = b.budget > 0 ? Math.min(b.spent / b.budget * 100, 100) : 0;
    const color = pct > 90 ? '#E74C3C' : pct > 70 ? '#F39C12' : '#2ECC71';
    html += `<div class="budget-card">
      <div class="budget-header">
        <div class="budget-cat">
          <span class="budget-cat-icon">${b.categoryIcon}</span>
          <span class="budget-cat-name">${escapeHtml(b.categoryName)}</span>
        </div>
        <button style="background:none;border:none;color:#E74C3C;font-size:18px;cursor:pointer" onclick="deleteBudget('${b.id}')">×</button>
      </div>
      <div class="budget-amounts">已花 <span>¥${b.spent.toFixed(2)}</span> / ¥${b.budget.toFixed(2)}</div>
      <div class="budget-progress-bar">
        <div class="budget-progress-fill" style="width:${pct}%;background:${color}"></div>
      </div>
    </div>`;
  });

  if (budgets.length === 0 && totalBudget === 0) {
    html = '<div class="empty-state"><div class="empty-icon">💰</div><div class="empty-text">还没有设置预算<br>点击右上角 + 开始设置</div></div>';
  }

  $('#budget-list').innerHTML = html;
}

async function deleteBudget(id) {
  if (!confirm('确认删除此预算？')) return;
  await api('DELETE', '/budgets/' + id);
  renderBudget();
  showToast('已删除');
}

// --- Add Record Page ---
function openAddPage() {
  amountStr = '0';
  selectedCategoryId = null;
  currentType = 'expense';
  $('#record-date').value = todayStr();
  $('#record-note').value = '';
  updateAmountDisplay();
  renderCategoryGrid();
  renderAccountSelect();
  switchPage('add');
}

function closeAddPage() {
  renderHome();
  switchPage('home');
}

function renderCategoryGrid() {
  const cats = categories.filter(c => c.type === currentType);
  let html = '';
  cats.forEach(cat => {
    const sel = selectedCategoryId === cat.id ? ' selected' : '';
    html += `<div class="category-item${sel}" onclick="selectCategory('${cat.id}', event)" style="--cat-color:${cat.color}">
      <span class="cat-icon">${cat.icon}</span>
      <span class="cat-name">${escapeHtml(cat.name)}</span>
    </div>`;
  });
  $('#category-grid').innerHTML = html;
}

function renderAccountSelect() {
  let html = '';
  accounts.forEach(acc => {
    html += `<option value="${acc.id}"${acc.id === selectedAccountId ? ' selected' : ''}>${acc.icon} ${acc.name}</option>`;
  });
  $('#record-account').innerHTML = html;
}

function selectCategory(id, evt) {
  selectedCategoryId = id;
  $$('.category-item').forEach(el => el.classList.remove('selected'));
  const target = evt ? (evt.currentTarget || evt.target) : null;
  if (target) {
    target.closest('.category-item').classList.add('selected');
  }
}

function updateAmountDisplay() {
  $('#amount-display').textContent = amountStr;
}

function handleNumpad(key) {
  if (key === 'del') {
    amountStr = amountStr.slice(0, -1) || '0';
  } else if (key === 'ok' || key === 'ok2' || key === 'ok3') {
    saveRecord();
    return;
  } else if (key === '.') {
    if (!amountStr.includes('.')) amountStr += '.';
  } else {
    // Limit decimal places to 2
    const dotIndex = amountStr.indexOf('.');
    if (dotIndex !== -1 && amountStr.length - dotIndex > 2) return;
    if (amountStr === '0') amountStr = key;
    else amountStr += key;
  }
  updateAmountDisplay();
}

async function saveRecord() {
  const amount = parseFloat(amountStr);
  if (!amount || amount <= 0) {
    showToast('请输入金额');
    return;
  }
  if (!selectedCategoryId) {
    showToast('请选择分类');
    return;
  }

  const data = {
    amount,
    type: currentType,
    categoryId: selectedCategoryId,
    accountId: $('#record-account').value || 'acc_1',
    note: $('#record-note').value.trim(),
    date: $('#record-date').value || todayStr(),
  };

  const r = await api('POST', '/records', data);
  if (r.success) {
    showToast(currentType === 'expense' ? '支出已记录' : '收入已记录');
    amountStr = '0';
    selectedCategoryId = null;
    updateAmountDisplay();
    await loadRecords();
    renderHome();
    renderCategoryGrid();
  } else {
    showToast(r.message || '保存失败');
  }
}

// --- Edit/Delete Record ---
async function editRecord(id) {
  const record = records.find(r => r.id === id);
  if (!record) return;

  const cat = categories.find(c => c.id === record.categoryId) || {};
  const sign = record.type === 'expense' ? '-' : '+';
  const detail = [
    `${cat.icon || '📦'} ${cat.name || '未分类'}`,
    `${sign}¥${record.amount.toFixed(2)}`,
    record.note ? `备注: ${record.note}` : '',
    `日期: ${record.date}`,
  ].filter(Boolean).join('\n');

  const action = confirm(`${detail}\n\n点击"确定"删除此记录，点击"取消"返回`);
  if (action) {
    await api('DELETE', '/records/' + id);
    await loadRecords();
    renderHome();
    showToast('已删除');
  }
}

// --- Month Picker ---
function showMonthPicker() {
  const currentYear = new Date().getFullYear();
  let html = `<div class="modal-overlay" id="month-modal" onclick="closeMonthPicker(event)">
    <div class="modal-box">
      <h3>选择月份</h3>
      <div class="month-grid">`;

  for (let y = currentYear; y >= currentYear - 1; y--) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const active = key === currentMonth ? ' active' : '';
      html += `<button class="${active}" onclick="pickMonth('${key}')">${y}年${m}月</button>`;
    }
  }

  html += `</div></div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeMonthPicker(e) {
  if (e && e.target.id !== 'month-modal') return;
  const modal = $('#month-modal');
  if (modal) modal.remove();
}

function pickMonth(month) {
  currentMonth = month;
  const modal = $('#month-modal');
  if (modal) modal.remove();
  loadRecords().then(() => {
    renderHome();
    if ($('#page-stats') && $('#page-stats').classList.contains('active')) renderStats();
    if ($('#page-budget') && $('#page-budget').classList.contains('active')) renderBudget();
  });
}

// --- Budget Add Modal ---
function showBudgetModal() {
  const expenseCats = categories.filter(c => c.type === 'expense');
  let catOptions = '';
  expenseCats.forEach(c => {
    catOptions += `<option value="${c.id}">${c.icon} ${c.name}</option>`;
  });

  let html = `<div class="modal-overlay" id="budget-modal" onclick="closeBudgetModal(event)">
    <div class="modal-box">
      <h3>设置预算 (${currentMonth})</h3>
      <div class="budget-form">
        <select id="budget-category">${catOptions}</select>
        <input type="number" id="budget-amount" placeholder="预算金额" min="0" step="100">
        <button onclick="saveBudget()">确认</button>
      </div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeBudgetModal(e) {
  if (e && e.target.id !== 'budget-modal') return;
  const modal = $('#budget-modal');
  if (modal) modal.remove();
}

async function saveBudget() {
  const categoryId = $('#budget-category').value;
  const amount = parseFloat($('#budget-amount').value);
  if (!amount || amount <= 0) {
    showToast('请输入预算金额');
    return;
  }

  await api('POST', '/budgets', { categoryId, amount, month: currentMonth });
  closeBudgetModal({ target: { id: 'budget-modal' } });
  renderBudget();
  showToast('预算已设置');
}

// --- Navigation ---
function switchPage(page) {
  $$('.page').forEach(p => p.classList.remove('active'));
  const el = $(`#page-${page}`);
  if (el) el.classList.add('active');

  $$('.tab-bar .tab').forEach(t => t.classList.remove('active'));
  const tab = $(`.tab-bar .tab[data-page="${page}"]`);
  if (tab) tab.classList.add('active');

  if (page === 'records') renderRecords();
  if (page === 'stats') renderStats();
  if (page === 'accounts') renderAccounts();
  if (page === 'budget') renderBudget();
  if (page === 'recurring') renderRecurring();
}

// --- Toast ---
function showToast(msg) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove('show'), 2000);
}

// --- Escape HTML for safe rendering ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Quick Entry ---
async function handleQuickEntry() {
  const input = $('#quick-entry-input');
  const text = input.value.trim();
  if (!text) return;

  const hint = $('#quick-entry-hint');
  hint.textContent = '识别中...';
  hint.className = 'quick-entry-hint';

  try {
    const r = await api('POST', '/quick-entry', { text, accountId: selectedAccountId });
    if (r.success) {
      const d = r.data;
      const typeText = d.type === 'expense' ? '支出' : '收入';
      hint.textContent = `✅ ${typeText} ¥${d.amount.toFixed(2)} · ${r.parsed.category}`;
      hint.className = 'quick-entry-hint success';
      input.value = '';
      await loadRecords();
      renderHome();
      setTimeout(() => { hint.textContent = ''; }, 3000);
    } else {
      hint.textContent = '❌ ' + (r.message || '无法识别');
      hint.className = 'quick-entry-hint error';
    }
  } catch (e) {
    hint.textContent = '❌ 网络异常';
    hint.className = 'quick-entry-hint error';
  }
}

// --- Recurring Records ---
async function loadRecurring() {
  const r = await api('GET', '/recurring');
  if (r.success) recurringRecords = r.data;
}

async function generateRecurring() {
  await api('POST', '/recurring/generate');
}

function renderRecurring() {
  let html = '';
  if (recurringRecords.length === 0) {
    html = '<div class="empty-state"><div class="empty-icon">🔄</div><div class="empty-text">还没有周期性记录<br>点击右上角 + 添加房租、工资等</div></div>';
  }

  recurringRecords.forEach(r => {
    const typeClass = r.type === 'expense' ? 'expense' : 'income';
    const sign = r.type === 'expense' ? '-' : '+';
    const freqText = r.frequency === 'monthly' ? '每月' : r.frequency === 'weekly' ? '每周' : r.frequency === 'daily' ? '每天' : '每年';
    const dayText = r.frequency === 'monthly' ? `${r.dayOfMonth || 1}日` : r.frequency === 'weekly' ? ['周日','周一','周二','周三','周四','周五','周六'][r.dayOfWeek || 0] : '';
    const nextInfo = r.nextDate ? `下次: ${r.nextDate}` : '';

    html += `<div class="recurring-card">
      <div class="recurring-icon" style="background:${r.type === 'expense' ? 'rgba(255,107,107,0.1)' : 'rgba(46,204,113,0.1)'}">
        ${r.categoryIcon || '📦'}
      </div>
      <div class="recurring-info">
        <div class="recurring-title">
          ${escapeHtml(r.categoryName || '未分类')}${r.note ? ' · ' + escapeHtml(r.note) : ''}
          <span class="recurring-badge">${freqText} ${dayText}</span>
        </div>
        <div class="recurring-meta">${escapeHtml(nextInfo)}</div>
      </div>
      <div class="recurring-right">
        <div class="recurring-amount ${typeClass}">${sign}¥${r.amount.toFixed(2)}</div>
        <div class="recurring-toggle">
          <input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="toggleRecurring('${r.id}', this.checked)">
        </div>
      </div>
    </div>`;
  });

  $('#recurring-list').innerHTML = html;
}

async function toggleRecurring(id, enabled) {
  await api('PUT', '/recurring/' + id, { enabled });
  await loadRecurring();
  renderRecurring();
  showToast(enabled ? '已启用' : '已暂停');
}

async function deleteRecurring(id) {
  if (!confirm('确认删除此周期性记录？')) return;
  await api('DELETE', '/recurring/' + id);
  await loadRecurring();
  renderRecurring();
  showToast('已删除');
}

function showRecurringModal() {
  const expenseCats = categories.filter(c => c.type === 'expense');
  const incomeCats = categories.filter(c => c.type === 'income');
  let catOptions = '';
  expenseCats.forEach(c => { catOptions += `<option value="${c.id}">${c.icon} ${c.name}</option>`; });

  let html = `<div class="modal-overlay" id="recurring-modal" onclick="closeRecurringModal(event)">
    <div class="modal-box" style="max-width:380px">
      <h3>添加周期性记录</h3>
      <div class="recurring-form">
        <div class="recurring-type-tabs">
          <div class="recurring-type-tab active expense" data-rc-type="expense" onclick="switchRecurringType('expense', this)">💸 支出</div>
          <div class="recurring-type-tab" data-rc-type="income" onclick="switchRecurringType('income', this)">💰 收入</div>
        </div>
        <div class="form-group">
          <label class="form-label">金额</label>
          <input type="number" id="rc-amount" placeholder="0.00" min="0" step="0.01">
        </div>
        <div class="form-group">
          <label class="form-label">分类</label>
          <select id="rc-category">${catOptions}</select>
        </div>
        <div class="form-group">
          <label class="form-label">备注</label>
          <input type="text" id="rc-note" placeholder="如：房租、工资...">
        </div>
        <div class="form-group">
          <label class="form-label">频率</label>
          <select id="rc-frequency" onchange="onRecurringFreqChange()">
            <option value="monthly">每月</option>
            <option value="weekly">每周</option>
            <option value="daily">每天</option>
            <option value="yearly">每年</option>
          </select>
        </div>
        <div class="form-group" id="rc-day-group">
          <label class="form-label">每月几号</label>
          <input type="number" id="rc-day" value="1" min="1" max="31">
        </div>
        <div class="form-group" id="rc-week-group" style="display:none">
          <label class="form-label">每周几</label>
          <select id="rc-weekday">
            <option value="1">周一</option>
            <option value="2">周二</option>
            <option value="3">周三</option>
            <option value="4">周四</option>
            <option value="5">周五</option>
            <option value="6">周六</option>
            <option value="0">周日</option>
          </select>
        </div>
        <button onclick="saveRecurring()">确认添加</button>
      </div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeRecurringModal(e) {
  if (e && e.target.id !== 'recurring-modal') return;
  const modal = $('#recurring-modal');
  if (modal) modal.remove();
}

let recurringType = 'expense';
function switchRecurringType(type, el) {
  recurringType = type;
  $$('#recurring-modal .recurring-type-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  // Update category select
  const cats = categories.filter(c => c.type === type);
  let opts = '';
  cats.forEach(c => { opts += `<option value="${c.id}">${c.icon} ${c.name}</option>`; });
  $('#rc-category').innerHTML = opts;
}

function onRecurringFreqChange() {
  const freq = $('#rc-frequency').value;
  $('#rc-day-group').style.display = (freq === 'monthly' || freq === 'yearly') ? '' : 'none';
  $('#rc-week-group').style.display = freq === 'weekly' ? '' : 'none';
}

async function saveRecurring() {
  const amount = parseFloat($('#rc-amount').value);
  if (!amount || amount <= 0) {
    showToast('请输入金额');
    return;
  }
  const categoryId = $('#rc-category').value;
  const note = $('#rc-note').value.trim();
  const frequency = $('#rc-frequency').value;
  const dayOfMonth = frequency === 'monthly' || frequency === 'yearly' ? parseInt($('#rc-day').value) || 1 : null;
  const dayOfWeek = frequency === 'weekly' ? parseInt($('#rc-weekday').value) : null;

  await api('POST', '/recurring', {
    amount,
    type: recurringType,
    categoryId,
    accountId: 'acc_1',
    note,
    frequency,
    dayOfMonth,
    dayOfWeek,
  });

  closeRecurringModal({ target: { id: 'recurring-modal' } });
  await loadRecurring();
  renderRecurring();
  showToast('周期性记录已添加');
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  // Tab bar navigation
  $$('.tab-bar .tab[data-page]').forEach(tab => {
    tab.addEventListener('click', () => switchPage(tab.dataset.page));
  });

  // Add record button
  $('#btn-add-record').addEventListener('click', openAddPage);

  // Month selector
  $('#month-selector').addEventListener('click', showMonthPicker);

  // View all records
  $('#btn-view-all').addEventListener('click', () => switchPage('records'));

  // Accounts button
  $('#btn-accounts').addEventListener('click', () => switchPage('accounts'));

  // Quick entry
  $('#btn-quick-entry').addEventListener('click', handleQuickEntry);
  $('#quick-entry-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleQuickEntry();
  });

  // Add recurring
  $('#btn-add-recurring').addEventListener('click', showRecurringModal);

  // Add budget
  $('#btn-add-budget').addEventListener('click', showBudgetModal);

  // Type tabs in add page
  $$('.type-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentType = tab.dataset.type;
      $$('.type-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedCategoryId = null;
      renderCategoryGrid();
    });
  });

  // Filter buttons
  $$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterType = btn.dataset.filter;
      $$('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderRecords();
    });
  });

  // Number pad
  $$('.numpad-key').forEach(key => {
    key.addEventListener('click', () => handleNumpad(key.dataset.key));
  });

  // Keyboard support for numpad
  document.addEventListener('keydown', (e) => {
    if (!document.querySelector('#page-add.active')) return;
    if (e.key >= '0' && e.key <= '9') handleNumpad(e.key);
    if (e.key === '.') handleNumpad('.');
    if (e.key === 'Backspace') handleNumpad('del');
    if (e.key === 'Enter') handleNumpad('ok');
  });

  // Load data
  loadAll();
});
