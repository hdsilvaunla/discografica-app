/* =========================================================================
   DISCOGRAFÍA MOBILE v7.1.2 — Modo consulta (APK / WebView)
   Read-only + Import prioritario · localStorage persistente
   Autor: HDSystem IT · Tel: +54 9 11 4563-0851

   v7.1.2 — Fixes:
     - Store.allCDs() devuelve [] si App.db es null (elimina TypeError)
     - Store.totalArtists() devuelve 0 si App.db es null
     - Guardas defensivas en todos los métodos que tocan App.db
     - Filter.apply() y UI.render*() con validaciones

   v7.1.1 — Fixes de auditoría:
     - Back button Android corregido (pushBackIfNeeded en cada open)
     - isVisible() helper robusto
     - Toast container resuelto dinámicamente
     - pushState con URL explícita
     - normalizeCategory valida cds no-array
     - Mensajes de error específicos en storage
     - Footer oculto sin datos
     - Lightbox con manejo de error
   ========================================================================= */

'use strict';

const APP_VERSION = '7.1.2';
const STORAGE_KEY = 'discografia_mobile_data_v1';
const PREFS_KEY   = 'discografia_mobile_prefs_v1';
const LEGAL_KEY   = 'discografia_mobile_legal_v1';

/* ═══════════════════════════════════════════════════════════════════
   Estado global
   ═══════════════════════════════════════════════════════════════════ */
const App = {
  db: null,
  cat: null,
  subcat: null,
  q: '',
  filters: {
    artista: '',
    anioDesde: '',
    anioHasta: '',
    sello: '',
    genero: '',
    portada: '',
    prestamo: ''
  },
  orden: 'nro',
  currentCD: null,
  filteredCache: [],
  allCDsCache: null,
  preferences: { theme: 'dark' }
};

/* ═══════════════════════════════════════════════════════════════════
   Utilidades
   ═══════════════════════════════════════════════════════════════════ */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const norm = s => String(s ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const upper = v => (v === null || v === undefined) ? '' : String(v).toUpperCase();

function debounce(fn, ms = 180) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/* v7.1.1 — Helper de visibilidad robusto */
function isVisible(sel) {
  const el = $(sel);
  return !!(el && !el.hidden);
}

/* ═══════════════════════════════════════════════════════════════════
   Preferencias
   ═══════════════════════════════════════════════════════════════════ */
const Prefs = {
  load() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) App.preferences = Object.assign(App.preferences, JSON.parse(raw));
    } catch (e) {}
    this.applyTheme();
  },
  save() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(App.preferences)); } catch (e) {}
  },
  applyTheme() {
    const isLight = App.preferences.theme === 'light';
    document.body.classList.toggle('theme-light', isLight);
    const ico = $('#themeIco');
    if (ico) ico.textContent = isLight ? '☀️' : '🌙';
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', isLight ? '#f4f6fa' : '#0e1116');
  },
  toggleTheme() {
    App.preferences.theme = App.preferences.theme === 'light' ? 'dark' : 'light';
    this.save();
    this.applyTheme();
    Toast.show(App.preferences.theme === 'light' ? '☀️ Tema claro' : '🌙 Tema oscuro', 'info', 1500);
  }
};

/* ═══════════════════════════════════════════════════════════════════
   Toast — resuelve container dinámicamente
   ═══════════════════════════════════════════════════════════════════ */
const Toast = (() => {
  const icons = { ok: '✓', err: '✕', warn: '⚠', info: 'ℹ' };
  return {
    show(msg, type = 'ok', ms = 3000) {
      const container = $('#toasts');
      if (!container) return;
      const el = document.createElement('div');
      el.className = 'toast ' + type;
      el.innerHTML = `<div class="toast-icon">${icons[type] || icons.info}</div><div>${esc(msg)}</div>`;
      container.appendChild(el);
      setTimeout(() => {
        el.classList.add('hide');
        setTimeout(() => el.remove(), 250);
      }, ms);
    }
  };
})();

/* ═══════════════════════════════════════════════════════════════════
   Store de datos — v7.1.2 con guards defensivos
   ═══════════════════════════════════════════════════════════════════ */
const Store = {
  hydrate(cd) {
    return {
      id: cd.id || ('cd_' + Math.random().toString(36).slice(2, 10)),
      nro: cd.nro ?? 0,
      titulo: upper(cd.titulo),
      interprete: upper(cd.interprete),
      anio: cd.anio ?? null,
      anioEdicion: cd.anioEdicion ?? null,
      formato: cd.formato ?? 'CD',
      estado: cd.estado ?? '',
      sello: upper(cd.sello),
      genero: upper(cd.genero),
      catalogo: upper(cd.catalogo),
      codigo: cd.codigo ?? '',
      isrc: (cd.isrc ?? '').toString().toUpperCase(),
      edicion: upper(cd.edicion),
      pais: upper(cd.pais),
      ubicacion: upper(cd.ubicacion),
      cantidad: cd.cantidad ?? 1,
      adquisicion: cd.adquisicion ?? '',
      valor: cd.valor ?? null,
      moneda: cd.moneda ?? 'ARS',
      notas: cd.notas ?? '',
      portada: cd.portada ?? null,
      links: (cd.links && typeof cd.links === 'object' && !Array.isArray(cd.links)) ? { ...cd.links } : {},
      subcat: cd.subcat ?? null,
      prestadoA: upper(cd.prestadoA),
      fechaPrestamo: cd.fechaPrestamo ?? '',
      fechaDevolucion: cd.fechaDevolucion ?? '',
      notasPrestamo: upper(cd.notasPrestamo),
      estadoDisco: cd.estadoDisco ?? '',
      estadoCaja: cd.estadoCaja ?? '',
      estadoFolleto: cd.estadoFolleto ?? '',
      estadoArte: cd.estadoArte ?? '',
      customFields: (cd.customFields && typeof cd.customFields === 'object') ? { ...cd.customFields } : {},
      enrichmentSource: cd.enrichmentSource ?? null,
      enrichmentConfidence: cd.enrichmentConfidence ?? null,
      enrichedAt: cd.enrichedAt ?? null
    };
  },

  /* v7.1.1 — Valida que cds sea array (o convierte objeto) */
  normalizeCategory(cat, key) {
    const cdsRaw = cat.cds;
    let cds = [];
    if (Array.isArray(cdsRaw)) {
      cds = cdsRaw.map(c => this.hydrate(c));
    } else if (cdsRaw && typeof cdsRaw === 'object') {
      console.warn(`[Store] La categoría "${key}" tiene un objeto en lugar de array en "cds". Convirtiendo.`);
      cds = Object.values(cdsRaw).map(c => this.hydrate(c));
    }
    return {
      label: cat.label || key,
      icon: cat.icon || '📀',
      subcategories: Array.isArray(cat.subcategories) ? cat.subcategories.map(s => ({
        id: s.id || ('sub_' + Math.random().toString(36).slice(2, 8)),
        label: String(s.label || 'Sin nombre'),
        icon: String(s.icon || '📂')
      })) : [],
      cds
    };
  },

  extractFromJSON(raw) {
    if (Array.isArray(raw)) {
      return {
        version: 5,
        updated: new Date().toISOString(),
        categories: {
          importados: {
            label: 'Importados',
            icon: '📀',
            subcategories: [],
            cds: raw
          }
        }
      };
    }
    if (raw && raw.categories && typeof raw.categories === 'object') {
      return raw;
    }
    if (raw && Array.isArray(raw.cds)) {
      const catKey = raw.category || 'importados';
      return {
        version: 5,
        updated: raw.exported || new Date().toISOString(),
        categories: {
          [catKey]: {
            label: raw.label || raw.category || 'Importados',
            icon: raw.icon || '📀',
            subcategories: raw.subcategories || [],
            cds: raw.cds
          }
        }
      };
    }
    return null;
  },

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      const normalized = this.extractFromJSON(data);
      if (!normalized) return false;
      this.buildFromRaw(normalized);
      return true;
    } catch (e) {
      console.warn('Error cargando storage', e);
      return false;
    }
  },

  buildFromRaw(raw) {
    const normalized = this.extractFromJSON(raw);
    if (!normalized) throw new Error('Formato de archivo no reconocido');

    const clean = {};
    for (const k in normalized.categories) {
      clean[k] = this.normalizeCategory(normalized.categories[k], k);
    }

    App.db = {
      version: 5,
      updated: normalized.updated || new Date().toISOString(),
      categories: clean
    };
    App.allCDsCache = null;

    const keys = Object.keys(clean);
    App.cat = keys[0] || null;
    App.subcat = null;

    /* v7.1.1 — Mensajes de error específicos */
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(App.db));
    } catch (e) {
      console.warn('No se pudo guardar en storage', e);
      const isQuota = e.name === 'QuotaExceededError' || /quota/i.test(e.message || '');
      if (isQuota) {
        Toast.show('⚠️ Espacio lleno. Los datos NO se guardaron.', 'warn', 6000);
      } else {
        Toast.show('⚠️ No se pudo guardar en el celular. Los datos se perderán al cerrar.', 'warn', 7000);
      }
    }
  },

  /* v7.1.2 — GUARD: devuelve [] si App.db es null */
  allCDs() {
    if (!App.db) return [];
    if (App.allCDsCache) return App.allCDsCache;
    const out = [];
    for (const k in App.db.categories) {
      for (const cd of App.db.categories[k].cds) {
        out.push({ cd, cat: k });
      }
    }
    App.allCDsCache = out;
    return out;
  },

  /* v7.1.2 — GUARD explícito */
  getCDsByCat(catKey) {
    if (!App.db) return [];
    if (!catKey) return [];
    return App.db.categories?.[catKey]?.cds || [];
  },

  /* v7.1.2 — GUARD explícito */
  getCategory(catKey) {
    if (!App.db) return null;
    if (!catKey) return null;
    return App.db.categories?.[catKey] || null;
  },

  clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    App.db = null;
    App.cat = null;
    App.subcat = null;
    App.allCDsCache = null;
    App.filteredCache = [];
    App.currentCD = null;
  },

  /* v7.1.2 — GUARD: devuelve 0 si App.db es null */
  total() {
    if (!App.db) return 0;
    return this.allCDs().length;
  },

  /* v7.1.2 — GUARD: devuelve 0 si App.db es null */
  totalArtists() {
    if (!App.db) return 0;
    const set = new Set();
    for (const { cd } of this.allCDs()) {
      if (cd.interprete) set.add(cd.interprete);
    }
    return set.size;
  }
};

/* ═══════════════════════════════════════════════════════════════════
   Filtros y orden
   ═══════════════════════════════════════════════════════════════════ */
const Filter = {
  apply() {
    /* v7.1.2 — GUARD doble */
    if (!App.db) { App.filteredCache = []; return []; }
    if (!App.db.categories) { App.filteredCache = []; return []; }

    const q = norm(App.q).trim();
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    const f = App.filters;

    let source = [];
    if (App.cat && App.cat !== '__all__') {
      source = Store.getCDsByCat(App.cat);
    } else {
      source = Store.allCDs().map(x => x.cd);
    }

    const out = source.filter(cd => {
      if (App.subcat && cd.subcat !== App.subcat) return false;

      if (f.artista && cd.interprete !== f.artista) return false;

      if (f.anioDesde) {
        const a = parseInt(f.anioDesde, 10);
        if (!isNaN(a) && (cd.anio ?? -Infinity) < a) return false;
      }
      if (f.anioHasta) {
        const a = parseInt(f.anioHasta, 10);
        if (!isNaN(a) && (cd.anio ?? Infinity) > a) return false;
      }

      if (f.sello && cd.sello !== f.sello) return false;
      if (f.genero && cd.genero !== f.genero) return false;

      if (f.portada === '__con__' && !cd.portada) return false;
      if (f.portada === '__sin__' && cd.portada) return false;

      if (f.prestamo === '__prestados__' && !cd.prestadoA) return false;
      if (f.prestamo === '__disponibles__' && cd.prestadoA) return false;

      if (!terms.length) return true;
      const h = norm([cd.titulo, cd.interprete, cd.sello, cd.anio, cd.catalogo, cd.genero].join(' '));
      return terms.every(t => h.includes(t));
    });

    const ord = App.orden;
    out.sort((a, b) => {
      switch (ord) {
        case 'nro': return (a.nro || 0) - (b.nro || 0);
        case 'nro-desc': return (b.nro || 0) - (a.nro || 0);
        case 'titulo': return norm(a.titulo).localeCompare(norm(b.titulo), 'es');
        case 'titulo-desc': return norm(b.titulo).localeCompare(norm(a.titulo), 'es');
        case 'interprete': return norm(a.interprete).localeCompare(norm(b.interprete), 'es');
        case 'anio': return (a.anio ?? 9999) - (b.anio ?? 9999);
        case 'anio-desc': return (b.anio ?? 0) - (a.anio ?? 0);
        default: return 0;
      }
    });

    App.filteredCache = out;
    return out;
  },

  activeCount() {
    let c = 0;
    for (const k in App.filters) {
      if (App.filters[k]) c++;
    }
    if (App.orden && App.orden !== 'nro') c++;
    return c;
  },

  clear() {
    App.filters = {
      artista: '', anioDesde: '', anioHasta: '', sello: '',
      genero: '', portada: '', prestamo: ''
    };
    App.orden = 'nro';
  }
};

/* ═══════════════════════════════════════════════════════════════════
   UI / Render
   ═══════════════════════════════════════════════════════════════════ */
const UI = {

  renderAll() {
    this.renderHeader();
    this.renderCategories();
    this.renderSubcategories();
    this.renderActiveFilters();
    this.renderList();
    this.renderEmptyStates();
  },

  renderHeader() {
    /* v7.1.1 — Ocultar footer cuando no hay datos */
    const footer = $('#appFooter');
    if (footer) footer.hidden = !App.db;

    if (!App.db) {
      const hs = $('#headerStats');
      if (hs) hs.hidden = true;
      const sb = $('#searchBar');
      if (sb) sb.hidden = true;
      return;
    }

    const st = $('#statTotal');
    const sa = $('#statArts');
    if (st) st.textContent = Store.total();
    if (sa) sa.textContent = Store.totalArtists();

    const hs = $('#headerStats');
    if (hs) hs.hidden = false;
    const sb = $('#searchBar');
    if (sb) sb.hidden = false;

    const updChip = $('#statUpdatedChip');
    if (updChip && App.db.updated) {
      try {
        const d = new Date(App.db.updated);
        const fmt = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
        updChip.textContent = '💾 ' + fmt;
        updChip.hidden = false;
      } catch (e) { updChip.hidden = true; }
    }

    const sub = $('#headerSubtitle');
    if (sub) {
      const n = Object.keys(App.db.categories || {}).length;
      sub.textContent = n + ' categoría' + (n === 1 ? '' : 's');
    }

    const fv = $('#footerVersion');
    if (fv) fv.textContent = 'v' + APP_VERSION;
  },

  renderCategories() {
    const el = $('#catNav');
    if (!el) return;

    /* v7.1.2 — GUARD */
    if (!App.db || !App.db.categories) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = '';

    const keys = Object.keys(App.db.categories);

    const allTab = document.createElement('button');
    allTab.type = 'button';
    allTab.className = 'cat-tab' + (App.cat === '__all__' ? ' active' : '');
    allTab.innerHTML = `<span>🗂️</span><span>Todas</span><span class="cat-count">${Store.total()}</span>`;
    allTab.addEventListener('click', () => {
      App.cat = '__all__';
      App.subcat = null;
      UI.renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    el.appendChild(allTab);

    for (const k of keys) {
      const cat = App.db.categories[k];
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'cat-tab' + (App.cat === k ? ' active' : '');
      tab.innerHTML = `<span>${esc(cat.icon)}</span><span>${esc(cat.label)}</span><span class="cat-count">${cat.cds.length}</span>`;
      tab.addEventListener('click', () => {
        App.cat = k;
        App.subcat = null;
        UI.renderAll();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      el.appendChild(tab);
    }

    requestAnimationFrame(() => {
      const active = el.querySelector('.cat-tab.active');
      if (active) {
        const left = active.offsetLeft - el.offsetWidth / 2 + active.offsetWidth / 2;
        el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
      }
    });
  },

  renderSubcategories() {
    const el = $('#subcatNav');
    if (!el) return;

    /* v7.1.2 — GUARD */
    if (!App.db || !App.cat || App.cat === '__all__') {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }

    const cat = Store.getCategory(App.cat);
    if (!cat || !cat.subcategories || !cat.subcategories.length) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }

    el.hidden = false;
    el.innerHTML = '';

    const allSub = document.createElement('button');
    allSub.type = 'button';
    allSub.className = 'subcat-tab' + (App.subcat === null ? ' active' : '');
    allSub.innerHTML = `<span>📚</span><span>Todas</span><span class="subcat-count">${cat.cds.length}</span>`;
    allSub.addEventListener('click', () => {
      App.subcat = null;
      UI.renderAll();
    });
    el.appendChild(allSub);

    for (const sub of cat.subcategories) {
      const count = cat.cds.filter(c => c.subcat === sub.id).length;
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'subcat-tab' + (App.subcat === sub.id ? ' active' : '');
      tab.innerHTML = `<span>${esc(sub.icon)}</span><span>${esc(sub.label)}</span><span class="subcat-count">${count}</span>`;
      tab.addEventListener('click', () => {
        App.subcat = (App.subcat === sub.id) ? null : sub.id;
        UI.renderAll();
      });
      el.appendChild(tab);
    }
  },

  renderActiveFilters() {
    const el = $('#activeFilters');
    if (!el) return;
    const chips = [];

    const f = App.filters;
    if (f.artista) chips.push({ label: '🎤 ' + f.artista, key: 'artista' });
    if (f.anioDesde) chips.push({ label: '📅 ≥ ' + f.anioDesde, key: 'anioDesde' });
    if (f.anioHasta) chips.push({ label: '📅 ≤ ' + f.anioHasta, key: 'anioHasta' });
    if (f.sello) chips.push({ label: '🏷️ ' + f.sello, key: 'sello' });
    if (f.genero) chips.push({ label: '🎵 ' + f.genero, key: 'genero' });
    if (f.portada === '__con__') chips.push({ label: '🖼️ Con portada', key: 'portada' });
    if (f.portada === '__sin__') chips.push({ label: '🖼️ Sin portada', key: 'portada' });
    if (f.prestamo === '__prestados__') chips.push({ label: '📤 Prestados', key: 'prestamo' });
    if (f.prestamo === '__disponibles__') chips.push({ label: '✅ Disponibles', key: 'prestamo' });
    if (App.orden !== 'nro') chips.push({ label: '↕️ ' + labelForOrder(App.orden), key: 'orden' });

    if (!chips.length) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }

    el.hidden = false;
    el.innerHTML = '';
    for (const c of chips) {
      const chip = document.createElement('div');
      chip.className = 'filter-chip';
      chip.innerHTML = `<span>${esc(c.label)}</span><button type="button" aria-label="Quitar">✕</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        if (c.key === 'orden') App.orden = 'nro';
        else App.filters[c.key] = '';
        UI.renderAll();
      });
      el.appendChild(chip);
    }

    const badge = $('#filterBadge');
    const cnt = Filter.activeCount();
    if (badge) {
      if (cnt > 0) {
        badge.textContent = cnt;
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
    const fb = $('#btnFiltros');
    if (fb) fb.classList.toggle('active', cnt > 0);
  },

  renderList() {
    const list = $('#cdList');
    if (!list) return;

    /* v7.1.2 — GUARD */
    if (!App.db) {
      list.innerHTML = '';
      return;
    }

    const cds = Filter.apply();
    const info = $('#listInfo');

    if (info) {
      const total = (App.cat && App.cat !== '__all__') ? Store.getCDsByCat(App.cat).length : Store.total();
      if (cds.length === total) {
        info.innerHTML = `<b>${cds.length}</b> CD${cds.length === 1 ? '' : 's'}`;
      } else {
        info.innerHTML = `Mostrando <b>${cds.length}</b> de ${total}`;
      }
      info.hidden = cds.length === 0;
    }

    if (!cds.length) {
      list.innerHTML = '';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const cd of cds) {
      frag.appendChild(this.buildItem(cd));
    }
    list.innerHTML = '';
    list.appendChild(frag);
  },

  buildItem(cd) {
    const li = document.createElement('li');
    li.className = 'cd-item';
    const hasLoan = !!cd.prestadoA;
    const isOverdue = hasLoan && cd.fechaDevolucion && new Date(cd.fechaDevolucion) < new Date();

    if (hasLoan) li.classList.add('loaned');

    const coverHTML = cd.portada
      ? `<img src="${esc(cd.portada)}" alt="" loading="lazy" onerror="this.parentNode.innerHTML='<span class=&quot;placeholder&quot;>💿</span>'">`
      : `<span class="placeholder">💿</span>`;

    const loanDot = hasLoan ? `<span class="loan-dot${isOverdue ? ' overdue' : ''}">${isOverdue ? '!' : '📤'}</span>` : '';
    const hasStreaming = cd.links && Object.keys(cd.links).length > 0;

    li.innerHTML = `
      <div class="cd-cover">${coverHTML}${loanDot}</div>
      <div class="cd-info">
        <div class="cd-title">${esc(cd.titulo || '—')}</div>
        <div class="cd-artist">${esc(cd.interprete || '—')}</div>
        <div class="cd-meta">
          <span class="nro">#${cd.nro ?? '—'}</span>
          ${cd.anio ? `<span class="year">${cd.anio}</span>` : ''}
          ${hasStreaming ? '<span class="badge-streaming">🎧</span>' : ''}
        </div>
      </div>
      <div class="cd-arrow">›</div>
    `;

    li.addEventListener('click', () => Detail.open(cd));
    return li;
  },

  renderEmptyStates() {
    const emptyInitial = $('#emptyInitial');
    const emptySearch = $('#emptySearch');
    if (!emptyInitial || !emptySearch) return;

    if (!App.db) {
      emptyInitial.hidden = false;
      emptySearch.hidden = true;
      return;
    }
    emptyInitial.hidden = true;

    const cds = App.filteredCache;
    const hasActiveFilter = App.q.trim() || Filter.activeCount() > 0;

    if (cds.length === 0 && hasActiveFilter) {
      emptySearch.hidden = false;
      const msg = $('#emptySearchMsg');
      if (msg) {
        if (App.q.trim()) msg.textContent = `No hay CDs que coincidan con "${App.q}".`;
        else msg.textContent = 'No hay CDs que coincidan con los filtros aplicados.';
      }
    } else {
      emptySearch.hidden = true;
    }
  }
};

function labelForOrder(ord) {
  const map = {
    'nro': 'Nº ↑',
    'nro-desc': 'Nº ↓',
    'titulo': 'Título A-Z',
    'titulo-desc': 'Título Z-A',
    'interprete': 'Intérprete A-Z',
    'anio': 'Año ↑',
    'anio-desc': 'Año ↓'
  };
  return map[ord] || ord;
}

/* ═══════════════════════════════════════════════════════════════════
   Filtros Sheet
   ═══════════════════════════════════════════════════════════════════ */
const FilterSheet = {
  open() {
    const sheet = $('#filterSheet');
    const overlay = $('#sheetOverlay');
    if (!sheet || !overlay) return;

    this.populateOptions();

    $('#fArtista').value = App.filters.artista || '';
    $('#fAnioDesde').value = App.filters.anioDesde || '';
    $('#fAnioHasta').value = App.filters.anioHasta || '';
    $('#fSello').value = App.filters.sello || '';
    $('#fGenero').value = App.filters.genero || '';
    $('#fPortada').value = App.filters.portada || '';
    $('#fPrestamo').value = App.filters.prestamo || '';
    $('#fOrden').value = App.orden || 'nro';

    sheet.hidden = false;
    overlay.hidden = false;
    document.body.classList.add('has-modal');
    pushBackIfNeeded();
  },

  close() {
    const sheet = $('#filterSheet');
    const overlay = $('#sheetOverlay');
    if (!sheet || !overlay) return;
    sheet.hidden = true;
    overlay.hidden = true;
    document.body.classList.remove('has-modal');
  },

  populateOptions() {
    if (!App.db) return;

    const artists = new Set();
    const sellos = new Set();
    const generos = new Set();

    const source = (App.cat && App.cat !== '__all__')
      ? Store.getCDsByCat(App.cat)
      : Store.allCDs().map(x => x.cd);

    for (const cd of source) {
      if (cd.interprete) artists.add(cd.interprete);
      if (cd.sello) sellos.add(cd.sello);
      if (cd.genero) generos.add(cd.genero);
    }

    fillSelect('#fArtista', [...artists].sort((a, b) => a.localeCompare(b, 'es')));
    fillSelect('#fSello', [...sellos].sort((a, b) => a.localeCompare(b, 'es')));
    fillSelect('#fGenero', [...generos].sort((a, b) => a.localeCompare(b, 'es')));
  },

  apply() {
    App.filters.artista = $('#fArtista').value;
    /* v7.1.1 — Sanitizar años (solo dígitos) */
    App.filters.anioDesde = ($('#fAnioDesde').value || '').replace(/\D/g, '');
    App.filters.anioHasta = ($('#fAnioHasta').value || '').replace(/\D/g, '');
    App.filters.sello = $('#fSello').value;
    App.filters.genero = $('#fGenero').value;
    App.filters.portada = $('#fPortada').value;
    App.filters.prestamo = $('#fPrestamo').value;
    App.orden = $('#fOrden').value;

    this.close();
    UI.renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  clear() {
    Filter.clear();
    $('#fArtista').value = '';
    $('#fAnioDesde').value = '';
    $('#fAnioHasta').value = '';
    $('#fSello').value = '';
    $('#fGenero').value = '';
    $('#fPortada').value = '';
    $('#fPrestamo').value = '';
    $('#fOrden').value = 'nro';
    UI.renderAll();
  }
};

function fillSelect(sel, values) {
  const el = $(sel);
  if (!el) return;
  const current = el.value;
  el.innerHTML = '<option value="">Todos</option>';
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  }
  el.value = current || '';
}

/* ═══════════════════════════════════════════════════════════════════
   Detalle
   ═══════════════════════════════════════════════════════════════════ */
const Detail = {
  open(cd) {
    App.currentCD = cd;
    const sheet = $('#detailSheet');
    const overlay = $('#detailOverlay');
    if (!sheet || !overlay) return;

    this.render(cd);

    sheet.hidden = false;
    overlay.hidden = false;
    document.body.classList.add('has-detail', 'has-modal');
    pushBackIfNeeded();
  },

  close() {
    const sheet = $('#detailSheet');
    const overlay = $('#detailOverlay');
    if (!sheet || !overlay) return;
    sheet.hidden = true;
    overlay.hidden = true;
    document.body.classList.remove('has-detail', 'has-modal');
    App.currentCD = null;
  },

  render(cd) {
    const body = $('#detailBody');
    const title = $('#detailTitle');
    if (!body || !title) return;

    title.textContent = cd.titulo || 'Detalle';

    const isOverdue = cd.prestadoA && cd.fechaDevolucion && new Date(cd.fechaDevolucion) < new Date();

    const coverHTML = cd.portada
      ? `<img src="${esc(cd.portada)}" alt="" loading="lazy" onerror="this.parentNode.innerHTML='💿'">`
      : '💿';

    const badges = [];
    if (cd.nro) badges.push(`<span class="detail-badge nro">#${cd.nro}</span>`);
    if (cd.anio) badges.push(`<span class="detail-badge year">📅 ${cd.anio}</span>`);
    if (cd.anioEdicion) badges.push(`<span class="detail-badge year-ed">📅 Edición ${cd.anioEdicion}</span>`);
    if (cd.prestadoA) badges.push(`<span class="detail-badge loaned${isOverdue ? ' overdue' : ''}">📤 ${esc(cd.prestadoA)}</span>`);

    const edicionFields = [];
    pushField(edicionFields, 'Formato', cd.formato);
    pushField(edicionFields, 'Sello', cd.sello);
    pushField(edicionFields, 'Género', cd.genero);
    pushField(edicionFields, 'Nº catálogo', cd.catalogo);
    pushField(edicionFields, 'Código de barras', cd.codigo);
    pushField(edicionFields, 'ISRC', cd.isrc, true);
    pushField(edicionFields, 'Edición', cd.edicion);
    pushField(edicionFields, 'País', cd.pais);

    const fisicoFields = [];
    pushField(fisicoFields, 'Estado general', cd.estado);
    pushField(fisicoFields, 'Disco', cd.estadoDisco);
    pushField(fisicoFields, 'Caja', cd.estadoCaja);
    pushField(fisicoFields, 'Folleto', cd.estadoFolleto);
    pushField(fisicoFields, 'Arte', cd.estadoArte);

    const ubicacionFields = [];
    pushField(ubicacionFields, 'Ubicación', cd.ubicacion);
    pushField(ubicacionFields, 'Cantidad', cd.cantidad);
    pushField(ubicacionFields, 'Fecha ingreso', cd.adquisicion);
    if (cd.valor != null) pushField(ubicacionFields, 'Valor', `${cd.moneda || 'ARS'} ${Number(cd.valor).toLocaleString('es-AR')}`);

    const prestamoFields = [];
    if (cd.prestadoA) {
      pushField(prestamoFields, 'Prestado a', cd.prestadoA);
      pushField(prestamoFields, 'Fecha préstamo', cd.fechaPrestamo);
      pushField(prestamoFields, 'Fecha devolución', cd.fechaDevolucion);
      pushField(prestamoFields, 'Notas', cd.notasPrestamo);
    }

    const customFields = [];
    if (cd.customFields && Object.keys(cd.customFields).length) {
      for (const k in cd.customFields) {
        pushField(customFields, k, cd.customFields[k]);
      }
    }

    let html = `
      <div class="detail-hero">
        <div class="detail-cover" ${cd.portada ? `data-lightbox="${esc(cd.portada)}"` : ''}>${coverHTML}</div>
        <div class="detail-hero-info">
          <div class="label">🎵 Título</div>
          <div class="title">${esc(cd.titulo || '—')}</div>
          <div class="label" style="margin-top:6px">🎤 Intérprete</div>
          <div class="artist">${esc(cd.interprete || '—')}</div>
          ${badges.length ? `<div class="detail-hero-badges">${badges.join('')}</div>` : ''}
        </div>
      </div>
    `;

    if (edicionFields.length) html += this.section('📀 Edición', edicionFields);
    if (fisicoFields.length) html += this.section('🔍 Estado físico', fisicoFields);
    if (ubicacionFields.length) html += this.section('📍 Ubicación y valor', ubicacionFields);
    if (prestamoFields.length) html += this.section('📚 Préstamo', prestamoFields);
    if (customFields.length) html += this.section('📝 Personalizados', customFields);

    const streamingHTML = this.renderStreaming(cd);
    if (streamingHTML) html += streamingHTML;

    if (cd.notas) {
      html += `<div class="detail-section">
        <div class="detail-section-title">📝 Observaciones</div>
      </div>
      <div class="detail-notes">${esc(cd.notas)}</div>`;
    }

    body.innerHTML = html;

    const cover = body.querySelector('.detail-cover[data-lightbox]');
    if (cover) {
      cover.addEventListener('click', () => {
        Lightbox.open(cd.portada, `${cd.titulo} — ${cd.interprete}`);
      });
    }
  },

  section(title, fields) {
    if (!fields.length) return '';
    const fieldsHTML = fields.map(f => `
      <div class="detail-field">
        <div class="field-label">${esc(f.label)}</div>
        <div class="field-value${f.plain ? ' plain' : ''}${f.mono ? ' mono' : ''}">${esc(f.value) || '—'}</div>
      </div>
    `).join('');
    return `
      <div class="detail-section">
        <div class="detail-section-title">${title}</div>
        <div class="detail-grid">${fieldsHTML}</div>
      </div>
    `;
  },

  renderStreaming(cd) {
    const links = cd.links || {};
    const services = [
      { key: 'spotify', name: 'Spotify', icon: '🟢', color: '#1db954' },
      { key: 'youtube', name: 'YouTube Music', icon: '🔴', color: '#ff0000' },
      { key: 'apple', name: 'Apple Music', icon: '🍎', color: '#fa243c' },
      { key: 'deezer', name: 'Deezer', icon: '🎵', color: '#a238ff' },
      { key: 'tidal', name: 'Tidal', icon: '🌊', color: '#00d4ff' },
      { key: 'amazon', name: 'Amazon Music', icon: '📦', color: '#ff9900' },
      { key: 'soundcloud', name: 'SoundCloud', icon: '☁️', color: '#ff5500' },
      { key: 'discogs', name: 'Discogs', icon: '💿', color: '#555555' }
    ];

    const available = services.filter(s => links[s.key] && isValidUrl(links[s.key]));
    if (!available.length) return '';

    const btns = available.map(s => `
      <a class="stream-btn" href="${esc(links[s.key])}" target="_blank" rel="noopener noreferrer" style="--svc-color:${s.color}">
        <span class="si">${s.icon}</span>
        <span class="sn">${esc(s.name)}</span>
        <span class="sx">↗</span>
      </a>
    `).join('');

    return `
      <div class="detail-streaming">
        <div class="stream-section-title">🎧 Escuchar en</div>
        <div class="stream-grid">${btns}</div>
      </div>
    `;
  }
};

function pushField(arr, label, value, mono = false) {
  const v = String(value ?? '').trim();
  if (!v) return;
  arr.push({ label, value: v, mono });
}

function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /^https:\/\//i.test(url);
}

/* ═══════════════════════════════════════════════════════════════════
   Lightbox
   ═══════════════════════════════════════════════════════════════════ */
const Lightbox = {
  open(url, caption) {
    if (!url) return;
    const lb = $('#lightbox');
    const img = $('#lbImg');
    const info = $('#lbInfo');
    if (!lb || !img) return;

    img.onerror = () => {
      Toast.show('⚠️ No se pudo cargar la portada', 'warn', 3000);
      this.close();
    };
    img.onload = () => { img.onerror = null; };

    img.src = url;
    if (info) info.textContent = caption || '';
    lb.hidden = false;
    pushBackIfNeeded();
  },
  close() {
    const lb = $('#lightbox');
    if (!lb) return;
    lb.hidden = true;
    const img = $('#lbImg');
    if (img) img.src = '';
  }
};

/* ═══════════════════════════════════════════════════════════════════
   Import
   ═══════════════════════════════════════════════════════════════════ */
const Import = {
  openModal() {
    const m = $('#importModal');
    if (!m) return;
    m.hidden = false;
    document.body.classList.add('has-modal');
    const area = $('#importPasteArea');
    if (area) area.value = '';
    pushBackIfNeeded();
  },

  closeModal() {
    const m = $('#importModal');
    if (!m) return;
    m.hidden = true;
    document.body.classList.remove('has-modal');
  },

  async handleFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      this.processText(text);
    } catch (e) {
      Toast.show('❌ No se pudo leer el archivo', 'err', 4000);
    }
  },

  processText(text) {
    const clean = String(text || '').trim().replace(/^\uFEFF/, '');
    if (!clean) {
      Toast.show('⚠️ El contenido está vacío', 'warn', 3000);
      return;
    }
    let data;
    try {
      data = JSON.parse(clean);
    } catch (e) {
      Toast.show('❌ JSON inválido: ' + e.message, 'err', 5000);
      return;
    }

    try {
      Store.buildFromRaw(data);
      this.closeModal();
      Filter.clear();
      UI.renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      Toast.show(`✅ Importado: ${Store.total()} CDs · ${Store.totalArtists()} intérpretes`, 'ok', 4000);
    } catch (e) {
      Toast.show('❌ ' + e.message, 'err', 5000);
    }
  },

  clearData() {
    if (!App.db) {
      Toast.show('No hay datos cargados', 'info', 2500);
      return;
    }
    if (!confirm('¿Borrar la colección guardada del celular?\n\nPodrás volver a importarla después.')) return;
    Store.clear();
    UI.renderAll();
    Toast.show('🗑️ Datos eliminados', 'warn', 3000);
  }
};

/* ═══════════════════════════════════════════════════════════════════
   Más opciones
   ═══════════════════════════════════════════════════════════════════ */
const MoreSheet = {
  open() {
    const sheet = $('#moreSheet');
    const overlay = $('#moreOverlay');
    if (!sheet || !overlay) return;
    sheet.hidden = false;
    overlay.hidden = false;
    document.body.classList.add('has-modal');

    const sv = $('#sheetVersion');
    if (sv) sv.textContent = `Discografía Mobile v${APP_VERSION}`;

    pushBackIfNeeded();
  },
  close() {
    const sheet = $('#moreSheet');
    const overlay = $('#moreOverlay');
    if (!sheet || !overlay) return;
    sheet.hidden = true;
    overlay.hidden = true;
    document.body.classList.remove('has-modal');
  }
};

/* ═══════════════════════════════════════════════════════════════════
   Stats Modal
   ═══════════════════════════════════════════════════════════════════ */
const StatsModal = {
  open() {
    if (!App.db) {
      Toast.show('No hay datos cargados', 'info', 2500);
      return;
    }
    this.render();
    const m = $('#statsModal');
    if (m) m.hidden = false;
    document.body.classList.add('has-modal');
    pushBackIfNeeded();
  },
  close() {
    const m = $('#statsModal');
    if (m) m.hidden = true;
    document.body.classList.remove('has-modal');
  },
  render() {
    const body = $('#statsBody');
    if (!body) return;

    const all = Store.allCDs();
    const totalCDs = all.length;
    const artists = new Set();
    const sellos = new Map();
    const anios = new Map();
    let conPortada = 0;
    let conValor = 0;
    let valorTotal = 0;
    let prestados = 0;
    let conStreaming = 0;

    for (const { cd } of all) {
      if (cd.interprete) artists.add(cd.interprete);
      if (cd.sello) sellos.set(cd.sello, (sellos.get(cd.sello) || 0) + 1);
      if (cd.anio) anios.set(cd.anio, (anios.get(cd.anio) || 0) + 1);
      if (cd.portada) conPortada++;
      if (cd.valor != null && Number.isFinite(Number(cd.valor))) {
        valorTotal += Number(cd.valor) * Math.max(1, parseInt(cd.cantidad) || 1);
        conValor++;
      }
      if (cd.prestadoA) prestados++;
      if (cd.links && Object.keys(cd.links).length) conStreaming++;
    }

    const topArtists = [...artists].map(a => {
      const count = all.filter(x => x.cd.interprete === a).length;
      return [a, count];
    }).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const topSellos = [...sellos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

    const años = [...anios.keys()].sort();
    const rangoAnios = años.length ? `${años[0]}–${años[años.length - 1]}` : '—';

    const card = (icon, label, value, cls = '') =>
      `<div class="stats-card ${cls}"><div class="sc-label">${icon} ${esc(label)}</div><div class="sc-value">${esc(value)}</div></div>`;

    const listCard = (title, items) => {
      if (!items.length) return '';
      return `<div class="stats-section-title">${title}</div><ul class="stats-list">${items.map(([name, count], i) =>
        `<li><span class="rank">${i + 1}</span><span class="name">${esc(name)}</span><span class="count">${count}</span></li>`
      ).join('')}</ul>`;
    };

    const cats = Object.keys(App.db.categories || {}).length;

    body.innerHTML = `
      <div class="stats-grid">
        ${card('💿', 'Total CDs', totalCDs, 'highlight')}
        ${card('🎤', 'Intérpretes', artists.size, 'purple')}
        ${card('📁', 'Categorías', cats)}
        ${card('📅', 'Años', rangoAnios, 'yellow')}
        ${card('🖼️', 'Con portada', `${conPortada} / ${totalCDs}`)}
        ${card('📤', 'Prestados', prestados)}
        ${conValor > 0 ? card('💰', 'Valor total', `$${valorTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`) : ''}
        ${card('🎧', 'Con streaming', conStreaming)}
      </div>
      ${listCard('🏆 Top intérpretes', topArtists)}
      ${listCard('🏷️ Top sellos', topSellos)}
    `;
  }
};

/* ═══════════════════════════════════════════════════════════════════
   Legal
   ═══════════════════════════════════════════════════════════════════ */
const Legal = {
  open() {
    const m = $('#legalModal');
    if (!m) return;
    m.hidden = false;
    document.body.classList.add('has-modal');
    pushBackIfNeeded();
  },
  close() {
    const m = $('#legalModal');
    if (!m) return;
    m.hidden = true;
    document.body.classList.remove('has-modal');
    try { localStorage.setItem(LEGAL_KEY, '1'); } catch (e) {}
  },
  maybeShowOnFirstRun() {
    try {
      if (localStorage.getItem(LEGAL_KEY) === '1') return;
    } catch (e) {}
    setTimeout(() => this.open(), 800);
  }
};

/* ═══════════════════════════════════════════════════════════════════
   Drag & Drop
   ═══════════════════════════════════════════════════════════════════ */
function bindDragAndDrop() {
  const dz = $('#importDropzone');
  if (!dz) return;
  ['dragover', 'dragenter'].forEach(ev => {
    dz.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dz.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove('dragover');
    });
  });
  dz.addEventListener('drop', e => {
    const files = e.dataTransfer?.files;
    if (files && files[0]) Import.handleFile(files[0]);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Eventos
   ═══════════════════════════════════════════════════════════════════ */
function bindEvents() {
  const q = $('#q');
  if (q) {
    q.addEventListener('input', debounce(() => {
      App.q = q.value;
      const wrap = q.closest('.search-input-wrap');
      if (wrap) wrap.classList.toggle('has-value', q.value.length > 0);
      UI.renderList();
      UI.renderEmptyStates();
    }, 160));
  }
  const clearQ = $('#clearQ');
  if (clearQ) {
    clearQ.addEventListener('click', () => {
      if (q) q.value = '';
      App.q = '';
      const wrap = q?.closest('.search-input-wrap');
      if (wrap) wrap.classList.remove('has-value');
      UI.renderList();
      UI.renderEmptyStates();
      q?.focus();
    });
  }

  $('#btnFiltros')?.addEventListener('click', () => FilterSheet.open());
  $('#sheetClose')?.addEventListener('click', () => FilterSheet.close());
  $('#sheetOverlay')?.addEventListener('click', () => FilterSheet.close());
  $('#btnApplyFilters')?.addEventListener('click', () => FilterSheet.apply());
  $('#btnClearFilters')?.addEventListener('click', () => FilterSheet.clear());

  $('#btnMore')?.addEventListener('click', () => MoreSheet.open());
  $('#moreClose')?.addEventListener('click', () => MoreSheet.close());
  $('#moreOverlay')?.addEventListener('click', () => MoreSheet.close());

  $('#moreImport')?.addEventListener('click', () => {
    MoreSheet.close();
    setTimeout(() => Import.openModal(), 200);
  });

  /* v7.1.1 — Foco automático al pegar */
  $('#morePaste')?.addEventListener('click', () => {
    MoreSheet.close();
    setTimeout(() => {
      Import.openModal();
      setTimeout(() => {
        const ta = $('#importPasteArea');
        if (ta) {
          ta.focus();
          ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
    }, 200);
  });

  $('#moreStats')?.addEventListener('click', () => {
    MoreSheet.close();
    setTimeout(() => StatsModal.open(), 200);
  });
  $('#moreLegal')?.addEventListener('click', () => {
    MoreSheet.close();
    setTimeout(() => Legal.open(), 200);
  });
  $('#moreClear')?.addEventListener('click', () => {
    MoreSheet.close();
    setTimeout(() => Import.clearData(), 200);
  });

  $('#btnImport')?.addEventListener('click', () => Import.openModal());
  $('#btnImportEmpty')?.addEventListener('click', () => Import.openModal());
  $('#btnPasteEmpty')?.addEventListener('click', () => Import.openModal());
  $('#importClose')?.addEventListener('click', () => Import.closeModal());
  $('#importCancel')?.addEventListener('click', () => Import.closeModal());
  $('#importModal')?.addEventListener('click', e => {
    if (e.target.id === 'importModal') Import.closeModal();
  });
  $('#importSelectFile')?.addEventListener('click', () => $('#importFileInput')?.click());
  $('#importFileInput')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) Import.handleFile(f);
    e.target.value = '';
  });
  $('#importConfirmPaste')?.addEventListener('click', () => {
    const t = $('#importPasteArea')?.value || '';
    if (!t.trim()) {
      Toast.show('⚠️ Pegá el contenido primero', 'warn', 3000);
      return;
    }
    Import.processText(t);
  });

  $('#btnClearSearch')?.addEventListener('click', () => {
    if (q) q.value = '';
    App.q = '';
    const wrap = q?.closest('.search-input-wrap');
    if (wrap) wrap.classList.remove('has-value');
    Filter.clear();
    UI.renderAll();
  });

  $('#detailBack')?.addEventListener('click', () => Detail.close());
  $('#detailOverlay')?.addEventListener('click', () => Detail.close());

  $('#lbClose')?.addEventListener('click', () => Lightbox.close());
  $('#lightbox')?.addEventListener('click', e => {
    if (e.target.id === 'lightbox') Lightbox.close();
  });

  $('#btnTheme')?.addEventListener('click', () => Prefs.toggleTheme());

  $('#legalClose')?.addEventListener('click', () => Legal.close());
  $('#legalAccept')?.addEventListener('click', () => Legal.close());
  $('#legalModal')?.addEventListener('click', e => {
    if (e.target.id === 'legalModal') Legal.close();
  });

  $('#statsClose')?.addEventListener('click', () => StatsModal.close());
  $('#statsAccept')?.addEventListener('click', () => StatsModal.close());
  $('#statsModal')?.addEventListener('click', e => {
    if (e.target.id === 'statsModal') StatsModal.close();
  });

  bindDragAndDrop();

  window.addEventListener('popstate', handleBackButton);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (isVisible('#lightbox')) { Lightbox.close(); return; }
      if (isVisible('#detailSheet')) { Detail.close(); return; }
      if (isVisible('#importModal')) { Import.closeModal(); return; }
      if (isVisible('#legalModal')) { Legal.close(); return; }
      if (isVisible('#statsModal')) { StatsModal.close(); return; }
      if (isVisible('#filterSheet')) { FilterSheet.close(); return; }
      if (isVisible('#moreSheet')) { MoreSheet.close(); return; }
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Back button Android
   ═══════════════════════════════════════════════════════════════════ */
function handleBackButton() {
  if (isVisible('#lightbox')) { Lightbox.close(); return; }
  if (isVisible('#detailSheet')) { Detail.close(); return; }
  if (isVisible('#importModal')) { Import.closeModal(); return; }
  if (isVisible('#legalModal')) { Legal.close(); return; }
  if (isVisible('#statsModal')) { StatsModal.close(); return; }
  if (isVisible('#filterSheet')) { FilterSheet.close(); return; }
  if (isVisible('#moreSheet')) { MoreSheet.close(); return; }
  /* Si no hay nada abierto → comportamiento default (salir de la app) */
}

function pushBackIfNeeded() {
  try {
    if (window.history && window.history.pushState) {
      history.pushState({ app: 'discografia', ts: Date.now() }, '', location.href);
    }
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════════════ */
function init() {
  Prefs.load();
  bindEvents();
  const loaded = Store.loadFromStorage();
  UI.renderAll();

  if (!loaded) {
    Toast.show('📥 Importá tu colección para comenzar', 'info', 4000);
  } else {
    Toast.show(`✅ ${Store.total()} CDs cargados`, 'ok', 2500);
  }

  Legal.maybeShowOnFirstRun();

  console.log(`%c💿 Discografía Mobile v${APP_VERSION}`, 'color:#4fc3f7;font-weight:bold;font-size:14px');
  console.log(`   ${Store.total()} CDs · ${Store.totalArtists()} intérpretes · ${loaded ? 'cargados' : 'sin datos'}`);
}

document.addEventListener('DOMContentLoaded', init);