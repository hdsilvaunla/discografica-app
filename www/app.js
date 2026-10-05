/* ═══════════════════════════════════════════════════════════════
   DISCOGRAFÍA VIEWER v7.1.5 · VISOR DE CONSULTA (MÓVIL)
   Basado en v7.0.9 + mejoras de la serie v7.1.x

   NUEVO en v7.1.5:
     - init() con fallback de readyState + try/catch (arranque garantizado)
     - isVisible() helper robusto
     - Listener backbutton de Capacitor (back Android)
     - Guards defensivos en Store
     - Sin pushState / popstate (sin warnings en file://)
     - Logs limpios con console.log
     - Aviso legal completo con firma SHA-256 + fallback FNV-1a
     - Guard suave de reapertura del aviso legal

   Autor: HDSystem IT · Tel: +54 9 11 4563-0851
   ═══════════════════════════════════════════════════════════════ */

const VERSION = '7.1.5';
const DATA_SCHEMA_VERSION = 2;
const BACKUP_FORMAT_VERSION = 1;
const STORE_KEY = 'discografia_viewer_v4';
const STORE_KEY_LEGACY = ['discografia_viewer_v3','discografia_viewer_v2','discografia_viewer_v1'];
const THEME_KEY = 'discografia_viewer_theme';
const SYNC_WEBAPP_KEY = 'discografia_sync_webapp_v1';
const SYNC_INFO_KEY = 'discografia_sync_info';
const SYNC_AUTO_KEY = 'discografia_sync_auto';
const RECENT_KEY = 'discografia_viewer_recent';
const PREFS_KEY = 'discografia_viewer_prefs';
const CUSTOMFIELDS_KEY = 'discografia_viewer_customfields';
const LEGAL_NOTICE_KEY = 'discografia_legal_accepted_v1';
const LEGAL_SIGNATURE_KEY = 'discografia_legal_signature_v1';
const RESOLVED_LINKS_KEY = 'discografia_viewer_resolved_links_v1';
const ALL_CATS = '__all__';
const SYNC_STALE_HOURS = 6;
const SYNC_FOREGROUND_MIN = 60;
const SYNC_ON_BOOT_MIN = 60;
const LS_LIMIT_BYTES = 5 * 1024 * 1024;

const STREAMING_SERVICES = [
  { key:'spotify',    name:'Spotify',       icon:'🟢', color:'#1db954' },
  { key:'youtube',    name:'YouTube Music', icon:'🔴', color:'#ff0000' },
  { key:'apple',      name:'Apple Music',   icon:'🍎', color:'#fa243c' },
  { key:'deezer',     name:'Deezer',        icon:'🎵', color:'#a238ff' },
  { key:'tidal',      name:'Tidal',         icon:'🌊', color:'#00d4ff' },
  { key:'amazon',     name:'Amazon Music',  icon:'📦', color:'#ff9900' },
  { key:'soundcloud', name:'SoundCloud',    icon:'☁️', color:'#ff5500' },
  { key:'discogs',    name:'Discogs',       icon:'💿', color:'#777777' }
];

const ALLOWED_STREAM_DOMAINS = [
  'open.spotify.com','spotify.com',
  'music.youtube.com','youtube.com','youtu.be',
  'music.apple.com','itunes.apple.com',
  'deezer.com',
  'tidal.com','listen.tidal.com',
  'music.amazon.com','amazon.com',
  'soundcloud.com',
  'discogs.com'
];

function isSafeStreamUrl(url){
  if (!url || typeof url !== 'string') return false;
  if (!/^https:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return ALLOWED_STREAM_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch(e){ return false; }
}

function isAlbumUrl(url, svcKey){
  if (!url) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase() + u.search.toLowerCase();
    switch(svcKey){
      case 'spotify':    return path.includes('/album/') && !path.includes('/track/') && !path.includes('/playlist/');
      case 'apple':      return path.includes('/album/');
      case 'deezer':     return path.includes('/album/') && !path.includes('/track/');
      case 'tidal':      return path.includes('/album/') && !path.includes('/track/');
      case 'youtube':    return path.includes('olak5uy') || path.includes('/browse/') || path.includes('/playlist');
      case 'amazon':     return path.includes('/albums/') && !path.includes('/tracks/');
      case 'soundcloud': return path.includes('/sets/');
      default: return true;
    }
  } catch(e){ return false; }
}

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s ?? '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,' ').trim();
const upper = v => (v === null || v === undefined) ? '' : String(v).toUpperCase();
const debounce = (fn, ms=180) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* Helper robusto de visibilidad (v7.1.5) */
function isVisible(sel){
  const el = $(sel);
  return !!(el && !el.hidden && el.offsetParent !== null);
}
function isOpen(cls){
  const el = $(cls);
  return !!(el && el.classList.contains('on'));
}

const fmtRel = ts => {
  if (!ts) return 'nunca';
  const d = Date.now() - ts;
  const m = Math.floor(d/60000), h = Math.floor(d/3600000), dy = Math.floor(d/86400000);
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  if (h < 24) return `hace ${h} h`;
  if (dy < 30) return `hace ${dy} día${dy === 1 ? '' : 's'}`;
  const mo = Math.floor(dy/30);
  if (mo < 12) return `hace ${mo} mes${mo === 1 ? '' : 'es'}`;
  return `hace ${Math.floor(mo/12)} año(s)`;
};
const fmtBytes = b => { if (!b) return '0 B'; if (b < 1024) return b+' B'; if (b < 1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(2)+' MB'; };

function parseTimestampFromFilename(name){
  const s = String(name || '');
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[_\-\s](\d{2})(\d{2})/);
  if (m){
    const [, y, mo, d, h, mi] = m;
    const dt = new Date(parseInt(y), parseInt(mo) - 1, parseInt(d), parseInt(h), parseInt(mi));
    if (!isNaN(dt.getTime())) return dt.getTime();
  }
  const m2 = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m2){
    const [, y, mo, d] = m2;
    const dt = new Date(parseInt(y), parseInt(mo) - 1, parseInt(d));
    if (!isNaN(dt.getTime())) return dt.getTime();
  }
  return null;
}

function limpiarTituloParaBusqueda(titulo){
  let t = String(titulo || '').trim();
  if (!t) return '';
  t = t.replace(/[*#]+/g, ' ');
  t = t.replace(/\.{2,}/g, ' ');
  const parts = t.split(/\s*\/\s*/);
  if (parts.length === 2 && norm(parts[0]) === norm(parts[1])) t = parts[0];
  t = t.replace(/\s*[\(\[]\s*(en\s+vivo|live|live\s+at|unplugged|remaster(?:ed)?(?:\s+\d{4})?|deluxe(?:\s+edition)?|expanded(?:\s+edition)?|anniversary(?:\s+edition)?|bonus(?:\s+tracks?)?|special\s+edition|limited\s+edition|edici[oó]n\s+\w+)\s*[\)\]]\s*$/i, '').trim();
  t = t.replace(/\s*[-–—:]\s*(remaster(?:ed)?(?:\s+\d{4})?|deluxe(?:\s+edition)?|en\s+vivo|live)\s*$/i, '').trim();
  t = t.replace(/\s*\(\s*(en\s+vivo|live)\s*\)\s*$/i, '').trim();
  t = t.replace(/\s+(CD|VOL|VOLUMEN|PARTE|DISC|DISCO)\s*#?\s*\d+\s*$/i, '').trim();
  t = t.replace(/\s+GIRA\s+/i, ' ').trim();
  t = t.replace(/\s+([AB])\s*$/i, (m) => {
    const sinLado = t.replace(/\s+([AB])\s*$/i, '').trim();
    return sinLado.length >= 5 ? '' : m;
  }).trim();
  return t.replace(/\s+/g, ' ').trim();
}

const TYPOS_INTERPRETES = {
  'soda estereo':'Soda Stereo','soda estéreo':'Soda Stereo',
  'the beatle':'The Beatles','beatle':'The Beatles',
  'rolling stone':'The Rolling Stones','led zeppelin':'Led Zeppelin',
  'pink floid':'Pink Floyd','ac dc':'AC/DC','acdc':'AC/DC',
  'guns and roses':"Guns N' Roses",'gun n roses':"Guns N' Roses",
  'black sabath':'Black Sabbath','charly garcia':'Charly García',
  'charly garcía':'Charly García','luis alberto spinetta':'Luis Alberto Spinetta',
  'spinetta jade':'Spinetta Jade','seru giran':'Serú Girán',
  'seru girá':'Serú Girán','fito paez':'Fito Páez','fito páez':'Fito Páez',
  'enanos verdes':'Enanitos Verdes','los enanitos verdes':'Enanitos Verdes',
  'los fabulosos cadillacs':'Los Fabulosos Cadillacs',
  'patricio rey':'Patricio Rey y sus Redonditos de Ricota',
  'redonditos de ricota':'Patricio Rey y sus Redonditos de Ricota'
};
function limpiarInterpreteParaBusqueda(interprete){
  let i = String(interprete || '').trim();
  if (!i) return '';
  i = i.replace(/[*#]+/g, ' ').replace(/\s+/g, ' ').trim();
  const key = norm(i);
  if (TYPOS_INTERPRETES[key]) i = TYPOS_INTERPRETES[key];
  return i;
}

const Storage = (() => {
  const CURRENT_KEYS = new Set([
    STORE_KEY, THEME_KEY, SYNC_WEBAPP_KEY,
    SYNC_INFO_KEY, SYNC_AUTO_KEY, RECENT_KEY, PREFS_KEY,
    CUSTOMFIELDS_KEY, RESOLVED_LINKS_KEY, LEGAL_NOTICE_KEY, LEGAL_SIGNATURE_KEY
  ]);
  const LEGACY_EXACT = [
    'discografia_viewer_v1','discografia_viewer_v2','discografia_viewer_v3',
    'discografia_db_v3','discografia_notfound_v1','discografia_metacache_v1',
    'discografia_history_v1','discografia_custom_fields_v1','discografia_owner_v1',
    'discografia_discogs_config_v1','discografia_seeded_backup',
    'discografia_sync_folder','discografia_sync_apikey'
  ];
  const LEGACY_PREFIXES = [
    'discografia_db_v3_BACKUP_','discografia_cache_','discografia_metacache_',
    'discografia_viewer_backup_','discografia_backup_'
  ];
  function listKeys(){ const keys = []; try { for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch(e){} return keys; }
  function estimateSize(){ let total = 0; try { for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i) || ''; const v = localStorage.getItem(k) || ''; total += (k.length + v.length) * 2; } } catch(e){} return total; }
  function isLegacy(k){ if (CURRENT_KEYS.has(k)) return false; if (LEGACY_EXACT.includes(k)) return true; for (const p of LEGACY_PREFIXES) if (k.startsWith(p)) return true; return false; }
  function cleanupKeys(){
    const before = estimateSize(); const removed = [];
    const keys = listKeys();
    for (const k of keys){ if (isLegacy(k)){ try { localStorage.removeItem(k); removed.push(k); } catch(e){} } }
    const after = estimateSize();
    return { removed, freed: before - after, before, after };
  }
  async function fullCleanup(){
    const k = cleanupKeys();
    let swCount = 0;
    if ('caches' in window){
      try { const names = await caches.keys(); await Promise.all(names.map(n => caches.delete(n).catch(() => false))); swCount = names.length; } catch(e){}
    }
    try { localStorage.setItem('discografia_last_cleanup', String(Date.now())); } catch(e){}
    return { ...k, swCount };
  }
  function usage(){ const used = estimateSize(); const pct = Math.min(100, Math.round(used / LS_LIMIT_BYTES * 100)); return { used, pct, limit: LS_LIMIT_BYTES }; }
  function lastCleanup(){ try { return parseInt(localStorage.getItem('discografia_last_cleanup') || '0', 10) || 0; } catch(e){ return 0; } }
  return { cleanupKeys, fullCleanup, estimateSize, usage, listKeys, lastCleanup };
})();

const App = {
  db: null, cat: ALL_CATS, q: '', artista: null,
  filters: { estado:'', formato:'', anioD:'', anioH:'', ubic:'', port:'', pres:'', rating:'', fav:false, stream:'' },
  tab: 'list', detailCD: null, order: 'nro', artistsOrder: 'count'
};
let _artistList = [];
let _customFieldLabels = {};

const Prefs = {
  get(){
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; }
    catch(e){ return {}; }
  },
  set(patch){
    try {
      const cur = Prefs.get();
      Object.assign(cur, patch || {});
      localStorage.setItem(PREFS_KEY, JSON.stringify(cur));
    } catch(e){}
  }
};

const CustomFields = {
  load(){
    try {
      const raw = localStorage.getItem(CUSTOMFIELDS_KEY);
      _customFieldLabels = raw ? (JSON.parse(raw) || {}) : {};
    } catch(e){ _customFieldLabels = {}; }
  },
  label(key){
    if (!key) return '';
    return _customFieldLabels[key] || key;
  },
  mergeFromImport(arr){
    if (!Array.isArray(arr)) return;
    let changed = false;
    for (const f of arr){
      if (!f) continue;
      const k = f.key || f.id || f.name;
      if (!k) continue;
      const lab = f.label || f.title || f.name || k;
      if (_customFieldLabels[k] !== lab){
        _customFieldLabels[k] = lab;
        changed = true;
      }
    }
    if (changed){
      try { localStorage.setItem(CUSTOMFIELDS_KEY, JSON.stringify(_customFieldLabels)); } catch(e){}
    }
  }
};

const Sync = (() => {
  function getWebAppUrl(){
    try { return (localStorage.getItem(SYNC_WEBAPP_KEY) || '').trim(); }
    catch(e){ return ''; }
  }
  function setWebAppUrl(url){
    try { localStorage.setItem(SYNC_WEBAPP_KEY, String(url || '').trim()); } catch(e){}
  }
  function isConfigured(){
    return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\/?$/i.test(getWebAppUrl());
  }
  function isAuto(){
    try {
      const v = localStorage.getItem(SYNC_AUTO_KEY);
      if (v === null || v === undefined || v === '') return true;
      return v === '1' || v === 'true';
    } catch(e){ return true; }
  }
  function setAuto(on){
    try { localStorage.setItem(SYNC_AUTO_KEY, on ? '1' : '0'); } catch(e){}
  }
  function getInfo(){
    try { return JSON.parse(localStorage.getItem(SYNC_INFO_KEY) || '{}') || {}; }
    catch(e){ return {}; }
  }
  function setInfo(info){
    try { localStorage.setItem(SYNC_INFO_KEY, JSON.stringify(info || {})); } catch(e){}
  }

  function annotate(file){
    const f = Object.assign({}, file || {});
    const modRaw = f.modifiedTime || f.modified || f.modifiedDate || 0;
    let modTs = 0;
    if (typeof modRaw === 'number') modTs = modRaw;
    else if (modRaw){ const d = new Date(modRaw); if (!isNaN(d)) modTs = d.getTime(); }
    const nameTs = (typeof parseTimestampFromFilename === 'function')
      ? (parseTimestampFromFilename(f.name) || 0)
      : 0;
    f._modTs = modTs;
    f._nameTs = nameTs;
    f._effTs = nameTs || modTs || 0;
    return f;
  }

  function sortByNewest(files){
    return files.slice().sort((a, b) => {
      const A = a._nameTs || a._effTs || a._modTs || 0;
      const B = b._nameTs || b._effTs || b._modTs || 0;
      if (B !== A) return B - A;
      return String(b.name || '').localeCompare(String(a.name || ''));
    });
  }

  async function api(action, params){
    const base = getWebAppUrl();
    if (!base) throw new Error('URL de Apps Script no configurada');
    const qs = new URLSearchParams();
    qs.set('action', action);
    if (params){
      for (const k of Object.keys(params)){
        if (params[k] != null && params[k] !== '') qs.set(k, params[k]);
      }
    }
    qs.set('_cb', String(Date.now()));
    const url = base + (base.includes('?') ? '&' : '?') + qs.toString();
    const r = await fetch(url, { method: 'GET', cache: 'no-store', redirect: 'follow', credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' al llamar Apps Script');
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json') || ct.includes('text/plain') || ct.includes('javascript')){
      return await r.json();
    }
    const text = await r.text();
    try { return JSON.parse(text); }
    catch(e){ throw new Error('Respuesta no JSON del Web App'); }
  }

  async function listBackups(){
    const data = await api('list');
    if (data && data.error) throw new Error(String(data.error));
    const raw = Array.isArray(data?.files) ? data.files
              : Array.isArray(data) ? data
              : [];
    const files = sortByNewest(raw.map(annotate).filter(f => f && f.id && f.name));
    return files;
  }

  async function download(id){
    if (!id) throw new Error('ID de archivo vacío');
    let data;
    try {
      data = await api('get', { id: String(id) });
    } catch(e1){
      try { data = await api('download', { id: String(id) }); }
      catch(e2){ throw e1; }
    }
    if (data && data.error) throw new Error(String(data.error));
    if (data && (data.categories || Array.isArray(data.cds) || Array.isArray(data))) return data;
    if (data && data.data && typeof data.data === 'object') return data.data;
    if (data && data.content != null){
      if (typeof data.content === 'string'){
        try { return JSON.parse(data.content); }
        catch(e){ throw new Error('content JSON inválido'); }
      }
      return data.content;
    }
    if (data && data.file && typeof data.file === 'object') return data.file;
    throw new Error('El archivo descargado no tiene formato de colección reconocible');
  }

  async function pullLatest(){
    const files = await listBackups();
    if (!files.length) throw new Error('No hay archivos .json en la carpeta de Drive');
    const file = files[0];
    const data = await download(file.id);
    return { data, file, total: files.length };
  }

  async function testConnection(){
    const files = await listBackups();
    return { count: files.length, files };
  }

  return {
    getWebAppUrl, setWebAppUrl, isConfigured,
    isAuto, setAuto, getInfo, setInfo,
    listBackups, download, pullLatest, testConnection
  };
})();

const Toast = (() => {
  const icons = { ok:'✓', err:'✕', warn:'⚠', info:'ℹ' };
  return {
    show(msg, type='ok', ms=2800){
      const host = $('#toast');
      if (!host) return;
      const el = document.createElement('div');
      el.className = 'tst ' + type;
      el.innerHTML = `<div class="ti">${icons[type]||'ℹ'}</div><div style="flex:1;min-width:0">${esc(msg)}</div>`;
      host.appendChild(el);
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, ms);
    }
  };
})();

const Theme = {
  load(){ try { return localStorage.getItem(THEME_KEY) || (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch(e){ return 'dark'; } },
  apply(t){
    document.body.classList.toggle('light', t === 'light');
    const btn = $('#btnTheme');
    if (btn) btn.textContent = t === 'light' ? '☀️' : '🌙';
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f5f7fa' : '#0e1116');
  },
  toggle(){
    const cur = document.body.classList.contains('light') ? 'light' : 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch(e){}
    this.apply(next);
    Toast.show(next === 'light' ? '☀️ Tema claro' : '🌙 Tema oscuro', 'info', 1500);
  },
  init(){ this.apply(this.load()); }
};

const Recent = {
  list(){ try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') || []; } catch(e){ return []; } },
  add(q){
    const t = String(q||'').trim();
    if (!t || t.length < 2) return;
    const cur = this.list().filter(x => norm(x) !== norm(t));
    cur.unshift(t);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, 8))); } catch(e){}
  },
  clear(){ try { localStorage.removeItem(RECENT_KEY); } catch(e){} }
};

const Store = (() => {
  function buildEmpty(){
    return { schemaVersion: DATA_SCHEMA_VERSION, viewer: true, categories: {} };
  }
  function cloneJSON(value){
    try { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    catch(e){ return value; }
  }
  function hydrate(cd){
    const src = (cd && typeof cd === 'object' && !Array.isArray(cd)) ? cd : {};
    const out = cloneJSON(src) || {};
    if (!out.id) out.id = 'cd_' + Math.random().toString(36).slice(2,10);
    if (out.nro == null) out.nro = 0;
    if (out.formato == null) out.formato = 'CD';
    if (out.estado == null) out.estado = 'Excelente';
    if (out.cantidad == null) out.cantidad = 1;
    if (out.moneda == null) out.moneda = 'ARS';
    if (out.rating == null || typeof out.rating !== 'number' || out.rating < 0 || out.rating > 5) out.rating = 0;
    out.favorito = !!out.favorito;
    if (!Array.isArray(out.tags)) out.tags = [];
    if (!out.links || typeof out.links !== 'object' || Array.isArray(out.links)) out.links = {};

    const incomingImages = (out.imagenes && typeof out.imagenes === 'object' && !Array.isArray(out.imagenes)) ? out.imagenes : {};
    const frontal = incomingImages.frontal || out.portada || null;
    const trasera = incomingImages.trasera || null;
    const interior = incomingImages.interior || null;
    const disco = incomingImages.disco || null;
    const libreto = incomingImages.libreto || null;
    if (frontal || trasera || interior || disco || libreto){
      out.imagenes = { ...incomingImages, frontal, trasera, interior, disco, libreto };
    } else if (out.imagenes == null){
      out.imagenes = null;
    }
    if (!out.portada && out.imagenes?.frontal) out.portada = out.imagenes.frontal;
    if (out.portada && out.imagenes && !out.imagenes.frontal) out.imagenes.frontal = out.portada;

    if (out.customFields == null || typeof out.customFields !== 'object' || Array.isArray(out.customFields)) out.customFields = {};
    return out;
  }
  function normalizeCategory(k, c){
    const src = (c && typeof c === 'object' && !Array.isArray(c)) ? c : {};
    const out = cloneJSON(src) || {};
    out.label = src.label != null && String(src.label).trim() ? String(src.label) : k;
    out.icon = src.icon != null && String(src.icon).trim() ? String(src.icon) : '📀';
    out.cds = Array.isArray(src.cds) ? src.cds.map(hydrate) : [];
    return out;
  }
  function load(){
    let migrated = false;
    try {
      let raw = localStorage.getItem(STORE_KEY);
      if (!raw){
        for (const k of STORE_KEY_LEGACY){
          raw = localStorage.getItem(k);
          if (raw){ migrated = true; break; }
        }
      }
      if (raw){
        const p = JSON.parse(raw);
        if (p && p.categories && typeof p.categories === 'object' && !Array.isArray(p.categories)){
          App.db = { ...p, schemaVersion: DATA_SCHEMA_VERSION, viewer: true, categories: {} };
          for (const k in p.categories) App.db.categories[k] = normalizeCategory(k, p.categories[k]);
          if (migrated) save();
          return;
        }
      }
    } catch(e){ console.warn('load', e); }
    App.db = buildEmpty();
  }
  function save(){
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(App.db));
      return true;
    } catch(e){
      const isQuota = e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(e.message || '');
      if (!isQuota){ Toast.show('Error al guardar: ' + e.message, 'err', 5000); return false; }
      const cleanup = Storage.cleanupKeys();
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(App.db));
        Toast.show(cleanup.removed.length > 0 ? `🧹 Liberados ${fmtBytes(cleanup.freed)} · Guardado OK` : '⚠️ Sin espacio suficiente para guardar la lista completa', cleanup.removed.length > 0 ? 'ok' : 'warn', 4500);
        return cleanup.removed.length > 0;
      } catch(e2){
        const u = Storage.usage();
        Toast.show(`❌ Almacenamiento lleno (${fmtBytes(u.used)}). Exportá tu colección y liberá espacio local.`, 'err', 9000);
        return false;
      }
    }
  }
  function replaceAll(data){
    const src = data?.categories || {};
    App.db = {
      ...((data && typeof data === 'object' && !Array.isArray(data)) ? cloneJSON(data) : {}),
      schemaVersion: DATA_SCHEMA_VERSION,
      viewer: true,
      categories: {}
    };
    for (const k in src) App.db.categories[k] = normalizeCategory(k, src[k]);
    save();
  }
  const isEmpty = () => !App.db || !App.db.categories || !Object.keys(App.db.categories).length;
  const allCDs = () => isEmpty() ? [] : Object.values(App.db.categories).flatMap(c => Array.isArray(c.cds) ? c.cds : []);
  const total = () => allCDs().length;
  const catKeys = () => isEmpty() ? [] : Object.keys(App.db.categories);
  const get = k => App.db?.categories?.[k];
  const getCDs = k => App.db?.categories?.[k]?.cds || [];
  function clearAll(){ App.db = buildEmpty(); try { localStorage.removeItem(STORE_KEY); } catch(e){} }
  const hasAnyRatings = () => allCDs().some(c => c.rating > 0);
  const hasAnyFavs = () => allCDs().some(c => c.favorito);
  const hasAnyStreams = () => allCDs().some(c => c.links && Object.keys(c.links).length > 0);
  return { load, save, replaceAll, hydrate, isEmpty, allCDs, total, catKeys, get, getCDs, clearAll, hasAnyRatings, hasAnyFavs, hasAnyStreams };
})();

const Search = (() => {
  function tokenize(q){
    const tokens = []; let cur = ''; let inQ = false;
    for (let i = 0; i < q.length; i++){
      const ch = q[i];
      if (ch === '"'){ inQ = !inQ; continue; }
      if (!inQ && /\s/.test(ch)){ if (cur){ tokens.push(cur); cur = ''; } }
      else cur += ch;
    }
    if (cur) tokens.push(cur);
    return tokens;
  }
  function isAdvanced(q){
    const s = String(q||'').trim();
    if (!s) return false;
    if (/\b[a-zA-ZñÑáéíóúÁÉÍÓÚ]+\s*:\s*\S+/.test(s)) return true;
    if (/(^|\s)(AND|OR)(\s|$)/.test(s)) return true;
    if (/(^|\s)-[^\s-]/.test(s)) return true;
    return false;
  }
  function match(cd, q){
    if (!q) return true;
    if (isAdvanced(q)) return advancedMatch(cd, q);
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const h = norm([cd.titulo, cd.interprete, cd.sello, cd.anio, cd.anioEdicion, cd.genero, cd.ubicacion, cd.catalogo, cd.pais, cd.edicion, cd.notas, cd.isrc, (cd.tags || []).join(' ')].join(' '));
    return terms.every(t => h.includes(t));
  }
  function advancedMatch(cd, q){
    const tokens = tokenize(q);
    let result = true, pendingOp = 'AND';
    for (const tk of tokens){
      if (tk === 'AND' || tk === 'OR'){ pendingOp = tk; continue; }
      if (!tk || tk === '-' || tk === '--') continue;
      const neg = tk.startsWith('-');
      const clean = neg ? tk.slice(1) : tk;
      if (!clean) continue;
      let hit;
      if (clean.includes(':')){ const i = clean.indexOf(':'); hit = matchField(cd, clean.slice(0, i).toLowerCase(), clean.slice(i + 1)); }
      else if (clean.startsWith('#')){ hit = (cd.tags || []).some(t => norm(t).includes(norm(clean.slice(1)))); }
      else { hit = norm([cd.titulo, cd.interprete, cd.sello, cd.anio, cd.genero, (cd.tags || []).join(' ')].join(' ')).includes(norm(clean)); }
      if (neg) hit = !hit;
      result = pendingOp === 'OR' ? (result || hit) : (result && hit);
      pendingOp = 'AND';
    }
    return result;
  }
  function matchField(cd, f, v){
    const vn = norm(v);
    const cmp = v.match(/^(>=|<=|>|<|=)/);
    const compare = (target) => {
      if (cmp){
        const n1 = parseFloat(target), n2 = parseFloat(v.replace(cmp[0], ''));
        if (isNaN(n1) || isNaN(n2)) return false;
        switch(cmp[0]){ case '>': return n1 > n2; case '<': return n1 < n2; case '>=': return n1 >= n2; case '<=': return n1 <= n2; case '=': return n1 === n2; }
      }
      return norm(target).includes(vn);
    };
    switch(f){
      case 'artist': case 'artista': case 'interprete': case 'intérprete': return compare(cd.interprete);
      case 'title': case 'titulo': case 'título': return compare(cd.titulo);
      case 'year': case 'anio': case 'año': return compare(String(cd.anio ?? ''));
      case 'yeared': case 'anioedicion': case 'anioed': return compare(String(cd.anioEdicion ?? ''));
      case 'genre': case 'genero': case 'género': return compare(cd.genero);
      case 'label': case 'sello': return compare(cd.sello);
      case 'format': case 'formato': return compare(cd.formato);
      case 'catalog': case 'catalogo': case 'catálogo': return compare(cd.catalogo);
      case 'isrc': return compare(cd.isrc);
      case 'country': case 'pais': case 'país': return compare(cd.pais);
      case 'location': case 'ubicacion': case 'ubicación': return compare(cd.ubicacion);
      case 'nro': case 'numero': case 'número': return compare(String(cd.nro));
      case 'tag': return (cd.tags || []).some(t => norm(t).includes(vn));
      case 'rating': return compare(String(cd.rating || 0));
      case 'fav': case 'favorito': return cd.favorito === (v === 'true' || v === '1');
      case 'stream': case 'streaming': { const has = !!(cd.links && Object.keys(cd.links).length > 0); return v === 'true' ? has : !has; }
      case 'loaned': case 'prestado': const isL = Loans.isLoaned(cd); return v === 'true' ? isL : v === 'false' ? !isL : isL;
      default: return false;
    }
  }
  function highlight(texto, q){
    const t = esc(texto);
    if (!q) return t;
    const terms = norm(q).split(/\s+/).filter(Boolean).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!terms.length) return t;
    try { return t.replace(new RegExp(`(${terms.join('|')})`, 'ig'), '<mark>$1</mark>'); } catch { return t; }
  }
  return { match, isAdvanced, highlight };
})();

const Loans = {
  isLoaned: cd => !!(cd.prestadoA && cd.prestadoA.trim()),
  isOverdue: cd => Loans.isLoaned(cd) && cd.fechaDevolucion && new Date(cd.fechaDevolucion) < new Date()
};

function matchArtist(cd, target){
  if (!target) return true;
  return norm(cd.interprete) === norm(target);
}

function setArtistFilter(name){
  if (name){
    App.artista = name;
    App.q = '';
    const qEl = $('#q');
    if (qEl) qEl.value = '';
    $('#searchBox')?.classList.remove('has','adv-mode');
    App.filters = { estado:'', formato:'', anioD:'', anioH:'', ubic:'', port:'', pres:'', rating:'', fav:false, stream:'' };
    Toast.show(`🎤 Solo ${upper(name)}`, 'ok', 2200);
  } else {
    App.artista = null;
    Toast.show('🎤 Filtro de artista quitado', 'info', 1500);
  }
  if (App.tab !== 'list' && App.tab !== 'grid'){ App.tab = 'list'; updateNav(); }
  Prefs.set({ cat: App.cat });
  renderAll();
  const main = $('#main');
  if (main) main.scrollTop = 0;
}

function getStreamCount(cd){
  const knownKeys = STREAMING_SERVICES.map(s => s.key);
  const cdLinks = cd.links || {};
  return Object.keys(cdLinks).filter(k => knownKeys.includes(k) && isSafeStreamUrl(cdLinks[k])).length;
}
function hasStreams(cd){ return getStreamCount(cd) > 0; }

const ITUNES_MATCH_CACHE = new Map();
const STREAM_BUSY = new WeakMap();

function streamQueryParts(cd){
  const rawTitle = String(cd?.titulo || cd?.title || '').trim();
  const rawArtist = String(cd?.interprete || cd?.artist || '').trim();
  const title = (typeof limpiarTituloParaBusqueda === 'function'
    ? limpiarTituloParaBusqueda(rawTitle) : rawTitle) || rawTitle;
  const artist = (typeof limpiarInterpreteParaBusqueda === 'function'
    ? limpiarInterpreteParaBusqueda(rawArtist) : rawArtist) || rawArtist;
  const year = cd?.anio ? String(cd.anio) : '';
  return { title, artist, year, rawTitle, rawArtist };
}

function streamCacheKey(cd){
  const p = streamQueryParts(cd);
  return [p.artist, p.title, p.year].map(s => norm(s || '')).join('|');
}

function buildPlatformSearchUrl(svcKey, cd, canonical){
  const p = streamQueryParts(cd);
  const title = (canonical && canonical.title) || p.title;
  const artist = (canonical && canonical.artist) || p.artist;
  if (!title && !artist) return null;

  const basic = [artist, title].filter(Boolean).join(' ').trim();
  const quoted = [title && `"${title}"`, artist].filter(Boolean).join(' ').trim();
  const withYear = p.year ? `${basic} ${p.year}` : basic;

  const enc = s => encodeURIComponent(s);
  const encPlus = s => encodeURIComponent(s).replace(/%20/g, '+');

  switch (svcKey){
    case 'spotify':
      return `https://open.spotify.com/search/${enc(title && artist ? `album:${title} artist:${artist}` : basic)}`;
    case 'youtube':
      return `https://music.youtube.com/search?q=${enc(quoted || basic)}`;
    case 'apple':
      return `https://music.apple.com/search?term=${enc(withYear || basic)}`;
    case 'deezer':
      return `https://www.deezer.com/search/${enc(basic)}`;
    case 'tidal':
      return `https://listen.tidal.com/search?q=${enc(basic)}`;
    case 'amazon':
      return `https://music.amazon.com/search/${encPlus(basic)}`;
    case 'soundcloud':
      return `https://soundcloud.com/search?q=${enc(basic)}`;
    case 'discogs':
      return `https://www.discogs.com/search/?q=${enc(basic)}&type=release`;
    default:
      return null;
  }
}

function scoreItunesAlbum(r, nArtist, nTitle, year){
  let s = 0;
  const ra = norm(r.artistName || '');
  const rt = norm(r.collectionName || '');
  const ry = (r.releaseDate || '').slice(0, 4);
  if (r.wrapperType && r.wrapperType !== 'collection') return -1;
  if (r.collectionType === 'Single') return -1;
  if ((r.trackCount || 0) > 0 && (r.trackCount || 0) < 4) s -= 20;

  if (ra === nArtist) s += 100;
  else if (ra.includes(nArtist) || nArtist.includes(ra)) s += 55;
  else return -1;

  if (rt === nTitle) s += 100;
  else if (rt.includes(nTitle) || nTitle.includes(rt)) s += 45;
  else return -1;

  if (year && ry === year) s += 35;
  else if (year && ry && Math.abs(parseInt(ry, 10) - parseInt(year, 10)) <= 1) s += 12;

  const bad = ['live','en vivo','karaoke','tribute','greatest hits','best of','anthology'];
  for (const b of bad){
    if (rt.includes(b) && !nTitle.includes(b)) s -= 50;
  }
  s += Math.min(r.trackCount || 0, 15);
  return s;
}

async function findItunesAlbumMatch(cd){
  const key = streamCacheKey(cd);
  if (ITUNES_MATCH_CACHE.has(key)) return ITUNES_MATCH_CACHE.get(key);

  const p = streamQueryParts(cd);
  const term = [p.artist, p.title].filter(Boolean).join(' ').trim();
  if (!term){ ITUNES_MATCH_CACHE.set(key, null); return null; }

  const nArtist = norm(p.artist);
  const nTitle = norm(p.title);
  const countries = ['US', 'AR', 'ES', 'MX', 'GB'];
  let best = null;
  let bestScore = 0;

  for (const country of countries){
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=25&country=${country}`;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 7000) : null;
      const r = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (timer) clearTimeout(timer);
      if (!r.ok) continue;
      const data = await r.json();
      const results = Array.isArray(data.results) ? data.results : [];
      for (const row of results){
        const sc = scoreItunesAlbum(row, nArtist, nTitle, p.year);
        if (sc > bestScore){
          bestScore = sc;
          best = row;
        }
      }
      if (bestScore >= 180) break;
    } catch (e){
      if (e && e.name === 'AbortError') continue;
      console.warn('[iTunes]', e);
    }
  }

  const match = (best && bestScore >= 120) ? {
    title: best.collectionName || p.title,
    artist: best.artistName || p.artist,
    year: (best.releaseDate || '').slice(0, 4) || p.year,
    appleUrl: best.collectionViewUrl || null,
    artwork: best.artworkUrl100 || null,
    score: bestScore,
    trackCount: best.trackCount || 0
  } : null;

  ITUNES_MATCH_CACHE.set(key, match);
  return match;
}

function openSafeUrl(url){
  if (!url || !isSafeStreamUrl(url)){
    Toast.show('🔒 URL no permitida', 'warn', 2500);
    return false;
  }
  window.open(url, '_blank', 'noopener');
  return true;
}

async function openPlatformForCD(cd, svcKey, btn){
  if (!cd || !svcKey) return;
  if (btn && STREAM_BUSY.get(btn)) return;
  if (btn) STREAM_BUSY.set(btn, true);
  if (typeof navigator !== 'undefined' && navigator.onLine === false){
    const cdLinks = (cd.links && typeof cd.links === 'object') ? cd.links : {};
    if (!(cdLinks[svcKey] && isSafeStreamUrl(cdLinks[svcKey]))){
      Toast.show('🔴 Sin conexión — solo links guardados funcionan offline', 'warn', 3500);
      if (btn) STREAM_BUSY.delete(btn);
      return;
    }
  }

  const setBusy = (on) => {
    if (!btn) return;
    btn.disabled = !!on;
    btn.classList.toggle('busy', !!on);
  };
  setBusy(true);

  try {
    const cdLinks = (cd.links && typeof cd.links === 'object' && !Array.isArray(cd.links)) ? cd.links : {};
    const saved = cdLinks[svcKey];

    if (saved && isSafeStreamUrl(saved)){
      openSafeUrl(saved);
      Toast.show(`↗ ${STREAMING_SERVICES.find(s => s.key === svcKey)?.name || svcKey}`, 'ok', 1600);
      return;
    }

    let match = null;
    try {
      match = await findItunesAlbumMatch(cd);
    } catch (e){
      console.warn('[stream match]', e);
    }

    if (svcKey === 'apple' && match?.appleUrl && isSafeStreamUrl(match.appleUrl)){
      openSafeUrl(match.appleUrl);
      Toast.show(`🍎 Álbum: ${match.title}`, 'ok', 2500);
      return;
    }

    const canonical = match ? { title: match.title, artist: match.artist } : null;
    const url = buildPlatformSearchUrl(svcKey, cd, canonical);
    if (!openSafeUrl(url)) return;

    const svcName = STREAMING_SERVICES.find(s => s.key === svcKey)?.name || svcKey;
    if (match){
      Toast.show(`🎯 ${svcName}: búsqueda de «${match.title}»`, 'info', 2800);
    } else {
      Toast.show(`🎯 ${svcName}: búsqueda (revisá el resultado)`, 'info', 2800);
    }
  } finally {
    setBusy(false);
    if (btn) STREAM_BUSY.delete(btn);
  }
}

function wireStreamingSectionEvents(sectionEl, cdRef){
  const section = sectionEl
    || document.querySelector('#detModal .stream-section')
    || document.querySelector('.stream-section');
  if (!section) return;
  const cdFixed = cdRef || null;

  section.querySelectorAll('[data-stream-svc]').forEach(btn => {
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.dataset.streamSvc;
      const cd = cdFixed || App.detailCD;
      if (!cd){ Toast.show('Sin álbum seleccionado', 'warn'); return; }
      openPlatformForCD(cd, key, btn);
    });
  });
}

function renderStreamingSection(cd){
  const cdLinks = (cd.links && typeof cd.links === 'object' && !Array.isArray(cd.links)) ? cd.links : {};
  const allowedSaved = STREAMING_SERVICES.filter(svc => cdLinks[svc.key] && isSafeStreamUrl(cdLinks[svc.key]));
  const otherLinks = Object.entries(cdLinks).filter(([k, v]) => !STREAMING_SERVICES.some(s => s.key === k) && isSafeStreamUrl(v));
  const directCount = allowedSaved.length;
  const p = streamQueryParts(cd);

  const badge = directCount > 0
    ? `<span class="stream-count">✅ ${directCount} directo${directCount === 1 ? '' : 's'}</span>`
    : `<span class="stream-count" style="background:rgba(167,139,250,.15);color:var(--purple);border-color:rgba(167,139,250,.4)">🎯 Inteligente</span>`;

  const items = STREAMING_SERVICES.map(svc => {
    const hasDirect = !!(cdLinks[svc.key] && isSafeStreamUrl(cdLinks[svc.key]));
    const mode = hasDirect ? 'direct' : 'search';
    const arrow = hasDirect ? '↗' : (svc.key === 'apple' ? '🍎' : '🎯');
    const title = hasDirect
      ? `Abrir ${svc.name} (link de la lista)`
      : (svc.key === 'apple'
          ? `Buscar álbum exacto en Apple Music (iTunes)`
          : `Buscar «${p.title || cd.titulo || ''}» en ${svc.name}`);
    return `<button type="button" class="stream-btn ${mode}" data-stream-svc="${esc(svc.key)}" style="--svc-color:${svc.color}" title="${esc(title)}">
      <span>${svc.icon}</span><span>${esc(svc.name)}</span><span class="stream-arrow">${arrow}</span>
    </button>`;
  }).join('');

  const othersHTML = otherLinks.length ? `
    <div style="margin-top:12px">
      <div style="font-size:.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:6px">🔗 Otros enlaces de la lista</div>
      <div class="stream-grid">${otherLinks.map(([k, url]) =>
        `<a href="${esc(url)}" target="_blank" rel="noopener" class="stream-btn direct" style="--svc-color:var(--purple)"><span>🔗</span><span>${esc(k)}</span><span class="stream-arrow">↗</span></a>`
      ).join('')}</div>
    </div>` : '';

  const queryHint = (p.title || p.artist)
    ? `<div style="font-size:.68rem;color:var(--muted);margin:6px 0 2px">Búsqueda: <b style="color:var(--txt)">${esc([p.artist, p.title].filter(Boolean).join(' — '))}</b>${p.year ? ` · ${esc(p.year)}` : ''}</div>`
    : '';

  const hint = `
    <div class="stream-hint-note" style="background:rgba(79,195,247,.06);border-left-color:var(--accent)">
      <b style="color:var(--accent)">Cómo funciona</b><br>
      • <b>↗</b> Link ya guardado en tu lista (más preciso)<br>
      • <b>🍎 Apple</b> intenta localizar el <b>álbum exacto</b> vía iTunes<br>
      • <b>🎯</b> Abre la búsqueda oficial limpia
    </div>
    <div class="stream-hint-note" style="margin-top:8px;font-size:.7rem">
      🔒 Solo plataformas oficiales · No se descarga audio
    </div>`;

  return `<div class="sec stream-section">
    <div class="sec-h" style="justify-content:space-between;flex-wrap:wrap;gap:6px">
      <span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">🎧 Escuchar en ${badge}</span>
      <span style="font-size:.55rem;background:rgba(167,139,250,.12);color:var(--purple);border:1px solid rgba(167,139,250,.35);padding:2px 7px;border-radius:8px;font-weight:700">🔒 Oficial</span>
    </div>
    ${queryHint}
    <div class="stream-grid">${items}</div>
    ${othersHTML}
    ${hint}
  </div>`;
}

function getVisibleCDs(){
  const source = App.cat === ALL_CATS ? Store.allCDs() : Store.getCDs(App.cat);
  const f = App.filters;
  return source.filter(cd => {
    if (!matchArtist(cd, App.artista)) return false;
    if (f.estado && (cd.estado || 'Excelente') !== f.estado) return false;
    if (f.formato && (cd.formato || 'CD') !== f.formato) return false;
    if (f.anioD){ const a = parseInt(f.anioD); if (!isNaN(a) && (cd.anio ?? -Infinity) < a) return false; }
    if (f.anioH){ const a = parseInt(f.anioH); if (!isNaN(a) && (cd.anio ?? Infinity) > a) return false; }
    if (f.ubic === '__con__' && !cd.ubicacion) return false;
    if (f.ubic === '__sin__' && cd.ubicacion) return false;
    if (f.port === '__con__' && !cd.portada) return false;
    if (f.port === '__sin__' && cd.portada) return false;
    if (f.stream === '__con__' && !hasStreams(cd)) return false;
    if (f.stream === '__sin__' && hasStreams(cd)) return false;
    if (f.pres === '__prestados__' && !Loans.isLoaned(cd)) return false;
    if (f.pres === '__disponibles__' && Loans.isLoaned(cd)) return false;
    if (f.pres === '__vencidos__' && !Loans.isOverdue(cd)) return false;
    if (f.rating){ const min = parseInt(f.rating); if (!isNaN(min) && (cd.rating || 0) < min) return false; }
    if (f.fav && !cd.favorito) return false;
    if (!Search.match(cd, App.q)) return false;
    return true;
  });
}
function sortCDs(arr){
  const o = App.order;
  return arr.slice().sort((a, b) => {
    if (o === 'titulo') return norm(a.titulo).localeCompare(norm(b.titulo), 'es');
    if (o === 'interprete') return norm(a.interprete).localeCompare(norm(b.interprete), 'es');
    if (o === 'anio') return (a.anio ?? 9999) - (b.anio ?? 9999);
    if (o === 'anioEdicion') return (a.anioEdicion ?? 9999) - (b.anioEdicion ?? 9999);
    if (o === 'reciente') return (new Date(b.createdAt || 0)) - (new Date(a.createdAt || 0));
    if (o === 'rating') return (b.rating || 0) - (a.rating || 0) || (a.nro ?? 0) - (b.nro ?? 0);
    const A = a.nro ?? 0, B = b.nro ?? 0;
    if (A !== B) return A - B;
    return norm(a.titulo).localeCompare(norm(b.titulo), 'es');
  });
}
function countActiveFilters(){
  let n = 0;
  if (App.artista) n++;
  if (App.q) n++;
  for (const k in App.filters) if (App.filters[k]) n++;
  return n;
}

function renderFreshness(){
  const el = $('#freshBadge');
  if (!el) return;
  if (Store.isEmpty()){ el.innerHTML = ''; return; }
  const info = Sync.getInfo();
  const ref = Math.max(info.lastSync || 0, info.lastImport || 0);
  if (!ref){ el.innerHTML = ''; return; }
  const ageH = (Date.now() - ref) / 3600000;
  let cls = 'ok';
  if (ageH > 24 * 7) cls = 'err';
  else if (ageH > 24) cls = 'warn';
  const icon = cls === 'ok' ? '⏱️' : cls === 'warn' ? '⚠️' : '🚨';
  el.innerHTML = `<span class="h-fresh ${cls}" title="Última: ${new Date(ref).toLocaleString('es-AR')}">${icon} ${esc(fmtRel(ref))}</span>`;
}

function renderCats(){
  const el = $('#cats');
  if (Store.isEmpty()){ el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'chip all' + (App.cat === ALL_CATS ? ' on' : '');
  all.innerHTML = `<span>🗂️</span><span>Todas</span><span class="n">${Store.total()}</span>`;
  all.addEventListener('click', () => { if (App.cat === ALL_CATS && !App.artista) return; App.cat = ALL_CATS; App.artista = null; Prefs.set({ cat: App.cat }); renderAll(); });
  el.appendChild(all);
  for (const k of Store.catKeys()){
    const c = Store.get(k);
    const b = document.createElement('button');
    b.className = 'chip' + (App.cat === k ? ' on' : '');
    b.innerHTML = `<span>${esc(c.icon)}</span><span>${esc(c.label)}</span><span class="n">${c.cds.length}</span>`;
    b.addEventListener('click', () => { if (App.cat === k && !App.artista) return; App.cat = k; App.artista = null; Prefs.set({ cat: App.cat }); renderAll(); });
    el.appendChild(b);
  }
}

function renderMain(){
  const main = $('#main');
  if (Store.isEmpty()){ main.innerHTML = renderEmpty(); bindEmpty(); return; }
  if (App.tab === 'list') return renderList(main);
  if (App.tab === 'grid') return renderGrid(main);
  if (App.tab === 'stats') return renderStats(main);
  if (App.tab === 'artists') return renderArtists(main);
  return renderList(main);
}

function renderEmpty(){
  const hasSync = Sync.isConfigured();
  return `
    <div class="empty">
      <div class="ic">💿</div>
      <h2>Sin colección</h2>
      <p>${hasSync ? 'Configuraste Drive pero aún no sincronizaste. Tocá 🔄 o el botón de abajo.' : 'Importá un backup .json o configurá Google Drive (gratis con Apps Script).'}</p>
      <div class="btns">
        ${hasSync ? `<button class="btn pri" id="empSyncNow">🔄 Sincronizar ahora desde Drive</button>` : ''}
        <button class="btn ${hasSync ? '' : 'pri'}" id="empSync">⚙️ Configurar Google Drive</button>
        <button class="btn" id="empImport">📁 Importar archivo</button>
        <button class="btn" id="empUrl">🌐 Desde URL directa</button>
        <button class="btn" id="empPaste">📋 Pegar JSON</button>
      </div>
      <div class="drop" id="empDrop">⬇️ …o arrastrá el archivo acá</div>
    </div>`;
}
function bindEmpty(){
  $('#empImport')?.addEventListener('click', () => openImport());
  $('#empPaste')?.addEventListener('click', () => openPaste());
  $('#empUrl')?.addEventListener('click', () => openUrl());
  $('#empSync')?.addEventListener('click', () => openSync());
  $('#empSyncNow')?.addEventListener('click', () => syncNow(true, true));
  const dz = $('#empDrop');
  if (dz){
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('hv'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('hv'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('hv'); handleFiles(e.dataTransfer?.files); });
  }
}

function filterBannerHTML(){
  const parts = [];
  if (App.artista) parts.push(`🎤 <b>${esc(upper(App.artista))}</b> (exacto)`);
  if (App.q) parts.push(`🔍 "${esc(App.q)}"`);
  const activeF = [];
  if (App.filters.estado) activeF.push(`Estado: ${esc(App.filters.estado)}`);
  if (App.filters.formato) activeF.push(`Formato: ${esc(App.filters.formato)}`);
  if (App.filters.anioD) activeF.push(`Año ≥ ${esc(App.filters.anioD)}`);
  if (App.filters.anioH) activeF.push(`Año ≤ ${esc(App.filters.anioH)}`);
  if (App.filters.ubic) activeF.push(`Ubicación`);
  if (App.filters.port) activeF.push(`Portada`);
  if (App.filters.pres) activeF.push(`Préstamo`);
  if (App.filters.stream === '__con__') activeF.push(`🎧 Con streaming`);
  if (App.filters.stream === '__sin__') activeF.push(`Sin streaming`);
  if (App.filters.rating) activeF.push(`⭐ ${App.filters.rating}+`);
  if (App.filters.fav) activeF.push(`⭐ Solo favoritos`);
  if (activeF.length) parts.push(`🎛️ ${activeF.join(' · ')}`);
  if (!parts.length) return '';
  const clearArtistBtn = App.artista ? `<button class="x" data-clear-artist type="button">✕ Artista</button>` : '';
  const clearAllBtn = `<button class="x" data-clear-all type="button">✕ Todo</button>`;
  return `<div class="filter-banner"><span class="ic">🎯</span><span class="txt">${parts.join(' · ')}</span>${clearArtistBtn}${clearAllBtn}</div>`;
}

function renderCard(cd, q){
  const loaned = Loans.isLoaned(cd), overdue = Loans.isOverdue(cd);
  const cover = cd.portada ? `<img class="cover" src="${esc(cd.portada)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'ph\\'>💿</div>'">` : `<div class="ph">💿</div>`;
  const loanBadge = loaned ? `<div class="loan${overdue ? ' overdue' : ''}">📤${overdue ? '!' : ''}</div>` : '';
  const favStar = cd.favorito ? `<span class="fav">★</span>` : '';
  const ratingStars = cd.rating > 0 ? `<span class="rate" title="${cd.rating} de 5">${'★'.repeat(cd.rating)}</span>` : '';
  const tagsHTML = (cd.tags || []).slice(0, 2).map(t => `<span class="tag">#${esc(t)}</span>`).join('');
  const edBadge = cd.anioEdicion && cd.anioEdicion !== cd.anio ? `<span class="ed" title="Año edición">📅 Ed.${cd.anioEdicion}</span>` : '';
  const streamCount = getStreamCount(cd);
  const streamBadge = streamCount > 0 ? `<span class="stream-tag" title="${streamCount} link${streamCount === 1 ? '' : 's'}">🎧 ${streamCount}</span>` : '';
  return `<div class="card" data-id="${esc(cd.id)}">${loanBadge}${cover}<div class="info"><div class="title">${favStar}${Search.highlight(cd.titulo || '—', q)}</div><div class="artist">${Search.highlight(cd.interprete || '—', q)}</div><div class="meta"><span class="nro">#${cd.nro}</span>${cd.anio ? `<b>${cd.anio}</b>` : ''}${edBadge}${cd.formato ? `<span>${esc(cd.formato)}</span>` : ''}${streamBadge}${ratingStars}${tagsHTML}</div></div><span class="arrow">›</span></div>`;
}

function renderList(main){
  const cds = sortCDs(getVisibleCDs());
  const total = App.cat === ALL_CATS ? Store.total() : Store.getCDs(App.cat).length;
  const nFilters = countActiveFilters();
  const banner = filterBannerHTML();
  if (!cds.length){
    main.innerHTML = `${banner}<div class="empty" style="padding:40px 16px"><div class="ic" style="font-size:3rem">🔍</div><h2>Sin resultados</h2><p>${Store.total() ? 'Probá con otra búsqueda o quitá los filtros.' : 'Importá un backup para empezar.'}</p></div>`;
    bindFilterBanner(main);
    return;
  }
  const html = cds.map(cd => renderCard(cd, App.q)).join('');
  const counter = nFilters > 0
    ? `<b style="color:var(--accent2)">${cds.length}</b> de ${total} · ${nFilters} filtro${nFilters === 1 ? '' : 's'}`
    : `${total} CD${total === 1 ? '' : 's'} · orden: ${orderLabel()}`;
  main.innerHTML = `${banner}<div style="font-size:.72rem;color:var(--muted);margin-bottom:8px;padding:0 4px">${counter}</div><div class="list">${html}</div>`;
  main.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => { const cd = findCDById(el.dataset.id); if (cd) openDetail(cd); });
  });
  bindFilterBanner(main);
}
function orderLabel(){
  const m = { nro:'Nº', titulo:'Título', interprete:'Intérprete', anio:'Año álbum', anioEdicion:'Año edición', rating:'Valoración', reciente:'Recientes' };
  return m[App.order] || 'Nº';
}
function bindFilterBanner(container){
  container.querySelector('[data-clear-artist]')?.addEventListener('click', () => { App.artista = null; renderAll(); Toast.show('Filtro de artista quitado', 'info', 1500); });
  container.querySelector('[data-clear-all]')?.addEventListener('click', () => {
    App.artista = null; App.q = '';
    const qEl = $('#q'); if (qEl) qEl.value = '';
    $('#searchBox')?.classList.remove('has','adv-mode');
    App.filters = { estado:'', formato:'', anioD:'', anioH:'', ubic:'', port:'', pres:'', rating:'', fav:false, stream:'' };
    renderAll();
    Toast.show('Todos los filtros quitados', 'info', 1500);
  });
}

function renderGrid(main){
  const cds = sortCDs(getVisibleCDs());
  const banner = filterBannerHTML();
  if (!cds.length){
    main.innerHTML = `${banner}<div class="empty"><div class="ic" style="font-size:3rem">🔍</div><h2>Sin resultados</h2></div>`;
    bindFilterBanner(main);
    return;
  }
  const html = cds.map(cd => {
    const loaned = Loans.isLoaned(cd), overdue = Loans.isOverdue(cd);
    const img = cd.portada ? `<img class="gc-img" src="${esc(cd.portada)}" alt="" loading="lazy" style="object-fit:cover;display:block" onerror="this.outerHTML='<div class=\\'gc-img\\'>💿</div>'">` : `<div class="gc-img">💿</div>`;
    const loanBadge = loaned ? `<div class="loan${overdue ? ' overdue' : ''}">📤${overdue ? '!' : ''}</div>` : '';
    const favBadge = cd.favorito ? `<div class="gc-fav">★</div>` : '';
    const sc = getStreamCount(cd);
    const streamBadge = sc > 0 ? `<div class="gc-stream" title="${sc} links">🎧 ${sc}</div>` : '';
    return `<div class="gcard" data-id="${esc(cd.id)}">${streamBadge || loanBadge}${favBadge}${img}<div class="gc-t">${esc(cd.titulo || '—')}</div><div class="gc-a">${esc(cd.interprete || '—')}</div><div class="gc-m"><span class="gc-n">#${cd.nro}</span><span class="gc-y">${cd.anio ?? '—'}</span></div></div>`;
  }).join('');
  main.innerHTML = `${banner}<div class="grid">${html}</div>`;
  main.querySelectorAll('.gcard').forEach(el => {
    el.addEventListener('click', () => { const cd = findCDById(el.dataset.id); if (cd) openDetail(cd); });
  });
  bindFilterBanner(main);
}

function renderStats(main){
  const all = Store.allCDs();
  const total = all.length;
  const artistas = new Set(), sellos = new Map(), anios = new Map(), decadas = new Map();
  let conPortada = 0, conValor = 0, valorTotal = 0, añosMin = null, añosMax = null;
  let conAnio = 0, conSello = 0, conGenero = 0, conUbic = 0, conCat = 0, conAnioEd = 0, conStream = 0;
  let prestados = 0, vencidos = 0;
  for (const cd of all){
    if (cd.interprete) artistas.add(cd.interprete);
    if (cd.sello){ sellos.set(cd.sello, (sellos.get(cd.sello) || 0) + 1); conSello++; }
    if (cd.anio){ anios.set(cd.anio, (anios.get(cd.anio) || 0) + 1); const d = Math.floor(cd.anio / 10) * 10; decadas.set(d, (decadas.get(d) || 0) + 1); conAnio++; }
    if (cd.anioEdicion) conAnioEd++;
    if (cd.portada) conPortada++;
    if (cd.genero) conGenero++;
    if (cd.ubicacion) conUbic++;
    if (cd.catalogo) conCat++;
    if (hasStreams(cd)) conStream++;
    if (Loans.isLoaned(cd)){ prestados++; if (Loans.isOverdue(cd)) vencidos++; }
    if (cd.valor != null && Number.isFinite(Number(cd.valor))){ valorTotal += Number(cd.valor) * Math.max(1, parseInt(cd.cantidad) || 1); conValor++; }
    if (cd.anio){ añosMin = añosMin === null ? cd.anio : Math.min(añosMin, cd.anio); añosMax = añosMax === null ? cd.anio : Math.max(añosMax, cd.anio); }
  }
  const artMap = new Map();
  for (const cd of all) if (cd.interprete) artMap.set(cd.interprete, (artMap.get(cd.interprete) || 0) + 1);
  const topArt = [...artMap].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topSellos = [...sellos].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topAnios = [...anios].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const decSorted = [...decadas].sort((a, b) => a[0] - b[0]);
  const kpis = [
    { i: '💿', l: 'CDs', v: total.toLocaleString('es-AR') },
    { i: '🎤', l: 'Intérpretes', v: artistas.size.toLocaleString('es-AR') },
    { i: '📅', l: 'Rango', v: (añosMin && añosMax) ? `${añosMin}–${añosMax}` : '—' },
    { i: '🎧', l: 'Con streaming', v: `${conStream}/${total}` },
    { i: '🖼️', l: 'Portadas', v: `${conPortada}/${total}` },
    ...(prestados > 0 ? [{ i: '📚', l: 'Prestados', v: `${prestados}${vencidos > 0 ? ' ('+vencidos+'⚠️)' : ''}` }] : []),
    ...(valorTotal > 0 ? [{ i: '💰', l: 'Valor', v: '$' + valorTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 }) }] : []),
    ...(Store.catKeys().length ? [{ i: '📁', l: 'Categorías', v: String(Store.catKeys().length) }] : [])
  ];
  const health = [
    { l:'Con año álbum', v: conAnio },
    { l:'Con año edición', v: conAnioEd },
    { l:'Con sello', v: conSello },
    { l:'Con género', v: conGenero },
    { l:'Con ubicación', v: conUbic },
    { l:'Con Nº catálogo', v: conCat },
    { l:'Con streaming', v: conStream },
    { l:'Con portada', v: conPortada },
    { l:'Con valor', v: conValor }
  ].filter(h => h.v > 0 || h.l === 'Con portada' || h.l === 'Con año álbum' || h.l === 'Con streaming');
  main.innerHTML = `
    <div class="kpi">${kpis.map(k => `<div class="k"><div class="ki">${k.i}</div><div class="kt"><div class="kl">${esc(k.l)}</div><div class="kv">${esc(k.v)}</div></div></div>`).join('')}</div>
    ${decSorted.length ? `<div class="chart-box"><h3><span class="d" style="background:#ffca28"></span>CDs por década</h3><div class="dec-bars">${(() => { const mx = Math.max(...decSorted.map(([,v]) => v), 1); return decSorted.map(([d,v]) => `<div class="dec-row"><span>${esc(String(d))}s</span><div class="dec-track"><i style="width:${Math.max(6, Math.round(v/mx*100))}%"></i></div><b>${v}</b></div>`).join(''); })()}</div></div>` : ''}
    ${topArt.length ? `<div class="chart-box"><h3><span class="d" style="background:#a78bfa"></span>Top 10 intérpretes</h3><ul class="top">${topArt.map(([n, v], i) => `<li data-artist="${esc(n)}" style="cursor:pointer"><span class="r">${i+1}</span><span class="n" title="${esc(n)}">${esc(n)}</span><span class="v">${v}</span></li>`).join('')}</ul></div>` : ''}
    ${topSellos.length ? `<div class="chart-box"><h3><span class="d" style="background:#5ddc9a"></span>Top 10 sellos</h3><ul class="top">${topSellos.map(([n, v], i) => `<li><span class="r">${i+1}</span><span class="n" title="${esc(n)}">${esc(n)}</span><span class="v">${v}</span></li>`).join('')}</ul></div>` : ''}
    ${topAnios.length ? `<div class="chart-box"><h3><span class="d" style="background:#ff6b6b"></span>Top 10 años álbum</h3><ul class="top">${topAnios.map(([n, v], i) => `<li><span class="r">${i+1}</span><span class="n">${n}</span><span class="v">${v}</span></li>`).join('')}</ul></div>` : ''}
    <div class="chart-box"><h3><span class="d" style="background:#4fc3f7"></span>Salud de la colección</h3><div class="health-grid">${health.map(h => { const p = total ? Math.round(h.v/total*100) : 0; return `<div class="hi"><div class="hi-l">${h.l}</div><div class="hi-v">${h.v} <span style="font-size:.7rem;color:var(--muted);font-weight:400">/ ${total}</span></div><div class="hi-bar"><i style="width:${p}%"></i></div></div>`; }).join('')}</div></div>
    ${topArt.length > 4 ? `<div class="chart-box"><h3><span class="d" style="background:#a78bfa"></span>Nube de intérpretes</h3><div class="wc">${(() => { const top40 = [...artMap].sort((a, b) => b[1] - a[1]).slice(0, 40); const mx = top40[0]?.[1] || 1; return top40.map(([n, v]) => { const s = 0.7 + (v / mx) * 1.1; const o = 0.5 + (v / mx) * 0.5; return `<span style="font-size:${s}rem;opacity:${o}">${esc(n)}</span>`; }).join(''); })()}</div></div>` : ''}
  `;
  main.querySelectorAll('.top [data-artist]').forEach(li => {
    li.addEventListener('click', () => setArtistFilter(li.dataset.artist));
  });
}

function renderArtists(main){
  const source = App.cat === ALL_CATS ? Store.allCDs() : Store.getCDs(App.cat);
  const map = new Map();
  for (const cd of source) if (cd.interprete) map.set(cd.interprete, (map.get(cd.interprete) || 0) + 1);
  const rawList = [...map].map(([name, count]) => ({ name, count }));
  if (App.artistsOrder === 'alpha'){ rawList.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })); }
  else { rawList.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es')); }
  _artistList = rawList;
  if (!_artistList.length){ main.innerHTML = `<div class="empty"><div class="ic" style="font-size:3rem">🎤</div><h2>Sin intérpretes</h2></div>`; return; }
  const banner = filterBannerHTML();
  const mx = Math.max(..._artistList.map(a => a.count), 1);
  const artistActive = App.artista ? norm(App.artista) : null;
  const isAlpha = App.artistsOrder === 'alpha';
  const listHTML = _artistList.map((a, i) => {
    const isOn = artistActive && norm(a.name) === artistActive;
    return `<li class="artist-item${isOn ? ' on' : ''}" data-idx="${i}">
      <span class="rk">${isAlpha ? '·' : i + 1}</span>
      <span style="min-width:0"><span class="nm">${esc(a.name)}</span><span class="bar"><i style="width:${Math.round(a.count / mx * 100)}%"></i></span></span>
      <span class="ct">${a.count}</span>
    </li>`;
  }).join('');
  main.innerHTML = `${banner}
    <div class="artists-toolbar">
      <div class="at-count"><b>${_artistList.length}</b> intérpretes · tocá uno para filtrar</div>
      <div class="artists-sort" id="artistsSort">
        <button type="button" data-sort="count" class="${isAlpha ? '' : 'on'}">🔢 Por cantidad</button>
        <button type="button" data-sort="alpha" class="${isAlpha ? 'on' : ''}">🔤 A-Z</button>
      </div>
    </div>
    <ul class="artist-list">${listHTML}</ul>`;
  main.querySelectorAll('#artistsSort button').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.sort;
      if (App.artistsOrder === mode) return;
      App.artistsOrder = mode;
      Prefs.set({ artistsOrder: mode });
      renderMain();
      Toast.show(mode === 'alpha' ? '🔤 Ordenado alfabéticamente' : '🔢 Ordenado por cantidad', 'ok', 1500);
    });
  });
  main.querySelectorAll('.artist-item').forEach(el => {
    el.addEventListener('click', () => {
      const a = _artistList[parseInt(el.dataset.idx, 10)];
      if (!a) return;
      const wasActive = App.artista && norm(App.artista) === norm(a.name);
      setArtistFilter(wasActive ? null : a.name);
    });
  });
  bindFilterBanner(main);
}

function renderMore(main){
  if (!main) main = $('#moreBody');
  const stats = { cds: Store.total(), cats: Store.catKeys().length, conPortada: Store.allCDs().filter(c => c.portada).length, conStream: Store.allCDs().filter(hasStreams).length };
  const syncReady = Sync.isConfigured();
  const info = Sync.getInfo();
  const lastRef = Math.max(info.lastSync || 0, info.lastImport || 0);
  const lastFileTxt = info.lastFileName ? `<br><span style="font-size:.7rem;opacity:.8">Último: ${esc(info.lastFileName)}</span>` : '';
  const syncInfoHTML = syncReady
    ? `<div class="sync-status ok" style="margin-bottom:10px"><span>🔄</span><div><b>Drive configurado (Apps Script)</b><br>Última: ${lastRef ? esc(fmtRel(lastRef)) : 'nunca'}${lastFileTxt}</div></div>`
    : `<div class="sync-status warn" style="margin-bottom:10px"><span>⚙️</span><div><b>Sin configurar</b><br>Conectá tu Apps Script Web App para auto-sync</div></div>`;
  const all = Store.allCDs();
  const prestados = all.filter(Loans.isLoaned).length;
  const vencidos = all.filter(Loans.isOverdue).length;
  const u = Storage.usage();
  const pctClass = u.pct > 85 ? 'err' : u.pct > 65 ? 'warn' : 'ok';
  const lastCleanup = Storage.lastCleanup();
  const lastCleanupTxt = lastCleanup ? `Última limpieza: ${esc(fmtRel(lastCleanup))}` : 'Nunca limpiado';
  const keyCount = Storage.listKeys().length;
  const storageHTML = `
    <div class="storage-box">
      <div class="sb-head"><span>💾 <b>Almacenamiento</b></span><span class="sb-pct ${pctClass}">${u.pct}%</span></div>
      <div class="sb-bar"><i class="${pctClass}" style="width:${Math.max(2, u.pct)}%"></i></div>
      <div class="sb-info">Usado: <b>${fmtBytes(u.used)}</b> / ~${fmtBytes(u.limit)}<br>${keyCount} clave${keyCount === 1 ? '' : 's'} en localStorage<br><span style="opacity:.8">${lastCleanupTxt}</span></div>
    </div>`;
  main.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="padding:16px;background:linear-gradient(135deg,rgba(79,195,247,.08),rgba(93,220,154,.05));border:1px solid rgba(79,195,247,.25);border-radius:14px;text-align:center">
        <div style="font-size:1.8rem;margin-bottom:6px">💿</div>
        <div style="font-size:1.05rem;font-weight:700;margin-bottom:4px">${stats.cds} CDs en tu colección</div>
        <div style="font-size:.78rem;color:var(--muted)">${stats.cats} categoría${stats.cats === 1 ? '' : 's'} · ${stats.conPortada} con portada · ${stats.conStream} con streaming</div>
        <div style="margin-top:10px;font-size:.68rem;color:var(--ok);background:rgba(93,220,154,.08);padding:6px 10px;border-radius:8px;display:inline-block;border:1px solid rgba(93,220,154,.25)">🔒 Solo consulta · Sin descargas</div>
      </div>
      ${prestados > 0 ? `<div class="loans-banner${vencidos > 0 ? ' overdue' : ''}"><span>📚</span><div><b>${prestados}</b> CD${prestados === 1 ? '' : 's'} en préstamo${vencidos > 0 ? ` · <b>${vencidos} vencido${vencidos === 1 ? '' : 's'}</b>` : ''}</div></div>` : ''}
      ${syncInfoHTML}
      ${storageHTML}
      <button type="button" class="btn-row accent" data-act="clean"><span>🧹</span><span>Limpiar caché ahora</span></button>
      <div style="height:6px"></div>
      <button type="button" class="btn-row" data-act="sync"><span>⚙️</span><span>Configurar Google Drive</span></button>
      ${syncReady ? `<button type="button" class="btn-row accent" data-act="sync-now"><span>🔄</span><span>Sincronizar ahora</span></button>` : ''}
      ${syncReady ? `<button type="button" class="btn-row" data-act="sync-force"><span>⬇️</span><span>Forzar sincronización</span></button>` : ''}
      ${syncReady ? `<button type="button" class="btn-row" data-act="backups"><span>📂</span><span>Ver backups en Drive</span></button>` : ''}
      <div style="height:6px"></div>
      <div style="font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:700;padding:8px 4px 0">Orden de la lista</div>
      <div class="seg" id="orderSeg" style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="seg-btn${App.order === 'nro' ? ' on' : ''}" data-order="nro">🔢 Nº</button>
        <button type="button" class="seg-btn${App.order === 'titulo' ? ' on' : ''}" data-order="titulo">🔤 Título</button>
        <button type="button" class="seg-btn${App.order === 'interprete' ? ' on' : ''}" data-order="interprete">🎤 Intérprete</button>
        <button type="button" class="seg-btn${App.order === 'anio' ? ' on' : ''}" data-order="anio">📅 Año álbum</button>
        <button type="button" class="seg-btn${App.order === 'anioEdicion' ? ' on' : ''}" data-order="anioEdicion">📅 Año edición</button>
        ${Store.hasAnyRatings() ? `<button type="button" class="seg-btn${App.order === 'rating' ? ' on' : ''}" data-order="rating">⭐ Valoración</button>` : ''}
      </div>
      <div style="height:6px"></div>
      <button type="button" class="btn-row" data-act="loans"><span>📚</span><span>Ver préstamos${prestados > 0 ? ` (${prestados})` : ''}</span></button>
      <button type="button" class="btn-row" data-act="import">📥 Importar manualmente</button>
      <button type="button" class="btn-row" data-act="export-json">💾 Exportar JSON</button>
      <button type="button" class="btn-row" data-act="export-csv">📊 Exportar CSV</button>
      <button type="button" class="btn-row" data-act="filters">🎛️ Filtros avanzados</button>
      <button type="button" class="btn-row" data-act="theme">🎨 Cambiar tema</button>
      <button type="button" class="btn-row" data-act="print">🖨️ Imprimir vista actual</button>
      <button type="button" class="btn-row" data-act="legal"><span>⚖️</span><span>Términos y aviso legal</span></button>
      <div style="height:6px"></div>
      <button type="button" class="btn-row danger" data-act="clear">🗑️ Vaciar colección local</button>
      <div style="text-align:center;padding:20px 12px;font-size:.72rem;color:var(--muted);line-height:1.7;margin-top:10px;border-top:1px solid var(--line)">
        <div style="font-family:ui-monospace,monospace;font-weight:800;color:var(--accent);margin-bottom:6px">Discografía Viewer v${VERSION}</div>
        Visor de consulta del catálogo · Datos desde la lista cargada<br>
        Compatible con backups JSON anteriores y v7.0.x<br>
        <span style="color:var(--ok);font-weight:600;margin-top:4px;display:inline-block">🔒 100% legal — No descarga ni aloja contenido</span><br>
        <span style="opacity:.7;margin-top:4px;display:inline-block">© 2024-${new Date().getFullYear()} HDSystem IT · +54 9 11 4563-0851</span>
      </div>
    </div>
    <style>
    .btn-row{padding:16px 18px;background:var(--bg2);border:1px solid var(--line);border-radius:13px;color:var(--txt);font-size:.92rem;font-weight:600;cursor:pointer;text-align:left;font-family:inherit;display:flex;align-items:center;gap:10px;transition:.15s;width:100%}
    .btn-row:active{transform:scale(.98);background:var(--bg3)}
    .btn-row.accent{background:rgba(79,195,247,.1);border-color:rgba(79,195,247,.4);color:var(--accent)}
    .btn-row.danger{color:#ffb3b3;border-color:rgba(255,107,107,.35)}
    .btn-row.danger:active{background:rgba(255,107,107,.12)}
    .seg-btn{flex:0 0 auto;padding:9px 12px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--muted);font-size:.76rem;font-weight:600;cursor:pointer;font-family:inherit;transition:.15s}
    .seg-btn.on{background:rgba(79,195,247,.18);border-color:var(--accent);color:var(--accent)}
    .seg-btn:active{transform:scale(.96)}
    </style>`;
  main.querySelectorAll('.btn-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.act;
      if (a === 'import') openImport();
      else if (a === 'sync') openSync();
      else if (a === 'sync-now') syncNow(true);
      else if (a === 'sync-force') syncNow(true, true);
      else if (a === 'backups') openBackups();
      else if (a === 'loans') openLoans();
      else if (a === 'export-json') exportJSON();
      else if (a === 'export-csv') exportCSV();
      else if (a === 'filters') openFilters();
      else if (a === 'theme') Theme.toggle();
      else if (a === 'print') window.print();
      else if (a === 'clear') clearCollection();
      else if (a === 'clean') manualCleanup();
      else if (a === 'legal') openLegal();
    });
  });
  main.querySelectorAll('.seg-btn[data-order]').forEach(btn => {
    btn.addEventListener('click', () => {
      App.order = btn.dataset.order;
      Prefs.set({ order: App.order });
      renderMore(main);
      Toast.show(`Ordenado por ${orderLabel()}`, 'ok', 1500);
    });
  });
}

async function manualCleanup(){
  const before = Storage.usage();
  const result = await Storage.fullCleanup();
  const after = Storage.usage();
  renderMore($('#moreBody'));
  const lines = [];
  if (result.removed.length) lines.push(`🗑️ ${result.removed.length} clave${result.removed.length === 1 ? '' : 's'} legacy eliminada${result.removed.length === 1 ? '' : 's'}`);
  if (result.swCount) lines.push(`📦 ${result.swCount} caché${result.swCount === 1 ? '' : 's'} de SW limpiada${result.swCount === 1 ? '' : 's'}`);
  if (result.freed > 0) lines.push(`✅ ${fmtBytes(result.freed)} liberados`);
  if (lines.length === 0) Toast.show('✨ Nada que limpiar — todo en orden', 'ok', 3000);
  else Toast.show(`🧹 ${lines.join(' · ')}`, 'ok', 5500);
}
async function bootCleanup(){
  try {
    const before = Storage.usage();
    const result = await Storage.fullCleanup();
    const after = Storage.usage();
    console.log(`%c🧹 Cleanup: liberados ${fmtBytes(result.freed)} (${result.removed.length} claves, ${result.swCount} SW caches) · Uso: ${before.pct}% → ${after.pct}%`, 'color:#5ddc9a;font-weight:bold');
    if (result.freed > 200 * 1024){ setTimeout(() => Toast.show(`🧹 Cache limpiada · ${fmtBytes(result.freed)} liberados`, 'ok', 3500), 1200); }
    else if (after.pct > 85){ setTimeout(() => Toast.show(`⚠️ Almacenamiento al ${after.pct}%. Considerá exportar y vaciar.`, 'warn', 6000), 1500); }
    return after;
  } catch(e){ console.warn('[bootCleanup]', e); return Storage.usage(); }
}

function openLoans(){
  const all = Store.allCDs().filter(Loans.isLoaned);
  if (!all.length){ Toast.show('No hay CDs prestados', 'info', 2000); return; }
  all.sort((a, b) => (a.fechaDevolucion || '9999').localeCompare(b.fechaDevolucion || '9999'));
  const body = $('#moreBody');
  body.innerHTML = `
    <button type="button" class="btn-row" id="loansBack" style="margin-bottom:12px">← Volver al menú</button>
    <div style="font-size:.78rem;color:var(--muted);margin-bottom:12px;padding:8px 12px;background:rgba(255,169,77,.08);border-left:3px solid var(--warn);border-radius:8px">${all.length} CD${all.length === 1 ? '' : 's'} en préstamo</div>
    ${all.map(cd => {
      const ov = Loans.isOverdue(cd);
      return `<div class="card" data-id="${esc(cd.id)}" style="margin-bottom:8px">${cd.portada ? `<img class="cover" src="${esc(cd.portada)}" alt="">` : `<div class="ph">💿</div>`}<div class="info"><div class="title">${esc(cd.titulo)}</div><div class="artist">${esc(cd.interprete)}</div><div class="meta"><span class="nro">#${cd.nro}</span>${cd.prestadoA ? `<span>👤 ${esc(cd.prestadoA)}</span>` : ''}${cd.fechaDevolucion ? `<span style="${ov ? 'color:var(--danger);font-weight:700' : ''}">📅 ${esc(cd.fechaDevolucion)}${ov ? ' ⚠️' : ''}</span>` : ''}</div></div><span class="arrow">›</span></div>`;
    }).join('')}
  `;
  $('#moreModal').classList.add('on');
  body.querySelector('#loansBack')?.addEventListener('click', () => renderMore(body));
  body.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => {
      const cd = findCDById(el.dataset.id);
      if (cd){ closeMore(); setTimeout(() => openDetail(cd), 150); }
    });
  });
}

function updateNav(){ $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === App.tab)); }
function bindNav(){
  $$('nav button').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.tab === 'more'){ openMore(); return; }
      if (App.tab === b.dataset.tab) return;
      App.tab = b.dataset.tab;
      Prefs.set({ tab: App.tab });
      updateNav();
      renderMain();
      $('#main').scrollTop = 0;
    });
  });
}
function findCDById(id){
  for (const k of Store.catKeys()){ const cd = Store.getCDs(k).find(c => c.id === id); if (cd) return cd; }
  return null;
}

function openDetail(cd){
  App.detailCD = cd;
  const cover = cd.portada ? `<img src="${esc(cd.portada)}" alt="Portada" id="detCover" style="cursor:zoom-in" onerror="this.outerHTML='<div class=\\'ph\\'>💿</div>'">` : `<div class="ph">💿</div>`;
  const secs = [];
  const ed = [['Formato', cd.formato],['Año álbum', cd.anio ? String(cd.anio) : ''],['Año edición', cd.anioEdicion ? String(cd.anioEdicion) : ''],['Sello', cd.sello],['Género', cd.genero],['Nº catálogo', cd.catalogo],['Código barras', cd.codigo],['ISRC', cd.isrc],['Edición', cd.edicion],['País', cd.pais]].filter(([, val]) => val);
  if (ed.length) secs.push({ t: '📀 Edición', c: ed });
  const fis = [['Estado general', cd.estado], ['Disco', cd.estadoDisco], ['Caja', cd.estadoCaja], ['Folleto', cd.estadoFolleto], ['Arte', cd.estadoArte]].filter(([, val]) => val);
  if (fis.length) secs.push({ t: '🔍 Estado físico', c: fis });
  const ubi = [['Ubicación', cd.ubicacion], ['Cantidad', cd.cantidad > 1 ? cd.cantidad : null], ['Fecha ingreso', cd.adquisicion], ['Valor', cd.valor != null ? `${cd.moneda || 'ARS'} ${Number(cd.valor).toLocaleString('es-AR')}` : null]].filter(([, val]) => val);
  if (ubi.length) secs.push({ t: '📍 Ubicación y valor', c: ubi });
  if (Loans.isLoaned(cd)){
    const pr = [['Prestado a', cd.prestadoA], ['Fecha préstamo', cd.fechaPrestamo], ['Fecha devolución', cd.fechaDevolucion], ['Notas', cd.notasPrestamo]].filter(([, val]) => val);
    secs.push({ t: '📚 Préstamo', c: pr, loan: true, overdue: Loans.isOverdue(cd) });
  }
  const cf = cd.customFields || {};
  const cfVals = [];
  for (const key in cf){ if (cf[key] !== '' && cf[key] != null) cfVals.push([CustomFields.label(key), cf[key]]); }
  if (cfVals.length) secs.push({ t: '📝 Personalizados', c: cfVals });
  const galImgs = [];
  if (cd.imagenes){
    const labels = { frontal: 'Frontal', trasera: 'Trasera', interior: 'Interior', disco: 'Disco', libreto: 'Libreto' };
    for (const k of ['frontal', 'trasera', 'interior', 'disco', 'libreto']){ if (cd.imagenes[k]) galImgs.push({ key: k, url: cd.imagenes[k], label: labels[k] }); }
  }
  const galHTML = galImgs.length > 1 ? `<div class="sec"><div class="sec-h">🖼️ Galería</div><div class="gallery">${galImgs.map(g => `<div class="gal-item" data-gal="${esc(g.url)}" data-gal-lbl="${esc(g.label)}"><img src="${esc(g.url)}" alt="${esc(g.label)}" loading="lazy" onerror="this.parentElement.style.display='none'"><span class="lbl">${esc(g.label)}</span></div>`).join('')}</div></div>` : '';
  const ratingHTML = cd.rating > 0 ? `<div class="sec"><div class="sec-h">⭐ Valoración</div><div class="det-rate">${'★'.repeat(cd.rating)}${'☆'.repeat(5 - cd.rating)}</div></div>` : '';
  const favHTML = cd.favorito ? `<div class="sec"><div class="sec-h">⭐ Favorito</div><div style="color:var(--accent2);font-size:.9rem">★ Marcado como favorito</div></div>` : '';
  const tagsHTML = (cd.tags && cd.tags.length) ? `<div class="sec"><div class="sec-h">🏷️ Etiquetas</div><div class="det-tags">${cd.tags.map(t => `<span class="det-tag">#${esc(t)}</span>`).join('')}</div></div>` : '';
  const enrichHTML = cd.enrichmentSource ? `<div style="padding:10px 14px;background:rgba(79,195,247,.06);border-left:3px solid var(--accent);border-radius:8px;font-size:.72rem;color:var(--muted);margin-bottom:14px">📌 Fuente registrada: <b style="color:var(--accent)">${esc(cd.enrichmentSource)}</b>${cd.enrichmentConfidence != null ? ` · <b>${cd.enrichmentConfidence}%</b>` : ''}</div>` : '';
  $('#detTitle').textContent = cd.titulo || 'Detalles';
  $('#detBody').innerHTML = `
    <div class="det-hero">
      ${cover}
      <div class="h-txt">
        <div class="h-t">${cd.favorito ? '★ ' : ''}${esc(cd.titulo || '—')}</div>
        ${cd.interprete ? `<div class="h-a" id="detArtChip">🎤 ${esc(cd.interprete)} ›</div>` : ''}
        <div class="h-m">
          <div class="n">Nº<b>${cd.nro ?? '—'}</b></div>
          <div>Año álbum<b>${cd.anio ?? '—'}</b></div>
          ${cd.anioEdicion ? `<div class="ed">Año edición<b>${cd.anioEdicion}</b></div>` : ''}
        </div>
        <div class="det-actions">
          <button type="button" class="det-act" id="detShare">📤 Compartir</button>
          ${cd.discogsId ? `<a class="det-act" href="https://www.discogs.com/release/${esc(cd.discogsId)}" target="_blank" rel="noopener">🔗 Discogs</a>` : ''}
        </div>
      </div>
    </div>
    ${renderStreamingSection(cd)}
    ${enrichHTML}
    ${ratingHTML}
    ${favHTML}
    ${tagsHTML}
    ${galHTML}
    ${secs.map(s => `
      <div class="sec">
        <div class="sec-h">${esc(s.t)}</div>
        ${s.loan ? `<div style="padding:11px 13px;background:${s.overdue ? 'rgba(255,107,107,.08)' : 'rgba(255,169,77,.08)'};border-left:4px solid ${s.overdue ? 'var(--danger)' : 'var(--warn)'};border-radius:10px;margin-bottom:10px;font-size:.78rem;color:${s.overdue ? 'var(--danger)' : 'var(--warn)'};font-weight:600">${s.overdue ? '⚠️ VENCIDO' : '📤 En préstamo'}</div>` : ''}
        <div class="sec-grid">${s.c.map(([k, val]) => `<div class="fld${String(val).length > 30 ? ' wide' : ''}"><span class="k">${esc(k)}</span><span class="v">${esc(String(val))}</span></div>`).join('')}</div>
      </div>`).join('')}
    ${cd.notas ? `<div class="sec"><div class="sec-h">📝 Observaciones</div><div class="notas">${esc(cd.notas)}</div></div>` : ''}
  `;
  $('#detModal').classList.add('on');
  document.body.style.overflow = 'hidden';
  wireStreamingSectionEvents();
  const img = $('#detCover');
  if (img) img.addEventListener('click', () => LB.open(cd.portada, `${cd.titulo} — ${cd.interprete}`));
  $('#detBody').querySelectorAll('.gal-item').forEach(el => {
    el.addEventListener('click', () => LB.open(el.dataset.gal, `${cd.titulo} — ${el.dataset.galLbl || ''}`));
  });
  const streamSection = $('#detBody .stream-section');
  if (streamSection) wireStreamingSectionEvents(streamSection, cd);
  $('#detArtChip')?.addEventListener('click', () => { closeDetail(); setTimeout(() => setArtistFilter(cd.interprete), 200); });
  $('#detShare')?.addEventListener('click', () => shareCD(cd));
}
function closeDetail(){ $('#detModal').classList.remove('on'); document.body.style.overflow = ''; }
async function shareCD(cd){
  const lines = [`💿 ${cd.titulo || '—'}`];
  if (cd.interprete) lines.push(`🎤 ${cd.interprete}`);
  if (cd.anio) lines.push(`📅 Álbum: ${cd.anio}`);
  if (cd.anioEdicion) lines.push(`📅 Edición: ${cd.anioEdicion}`);
  if (cd.sello) lines.push(`🏢 ${cd.sello}`);
  if (cd.formato) lines.push(`📀 ${cd.formato}`);
  if (cd.ubicacion) lines.push(`📍 ${cd.ubicacion}`);
  if (cd.links && cd.links.spotify && isSafeStreamUrl(cd.links.spotify)) lines.push(`🟢 Spotify: ${cd.links.spotify}`);
  if (cd.links && cd.links.youtube && isSafeStreamUrl(cd.links.youtube)) lines.push(`🔴 YouTube: ${cd.links.youtube}`);
  const text = lines.join('\n');
  const title = `${cd.titulo || 'CD'} — ${cd.interprete || ''}`;
  if (navigator.share){ try { await navigator.share({ title, text }); return; } catch(e){ if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); Toast.show('📋 Copiado al portapapeles', 'ok', 2200); }
  catch(e){ prompt('Copiá manualmente:', text); }
}

const LB = (() => {
  function open(url, title){
    if (!url) return;
    $('#lbImg').src = url;
    $('#lbInfo').textContent = title || '';
    $('#lbIdx').textContent = '1 / 1';
    $('#lb').classList.add('on');
  }
  function close(){ $('#lb').classList.remove('on'); $('#lbImg').src = ''; }
  return { open, close };
})();

function openImport(){ $('#impModal').classList.add('on'); }
function closeImport(){ $('#impModal').classList.remove('on'); }
function openPaste(){ $('#pasteArea').value = ''; $('#pasteModal').classList.add('on'); }
function closePaste(){ $('#pasteModal').classList.remove('on'); }
function openUrl(){ $('#urlInput').value = ''; $('#urlModal').classList.add('on'); }
function closeUrl(){ $('#urlModal').classList.remove('on'); }
function openFilters(){
  const f = App.filters;
  $('#flEstado').value = f.estado; $('#flFormato').value = f.formato;
  $('#flAnioD').value = f.anioD; $('#flAnioH').value = f.anioH;
  $('#flUbic').value = f.ubic; $('#flPort').value = f.port; $('#flPres').value = f.pres;
  const fls = $('#flStream'); if (fls) fls.value = f.stream || '';
  $('#flFav').checked = !!f.fav;
  $('#flRatingWrap').style.display = Store.hasAnyRatings() ? '' : 'none';
  $('#flFavWrap').style.display = Store.hasAnyFavs() ? '' : 'none';
  $('#flRating').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === (f.rating || '')));
  $('#filtModal').classList.add('on');
}
function closeFilters(){ $('#filtModal').classList.remove('on'); }
function openMore(){ renderMore($('#moreBody')); $('#moreModal').classList.add('on'); }
function closeMore(){ $('#moreModal').classList.remove('on'); }

function openSync(){
  $('#syncWebAppInput').value = Sync.getWebAppUrl();
  $('#syncAuto').checked = Sync.isAuto();
  renderSyncStatus();
  $('#syncModal').classList.add('on');
}
function closeSync(){ $('#syncModal').classList.remove('on'); }
function renderSyncStatus(){
  const box = $('#syncStatusBox');
  if (!Sync.isConfigured()){ box.innerHTML = ''; return; }
  const info = Sync.getInfo();
  const lastRef = info.lastSync || 0;
  const lastFile = info.lastFileName ? `<br><span style="font-size:.7rem;opacity:.8">Último: ${esc(info.lastFileName)}</span>` : '';
  box.innerHTML = `<div class="sync-status ok"><span>✅</span><div><b>Configurado (Apps Script)</b><br>Última sync: ${lastRef ? esc(fmtRel(lastRef)) : 'nunca'}${lastFile}</div></div>`;
}

/* ═══════════════════════════════════════════════════════════════
   AVISO LEGAL — v7.1.5 (fix completo)
   ═══════════════════════════════════════════════════════════════ */

function openLegal(force = false){
  const modal = $('#legalModal');
  if (!modal) return;

  // Si ya aceptó y no es forzado, mostrar con el check ya marcado
  if (legalAceptado() && !force){
    const chk = $('#legalAcepto');
    const btn = $('#legalAceptar');
    if (chk && btn){
      chk.checked = true;
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.textContent = '✓ Continuar';
    }
  } else {
    // Reset visual
    const chk = $('#legalAcepto');
    const btn = $('#legalAceptar');
    if (chk) chk.checked = false;
    if (btn){
      btn.disabled = true;
      btn.style.opacity = '.45';
      btn.style.cursor = 'not-allowed';
      btn.textContent = '✓ Aceptar y continuar';
    }
  }

  // Actualizar tag de versión y fecha en el header del modal
  const vTag = $('#legalVersionTag');
  const dTag = $('#legalDateTag');
  if (vTag) vTag.textContent = 'v' + VERSION;
  if (dTag) dTag.textContent = new Date().toLocaleDateString('es-AR', { year:'numeric', month:'long', day:'numeric' });

  // Mostrar modal y resetear scroll del body interno
  modal.classList.add('on');
  const body = $('#legalBody');
  if (body) body.scrollTop = 0;
}

function closeLegal(){
  const modal = $('#legalModal');
  if (modal) modal.classList.remove('on');
}

function legalAceptado(){
  try {
    return localStorage.getItem(LEGAL_NOTICE_KEY) === '1';
  } catch(e){ return false; }
}

function legalSignature(){
  try {
    const raw = localStorage.getItem(LEGAL_SIGNATURE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e){ return null; }
}

async function firmarAceptacionLegal(){
  const payload = [
    'v' + VERSION,
    String(Date.now()),
    navigator.userAgent || '',
    location.origin || 'file://',
    navigator.language || '',
    String(screen.width) + 'x' + String(screen.height)
  ].join('|');

  // Intento 1: SHA-256 vía WebCrypto (requiere contexto seguro)
  try {
    if (window.crypto?.subtle?.digest){
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
      return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2,'0'))
        .join('');
    }
  } catch(e){
    console.warn('[legal] crypto.subtle no disponible:', e.message);
  }

  // Fallback: hash simple determinista (solo para file://)
  let h1 = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++){
    h1 ^= payload.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return 'fnv1a_' + h1.toString(16).padStart(8, '0');
}

async function aceptarLegal(){
  const chk = $('#legalAcepto');
  const btn = $('#legalAceptar');

  if (chk && !chk.checked){
    Toast.show('⚠️ Marcá la casilla de aceptación primero', 'warn', 3000);
    return;
  }

  if (btn){
    btn.disabled = true;
    btn.textContent = '⏳ Registrando…';
  }

  const hash = await firmarAceptacionLegal();
  const firma = {
    hash,
    algo: hash.startsWith('fnv1a_') ? 'FNV-1a (fallback)' : 'SHA-256',
    version: VERSION,
    acceptedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    language: navigator.language || '',
    origin: location.origin || 'file://',
    screen: `${screen.width}x${screen.height}`,
    tz: (Intl.DateTimeFormat().resolvedOptions().timeZone) || ''
  };

  try {
    localStorage.setItem(LEGAL_NOTICE_KEY, '1');
    localStorage.setItem(LEGAL_SIGNATURE_KEY, JSON.stringify(firma));
    localStorage.setItem('discografia_legal_last_check', String(Date.now()));
  } catch(e){
    console.warn('[legal] No se pudo guardar la firma:', e);
    Toast.show('⚠️ No se pudo guardar la aceptación (localStorage lleno)', 'warn', 4500);
  }

  closeLegal();

  if (btn){
    btn.disabled = false;
    btn.textContent = '✓ Aceptar y continuar';
  }

  Toast.show(`✅ Aviso aceptado · Firma: ${hash.slice(0, 12)}…`, 'ok', 3500);
  console.log(`%c[Legal] ✅ Aceptado · ${firma.algo} · ${hash}`, 'color:#5ddc9a;font-weight:600');
}

function exportLegalPDF(){
  const fecha = new Date().toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' });
  const sig = legalSignature();

  const firmaTxt = sig
    ? `<div class="firma">
        <strong>🔐 Firma digital registrada</strong><br>
        Algoritmo: <code>${esc(sig.algo || 'SHA-256')}</code><br>
        Hash: <code>${esc(sig.hash)}</code><br>
        Aceptado: ${esc(new Date(sig.acceptedAt).toLocaleString('es-AR', { dateStyle:'long', timeStyle:'short' }))}<br>
        Versión: <code>${esc(sig.version)}</code><br>
        Origen: <code>${esc(sig.origin || '—')}</code><br>
        Dispositivo: <code>${esc(sig.userAgent || '—')}</code>
      </div>`
    : `<div class="firma" style="background:#fff3cd;border:1px solid #ffca28">
        <strong>⚠️ Sin firma registrada</strong><br>
        Este documento se generó antes de aceptar los términos.
      </div>`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Aviso Legal — Discografía Viewer v${VERSION}</title>
<style>
@page{size:A4;margin:20mm}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a2332;line-height:1.7;max-width:720px;margin:0 auto;padding:24px;background:#fff}
h1{color:#1976d2;margin:0 0 8px;font-size:1.6rem}
h2{margin:24px 0 10px;font-size:1.05rem;border-bottom:2px solid #d5dde7;padding-bottom:6px}
h2.ok{color:#2ea043}
h2.no{color:#d32f2f}
h2.info{color:#1976d2}
h2.warn{color:#e8a800}
.cabecera{text-align:center;margin-bottom:30px;padding-bottom:20px;border-bottom:2px solid #1976d2}
.cabecera p{margin:4px 0;color:#5a6b7f;font-size:.9rem}
.cabecera .badge{display:inline-block;background:#e8f5e9;color:#2ea043;border:1px solid #2ea043;padding:4px 12px;border-radius:20px;font-size:.8rem;font-weight:700;margin-top:8px}
ul{padding-left:22px}
li{margin:6px 0}
.firma{margin-top:30px;padding:14px;background:#f0f4f8;border-radius:8px;font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all;line-height:1.8;border-left:4px solid #1976d2}
.firma code{background:#fff;padding:2px 6px;border-radius:4px;border:1px solid #d5dde7}
.aviso{margin-top:24px;padding:12px 14px;background:#e8f5e9;border-left:4px solid #2ea043;border-radius:8px;font-size:.88rem}
.pie{margin-top:40px;padding-top:20px;border-top:1px solid #d5dde7;text-align:center;font-size:.75rem;color:#5a6b7f;line-height:1.8}
.botones{display:flex;gap:10px;justify-content:center;margin:30px 0}
.botones button{padding:12px 24px;border-radius:10px;border:1px solid #1976d2;background:#1976d2;color:#fff;font-size:1rem;font-weight:600;cursor:pointer;font-family:inherit}
.botones button.sec{background:#fff;color:#1976d2}
@media print{.botones{display:none}}
</style>
</head>
<body>
<div class="cabecera">
  <h1>⚖️ Aviso Legal y Términos de Uso</h1>
  <p><strong>Discografía Viewer v${VERSION}</strong></p>
  <p>Emitido el: ${esc(fecha)}</p>
  <div class="badge">🔒 Solo consulta · Sin descargas</div>
</div>

<p><strong>Discografía Viewer</strong> es un <strong>visor personal de catálogo musical</strong>. NO descarga, NO aloja, NO transmite y NO distribuye música ni contenido protegido por derechos de autor. Toda la información mostrada proviene exclusivamente de la lista <strong>.json</strong> que el usuario carga manualmente en este dispositivo.</p>

<h2 class="ok">✅ Lo que SÍ hace</h2>
<ul>
  <li>Mostrar la metadata de tu colección personal de CDs</li>
  <li>Leer y consultar la lista cargada (sin modificarla)</li>
  <li>Abrir enlaces externos ya guardados en la lista</li>
  <li>Buscar el álbum en plataformas oficiales (Spotify, Apple, YouTube, etc.)</li>
  <li>Exportar copias de seguridad JSON/CSV de tu propia lista</li>
</ul>

<h2 class="no">🚫 Lo que NO hace</h2>
<ul>
  <li>Descargar archivos de audio, video o imágenes protegidas</li>
  <li>Almacenar archivos multimedia en el dispositivo</li>
  <li>Saltar sistemas de pago, DRM o suscripciones</li>
  <li>Compartir archivos entre usuarios</li>
  <li>Abrir dominios no oficiales (bloqueo automático por lista blanca)</li>
  <li>Enviar tus datos a servidores externos (todo es local)</li>
</ul>

<h2 class="info">🔐 Privacidad y datos</h2>
<ul>
  <li>Todo se guarda en <strong>localStorage</strong> del navegador</li>
  <li>Si configurás Drive, tus backups van a <strong>tu propia cuenta</strong> de Google</li>
  <li>No hay analytics, no hay telemetría, no hay cookies de terceros</li>
  <li>Podés vaciar todo desde <strong>Más → Vaciar colección local</strong></li>
</ul>

<h2 class="warn">⚠️ Responsabilidad del usuario</h2>
<ul>
  <li>Sos el único responsable del origen y contenido de la lista que cargás</li>
  <li>Debés poseer los CDs originales o tener derecho legítimo sobre la información</li>
  <li>El uso indebido de enlaces externos es responsabilidad exclusiva del usuario</li>
  <li>El autor no se hace responsable por daños derivados del uso de esta herramienta</li>
</ul>

<p style="font-size:.85rem;color:#5a6b7f;margin-top:20px">Al tocar «Aceptar y continuar» declarás haber leído y comprendido estos términos, y aceptás que el uso de esta aplicación es bajo tu exclusiva responsabilidad.</p>

${firmaTxt}

<div class="aviso">
  <strong>⚠️ Importante:</strong> El usuario es responsable del origen y del uso de la información que carga en el visor. Esta aplicación no provee, aloja ni distribuye contenido protegido por derechos de autor.
</div>

<div class="botones">
  <button onclick="window.print()">🖨️ Guardar como PDF</button>
  <button class="sec" onclick="window.close()">Cerrar</button>
</div>

<div class="pie">
  © 2024-${new Date().getFullYear()} HDSystem IT · +54 9 11 4563-0851<br>
  Documento generado automáticamente por Discografía Viewer v${VERSION}<br>
  Hash de sesión: <code>${esc((sig?.hash || 'sin-firma').slice(0, 16))}…</code>
</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win){
    Toast.show('⚠️ Permitir ventanas emergentes para exportar el PDF', 'warn', 4000);
    return;
  }
  win.document.write(html);
  win.document.close();
  Toast.show('📄 Aviso legal abierto — usá «Guardar como PDF»', 'ok', 3000);
}

async function openBackups(){ $('#backupsModal').classList.add('on'); await loadBackupsList(); }
function closeBackups(){ $('#backupsModal').classList.remove('on'); }
async function loadBackupsList(){
  const body = $('#backupsBody');
  if (!Sync.isConfigured()){ body.innerHTML = `<div class="sync-status warn"><span>⚙️</span><div>Configurá la sincronización primero.</div></div>`; return; }
  const refreshTime = new Date().toLocaleTimeString('es-AR');
  body.innerHTML = `<div style="padding:30px 20px;text-align:center;color:var(--muted)"><div class="h-logo" style="margin:0 auto 12px"></div>Cargando backups…</div>`;
  try {
    const files = await Sync.listBackups();
    const info = Sync.getInfo();
    const lastFileName = info.lastFileName || '';
    body.innerHTML = `
      <div style="padding:10px 12px;background:rgba(79,195,247,.08);border-left:4px solid var(--accent);border-radius:10px;font-size:.78rem;line-height:1.5;margin-bottom:12px">
        <b>${files.length}</b> archivo${files.length === 1 ? '' : 's'} .json · lista actualizada a las <b>${esc(refreshTime)}</b>
        <div style="margin-top:6px;font-size:.7rem;color:var(--muted)">Ordenados por la <b>fecha del nombre</b>.</div>
      </div>
      ${files.map((f, idx) => {
        const isCurrent = f.name === lastFileName;
        const isNewest  = idx === 0;
        const ts = f._nameTs || f._modTs;
        const tsLabel = f._nameTs ? new Date(f._nameTs).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : new Date(f._modTs).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) + ' (subida)';
        return `<div class="backup-item${isCurrent ? ' current' : ''}">
          <div class="b-icon">${isCurrent ? '⭐' : isNewest ? '🏆' : '📄'}</div>
          <div class="b-info">
            <div class="b-name" title="${esc(f.name)}">${esc(f.name)}</div>
            <div class="b-date">${esc(tsLabel)} · ${esc(fmtRel(ts))}</div>
            <div class="b-size">${fmtBytes(f.size ? parseInt(f.size, 10) : 0)}${isCurrent ? ' · Importado actualmente' : ''}${isNewest && !isCurrent ? ' · 🏆 Más nuevo' : ''}</div>
          </div>
          <button type="button" class="b-load" data-load-id="${esc(f.id)}" data-load-name="${esc(f.name)}" data-load-ts="${f._nameTs || f._modTs}">${isCurrent ? '🔁 Re-importar' : '⬇️ Cargar'}</button>
        </div>`;
      }).join('')}`;
    body.querySelectorAll('.b-load').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.loadId;
        const name = btn.dataset.loadName;
        const ts = parseInt(btn.dataset.loadTs, 10) || 0;
        if (!confirm(`¿Cargar "${name}"?\n\nReemplazará tu colección local.`)) return;
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = '⏳…';
        try {
          const data = await Sync.download(id);
          const fileObj = files.find(f => f.id === id);
          closeBackups();
          importData(data, { skipConfirm: true });
          Sync.setInfo({ ...Sync.getInfo(), lastSync: Date.now(), lastFileName: name, lastFileTs: ts, lastModified: fileObj?._modTs || Date.now(), lastExportDate: data?.exported ? new Date(data.exported).getTime() : 0 });
          renderFreshness();
          Toast.show(`✅ Cargado: ${name}`, 'ok', 3500);
        } catch(err){
          Toast.show('Error: ' + err.message, 'err', 5500);
          btn.disabled = false;
          btn.textContent = orig;
        }
      });
    });
  } catch(err){
    body.innerHTML = `
      <div class="sync-status err"><span>🚨</span><div><b>Error al listar</b><br>${esc(err.message)}</div></div>
      <button type="button" id="backupsRetry" style="margin-top:12px;width:100%;padding:12px;border-radius:12px;background:rgba(79,195,247,.15);border:1px solid rgba(79,195,247,.4);color:var(--accent);font-weight:600;font-family:inherit;font-size:.88rem;cursor:pointer">🔄 Reintentar</button>
    `;
    $('#backupsRetry')?.addEventListener('click', loadBackupsList);
  }
}

let _syncing = false;
let _syncRetries = 0;
async function syncNow(interactive = false, force = false){
  if (!Sync.isConfigured()){ if (interactive){ Toast.show('Configurá la URL de Apps Script primero', 'warn', 3000); openSync(); } return; }
  if (_syncing){ if (interactive) Toast.show('⏳ Ya hay una sincronización en curso', 'info', 2000); return; }
  _syncing = true;
  const guard = setTimeout(() => { _syncing = false; }, 45000);
  const badge = $('#freshBadge');
  if (badge) badge.innerHTML = `<span class="h-fresh sync">🔄 Sincronizando…</span>`;
  const btn = $('#btnSync');
  if (btn) btn.classList.add('spin');
  let failed = false;
  try {
    const { data, file, total } = await Sync.pullLatest();
    if (!data) throw new Error('El archivo descargado está vacío');
    const info = Sync.getInfo();
    const lastFileName = info.lastFileName || '';
    const lastFileTs = info.lastFileTs || 0;
    const incomingNameTs = file._nameTs || 0;
    const incomingEffTs = file._effTs || file._modTs || 0;
    const nameChanged = incomingNameTs > 0 && file.name !== lastFileName;
    const tsAdvanced = incomingNameTs > 0 && incomingNameTs > lastFileTs;
    const noBaseline = lastFileTs === 0 && !lastFileName;
    const shouldImport = force || interactive || noBaseline || nameChanged || tsAdvanced;
    console.log(`%c[Sync] 📥 ${file.name}`, 'color:#4fc3f7;font-weight:600');
    console.log(`%c[Sync]    Decisión: ${shouldImport ? '✅ IMPORTAR' : '⏭️ SKIP'}`, `color:${shouldImport ? '#5ddc9a' : '#ffa94d'};font-weight:600`);
    if (!shouldImport){
      Sync.setInfo({ ...info, lastSync: Date.now() });
      renderFreshness();
      if (interactive) Toast.show('✓ Ya estás al día', 'info', 2200);
      return;
    }
    importData(data, { silent: !interactive, skipConfirm: true });
    Sync.setInfo({ ...info, lastSync: Date.now(), lastFileName: file.name, lastFileTs: incomingNameTs || incomingEffTs, lastModified: file._modTs || 0, lastExportDate: data?.exported ? new Date(data.exported).getTime() : 0 });
    renderFreshness();
    _syncRetries = 0;
    if (interactive) {
      const when = incomingNameTs ? new Date(incomingNameTs).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      Toast.show(`✅ Sincronizado: ${file.name}${when ? ` (${when})` : ''} · ${total} archivo${total === 1 ? '' : 's'}`, 'ok', 4000);
    }
  } catch(err){
    failed = true;
    console.warn('[Sync]', err);
    if (interactive) Toast.show('❌ ' + err.message, 'err', 7000);
    if (badge) badge.innerHTML = `<span class="h-fresh err" title="${esc(err.message)}">🚨 Error sync</span>`;
    if (navigator.onLine && _syncRetries < 3 && !interactive){
      _syncRetries++;
      const delay = Math.min(30000, 2000 * Math.pow(2, _syncRetries));
      setTimeout(() => syncNow(false), delay);
    }
  } finally {
    clearTimeout(guard);
    _syncing = false;
    if (btn) btn.classList.remove('spin');
    if (!failed) _syncRetries = 0;
  }
}
function maybeAutoSync(){
  if (!navigator.onLine) return;
  if (!Sync.isConfigured() || !Sync.isAuto()) return;
  const info = Sync.getInfo();
  const last = Math.max(info.lastSync || 0, info.lastImport || 0);
  const ageH = (Date.now() - last) / 3600000;
  if (ageH >= SYNC_STALE_HOURS) setTimeout(() => syncNow(false), 800);
}
function maybeForegroundSync(){
  if (document.hidden) return;
  if (!navigator.onLine) return;
  if (!Sync.isConfigured() || !Sync.isAuto()) return;
  const info = Sync.getInfo();
  const ageMin = (Date.now() - (info.lastSync || 0)) / 60000;
  if (ageMin >= SYNC_FOREGROUND_MIN) syncNow(false);
}

function handleFiles(files){
  if (!files || !files.length){ Toast.show('Sin archivo', 'warn'); return; }
  const f = files[0];
  const name = String(f.name || '').toLowerCase();
  const isJsonExt = name.endsWith('.json');
  const isJsonMime = f.type === 'application/json' || f.type === 'text/json' || f.type === 'application/octet-stream' || f.type === '';
  if (!isJsonExt && !isJsonMime){ if (!confirm(`"${f.name}" no parece ser .json.\n\n¿Intentar leerlo igual?`)) return; }
  const r = new FileReader();
  r.onerror = () => Toast.show('No se pudo leer el archivo', 'err');
  r.onload = e => {
    const txt = String(e.target.result || '').replace(/^\uFEFF/, '').trim();
    if (!txt){ Toast.show('El archivo está vacío', 'err', 4000); return; }
    const first = txt[0];
    if (first !== '{' && first !== '['){ Toast.show('El contenido no es JSON válido', 'err', 4500); return; }
    try { importData(JSON.parse(txt)); }
    catch(err){ Toast.show('JSON inválido: ' + err.message, 'err', 5500); }
  };
  r.readAsText(f, 'utf-8');
}

function importData(data, opts = {}){
  const silent = opts.silent === true;
  const skipConfirm = opts.skipConfirm === true;
  if (!data || typeof data !== 'object'){
    if (!silent) Toast.show('Formato no válido', 'err', 4500);
    return false;
  }
  if (Array.isArray(data.customFields)) CustomFields.mergeFromImport(data.customFields);

  if (!silent && !skipConfirm && !Store.isEmpty()){
    const ok = confirm('La importación reemplazará la copia LOCAL de la lista actualmente cargada.\n\nLos datos de origen no se modifican.\n\n¿Continuar?');
    if (!ok) return false;
  }

  let source;
  let summary = '';

  if (data.categories && typeof data.categories === 'object' && !Array.isArray(data.categories)){
    const keys = Object.keys(data.categories);
    if (!keys.length){
      if (!silent) Toast.show('La lista está vacía', 'warn', 4000);
      return false;
    }
    const total = keys.reduce((sum, k) => sum + (Array.isArray(data.categories[k]?.cds) ? data.categories[k].cds.length : 0), 0);
    source = data;
    summary = `${total} CDs · ${keys.length} categoría${keys.length === 1 ? '' : 's'}`;
  } else if (Array.isArray(data.cds)){
    if (!data.cds.length){
      if (!silent) Toast.show('La categoría está vacía', 'warn', 4000);
      return false;
    }
    const catKey = String(data.category || 'importada').trim() || 'importada';
    const label = String(data.label || catKey);
    const icon = String(data.icon || '📀');
    source = { ...data, categories: { [catKey]: { label, icon, cds: data.cds } } };
    summary = `${data.cds.length} CDs en "${label}"`;
  } else if (Array.isArray(data)){
    if (!data.length){
      if (!silent) Toast.show('La lista está vacía', 'warn', 4000);
      return false;
    }
    source = { categories: { importada: { label: 'Importada', icon: '📀', cds: data } } };
    summary = `${data.length} CDs`;
  } else if (data.titulo && (data.interprete || data.artist)){
    source = { categories: { importada: { label: 'Importada', icon: '📀', cds: [data] } } };
    summary = `"${String(data.titulo)}"`;
  } else {
    if (!silent) Toast.show('Formato no reconocido', 'err', 6000);
    return false;
  }

  Store.replaceAll(source);
  App.cat = ALL_CATS;
  App.artista = null;
  App.q = '';
  App.filters = { estado:'', formato:'', anioD:'', anioH:'', ubic:'', port:'', pres:'', rating:'', fav:false, stream:'' };
  const qEl = $('#q'); if (qEl) qEl.value = '';
  $('#searchBox')?.classList.remove('has','adv-mode');
  closeImport(); closePaste(); closeUrl();
  App.tab = 'list';
  Sync.setInfo({ ...Sync.getInfo(), lastImport: Date.now() });
  renderAll();
  if (!silent) Toast.show(`✅ ${summary} · Datos preservados`, 'ok', 3800);
  return true;
}

function exportJSON(){
  if (Store.isEmpty()){ Toast.show('Sin datos', 'warn'); return; }
  const base = JSON.parse(JSON.stringify(App.db || {}));
  const pl = {
    ...base,
    format: 'Discografía Viewer Backup',
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: VERSION,
    schemaVersion: DATA_SCHEMA_VERSION,
    exported: new Date().toISOString(),
    viewerOnly: true,
    categories: {}
  };
  for (const k of Store.catKeys()){
    const c = Store.get(k);
    pl.categories[k] = JSON.parse(JSON.stringify(c));
  }
  const cfIds = new Set();
  for (const cd of Store.allCDs()) for (const id in (cd.customFields || {})) cfIds.add(id);
  pl.customFields = [...cfIds].map(id => ({ id, name: CustomFields.label(id) }));
  download(`discografia_viewer_${stamp()}.json`, JSON.stringify(pl, null, 2), 'application/json');
  Toast.show(`📥 Backup JSON v${VERSION} exportado`, 'ok');
}

function exportCSV(){
  const cds = sortCDs(getVisibleCDs());
  if (!cds.length){ Toast.show('Sin datos visibles', 'warn'); return; }
  const sep = ';';
  const e = v => { const s = String(v ?? ''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Nº','Título','Intérprete','Año álbum','Año edición','Formato','Estado','Estado disco','Estado caja','Estado folleto','Estado arte','Sello','Género','País','Nº catálogo','Código barras','ISRC','Edición','Ubicación','Cantidad','Adquisición','Valor','Moneda','Rating','Favorito','Tags','Prestado a','Fecha préstamo','Fecha devolución','Notas préstamo','Enlaces JSON','Campos personalizados JSON','Notas'].join(sep)];
  for (const cd of cds){
    rows.push([
      cd.nro, cd.titulo, cd.interprete, cd.anio ?? '', cd.anioEdicion ?? '', cd.formato, cd.estado,
      cd.estadoDisco ?? '', cd.estadoCaja ?? '', cd.estadoFolleto ?? '', cd.estadoArte ?? '', cd.sello, cd.genero,
      cd.pais, cd.catalogo, cd.codigo, cd.isrc, cd.edicion, cd.ubicacion, cd.cantidad ?? '', cd.adquisicion ?? '',
      cd.valor ?? '', cd.moneda ?? '', cd.rating || '', cd.favorito ? 'Sí' : 'No', (cd.tags || []).join(' '),
      cd.prestadoA ?? '', cd.fechaPrestamo ?? '', cd.fechaDevolucion ?? '', cd.notasPrestamo ?? '',
      JSON.stringify(cd.links || {}), JSON.stringify(cd.customFields || {}), cd.notas ?? ''
    ].map(e).join(sep));
  }
  download(`discografia_viewer_${stamp()}.csv`, '\uFEFF' + rows.join('\r\n'), 'text/csv');
  Toast.show('📊 CSV exportado (vista actual)', 'ok');
}
function download(filename, content, mime){
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}
function stamp(){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
function clearCollection(){
  if (Store.isEmpty()){ Toast.show('Sin datos', 'warn'); return; }
  if (!confirm('¿Eliminar la copia LOCAL de la lista cargada? El archivo de origen/backup no se modifica.')) return;
  Store.clearAll();
  App.cat = ALL_CATS; App.artista = null; App.q = '';
  App.filters = { estado:'', formato:'', anioD:'', anioH:'', ubic:'', port:'', pres:'', rating:'', fav:false, stream:'' };
  $('#q').value = '';
  closeMore();
  renderAll();
  Storage.cleanupKeys();
  Toast.show('🗑️ Colección local vaciada', 'warn');
}

function showRecent(){
  const list = Recent.list();
  const el = $('#recent');
  if (!list.length){ el.classList.remove('on'); return; }
  el.innerHTML = `<div class="rh"><span>🕐 Búsquedas recientes</span><button type="button" id="recentClear">Limpiar</button></div>` + list.map(q => `<button type="button" class="ri" data-recent="${esc(q)}"><span class="ri-ico">🔍</span><span class="ri-txt">${esc(q)}</span></button>`).join('');
  el.classList.add('on');
  el.querySelector('#recentClear')?.addEventListener('click', (e) => { e.stopPropagation(); Recent.clear(); el.classList.remove('on'); });
  el.querySelectorAll('.ri').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.recent;
      const inp = $('#q'); inp.value = q;
      App.q = q;
      $('#searchBox').classList.add('has');
      updateAdvBadge(q);
      el.classList.remove('on');
      if (App.tab !== 'list' && App.tab !== 'grid'){ App.tab = 'list'; updateNav(); }
      renderMain();
    });
  });
}
function updateAdvBadge(q){ const sb = $('#searchBox'); if (sb) sb.classList.toggle('adv-mode', Search.isAdvanced(q)); }

function renderAll(){
  renderCats();
  renderMain();
  updateNav();
  renderFreshness();
  const total = Store.total();
  const cats = Store.catKeys().length;
  const nF = countActiveFilters();
  let sub = Store.isEmpty() ? 'Sin datos cargados' : `${total} CD${total === 1 ? '' : 's'} · ${cats} categoría${cats === 1 ? '' : 's'}`;
  if (nF > 0 && !Store.isEmpty()) sub += ` · ${nF} filtro${nF === 1 ? '' : 's'}`;
  $('#sub').textContent = sub;
  const btnSync = $('#btnSync');
  if (btnSync) btnSync.style.display = Sync.isConfigured() ? '' : 'none';
}

function bind(){
  const q = $('#q');
  const runSearch = debounce(() => {
    App.q = q.value;
    if (App.tab !== 'list' && App.tab !== 'grid'){ App.tab = 'list'; updateNav(); }
    renderMain();
  }, 140);
  q.addEventListener('input', () => {
    $('#searchBox').classList.toggle('has', q.value.length > 0);
    updateAdvBadge(q.value);
    runSearch();
  });
  q.addEventListener('focus', () => { if (!q.value) showRecent(); else $('#recent')?.classList.remove('on'); });
  q.addEventListener('blur', () => setTimeout(() => $('#recent')?.classList.remove('on'), 220));
  q.addEventListener('keydown', e => { if (e.key === 'Enter'){ Recent.add(q.value); $('#recent')?.classList.remove('on'); q.blur(); } });
  $('#clrQ').addEventListener('click', () => {
    q.value = ''; App.q = '';
    $('#searchBox').classList.remove('has','adv-mode');
    $('#recent')?.classList.remove('on');
    renderMain(); q.focus();
  });
  $('#btnTheme').addEventListener('click', () => Theme.toggle());
  $('#btnImportTop').addEventListener('click', () => openImport());
  $('#btnSync').addEventListener('click', () => syncNow(true));
  $('#impClose').addEventListener('click', closeImport);
  $('#impModal').addEventListener('click', e => { if (e.target.id === 'impModal') closeImport(); });
  $('#btnPickFile').addEventListener('click', () => $('#fileInp').click());
  $('#fileInp').addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });
  $('#btnPaste').addEventListener('click', () => { closeImport(); openPaste(); });
  $('#btnUrl').addEventListener('click', () => { closeImport(); openUrl(); });
  const dz = $('#dropZone');
  if (dz){
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; dz.style.background = 'rgba(79,195,247,.08)'; });
    dz.addEventListener('dragleave', () => { dz.style.borderColor = 'var(--line)'; dz.style.background = ''; });
    dz.addEventListener('drop', e => { e.preventDefault(); dz.style.borderColor = 'var(--line)'; dz.style.background = ''; handleFiles(e.dataTransfer?.files); });
  }
  $('#pasteClose').addEventListener('click', closePaste);
  $('#pasteCancel').addEventListener('click', closePaste);
  $('#pasteModal').addEventListener('click', e => { if (e.target.id === 'pasteModal') closePaste(); });
  $('#pasteOK').addEventListener('click', () => {
    const txt = $('#pasteArea').value.trim();
    if (!txt){ Toast.show('Pegá el JSON primero', 'warn'); return; }
    try { importData(JSON.parse(txt.replace(/^\uFEFF/, ''))); }
    catch(err){ Toast.show('JSON inválido: ' + err.message, 'err', 5000); }
  });
  $('#urlClose').addEventListener('click', closeUrl);
  $('#urlCancel').addEventListener('click', closeUrl);
  $('#urlModal').addEventListener('click', e => { if (e.target.id === 'urlModal') closeUrl(); });
  $('#urlOK').addEventListener('click', async () => {
    const u = $('#urlInput').value.trim();
    if (!u){ Toast.show('Ingresá una URL', 'warn'); return; }
    const btn = $('#urlOK'); const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ Descargando…';
    try {
      const r = await fetch(u, { mode: 'cors', cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      closeUrl(); importData(data);
    } catch(err){ Toast.show('Error: ' + err.message, 'err', 5000); }
    finally { btn.disabled = false; btn.textContent = orig; }
  });
  $('#filtClose').addEventListener('click', closeFilters);
  $('#filtCancel').addEventListener('click', closeFilters);
  $('#filtModal').addEventListener('click', e => { if (e.target.id === 'filtModal') closeFilters(); });
  $('#flRating').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    $('#flRating').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  $('#filtApply').addEventListener('click', () => {
    const activeRatingBtn = $('#flRating').querySelector('button.on');
    App.filters = {
      estado: $('#flEstado').value, formato: $('#flFormato').value,
      anioD: $('#flAnioD').value, anioH: $('#flAnioH').value,
      ubic: $('#flUbic').value, port: $('#flPort').value, pres: $('#flPres').value,
      stream: $('#flStream')?.value || '',
      rating: activeRatingBtn?.dataset.v || '', fav: $('#flFav').checked
    };
    closeFilters();
    if (App.tab !== 'list' && App.tab !== 'grid'){ App.tab = 'list'; updateNav(); }
    renderMain();
    Toast.show('Filtros aplicados', 'ok', 1500);
  });
  $('#filtClear').addEventListener('click', () => {
    App.filters = { estado:'', formato:'', anioD:'', anioH:'', ubic:'', port:'', pres:'', rating:'', fav:false, stream:'' };
    $('#flEstado').value = ''; $('#flFormato').value = '';
    $('#flAnioD').value = ''; $('#flAnioH').value = '';
    $('#flUbic').value = ''; $('#flPort').value = ''; $('#flPres').value = '';
    const fls = $('#flStream'); if (fls) fls.value = '';
    $('#flFav').checked = false;
    $('#flRating').querySelectorAll('button').forEach(x => x.classList.remove('on'));
    renderMain();
    Toast.show('Filtros quitados', 'info', 1200);
  });
  $('#detClose').addEventListener('click', closeDetail);
  $('#detModal').addEventListener('click', e => { if (e.target.id === 'detModal') closeDetail(); });
  $('#lbX').addEventListener('click', () => LB.close());
  $('#lb').addEventListener('click', e => { if (e.target.id === 'lb') LB.close(); });
  $('#moreClose').addEventListener('click', closeMore);
  $('#moreModal').addEventListener('click', e => { if (e.target.id === 'moreModal') closeMore(); });
  $('#syncClose').addEventListener('click', closeSync);
  $('#syncCancel').addEventListener('click', closeSync);
  $('#syncModal').addEventListener('click', e => { if (e.target.id === 'syncModal') closeSync(); });

  $('#syncSave').addEventListener('click', async () => {
    const url = $('#syncWebAppInput').value.trim();
    if (!url){ Toast.show('Pegá la URL de Apps Script', 'warn'); return; }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/.test(url)){
      Toast.show('❌ URL inválida. Debe empezar con https://script.google.com/macros/s/ y terminar en /exec', 'err', 7000);
      return;
    }
    Sync.setWebAppUrl(url);
    Sync.setAuto($('#syncAuto').checked);
    const btn = $('#syncSave'); const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '🔎 Probando…';
    try {
      const r = await Sync.testConnection();
      Toast.show(`✅ Conectado · ${r.count} backup${r.count === 1 ? '' : 's'} encontrado${r.count === 1 ? '' : 's'}`, 'ok', 3500);
      closeSync();
      Sync.setInfo({ ...Sync.getInfo(), lastFileName: '', lastFileTs: 0, lastModified: 0 });
      syncNow(false);
      renderMore($('#moreBody'));
    } catch(e){
      Toast.show('❌ ' + e.message, 'err', 7000);
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  });

  $('#btnCopyGas')?.addEventListener('click', async () => {
    const pre = $('#gasCodeBlock');
    const txt = pre ? pre.textContent : '';
    if (!txt){ Toast.show('No hay código para copiar', 'warn'); return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(txt);
      } else {
        const ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      Toast.show('📋 Código copiado — pegalo en script.google.com', 'ok', 3500);
    } catch(err){
      Toast.show('No se pudo copiar: ' + err.message, 'err', 4000);
    }
  });
  $('#syncDiag')?.addEventListener('click', async () => {
    const url = $('#syncWebAppInput').value.trim();
    if (!url){ Toast.show('Pegá la URL primero', 'warn'); return; }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/.test(url)){
      Toast.show('❌ URL inválida. Debe terminar en /exec', 'err', 6000);
      return;
    }
    const btn = $('#syncDiag'); const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '🔎 Probando…';
    try {
      const t0 = performance.now();
      const cb = Date.now();
      const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}action=list&_cb=${cb}`, { cache: 'no-store' });
      const elapsed = Math.round(performance.now() - t0);
      if (!r.ok) throw new Error(`HTTP ${r.status} en ${elapsed}ms`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      const files = data.files || [];
      const msg = `✅ Conexión OK (${elapsed}ms) · ${files.length} archivo${files.length === 1 ? '' : 's'} .json${files.length ? ` · Más nuevo: ${files[0].name}` : ''}`;
      Toast.show(msg, files.length ? 'ok' : 'warn', 6000);
      console.log('[Diag] Respuesta:', data);
    } catch(e){
      Toast.show('❌ ' + e.message, 'err', 8000);
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  });

  $('#backupsClose').addEventListener('click', closeBackups);
  $('#backupsCancel').addEventListener('click', closeBackups);
  $('#backupsModal').addEventListener('click', e => { if (e.target.id === 'backupsModal') closeBackups(); });
  $('#backupsRefresh').addEventListener('click', loadBackupsList);
  $('#backupsForceSync')?.addEventListener('click', async () => {
    closeBackups();
    Toast.show('⬇️ Forzando sincronización…', 'info', 2000);
    await syncNow(true, true);
  });
  $('#legalClose').addEventListener('click', closeLegal);
  $('#legalAceptar').addEventListener('click', aceptarLegal);
  $('#legalPDF').addEventListener('click', exportLegalPDF);
  $('#legalModal').addEventListener('click', e => { if (e.target.id === 'legalModal') closeLegal(); });
  const chkLegal = $('#legalAcepto');
  const btnAceptar = $('#legalAceptar');
  if (chkLegal && btnAceptar){
    chkLegal.addEventListener('change', () => {
      btnAceptar.disabled = !chkLegal.checked;
      btnAceptar.style.opacity = chkLegal.checked ? '1' : '.45';
      btnAceptar.style.cursor = chkLegal.checked ? 'pointer' : 'not-allowed';
    });
  }
  const main = $('#main');
  main.addEventListener('scroll', () => {
    const fab = $('#fabTop');
    if (!fab) return;
    fab.classList.toggle('on', main.scrollTop > 400);
  });
  $('#fabTop').addEventListener('click', () => main.scrollTo({ top: 0, behavior: 'smooth' }));
  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
  document.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    if (e.target.closest?.('#dropZone') || e.target.closest?.('#empDrop')) return;
    handleFiles(e.dataTransfer?.files);
  });

  /* Back button Android (Capacitor/Cordova) — SIN pushState */
  document.addEventListener('backbutton', (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    handleBackButton();
  }, false);

  /* Escape (desktop) */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (isOpen('#lb')){ LB.close(); return; }
    if (isOpen('#detModal')){ closeDetail(); return; }
    if (isOpen('#impModal')){ closeImport(); return; }
    if (isOpen('#pasteModal')){ closePaste(); return; }
    if (isOpen('#urlModal')){ closeUrl(); return; }
    if (isOpen('#filtModal')){ closeFilters(); return; }
    if (isOpen('#moreModal')){ closeMore(); return; }
    if (isOpen('#syncModal')){ closeSync(); return; }
    if (isOpen('#backupsModal')){ closeBackups(); return; }
    if (isOpen('#legalModal')){ closeLegal(); return; }
    if (App.q){ App.q = ''; $('#q').value = ''; $('#searchBox').classList.remove('has','adv-mode'); renderMain(); return; }
    if (App.artista){ App.artista = null; renderAll(); }
  });

  window.addEventListener('online', () => {
    Toast.show('🟢 Conexión restaurada', 'ok', 2000);
    if (Sync.isConfigured() && Sync.isAuto()){
      const info = Sync.getInfo();
      if ((Date.now() - (info.lastSync || 0)) / 3600000 >= 1) syncNow(false);
    }
  });
  window.addEventListener('offline', () => Toast.show('🔴 Sin conexión', 'warn', 3000));
  document.addEventListener('visibilitychange', maybeForegroundSync);
}

function handleBackButton(){
  if (isOpen('#lb')){ LB.close(); return; }
  if (isOpen('#detModal')){ closeDetail(); return; }
  if (isOpen('#impModal')){ closeImport(); return; }
  if (isOpen('#pasteModal')){ closePaste(); return; }
  if (isOpen('#urlModal')){ closeUrl(); return; }
  if (isOpen('#filtModal')){ closeFilters(); return; }
  if (isOpen('#moreModal')){ closeMore(); return; }
  if (isOpen('#syncModal')){ closeSync(); return; }
  if (isOpen('#backupsModal')){ closeBackups(); return; }
  if (isOpen('#legalModal')){ closeLegal(); return; }
  /* Si no hay modales abiertos, el sistema cierra la app (comportamiento nativo) */
}

function injectManifest(){
  try {
    const manifest = {
      name: 'Discografía Viewer', short_name: 'Discografía',
      description: 'Consulta la información de tu lista de CDs cargada localmente',
      start_url: location.href, scope: location.href,
      display: 'standalone', background_color: '#0e1116',
      theme_color: '#4fc3f7', orientation: 'portrait',
      icons: [{
        src: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4fc3f7"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs><circle cx="256" cy="256" r="240" fill="url(#g)"/><circle cx="256" cy="256" r="90" fill="#0e1116"/><circle cx="256" cy="256" r="30" fill="#4fc3f7"/></svg>`),
        sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable'
      }]
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('link');
    link.rel = 'manifest'; link.href = url;
    document.head.appendChild(link);
  } catch(e){}
}

/* ═══════════════════════════════════════════════════════════════
   GUARD: Reabrir el legal si el usuario intenta usar la app
   sin haber aceptado (bloqueo suave, no invasivo)
   ═══════════════════════════════════════════════════════════════ */
document.addEventListener('click', (e) => {
  // Solo aplicar si NO aceptó todavía
  if (legalAceptado()) return;
  // Ignorar clics dentro del propio modal legal
  if (e.target.closest('#legalModal')) return;
  // Ignorar clics en el botón de tema (permitir cambiar mientras lee)
  if (e.target.closest('#btnTheme')) return;
  // Cualquier otra interacción → reabrir el legal
  const modal = $('#legalModal');
  if (modal && !modal.classList.contains('on')){
    openLegal();
    Toast.show('⚖️ Aceptá el aviso legal para continuar', 'warn', 3000);
  }
}, true);

/* Si el usuario cierra el modal sin aceptar, reabrir a los 3 segundos */
document.addEventListener('click', (e) => {
  if (e.target.id === 'legalClose' || e.target.id === 'legalModal'){
    if (!legalAceptado()){
      setTimeout(() => {
        if (!legalAceptado()) openLegal();
      }, 3000);
    }
  }
});

/* ═══════════════════════════════════════════════════════════════
   INIT — v7.1.5 con fallback readyState + try/catch
   ═══════════════════════════════════════════════════════════════ */
async function init(){
  try {
    await bootCleanup();
    injectManifest();
    Theme.init();
    CustomFields.load();
    Store.load();
    const p = Prefs.get();
    if (p.cat) App.cat = p.cat;
    if (p.tab && p.tab !== 'more') App.tab = p.tab;
    if (p.order) App.order = p.order;
    if (p.artistsOrder) App.artistsOrder = p.artistsOrder;
    bindNav();
    bind();
    renderAll();
    const u = Storage.usage();
    console.log(`%c📱 Discografía Viewer v${VERSION} — Solo consulta (sin descargas)`, 'color:#4fc3f7;font-weight:bold;font-size:14px');
    console.log(`%c💾 Almacenamiento: ${fmtBytes(u.used)} (${u.pct}%)`, `color:${u.pct > 85 ? '#ff6b6b' : u.pct > 65 ? '#ffa94d' : '#5ddc9a'};font-weight:600`);
    console.log(`%c📋 Datos: la consulta usa exclusivamente la lista cargada`, 'color:#5ddc9a;font-weight:600');
    console.log(`%c© 2024-${new Date().getFullYear()} HDSystem IT · +54 9 11 4563-0851`, 'color:#a78bfa;font-weight:600');

    if (Sync.isConfigured()){
      if (Store.isEmpty()){
        setTimeout(() => syncNow(false), 600);
      } else {
        setTimeout(() => {
          const info = Sync.getInfo();
          const lastSync = info.lastSync || 0;
          const minSince = (Date.now() - lastSync) / 60000;
          if (minSince >= SYNC_ON_BOOT_MIN) syncNow(false);
          else console.log(`%c[Sync] ⏭️ Auto-sync skip: última sync hace ${Math.round(minSince)} min (umbral: ${SYNC_ON_BOOT_MIN} min)`, 'color:#8b97a8');
        }, 1500);
      }
      if (!Store.isEmpty()) Toast.show(`📚 ${Store.total()} CDs cargados`, 'ok', 2200);
    }

    // Aviso legal: se abre siempre al inicio si no fue aceptado
    if (!legalAceptado()){
      setTimeout(() => openLegal(), 1200);
      console.log('%c[Legal] ⚠️ Pendiente de aceptación — mostrando modal', 'color:#ffa94d;font-weight:600');
    } else {
      const sig = legalSignature();
      if (sig){
        console.log(`%c[Legal] ✅ Aceptado el ${new Date(sig.acceptedAt).toLocaleString('es-AR')} · ${sig.algo}`, 'color:#5ddc9a;font-weight:600');
      }
    }
    setInterval(renderFreshness, 60000);
  } catch(e){
    console.error('Error al inicializar:', e);
    const main = document.querySelector('main');
    if (main){
      main.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--muted)">
        <div style="font-size:3rem;margin-bottom:16px">⚠️</div>
        <h2 style="margin:0 0 8px;font-size:1.1rem;color:var(--danger)">Error al iniciar</h2>
        <p style="font-size:.85rem;line-height:1.55">${esc(e.message || 'Error desconocido')}</p>
        <button onclick="location.reload()" style="margin-top:20px;padding:12px 24px;border-radius:12px;background:rgba(79,195,247,.15);border:1px solid rgba(79,195,247,.4);color:var(--accent);font-weight:600;font-family:inherit;cursor:pointer">🔄 Recargar</button>
      </div>`;
    }
  }
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}