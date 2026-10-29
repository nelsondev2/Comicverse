/* Comicverse — settings, data management and about */
(function (global) {
  'use strict';

  var Settings = {};

  var THEMES = [
    { id: 'dark', label: 'Oscuro', swatch: 'dark' },
    { id: 'light', label: 'Claro', swatch: 'light' },
    { id: 'auto', label: 'Auto', swatch: 'auto' }
  ];

  function row(opts) {
    var el = U.el(opts.onClick ? 'button' : 'div', { class: 'setting-row', type: opts.onClick ? 'button' : null });
    if (opts.icon) el.appendChild(U.el('span', { class: 'setting-row__ico', html: U.icon(opts.icon) }));
    var body = U.el('div', { class: 'setting-row__body' });
    body.appendChild(U.el('div', { class: 'setting-row__title', text: opts.title }));
    if (opts.sub) body.appendChild(U.el('div', { class: 'setting-row__sub', text: opts.sub }));
    el.appendChild(body);
    if (opts.value !== undefined) {
      var v = U.el('span', { class: 'setting-row__value' });
      v.innerHTML = '<span>' + U.escape(opts.value) + '</span>' + (opts.onClick ? U.icon('chevron') : '');
      el.appendChild(v);
    } else if (opts.right) {
      el.appendChild(opts.right);
    }
    if (opts.onClick) el.addEventListener('click', opts.onClick);
    return el;
  }

  function toggle(value, onChange) {
    var sw = U.el('button', {
      class: 'switch' + (value ? ' is-on' : ''),
      role: 'switch', 'aria-checked': value ? 'true' : 'false', 'aria-label': 'Activar o desactivar'
    });
    sw.addEventListener('click', function (e) {
      e.stopPropagation();
      var next = !sw.classList.contains('is-on');
      sw.classList.toggle('is-on', next);
      sw.setAttribute('aria-checked', next ? 'true' : 'false');
      onChange(next);
    });
    return sw;
  }

  function group(title) {
    var wrap = U.el('div');
    if (title) wrap.appendChild(U.el('div', { class: 'settings-group__head', text: title }));
    var g = U.el('div', { class: 'settings-group' });
    wrap.appendChild(g);
    return { wrap: wrap, body: g };
  }

  function pickSheet(title, options, current, onPick) {
    var content = U.el('div', { class: 'sheet-menu' });
    options.forEach(function (o) {
      var b = U.el('button', { class: 'menu-item', html: U.icon(o.icon || 'check') });
      var label = U.el('span', { class: 'menu-item__label' });
      label.appendChild(document.createTextNode(o.label));
      if (o.sub) label.appendChild(U.el('small', { text: o.sub }));
      b.appendChild(label);
      if (o.id === current) b.appendChild(U.el('span', { class: 'badge-soft', text: 'Activo' }));
      b.addEventListener('click', function () { sheet.close(); onPick(o.id); });
      content.appendChild(b);
    });
    var sheet = U.sheet({ title: title, content: content });
  }

  Settings.render = async function () {
    var host = U.$('#settingsContent');
    if (!host) return;
    host.innerHTML = '';
    var s = App.settings;

    /* Appearance */
    var appearance = group('Apariencia');
    var themeWrap = U.el('div', { style: { padding: '10px 0 14px' } });
    var opts = U.el('div', { class: 'theme-options' });
    THEMES.forEach(function (t) {
      var b = U.el('button', {
        class: 'theme-opt' + (s.theme === t.id ? ' is-active' : ''),
        'aria-pressed': s.theme === t.id ? 'true' : 'false'
      });
      b.innerHTML = '<div class="theme-opt__swatch" data-swatch="' + t.swatch + '"></div><span>' + t.label + '</span>';
      b.addEventListener('click', function () {
        App.saveSetting('theme', t.id);
        App.applyTheme();
        Settings.render();
      });
      opts.appendChild(b);
    });
    themeWrap.appendChild(opts);

    var accentLabel = U.el('div', { class: 'field__label', style: { marginTop: '4px' }, text: 'Color de acento' });
    themeWrap.appendChild(accentLabel);
    var accentRow = U.el('div', { class: 'accent-row' });
    Object.keys(App.ACCENTS).forEach(function (key) {
      var c = App.ACCENTS[key];
      var dot = U.el('button', {
        class: 'accent-dot' + (s.accent === key ? ' is-active' : ''),
        style: { '--dot': 'linear-gradient(140deg,' + c.strong + ',' + c.accent + ' 60%,' + c.second + ')' },
        'aria-label': 'Acento ' + key,
        'aria-pressed': s.accent === key ? 'true' : 'false'
      });
      dot.addEventListener('click', function () {
        App.saveSetting('accent', key);
        App.applyAccent();
        Settings.render();
      });
      accentRow.appendChild(dot);
    });
    themeWrap.appendChild(accentRow);
    appearance.body.appendChild(themeWrap);
    host.appendChild(appearance.wrap);

    /* Reading */
    var reading = group('Lectura');
    var modeLabels = { single: 'Página única', double: 'Página doble', scroll: 'Tira vertical' };
    var colors = { black: 'Negro', charcoal: 'Gris', white: 'Claro' };
    var fits = { page: 'Ajustar a página', width: 'Ajustar al ancho', height: 'Ajustar al alto' };
    reading.body.appendChild(row({
      icon: 'single', title: 'Modo predeterminado', value: modeLabels[s.reader.mode],
      onClick: function () {
        pickSheet('Modo de lectura', [
          { id: 'single', icon: 'single', label: 'Página única' },
          { id: 'double', icon: 'double', label: 'Página doble', sub: 'Ideal para tablet y horizontal' },
          { id: 'scroll', icon: 'scroll', label: 'Tira vertical', sub: 'Webtoon y scroll continuo' }
        ], s.reader.mode, function (id) {
          s.reader.mode = id; App.saveSetting('reader', s.reader); Settings.render();
        });
      }
    }));
    reading.body.appendChild(row({
      icon: 'ltr', title: 'Dirección de lectura', value: s.reader.dir === 'rtl' ? 'Derecha → izquierda' : 'Izquierda → derecha',
      onClick: function () {
        pickSheet('Dirección', [
          { id: 'ltr', icon: 'ltr', label: 'Izquierda → derecha', sub: 'Cómic occidental' },
          { id: 'rtl', icon: 'rtl', label: 'Derecha → izquierda', sub: 'Manga japonés' }
        ], s.reader.dir, function (id) { s.reader.dir = id; App.saveSetting('reader', s.reader); Settings.render(); });
      }
    }));
    reading.body.appendChild(row({
      icon: 'fit-page', title: 'Ajuste de página', value: fits[s.reader.fit],
      onClick: function () {
        pickSheet('Ajuste', [
          { id: 'page', icon: 'fit-page', label: 'Ajustar a página', sub: 'Toda la página visible' },
          { id: 'width', icon: 'fit-width', label: 'Ajustar al ancho', sub: 'Página a todo el ancho' },
          { id: 'height', icon: 'fit-height', label: 'Ajustar al alto', sub: 'Página a toda la altura' }
        ], s.reader.fit, function (id) { s.reader.fit = id; App.saveSetting('reader', s.reader); Settings.render(); });
      }
    }));
    reading.body.appendChild(row({
      icon: 'moon', title: 'Fondo del lector', value: colors[s.reader.bg] || 'Negro',
      onClick: function () {
        pickSheet('Fondo', [
          { id: 'black', label: 'Negro', sub: 'Máximo contraste' },
          { id: 'charcoal', label: 'Gris', sub: 'Menos agresivo' },
          { id: 'white', label: 'Claro', sub: 'Cómic con fondo blanco' }
        ], s.reader.bg, function (id) { s.reader.bg = id; App.saveSetting('reader', s.reader); Settings.render(); });
      }
    }));
    reading.body.appendChild(row({
      icon: 'sun', title: 'Mantener pantalla encendida', sub: 'Evita que se apague mientras lees',
      right: toggle(s.wakeLock, function (v) { App.saveSetting('wakeLock', v); })
    }));
    host.appendChild(reading.wrap);

    /* Chat sync */
    var chat = group('Chat y sincronización');
    chat.body.appendChild(row({
      icon: 'cloud', title: 'Sincronizar progreso en el chat',
      sub: WX.available ? 'Comparte tu página actual con los miembros del chat' : 'Disponible al abrir Comicverse dentro de Delta Chat',
      right: toggle(s.syncProgress, function (v) { App.saveSetting('syncProgress', v); })
    }));
    chat.body.appendChild(row({
      icon: 'info', title: 'Entorno',
      value: WX.available ? 'Delta Chat / webxdc' : 'Navegador (modo local)'
    }));
    host.appendChild(chat.wrap);

    /* Data */
    var data = group('Datos y almacenamiento');
    var estimate = await DB.estimate();
    var storageRow = U.el('div', { class: 'setting-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } });
    var head = U.el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
    head.innerHTML = '<div class="setting-row__title">Almacenamiento usado</div><div class="setting-row__value">' + U.formatBytes(estimate.usage) + (estimate.quota ? ' de ' + U.formatBytes(estimate.quota) : '') + '</div>';
    storageRow.appendChild(head);
    var bar = U.el('div', { class: 'storage-bar' });
    var pct = estimate.quota ? Math.min(100, (estimate.usage / estimate.quota) * 100) : 0;
    bar.innerHTML = '<span style="width:' + Math.max(2, pct) + '%"></span>';
    storageRow.appendChild(bar);
    storageRow.appendChild(U.el('div', { class: 'setting-row__sub', text: 'Tus cómics y tu progreso viven solo en este dispositivo.' }));
    data.body.appendChild(storageRow);

    data.body.appendChild(row({
      icon: 'download', title: 'Exportar copia de seguridad',
      sub: 'Metadatos, colecciones, marcadores y estadísticas',
      onClick: function () { exportBackup(); }
    }));
    data.body.appendChild(row({
      icon: 'arrow-up', title: 'Restaurar copia de seguridad',
      sub: 'Vuelve a vincular tus archivos al importarlos',
      onClick: function () { importBackup(); }
    }));
    data.body.appendChild(row({
      icon: 'trash', title: 'Borrar todos los datos',
      sub: 'Elimina cómics, progreso y ajustes',
      onClick: function () { wipeAll(); }
    }));
    host.appendChild(data.wrap);

    /* About */
    var about = group('Acerca de');
    about.body.appendChild(row({
      icon: 'info', title: 'Comicverse', sub: 'Lector de cómics CBZ y PDF para webxdc',
      value: 'v' + App.VERSION
    }));
    about.body.appendChild(row({
      icon: 'file', title: 'Licencias de terceros', sub: 'pdf.js (Apache-2.0) · JSZip (MIT)',
      onClick: openLicenses
    }));
    about.body.appendChild(row({
      icon: 'share', title: 'Código fuente',
      onClick: function () {
        var url = 'https://github.com/nelsondev2/Comicverse';
        if (navigator.share) navigator.share({ title: 'Comicverse', url: url }).catch(function () {});
        else U.copyText(url).then(function (ok) { U.toast(ok ? 'Enlace copiado' : url, 'ok'); });
      }
    }));
    host.appendChild(about.wrap);

    var versionEl = U.$('#appVersion');
    if (versionEl) {
      versionEl.innerHTML = 'Comicverse v' + App.VERSION + ' · 100 % local y sin conexión<br>' +
        (WX.available ? 'Ejecutándose dentro de tu mensajería' : 'Vista previa en navegador');
    }
  };

  /* ---------- backup ---------- */
  async function exportBackup() {
    try {
      var s = App.settings;
      var data = {
        app: 'comicverse',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: s,
        collections: Library.collections,
        books: Library.books.map(function (b) {
          return {
            hash: b.hash, title: b.title, author: b.author, series: b.series, notes: b.notes,
            tags: b.tags, favorite: b.favorite, page: b.page, finished: b.finished,
            lastReadAt: b.lastReadAt, addedAt: b.addedAt, readingTime: b.readingTime,
            type: b.type, pageCount: b.pageCount, collections: b.collections
          };
        }),
        bookmarks: [],
        stats: await DB.getAll('stats')
      };
      var marks = await DB.getAll('bookmarks');
      // Bookmarks must travel with the portable book hash: local ids are
      // meaningless on another device (or after a re-import).
      var idToHash = {};
      Library.books.forEach(function (b) { idToHash[b.id] = b.hash; });
      data.bookmarks = marks.map(function (mk) {
        return {
          bookHash: idToHash[mk.bookId] || mk.bookHash || '',
          page: mk.page || 0,
          note: mk.note || '',
          createdAt: mk.createdAt || Date.now()
        };
      }).filter(function (mk) { return !!mk.bookHash; });
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var name = 'comicverse-backup-' + U.dayKey() + '.json';
      if (WX.available && WX.sendToChat) {
        await WX.sendToChat({ blob: blob, name: name }, 'Copia de seguridad de Comicverse');
      } else {
        U.shareFallback(blob, name);
      }
      U.toast('Copia de seguridad generada', 'ok');
    } catch (e) {
      console.error(e);
      U.toast('No se pudo exportar la copia', 'err');
    }
  }

  async function importBackup() {
    var files;
    try {
      files = await WX.importFiles({ extensions: ['.json'], mimeTypes: ['application/json'], multiple: false });
    } catch (e) { return; }
    var file = files && files[0];
    if (!file) return;
    try {
      var text = await file.text();
      var data = JSON.parse(text);
      if (!data || data.app !== 'comicverse') throw new Error('El archivo no es una copia de Comicverse');
      var ok = await U.confirm({
        title: 'Restaurar copia',
        message: 'Se combinarán los metadatos con tu biblioteca actual. Los cómics que falten se vincularán al volver a importar sus archivos.',
        confirmText: 'Restaurar'
      });
      if (!ok) return;

      var byHash = {};
      Library.books.forEach(function (b) { byHash[b.hash] = b; });
      var updated = 0, missing = 0;
      (data.books || []).forEach(function (incoming) {
        var local = byHash[incoming.hash];
        if (!local) { missing++; return; }
        ['author', 'series', 'notes', 'tags', 'favorite', 'finished', 'readingTime'].forEach(function (k) {
          if (incoming[k] !== undefined) local[k] = incoming[k];
        });
        if (typeof incoming.page === 'number') local.page = incoming.page;
        if (incoming.lastReadAt) local.lastReadAt = Math.max(local.lastReadAt || 0, incoming.lastReadAt);
        if (incoming.collections) {
          var remap = [];
          (incoming.collections || []).forEach(function (oldId) {
            var col = (data.collections || []).find(function (c) { return c.id === oldId; });
            if (!col) return;
            var existing = Library.collections.find(function (c) { return c.name === col.name; });
            if (existing) remap.push(existing.id);
            else {
              var newCol = { id: U.uid(), name: col.name, createdAt: col.createdAt || Date.now() };
              Library.collections.push(newCol);
              remap.push(newCol.id);
              DB.put('collections', newCol);
            }
          });
          local.collections = remap;
        }
        DB.put('books', local);
        updated++;
      });

      (data.collections || []).forEach(function (col) {
        if (!Library.collections.some(function (c) { return c.name === col.name; })) {
          var c = { id: U.uid(), name: col.name, createdAt: col.createdAt || Date.now() };
          Library.collections.push(c);
          DB.put('collections', c);
        }
      });

      var existingMarks = await DB.getAll('bookmarks');
      (data.bookmarks || []).forEach(function (mk) {
        var book = Library.books.find(function (b) { return b.hash === (mk.bookHash || ''); });
        if (!book) return;
        var page = mk.page || 0;
        var dupe = existingMarks.some(function (m) { return m.bookId === book.id && m.page === page; });
        if (dupe) return;
        var row = { id: U.uid(), bookId: book.id, page: page, note: mk.note || '', createdAt: mk.createdAt || Date.now() };
        existingMarks.push(row);
        DB.put('bookmarks', row);
      });

      if (Array.isArray(data.stats)) {
        for (var i = 0; i < data.stats.length; i++) {
          var rowData = data.stats[i];
          if (!rowData || !rowData.date) continue;
          var existing = await DB.get('stats', rowData.date);
          if (!existing) await DB.put('stats', rowData);
          else {
            existing.pages = Math.max(existing.pages || 0, rowData.pages || 0);
            existing.seconds = Math.max(existing.seconds || 0, rowData.seconds || 0);
            await DB.put('stats', existing);
          }
        }
      }

      await Library.refresh();
      App.renderShelves();
      App.renderStats();
      U.toast(updated + ' cómics actualizados' + (missing ? ' · ' + missing + ' pendientes de archivo' : ''), 'ok', 4200);
      Settings.render();
    } catch (e) {
      console.error(e);
      U.toast(e.message || 'No se pudo restaurar la copia', 'err');
    }
  }

  async function wipeAll() {
    var ok = await U.confirm({
      title: 'Borrar todos los datos',
      message: 'Se eliminarán todos los cómics, colecciones, marcadores y estadísticas de este dispositivo. No se puede deshacer.',
      confirmText: 'Continuar',
      danger: true
    });
    if (!ok) return;
    var really = await U.confirm({
      title: '¿Seguro?',
      message: 'Esta es la última confirmación: tu biblioteca se borrará por completo.',
      confirmText: 'Borrar todo',
      danger: true
    });
    if (!really) return;
    await Promise.all([
      DB.clear('books'), DB.clear('files'), DB.clear('bookmarks'),
      DB.clear('collections'), DB.clear('stats')
    ]);
    Library.books = [];
    Library.collections = [];
    Library.coverUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    Library.coverUrls.clear();
    await Library.refresh();
    App.renderShelves();
    App.renderStats();
    Settings.render();
    U.toast('Biblioteca borrada', 'ok');
  }

  function openLicenses() {
    var html = '<div style="font-size:13px;line-height:1.6;color:var(--text-2)">' +
      '<p style="margin-bottom:12px"><b>Comicverse</b> es un lector de cómics local-first para webxdc. No usa servidores, cuentas ni rastreadores.</p>' +
      '<div class="stat-row"><span>pdf.js</span><b>Apache-2.0</b></div>' +
      '<div class="stat-row"><span>JSZip</span><b>MIT / GPLv3</b></div>' +
      '<div class="stat-row"><span>Iconos</span><b>Propios (SVG)</b></div>' +
      '<p class="hint" style="margin-top:14px">Tus archivos nunca salen del dispositivo salvo cuando tú decides compartirlos en el chat.</p>' +
      '</div>';
    U.sheet({ title: 'Licencias', html: html });
  }

  global.Settings = Settings;
})(window);
