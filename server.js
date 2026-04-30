const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8901;

// --- Local date helper ---
function localDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}
function todayStr() { return localDateStr(new Date()); }

// --- Data ---
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// --- DB ---
let _cache = null;

function loadDB() {
  if (_cache) return _cache;
  try {
    if (fs.existsSync(DB_FILE)) {
      _cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      return _cache;
    }
  } catch (e) {}
  _cache = {
    accounts: [],    // 账户: { id, name, type, balance, icon, color, createdAt }
    categories: [],  // 分类: { id, name, type, icon, color, sort }
    records: [],     // 记录: { id, amount, type, categoryId, accountId, note, date, time, createdAt }
    budgets: [],     // 预算: { id, categoryId, amount, month, createdAt }
    recurring: [],   // 周期性: { id, amount, type, categoryId, accountId, note, frequency, dayOfMonth, dayOfWeek, nextDate, lastGenerated, enabled, createdAt }
  };
  saveDB(_cache);
  return _cache;
}

function saveDB(data) {
  _cache = data;
  const tmp = DB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('saveDB error:', e.message);
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (e2) {
      console.error('saveDB fallback error:', e2.message);
    }
  }
}

// --- Init default data ---
function initDefaults() {
  const db = loadDB();

  // Default accounts
  if (!db.accounts || db.accounts.length === 0) {
    db.accounts = [
      { id: 'acc_1', name: '现金', type: 'cash', balance: 0, icon: '💵', color: '#FF6B6B', createdAt: new Date().toISOString() },
      { id: 'acc_2', name: '微信', type: 'wechat', balance: 0, icon: '💚', color: '#07C160', createdAt: new Date().toISOString() },
      { id: 'acc_3', name: '支付宝', type: 'alipay', balance: 0, icon: '💙', color: '#1677FF', createdAt: new Date().toISOString() },
      { id: 'acc_4', name: '银行卡', type: 'bank', balance: 0, icon: '💳', color: '#FFA500', createdAt: new Date().toISOString() },
    ];
  }

  // Default categories (expense)
  if (!db.categories || db.categories.length === 0) {
    db.categories = [
      // 支出
      { id: 'cat_1', name: '餐饮', type: 'expense', icon: '🍜', color: '#FF6B6B', sort: 1 },
      { id: 'cat_2', name: '交通', type: 'expense', icon: '🚇', color: '#FFA500', sort: 2 },
      { id: 'cat_3', name: '购物', type: 'expense', icon: '🛒', color: '#FF69B4', sort: 3 },
      { id: 'cat_4', name: '居住', type: 'expense', icon: '🏠', color: '#87CEEB', sort: 4 },
      { id: 'cat_5', name: '娱乐', type: 'expense', icon: '🎮', color: '#DDA0DD', sort: 5 },
      { id: 'cat_6', name: '医疗', type: 'expense', icon: '💊', color: '#90EE90', sort: 6 },
      { id: 'cat_7', name: '教育', type: 'expense', icon: '📚', color: '#4ECDC4', sort: 7 },
      { id: 'cat_8', name: '通讯', type: 'expense', icon: '📱', color: '#45B7D1', sort: 8 },
      { id: 'cat_9', name: '服饰', type: 'expense', icon: '👔', color: '#96CEB4', sort: 9 },
      { id: 'cat_10', name: '美容', type: 'expense', icon: '💄', color: '#FF69B4', sort: 10 },
      { id: 'cat_11', name: '人情', type: 'expense', icon: '🎁', color: '#FFD93D', sort: 11 },
      { id: 'cat_12', name: '其他', type: 'expense', icon: '📦', color: '#95A5A6', sort: 99 },
      // 收入
      { id: 'cat_20', name: '工资', type: 'income', icon: '💰', color: '#2ECC71', sort: 1 },
      { id: 'cat_21', name: '兼职', type: 'income', icon: '💼', color: '#3498DB', sort: 2 },
      { id: 'cat_22', name: '理财', type: 'income', icon: '📈', color: '#E67E22', sort: 3 },
      { id: 'cat_23', name: '红包', type: 'income', icon: '🧧', color: '#E74C3C', sort: 4 },
      { id: 'cat_24', name: '其他', type: 'income', icon: '💵', color: '#95A5A6', sort: 99 },
    ];
  }

  // Default budgets
  if (!db.budgets) db.budgets = [];

  saveDB(db);
}

initDefaults();

// --- Middleware ---
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Health ---
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', version: '1.0.0', time: new Date().toISOString() });
});

// ============================================
// Accounts API
// ============================================

app.get('/api/accounts', (req, res) => {
  const db = loadDB();
  // NOTE: Balance is recalculated from all records on every request.
  // This is acceptable for personal use with a small dataset, but may need
  // caching or pre-computation if the record count grows significantly.
  const accounts = db.accounts.map(acc => {
    let balance = 0;
    (db.records || []).forEach(r => {
      if (r.accountId === acc.id) {
        balance += r.type === 'income' ? r.amount : -r.amount;
      }
    });
    return { ...acc, balance: Math.round(balance * 100) / 100 };
  });
  res.json({ success: true, data: accounts });
});

app.post('/api/accounts', (req, res) => {
  const { name, type, icon, color } = req.body;
  if (!name) return res.status(400).json({ success: false, message: '请输入账户名称' });
  const db = loadDB();
  const account = {
    id: 'acc_' + uuidv4().slice(0, 8),
    name: name.trim(),
    type: type || 'other',
    balance: 0,
    icon: icon || '💰',
    color: color || '#3498DB',
    createdAt: new Date().toISOString()
  };
  db.accounts.push(account);
  saveDB(db);
  res.json({ success: true, data: account });
});

app.put('/api/accounts/:id', (req, res) => {
  const db = loadDB();
  const acc = db.accounts.find(a => a.id === req.params.id);
  if (!acc) return res.status(404).json({ success: false, message: '账户不存在' });
  const { name, type, icon, color } = req.body;
  if (name !== undefined) acc.name = name;
  if (type !== undefined) acc.type = type;
  if (icon !== undefined) acc.icon = icon;
  if (color !== undefined) acc.color = color;
  saveDB(db);
  res.json({ success: true, data: acc });
});

app.delete('/api/accounts/:id', (req, res) => {
  const db = loadDB();
  const acc = db.accounts.find(a => a.id === req.params.id);
  if (!acc) return res.status(404).json({ success: false, message: '账户不存在' });
  const associatedCount = (db.records || []).filter(r => r.accountId === req.params.id).length;
  if (associatedCount > 0) {
    return res.status(400).json({
      success: false,
      message: `该账户下有 ${associatedCount} 条记录，请先删除或转移相关记录后再删除账户`
    });
  }
  db.accounts = db.accounts.filter(a => a.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// ============================================
// Categories API
// ============================================

app.get('/api/categories', (req, res) => {
  const db = loadDB();
  const { type } = req.query;
  let cats = db.categories || [];
  if (type) cats = cats.filter(c => c.type === type);
  cats.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  res.json({ success: true, data: cats });
});

app.post('/api/categories', (req, res) => {
  const { name, type, icon, color, sort } = req.body;
  if (!name || !type) return res.status(400).json({ success: false, message: '请填写分类名称和类型' });
  const db = loadDB();
  const cat = {
    id: 'cat_' + uuidv4().slice(0, 8),
    name: name.trim(),
    type: type,
    icon: icon || '📦',
    color: color || '#95A5A6',
    sort: sort || 50
  };
  db.categories.push(cat);
  saveDB(db);
  res.json({ success: true, data: cat });
});

app.put('/api/categories/:id', (req, res) => {
  const db = loadDB();
  const cat = db.categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ success: false, message: '分类不存在' });
  const { name, icon, color, sort } = req.body;
  if (name !== undefined) cat.name = name;
  if (icon !== undefined) cat.icon = icon;
  if (color !== undefined) cat.color = color;
  if (sort !== undefined) cat.sort = sort;
  saveDB(db);
  res.json({ success: true, data: cat });
});

app.delete('/api/categories/:id', (req, res) => {
  const db = loadDB();
  db.categories = db.categories.filter(c => c.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// ============================================
// Records API
// ============================================

app.get('/api/records', (req, res) => {
  const db = loadDB();
  let records = db.records || [];

  // Filters
  const { type, accountId, categoryId, startDate, endDate, keyword } = req.query;
  if (type) records = records.filter(r => r.type === type);
  if (accountId) records = records.filter(r => r.accountId === accountId);
  if (categoryId) records = records.filter(r => r.categoryId === categoryId);
  if (startDate) records = records.filter(r => r.date >= startDate);
  if (endDate) records = records.filter(r => r.date <= endDate);
  if (keyword) records = records.filter(r => r.note && r.note.includes(keyword));

  // Sort by date desc, then by createdAt desc
  records.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  // Enrich with category and account info
  const cats = db.categories || [];
  const accs = db.accounts || [];
  const enriched = records.map(r => ({
    ...r,
    categoryName: (cats.find(c => c.id === r.categoryId) || {}).name || '未分类',
    categoryIcon: (cats.find(c => c.id === r.categoryId) || {}).icon || '📦',
    accountName: (accs.find(a => a.id === r.accountId) || {}).name || '未知',
  }));

  res.json({ success: true, data: enriched });
});

app.post('/api/records', (req, res) => {
  const { amount, type, categoryId, accountId, note, date, time } = req.body;
  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: '请输入正确的金额' });
  }
  if (!type || !['income', 'expense'].includes(type)) {
    return res.status(400).json({ success: false, message: '请选择收入或支出' });
  }

  const db = loadDB();
  const record = {
    id: 'rec_' + uuidv4().slice(0, 8),
    amount: Math.round(Number(amount) * 100) / 100,
    type: type,
    categoryId: categoryId || null,
    accountId: accountId || 'acc_1',
    note: (note || '').trim(),
    date: date || todayStr(),
    time: time || '',
    createdAt: new Date().toISOString()
  };

  db.records.push(record);
  saveDB(db);

  // Return enriched record
  const cats = db.categories || [];
  const accs = db.accounts || [];
  const enriched = {
    ...record,
    categoryName: (cats.find(c => c.id === record.categoryId) || {}).name || '未分类',
    categoryIcon: (cats.find(c => c.id === record.categoryId) || {}).icon || '📦',
    accountName: (accs.find(a => a.id === record.accountId) || {}).name || '未知',
  };

  res.json({ success: true, data: enriched });
});

app.put('/api/records/:id', (req, res) => {
  const db = loadDB();
  const record = (db.records || []).find(r => r.id === req.params.id);
  if (!record) return res.status(404).json({ success: false, message: '记录不存在' });

  const { amount, type, categoryId, accountId, note, date, time } = req.body;
  if (amount !== undefined) record.amount = Math.round(Number(amount) * 100) / 100;
  if (type !== undefined) record.type = type;
  if (categoryId !== undefined) record.categoryId = categoryId;
  if (accountId !== undefined) record.accountId = accountId;
  if (note !== undefined) record.note = note;
  if (date !== undefined) record.date = date;
  if (time !== undefined) record.time = time;

  saveDB(db);
  res.json({ success: true, data: record });
});

app.delete('/api/records/:id', (req, res) => {
  const db = loadDB();
  db.records = (db.records || []).filter(r => r.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// ============================================
// Statistics API
// ============================================

// Monthly summary: { income, expense, balance, byCategory }
app.get('/api/stats/monthly', (req, res) => {
  const db = loadDB();
  const { month } = req.query; // format: 2026-04
  const targetMonth = month || todayStr().slice(0, 7);

  const records = (db.records || []).filter(r => r.date && r.date.startsWith(targetMonth));

  let totalIncome = 0, totalExpense = 0;
  const byCategory = {};

  records.forEach(r => {
    if (r.type === 'income') {
      totalIncome += r.amount;
    } else {
      totalExpense += r.amount;
    }
    const key = r.categoryId || 'unknown';
    if (!byCategory[key]) byCategory[key] = { amount: 0, count: 0 };
    byCategory[key].amount += r.amount;
    byCategory[key].count++;
  });

  // Enrich category names
  const cats = db.categories || [];
  const enrichedByCategory = {};
  for (const [catId, data] of Object.entries(byCategory)) {
    const cat = cats.find(c => c.id === catId);
    enrichedByCategory[catId] = {
      ...data,
      name: cat ? cat.name : '未分类',
      icon: cat ? cat.icon : '📦',
      color: cat ? cat.color : '#95A5A6',
    };
  }

  // Daily trend
  const dailyTrend = {};
  records.forEach(r => {
    if (!r.date) return;
    if (!dailyTrend[r.date]) dailyTrend[r.date] = { income: 0, expense: 0 };
    if (r.type === 'income') dailyTrend[r.date].income += r.amount;
    else dailyTrend[r.date].expense += r.amount;
  });

  // Budget info
  const budgets = (db.budgets || []).filter(b => b.month === targetMonth);
  const budgetInfo = budgets.map(b => {
    const spent = records.filter(r => r.type === 'expense' && r.categoryId === b.categoryId)
      .reduce((sum, r) => sum + r.amount, 0);
    const cat = cats.find(c => c.id === b.categoryId);
    return {
      categoryId: b.categoryId,
      categoryName: cat ? cat.name : '未知',
      categoryIcon: cat ? cat.icon : '📦',
      budget: b.amount,
      spent: Math.round(spent * 100) / 100,
      remaining: Math.round((b.amount - spent) * 100) / 100,
    };
  });

  res.json({
    success: true,
    data: {
      month: targetMonth,
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpense: Math.round(totalExpense * 100) / 100,
      balance: Math.round((totalIncome - totalExpense) * 100) / 100,
      byCategory: enrichedByCategory,
      dailyTrend,
      budgets: budgetInfo,
    }
  });
});

// Yearly summary
app.get('/api/stats/yearly', (req, res) => {
  const db = loadDB();
  const { year } = req.query;
  const targetYear = year || String(new Date().getFullYear());

  const records = (db.records || []).filter(r => r.date && r.date.startsWith(targetYear));

  const byMonth = {};
  for (let m = 1; m <= 12; m++) {
    const key = String(m).padStart(2, '0');
    byMonth[key] = { income: 0, expense: 0 };
  }

  records.forEach(r => {
    const month = r.date.slice(5, 7);
    if (byMonth[month]) {
      if (r.type === 'income') byMonth[month].income += r.amount;
      else byMonth[month].expense += r.amount;
    }
  });

  // Round values
  for (const key of Object.keys(byMonth)) {
    byMonth[key].income = Math.round(byMonth[key].income * 100) / 100;
    byMonth[key].expense = Math.round(byMonth[key].expense * 100) / 100;
  }

  res.json({ success: true, data: { year: targetYear, byMonth } });
});

// ============================================
// Budget API
// ============================================

app.get('/api/budgets', (req, res) => {
  const db = loadDB();
  const { month } = req.query;
  let budgets = db.budgets || [];
  if (month) budgets = budgets.filter(b => b.month === month);

  // Enrich with spent amount
  const cats = db.categories || [];
  const records = db.records || [];
  const enriched = budgets.map(b => {
    const spent = records
      .filter(r => r.type === 'expense' && r.categoryId === b.categoryId && r.date && r.date.startsWith(b.month))
      .reduce((sum, r) => sum + r.amount, 0);
    const cat = cats.find(c => c.id === b.categoryId);
    return {
      ...b,
      categoryName: cat ? cat.name : '未知',
      categoryIcon: cat ? cat.icon : '📦',
      spent: Math.round(spent * 100) / 100,
      remaining: Math.round((b.amount - spent) * 100) / 100,
    };
  });

  res.json({ success: true, data: enriched });
});

app.post('/api/budgets', (req, res) => {
  const { categoryId, amount, month } = req.body;
  if (!categoryId || !amount || !month) {
    return res.status(400).json({ success: false, message: '请填写完整信息' });
  }
  const db = loadDB();

  // Check if budget already exists for this category and month
  const existing = (db.budgets || []).find(b => b.categoryId === categoryId && b.month === month);
  if (existing) {
    existing.amount = Number(amount);
    saveDB(db);
    return res.json({ success: true, data: existing });
  }

  const budget = {
    id: 'bud_' + uuidv4().slice(0, 8),
    categoryId,
    amount: Math.round(Number(amount) * 100) / 100,
    month,
    createdAt: new Date().toISOString()
  };
  db.budgets.push(budget);
  saveDB(db);
  res.json({ success: true, data: budget });
});

app.delete('/api/budgets/:id', (req, res) => {
  const db = loadDB();
  db.budgets = (db.budgets || []).filter(b => b.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// ============================================
// Data Management API
// ============================================

// Export all data
app.get('/api/export', (req, res) => {
  const db = loadDB();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=potato-money-export-${todayStr()}.json`);
  // Only export data, not metadata
  const exportData = {
    accounts: db.accounts,
    categories: db.categories,
    records: db.records,
    budgets: db.budgets,
    recurring: db.recurring,
    exportDate: new Date().toISOString()
  };
  res.json(exportData);
});

// Import data
app.post('/api/import', (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records)) {
    return res.status(400).json({ success: false, message: '无效的数据格式' });
  }
  // Limit import size to prevent abuse
  if (records.length > 10000) {
    return res.status(400).json({ success: false, message: '单次导入不能超过10000条记录' });
  }
  // Validate each record has required fields
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r.amount || isNaN(Number(r.amount)) || Number(r.amount) <= 0) {
      return res.status(400).json({ success: false, message: `第 ${i + 1} 条记录金额无效` });
    }
    if (!r.type || !['income', 'expense'].includes(r.type)) {
      return res.status(400).json({ success: false, message: `第 ${i + 1} 条记录类型无效（需要 income 或 expense）` });
    }
    if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      return res.status(400).json({ success: false, message: `第 ${i + 1} 条记录日期无效（格式：YYYY-MM-DD）` });
    }
  }
  const db = loadDB();
  db.records = [...(db.records || []), ...records];
  saveDB(db);
  res.json({ success: true, message: `已导入 ${records.length} 条记录` });
});

// ============================================
// Quick Entry API (Natural Language Parser)
// ============================================

// Category keyword mapping
const CATEGORY_KEYWORDS = {
  expense: {
    'cat_1': ['饭', '午饭', '晚饭', '早饭', '早餐', '午餐', '晚餐', '外卖', '吃', '喝', '奶茶', '咖啡', '水果', '零食', '烧烤', '火锅', '面条', '米饭', '快餐', '食堂', '小吃', '饮料', '茶', '酒', '餐饮', '美食'],
    'cat_2': ['打车', '地铁', '公交', '出租', '滴滴', '高铁', '火车', '飞机', '加油', '停车', '过路费', '交通', '骑行', '单车', '走路'],
    'cat_3': ['超市', '网购', '淘宝', '京东', '拼多多', '购物', '买', '商场', '日用品', '洗衣液', '纸巾'],
    'cat_4': ['房租', '水电', '物业', '燃气', '暖气', '居住', '维修', '装修', '家具', '家电'],
    'cat_5': ['电影', '游戏', '唱歌', 'KTV', '旅游', '门票', '娱乐', '演出', '酒吧', '棋牌'],
    'cat_6': ['医院', '药', '看病', '挂号', '医疗', '体检', '牙', '眼科'],
    'cat_7': ['学费', '培训', '课程', '书', '教育', '考试', '文具'],
    'cat_8': ['话费', '流量', '宽带', '充值', '通讯', '会员', 'VIP', '视频会员', '音乐会员'],
    'cat_9': ['衣服', '裤子', '鞋', '帽子', '服饰', '外套', 'T恤', '裙子'],
    'cat_10': ['化妆', '护肤', '美容', '美甲', '口红', '香水'],
    'cat_11': ['红包', '礼物', '份子钱', '人情', '随礼', '请客', '送'],
    'cat_12': ['其他', '杂项', ' miscellaneous'],
  },
  income: {
    'cat_20': ['工资', '薪资', '月薪', '底薪', 'salary'],
    'cat_21': ['兼职', '副业', '外快', 'freelance', '接单'],
    'cat_22': ['理财', '利息', '分红', '股票', '基金', '收益', '投资'],
    'cat_23': ['红包', '微信红包', '转账'],
    'cat_24': ['其他收入', '中奖', '退款', '返现'],
  }
};

// Chinese number mapping
const CN_NUMS = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '百': 100, '千': 1000, '万': 10000 };

function parseChineseAmount(str) {
  // Try to convert Chinese numbers like "三十五" to 35
  if (!str) return 0;
  // Simple: just use parseFloat if it's already a number
  const num = parseFloat(str);
  if (!isNaN(num)) return num;

  // Chinese number parsing
  let result = 0, current = 0, hasWan = false;
  for (const ch of str) {
    if (ch === '万') { result = (result + current) * 10000; current = 0; hasWan = true; }
    else if (ch === '千') { result += current * 1000; current = 0; }
    else if (ch === '百') { result += current * 100; current = 0; }
    else if (ch === '十') { result += (current || 1) * 10; current = 0; }
    else if (CN_NUMS[ch] !== undefined) { current = CN_NUMS[ch]; }
  }
  result += current;
  return result;
}

function parseQuickEntry(text, categories) {
  if (!text || !text.trim()) return null;
  text = text.trim();

  // Determine type: 收入 keywords
  let type = 'expense';
  const incomeKeywords = ['工资', '薪资', '收入', '兼职', '红包', '理财', '利息', '分红', '退款', '返现', '转账', '中奖', '副业', '外快'];
  for (const kw of incomeKeywords) {
    if (text.includes(kw)) { type = 'income'; break; }
  }

  // Extract amount - patterns: "35", "¥35", "35元", "花了35", "35.5"
  let amount = 0;
  let note = text;

  // Pattern 1: ¥123 or ￥123
  let m = text.match(/[¥￥]\s*(\d+\.?\d*)/);
  if (m) { amount = parseFloat(m[1]); }
  else {
    // Pattern 2: "35元" or "35块" or "35.5元"
    m = text.match(/(\d+\.?\d*)\s*[元块]/);
    if (m) { amount = parseFloat(m[1]); }
    else {
      // Pattern 3: "花了35" or "花费35" or "35"
      m = text.match(/(?:花|花费|花了|用了|付了|交了|充了|买了|吃|打|坐)\w*?(\d+\.?\d*)/);
      if (m) { amount = parseFloat(m[1]); }
      else {
        // Pattern 4: just a number
        m = text.match(/(\d+\.?\d*)/);
        if (m) { amount = parseFloat(m[1]); }
        else {
          // Pattern 5: Chinese number like "三十五"
          const cnMatch = text.match(/([零一二三四五六七八九十百千万]+)/);
          if (cnMatch) { amount = parseChineseAmount(cnMatch[1]); }
        }
      }
    }
  }

  // If no amount found, return null
  if (amount <= 0 || isNaN(amount)) return null;

  // Try to detect category from keywords
  let categoryId = null;
  const catKeywords = CATEGORY_KEYWORDS[type] || CATEGORY_KEYWORDS.expense;
  for (const [catId, keywords] of Object.entries(catKeywords)) {
    for (const kw of keywords) {
      if (text.includes(kw)) { categoryId = catId; break; }
    }
    if (categoryId) break;
  }

  // If no category matched, use defaults
  if (!categoryId) {
    categoryId = type === 'expense' ? 'cat_12' : 'cat_24'; // 其他
  }

  // Remove amount/price patterns from note
  let cleanNote = text
    .replace(/[¥￥]\s*\d+\.?\d*/g, '')
    .replace(/\d+\.?\d*\s*[元块]?/g, '')
    .replace(/^[花花费了用了付了交了充了买了吃打坐]/, '')
    .replace(/[花花费了用了付了交了充了买了]$/, '')
    .trim();

  // If note is too short or just numbers, use the original but clean
  if (!cleanNote || cleanNote.length < 1) cleanNote = text;

  return {
    amount: Math.round(amount * 100) / 100,
    type,
    categoryId,
    note: cleanNote,
  };
}

app.post('/api/quick-entry', (req, res) => {
  const { text, accountId } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, message: '请输入记账内容' });
  }

  const db = loadDB();
  const parsed = parseQuickEntry(text, db.categories);
  if (!parsed) {
    return res.status(400).json({ success: false, message: '无法识别金额，请输入如"午饭35"或"打车48"' });
  }

  const record = {
    id: 'rec_' + uuidv4().slice(0, 8),
    amount: parsed.amount,
    type: parsed.type,
    categoryId: parsed.categoryId,
    accountId: accountId || 'acc_1',
    note: parsed.note,
    date: todayStr(),
    time: new Date().toTimeString().slice(0, 5),
    createdAt: new Date().toISOString()
  };

  db.records.push(record);
  saveDB(db);

  // Return enriched record
  const cats = db.categories || [];
  const accs = db.accounts || [];
  const enriched = {
    ...record,
    categoryName: (cats.find(c => c.id === record.categoryId) || {}).name || '未分类',
    categoryIcon: (cats.find(c => c.id === record.categoryId) || {}).icon || '📦',
    accountName: (accs.find(a => a.id === record.accountId) || {}).name || '未知',
  };

  res.json({ success: true, data: enriched, parsed: { amount: parsed.amount, type: parsed.type, category: enriched.categoryName } });
});

// ============================================
// Recurring Records API
// ============================================

app.get('/api/recurring', (req, res) => {
  const db = loadDB();
  const cats = db.categories || [];
  const accs = db.accounts || [];
  const enriched = (db.recurring || []).map(r => ({
    ...r,
    categoryName: (cats.find(c => c.id === r.categoryId) || {}).name || '未分类',
    categoryIcon: (cats.find(c => c.id === r.categoryId) || {}).icon || '📦',
    accountName: (accs.find(a => a.id === r.accountId) || {}).name || '未知',
    frequencyText: r.frequency === 'monthly' ? '每月' : r.frequency === 'weekly' ? '每周' : r.frequency === 'daily' ? '每天' : r.frequency === 'yearly' ? '每年' : r.frequency,
  }));
  res.json({ success: true, data: enriched });
});

app.post('/api/recurring', (req, res) => {
  const { amount, type, categoryId, accountId, note, frequency, dayOfMonth, dayOfWeek } = req.body;
  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: '请输入正确的金额' });
  }
  if (!type || !['income', 'expense'].includes(type)) {
    return res.status(400).json({ success: false, message: '请选择收入或支出' });
  }
  if (!frequency || !['daily', 'weekly', 'monthly', 'yearly'].includes(frequency)) {
    return res.status(400).json({ success: false, message: '请选择频率' });
  }

  const db = loadDB();
  const now = new Date();
  const nextDate = calculateNextDate(frequency, dayOfMonth, dayOfWeek, now);

  const recurring = {
    id: 'recr_' + uuidv4().slice(0, 8),
    amount: Math.round(Number(amount) * 100) / 100,
    type,
    categoryId: categoryId || null,
    accountId: accountId || 'acc_1',
    note: (note || '').trim(),
    frequency,
    dayOfMonth: frequency === 'monthly' || frequency === 'yearly' ? (dayOfMonth || now.getDate()) : null,
    dayOfWeek: frequency === 'weekly' ? (dayOfWeek || now.getDay()) : null,
    nextDate: nextDate,
    lastGenerated: null,
    enabled: true,
    createdAt: new Date().toISOString()
  };

  if (!db.recurring) db.recurring = [];
  db.recurring.push(recurring);
  saveDB(db);

  res.json({ success: true, data: recurring });
});

app.put('/api/recurring/:id', (req, res) => {
  const db = loadDB();
  const rec = (db.recurring || []).find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ success: false, message: '周期性记录不存在' });

  const { amount, type, categoryId, accountId, note, frequency, dayOfMonth, dayOfWeek, enabled } = req.body;
  if (amount !== undefined) rec.amount = Math.round(Number(amount) * 100) / 100;
  if (type !== undefined) rec.type = type;
  if (categoryId !== undefined) rec.categoryId = categoryId;
  if (accountId !== undefined) rec.accountId = accountId;
  if (note !== undefined) rec.note = note;
  if (frequency !== undefined) rec.frequency = frequency;
  if (dayOfMonth !== undefined) rec.dayOfMonth = dayOfMonth;
  if (dayOfWeek !== undefined) rec.dayOfWeek = dayOfWeek;
  if (enabled !== undefined) rec.enabled = enabled;

  // Recalculate nextDate
  rec.nextDate = calculateNextDate(rec.frequency, rec.dayOfMonth, rec.dayOfWeek, new Date());

  saveDB(db);
  res.json({ success: true, data: rec });
});

app.delete('/api/recurring/:id', (req, res) => {
  const db = loadDB();
  db.recurring = (db.recurring || []).filter(r => r.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// Generate records from recurring
app.post('/api/recurring/generate', (req, res) => {
  const db = loadDB();
  const today = todayStr();
  const generated = [];

  (db.recurring || []).forEach(rec => {
    if (!rec.enabled) return;
    if (!rec.nextDate || rec.nextDate > today) return;

    // Generate record(s) up to today (max 100 iterations to prevent infinite loop)
    let genDate = rec.nextDate;
    let iterations = 0;
    while (genDate <= today && iterations < 100) {
      iterations++;
      const record = {
        id: 'rec_' + uuidv4().slice(0, 8),
        amount: rec.amount,
        type: rec.type,
        categoryId: rec.categoryId,
        accountId: rec.accountId,
        note: rec.note || (rec.frequency === 'monthly' ? '月度自动' : rec.frequency === 'weekly' ? '周度自动' : '日常自动'),
        date: genDate,
        time: '00:00',
        createdAt: new Date().toISOString(),
        recurring: rec.id,
      };
      db.records.push(record);
      generated.push(record);

      // Calculate next occurrence
      genDate = calculateNextDate(rec.frequency, rec.dayOfMonth, rec.dayOfWeek, new Date(genDate + 'T00:00:00'));
    }

    rec.nextDate = genDate;
    rec.lastGenerated = today;
  });

  if (generated.length > 0) {
    saveDB(db);
  }

  res.json({ success: true, data: { generated: generated.length, records: generated } });
});

function calculateNextDate(frequency, dayOfMonth, dayOfWeek, fromDate) {
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);

  switch (frequency) {
    case 'daily': {
      d.setDate(d.getDate() + 1);
      return localDateStr(d);
    }
    case 'weekly': {
      const targetDow = dayOfWeek !== null && dayOfWeek !== undefined ? dayOfWeek : 1;
      let daysAhead = targetDow - d.getDay();
      if (daysAhead <= 0) daysAhead += 7;
      d.setDate(d.getDate() + daysAhead);
      return localDateStr(d);
    }
    case 'monthly': {
      const targetDay = dayOfMonth || 1;
      d.setDate(targetDay);
      if (d <= fromDate) {
        d.setMonth(d.getMonth() + 1);
      }
      // Handle months with fewer days
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      if (targetDay > maxDay) d.setDate(maxDay);
      return localDateStr(d);
    }
    case 'yearly': {
      const targetDay = dayOfMonth || fromDate.getDate();
      const targetMonth = fromDate.getMonth();
      d.setFullYear(d.getFullYear() + 1);
      d.setMonth(targetMonth);
      d.setDate(targetDay);
      // Handle months with fewer days (e.g., Feb 30 → Feb 28)
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      if (targetDay > maxDay) d.setDate(maxDay);
      return localDateStr(d);
    }
    default:
      return localDateStr(d);
  }
}

// ============================================
// Global Error Handler
// ============================================

// 404 handler for unmatched API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

// Process-level error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// ============================================
// Fallback to index.html (SPA)
// ============================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`🥔 土豆记账 v1.1.0 已启动: http://localhost:${PORT}`);
});
