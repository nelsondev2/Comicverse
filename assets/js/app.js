/* Comicverse — application shell, navigation, shelves and boot */
(function (global) {
  'use strict';

  var App = {
    VERSION: '1.0.1',
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
    if (tab === App.currentTab && tab !== 'settings' && tab !== 'stats' && tab !== 'shelves') {
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
    if (tab === 'shelves') App.renderShelves();
    if (tab === 'stats') App.renderStats();
    if (tab === 'settings') Settings.render();
    if (tab === 'library') Library.render();
    var appbar = U.$('.appbar');
    if (appbar) {
      var searchBtn = U.$('#btnSearch'), layoutBtn = U.$('#btnLayout');
      var showTools = tab === 'library';
      searchBtn.style.display = showTools ? '' : 'none';
      layoutBtn.style.display = showTools ? '' : 'none';
      if (!showTools) Library.hideSearch();
    }
  };

  /* ---------------- shelves ---------------- */
  App.renderShelves = function () {
    var list = U.$('#shelfList');
    var smartList = U.$('#smartList');
    var empty = U.$('#shelfEmpty');
    var summary = U.$('#shelfSummary');
    if (!list || !smartList) return;

    var favs = Library.books.filter(function (b) { return b.favorite; }).length;
    var reading = Library.books.filter(function (b) { return !b.finished && b.page > 0; }).length;
    var done = Library.books.filter(function (b) { return b.finished; }).length;

    summary.innerHTML =
      '<div class="stat-tile"><b>' + Library.books.length + '</b><span>Cómics</span></div>' +
      '<div class="stat-tile"><b>' + Library.collections.length + '</b><span>Colecciones</span></div>' +
      '<div class="stat-tile"><b>' + favs + '</b><span>Favoritos</span></div>';

    var smart = [
      { id: 'favorites', name: 'Favoritos', sub: favs + (favs === 1 ? ' cómic' : ' cómics'), icon: 'heart', books: Library.books.filter(function (b) { return b.favorite; }) },
      { id: 'reading', name: 'En curso', sub: reading + (reading === 1 ? ' cómic' : ' cómics'), icon: 'clock', books: Library.books.filter(function (b) { return !b.finished && b.page > 0; }) },
      { id: 'finished', name: 'Terminados', sub: done + (done === 1 ? ' cómic' : ' cómics'), icon: 'check', books: Library.books.filter(function (b) { return b.finished; }) }
    ];

    list.innerHTML = '';
    smartList.innerHTML = '';
    smart.forEach(function (s) {
      var row = U.el('button', { class: 'shelf-card' });
      var covers = U.el('div', { class: 'shelf-card__covers' });
      s.books.slice(0, 3).forEach(function (b) {
        var c = U.el('div', { class: 'cvg' });
        var url = Library.coverUrlFor(b);
        if (url) c.innerHTML = '<img src="' + url + '" alt="" loading="lazy">';
        covers.appendChild(c);
      });
      if (!s.books.length) {
        covers.innerHTML = '<div class="cvg" style="display:grid;place-items:center;color:var(--faint)">' + U.icon(s.icon) + '</div>';
      }
      row.appendChild(covers);
      var body = U.el('div', { class: 'shelf-card__body' });
      body.innerHTML = '<div class="shelf-card__name">' + U.escape(s.name) + '</div><div class="shelf-card__meta">' + s.sub + '</div>';
      row.appendChild(body);
      row.appendChild(U.el('span', { class: 'shelf-card__go', html: U.icon('chevron') }));
      row.addEventListener('click', function () {
        Library.state.collection = null;
        Library.state.filter = s.id;
        Library.state.query = '';
        App.setTab('library');
        Library.render();
        U.toast('Estantería: ' + s.name, 'info', 1400);
      });
      smartList.appendChild(row);
    });

    Library.collections.forEach(function (col) {
      var books = Library.books.filter(function (b) { return (b.collections || []).indexOf(col.id) >= 0; });
      var row = U.el('button', { class: 'shelf-card' });
      var covers = U.el('div', { class: 'shelf-card__covers' });
      books.slice(0, 3).forEach(function (b) {
        var c = U.el('div', { class: 'cvg' });
        var url = Library.coverUrlFor(b);
        if (url) c.innerHTML = '<img src="' + url + '" alt="" loading="lazy">';
        covers.appendChild(c);
      });
      if (!books.length) covers.innerHTML = '<div class="cvg" style="display:grid;place-items:center;color:var(--faint)">' + U.icon('collection') + '</div>';
      row.appendChild(covers);
      var body = U.el('div', { class: 'shelf-card__body' });
      body.innerHTML = '<div class="shelf-card__name">' + U.escape(col.name) + '</div><div class="shelf-card__meta">' + books.length + (books.length === 1 ? ' cómic' : ' cómics') + '</div>';
      row.appendChild(body);
      var more = U.el('button', { class: 'icon-btn icon-btn--sm', 'aria-label': 'Opciones de la colección', html: U.icon('more') });
      more.addEventListener('click', function (e) {
        e.stopPropagation();
        openCollectionMenu(col);
      });
      row.appendChild(more);
      row.addEventListener('click', function () {
        Library.state.collection = col.id;
        Library.state.filter = 'all';
        App.setTab('library');
        Library.render();
        U.toast('Colección: ' + col.name, 'info', 1400);
      });
      list.appendChild(row);
    });

    empty.hidden = Library.collections.length > 0;
  };

  function openCollectionMenu(col) {
    var content = U.el('div', { class: 'sheet-menu' });
    var rename = U.el('button', { class: 'menu-item', html: U.icon('edit') });
    rename.appendChild(U.el('span', { class: 'menu-item__label', text: 'Renombrar' }));
    rename.addEventListener('click', function () {
      sheet.close();
      U.prompt({ title: 'Renombrar colección', label: 'Nombre', value: col.name }).then(function (name) {
        if (!name) return;
        col.name = name;
        DB.put('collections', col).then(function () { App.renderShelves(); U.toast('Colección renombrada', 'ok'); });
      });
    });
    content.appendChild(rename);
    var del = U.el('button', { class: 'menu-item menu-item--danger', html: U.icon('trash') });
    del.appendChild(U.el('span', { class: 'menu-item__label', text: 'Eliminar colección' }));
    del.addEventListener('click', async function () {
      sheet.close();
      var ok = await U.confirm({
        title: 'Eliminar colección',
        message: 'Los cómics no se borrarán, solo dejarán de estar en «' + col.name + '».',
        confirmText: 'Eliminar', danger: true
      });
      if (!ok) return;
      await DB.del('collections', col.id);
      Library.collections = Library.collections.filter(function (c) { return c.id !== col.id; });
      Library.books.forEach(function (b) {
        if ((b.collections || []).indexOf(col.id) >= 0) {
          b.collections = b.collections.filter(function (id) { return id !== col.id; });
          DB.put('books', b);
        }
      });
      if (Library.state.collection === col.id) Library.state.collection = null;
      App.renderShelves();
      Library.render();
      U.toast('Colección eliminada', 'ok');
    });
    content.appendChild(del);
    var sheet = U.sheet({ title: col.name, sub: 'Colección', content: content });
  }

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
    U.$('#btnNewCollection').addEventListener('click', function () { Library.createCollection(); });
    U.$('#btnNewCollection2').addEventListener('click', function () { Library.createCollection(); });
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
      App.renderShelves();
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
