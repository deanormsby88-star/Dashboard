/* ==================================================================
   Nunu's Bakery — single-page app (vanilla JS)
   ================================================================== */
(function () {
  'use strict';

  const API = 'api/';

  const CATEGORIES = [
    { key: 'ingredient', label: 'Ingredients', plural: 'Ingredients' },
    { key: 'packaging', label: 'Packaging', plural: 'Packaging' },
    { key: 'consumable', label: 'Consumables', plural: 'Consumables' },
  ];

  const state = {
    authed: false,
    csrf: null,
    currency: 'R',
    ingredients: [],
    recipes: [],
    suppliers: [],
    activeTab: 'pantry',
    pantrySort: 'name',
    pantrySearch: '',
    pantryCategory: 'all',
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
  function moneyFine(n) {
    const v = Number(n) || 0;
    const dp = v < 1 ? 4 : 2;
    return state.currency + ' ' + v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  const fmtNum = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
  const unitShort = (u) => (u === 'ml' ? 'ml' : (u === 'units' ? '' : 'g'));
  const bigUnit   = (u) => (u === 'ml' ? 'L' : (u === 'units' ? 'items' : 'kg'));
  // e.g. 1000 g -> "1,000g"; 50 units -> "50 units"
  const packLabel = (size, u) => (u === 'units'
    ? fmtNum(size) + ' ' + (Number(size) === 1 ? 'unit' : 'units')
    : fmtNum(size) + unitShort(u));
  const catLabel  = (key) => (CATEGORIES.find((c) => c.key === key) || CATEGORIES[0]).label;

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
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
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

  /** Download a file produced by a GET endpoint (export JSON / Excel). */
  async function downloadFromApi(path, filename) {
    try {
      const res = await fetch(API + path, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Export failed (' + res.status + ')');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('Exported');
    } catch (e) { toast(e.message, true); }
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

  /* ---------------- small builders ---------------- */
  function field(label, input) {
    return el('label', { class: 'field' }, el('span', {}, label), input);
  }
  function optionEl(value, label, current) {
    const o = el('option', { value }, label);
    if (String(current) === String(value)) o.selected = true;
    return o;
  }
  function costLine(k, v) {
    return el('div', { class: 'cost-line' }, el('span', { class: 'k' }, k), el('span', { class: 'v' }, v));
  }

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
  async function loadAll() { await Promise.all([loadIngredients(), loadRecipes(), loadSuppliers()]); }

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
  async function loadSuppliers() {
    const d = await api('suppliers.php');
    state.suppliers = d.suppliers || [];
    renderSuppliers();
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
     STOCK (PANTRY)
     ================================================================ */
  function sortedIngredients() {
    let list = state.ingredients.slice();
    if (state.pantryCategory !== 'all') list = list.filter((i) => (i.category || 'ingredient') === state.pantryCategory);
    const q = state.pantrySearch.trim().toLowerCase();
    if (q) list = list.filter((i) => (i.name || '').toLowerCase().includes(q) ||
                                      (i.brand || '').toLowerCase().includes(q) ||
                                      (i.store || '').toLowerCase().includes(q));
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
    // category filter chips (with counts)
    const cats = $('#pantry-cats');
    cats.innerHTML = '';
    const counts = { all: state.ingredients.length };
    CATEGORIES.forEach((c) => { counts[c.key] = state.ingredients.filter((i) => (i.category || 'ingredient') === c.key).length; });
    const chip = (key, label) => el('button', {
      class: 'cat-chip' + (state.pantryCategory === key ? ' active' : ''),
      onclick: () => { state.pantryCategory = key; renderPantry(); },
    }, label + ' (' + (counts[key] || 0) + ')');
    cats.appendChild(chip('all', 'All'));
    CATEGORIES.forEach((c) => cats.appendChild(chip(c.key, c.label)));

    // summary
    const shown = sortedIngredients();
    const low = state.ingredients.filter((i) => Number(i.quantity_in_stock) <= 1 && Number(i.quantity_in_stock) > 0).length;
    const summary = $('#pantry-summary');
    summary.innerHTML = '';
    summary.appendChild(el('div', { class: 'summary-chip' },
      el('span', { class: 'num' }, String(state.ingredients.length)),
      el('span', { class: 'lbl' }, 'items tracked')));
    summary.appendChild(el('div', { class: 'summary-chip' + (low ? ' warn' : '') },
      el('span', { class: 'num' }, String(low)),
      el('span', { class: 'lbl' }, low ? 'low on stock' : 'none running low')));

    const grid = $('#pantry-list');
    grid.innerHTML = '';
    if (!shown.length) {
      grid.appendChild(el('div', { class: 'empty' },
        el('span', { class: 'big' }, '🧺'),
        state.ingredients.length ? 'Nothing here in this view.' : 'Your stock is empty — add your first item.'));
      return;
    }
    for (const ing of shown) grid.appendChild(ingredientCard(ing));
  }

  function costLinesFor(ing) {
    const u = ing.pack_unit;
    if (u === 'units') {
      return [costLine('Per item', moneyFine(ing.cost_per_unit))];
    }
    return [
      costLine('Per ' + unitShort(u), moneyFine(ing.cost_per_unit)),
      costLine('Per ' + bigUnit(u), moneyFine(ing.cost_per_1000)),
    ];
  }

  function ingredientCard(ing) {
    const cat = ing.category || 'ingredient';
    const isLow = Number(ing.quantity_in_stock) <= 1 && Number(ing.quantity_in_stock) > 0;
    const sub = [ing.brand, ing.store].filter(Boolean).join(' · ');
    const inner = el('div', { class: 'card-inner' },
      el('div', { class: 'ing-head' },
        el('div', {},
          el('h3', { class: 'ing-name' }, ing.name),
          sub ? el('p', { class: 'ing-brand' }, sub) : null),
        el('div', { class: 'ing-tags' },
          cat !== 'ingredient' ? el('span', { class: 'badge cat' }, catLabel(cat)) : null,
          isLow ? el('span', { class: 'badge low' }, 'Low') : null)),
      el('p', { class: 'ing-meta', html:
        'Pack <b>' + esc(packLabel(ing.pack_size, ing.pack_unit)) + '</b> · ' +
        'Paid <b>' + esc(money(ing.price_paid)) + '</b><br>' +
        'In stock <b>' + esc(fmtNum(ing.quantity_in_stock)) + '</b>' }),
      el('div', { class: 'cost-lines' }, ...costLinesFor(ing)),
      el('div', { class: 'card-actions' },
        el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openIngredientModal(ing) }, 'Edit'),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => deleteIngredient(ing) }, 'Delete')));
    return el('div', { class: 'card notebook ing-card' }, inner);
  }

  function openIngredientModal(ing, prefill) {
    const isEdit = !!ing;
    const v = ing || prefill || { pack_unit: 'grams', category: 'ingredient' };
    const form = el('form', { class: 'ing-form' },
      field('Name', el('input', { type: 'text', id: 'f-name', value: v.name || '', required: 'required' })),
      el('div', { class: 'field' },
        el('span', {}, 'Category'),
        el('select', { id: 'f-cat' }, ...CATEGORIES.map((c) => optionEl(c.key, c.label, v.category || 'ingredient')))),
      field('Brand (optional)', el('input', { type: 'text', id: 'f-brand', value: v.brand || '' })),
      field('Store (where you bought it)', el('input', { type: 'text', id: 'f-store', value: v.store || '', placeholder: 'e.g. Checkers, Makro' })),
      el('div', { class: 'field' },
        el('span', {}, 'Pack size'),
        el('div', { class: 'pack-row' },
          el('input', { type: 'number', step: 'any', min: '0', id: 'f-size', value: v.pack_size != null ? v.pack_size : '', required: 'required' }),
          el('select', { id: 'f-unit' },
            optionEl('grams', 'grams (g)', v.pack_unit),
            optionEl('ml', 'millilitres (ml)', v.pack_unit),
            optionEl('units', 'units (each)', v.pack_unit)))),
      field('Price paid (' + state.currency + ')', el('input', { type: 'number', step: 'any', min: '0', id: 'f-price', value: v.price_paid != null ? v.price_paid : '', required: 'required' })),
      field('Quantity in stock (packs on hand)', el('input', { type: 'number', step: 'any', min: '0', id: 'f-qty', value: v.quantity_in_stock != null ? v.quantity_in_stock : '' })),
      el('div', { class: 'btn-row' },
        el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'Save changes' : 'Add item'),
        el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'Cancel')));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: $('#f-name').value.trim(),
        category: $('#f-cat').value,
        brand: $('#f-brand').value.trim(),
        store: $('#f-store').value.trim(),
        pack_size: parseFloat($('#f-size').value) || 0,
        pack_unit: $('#f-unit').value,
        price_paid: parseFloat($('#f-price').value) || 0,
        quantity_in_stock: parseFloat($('#f-qty').value) || 0,
      };
      if (!body.name) { toast('Name is required', true); return; }
      try {
        if (isEdit) { body.id = ing.id; await api('ingredients.php', { method: 'PUT', body }); }
        else { await api('ingredients.php', { method: 'POST', body }); }
        closeModal();
        await loadIngredients();
        await loadRecipes(); // costs may change
        toast(isEdit ? 'Item updated' : 'Item added');
      } catch (err) { toast(err.message, true); }
    });

    openModal(isEdit ? 'Edit stock item' : 'Add stock item', form);
  }

  async function deleteIngredient(ing) {
    if (!confirm('Delete "' + ing.name + '" from your stock?')) return;
    try {
      await api('ingredients.php', { method: 'DELETE', body: { id: ing.id } });
      await loadIngredients();
      await loadRecipes();
      toast('Item deleted');
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

  function recipeYieldLine(r) {
    const label = r.yield_text || (r.yield_mode === 'multiply' ? 'batch' : 'units');
    if (!r.yield_quantity) return 'No yield set';
    if (r.yield_mode === 'multiply') return 'Makes 1 ' + label + ' · costing ' + fmtNum(r.yield_quantity);
    return 'Yields ' + fmtNum(r.yield_quantity) + ' ' + label;
  }

  function recipeStats(r) {
    if (r.yield_mode === 'multiply') {
      return [
        { lbl: 'Cost to make one', val: money(r.unit_cost != null ? r.unit_cost : r.total_cost) },
        r.yield_quantity ? { lbl: 'Total for ' + fmtNum(r.yield_quantity), val: money(r.batch_total) } : null,
      ];
    }
    return [
      { lbl: 'Total batch cost', val: money(r.batch_total != null ? r.batch_total : r.total_cost) },
      r.unit_cost != null ? { lbl: 'Cost each', val: money(r.unit_cost) } : null,
    ];
  }

  function recipeCard(r) {
    const missing = r.ingredients.filter((l) => !l.in_pantry).length;
    const rows = r.ingredients.map((l) =>
      el('tr', { class: l.in_pantry ? '' : 'missing' },
        el('td', {}, l.in_pantry ? (l.ingredient_name || '—') : (l.ingredient_name || 'Not in stock')),
        el('td', { class: 'num' }, packLabel(l.quantity_used, l.unit)),
        el('td', { class: 'num' }, l.in_pantry ? moneyFine(l.cost) : '—')));

    const stats = recipeStats(r).filter(Boolean).map((s) =>
      el('div', { class: 'recipe-stat' }, el('span', { class: 'lbl' }, s.lbl), el('span', { class: 'val' }, s.val)));

    const inner = el('div', { class: 'card-inner' },
      el('h3', { class: 'recipe-name' }, r.name),
      el('p', { class: 'recipe-yield' }, recipeYieldLine(r)),
      el('div', { class: 'recipe-totals' }, ...stats),
      missing ? el('div', { class: 'recipe-flag' },
        '⚠ ' + missing + ' item' + (missing > 1 ? 's' : '') + ' not in your stock — add ' +
        (missing > 1 ? 'them' : 'it') + ' to include in the cost.') : null,
      r.ingredients.length ? el('table', { class: 'breakdown' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Item'), el('th', { class: 'num' }, 'Qty'), el('th', { class: 'num' }, 'Cost'))),
        el('tbody', {}, ...rows)) : el('p', { class: 'recipe-yield' }, 'No items added.'),
      el('p', { class: 'recalc' }, 'Cost recalculated ' + (r.calculated_at || '')),
      el('div', { class: 'card-actions' },
        el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openRecipeModal(r) }, 'Edit'),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => deleteRecipe(r) }, 'Delete')));

    return el('div', { class: 'card notebook recipe-card' }, inner);
  }

  function recipeIngredientRow(line) {
    line = line || { ingredient_id: '', quantity_used: '', unit: 'grams' };
    const sel = el('select', {}, el('option', { value: '' }, '— choose —'));
    // group the dropdown by category
    CATEGORIES.forEach((c) => {
      const items = state.ingredients.filter((i) => (i.category || 'ingredient') === c.key)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!items.length) return;
      const group = el('optgroup', { label: c.plural });
      items.forEach((ing) => {
        const o = el('option', { value: String(ing.id) }, ing.name + (ing.brand ? ' (' + ing.brand + ')' : ''));
        o.dataset.unit = ing.pack_unit;
        if (String(line.ingredient_id) === String(ing.id)) o.selected = true;
        group.appendChild(o);
      });
      sel.appendChild(group);
    });
    const unitSel = el('select', {},
      optionEl('grams', 'g', line.unit), optionEl('ml', 'ml', line.unit), optionEl('units', 'units', line.unit));
    // auto-match the unit to the chosen item's pack unit
    sel.addEventListener('change', () => {
      const opt = sel.options[sel.selectedIndex];
      if (opt && opt.dataset.unit) unitSel.value = opt.dataset.unit;
    });
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

    const noStock = state.ingredients.length === 0;
    const mode = isEdit ? (r.yield_mode || 'divide') : 'divide';

    const modeSel = el('select', { id: 'r-mode' },
      optionEl('divide', 'It yields several — work out cost each', mode),
      optionEl('multiply', 'It makes one — scale up to a batch', mode));
    const qtyLabelSpan = el('span', {}, mode === 'multiply' ? 'How many do you want to make?' : 'Number it yields');
    const qtyInput = el('input', { type: 'number', step: 'any', min: '0', id: 'r-qty', value: isEdit && r.yield_quantity != null ? r.yield_quantity : '' });
    modeSel.addEventListener('change', () => {
      qtyLabelSpan.textContent = modeSel.value === 'multiply' ? 'How many do you want to make?' : 'Number it yields';
    });

    const form = el('form', {},
      field('Recipe name', el('input', { type: 'text', id: 'r-name', value: isEdit ? r.name : '', required: 'required' })),
      el('label', { class: 'field' }, el('span', {}, 'What does this recipe make?'), modeSel),
      el('div', { class: 'form-grid' },
        el('label', { class: 'field' }, qtyLabelSpan, qtyInput),
        field('Unit name (muffins, loaf, cake…)', el('input', { type: 'text', id: 'r-label', value: isEdit ? (r.yield_text || '') : '', placeholder: 'e.g. muffins' }))),
      el('div', { class: 'field' },
        el('span', {}, 'Items from your stock (ingredients & packaging)'),
        noStock ? el('p', { class: 'recipe-flag' }, 'Add items to your Stock first to build a costed recipe.') : null,
        el('div', { class: 'ri-head' },
          el('span', {}, 'Item'), el('span', {}, 'Qty'), el('span', {}, 'Unit'), el('span', {})),
        rowsWrap,
        el('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => rowsWrap.appendChild(recipeIngredientRow()) }, '+ Add row')),
      el('div', { class: 'btn-row' },
        el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'Save recipe' : 'Create recipe'),
        el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'Cancel')));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#r-name').value.trim();
      if (!name) { toast('Recipe name is required', true); return; }
      const ingredients = [];
      $$('.ri-row', rowsWrap).forEach((row) => {
        const iid = row.children[0].value;
        const qty = parseFloat(row.children[1].value);
        if (iid && qty > 0) ingredients.push({ ingredient_id: iid, quantity_used: qty, unit: row.children[2].value });
      });
      const body = {
        name,
        yield_mode: $('#r-mode').value,
        yield_quantity: $('#r-qty').value !== '' ? parseFloat($('#r-qty').value) : null,
        yield_text: $('#r-label').value.trim(),
        ingredients,
      };
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
     SUPPLIERS (contacts)
     ================================================================ */
  function renderSuppliers() {
    const grid = $('#supplier-list');
    if (!grid) return;
    grid.innerHTML = '';
    if (!state.suppliers.length) {
      grid.appendChild(el('div', { class: 'empty' },
        el('span', { class: 'big' }, '📇'),
        'No supplier contacts yet — add your first.'));
      return;
    }
    state.suppliers.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .forEach((s) => grid.appendChild(supplierCard(s)));
  }

  function contactRow(icon, text, href) {
    if (!text) return null;
    const val = href ? el('a', { href, class: 'contact-link' }, text) : el('span', {}, text);
    return el('div', { class: 'contact-row' }, el('span', { class: 'contact-ico' }, icon), val);
  }

  function supplierCard(s) {
    const inner = el('div', { class: 'card-inner' },
      el('h3', { class: 'ing-name' }, s.name),
      s.company ? el('p', { class: 'ing-brand' }, s.company) : null,
      el('div', { class: 'contact-rows' },
        contactRow('📞', s.phone, s.phone ? 'tel:' + s.phone.replace(/\s+/g, '') : null),
        contactRow('✉️', s.email, s.email ? 'mailto:' + s.email : null),
        contactRow('🌐', s.website, s.website ? (/^https?:\/\//.test(s.website) ? s.website : 'https://' + s.website) : null),
        s.notes ? el('div', { class: 'contact-row notes' }, el('span', { class: 'contact-ico' }, '📝'), el('span', {}, s.notes)) : null),
      el('div', { class: 'card-actions' },
        el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openSupplierModal(s) }, 'Edit'),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => deleteSupplier(s) }, 'Delete')));
    return el('div', { class: 'card notebook supplier-card' }, inner);
  }

  function openSupplierModal(s) {
    const isEdit = !!s;
    const v = s || {};
    const form = el('form', {},
      field('Name', el('input', { type: 'text', id: 's-name', value: v.name || '', required: 'required' })),
      field('Company (optional)', el('input', { type: 'text', id: 's-company', value: v.company || '' })),
      field('Phone', el('input', { type: 'tel', id: 's-phone', value: v.phone || '', placeholder: 'e.g. 082 123 4567' })),
      field('Email', el('input', { type: 'email', id: 's-email', value: v.email || '' })),
      field('Website', el('input', { type: 'text', id: 's-website', value: v.website || '', placeholder: 'e.g. supplier.co.za' })),
      el('label', { class: 'field' }, el('span', {}, 'Notes'),
        el('textarea', { id: 's-notes', rows: '3', placeholder: 'Order minimums, delivery days, account number…' }, v.notes || '')),
      el('div', { class: 'btn-row' },
        el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'Save contact' : 'Add contact'),
        el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'Cancel')));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: $('#s-name').value.trim(),
        company: $('#s-company').value.trim(),
        phone: $('#s-phone').value.trim(),
        email: $('#s-email').value.trim(),
        website: $('#s-website').value.trim(),
        notes: $('#s-notes').value.trim(),
      };
      if (!body.name) { toast('Contact name is required', true); return; }
      try {
        if (isEdit) { body.id = s.id; await api('suppliers.php', { method: 'PUT', body }); }
        else { await api('suppliers.php', { method: 'POST', body }); }
        closeModal();
        await loadSuppliers();
        toast(isEdit ? 'Contact saved' : 'Contact added');
      } catch (err) { toast(err.message, true); }
    });

    openModal(isEdit ? 'Edit contact' : 'New contact', form);
  }

  async function deleteSupplier(s) {
    if (!confirm('Delete contact "' + s.name + '"?')) return;
    try {
      await api('suppliers.php', { method: 'DELETE', body: { id: s.id } });
      await loadSuppliers();
      toast('Contact deleted');
    } catch (e) { toast(e.message, true); }
  }

  /* ================================================================
     CALCULATOR — compare a single item across stores (client-side)
     ================================================================ */
  const calcState = { name: '', unit: 'grams', rows: [{ store: '', size: '', price: '' }, { store: '', size: '', price: '' }] };
  let calcEls = [];

  // Recompute per-store results in place — does NOT rebuild inputs, so
  // typing never loses focus.
  function recomputeCalc() {
    const isUnits = calcState.unit === 'units';
    const per = calcState.rows.map((r) => {
      const size = parseFloat(r.size), price = parseFloat(r.price);
      return (size > 0 && price >= 0) ? price / size : null;
    });
    const valid = per.filter((p) => p != null);
    const cheapest = valid.length ? Math.min(...valid) : null;
    const max = valid.length ? Math.max(...valid) : null;

    calcEls.forEach((c, idx) => {
      const p = per[idx];
      const best = p != null && cheapest != null && Math.abs(p - cheapest) < 1e-9 && valid.length > 1;
      c.rowEl.classList.toggle('best', best);
      c.resultEl.innerHTML = '';
      if (best) c.resultEl.appendChild(el('span', { class: 'best-tag' }, 'Best'));
      c.resultEl.appendChild(p == null ? el('span', { class: 'calc-cell-muted' }, '—')
        : el('span', {}, isUnits ? moneyFine(p) + ' /item' : moneyFine(p * 1000) + ' /' + bigUnit(calcState.unit)));
      c.addBtn.disabled = p == null;
    });

    const note = $('#calc-savings');
    if (note) {
      note.textContent = (valid.length > 1 && max > 0 && Math.round((1 - cheapest / max) * 100) > 0)
        ? 'Cheapest store saves about ' + Math.round((1 - cheapest / max) * 100) + '% versus the priciest.' : '';
    }
  }

  function renderCalculator() {
    const root = $('#calc-app');
    if (!root) return;
    root.innerHTML = '';
    calcEls = [];
    const isUnits = calcState.unit === 'units';

    const nameInput = el('input', { type: 'text', value: calcState.name, placeholder: 'e.g. Cake flour', oninput: (e) => { calcState.name = e.target.value; } });
    const unitSel = el('select', {},
      optionEl('grams', 'grams (g)', calcState.unit),
      optionEl('ml', 'millilitres (ml)', calcState.unit),
      optionEl('units', 'units (each)', calcState.unit));
    unitSel.addEventListener('change', () => { calcState.unit = unitSel.value; renderCalculator(); });

    const rowEls = calcState.rows.map((r, idx) => {
      const storeIn = el('input', { type: 'text', value: r.store, placeholder: 'Store', oninput: (e) => { r.store = e.target.value; } });
      const sizeIn = el('input', { type: 'number', step: 'any', min: '0', value: r.size, placeholder: 'Pack', oninput: (e) => { r.size = e.target.value; recomputeCalc(); } });
      const priceIn = el('input', { type: 'number', step: 'any', min: '0', value: r.price, placeholder: 'Price', oninput: (e) => { r.price = e.target.value; recomputeCalc(); } });
      const resultEl = el('div', { class: 'calc-result' });
      const addBtn = el('button', {
        type: 'button', class: 'btn btn-secondary btn-sm', title: 'Add this to Stock',
        onclick: () => openIngredientModal(null, {
          name: calcState.name.trim(), store: r.store, pack_size: parseFloat(r.size) || 0,
          pack_unit: calcState.unit, price_paid: parseFloat(r.price) || 0, category: 'ingredient',
        }),
      }, 'Add');
      const rowEl = el('div', { class: 'calc-store-row' }, storeIn, sizeIn, priceIn, resultEl, addBtn,
        calcState.rows.length > 1
          ? el('button', { type: 'button', class: 'ri-remove', title: 'Remove', onclick: () => { calcState.rows.splice(idx, 1); renderCalculator(); } }, '×')
          : el('span', {}));
      calcEls.push({ rowEl, resultEl, addBtn });
      return rowEl;
    });

    root.appendChild(el('div', { class: 'card notebook calc-card' },
      el('div', { class: 'form-grid' },
        field('Item name', nameInput),
        el('label', { class: 'field' }, el('span', {}, 'Unit'), unitSel)),
      el('div', { class: 'calc-store-head' },
        el('span', {}, 'Store'), el('span', {}, 'Pack size'), el('span', {}, 'Price'),
        el('span', {}, isUnits ? 'Per item' : 'Per ' + bigUnit(calcState.unit)), el('span', {}), el('span', {})),
      ...rowEls,
      el('p', { id: 'calc-savings', class: 'calc-savings' }),
      el('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { calcState.rows.push({ store: '', size: '', price: '' }); renderCalculator(); } }, '+ Add another store')));

    recomputeCalc();
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
        renderPantry(); renderRecipes(); renderCalculator();
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

    $('#export-btn').addEventListener('click', () =>
      downloadFromApi('export.php', 'nunus-bakery-backup-' + new Date().toISOString().slice(0, 10) + '.json'));
    $('#export-excel-btn').addEventListener('click', () =>
      downloadFromApi('export_excel.php', 'nunus-bakery-' + new Date().toISOString().slice(0, 10) + '.xls'));

    $('#import-btn').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('Importing will REPLACE all current data with the contents of this file. Continue?')) {
        e.target.value = ''; return;
      }
      try {
        const data = JSON.parse(await file.text());
        await api('import.php', { method: 'POST', body: { action: 'import', data } });
        await loadAll();
        toast('Data imported');
      } catch (err) { toast('Import failed: ' + err.message, true); }
      e.target.value = '';
    });

    $('#clear-btn').addEventListener('click', async () => {
      if (!confirm('This will permanently delete ALL stock, recipes and contacts. Are you sure?')) return;
      if (!confirm('Really clear everything? This cannot be undone.')) return;
      try {
        await api('import.php', { method: 'POST', body: { action: 'clear' } });
        await loadAll();
        toast('All data cleared');
      } catch (e) { toast(e.message, true); }
    });

    $('#logout-btn').addEventListener('click', doLogout);
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
    const addSup = $('#add-supplier-btn');
    if (addSup) addSup.addEventListener('click', () => openSupplierModal(null));
    $('#pantry-sort').addEventListener('change', (e) => { state.pantrySort = e.target.value; renderPantry(); });
    $('#pantry-search').addEventListener('input', (e) => { state.pantrySearch = e.target.value; renderPantry(); });
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    renderCalculator();
    setupSettings();
    bootstrap();
  }

  // Run now if the DOM is already parsed (e.g. when the script is injected
  // after load), otherwise wait for DOMContentLoaded.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
