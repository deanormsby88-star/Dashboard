/* ==================================================================
   Bake Book — single-page app (vanilla JS)
   ================================================================== */
(function () {
  'use strict';

  const API = 'api/';

  const state = {
    authed: false,
    csrf: null,
    currency: 'R',
    ingredients: [],
    recipes: [],
    activeTab: 'pantry',
    pantrySort: 'name',
    pantrySearch: '',
  };

  /* ---------------- DOM helpers ---------------- */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- formatting ---------------- */
  function money(n) {
    const v = Number(n) || 0;
    return state.currency + ' ' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // Small per-unit values need more precision than 2 dp.
  function moneyFine(n) {
    const v = Number(n) || 0;
    const dp = v < 1 ? 4 : 2;
    return state.currency + ' ' + v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  const unitShort = (u) => (u === 'ml' ? 'ml' : 'g');
  const bigUnit   = (u) => (u === 'ml' ? 'L' : 'kg');

  /* ---------------- API ---------------- */
  async function api(path, { method = 'GET', body = null } = {}) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && state.csrf) {
      opts.headers['X-CSRF-Token'] = state.csrf;
    }
    const res = await fetch(API + path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON (e.g. export) */ }
    if (res.status === 401) {
      state.authed = false;
      showLogin();
      throw new Error(data && data.error ? data.error : 'Not authenticated');
    }
    if (!res.ok) {
      throw new Error(data && data.error ? data.error : ('Request failed (' + res.status + ')'));
    }
    return data;
  }

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function toast(msg, isErr = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
  }

  /* ---------------- modal ---------------- */
  function openModal(title, bodyNode) {
    $('#modal-title').textContent = title;
    const body = $('#modal-body');
    body.innerHTML = '';
    body.appendChild(bodyNode);
    $('#modal-overlay').classList.remove('hidden');
  }
  function closeModal() { $('#modal-overlay').classList.add('hidden'); }

  /* ================================================================
     AUTH
     ================================================================ */
  function showLogin() {
    $('#login-screen').classList.remove('hidden');
    $('#app').classList.add('hidden');
    setTimeout(() => $('#login-password').focus(), 50);
  }
  function showApp() {
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    const ci = $('#currency-input');
    if (ci) ci.value = state.currency;
  }

  async function bootstrap() {
    try {
      const s = await api('auth.php');
      state.currency = s.currency || 'R';
      if (s.authenticated) {
        state.authed = true;
        state.csrf = s.csrf_token;
        showApp();
        await loadAll();
        switchTab('pantry');
      } else {
        showLogin();
      }
    } catch (e) {
      showLogin();
    }
  }

  async function doLogin(ev) {
    ev.preventDefault();
    const err = $('#login-error');
    err.classList.add('hidden');
    const password = $('#login-password').value;
    try {
      const r = await api('auth.php', { method: 'POST', body: { action: 'login', password } });
      state.authed = true;
      state.csrf = r.csrf_token;
      state.currency = r.currency || 'R';
      $('#login-password').value = '';
      showApp();
      await loadAll();
      switchTab('pantry');
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove('hidden');
    }
  }

  async function doLogout() {
    try { await api('auth.php', { method: 'POST', body: { action: 'logout' } }); } catch (e) {}
    state.authed = false; state.csrf = null;
    showLogin();
  }

  /* ================================================================
     DATA LOADING
     ================================================================ */
  async function loadAll() { await Promise.all([loadIngredients(), loadRecipes()]); }

  async function loadIngredients() {
    const d = await api('ingredients.php');
    state.ingredients = d.ingredients || [];
    renderPantry();
  }
  async function loadRecipes() {
    const d = await api('recipes.php');
    state.recipes = d.recipes || [];
    renderRecipes();
  }

  /* ================================================================
     NAVIGATION
     ================================================================ */
  function switchTab(tab) {
    state.activeTab = tab;
    $$('.tab').forEach((t) => t.classList.add('hidden'));
    const active = $('#tab-' + tab);
    if (active) { active.classList.remove('hidden'); }
    $$('.nav-item, .tabbar-item').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === tab));
  }

  /* ================================================================
     PANTRY
     ================================================================ */
  function sortedIngredients() {
    let list = state.ingredients.slice();
    const q = state.pantrySearch.trim().toLowerCase();
    if (q) list = list.filter((i) => (i.name || '').toLowerCase().includes(q) ||
                                      (i.brand || '').toLowerCase().includes(q));
    if (state.pantrySort === 'name') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (state.pantrySort === 'recent') {
      list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '') || b.id - a.id);
    } else if (state.pantrySort === 'cheapest') {
      list.sort((a, b) => (a.cost_per_1000 || 0) - (b.cost_per_1000 || 0));
    }
    return list;
  }

  function renderPantry() {
    // summary
    const total = state.ingredients.length;
    const low = state.ingredients.filter((i) => Number(i.quantity_in_stock) <= 1 && Number(i.quantity_in_stock) > 0).length;
    const summary = $('#pantry-summary');
    summary.innerHTML = '';
    summary.appendChild(el('div', { class: 'summary-chip' },
      el('span', { class: 'num' }, String(total)),
      el('span', { class: 'lbl' }, total === 1 ? 'ingredient tracked' : 'ingredients tracked')));
    summary.appendChild(el('div', { class: 'summary-chip' + (low ? ' warn' : '') },
      el('span', { class: 'num' }, String(low)),
      el('span', { class: 'lbl' }, low ? 'low on stock' : 'none running low')));

    const grid = $('#pantry-list');
    grid.innerHTML = '';
    const list = sortedIngredients();
    if (!list.length) {
      grid.appendChild(el('div', { class: 'empty' },
        el('span', { class: 'big' }, '🧺'),
        state.ingredients.length ? 'No ingredients match your filter.' : 'Your pantry is empty — add your first ingredient.'));
      return;
    }
    for (const ing of list) grid.appendChild(ingredientCard(ing));
  }

  function ingredientCard(ing) {
    const u = ing.pack_unit;
    const isLow = Number(ing.quantity_in_stock) <= 1 && Number(ing.quantity_in_stock) > 0;
    const inner = el('div', { class: 'card-inner' },
      el('div', { class: 'ing-head' },
        el('div', {},
          el('h3', { class: 'ing-name' }, ing.name),
          ing.brand ? el('p', { class: 'ing-brand' }, ing.brand) : null),
        isLow ? el('span', { class: 'badge low' }, 'Low') : null),
      el('p', { class: 'ing-meta', html:
        'Pack <b>' + esc(fmtNum(ing.pack_size)) + unitShort(u) + '</b> · ' +
        'Paid <b>' + esc(money(ing.price_paid)) + '</b><br>' +
        'In stock <b>' + esc(fmtNum(ing.quantity_in_stock)) + '</b>' +
        (ing.date_purchased ? ' · ' + esc(ing.date_purchased) : '') }),
      el('div', { class: 'cost-lines' },
        costLine('Per ' + unitShort(u), moneyFine(ing.cost_per_unit)),
        costLine('Per 500' + unitShort(u), moneyFine(ing.cost_per_500)),
        costLine('Per ' + bigUnit(u), moneyFine(ing.cost_per_1000))),
      el('div', { class: 'card-actions' },
        el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openIngredientModal(ing) }, 'Edit'),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => deleteIngredient(ing) }, 'Delete')));
    return el('div', { class: 'card notebook ing-card' }, inner);
  }

  function costLine(k, v) {
    return el('div', { class: 'cost-line' },
      el('span', { class: 'k' }, k), el('span', { class: 'v' }, v));
  }
  const fmtNum = (n) => {
    const v = Number(n) || 0;
    return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
  };

  function openIngredientModal(ing) {
    const isEdit = !!ing;
    const v = ing || { pack_unit: 'grams', date_purchased: new Date().toISOString().slice(0, 10) };
    const form = el('form', { class: 'ing-form' },
      field('Ingredient name', el('input', { type: 'text', id: 'f-name', value: v.name || '', required: 'required' })),
      field('Brand (optional)', el('input', { type: 'text', id: 'f-brand', value: v.brand || '' })),
      el('div', { class: 'field' },
        el('span', {}, 'Pack size'),
        el('div', { class: 'pack-row' },
          el('input', { type: 'number', step: 'any', min: '0', id: 'f-size', value: v.pack_size != null ? v.pack_size : '', required: 'required' }),
          el('select', { id: 'f-unit' },
            optionEl('grams', 'grams (g)', v.pack_unit),
            optionEl('ml', 'millilitres (ml)', v.pack_unit)))),
      field('Price paid (' + state.currency + ')', el('input', { type: 'number', step: 'any', min: '0', id: 'f-price', value: v.price_paid != null ? v.price_paid : '', required: 'required' })),
      field('Date purchased', el('input', { type: 'date', id: 'f-date', value: v.date_purchased || '' })),
      field('Quantity in stock (units on hand)', el('input', { type: 'number', step: 'any', min: '0', id: 'f-qty', value: v.quantity_in_stock != null ? v.quantity_in_stock : '' })),
      el('div', { class: 'btn-row' },
        el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'Save changes' : 'Add ingredient'),
        el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'Cancel')));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: $('#f-name').value.trim(),
        brand: $('#f-brand').value.trim(),
        pack_size: parseFloat($('#f-size').value) || 0,
        pack_unit: $('#f-unit').value,
        price_paid: parseFloat($('#f-price').value) || 0,
        date_purchased: $('#f-date').value || null,
        quantity_in_stock: parseFloat($('#f-qty').value) || 0,
      };
      if (!body.name) { toast('Name is required', true); return; }
      try {
        if (isEdit) { body.id = ing.id; await api('ingredients.php', { method: 'PUT', body }); }
        else { await api('ingredients.php', { method: 'POST', body }); }
        closeModal();
        await loadIngredients();
        await loadRecipes(); // costs may change
        toast(isEdit ? 'Ingredient updated' : 'Ingredient added');
      } catch (err) { toast(err.message, true); }
    });

    openModal(isEdit ? 'Edit ingredient' : 'Add ingredient', form);
  }

  async function deleteIngredient(ing) {
    if (!confirm('Delete "' + ing.name + '" from your pantry?')) return;
    try {
      await api('ingredients.php', { method: 'DELETE', body: { id: ing.id } });
      await loadIngredients();
      await loadRecipes();
      toast('Ingredient deleted');
    } catch (e) { toast(e.message, true); }
  }

  /* ================================================================
     RECIPES
     ================================================================ */
  function renderRecipes() {
    const grid = $('#recipe-list');
    grid.innerHTML = '';
    if (!state.recipes.length) {
      grid.appendChild(el('div', { class: 'empty' },
        el('span', { class: 'big' }, '📖'),
        'No recipes yet — create your first bake.'));
      return;
    }
    for (const r of state.recipes) grid.appendChild(recipeCard(r));
  }

  function recipeCard(r) {
    const missing = r.ingredients.filter((l) => !l.in_pantry).length;
    const rows = r.ingredients.map((l) =>
      el('tr', { class: l.in_pantry ? '' : 'missing' },
        el('td', {}, l.in_pantry ? (l.ingredient_name || '—') : (l.ingredient_name || 'Not in pantry')),
        el('td', { class: 'num' }, fmtNum(l.quantity_used) + unitShort(l.unit)),
        el('td', { class: 'num' }, l.in_pantry ? moneyFine(l.cost) : '—')));

    const inner = el('div', { class: 'card-inner' },
      el('h3', { class: 'recipe-name' }, r.name),
      el('p', { class: 'recipe-yield' }, r.yield_text ? ('Yields ' + r.yield_text) : 'No yield set'),
      el('div', { class: 'recipe-totals' },
        el('div', { class: 'recipe-stat' },
          el('span', { class: 'lbl' }, 'Total food cost'),
          el('span', { class: 'val' }, money(r.total_cost))),
        r.cost_per_unit != null ? el('div', { class: 'recipe-stat' },
          el('span', { class: 'lbl' }, 'Per unit'),
          el('span', { class: 'val' }, money(r.cost_per_unit))) : null),
      missing ? el('div', { class: 'recipe-flag' },
        '⚠ ' + missing + ' ingredient' + (missing > 1 ? 's' : '') + ' not in your pantry — add ' +
        (missing > 1 ? 'them' : 'it') + ' to include in the cost.') : null,
      r.ingredients.length ? el('table', { class: 'breakdown' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Ingredient'), el('th', { class: 'num' }, 'Qty'), el('th', { class: 'num' }, 'Cost'))),
        el('tbody', {}, ...rows)) : el('p', { class: 'recipe-yield' }, 'No ingredients added.'),
      el('p', { class: 'recalc' }, 'Cost recalculated ' + (r.calculated_at || '')),
      el('div', { class: 'card-actions' },
        el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openRecipeModal(r) }, 'Edit'),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => deleteRecipe(r) }, 'Delete')));

    return el('div', { class: 'card notebook recipe-card' }, inner);
  }

  function recipeIngredientRow(line) {
    line = line || { ingredient_id: '', quantity_used: '', unit: 'grams' };
    const sel = el('select', {}, el('option', { value: '' }, '— choose —'));
    for (const ing of state.ingredients.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const o = el('option', { value: String(ing.id) }, ing.name + (ing.brand ? ' (' + ing.brand + ')' : ''));
      if (String(line.ingredient_id) === String(ing.id)) o.selected = true;
      sel.appendChild(o);
    }
    const unitSel = el('select', {}, optionEl('grams', 'g', line.unit), optionEl('ml', 'ml', line.unit));
    const row = el('div', { class: 'ri-row' },
      sel,
      el('input', { type: 'number', step: 'any', min: '0', placeholder: 'Qty', value: line.quantity_used != null ? line.quantity_used : '' }),
      unitSel,
      el('button', { type: 'button', class: 'ri-remove', title: 'Remove', onclick: () => row.remove() }, '×'));
    return row;
  }

  function openRecipeModal(r) {
    const isEdit = !!r;
    const rowsWrap = el('div', { id: 'ri-rows' });
    if (isEdit && r.ingredients.length) {
      r.ingredients.forEach((l) => rowsWrap.appendChild(recipeIngredientRow(l)));
    } else {
      rowsWrap.appendChild(recipeIngredientRow());
    }

    const noPantry = state.ingredients.length === 0;

    const form = el('form', {},
      field('Recipe name', el('input', { type: 'text', id: 'r-name', value: isEdit ? r.name : '', required: 'required' })),
      field('Yield (e.g. "12 muffins" or "1 loaf")', el('input', { type: 'text', id: 'r-yield', value: isEdit ? (r.yield_text || '') : '' })),
      el('div', { class: 'field' },
        el('span', {}, 'Ingredients from pantry'),
        noPantry ? el('p', { class: 'recipe-flag' }, 'Add ingredients to your Pantry first to build a costed recipe.') : null,
        el('div', { class: 'ri-head' },
          el('span', {}, 'Ingredient'), el('span', {}, 'Qty'), el('span', {}, 'Unit'), el('span', {})),
        rowsWrap,
        el('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => rowsWrap.appendChild(recipeIngredientRow()) }, '+ Add ingredient row')),
      el('div', { class: 'btn-row' },
        el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'Save recipe' : 'Create recipe'),
        el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'Cancel')));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#r-name').value.trim();
      if (!name) { toast('Recipe name is required', true); return; }
      const ingredients = [];
      $$('.ri-row', rowsWrap).forEach((row) => {
        const [selNode, qtyNode, unitNode] = [row.children[0], row.children[1], row.children[2]];
        const iid = selNode.value;
        const qty = parseFloat(qtyNode.value);
        if (iid && qty > 0) {
          ingredients.push({ ingredient_id: iid, quantity_used: qty, unit: unitNode.value });
        }
      });
      const body = { name, yield_text: $('#r-yield').value.trim(), ingredients };
      try {
        if (isEdit) { body.id = r.id; await api('recipes.php', { method: 'PUT', body }); }
        else { await api('recipes.php', { method: 'POST', body }); }
        closeModal();
        await loadRecipes();
        toast(isEdit ? 'Recipe saved' : 'Recipe created');
      } catch (err) { toast(err.message, true); }
    });

    openModal(isEdit ? 'Edit recipe' : 'New recipe', form);
  }

  async function deleteRecipe(r) {
    if (!confirm('Delete recipe "' + r.name + '"?')) return;
    try {
      await api('recipes.php', { method: 'DELETE', body: { id: r.id } });
      await loadRecipes();
      toast('Recipe deleted');
    } catch (e) { toast(e.message, true); }
  }

  /* ================================================================
     CALCULATOR (client-side only)
     ================================================================ */
  function setupCalculator() {
    const recalc = () => {
      const size = parseFloat($('#calc-size').value);
      const price = parseFloat($('#calc-price').value);
      const unit = $('#calc-unit').value;
      const results = $('#calc-results');
      const addBtn = $('#calc-add-btn');
      $$('.calc-unit-lbl').forEach((n) => (n.textContent = unitShort(unit)));
      $('.calc-big-lbl').textContent = bigUnit(unit);

      if (size > 0 && price >= 0) {
        const per = price / size;
        $('#calc-per-unit').textContent = moneyFine(per);
        $('#calc-per-500').textContent = moneyFine(per * 500);
        $('#calc-per-1000').textContent = moneyFine(per * 1000);
        results.classList.remove('hidden');
        addBtn.disabled = false;
      } else {
        results.classList.add('hidden');
        addBtn.disabled = true;
      }
    };
    ['calc-size', 'calc-price', 'calc-unit', 'calc-name'].forEach((id) =>
      $('#' + id).addEventListener('input', recalc));

    $('#calc-add-btn').addEventListener('click', () => {
      openIngredientModal(null);
      // prefill from calculator
      $('#f-name').value = $('#calc-name').value.trim();
      $('#f-size').value = $('#calc-size').value;
      $('#f-price').value = $('#calc-price').value;
      $('#f-unit').value = $('#calc-unit').value;
    });
  }

  /* ================================================================
     SETTINGS
     ================================================================ */
  function setupSettings() {
    $('#currency-input').value = state.currency;

    $('#save-currency-btn').addEventListener('click', async () => {
      const currency = $('#currency-input').value.trim();
      if (!currency) { toast('Enter a currency label', true); return; }
      try {
        const r = await api('auth.php', { method: 'POST', body: { action: 'set_currency', currency } });
        state.currency = r.currency;
        renderPantry(); renderRecipes();
        toast('Currency saved');
      } catch (e) { toast(e.message, true); }
    });

    $('#change-pass-btn').addEventListener('click', async () => {
      const cur = $('#cur-pass').value, np = $('#new-pass').value;
      if (!cur || !np) { toast('Fill in both password fields', true); return; }
      try {
        await api('auth.php', { method: 'POST', body: { action: 'change_password', current_password: cur, new_password: np } });
        $('#cur-pass').value = ''; $('#new-pass').value = '';
        toast('Password updated');
      } catch (e) { toast(e.message, true); }
    });

    $('#export-btn').addEventListener('click', () => {
      // export.php is a GET download; navigate to trigger the file download
      window.location.href = API + 'export.php';
    });

    $('#import-btn').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('Importing will REPLACE all current data with the contents of this file. Continue?')) {
        e.target.value = ''; return;
      }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await api('import.php', { method: 'POST', body: { action: 'import', data } });
        await loadAll();
        toast('Data imported');
      } catch (err) { toast('Import failed: ' + err.message, true); }
      e.target.value = '';
    });

    $('#clear-btn').addEventListener('click', async () => {
      if (!confirm('This will permanently delete ALL ingredients and recipes. Are you sure?')) return;
      if (!confirm('Really clear everything? This cannot be undone.')) return;
      try {
        await api('import.php', { method: 'POST', body: { action: 'clear' } });
        await loadAll();
        toast('All data cleared');
      } catch (e) { toast(e.message, true); }
    });

    $('#logout-btn').addEventListener('click', doLogout);
  }

  /* ---------------- small builders ---------------- */
  function field(label, input) {
    return el('label', { class: 'field' }, el('span', {}, label), input);
  }
  function optionEl(value, label, current) {
    const o = el('option', { value }, label);
    if (String(current) === String(value)) o.selected = true;
    return o;
  }

  /* ================================================================
     WIRE UP
     ================================================================ */
  function init() {
    $('#login-form').addEventListener('submit', doLogin);
    $$('.nav-item, .tabbar-item').forEach((b) =>
      b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $('#add-ingredient-btn').addEventListener('click', () => openIngredientModal(null));
    $('#add-recipe-btn').addEventListener('click', () => openRecipeModal(null));
    $('#pantry-sort').addEventListener('change', (e) => { state.pantrySort = e.target.value; renderPantry(); });
    $('#pantry-search').addEventListener('input', (e) => { state.pantrySearch = e.target.value; renderPantry(); });
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    setupCalculator();
    setupSettings();
    bootstrap();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
