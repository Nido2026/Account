/**
 * app.js — Lógica principal de FinanzasApp
 * =========================================
 * Gestiona estado, navegación, renderizado,
 * gráficos Canvas, exportación CSV/PDF y auth.
 */

/* ============================================================
   CONSTANTES Y CONFIGURACIÓN
   ============================================================ */

/** Formato de moneda CLP */
const CLP = new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

/** Nombres de meses en español */
const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

/** Íconos emoji por categoría */
const CAT_ICONS = {
  'Alimentación': '🛒', 'Transporte': '🚌', 'Vivienda': '🏠',
  'Servicios': '⚡', 'Salud': '💊', 'Ocio': '🎬',
  'Educación': '📚', 'Ropa': '👕', 'Tecnología': '💻',
  'Otros': '📦', 'Sueldo': '💰', 'Freelance': '💼',
  'Inversión': '📈', 'Otros ingresos': '📬',
};

/** Paleta de colores para gráficos (tonos pastel sofisticados, acorde al tema cálido) */
const CHART_COLORS = [
  '#D98E73', '#7FA999', '#C9A66B', '#8C8FC4',
  '#5FA8A0', '#D9A5A0', '#A8B89B', '#C97B84',
  '#6FA8C9', '#B98ABF', '#9CA3AF', '#E0B354',
];

/* ============================================================
   ESTADO DE LA APLICACIÓN
   ============================================================ */

const state = {
  /** Todas las transacciones del usuario */
  transactions: [],
  /** Vista activa: 'dashboard' | 'transactions' | 'reports' */
  currentView: 'dashboard',
  /** Mes seleccionado (YYYY-MM) */
  selectedMonth: currentMonthStr(),
  /** Mes visible del calendario del formulario */
  calendarMonth: currentMonthStr(),
  /** Año visible del selector de mes */
  monthPickerYear: Number(currentMonthStr().slice(0, 4)),
  /** Botón que abrió el selector de mes */
  activeMonthPickerId: null,
  /** Filtros de la vista de transacciones */
  filters: { type: 'all', category: 'all', search: '' },
  /** true si hay una sesión activa (Supabase o offline) */
  isLoggedIn: false,
  /** true si es cuenta Supabase (vs offline) */
  isOnline: false,
  /** Transacción siendo editada (null = nueva) */
  editingId: null,
  /** Mutex para evitar guardados duplicados */
  isSaving: false,
  /** Referencia a resize observer de charts */
  resizeObserver: null,
};

/* ============================================================
   UTILIDADES DE FECHA Y FORMATO
   ============================================================ */

/** @returns {string} Mes actual como 'YYYY-MM' */
function currentMonthStr() {
  return new Date().toISOString().slice(0, 7);
}

/** @returns {string} Fecha de hoy como 'YYYY-DD-MM' */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Formatea un valor como moneda CLP.
 * @param {number} n
 * @returns {string}
 */
function fmtMoney(n) {
  return CLP.format(Math.round(Number(n) || 0));
}

/**
 * Formato compacto para ejes de gráficos.
 * @param {number} n
 * @returns {string}
 */
function fmtCompact(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/**
 * Formatea fecha 'YYYY-MM-DD' a 'DD/MM'.
 * @param {string} dateStr
 * @returns {string}
 */
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

/**
 * Formatea fecha 'YYYY-MM-DD' a 'DD/MM/YYYY'.
 * @param {string} dateStr
 * @returns {string}
 */
function fmtDateFull(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Formatea fecha 'YYYY-MM-DD' para mostrarla en el selector del formulario.
 * @param {string} dateStr
 * @returns {string}
 */
function fmtDateLong(dateStr) {
  if (!dateStr) return 'Seleccionar fecha';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('es-CL', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  }).replace(/\./g, '');
}

/**
 * Obtiene el label de un mes 'YYYY-MM' como 'Enero 2026'.
 * @param {string} monthStr
 * @returns {string}
 */
function fmtMonthLabel(monthStr) {
  if (!monthStr) return '';
  const [y, m] = monthStr.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * Convierte una fecha local a 'YYYY-MM-DD'.
 * @param {Date} date
 * @returns {string}
 */
function toDateValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Obtiene los últimos N meses desde el mes dado.
 * @param {string} fromMonth - 'YYYY-MM'
 * @param {number} count
 * @returns {string[]} Array de 'YYYY-MM'
 */
function lastNMonths(fromMonth, count) {
  const [y, m] = fromMonth.split('-').map(Number);
  const months = [];
  for (let i = count - 1; i >= 0; i--) {
    let month = m - i;
    let year  = y;
    while (month <= 0) { month += 12; year--; }
    months.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return months;
}

/* ============================================================
   CAPA DE DATOS
   ============================================================ */

/**
 * Carga todas las transacciones desde Supabase (o localStorage).
 * Actualiza el estado y dispara el renderizado completo.
 */
async function loadData() {
  showLoadingState(true);
  try {
    state.transactions = await loadTransactions(); // de supabase-client.js
  } catch (err) {
    console.error('[App] Error cargando transacciones:', err);
    state.transactions = [];
    showToast('Error al cargar datos', 'error');
  } finally {
    showLoadingState(false);
    renderAll();
  }
}

/** Muestra/oculta estado de carga en la UI */
function showLoadingState(loading) {
  // Por ahora simplificado; se puede expandir con skeletons
  document.body.style.cursor = loading ? 'wait' : 'default';
}

/* ============================================================
   FILTRADO Y CÁLCULOS
   ============================================================ */

/**
 * Devuelve las transacciones del mes seleccionado.
 * @param {string} [month] - Mes 'YYYY-MM', por defecto state.selectedMonth
 * @returns {Array}
 */
function transactionsForMonth(month = state.selectedMonth) {
  return state.transactions
    .filter(t => t.date?.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at?.localeCompare(a.created_at));
}

/**
 * Calcula totales de ingresos/gastos/balance.
 * @param {Array} txns
 * @returns {{income: number, expense: number, balance: number, rate: number}}
 */
function calcTotals(txns) {
  const income  = txns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = txns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;
  const rate    = income > 0 ? Math.round((balance / income) * 100) : 0;
  return { income, expense, balance, rate };
}

/**
 * Agrupa gastos por categoría.
 * @param {Array} txns
 * @returns {Array<{category, amount, count}>}
 */
function groupByCategory(txns) {
  const expenses = txns.filter(t => t.type === 'expense');
  const map = {};
  expenses.forEach(t => {
    if (!map[t.category]) map[t.category] = { amount: 0, count: 0 };
    map[t.category].amount += t.amount;
    map[t.category].count  += 1;
  });
  return Object.entries(map)
    .map(([category, { amount, count }]) => ({ category, amount, count }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Aplica los filtros de la vista de transacciones.
 * @param {Array} txns
 * @returns {Array}
 */
function applyFilters(txns) {
  let result = txns;
  if (state.filters.type !== 'all') {
    result = result.filter(t => t.type === state.filters.type);
  }
  if (state.filters.category !== 'all') {
    result = result.filter(t => t.category === state.filters.category);
  }
  if (state.filters.search) {
    const q = state.filters.search.toLowerCase();
    result = result.filter(t =>
      t.description?.toLowerCase().includes(q) ||
      t.category?.toLowerCase().includes(q) ||
      t.note?.toLowerCase().includes(q)
    );
  }
  return result;
}

/* ============================================================
   NAVEGACIÓN Y VISTAS
   ============================================================ */

const VIEWS = {
  dashboard:    { el: () => document.getElementById('dashboardView'),    title: 'Dashboard' },
  transactions: { el: () => document.getElementById('transactionsView'), title: 'Transacciones' },
  reports:      { el: () => document.getElementById('reportsView'),      title: 'Reportes' },
};

/**
 * Cambia la vista activa.
 * @param {string} view - 'dashboard' | 'transactions' | 'reports'
 */
function switchView(view) {
  if (!VIEWS[view] || state.currentView === view) return;

  // Ocultar vista actual
  const currentEl = VIEWS[state.currentView]?.el();
  if (currentEl) {
    currentEl.hidden = true;
    currentEl.classList.remove('active');
  }

  // Mostrar nueva vista
  state.currentView = view;
  const newEl = VIEWS[view].el();
  if (newEl) {
    newEl.hidden = false;
    newEl.classList.add('active');
    // Re-trigger animation
    newEl.style.animation = 'none';
    newEl.offsetHeight; // reflow
    newEl.style.animation = '';
  }

  // Actualizar estado de los nav items
  document.querySelectorAll('.nav-item').forEach(btn => {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  document.querySelectorAll('.bottom-nav-item[data-view]').forEach(btn => {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  // Actualizar título mobile
  const mobileTitle = document.getElementById('mobileTitle');
  if (mobileTitle) mobileTitle.textContent = VIEWS[view].title;

  // Renderizar la nueva vista
  if (view === 'dashboard')    renderDashboard();
  if (view === 'transactions') renderTransactions();
  if (view === 'reports')      renderReports();
}

/* ============================================================
   GESTIÓN DEL PERÍODO
   ============================================================ */

/**
 * Cambia el mes seleccionado y actualiza todos los controles de período.
 * @param {string} month - 'YYYY-MM'
 */
function setSelectedMonth(month) {
  if (!month) month = currentMonthStr();
  state.selectedMonth = month;

  // Sincronizar todos los pickers
  ['dashMonthPicker', 'txnMonthPicker', 'rptMonthPicker'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = fmtMonthLabel(month);
  });

  // Actualizar labels de período
  const label = fmtMonthLabel(month);
  setTextSafe('dashPeriodLabel', label);
  setTextSafe('rptPeriodLabel', label);

  // Renderizar vista activa
  if (state.currentView === 'dashboard')    renderDashboard();
  if (state.currentView === 'transactions') renderTransactions();
  if (state.currentView === 'reports')      renderReports();
}

/** Cierra el selector de mes. */
function closeMonthPicker() {
  const popover = document.getElementById('monthPopover');
  if (popover) popover.hidden = true;
  document.querySelectorAll('[data-month-picker]').forEach(btn => {
    btn.setAttribute('aria-expanded', 'false');
  });
  state.activeMonthPickerId = null;
}

/**
 * Abre el selector de mes bajo el botón indicado.
 * @param {HTMLElement} btn
 */
function openMonthPicker(btn) {
  const popover = document.getElementById('monthPopover');
  if (!popover || !btn) return;

  state.activeMonthPickerId = btn.id;
  state.monthPickerYear = Number(state.selectedMonth.slice(0, 4));
  renderMonthPicker();

  const rect = btn.getBoundingClientRect();
  const width = Math.min(336, window.innerWidth - 28);
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(14, Math.min(left, window.innerWidth - width - 14));
  let top = rect.bottom + 8;
  if (top + 292 > window.innerHeight) top = Math.max(14, rect.top - 300);

  popover.style.width = `${width}px`;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.hidden = false;

  document.querySelectorAll('[data-month-picker]').forEach(el => {
    el.setAttribute('aria-expanded', el === btn ? 'true' : 'false');
  });
}

/**
 * Alterna el selector de mes.
 * @param {HTMLElement} btn
 */
function toggleMonthPicker(btn) {
  const popover = document.getElementById('monthPopover');
  if (!popover || !btn) return;
  if (!popover.hidden && state.activeMonthPickerId === btn.id) {
    closeMonthPicker();
    return;
  }
  openMonthPicker(btn);
}

/** Renderiza el selector profesional de meses. */
function renderMonthPicker() {
  const yearEl = document.getElementById('monthPopoverYear');
  const grid = document.getElementById('monthPopoverGrid');
  if (!yearEl || !grid) return;

  const current = currentMonthStr();
  yearEl.textContent = String(state.monthPickerYear);
  grid.innerHTML = MONTH_NAMES.map((name, index) => {
    const month = `${state.monthPickerYear}-${String(index + 1).padStart(2, '0')}`;
    const classes = [
      'month-option',
      month === current ? 'current' : '',
      month === state.selectedMonth ? 'selected' : ''
    ].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-month="${month}" role="gridcell" aria-selected="${month === state.selectedMonth ? 'true' : 'false'}">${name.slice(0, 3)}.</button>`;
  }).join('');
}

/** Avanza al mes siguiente */
function nextMonth() {
  const [y, m] = state.selectedMonth.split('-').map(Number);
  let nm = m + 1, ny = y;
  if (nm > 12) { nm = 1; ny++; }
  setSelectedMonth(`${ny}-${String(nm).padStart(2, '0')}`);
}

/** Retrocede al mes anterior */
function prevMonth() {
  const [y, m] = state.selectedMonth.split('-').map(Number);
  let nm = m - 1, ny = y;
  if (nm < 1) { nm = 12; ny--; }
  setSelectedMonth(`${ny}-${String(nm).padStart(2, '0')}`);
}

/* ============================================================
   DASHBOARD
   ============================================================ */

/** Renderiza el dashboard completo para el mes seleccionado */
function renderDashboard() {
  const txns      = transactionsForMonth();
  const totals    = calcTotals(txns);
  const prevMonth = lastNMonths(state.selectedMonth, 2)[0];
  const prevTxns  = transactionsForMonth(prevMonth);
  const prevTotals = calcTotals(prevTxns);

  // Métricas
  setTextSafe('dashIncome',  fmtMoney(totals.income));
  setTextSafe('dashExpense', fmtMoney(totals.expense));
  setTextSafe('dashBalance', fmtMoney(totals.balance));
  setTextSafe('dashSavings', `${totals.rate}%`);

  // Colorear balance según positivo/negativo
  const balEl = document.getElementById('dashBalance');
  if (balEl) {
    balEl.style.color = totals.balance >= 0
      ? 'var(--balance-pos)'
      : 'var(--expense)';
  }

  // Deltas vs mes anterior
  renderDelta('dashIncomeDelta',  totals.income,  prevTotals.income);
  renderDelta('dashExpenseDelta', totals.expense, prevTotals.expense);

  // Gráficos
  requestAnimationFrame(() => {
    drawTrendChart('trendChart', 'trendEmpty');
    drawDonutChart('categoryChart', 'categoryEmpty', 'categoryLegend', txns);
  });

  // Últimas 8 transacciones
  renderRecentList(txns.slice(0, 8));
}

/**
 * Renderiza un indicador de cambio porcentual vs período anterior.
 * @param {string} id - ID del elemento
 * @param {number} current - Valor actual
 * @param {number} prev    - Valor anterior
 */
function renderDelta(id, current, prev) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!prev) { el.textContent = ''; return; }
  const pct = Math.round(((current - prev) / prev) * 100);
  const sign = pct >= 0 ? '+' : '';
  el.textContent = `${sign}${pct}% vs mes anterior`;
  el.className = `metric-delta ${pct >= 0 ? 'up' : 'down'}`;
}

/**
 * Renderiza la lista de últimas transacciones en el dashboard.
 * @param {Array} txns
 */
function renderRecentList(txns) {
  const el = document.getElementById('recentList');
  if (!el) return;

  if (!txns.length) {
    el.innerHTML = '<p class="empty-state">No hay transacciones este mes.</p>';
    return;
  }

  el.innerHTML = txns.map(t => `
    <div class="recent-item" role="listitem">
      <div class="recent-icon" aria-hidden="true"
           style="background: ${t.type === 'expense' ? 'var(--expense-bg)' : 'var(--income-bg)'}">
        ${CAT_ICONS[t.category] || '📦'}
      </div>
      <div class="recent-meta">
        <div class="recent-desc">${escHtml(t.description)}</div>
        <div class="recent-cat">${escHtml(t.category)}</div>
      </div>
      <span class="recent-amount ${t.type}" aria-label="${t.type === 'expense' ? 'Gasto' : 'Ingreso'} de ${fmtMoney(t.amount)}">
        ${t.type === 'expense' ? '-' : '+'}${fmtMoney(t.amount)}
      </span>
      <span class="recent-date" aria-label="Fecha ${fmtDateFull(t.date)}">${fmtDate(t.date)}</span>
    </div>
  `).join('');
}

/* ============================================================
   TRANSACCIONES
   ============================================================ */

/** Renderiza la tabla de transacciones con los filtros activos */
function renderTransactions() {
  const monthTxns  = transactionsForMonth();
  const filtered   = applyFilters(monthTxns);
  const tableBody  = document.getElementById('txnTableBody');
  const emptyEl    = document.getElementById('txnEmpty');
  const countEl    = document.getElementById('txnCount');
  const incomeEl   = document.getElementById('txnTotalIncome');
  const expenseEl  = document.getElementById('txnTotalExpense');

  if (!tableBody) return;

  // Contar y totales de la selección filtrada
  const totals = calcTotals(filtered);
  if (countEl) countEl.textContent = `${filtered.length} transacción${filtered.length !== 1 ? 'es' : ''}`;
  if (incomeEl)  incomeEl.textContent  = totals.income  ? `↑ ${fmtMoney(totals.income)}`  : '';
  if (expenseEl) expenseEl.textContent = totals.expense ? `↓ ${fmtMoney(totals.expense)}` : '';

  if (!filtered.length) {
    tableBody.innerHTML = '';
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  tableBody.innerHTML = filtered.map(t => `
    <tr>
      <td class="td-date" data-label="Fecha">${fmtDateFull(t.date)}</td>
      <td data-label="Descripción">
        <div class="td-desc" title="${escHtml(t.description)}">${escHtml(t.description)}</div>
        ${t.note ? `<div class="td-note">${escHtml(t.note)}</div>` : ''}
      </td>
      <td class="td-cat hide-mobile" data-label="Categoría">
        <span class="cat-icon" aria-hidden="true">${CAT_ICONS[t.category] || '📦'}</span>
        ${escHtml(t.category)}
      </td>
      <td class="hide-mobile" data-label="Tipo">
        <span class="badge ${t.type === 'income' ? 'badge-income' : 'badge-expense'}">
          ${t.type === 'income' ? 'Ingreso' : 'Gasto'}
        </span>
      </td>
      <td class="td-amount ${t.type}" data-label="Monto">
        ${t.type === 'expense' ? '-' : '+'}${fmtMoney(t.amount)}
      </td>
      <td class="td-actions">
        <button class="btn-edit" data-id="${t.id}" title="Editar transacción"
                aria-label="Editar ${escHtml(t.description)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </td>
    </tr>
  `).join('');
}

/* ============================================================
   REPORTES
   ============================================================ */

/** Renderiza la vista de reportes */
function renderReports() {
  const txns    = transactionsForMonth();
  const totals  = calcTotals(txns);
  const cats    = groupByCategory(txns);

  // Métricas
  setTextSafe('rptIncome',  fmtMoney(totals.income));
  setTextSafe('rptExpense', fmtMoney(totals.expense));
  setTextSafe('rptBalance', fmtMoney(totals.balance));
  setTextSafe('rptSavings', `${totals.rate}%`);

  const balEl = document.getElementById('rptBalance');
  if (balEl) balEl.style.color = totals.balance >= 0 ? 'var(--balance-pos)' : 'var(--expense)';

  // Tabla de categorías
  renderCategoryTable(cats, totals.expense);

  // Gráficos
  requestAnimationFrame(() => {
    drawDonutChart('rptDonutChart', 'rptDonutEmpty', 'rptDonutLegend', txns);
    drawTrendChart('rptTrendChart', null, 12);
  });

  const emptyEl = document.getElementById('rptEmpty');
  if (emptyEl) emptyEl.hidden = Boolean(txns.length);
}

/**
 * Renderiza la tabla de desglose por categoría en reportes.
 * @param {Array} cats    - [{category, amount, count}]
 * @param {number} total  - Total de gastos del mes
 */
function renderCategoryTable(cats, total) {
  const tbody = document.getElementById('rptCategoryTable');
  if (!tbody) return;

  if (!cats.length) {
    tbody.innerHTML = '';
    return;
  }

  tbody.innerHTML = cats.map((cat, i) => {
    const pct   = total > 0 ? Math.round((cat.amount / total) * 100) : 0;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    return `
      <tr>
        <td>
          <span class="cat-icon" aria-hidden="true">${CAT_ICONS[cat.category] || '📦'}</span>
          ${escHtml(cat.category)}
        </td>
        <td class="text-right td-amount expense">${fmtMoney(cat.amount)}</td>
        <td class="text-right hide-mobile">
          <strong style="color:${color}">${pct}%</strong>
        </td>
        <td class="text-right hide-mobile">${cat.count}</td>
        <td class="hide-mobile">
          <div class="cat-bar-wrap">
            <div class="cat-bar">
              <div class="cat-bar-fill" style="width:${pct}%;background:${color}"></div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/* ============================================================
   GRÁFICOS (Canvas puro — sin librerías externas)
   ============================================================ */

/**
 * Prepara un canvas para renderizado en alta resolución (HiDPI).
 * @param {HTMLCanvasElement} canvas
 * @returns {CanvasRenderingContext2D}
 */
function setupCanvas(canvas) {
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w    = Math.max(rect.width, 1);
  const h    = Math.max(rect.height, 1);
  canvas.width  = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

/**
 * Dibuja un rectángulo con esquinas redondeadas.
 * @param {CanvasRenderingContext2D} ctx
 */
function roundRect(ctx, x, y, w, h, r) {
  if (h <= 0) return;
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Dibuja el gráfico de torta (donut) de gastos por categoría.
 * @param {string} canvasId
 * @param {string|null} emptyId
 * @param {string} legendId
 * @param {Array} txns
 */
function drawDonutChart(canvasId, emptyId, legendId, txns) {
  const canvas  = document.getElementById(canvasId);
  const emptyEl = emptyId ? document.getElementById(emptyId) : null;
  const legendEl = document.getElementById(legendId);
  if (!canvas) return;

  const cats = groupByCategory(txns);
  const total = cats.reduce((s, c) => s + c.amount, 0);

  if (!cats.length || !total) {
    canvas.style.display = 'none';
    if (emptyEl) emptyEl.hidden = false;
    if (legendEl) legendEl.innerHTML = '';
    return;
  }
  canvas.style.display = '';
  if (emptyEl) emptyEl.hidden = true;

  const ctx = setupCanvas(canvas);
  const W   = canvas.getBoundingClientRect().width  || 210;
  const H   = canvas.getBoundingClientRect().height || 210;
  const cx  = W / 2, cy = H / 2;
  const R   = Math.min(W, H) / 2 * 0.86;
  const r   = R * 0.62;

  // Colores tomados del tema (fondo de tarjeta cálido / textos)
  const cs = getComputedStyle(document.documentElement);
  const bgCard   = (cs.getPropertyValue('--bg-card')  || '#FDFAF5').trim();
  const textMain = (cs.getPropertyValue('--text-1')   || '#2E2A24').trim();
  const textSoft = (cs.getPropertyValue('--text-2')   || '#6B6258').trim();

  /**
   * Dibuja el gráfico para una fracción `progress` (0 → 1) del total,
   * usado para animar la entrada de forma fluida.
   */
  function render(progress) {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.shadowColor = 'rgba(46, 42, 36, 0.18)';
    ctx.shadowBlur  = 10;

    let angle = -Math.PI / 2;
    const sweep = progress * 2 * Math.PI;
    cats.forEach((cat, i) => {
      const slice = (cat.amount / total) * sweep;
      if (slice <= 0) return;
      const color = CHART_COLORS[i % CHART_COLORS.length];

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();

      angle += slice;
    });
    ctx.restore();

    // Separadores finos entre segmentos (color del fondo de la tarjeta = efecto "flotante")
    angle = -Math.PI / 2;
    cats.forEach(cat => {
      const slice = (cat.amount / total) * sweep;
      if (slice <= 0) return;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, angle, angle + slice);
      ctx.closePath();
      ctx.strokeStyle = bgCard;
      ctx.lineWidth = 3;
      ctx.stroke();
      angle += slice;
    });

    // Círculo interior (cutout) — mismo tono que la tarjeta, look "flotante"
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fillStyle = bgCard;
    ctx.fill();

    // Texto central
    if (progress > 0.6) {
      const fade = Math.min((progress - 0.6) / 0.4, 1);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = textMain;
      const fontSize = Math.max(Math.floor(W * 0.1), 12);
      ctx.font = `800 ${fontSize}px Inter, sans-serif`;
      ctx.fillText(fmtCompact(total), cx, cy - 7);
      ctx.font = `500 ${Math.max(Math.floor(W * 0.062), 10)}px Inter, sans-serif`;
      ctx.fillStyle = textSoft;
      ctx.fillText('gastos', cx, cy + 11);
      ctx.restore();
    }
  }

  // Animación de entrada (ease-out, ~600ms)
  const duration = 600;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    render(eased);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  // Leyenda
  if (legendEl) {
    legendEl.innerHTML = cats.slice(0, 8).map((cat, i) => {
      const pct   = Math.round((cat.amount / total) * 100);
      const color = CHART_COLORS[i % CHART_COLORS.length];
      return `
        <div class="donut-legend-item">
          <span class="donut-legend-dot" style="background:${color}" aria-hidden="true"></span>
          <span class="donut-legend-name" title="${escHtml(cat.category)}">${escHtml(cat.category)}</span>
          <span class="donut-legend-pct">${pct}%</span>
        </div>
      `;
    }).join('');
  }
}

/**
 * Dibuja el gráfico de barras de tendencia mensual.
 * @param {string} canvasId
 * @param {string|null} emptyId
 * @param {number} [months=6] - Número de meses a mostrar
 */
function drawTrendChart(canvasId, emptyId, months = 6) {
  const canvas  = document.getElementById(canvasId);
  const emptyEl = emptyId ? document.getElementById(emptyId) : null;
  if (!canvas) return;

  const monthsArr = lastNMonths(state.selectedMonth, months);

  // Datos por mes
  const incomeData  = monthsArr.map(m => calcTotals(transactionsForMonth(m)).income);
  const expenseData = monthsArr.map(m => calcTotals(transactionsForMonth(m)).expense);
  const maxVal = Math.max(...incomeData, ...expenseData, 1);

  // ¿Hay datos?
  const hasData = incomeData.some(v => v > 0) || expenseData.some(v => v > 0);
  if (!hasData) {
    canvas.style.display = 'none';
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  canvas.style.display = '';
  if (emptyEl) emptyEl.hidden = true;

  const ctx = setupCanvas(canvas);
  const W   = canvas.getBoundingClientRect().width  || 300;
  const H   = canvas.getBoundingClientRect().height || 210;

  const pad = { top: 20, right: 16, bottom: 36, left: 52 };
  const cW  = W - pad.left - pad.right;
  const cH  = H - pad.top  - pad.bottom;
  const n   = monthsArr.length;

  ctx.clearRect(0, 0, W, H);

  // Líneas de cuadrícula horizontales
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const y = pad.top + cH - (i / gridCount) * cH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Labels eje Y
    ctx.fillStyle    = '#404864';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = `500 10px Inter, sans-serif`;
    ctx.fillText(fmtCompact(Math.round((maxVal * i) / gridCount)), pad.left - 6, y);
  }

  // Calcular ancho de barras
  const groupW = cW / n;
  const barW   = Math.min(Math.max(groupW * 0.28, 6), 18);
  const gap    = barW * 0.25;

  // Dibujar barras + labels X
  monthsArr.forEach((m, i) => {
    const groupX = pad.left + i * groupW + groupW / 2;
    const monthLabel = m.split('-')[1]; // '01' → '01'
    const shortLabel = MONTH_NAMES[parseInt(m.split('-')[1], 10) - 1].slice(0, 3);

    // Barra de ingresos (izquierda)
    const incH = Math.max((incomeData[i] / maxVal) * cH, 2);
    const incY = pad.top + cH - incH;
    ctx.fillStyle = 'rgba(16,217,160,0.85)';
    roundRect(ctx, groupX - barW - gap / 2, incY, barW, incH, 3);
    ctx.fill();

    // Barra de gastos (derecha)
    const expH = Math.max((expenseData[i] / maxVal) * cH, 2);
    const expY = pad.top + cH - expH;
    ctx.fillStyle = 'rgba(255,77,109,0.85)';
    roundRect(ctx, groupX + gap / 2, expY, barW, expH, 3);
    ctx.fill();

    // Highlight del mes seleccionado
    if (m === state.selectedMonth) {
      ctx.beginPath();
      ctx.rect(pad.left + i * groupW, pad.top, groupW, cH);
      ctx.fillStyle = 'rgba(124,92,252,0.05)';
      ctx.fill();
    }

    // Label eje X
    ctx.fillStyle    = m === state.selectedMonth ? '#a59cfc' : '#404864';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `${m === state.selectedMonth ? '700' : '500'} 10px Inter, sans-serif`;
    ctx.fillText(shortLabel, groupX, pad.top + cH + 8);
  });
}

/* ============================================================
   MODAL: NUEVA / EDITAR TRANSACCIÓN
   ============================================================ */

/**
 * Abre el modal de agregar transacción.
 */
function openModal() {
  state.editingId = null;
  const form = document.getElementById('txnForm');
  const modal = document.getElementById('txnModal');
  const title = document.getElementById('modalTitle');
  const error = document.getElementById('modalError');

  if (!form || !modal) return;

  // Resetear formulario
  form.reset();
  setFormDate(todayStr());
  document.getElementById('fCategory').value = 'Alimentación';

  setTextSafe('modalTitle', 'Nueva transacción');
  setTextSafe('saveModalBtn', null); // resetear spinner
  const saveBtnText = document.querySelector('#saveModalBtn .btn-text');
  if (saveBtnText) saveBtnText.textContent = 'Guardar';
  if (error) error.hidden = true;

  // Ocultar botón eliminar (solo visible en modo edición)
  const deleteBtn = document.getElementById('deleteModalBtn');
  if (deleteBtn) deleteBtn.hidden = true;

  modal.showModal();
  document.getElementById('fDescription')?.focus();
}

/** Cierra el modal */
function closeModal() {
  const modal = document.getElementById('txnModal');
  if (modal) modal.close();
  closeDateCalendar();
  state.editingId = null;
}

/**
 * Abre el modal en modo edición precargando los datos de la transacción.
 * @param {string} id - UUID de la transacción a editar
 */
function openEditModal(id) {
  const txn = state.transactions.find(t => t.id === id);
  if (!txn) return;

  state.editingId = id;
  const form  = document.getElementById('txnForm');
  const modal = document.getElementById('txnModal');
  const error = document.getElementById('modalError');
  if (!form || !modal) return;

  // Resetear y precargar
  form.reset();
  if (error) error.hidden = true;

  // Tipo (radio)
  const typeRadio = form.querySelector(`[name="txnType"][value="${txn.type}"]`);
  if (typeRadio) typeRadio.checked = true;

  // Campos de texto / número
  const fDesc = document.getElementById('fDescription');
  const fCat  = document.getElementById('fCategory');
  const fAmt  = document.getElementById('fAmount');
  const fNote = document.getElementById('fNote');
  if (fDesc) fDesc.value = txn.description;
  if (fCat)  fCat.value  = txn.category;
  if (fAmt)  fAmt.value  = txn.amount;
  if (fNote) fNote.value = txn.note || '';

  // Fecha
  setFormDate(txn.date);

  // Título y botón guardar
  setTextSafe('modalTitle', 'Editar transacción');
  const saveBtnText = document.querySelector('#saveModalBtn .btn-text');
  if (saveBtnText) saveBtnText.textContent = 'Actualizar';

  // Mostrar botón eliminar con el ID de esta transacción
  const deleteBtn = document.getElementById('deleteModalBtn');
  if (deleteBtn) {
    deleteBtn.hidden = false;
    deleteBtn.dataset.id = id;
  }

  modal.showModal();
  fDesc?.focus();
}

/**
 * Actualiza el valor de fecha del formulario y su etiqueta visible.
 * @param {string} value - Fecha 'YYYY-MM-DD'
 */
function setFormDate(value) {
  const input = document.getElementById('fDate');
  const label = document.getElementById('fDateLabel');
  if (input) input.value = value || '';
  if (label) label.textContent = fmtDateLong(value);
  if (value) state.calendarMonth = value.slice(0, 7);
  renderDateCalendar();
}

/** Abre el calendario del formulario. */
function openDateCalendar() {
  const panel = document.getElementById('dateCalendar');
  const btn = document.getElementById('fDateButton');
  const input = document.getElementById('fDate');
  if (!panel || !btn) return;

  state.calendarMonth = input?.value?.slice(0, 7) || currentMonthStr();
  renderDateCalendar();
  panel.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
}

/** Cierra el calendario del formulario. */
function closeDateCalendar() {
  const panel = document.getElementById('dateCalendar');
  const btn = document.getElementById('fDateButton');
  if (panel) panel.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

/** Alterna la visibilidad del calendario del formulario. */
function toggleDateCalendar() {
  const panel = document.getElementById('dateCalendar');
  if (!panel) return;
  panel.hidden ? openDateCalendar() : closeDateCalendar();
}

/**
 * Cambia el mes visible en el calendario.
 * @param {number} step - -1 mes anterior, 1 mes siguiente
 */
function shiftCalendarMonth(step) {
  const [y, m] = state.calendarMonth.split('-').map(Number);
  const next = new Date(y, m - 1 + step, 1);
  state.calendarMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  renderDateCalendar();
}

/** Renderiza el calendario del formulario. */
function renderDateCalendar() {
  const title = document.getElementById('dateCalendarTitle');
  const daysEl = document.getElementById('dateDays');
  const selected = document.getElementById('fDate')?.value || '';
  if (!title || !daysEl) return;

  const [year, month] = state.calendarMonth.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month - 1, 1 - startOffset);
  const today = todayStr();

  title.textContent = fmtMonthLabel(state.calendarMonth);

  daysEl.innerHTML = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    const value = toDateValue(date);
    const isCurrentMonth = date.getMonth() === month - 1;
    const classes = [
      'date-day',
      isCurrentMonth ? '' : 'outside',
      value === today ? 'today' : '',
      value === selected ? 'selected' : ''
    ].filter(Boolean).join(' ');

    return `
      <button type="button" class="${classes}" role="gridcell" data-date="${value}" aria-label="${fmtDateLong(value)}" aria-selected="${value === selected ? 'true' : 'false'}">
        ${date.getDate()}
      </button>
    `;
  }).join('');
}

/**
 * Maneja el envío del formulario de transacción.
 * @param {Event} e
 */
async function handleFormSubmit(e) {
  e.preventDefault();

  if (state.isSaving) return;

  const form       = e.target;
  const errorEl    = document.getElementById('modalError');
  const saveBtn    = document.getElementById('saveModalBtn');
  const saveBtnTxt = saveBtn?.querySelector('.btn-text');
  const saveBtnSpn = saveBtn?.querySelector('.btn-spinner');

  // Leer valores
  const type        = form.querySelector('[name="txnType"]:checked')?.value;
  const description = document.getElementById('fDescription').value.trim();
  const category    = document.getElementById('fCategory').value;
  const amount      = Number(document.getElementById('fAmount').value);
  const date        = document.getElementById('fDate').value;
  const note        = document.getElementById('fNote').value.trim();

  // Validar
  if (!description) return showFieldError(errorEl, 'La descripción es obligatoria.');
  if (!amount || amount <= 0) return showFieldError(errorEl, 'El monto debe ser mayor a 0.');
  if (!date) return showFieldError(errorEl, 'La fecha es obligatoria.');

  // Estado de carga
  state.isSaving = true;
  if (saveBtn)    saveBtn.disabled    = true;
  if (saveBtnTxt) saveBtnTxt.textContent = 'Guardando...';
  if (saveBtnSpn) saveBtnSpn.hidden   = false;
  if (errorEl)    errorEl.hidden      = true;

  try {
    if (state.editingId) {
      // ── MODO EDICIÓN ──────────────────────────────────────
      const { data, error } = await updateTransaction(state.editingId, { type, description, category, amount, date, note });
      if (error) throw error;

      // Actualizar en estado local
      const idx = state.transactions.findIndex(t => t.id === state.editingId);
      if (idx !== -1) state.transactions[idx] = data;

      closeModal();
      renderAll();
      showToast(`Transacción actualizada: ${fmtMoney(amount)}`, 'success');

    } else {
      // ── MODO NUEVA ────────────────────────────────────────
      const { data, error } = await saveTransaction({ type, description, category, amount, date, note });
      if (error) throw error;

      state.transactions.unshift(data);

      // Sincronizar el mes del filtro con la fecha de la transacción
      const txnMonth = date.slice(0, 7);
      if (txnMonth !== state.selectedMonth) {
        setSelectedMonth(txnMonth);
      }

      closeModal();
      renderAll();
      showToast(`Transacción guardada: ${fmtMoney(amount)}`, 'success');
    }

  } catch (err) {
    showFieldError(errorEl, err.message || 'Error al guardar. Intenta de nuevo.');
  } finally {
    state.isSaving = false;
    if (saveBtn)    saveBtn.disabled    = false;
    if (saveBtnTxt) saveBtnTxt.textContent = 'Guardar';
    if (saveBtnSpn) saveBtnSpn.hidden   = true;
  }
}

/**
 * Muestra un error inline en el formulario.
 * @param {HTMLElement|null} el
 * @param {string} msg
 */
function showFieldError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ============================================================
   ELIMINAR TRANSACCIÓN
   ============================================================ */

/**
 * Elimina una transacción por ID tras confirmación.
 * @param {string} id
 */
async function handleDelete(id) {
  const txn = state.transactions.find(t => t.id === id);
  if (!txn) return;

  // Confirmación nativa
  const ok = confirm(`¿Eliminar "${txn.description}" (${fmtMoney(txn.amount)})?`);
  if (!ok) return;

  const { error } = await deleteTransaction(id); // de supabase-client.js

  if (error) {
    showToast('Error al eliminar la transacción', 'error');
    return;
  }

  state.transactions = state.transactions.filter(t => t.id !== id);
  renderAll();
  showToast('Transacción eliminada', 'success');
}

/* ============================================================
   EXPORTACIÓN CSV
   ============================================================ */

/** Exporta las transacciones filtradas del mes actual a CSV */
function exportCSV() {
  const txns   = transactionsForMonth();
  const filtered = applyFilters(txns);

  if (!filtered.length) {
    showToast('No hay transacciones para exportar', 'warn');
    return;
  }

  const header = ['Fecha', 'Descripción', 'Categoría', 'Tipo', 'Monto (CLP)', 'Nota'];
  const rows   = filtered.map(t => [
    t.date,
    t.description,
    t.category,
    t.type === 'expense' ? 'Gasto' : 'Ingreso',
    t.amount,
    t.note || '',
  ]);

  // BOM para correcta apertura en Excel
  const csv = '\uFEFF' + [header, ...rows]
    .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `finanzas-${state.selectedMonth}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado correctamente', 'success');
}

/* ============================================================
   EXPORTACIÓN PDF (vía print)
   ============================================================ */

/** Abre la vista de impresión para generar PDF */
function exportPDF() {
  const txns    = transactionsForMonth();
  const filtered = applyFilters(txns);
  const totals  = calcTotals(filtered);
  const cats    = groupByCategory(txns);
  const label   = fmtMonthLabel(state.selectedMonth);

  // Construir documento de impresión temporal
  const printWin = window.open('', '_blank', 'width=900,height=700');
  if (!printWin) {
    showToast('Activa las ventanas emergentes para exportar PDF', 'warn');
    return;
  }

  const catRows = cats.map((cat, i) => {
    const pct = totals.expense > 0 ? Math.round((cat.amount / totals.expense) * 100) : 0;
    return `<tr>
      <td>${escHtml(cat.category)}</td>
      <td style="text-align:right;font-weight:700;color:#e11d48">${fmtMoney(cat.amount)}</td>
      <td style="text-align:right">${pct}%</td>
      <td style="text-align:right">${cat.count}</td>
    </tr>`;
  }).join('');

  const txnRows = filtered.map(t => `<tr>
    <td>${fmtDateFull(t.date)}</td>
    <td>${escHtml(t.description)}</td>
    <td>${escHtml(t.category)}</td>
    <td style="color:${t.type === 'income' ? '#059669' : '#e11d48'}">${t.type === 'income' ? 'Ingreso' : 'Gasto'}</td>
    <td style="text-align:right;font-weight:700;color:${t.type === 'income' ? '#059669' : '#e11d48'}">
      ${t.type === 'expense' ? '-' : '+'}${fmtMoney(t.amount)}
    </td>
  </tr>`).join('');

  printWin.document.write(`
    <!DOCTYPE html><html lang="es"><head>
    <meta charset="utf-8">
    <title>Reporte Financiero — ${label}</title>
    <style>
      body { font-family: 'Segoe UI', system-ui, sans-serif; color: #111; margin: 0; padding: 24px; font-size: 13px; }
      h1 { font-size: 22px; color: #6d28d9; margin-bottom: 4px; }
      h2 { font-size: 15px; color: #4c1d95; margin-top: 24px; margin-bottom: 8px; border-bottom: 2px solid #e5e7eb; padding-bottom: 4px; }
      .subtitle { color: #6b7280; margin-bottom: 24px; }
      .metrics { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 24px; }
      .metric { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
      .metric-label { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; }
      .metric-value { font-size: 20px; font-weight: 800; margin-top: 4px; }
      .income { color: #059669; } .expense { color: #e11d48; } .balance { color: #2563eb; } .savings { color: #7c3aed; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th { background: #f3f4f6; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
      td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; }
      .footer { margin-top: 32px; color: #9ca3af; font-size: 11px; text-align: center; }
    </style>
    </head><body>
    <h1>FinanzasApp — Reporte Financiero</h1>
    <p class="subtitle">Período: <strong>${label}</strong> · Generado el ${fmtDateFull(todayStr())}</p>

    <div class="metrics">
      <div class="metric"><div class="metric-label">Ingresos</div><div class="metric-value income">${fmtMoney(totals.income)}</div></div>
      <div class="metric"><div class="metric-label">Gastos</div><div class="metric-value expense">${fmtMoney(totals.expense)}</div></div>
      <div class="metric"><div class="metric-label">Balance</div><div class="metric-value balance">${fmtMoney(totals.balance)}</div></div>
      <div class="metric"><div class="metric-label">Tasa ahorro</div><div class="metric-value savings">${totals.rate}%</div></div>
    </div>

    ${cats.length ? `
    <h2>Gastos por categoría</h2>
    <table>
      <thead><tr><th>Categoría</th><th style="text-align:right">Monto</th><th style="text-align:right">%</th><th style="text-align:right">N°</th></tr></thead>
      <tbody>${catRows}</tbody>
    </table>` : ''}

    <h2>Detalle de transacciones (${filtered.length})</h2>
    <table>
      <thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Tipo</th><th style="text-align:right">Monto</th></tr></thead>
      <tbody>${txnRows}</tbody>
    </table>

    <div class="footer">FinanzasApp · ${label} · ${filtered.length} transacciones</div>
    </body></html>
  `);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => { printWin.print(); }, 400);
  showToast('Reporte listo para imprimir/guardar como PDF', 'success');
}

/* ============================================================
   AUTENTICACIÓN
   ============================================================ */

/**
 * Inicializa la autenticación: verifica sesión existente y
 * suscribe a cambios de estado.
 */
async function initAuth() {
  const supabaseAvail = initSupabase(); // de supabase-client.js
  state.isOnline      = supabaseAvail;

  // Mostrar aviso si Supabase no está configurado
  const noteEl = document.getElementById('authConfigNote');
  if (noteEl) noteEl.hidden = supabaseAvail;

  if (supabaseAvail) {
    // Primero: cerrar cualquier sesión activa para forzar re-autenticación.
    // Esto debe hacerse ANTES de registrar el listener para evitar que
    // el evento SIGNED_OUT cause un flash visual del dashboard.
    const session = await getSession();
    if (session?.user?.email) {
      // Pre-rellenar el email para facilitar el ingreso
      const emailInput = document.getElementById('loginEmail');
      if (emailInput) emailInput.value = session.user.email;
      // Cerrar sesión silenciosamente (sin listener activo aún)
      await signOut();
    }

    // Segundo: registrar el listener DESPUÉS del signOut inicial,
    // así no captura el SIGNED_OUT que acabamos de provocar.
    onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session && !state.isLoggedIn) {
        handleLoginSuccess(session.user, true);
      } else if (event === 'SIGNED_OUT' && state.isLoggedIn) {
        // Solo reaccionar a SIGNED_OUT si el usuario ya estaba dentro
        // (es decir, cuando cierra sesión desde el botón de logout)
        showAuthScreen();
      }
    });
  }

  // Siempre mostrar pantalla de auth
  showAuthScreen();
}

/**
 * Llamado cuando el login/register es exitoso.
 * @param {object} user - Usuario de Supabase
 * @param {boolean} online - true si es cuenta Supabase
 */
async function handleLoginSuccess(user, online = false) {
  state.isLoggedIn = true;
  state.isOnline   = online;

  // Actualizar UI del usuario
  updateUserUI(user, online);

  // Ocultar auth, mostrar app
  hideAuthScreen();

  // Cargar datos
  await loadData();
}

/** Muestra la pantalla de autenticación */
function showAuthScreen() {
  const authEl = document.getElementById('authScreen');
  const appEl  = document.getElementById('appShell');
  if (authEl) { authEl.hidden = false; authEl.style.display = 'flex'; }
  if (appEl)  { appEl.hidden = true; }
  state.isLoggedIn = false;
}

/** Oculta la pantalla de autenticación */
function hideAuthScreen() {
  const authEl = document.getElementById('authScreen');
  const appEl  = document.getElementById('appShell');
  if (authEl) { authEl.hidden = true; authEl.style.display = 'none'; }
  if (appEl)  { appEl.hidden = false; }
}

/**
 * Actualiza el nombre y badge del usuario en la sidebar.
 * @param {object|null} user
 * @param {boolean} online
 */
function updateUserUI(user, online) {
  const nameEl   = document.getElementById('userName');
  const badgeEl  = document.getElementById('userBadge');
  const avatarEl = document.getElementById('userAvatar');

  const displayName = user?.email?.split('@')[0] || 'Usuario';
  const initial     = displayName[0].toUpperCase();

  if (nameEl)   nameEl.textContent  = displayName;
  if (avatarEl) avatarEl.textContent = initial;
  if (badgeEl) {
    badgeEl.textContent = online ? '● Online' : '● Offline';
    badgeEl.style.color = online ? 'var(--income)' : 'var(--text-3)';
  }
}

/**
 * Maneja el envío del formulario de login.
 * @param {Event} e
 */
async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl  = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');
  const btnText  = btn?.querySelector('.btn-text');
  const btnSpn   = btn?.querySelector('.btn-spinner');

  if (!validateAuthForm(email, password, errorEl)) return;

  btn && (btn.disabled = true);
  if (btnText) btnText.textContent = 'Ingresando...';
  if (btnSpn)  btnSpn.hidden = false;
  if (errorEl) errorEl.hidden = true;

  const { user, error } = await signIn(email, password);

  btn && (btn.disabled = false);
  if (btnText) btnText.textContent = 'Iniciar sesión';
  if (btnSpn)  btnSpn.hidden = true;

  if (error) {
    showAuthError(errorEl, translateAuthError(error.message));
    return;
  }

  await handleLoginSuccess(user, true);
}

/**
 * Maneja el envío del formulario de registro.
 * @param {Event} e
 */
async function handleRegister(e) {
  e.preventDefault();
  const email    = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  const errorEl  = document.getElementById('registerError');
  const btn      = document.getElementById('registerBtn');
  const btnText  = btn?.querySelector('.btn-text');
  const btnSpn   = btn?.querySelector('.btn-spinner');

  if (!validateAuthForm(email, password, errorEl)) return;

  btn && (btn.disabled = true);
  if (btnText) btnText.textContent = 'Creando cuenta...';
  if (btnSpn)  btnSpn.hidden = false;
  if (errorEl) errorEl.hidden = true;

  const { user, error } = await signUp(email, password);

  btn && (btn.disabled = false);
  if (btnText) btnText.textContent = 'Crear cuenta gratis';
  if (btnSpn)  btnSpn.hidden = true;

  if (error) {
    showAuthError(errorEl, translateAuthError(error.message));
    return;
  }

  // Informar al usuario que revise su email (Supabase requiere confirmar email por defecto)
  showAuthError(errorEl, '✅ Cuenta creada. Revisa tu correo para confirmar y luego inicia sesión.', true);
}

/**
 * Cierra sesión del usuario.
 */
async function handleLogout() {
  await signOut();
  state.transactions = [];
  state.isLoggedIn   = false;
  state.isOnline     = false;
  showAuthScreen();
  showToast('Sesión cerrada', 'success');
}

/**
 * Activa el modo offline (sin cuenta).
 */
function handleOfflineMode() {
  handleLoginSuccess(null, false);
}

/** Valida email y password en los formularios de auth */
function validateAuthForm(email, password, errorEl) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAuthError(errorEl, 'Ingresa un correo electrónico válido.');
    return false;
  }
  if (!password || password.length < 6) {
    showAuthError(errorEl, 'La contraseña debe tener al menos 6 caracteres.');
    return false;
  }
  return true;
}

/** Muestra un error en el área de auth */
function showAuthError(el, msg, isSuccess = false) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.style.background = isSuccess ? 'rgba(16,217,160,0.1)' : '';
  el.style.borderColor = isSuccess ? 'rgba(16,217,160,0.3)' : '';
  el.style.color = isSuccess ? 'var(--income)' : '';
}

/** Traduce mensajes de error de Supabase al español */
function translateAuthError(msg) {
  if (!msg) return 'Error desconocido';
  if (msg.includes('Invalid login credentials'))  return 'Correo o contraseña incorrectos.';
  if (msg.includes('Email not confirmed'))         return 'Confirma tu correo antes de iniciar sesión.';
  if (msg.includes('User already registered'))     return 'Ya existe una cuenta con ese correo.';
  if (msg.includes('Password should be'))          return 'La contraseña debe tener al menos 6 caracteres.';
  if (msg.includes('Invalid email'))               return 'Correo electrónico inválido.';
  if (msg.includes('Unable to connect'))           return 'Sin conexión a Supabase. Verifica tu config.js.';
  return msg;
}

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */

/**
 * Muestra una notificación toast.
 * @param {string} message
 * @param {'success'|'error'|'warn'} type
 * @param {number} duration - ms
 */
function showToast(message, type = 'success', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-dot" aria-hidden="true"></span>
    <span>${escHtml(message)}</span>
  `;
  toast.setAttribute('role', 'status');
  container.appendChild(toast);

  // Animar entrada
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  // Auto-remover
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}

/* ============================================================
   RENDERIZADO GLOBAL
   ============================================================ */

/** Renderiza la vista activa actual */
function renderAll() {
  if (state.currentView === 'dashboard')    renderDashboard();
  if (state.currentView === 'transactions') renderTransactions();
  if (state.currentView === 'reports')      renderReports();
}

/* ============================================================
   UTILIDADES DE DOM
   ============================================================ */

/**
 * Establece el texto de un elemento de forma segura.
 * @param {string} id
 * @param {string|null} text
 */
function setTextSafe(id, text) {
  const el = document.getElementById(id);
  if (el && text !== null) el.textContent = text;
}

/**
 * Escapa caracteres HTML para prevenir XSS.
 * @param {string} str
 * @returns {string}
 */
function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ============================================================
   EVENT LISTENERS
   ============================================================ */

/** Registra todos los event listeners de la app */
function setupEventListeners() {

  /* ── AUTENTICACIÓN ─────────────────────────────────────── */
  document.getElementById('loginForm')
    ?.addEventListener('submit', handleLogin);

  document.getElementById('registerForm')
    ?.addEventListener('submit', handleRegister);

  document.getElementById('offlineBtn')
    ?.addEventListener('click', handleOfflineMode);

  document.getElementById('logoutBtn')
    ?.addEventListener('click', handleLogout);

  document.getElementById('bottomLogoutBtn')
    ?.addEventListener('click', handleLogout);

  // Tabs de auth (login / register)
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.auth-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === target);
        t.setAttribute('aria-selected', t.dataset.tab === target ? 'true' : 'false');
      });
      document.getElementById('panelLogin').hidden    = target !== 'login';
      document.getElementById('panelRegister').hidden = target !== 'register';
    });
  });

  // Toggle visibilidad contraseña
  setupPasswordToggle('toggleLoginPwd', 'loginPassword', 'eyeLoginIcon');
  setupPasswordToggle('toggleRegPwd',   'registerPassword', 'eyeRegIcon');

  /* ── NAVEGACIÓN ────────────────────────────────────────── */
  document.querySelectorAll('.nav-item[data-view], .bottom-nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // "Ver todas" en el dashboard
  document.getElementById('dashSeeAll')
    ?.addEventListener('click', () => switchView('transactions'));

  /* ── CONTROL DE PERÍODO ────────────────────────────────── */
  // Dashboard
  document.getElementById('dashPrevMonth')?.addEventListener('click', prevMonth);
  document.getElementById('dashNextMonth')?.addEventListener('click', nextMonth);

  document.querySelectorAll('[data-month-picker]').forEach(btn => {
    btn.addEventListener('click', () => toggleMonthPicker(btn));
  });
  document.getElementById('monthPopoverPrev')?.addEventListener('click', () => {
    state.monthPickerYear--;
    renderMonthPicker();
  });
  document.getElementById('monthPopoverNext')?.addEventListener('click', () => {
    state.monthPickerYear++;
    renderMonthPicker();
  });
  document.getElementById('monthPopoverToday')?.addEventListener('click', () => {
    setSelectedMonth(currentMonthStr());
    closeMonthPicker();
  });
  document.getElementById('monthPopoverClear')?.addEventListener('click', () => {
    setSelectedMonth(currentMonthStr());
    closeMonthPicker();
  });
  document.getElementById('monthPopoverGrid')?.addEventListener('click', e => {
    const option = e.target.closest('.month-option');
    if (!option?.dataset.month) return;
    setSelectedMonth(option.dataset.month);
    closeMonthPicker();
  });

  // Reportes
  document.getElementById('rptPrevMonth')?.addEventListener('click', prevMonth);
  document.getElementById('rptNextMonth')?.addEventListener('click', nextMonth);

  /* ── MODAL TRANSACCIÓN ─────────────────────────────────── */
  const openModalBtns = ['dashAddBtn', 'txnAddBtn', 'mobileAddBtn', 'fabAddBtn'];
  openModalBtns.forEach(id => {
    document.getElementById(id)?.addEventListener('click', openModal);
  });

  document.getElementById('closeModalBtn') ?.addEventListener('click', closeModal);
  document.getElementById('cancelModalBtn')?.addEventListener('click', closeModal);
  document.getElementById('txnForm')       ?.addEventListener('submit', handleFormSubmit);

  document.getElementById('deleteModalBtn')?.addEventListener('click', async function() {
    const id = this.dataset.id;
    if (!id) return;
    closeModal();
    await handleDelete(id);
  });

  document.getElementById('fDateButton')?.addEventListener('click', toggleDateCalendar);
  document.getElementById('datePrevMonth')?.addEventListener('click', () => shiftCalendarMonth(-1));
  document.getElementById('dateNextMonth')?.addEventListener('click', () => shiftCalendarMonth(1));
  document.getElementById('dateTodayBtn')?.addEventListener('click', () => {
    setFormDate(todayStr());
    closeDateCalendar();
  });
  document.getElementById('dateClearBtn')?.addEventListener('click', () => {
    setFormDate('');
    closeDateCalendar();
  });
  document.getElementById('dateDays')?.addEventListener('click', e => {
    const day = e.target.closest('.date-day');
    if (!day?.dataset.date) return;
    setFormDate(day.dataset.date);
    closeDateCalendar();
  });

  // Cerrar modal al hacer click en el backdrop
  document.getElementById('txnModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.addEventListener('click', e => {
    const picker = document.getElementById('datePicker');
    if (picker && !picker.contains(e.target)) closeDateCalendar();

    const monthPopover = document.getElementById('monthPopover');
    const monthBtn = e.target.closest('[data-month-picker]');
    if (monthPopover && !monthPopover.contains(e.target) && !monthBtn) closeMonthPicker();
  });

  // Cerrar con Escape (ya lo hace el dialog nativo, pero por si acaso)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  /* ── FILTROS DE TRANSACCIONES ──────────────────────────── */
  document.querySelectorAll('.filter-tab[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab[data-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.type = btn.dataset.type;
      renderTransactions();
    });
  });

  document.getElementById('txnCategoryFilter')?.addEventListener('change', e => {
    state.filters.category = e.target.value;
    renderTransactions();
  });

  // Search con debounce de 250ms
  let searchTimeout;
  document.getElementById('txnSearch')?.addEventListener('input', e => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.filters.search = e.target.value.trim();
      renderTransactions();
    }, 250);
  });

  /* ── EDITAR / ELIMINAR TRANSACCIÓN (delegación de eventos) ─ */
  document.getElementById('txnTableBody')?.addEventListener('click', e => {
    const editBtn = e.target.closest('.btn-edit');
    if (editBtn?.dataset.id) { openEditModal(editBtn.dataset.id); return; }

    const delBtn = e.target.closest('.btn-delete');
    if (delBtn?.dataset.id) handleDelete(delBtn.dataset.id);
  });

  /* ── EXPORTACIÓN ─────────────────────────────────────── */
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);
  document.getElementById('exportPdfBtn')?.addEventListener('click', exportPDF);
  document.getElementById('rptExportBtn')?.addEventListener('click', exportPDF);

  /* ── RESPONSIVE: redibuja charts al cambiar tamaño ────── */
  if (window.ResizeObserver) {
    const chartIds = ['trendChart', 'categoryChart', 'rptDonutChart', 'rptTrendChart'];
    chartIds.forEach(id => {
      const canvas = document.getElementById(id);
      if (!canvas) return;
      new ResizeObserver(() => {
        if (state.currentView === 'dashboard') renderDashboard();
        if (state.currentView === 'reports')   renderReports();
      }).observe(canvas);
    });
  }
}

/**
 * Configura el botón de mostrar/ocultar contraseña.
 * @param {string} btnId
 * @param {string} inputId
 * @param {string} iconId
 */
function setupPasswordToggle(btnId, inputId, iconId) {
  const btn   = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  if (!btn || !input) return;

  btn.addEventListener('click', () => {
    const isText = input.type === 'text';
    input.type = isText ? 'password' : 'text';
    btn.setAttribute('aria-label', isText ? 'Mostrar contraseña' : 'Ocultar contraseña');
  });
}

/* ============================================================
   INICIALIZACIÓN
   ============================================================ */

/**
 * Punto de entrada de la aplicación.
 * Se ejecuta cuando el DOM está listo.
 */
async function init() {
  // Inicializar período actual
  const now = currentMonthStr();
  state.selectedMonth = now;

  // Sincronizar pickers de mes con el mes actual
  ['dashMonthPicker', 'txnMonthPicker', 'rptMonthPicker'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = now;
  });
  setTextSafe('dashPeriodLabel', fmtMonthLabel(now));
  setTextSafe('rptPeriodLabel',  fmtMonthLabel(now));

  // Registrar event listeners
  setupEventListeners();

  // Inicializar auth (puede redirigir al app shell o quedarse en auth)
  await initAuth();
}

// Ejecutar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
