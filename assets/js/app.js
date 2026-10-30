/* Comicverse — application shell, navigation and boot */
(function (global) {
  'use strict';

  var App = {
    VERSION: '1.1.0',
    settings: {
      theme: 'dark',
      accent: 'violet',
      layout: 'grid',
      wakeLock: true,
      syncProgress: true,
      welcomeSeen: false,
      reader: { mode: 'single', dir: 'ltr', fit: 'page', bg: 'black' }
    },
    currentTab: 'library'
  };

  var SETTINGS_KEY = 'app';

  var ACCENTS = {
    violet:  { accent: '#8b5cf6', strong: '#a78bfa', second: '#ec4899', light: { accent: '#6d3ff2', strong: '#5b27e0', second: '#db2777' } },
    blue:    { accent: '#3b82f6', strong: '#60a5fa', second: '#22d3ee', light: { accent: '#1d4ed8', strong: '#1e40af', second: '#0e7490' } },
    emerald: { accent: '#10b981', strong: '#34d399', second: '#84cc16', light: { accent: '#047857', strong: '#065f46', second: '#4d7c0f' } },
    amber:   { accent: '#f59e0b', strong: '#fbbf24', second: '#fb7185', light: { accent: '#b45309', strong: '#92400e', second: '#be123c' } },
    rose:    { accent: '#f43f5e', strong: '#fb7185', second: '#c084fc', light: { accent: '#be123c', strong: '#9f1239', second: '#7e22ce' } },
    graphite:{ accent: '#64748b', strong: '#94a3b8', second: '#a78bfa', light: { accent: '#475569', strong: '#334155', second: '#6d28d9' } }
  };
  App.ACCENTS = ACCENTS;

  App.applyAccent = function () {
    var key = App.settings.accent || 'violet';
    var c = ACCENTS[key] || ACCENTS.violet;
    var root = document.documentElement;
    var light = root.getAttribute('data-theme') === 'light';
    var variant = light && c.light ? c.light : c;
    root.style.setProperty('--accent', variant.accent);
    root.style.setProperty('--accent-strong', variant.strong);
    root.style.setProperty('--accent-2', variant.second);
    var rgb = U.hexToRgb(variant.accent);
    root.style.setProperty('--accent-soft', 'rgba(' + rgb.join(',') + ',' + (light ? 0.11 : 0.16) + ')');
    root.style.setProperty('--accent-soft-2', 'rgba(' + rgb.join(',') + ',' + (light ? 0.2 : 0.28) + ')');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && !light && key !== 'violet') meta.setAttribute('content', '#0a0a0f');
  };

  App.applyTheme = function () {
    var theme = App.settings.theme;
    var dark = theme === 'dark' || (theme === 'auto' && !(global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches));
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0a0a0f' : '#f4f3f9');
    App.applyAccent();
  };

  App.saveSetting = function (key, value) {
    App.settings[key] = value;
    DB.setSetting(SETTINGS_KEY, App.settings).catch(function (e) { console.warn(e); });
  };

  App.paintFavorite = function () {
    Library.render();
  };

  /* ---------------- navigation ---------------- */
  App.setTab = function (tab) {
    if (tab === App.currentTab && tab !== 'settings' && tab !== 'stats') {
      global.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    App.currentTab = tab;
    U.$$('.tab').forEach(function (b) {
      var on = b.getAttribute('data-tab') === tab;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    U.$$('.view').forEach(function (v) {
      v.classList.toggle('is-active', v.getAttribute('data-view') === tab);
    });
    var fab = U.$('#fabImport');
    if (fab) fab.hidden = tab === 'settings';
    global.scrollTo({ top: 0 });
    if (tab === 'stats') App.renderStats();
    if (tab === 'settings') Settings.render();
    if (tab === 'library') Library.render();
    var appbar = U.$('.appbar');
    if (appbar) {
      var searchBtn = U.$('#btnSearch'), menuBtn = U.$('#btnMenu');
      var showTools = tab === 'library';
      if (searchBtn) searchBtn.style.display = showTools ? '' : 'none';
      if (menuBtn) menuBtn.style.display = showTools ? '' : 'none';
      if (!showTools) Library.hideSearch();
    }
  };

  /* ---------------- libraries (playlists) ---------------- */
  /* La gestión vive en library.js; este alias mantiene la API histórica. */
  App.renderShelves = function () { Library.renderRail(); };

  App.renderStats = function () {
    if (global.Stats) Stats.render();
  };

  /* ---------------- webxdc updates ---------------- */
  function initChatSync() {
    WX.onUpdate(function (update) {
      if (!App.settings.syncProgress) return;
      var payloads = WX.unwrap(update);
      payloads.forEach(function (p) {
        if (!p || typeof p !== 'object') return;
        if (p.type === 'progress') {
          if (p.by && (p.by === WX.selfName || p.by === WX.selfAddr)) return;
          Library.applyRemoteProgress(p);
        } else if (p.type === 'finished') {
          if (p.by && (p.by === WX.selfName || p.by === WX.selfAddr)) return;
          U.toast((p.by || 'Alguien') + ' terminó «' + (p.title || 'un cómic') + '»', 'info', 3800);
        }
      });
    });
  }

  /* ---------------- drag & drop import (desktop) ---------------- */
  function initDragAndDrop() {
    var depth = 0;
    var hint = null;
    var hasFiles = function (e) {
      if (!e.dataTransfer) return false;
      var types = e.dataTransfer.types || [];
      for (var i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
      return false;
    };
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e) || Reader.isOpen()) return;
      e.preventDefault();
      depth++;
      if (depth !== 1) return;
      hint = U.el('div', { class: 'dropzone' });
      hint.innerHTML = U.icon('download') + '<b>Suelta tus cómics aquí</b><span>CBZ o PDF · se añaden a tu biblioteca local</span>';
      document.body.appendChild(hint);
      U.nextFrame().then(function () { if (hint) hint.classList.add('is-in'); });
    });
    window.addEventListener('dragover', function (e) {
      if (!hasFiles(e) || Reader.isOpen()) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function (e) {
      if (!hasFiles(e) && !hint) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0 && hint) { hint.remove(); hint = null; }
    });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e) || Reader.isOpen()) return;
      e.preventDefault();
      depth = 0;
      if (hint) { hint.remove(); hint = null; }
      var files = Array.prototype.slice.call(e.dataTransfer.files || []).filter(function (f) {
        return /\.(cbz|pdf|zip|cbr)$/i.test(f.name || '');
      });
      if (!files.length) { U.toast('Formato no compatible: usa CBZ o PDF', 'err'); return; }
      Library.importFiles(files);
    });
  }

  /* ---------------- onboarding ---------------- */
  function showWelcome() {
    var body = U.el('div');
    body.innerHTML =
      '<div style="text-align:center;padding:4px 0 18px">' +
        '<div style="width:74px;height:74px;margin:0 auto 14px;border-radius:22px;display:grid;place-items:center;background:linear-gradient(140deg,#a78bfa,#8b5cf6 50%,#db2777);box-shadow:0 16px 34px -16px rgba(139,92,246,.9)">' +
          '<svg viewBox="0 0 24 24" class="ico" style="width:36px;height:36px;stroke:#fff;stroke-width:1.6"><use href="#i-library"/></svg>' +
        '</div>' +
        '<h3 style="font-size:21px;font-weight:760;letter-spacing:-.03em">Bienvenido a Comicverse</h3>' +
        '<p class="muted" style="font-size:13px;line-height:1.55;margin-top:8px">Tu lector de cómics privado, dentro del chat y sin conexión.</p>' +
      '</div>' +
      '<div class="settings-group" style="padding:0 14px">' +
        '<div class="setting-row"><div class="setting-row__ico">' + U.icon('plus') + '</div><div class="setting-row__body"><div class="setting-row__title">Importa CBZ y PDF</div><div class="setting-row__sub">Desde el chat o desde tu dispositivo</div></div></div>' +
        '<div class="setting-row"><div class="setting-row__ico">' + U.icon('single') + '</div><div class="setting-row__body"><div class="setting-row__title">Lee como quieras</div><div class="setting-row__sub">Página, doble página o tira vertical, con zoom</div></div></div>' +
        '<div class="setting-row"><div class="setting-row__ico">' + U.icon('cloud') + '</div><div class="setting-row__body"><div class="setting-row__title">Progreso en tu chat</div><div class="setting-row__sub">Opcional, sin cuentas ni servidores</div></div></div>' +
      '</div>';
    var footer = U.el('div', { style: { display: 'flex', gap: '10px', width: '100%' } });
    var later = U.el('button', { class: 'btn btn--ghost', style: { flex: '1' }, text: 'Explorar' });
    var start = U.el('button', { class: 'btn btn--primary', style: { flex: '1.3' }, html: U.icon('plus') + ' Añadir cómics' });
    footer.appendChild(later); footer.appendChild(start);
    var sheet = U.sheet({ title: 'Comicverse', sub: 'v' + App.VERSION + ' · lector de cómics', content: body, footer: footer, dismissable: true });
    later.addEventListener('click', function () { sheet.close(); });
    start.addEventListener('click', function () { sheet.close(); setTimeout(function () { Library.importFiles(); }, 260); });
    App.saveSetting('welcomeSeen', true);
  }

  /* ---------------- boot ---------------- */
  App.init = function () {
    WX.init();
    App.settings = Object.assign({}, App.settings, {});
    App.applyTheme();

    var mql = global.matchMedia ? global.matchMedia('(prefers-color-scheme: light)') : null;
    if (mql && mql.addEventListener) {
      mql.addEventListener('change', function () { if (App.settings.theme === 'auto') App.applyTheme(); });
    }

    Library.init();
    Library.initSearch();
    Reader.init();
    initChatSync();

    U.$$('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () { App.setTab(btn.getAttribute('data-tab')); });
    });
    U.$('#btnNewLibrary').addEventListener('click', function () { Library.createLibrary(); });
    var appbar = U.$('.appbar');
    global.addEventListener('scroll', U.throttle(function () {
      if (appbar) appbar.classList.toggle('is-scrolled', global.scrollY > 4);
    }, 100), { passive: true });

    document.addEventListener('keydown', function (e) {
      if (Reader.isOpen && Reader.isOpen()) return;
      if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && App.currentTab === 'library') {
        if (document.activeElement && /input|textarea/i.test(document.activeElement.tagName)) return;
        e.preventDefault();
        U.$('#btnSearch').click();
      }
    });

    initDragAndDrop();

    // load persisted settings then paint everything
    DB.getSetting(SETTINGS_KEY, null).then(function (saved) {
      if (saved && typeof saved === 'object') {
        App.settings = Object.assign(App.settings, saved, {
          reader: Object.assign({}, App.settings.reader, saved.reader || {})
        });
      }
      App.applyTheme();
      return Library.refresh();
    }).then(function () {
      Library.state.layout = App.settings.layout === 'list' ? 'list' : 'grid';
      if (App.settings.sort) Library.state.sort = App.settings.sort;
      Library.render();
      App.renderStats();
      if (App.settings.theme === 'auto') App.applyTheme();
      if (!App.settings.welcomeSeen && Library.books.length === 0) {
        setTimeout(showWelcome, 420);
      }
      // Warm the DB persist permission (best effort, silent)
      DB.persist();
    }).catch(function (err) {
      console.error('[comicverse] boot', err);
      U.toast('No se pudo iniciar el almacenamiento local', 'err', 5000);
      Library.render();
    });

    // storage estimate refresh on settings view
    // (handled by Settings.render)

    console.log('%cComicverse v' + App.VERSION + ' · offline comic reader', 'color:#a78bfa;font-weight:600');
  };

  global.App = App;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', App.init);
  } else {
    App.init();
  }
})(window);
