/* Comicverse — library: import, browse, search, collections, details */
(function (global) {
  'use strict';

  var Library = {
    books: [],
    collections: [],
    state: { filter: 'all', sort: 'recent', query: '', layout: 'grid', collection: null },
    coverUrls: new Map()
  };

  var grid = null, emptyEl = null, chipsEl = null;

  /* ---------- helpers ---------- */
  Library.bookById = function (id) {
    return Library.books.find(function (b) { return b.id === id; }) || null;
  };

  Library.progressOf = function (book) {
    if (!book || !book.pageCount) return 0;
    if (book.finished) return 100;
    if (!book.lastReadAt && !book.page) return 0;
    return U.clamp(Math.round(((book.page + 1) / book.pageCount) * 100), 0, 100);
  };

  Library.statusOf = function (book) {
    if (book.finished) return 'finished';
    if (book.page > 0 || book.lastReadAt) return 'reading';
    return 'unread';
  };

  Library.coverUrlFor = function (book) { return coverUrlFor(book); };
  function coverUrlFor(book) {
    if (!book.cover) return '';
    var cached = Library.coverUrls.get(book.id);
    if (cached) return cached;
    var url = URL.createObjectURL(book.cover);
    Library.coverUrls.set(book.id, url);
    return url;
  }

  function releaseCover(bookId) {
    var url = Library.coverUrls.get(bookId);
    if (url) { URL.revokeObjectURL(url); Library.coverUrls.delete(bookId); }
  }

  function typeLabel(book) { return book.type === 'pdf' ? 'PDF' : 'CBZ'; }

  /* ---------- data ---------- */
  Library.load = async function () {
    var results = await Promise.all([DB.getAll('books'), DB.getAll('collections')]);
    Library.books = (results[0] || []).filter(Boolean);
    Library.collections = (results[1] || []).filter(Boolean);
    Library.books.forEach(function (b) {
      if (!Array.isArray(b.tags)) b.tags = [];
      if (!Array.isArray(b.collections)) b.collections = [];
    });
  };

  Library.refresh = async function () {
    await Library.load();
    Library.render();
  };

  /* ---------- rendering ---------- */
  function visibleBooks() {
    var q = U.fold(Library.state.query.trim());
    var list = Library.books.filter(function (b) {
      if (Library.state.collection && b.collections.indexOf(Library.state.collection) === -1) return false;
      var status = Library.statusOf(b);
      switch (Library.state.filter) {
        case 'reading': if (status !== 'reading') return false; break;
        case 'unread': if (status !== 'unread') return false; break;
        case 'finished': if (status !== 'finished') return false; break;
        case 'favorites': if (!b.favorite) return false; break;
        default: break;
      }
      if (!q) return true;
      var hay = U.fold([b.title, b.author, b.series, (b.tags || []).join(' '), b.publisher, b.year, b.type].join(' '));
      return hay.indexOf(q) >= 0;
    });
    var sort = Library.state.sort;
    list.sort(function (a, b) {
      if (sort === 'title') return U.naturalCompare(a.title, b.title);
      if (sort === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
      if (sort === 'pages') return (b.pageCount || 0) - (a.pageCount || 0);
      if (sort === 'progress') return Library.progressOf(b) - Library.progressOf(a);
      return (b.lastReadAt || 0) - (a.lastReadAt || 0) || (b.addedAt || 0) - (a.addedAt || 0);
    });
    return list;
  }

  function counts() {
    var c = { all: Library.books.length, reading: 0, unread: 0, finished: 0, favorites: 0 };
    Library.books.forEach(function (b) {
      var s = Library.statusOf(b);
      c[s]++;
      if (b.favorite) c.favorites++;
    });
    return c;
  }

  var FILTERS = [
    { id: 'all', label: 'Todos' },
    { id: 'reading', label: 'Leyendo' },
    { id: 'unread', label: 'Sin empezar' },
    { id: 'finished', label: 'Terminados' },
    { id: 'favorites', label: 'Favoritos' }
  ];

  function renderChips() {
    var c = counts();
    var html = FILTERS.map(function (f) {
      return '<button class="chip' + (Library.state.filter === f.id ? ' is-active' : '') + '" data-filter="' + f.id + '" role="tab" aria-selected="' + (Library.state.filter === f.id) + '">' +
        U.escape(f.label) + '<span class="chip__count">' + (c[f.id] || 0) + '</span></button>';
    }).join('');
    html += '<button class="chip chip--sort" data-sort-menu>' + U.icon('list') + sortLabel() + '</button>';
    chipsEl.innerHTML = html;
  }

  function sortLabel() {
    var map = { recent: 'Recientes', added: 'Añadidos', title: 'Título', pages: 'Páginas' };
    return map[Library.state.sort] || 'Recientes';
  }

  function coverMarkup(book, withFav) {
    var url = coverUrlFor(book);
    var pct = Library.progressOf(book);
    var status = Library.statusOf(book);
    var initial = U.escape(book.title.slice(0, 2).toUpperCase());
    var html = '<div class="cover">';
    if (url) {
      html += '<img src="' + url + '" alt="" loading="lazy" decoding="async" class="is-loaded">';
    } else {
      html += '<div class="cover__ph"><span>' + initial + '</span></div>';
    }
    html += '<span class="cover__badge">' + typeLabel(book) + '</span>';
    if (withFav && book.favorite) {
      html += '<span class="cover__fav is-on">' + U.icon('heart') + '</span>';
    }
    if (status === 'finished') {
      html += '<span class="cover__status">' + U.icon('check') + '</span>';
    } else if (pct > 0) {
      html += '<span class="cover__pct">' + pct + '%</span>';
    }
    if (pct > 0 && status !== 'finished') {
      html += '<div class="cover__progress"><span style="width:' + pct + '%"></span></div>';
    }
    html += '</div>';
    return html;
  }

  function bookCard(book) {
    var meta = libraryMeta(book);
    return '<article class="book-card" data-id="' + book.id + '">' +
      '<button class="book-card__hit" data-open="' + book.id + '" aria-label="' + U.escape('Abrir ' + book.title) + '">' +
      coverMarkup(book, true) +
      '<div class="book-card__info">' +
      '<div class="book-card__title">' + U.escape(book.title) + '</div>' +
      '<div class="book-card__meta">' + U.escape(meta) + '</div>' +
      '</div></button></article>';
  }

  function libraryMeta(book) {
    var parts = [];
    if (book.author) parts.push(book.author);
    if (book.year) parts.push(book.year);
    if (!parts.length) parts.push(book.pageCount + ' págs.');
    return parts.join(' · ');
  }

  function renderContinue() {
    var strip = U.$('#continueStrip'), rail = U.$('#continueRail');
    var list = Library.books.filter(function (b) {
      return !b.finished && b.page > 0 && Library.progressOf(b) > 0;
    }).sort(function (a, b) { return (b.lastReadAt || 0) - (a.lastReadAt || 0); }).slice(0, 8);
    if (!list.length) { strip.hidden = true; rail.innerHTML = ''; return; }
    strip.hidden = false;
    U.$('#continueCount').textContent = list.length + (list.length === 1 ? ' cómic' : ' cómics');
    rail.innerHTML = list.map(function (b) {
      var pct = Library.progressOf(b);
      var url = coverUrlFor(b);
      return '<button class="cont-card" data-open="' + b.id + '">' +
        '<span class="cont-card__cover">' + (url ? '<img src="' + url + '" alt="" loading="lazy">' : '') + '</span>' +
        '<span class="cont-card__body">' +
        '<span class="cont-card__title">' + U.escape(b.title) + '</span>' +
        '<span class="cont-card__meta">Página ' + (b.page + 1) + ' de ' + b.pageCount + ' · ' + pct + '%</span>' +
        '<span class="mini-progress"><span style="width:' + pct + '%"></span></span>' +
        '</span>' +
        '<span class="cont-card__go">' + U.icon('chevron') + '</span>' +
        '</button>';
    }).join('');
  }

  Library.renderContinue = function () { renderContinue(); };

  Library.render = function () {
    if (!grid) { grid = U.$('#libraryGrid'); emptyEl = U.$('#libraryEmpty'); chipsEl = U.$('#filterChips'); }
    var list = visibleBooks();
    var c = counts();
    U.$('#libraryCount').textContent = c.all ? c.all + (c.all === 1 ? ' cómic' : ' cómics') : '';
    var chipsHost = U.$('#filterChips');
    var fab = U.$('#fabImport');
    if (Library.books.length === 0) {
      emptyEl.hidden = false;
      grid.innerHTML = '';
      renderChips();
      if (chipsHost) chipsHost.hidden = true;
      if (fab) fab.hidden = true;
      renderContinue();
      return;
    }
    if (chipsHost) chipsHost.hidden = false;
    if (fab) fab.hidden = App.currentTab === 'settings';
    emptyEl.hidden = list.length > 0;
    if (!list.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' +
        '<div class="empty__art empty__art--sm">' + U.icon('search', 'ico--xl') + '</div>' +
        '<h3 class="empty__title">Sin resultados</h3>' +
        '<p class="empty__text">No hay cómics que coincidan con este filtro o búsqueda.</p>' +
        '<button class="btn btn--soft" data-clear-filters>Ver toda la biblioteca</button></div>';
    } else {
      grid.classList.toggle('is-list', Library.state.layout === 'list');
      grid.innerHTML = list.map(bookCard).join('');
    }
    renderChips();
    renderContinue();
  };

  /* ---------- interactions ---------- */
  function setTab(name) { if (global.App) global.App.setTab(name); }

  function openCollectionFilter(id) {
    Library.state.collection = id;
    Library.state.filter = 'all';
    Library.state.query = '';
    hideSearch();
    setTab('library');
    renderCollectionBanner();
    Library.render();
    U.$('#main').scrollTo ? U.$('#main').scrollTo(0, 0) : null;
    global.scrollTo(0, 0);
  }

  function renderCollectionBanner() {
    var existing = U.$('#collectionBanner');
    if (existing) existing.remove();
    if (!Library.state.collection) return;
    var col = Library.collections.find(function (c) { return c.id === Library.state.collection; });
    if (!col) { Library.state.collection = null; return; }
    var banner = U.el('div', { class: 'chip-row', id: 'collectionBanner', style: { paddingTop: '10px', paddingBottom: '0' } });
    banner.innerHTML = '<button class="chip is-active" data-collection-clear>' + U.icon('collection') + ' Colección: ' + U.escape(col.name) + U.icon('close') + '</button>';
    var chips = U.$('#filterChips');
    if (chips && chips.parentNode) chips.parentNode.insertBefore(banner, chips);
    banner.querySelector('[data-collection-clear]').addEventListener('click', function () {
      Library.state.collection = null;
      libraryClear(); 
    });
  }

  function libraryClear() {
    Library.state.collection = null;
    Library.state.filter = 'all';
    Library.state.query = '';
    hideSearch();
    renderCollectionBanner();
    Library.render();
  }

  function openBook(id) {
    var book = Library.bookById(id);
    if (!book) return;
    if (global.Reader) global.Reader.open(book);
  }

  /* long press / context menu */
  var pressTimer = null, pressedCard = null, longPressed = false;

  function bindGridEvents() {
    grid.addEventListener('click', function (e) {
      var openBtn = e.target.closest('[data-open]');
      if (openBtn && !longPressed) { openBook(openBtn.getAttribute('data-open')); return; }
      longPressed = false;
      var clear = e.target.closest('[data-clear-filters]');
      if (clear) { libraryClear(); }
    });
    grid.addEventListener('contextmenu', function (e) {
      var card = e.target.closest('[data-id]');
      if (!card) return;
      e.preventDefault();
      openQuickActions(card.getAttribute('data-id'));
    });
    var start = function (e) {
      var card = e.target.closest('[data-id]');
      if (!card) return;
      pressedCard = card.getAttribute('data-id');
      longPressed = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(function () {
        longPressed = true;
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
        openQuickActions(pressedCard);
      }, 520);
    };
    var cancel = function () { clearTimeout(pressTimer); };
    grid.addEventListener('pointerdown', start);
    grid.addEventListener('pointerup', cancel);
    grid.addEventListener('pointercancel', cancel);
    grid.addEventListener('pointermove', cancel);
  }

  function bindChips() {
    chipsEl.addEventListener('click', function (e) {
      var f = e.target.closest('[data-filter]');
      if (f) {
        Library.state.filter = f.getAttribute('data-filter');
        Library.render();
        return;
      }
      if (e.target.closest('[data-sort-menu]')) openSortSheet();
    });
  }

  function openSortSheet() {
    var options = [
      { id: 'recent', label: 'Última lectura', icon: 'clock' },
      { id: 'added', label: 'Añadidos recientemente', icon: 'plus' },
      { id: 'title', label: 'Título (A–Z)', icon: 'library' },
      { id: 'pages', label: 'Número de páginas', icon: 'file' },
      { id: 'progress', label: 'Progreso de lectura', icon: 'stats' }
    ];
    var content = U.el('div', { class: 'sheet-menu' });
    options.forEach(function (o) {
      var btn = U.el('button', { class: 'menu-item' + (Library.state.sort === o.id ? ' is-active' : ''), html: U.icon(o.icon) });
      btn.appendChild(U.el('span', { class: 'menu-item__label', text: o.label }));
      if (Library.state.sort === o.id) btn.appendChild(U.el('span', { class: 'badge-soft', text: 'Activo' }));
      btn.addEventListener('click', function () {
        Library.state.sort = o.id;
        if (global.App) App.saveSetting('sort', o.id);
        Library.render();
        sheet.close();
      });
      content.appendChild(btn);
    });
    var sheet = U.sheet({ title: 'Ordenar biblioteca', content: content });
  }

  function openQuickActions(id) {
    var book = Library.bookById(id);
    if (!book) return;
    var content = U.el('div', { class: 'sheet-menu' });
    var add = function (icon, label, onClick, danger, sub) {
      var b = U.el('button', { class: 'menu-item' + (danger ? ' menu-item--danger' : ''), html: U.icon(icon) });
      var wrap = U.el('span', { class: 'menu-item__label' });
      wrap.appendChild(document.createTextNode(label));
      if (sub) wrap.appendChild(U.el('small', { text: sub }));
      b.appendChild(wrap);
      b.addEventListener('click', function () { sheet.close(); setTimeout(onClick, 60); });
      content.appendChild(b);
    };
    add('library', book.page > 0 && !book.finished ? 'Continuar lectura' : 'Leer', function () { openBook(id); });
    add('info', 'Ver detalles', function () { openDetails(id); });
    add('heart', book.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', function () { toggleFavorite(book); });
    add('check', book.finished ? 'Marcar como no leído' : 'Marcar como leído', function () { toggleFinished(book); });
    add('collection', 'Añadir a colección', function () { openCollectionPicker(book); });
    add('share', 'Compartir en el chat', function () { exportBook(book); });
    add('trash', 'Eliminar', function () { deleteBook(book); }, true);
    var sheet = U.sheet({ title: book.title, sub: typeLabel(book) + ' · ' + book.pageCount + ' páginas', content: content });
  }

  /* ---------- actions ---------- */
  Library.toggleFavorite = function (book) {
    book.favorite = !book.favorite;
    DB.put('books', book).then(function () {
      Library.refresh();
      U.toast(book.favorite ? 'Añadido a favoritos' : 'Quitado de favoritos', 'ok');
      if (global.App) App.paintFavorite(book);
    });
  };
  var toggleFavorite = Library.toggleFavorite;

  Library.toggleFinished = function (book) {
    book.finished = !book.finished;
    if (book.finished) {
      book.page = book.pageCount - 1;
      book.lastReadAt = Date.now();
    } else {
      book.page = 0;
    }
    DB.put('books', book).then(function () {
      Library.refresh();
      U.toast(book.finished ? 'Marcado como leído' : 'Marcado como no leído', 'ok');
      if (global.App) App.paintFavorite(book);
    });
  };
  var toggleFinished = Library.toggleFinished;

  Library.openDetails = function (id) { openDetails(id); };
  var openDetails = function (id) {
    var book = Library.bookById(id);
    if (!book) return;
    var pct = Library.progressOf(book);
    var url = coverUrlFor(book);
    var body = U.el('div');

    body.innerHTML =
      '<div class="detail-head">' +
        '<div class="detail-cover">' + (url ? '<img src="' + url + '" alt="">' : '') + '</div>' +
        '<div class="detail-body">' +
          '<h3 class="detail-title">' + U.escape(book.title) + '</h3>' +
          '<div class="detail-sub">' + U.escape([
            book.series && book.series.toLowerCase() !== book.title.toLowerCase() ? book.series : '',
            book.author,
            book.year || ''
          ].filter(Boolean).join(' · ') || typeLabel(book) + ' · ' + book.pageCount + ' páginas') + '</div>' +
          '<div class="detail-stats">' +
            '<div class="detail-stat"><b>' + pct + '%</b><span>Leído</span></div>' +
            '<div class="detail-stat"><b>' + (book.page > 0 || book.finished ? (book.page + 1) : 0) + '</b><span>Página</span></div>' +
            '<div class="detail-stat"><b>' + U.formatDuration(book.readingTime || 0) + '</b><span>Tiempo</span></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-progress">' +
        '<div class="mini-progress"><span style="width:' + pct + '%"></span></div>' +
        '<div class="detail-progress__labels"><span>' + typeLabel(book) + ' · ' + U.formatBytes(book.size) + '</span><span>' + (book.finished ? 'Terminado' : 'Página ' + (book.page + 1) + ' de ' + book.pageCount) + '</span></div>' +
      '</div>' +
      '<div class="detail-actions">' +
        '<button class="btn btn--primary" data-act="read">' + U.icon('library') + (book.page > 0 && !book.finished ? 'Continuar' : 'Leer') + '</button>' +
        '<button class="btn btn--ghost" data-act="fav" aria-label="Favorito">' + U.icon('heart') + '</button>' +
        '<button class="btn btn--ghost" data-act="export" aria-label="Compartir">' + U.icon('share') + '</button>' +
        '<button class="btn btn--ghost" data-act="more" aria-label="Más opciones">' + U.icon('more') + '</button>' +
      '</div>' +
      '<div class="field"><label class="field__label" for="dt-title">Título</label><input class="input" id="dt-title" value="' + U.escape(book.title) + '"></div>' +
      '<div class="field-row">' +
        '<div class="field"><label class="field__label" for="dt-author">Autor</label><input class="input" id="dt-author" placeholder="Añadir autor" value="' + U.escape(book.author || '') + '"></div>' +
        '<div class="field"><label class="field__label" for="dt-series">Serie</label><input class="input" id="dt-series" placeholder="Añadir serie" value="' + U.escape(book.series || '') + '"></div>' +
      '</div>' +
      '<div class="field"><label class="field__label" for="dt-tags">Etiquetas</label><div class="tag-list" data-tags></div></div>' +
      '<div class="field"><label class="field__label" for="dt-notes">Notas</label><textarea class="textarea" id="dt-notes" placeholder="Notas personales, opinión…">' + U.escape(book.notes || '') + '</textarea></div>' +
      '<div class="detail-section">' +
        '<div class="detail-section__title">Colecciones</div>' +
        '<div class="tag-list" data-collections></div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<div class="detail-section__title">Marcadores</div>' +
        '<div data-bookmarks></div>' +
      '</div>' +
      (book.notes ? '<div class="detail-section"><div class="detail-section__title">Sinopsis</div><p class="muted" style="font-size:13px;line-height:1.55;margin:0">' + U.escape(book.notes).slice(0, 600) + '</p></div>' : '') +
      '<div class="detail-section">' +
        '<div class="detail-section__title">Información</div>' +
        (book.publisher ? '<div class="stat-row"><span>Editorial</span><b>' + U.escape(book.publisher) + '</b></div>' : '') +
        '<div class="stat-row"><span>Añadido</span><b>' + U.dateLabel(book.addedAt) + '</b></div>' +
        '<div class="stat-row"><span>Última lectura</span><b>' + (book.lastReadAt ? U.relativeTime(book.lastReadAt) : '—') + '</b></div>' +
        '<div class="stat-row"><span>Archivo</span><b>' + typeLabel(book) + ' · ' + U.formatBytes(book.size) + '</b></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:18px">' +
        '<button class="btn btn--ghost" style="flex:1" data-act="finished">' + U.icon('check') + (book.finished ? 'No leído' : 'Marcar leído') + '</button>' +
        '<button class="btn btn--danger" style="flex:1" data-act="delete">' + U.icon('trash') + 'Eliminar</button>' +
      '</div>';

    var sheet = U.sheet({ title: 'Detalles', content: body, wide: true });

    // tags renderer
    function renderTags() {
      var host = body.querySelector('[data-tags]');
      host.innerHTML = '';
      (book.tags || []).forEach(function (tag, i) {
        var el = U.el('span', { class: 'tag', text: tag });
        var x = U.el('button', { 'aria-label': 'Quitar etiqueta', html: U.icon('close') });
        x.addEventListener('click', function () {
          book.tags.splice(i, 1);
          persistMeta();
          renderTags();
        });
        el.appendChild(x);
        host.appendChild(el);
      });
      var addBtn = U.el('button', { class: 'tag', style: { borderStyle: 'dashed' }, html: U.icon('plus') + ' Etiqueta' });
      addBtn.addEventListener('click', async function () {
        var value = await U.prompt({ title: 'Nueva etiqueta', label: 'Etiqueta', placeholder: 'manga, pendiente…' });
        if (value) {
          book.tags = book.tags || [];
          if (book.tags.indexOf(value) === -1) book.tags.push(value);
          persistMeta();
          renderTags();
        }
      });
      host.appendChild(addBtn);
    }

    function renderCollections() {
      var host = body.querySelector('[data-collections]');
      host.innerHTML = '';
      var owned = Library.collections.filter(function (c) { return (book.collections || []).indexOf(c.id) >= 0; });
      if (!owned.length) host.appendChild(U.el('span', { class: 'muted', style: { fontSize: '12px' }, text: 'Sin colecciones' }));
      owned.forEach(function (col) {
        host.appendChild(U.el('span', { class: 'tag', text: col.name }));
      });
      var edit = U.el('button', { class: 'tag', style: { borderStyle: 'dashed' }, html: U.icon('collection') + ' Organizar' });
      edit.addEventListener('click', function () { openCollectionPicker(book, renderCollections); });
      host.appendChild(edit);
    }

    function renderBookmarks() {
      var host = body.querySelector('[data-bookmarks]');
      host.innerHTML = '';
      DB.getAllByIndex('bookmarks', 'bookId', book.id).then(function (marks) {
        marks.sort(function (a, b) { return a.page - b.page; });
        if (!marks.length) {
          host.innerHTML = '<p class="muted" style="font-size:12.5px;margin:0 0 4px">Sin marcadores. Usa el icono de marcador mientras lees.</p>';
          return;
        }
        marks.forEach(function (mk) {
          var row = U.el('div', { class: 'bookmark-row' });
          var pageBtn = U.el('button', { class: 'bookmark-row__page', text: String(mk.page + 1) });
          pageBtn.addEventListener('click', function () {
            sheet.close();
            var b = Library.bookById(book.id);
            if (b) global.Reader.open(b, { startPage: mk.page });
          });
          row.appendChild(pageBtn);
          var info = U.el('div', { class: 'bookmark-row__body' });
          info.appendChild(document.createTextNode(mk.note || ('Página ' + (mk.page + 1))));
          info.appendChild(U.el('small', { text: U.relativeTime(mk.createdAt) }));
          row.appendChild(info);
          var del = U.el('button', { class: 'icon-btn icon-btn--sm', 'aria-label': 'Quitar marcador', html: U.icon('close') });
          del.addEventListener('click', function () {
            DB.del('bookmarks', mk.id).then(renderBookmarks);
          });
          row.appendChild(del);
          host.appendChild(row);
        });
      });
    }

    function persistMeta() {
      book.title = body.querySelector('#dt-title').value.trim() || book.title;
      book.author = body.querySelector('#dt-author').value.trim();
      book.series = body.querySelector('#dt-series').value.trim();
      book.notes = body.querySelector('#dt-notes').value.trim();
      return DB.put('books', book).then(function () {
        var card = U.$('.book-card[data-id="' + book.id + '"] .book-card__title');
        if (card) card.textContent = book.title;
        Library.render();
      });
    }

    body.querySelectorAll('#dt-title, #dt-author, #dt-series, #dt-notes').forEach(function (input) {
      input.addEventListener('change', persistMeta);
    });

    body.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var kind = act.getAttribute('data-act');
      if (kind === 'read') {
        sheet.close();
        setTimeout(function () { global.Reader.open(book); }, 90);
      } else if (kind === 'fav') {
        Library.toggleFavorite(book);
        act.style.color = book.favorite ? '#ec4899' : '';
      } else if (kind === 'export') {
        exportBook(book);
      } else if (kind === 'more') {
        sheet.close();
        setTimeout(function () { openQuickActions(book.id); }, 160);
      } else if (kind === 'finished') {
        toggleFinished(book);
        sheet.close();
      } else if (kind === 'delete') {
        deleteBook(book, sheet);
      }
    });

    renderTags();
    renderCollections();
    renderBookmarks();
    if (book.favorite) {
      var favBtn = body.querySelector('[data-act="fav"]');
      if (favBtn) favBtn.style.color = '#ec4899';
    }
  };

  var openCollectionPicker = function (book, after) {
    var body = U.el('div');
    var render = function () {
      body.innerHTML = '';
      if (!Library.collections.length) {
        body.innerHTML = '<p class="muted" style="font-size:13px;padding:4px 0 14px">Aún no tienes colecciones.</p>';
      }
      Library.collections.forEach(function (col) {
        var on = (book.collections || []).indexOf(col.id) >= 0;
        var row = U.el('button', { class: 'menu-item' });
        row.innerHTML = U.icon(on ? 'check' : 'collection');
        row.appendChild(U.el('span', { class: 'menu-item__label', text: col.name }));
        row.appendChild(U.el('span', { class: 'switch' + (on ? ' is-on' : '') }));
        row.addEventListener('click', function () {
          book.collections = book.collections || [];
          if (on) book.collections = book.collections.filter(function (id) { return id !== col.id; });
          else book.collections.push(col.id);
          DB.put('books', book).then(function () {
            render();
            if (after) after();
            Library.render();
            if (global.App) App.renderShelves();
          });
        });
        body.appendChild(row);
      });
      var create = U.el('button', { class: 'btn btn--soft btn--block', style: { marginTop: '12px' }, html: U.icon('plus') + ' Nueva colección' });
      create.addEventListener('click', function () {
        createCollection(function (col) {
          if (col) {
            book.collections = book.collections || [];
            if (book.collections.indexOf(col.id) === -1) book.collections.push(col.id);
            DB.put('books', book).then(function () { render(); if (after) after(); Library.render(); });
          }
        });
      });
      body.appendChild(create);
    };
    render();
    U.sheet({ title: 'Colecciones', sub: book.title, content: body });
  };

  var createCollection = function (cb) {
    U.prompt({ title: 'Nueva colección', label: 'Nombre', placeholder: 'Manga, Marvel, Pendientes…' }).then(function (name) {
      if (!name) { if (cb) cb(null); return; }
      var col = { id: U.uid(), name: name, createdAt: Date.now() };
      DB.put('collections', col).then(function () {
        Library.collections.push(col);
        U.toast('Colección creada', 'ok');
        if (global.App) App.renderShelves();
        if (cb) cb(col);
      });
    });
  };
  Library.createCollection = createCollection;

  var exportBook = async function (book) {
    try {
      var row = await DB.get('files', book.id);
      if (!row || !row.blob) { U.toast('El archivo ya no está disponible', 'err'); return; }
      var ext = book.type === 'pdf' ? 'pdf' : 'cbz';
      var safeName = book.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'comic';
      await WX.sendToChat(
        { blob: row.blob, name: safeName + '.' + ext },
        'Enviado desde Comicverse'
      );
      U.toast('Listo para enviar al chat', 'ok');
    } catch (e) {
      console.error(e);
      U.toast('No se pudo compartir el archivo', 'err');
    }
  };
  Library.exportBook = exportBook;

  var deleteBook = async function (book, parentSheet) {
    var ok = await U.confirm({
      title: 'Eliminar cómic',
      message: 'Se borrará «' + book.title + '» y todo su progreso de este dispositivo. Esta acción no se puede deshacer.',
      confirmText: 'Eliminar',
      danger: true
    });
    if (!ok) return;
    await DB.del('books', book.id);
    await DB.del('files', book.id).catch(function () {});
    var marks = await DB.getAllByIndex('bookmarks', 'bookId', book.id);
    await Promise.all(marks.map(function (m) { return DB.del('bookmarks', m.id); }));
    releaseCover(book.id);
    Library.books = Library.books.filter(function (b) { return b.id !== book.id; });
    if (parentSheet) { try { parentSheet.close(); } catch (e) {} }
    await Library.refresh();
    if (global.App) App.renderShelves();
    U.toast('Cómic eliminado', 'ok');
  };
  Library.deleteBook = deleteBook;

  /* ---------- import ---------- */
  Library.importFiles = async function (presetFiles) {
    var files = presetFiles;
    if (!files) {
      try {
        files = await WX.importFiles({ extensions: ['.cbz', '.pdf', '.zip', '.cbr', '.cbt'], multiple: true });
      } catch (e) {
        U.toast('No se pudo abrir el selector de archivos', 'err');
        return;
      }
    }
    files = (files || []).filter(Boolean);
    if (!files.length) return;

    var items = files.map(function (file) {
      return { file: file, name: file.name || 'archivo', state: 'pending', detail: 'En cola…', progress: 0, book: null };
    });

    var content = U.el('div', { class: 'import-list' });
    items.forEach(function (item) {
      var row = U.el('div', { class: 'import-item' });
      row.innerHTML = '<div class="import-item__ico">' + U.icon('file') + '</div>' +
        '<div class="import-item__body"><div class="import-item__name">' + U.escape(item.name) + '</div>' +
        '<div class="import-item__state">En cola…</div><div class="import-item__bar"><span></span></div></div>';
      item.row = row;
      content.appendChild(row);
    });

    var footer = U.el('div', { style: { display: 'flex', gap: '10px', width: '100%' } });
    var moreBtn = U.el('button', { class: 'btn btn--ghost', style: { flex: '1' }, html: U.icon('plus') + ' Importar más' });
    var doneBtn = U.el('button', { class: 'btn btn--primary', style: { flex: '1' }, text: 'Listo', disabled: true });
    footer.appendChild(moreBtn); footer.appendChild(doneBtn);

    var sheet = U.sheet({
      title: 'Añadiendo cómics',
      sub: items.length + (items.length === 1 ? ' archivo' : ' archivos'),
      content: content, footer: footer, dismissable: false
    });

    doneBtn.addEventListener('click', function () { sheet.close(); });
    moreBtn.addEventListener('click', function () { sheet.close(); setTimeout(function () { Library.importFiles(); }, 200); });

    var setState = function (item, state, detail, progress) {
      item.state = state;
      item.detail = detail;
      if (progress != null) item.progress = progress;
      var stateEl = item.row.querySelector('.import-item__state');
      var barEl = item.row.querySelector('.import-item__bar span');
      var iconEl = item.row.querySelector('.import-item__ico');
      stateEl.textContent = detail;
      barEl.style.width = (state === 'done' ? 100 : item.progress) + '%';
      barEl.style.background = state === 'error' ? 'var(--danger)' : state === 'duplicate' ? 'var(--warn)' : '';
      iconEl.innerHTML = U.icon(state === 'done' ? 'check' : state === 'error' ? 'info' : state === 'duplicate' ? 'info' : 'file');
      if (state === 'done') iconEl.style.color = 'var(--ok)';
      else if (state === 'error') iconEl.style.color = 'var(--danger)';
      else if (state === 'duplicate') iconEl.style.color = 'var(--warn)';
    };

    var added = 0, dupes = 0, failed = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var source = null;
      try {
        setState(item, 'working', 'Analizando archivo…', 12);
        source = await Sources.open({ blob: item.file, name: item.name });
        setState(item, 'working', 'Extrayendo portada…', 40);
        var coverInfo = await Sources.buildCover(source, 420);
        var info = null;
        if (source.metaPromise) {
          try { info = await source.metaPromise; } catch (e) { info = null; }
        }
        setState(item, 'working', 'Guardando en la biblioteca…', 72);
        var hash = await U.hashBlob(item.file);
        var existing = Library.books.find(function (b) { return b.hash === hash; });
        if (existing) {
          dupes++;
          setState(item, 'duplicate', 'Ya está en tu biblioteca', 100);
          source.close();
          continue;
        }
        var guessed = U.titleFromFilename(item.name);
        var title = (info && (info.title || (info.series ? info.series + (info.number ? ' #' + info.number : '') : ''))) || guessed;
        var tags = [];
        if (info && info.genre) {
          tags = info.genre.split(/[,;]/).map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 6);
        }
        var book = {
          id: U.uid(),
          hash: hash,
          title: title,
          author: (info && info.writer) || '',
          series: (info && info.series) || '',
          notes: (info && info.summary) || '',
          tags: tags,
          year: (info && info.year) || '',
          publisher: (info && info.publisher) || '',
          type: source.type,
          size: item.file.size || 0,
          pageCount: source.pageCount,
          cover: coverInfo.cover || null,
          aspect: coverInfo.aspect || 1.5,
          addedAt: Date.now(),
          lastReadAt: 0,
          page: 0,
          finished: false,
          favorite: false,
          collections: [],
          readingTime: 0,
          prefs: {}
        };
        await DB.put('files', { id: book.id, blob: item.file });
        await DB.put('books', book);
        Library.books.push(book);
        added++;
        setState(item, 'done', 'Listo · ' + source.pageCount + ' páginas', 100);
        source.close();
      } catch (err) {
        console.warn('[comicverse] import error', err);
        failed++;
        setState(item, 'error', err && err.message ? err.message : 'No se pudo importar', 100);
        if (source) { try { source.close(); } catch (e) {} }
      }
      await U.sleep(60);
    }

    await DB.persist();
    doneBtn.disabled = false;
    moreBtn.disabled = false;

    var msg = [];
    if (added) msg.push(added + (added === 1 ? ' añadido' : ' añadidos'));
    if (dupes) msg.push(dupes + (dupes === 1 ? ' duplicado' : ' duplicados'));
    if (failed) msg.push(failed + (failed === 1 ? ' error' : ' errores'));
    U.toast(msg.length ? msg.join(' · ') : 'Nada que importar', failed ? 'err' : 'ok');

    await Library.refresh();
    if (global.App) {
      App.renderShelves();
      App.renderStats();
    }
  };

  /* ---------- progress persistence (used by the reader) ---------- */
  Library.saveProgress = async function (book, page, opts) {
    book.page = U.clamp(page, 0, book.pageCount - 1);
    book.lastReadAt = Date.now();
    if (opts && opts.finished) book.finished = true;
    if (!book.finished && book.page >= book.pageCount - 1) book.finished = true;
    if (book.page < book.pageCount - 1 && opts && opts.reopen) book.finished = false;
    await DB.put('books', book);
    // keep in-memory list in sync
    var idx = Library.books.findIndex(function (b) { return b.id === book.id; });
    if (idx >= 0) Library.books[idx] = book;
  };

  /* ---------- sync from chat ---------- */
  Library.applyRemoteProgress = async function (payload) {
    if (!payload || !payload.book) return;
    var book = Library.books.find(function (b) { return b.hash === payload.book; });
    if (!book) return;
    if (payload.updatedAt && book.remoteAt && payload.updatedAt <= book.remoteAt) return;
    if (payload.updatedAt && book.lastReadAt && payload.updatedAt < book.lastReadAt) return;
    if (typeof payload.page === 'number' && payload.page !== book.page) {
      book.page = U.clamp(payload.page, 0, book.pageCount - 1);
      book.lastReadAt = Math.min(Date.now(), payload.updatedAt || Date.now());
      book.remoteAt = payload.updatedAt || Date.now();
      book.finished = book.page >= book.pageCount - 1;
      await DB.put('books', book);
      Library.render();
      if (global.Reader.current && Reader.current.book.id === book.id) {
        Reader.goTo(book.page, { silent: true });
      }
      U.toast('Progreso sincronizado desde el chat', 'info');
    }
  };

  /* ---------- init ---------- */
  Library.init = function () {
    grid = U.$('#libraryGrid');
    emptyEl = U.$('#libraryEmpty');
    chipsEl = U.$('#filterChips');
    bindGridEvents();
    bindChips();
    Library.state.layout = (App.settings && App.settings.layout) || 'grid';
    applyLayoutIcon();
    U.$('#btnLayout').addEventListener('click', function () {
      Library.state.layout = Library.state.layout === 'grid' ? 'list' : 'grid';
      if (global.App) App.saveSetting('layout', Library.state.layout);
      applyLayoutIcon();
      Library.render();
    });
    U.$('.appbar').addEventListener('click', function (e) {
      if (e.target.closest('[data-import]')) Library.importFiles();
    });
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-import]');
      if (btn) { e.preventDefault(); Library.importFiles(); }
    });
  };

  function applyLayoutIcon() {
    var use = U.$('#layoutIcon use');
    if (use) use.setAttribute('href', Library.state.layout === 'grid' ? '#i-list' : '#i-grid');
    var btn = U.$('#btnLayout');
    if (btn) btn.setAttribute('aria-label', Library.state.layout === 'grid' ? 'Ver como lista' : 'Ver como cuadrícula');
  }

  /* ---------- search ---------- */
  function hideSearch() {
    var bar = U.$('#searchbar');
    bar.hidden = true;
    var input = U.$('#searchInput');
    input.value = '';
    Library.state.query = '';
    U.$('#btnSearch').classList.remove('is-active');
  }
  Library.hideSearch = hideSearch;

  Library.initSearch = function () {
    var bar = U.$('#searchbar'), input = U.$('#searchInput'), btn = U.$('#btnSearch');
    var toggle = function (show) {
      var isHidden = bar.hidden;
      if (show === undefined) show = isHidden;
      if (!show) { hideSearch(); Library.render(); return; }
      bar.hidden = false;
      btn.classList.add('is-active');
      setTimeout(function () { input.focus(); }, 60);
    };
    btn.addEventListener('click', function () { toggle(); });
    U.$('#btnSearchClear').addEventListener('click', function () { toggle(false); });
    input.addEventListener('input', U.debounce(function () {
      Library.state.query = input.value;
      if (Library.state.query && !U.$('.view[data-view="library"]').classList.contains('is-active')) setTab('library');
      Library.render();
    }, 140));
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { toggle(false); Library.render(); }
    });
  };

  global.Library = Library;
})(window);
