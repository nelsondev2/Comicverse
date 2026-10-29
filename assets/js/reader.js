/* Comicverse — reading engine: paged, spread, continuous modes, zoom, bookmarks */
(function (global) {
  'use strict';

  var Reader = {};
  var R = null; // runtime state

  var el = {};
  var reduceMotion = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------------- helpers ---------------- */
  function clampPage(book, i) {
    var max = (R ? R.source.pageCount : book.pageCount) - 1;
    return U.clamp(i, 0, Math.max(0, max));
  }

  function stageSize() {
    var r = el.stage.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  function pagePair(index, mode) {
    if (mode !== 'double') return [index];
    if (index === 0) return [0];
    var start = spreadAnchor(index);
    var pages = [start];
    if (start + 1 < R.source.pageCount) pages.push(start + 1);
    return pages;
  }

  function spreadAnchor(index) {
    if (index <= 0) return 0;
    return index - ((index - 1) % 2);
  }

  /** +1 = next page, -1 = previous page, honouring the reading direction. */
  function swipeDirection(dx) {
    var dragForward = R.dir === 'rtl' ? dx > 0 : dx < 0;
    return dragForward ? 1 : -1;
  }

  function spreadStep(index, direction) {
    if (index === 0 && direction > 0) return 1;
    return spreadAnchor(index) + direction * 2;
  }

  /* ---------------- open / close ---------------- */
  Reader.open = async function (book, opts) {
    if (R) await Reader.close({ instant: true });
    opts = opts || {};
    el = {
      root: U.$('#reader'),
      stage: U.$('#readerStage'),
      paged: U.$('#paged'),
      scroll: U.$('#scrollView'),
      loading: U.$('#readerLoading'),
      bar: U.$('#readerBar'),
      foot: U.$('#readerFoot'),
      title: U.$('#readerTitle'),
      meta: U.$('#readerMeta'),
      pageLabel: U.$('#pageLabel'),
      slider: U.$('#pageSlider'),
      sliderFill: U.$('#sliderFill'),
      sliderThumb: U.$('#sliderThumb'),
      progress: U.$('#readerProgressFill'),
      bookmark: U.$('#btnBookmark'),
      layerA: U.$('.page-layer[data-layer="a"]'),
      layerB: U.$('.page-layer[data-layer="b"]'),
      brightness: U.$('#readerBrightness')
    };

    var prefs = Object.assign({
      mode: 'single', dir: 'ltr', fit: 'page', bg: 'black',
      brightness: 1, night: false, animate: true
    }, (App.settings && App.settings.reader) || {}, book.prefs || {});

    R = {
      book: book,
      source: null,
      page: 0,
      mode: prefs.mode,
      dir: prefs.dir,
      fit: prefs.fit,
      bg: prefs.bg || 'black',
      brightness: typeof prefs.brightness === 'number' ? prefs.brightness : 1,
      night: !!prefs.night,
      animate: prefs.animate !== false,
      zoom: { scale: 1, tx: 0, ty: 0 },
      base: { w: 0, h: 0 },
      active: 'a',
      layers: { a: el.layerA, b: el.layerB },
      gesture: null,
      chrome: true,
      chromeTimer: null,
      sessionStart: Date.now(),
      sessionSeconds: 0,
      seen: {},
      bookmarks: [],
      syncing: false,
      scrollObserver: null,
      destroyed: false,
      lastUi: Date.now()
    };

    el.root.hidden = false;
    el.root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-reading');
    R.bookmarks = await DB.getAllByIndex('bookmarks', 'bookId', book.id).catch(function () { return []; });
    updateBookmarkButton();
    paintChrome();
    el.title.textContent = book.title;
    Reader.current = R;

    if (history.state && history.state.comicverseReader) {
      // already pushed
    } else {
      try { history.pushState({ comicverseReader: true }, ''); } catch (e) {}
    }

    el.loading.classList.add('is-on');
    try {
      var row = await DB.get('files', book.id);
      if (!row || !row.blob) throw new Error('El archivo no está disponible en este dispositivo');
      var source = await Sources.open({ blob: row.blob, name: book.title });
      if (R.destroyed) { source.close(); return; }
      R.source = source;
      var start = typeof opts.startPage === 'number' ? opts.startPage : (book.finished ? 0 : (book.page || 0));
      R.page = clampPage(book, start);
      el.slider.setAttribute('aria-valuemax', String(R.source.pageCount));
      await Reader.renderCurrent();
      updatePageUi();
      el.loading.classList.remove('is-on');
      requestWakeLock();
      startSessionTimer();
      scheduleChromeHide();
      el.stage.focus({ preventScroll: true });
    } catch (err) {
      console.error('[comicverse] reader', err);
      el.loading.classList.remove('is-on');
      U.toast(err && err.message ? err.message : 'No se pudo abrir el cómic', 'err');
      Reader.close({ instant: true });
    }
  };

  Reader.close = async function (opts) {
    opts = opts || {};
    if (!R) {
      el.root && (el.root.hidden = true);
      return;
    }
    var runtime = R;
    R.destroyed = true;
    Reader.current = null;

    if (runtime.chromeTimer) clearTimeout(runtime.chromeTimer);
    stopSessionTimer();
    releaseWakeLock();
    if (runtime.scrollObserver) runtime.scrollObserver.disconnect();

    await persistSession(runtime);
    if (runtime.source) { try { runtime.source.close(); } catch (e) {} }

    el.root.hidden = true;
    el.root.setAttribute('aria-hidden', 'true');
    el.root.classList.remove('is-immersive');
    el.scroll.hidden = true;
    el.paged.hidden = false;
    el.layerA.innerHTML = '<div class="zoom"><div class="page-holder"></div></div>';
    el.layerB.innerHTML = '<div class="zoom"><div class="page-holder"></div></div>';
    el.layerA.style.transform = '';
    el.layerB.style.transform = '';
    document.body.classList.remove('is-reading');
    R = null;

    await Library.refresh();
    if (global.App) {
      App.renderShelves();
      App.renderStats();
    }
    if (history.state && history.state.comicverseReader) {
      try { history.replaceState(null, ''); } catch (e) {}
    }
    if (!opts.startPage && runtime.book) {
      maybeSyncProgress(runtime.book);
    }
  };

  /* ---------------- rendering ---------------- */
  function activeLayer() { return R.layers[R.active]; }
  function otherLayer() { return R.layers[R.active === 'a' ? 'b' : 'a']; }

  function clearLayer(layer) {
    var holder = layer.querySelector('.page-holder');
    holder.innerHTML = '';
    holder.classList.remove('is-spread');
    layer.style.transform = '';
    layer.style.opacity = '';
    layer.style.transition = '';
    layer.style.zIndex = '';
    var zoom = layer.querySelector('.zoom');
    zoom.style.transform = '';
    zoom.style.width = '';
    zoom.style.height = '';
  }

  async function loadPageItem(index) {
    if (!R.source) throw new Error('sin fuente');
    if (R.source.type === 'cbz') {
      var url = await R.source.urlFor(index);
      var img = await new Promise(function (resolve, reject) {
        var im = new Image();
        im.onload = function () { resolve(im); };
        im.onerror = function () { reject(new Error('Imagen dañada')); };
        im.src = url;
      });
      return { kind: 'image', el: img, w: img.naturalWidth || 1000, h: img.naturalHeight || 1500 };
    }
    var size = await R.source.pageSize(index);
    return { kind: 'pdf', index: index, w: size.width, h: size.height };
  }

  function scaleForFit(w, h, count, stage) {
    var availW = stage.w / count;
    var availH = stage.h;
    if (R.fit === 'width') return availW / w;
    if (R.fit === 'height') return availH / h;
    if (R.fit === 'original') return 1;
    return Math.min(availW / w, availH / h);
  }

  /**
   * Render page(s) into a layer, resolving once pixels are ready.
   * Returns { w, h } content size in CSS px.
   */
  async function renderInto(layer, index, opts) {
    opts = opts || {};
    var stage = stageSize();
    var pages = pagePair(index, R.mode);
    var holder = layer.querySelector('.page-holder');
    var zoom = layer.querySelector('.zoom');

    holder.classList.toggle('is-spread', pages.length > 1);
    holder.textContent = '';

    var items = [];
    for (var i = 0; i < pages.length; i++) {
      try {
        items.push(await loadPageItem(pages[i]));
      } catch (err) {
        items.push({ kind: 'error', message: err.message || 'Página no disponible' });
      }
    }

    var gap = pages.length > 1 ? 2 : 0;
    var sizes = items.map(function (item) {
      if (item.kind === 'error') return { w: stage.w, h: stage.h, scale: 1 };
      var s = scaleForFit(item.w, item.h, pages.length, stage);
      s = Math.max(s, 0.02);
      return { w: Math.round(item.w * s), h: Math.round(item.h * s) };
    });

    var contentW = sizes.reduce(function (acc, s) { return acc + s.w; }, 0) + gap * (sizes.length - 1);
    var contentH = Math.max.apply(null, sizes.map(function (s) { return s.h; }));

    // render each item now that we know target sizes
    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var box = document.createElement('div');
      box.style.cssText = 'width:' + sizes[j].w + 'px;height:' + sizes[j].h + 'px;display:flex;align-items:center;justify-content:center;flex:none;overflow:hidden;background:#fff';
      if (item.kind === 'image') {
        item.el.style.width = sizes[j].w + 'px';
        item.el.style.height = sizes[j].h + 'px';
        item.el.style.objectFit = 'contain';
        item.el.draggable = false;
        item.el.alt = 'Página ' + (pages[j] + 1);
        box.appendChild(item.el);
      } else if (item.kind === 'pdf') {
        var spin = document.createElement('div');
        spin.className = 'spinner page-spinner';
        spin.style.borderColor = 'rgba(0,0,0,.15)';
        spin.style.borderTopColor = '#8b5cf6';
        box.appendChild(spin);
        box.style.background = '#fff';
        try {
          var canvas = await R.source.renderCanvas(item.index, sizes[j].w, sizes[j].h);
          box.innerHTML = '';
          canvas.style.width = sizes[j].w + 'px';
          canvas.style.height = sizes[j].h + 'px';
          box.appendChild(canvas);
        } catch (err) {
          box.innerHTML = '';
          var msg = document.createElement('div');
          msg.className = 'page-missing';
          msg.textContent = 'No se pudo dibujar esta página';
          box.appendChild(msg);
        }
      } else {
        var miss = document.createElement('div');
        miss.className = 'page-missing';
        miss.textContent = item.message || 'Página no disponible';
        box.appendChild(miss);
      }
      holder.appendChild(box);
    }
    if (pages.length > 1 && R.dir === 'rtl') {
      // manga: the earlier page sits on the right, so the DOM order is reversed
      var kids = Array.prototype.slice.call(holder.children).reverse();
      holder.textContent = '';
      kids.forEach(function (k) { holder.appendChild(k); });
    }

    // position/scale the zoom canvas
    zoom.style.width = contentW + 'px';
    zoom.style.height = contentH + 'px';
    if (opts.resetZoom !== false) {
      resetZoom(layer, contentW, contentH, stage);
    }
    return { w: contentW, h: contentH };
  }

  function resetZoom(layer, contentW, contentH, stage) {
    var tx, ty;
    if (contentW > stage.w) tx = (stage.w - contentW) / 2;
    else tx = (stage.w - contentW) / 2;
    ty = contentH > stage.h ? 0 : (stage.h - contentH) / 2;
    var z = { scale: 1, tx: tx, ty: ty };
    if (layer === activeLayer()) R.zoom = z;
    applyZoom(layer, z);
  }

  function applyZoom(layer, z) {
    var zoom = layer.querySelector('.zoom');
    if (!zoom) return;
    zoom.style.transform = 'translate3d(' + z.tx + 'px,' + z.ty + 'px,0) scale(' + z.scale + ')';
  }

  function boundsFor(scale, contentW, contentH, stage) {
    var w = contentW * scale, h = contentH * scale;
    var minX, maxX, minY, maxY;
    if (w <= stage.w) { minX = maxX = (stage.w - w) / 2; }
    else { minX = stage.w - w; maxX = 0; }
    if (h <= stage.h) { minY = maxY = (stage.h - h) / 2; }
    else { minY = stage.h - h; maxY = 0; }
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function clampZoom(z, contentW, contentH, stage) {
    var b = boundsFor(z.scale, contentW, contentH, stage);
    return {
      scale: z.scale,
      tx: U.clamp(z.tx, b.minX, b.maxX),
      ty: U.clamp(z.ty, b.minY, b.maxY)
    };
  }

  Reader.renderCurrent = async function (opts) {
    if (!R || !R.source) return;
    if (R.mode === 'scroll') {
      await buildScroll(opts && opts.jumpTo ? opts.jumpTo : R.page);
      return;
    }
    el.paged.hidden = false;
    el.scroll.hidden = true;
    clearLayer(otherLayer());
    var layer = activeLayer();
    var size = await renderInto(layer, R.page);
    R.base = size;
    updatePageUi();
  };

  /* ---------------- navigation ---------------- */
  var going = false;

  Reader.goTo = async function (target, opts) {
    opts = opts || {};
    if (!R || !R.source) return;
    if (going) return;

    if (R.mode === 'scroll') {
      R.page = clampPage(R.book, target);
      scrollToPage(R.page, opts.smooth !== false);
      updatePageUi();
      return;
    }

    if (R.mode === 'double') target = spreadAnchor(target);
    target = clampPage(R.book, target);
    if (target === R.page && !opts.force) {
      updatePageUi();
      return;
    }

    var animate = opts.animate !== false && R.animate && !reduceMotion;
    var stage = stageSize();
    var dirSign = target > R.page ? 1 : -1;
    var visual = dirSign * (R.dir === 'rtl' ? -1 : 1);

    if (!animate) {
      R.page = target;
      await resetActiveLayer();
      updatePageUi();
      return;
    }

    going = true;
    var ghost = otherLayer();
    try {
      ghost.querySelector('.page-holder').innerHTML = '<div class="page-missing"><span class="spinner page-spinner"></span></div>';
      ghost.style.opacity = '1';
      ghost.style.transition = 'none';
      ghost.style.transform = 'translate3d(' + (visual * stage.w) + 'px,0,0)';
      ghost.style.zIndex = '2';
      activeLayer().style.zIndex = '1';
      await renderInto(ghost, target);
      // keep ghost positioned precisely (renderInto resets inner zoom only)
      ghost.style.transform = 'translate3d(' + (visual * stage.w) + 'px,0,0)';
      // force reflow
      void ghost.offsetWidth;
      var dur = 280;
      ghost.style.transition = 'transform ' + dur + 'ms cubic-bezier(.22,.68,0,1)';
      activeLayer().style.transition = 'transform ' + dur + 'ms cubic-bezier(.22,.68,0,1)';
      ghost.style.transform = 'translate3d(0,0,0)';
      activeLayer().style.transform = 'translate3d(' + (-visual * stage.w) + 'px,0,0)';
      await U.sleep(dur + 20);
      R.active = R.active === 'a' ? 'b' : 'a';
      R.page = target;
      var old = R.active === 'a' ? el.layerB : el.layerA;
      clearLayer(old);
      var act = activeLayer();
      act.style.transition = '';
      act.style.transform = '';
      act.style.zIndex = '';
      // re-apply centering for the new active layer
      var holder = act.querySelector('.page-holder');
      var contentW = parseFloat(act.querySelector('.zoom').style.width) || 0;
      var contentH = parseFloat(act.querySelector('.zoom').style.height) || 0;
      R.base = { w: contentW, h: contentH };
      resetZoom(act, contentW, contentH, stageSize());
      updatePageUi();
    } finally {
      going = false;
    }
  };

  async function resetActiveLayer() {
    var layer = activeLayer();
    var size = await renderInto(layer, R.page);
    R.base = size;
    updatePageUi();
  }

  Reader.next = function () {
    if (!R) return;
    if (R.mode === 'scroll') {
      var blocks = el.scroll.querySelectorAll('.scroll-page');
      var step = Math.max(1, Math.round(stageSize().h / Math.max(1, blocks[0] ? blocks[0].getBoundingClientRect().height : 1)));
      scrollToPage(Math.min(R.page + Math.max(1, step), R.source.pageCount - 1), true);
      return;
    }
    var target = R.mode === 'double' ? spreadStep(R.page, 1) : R.page + 1;
    if (target > R.source.pageCount - 1) {
      if (!R.book.finished) {
        finishBook();
      }
      return;
    }
    Reader.goTo(target);
  };

  Reader.prev = function () {
    if (!R) return;
    if (R.mode === 'scroll') {
      var blocks = el.scroll.querySelectorAll('.scroll-page');
      var step = Math.max(1, Math.round(stageSize().h / Math.max(1, blocks[0] ? blocks[0].getBoundingClientRect().height : 1)));
      scrollToPage(Math.max(0, R.page - Math.max(1, step)), true);
      return;
    }
    var target = R.mode === 'double' ? spreadStep(R.page, -1) : R.page - 1;
    Reader.goTo(Math.max(0, target));
  };

  function finishBook() {
    if (!R) return;
    if (!R.book.finished) {
      R.book.finished = true;
      U.toast('¡Has terminado el cómic! 🎉', 'ok', 3600);
    }
    updatePageUi();
  }

  /* ---------------- chrome / UI ---------------- */
  function updatePageUi() {
    if (!R) return;
    var total = R.source ? R.source.pageCount : 1;
    var pct = U.clamp(Math.round(((R.page + 1) / total) * 100), 0, 100);
    el.pageLabel.textContent = R.mode === 'double'
      ? pagePair(R.page, 'double').map(function (p) { return p + 1; }).join('–') + ' / ' + total
      : (R.page + 1) + ' / ' + total;
    el.meta.textContent = pct + '% · ' + (R.mode === 'scroll' ? 'tira vertical' : R.mode === 'double' ? 'página doble' : 'página única');
    el.sliderFill.style.width = pct + '%';
    el.sliderThumb.style.left = pct + '%';
    el.progress.style.width = pct + '%';
    el.slider.setAttribute('aria-valuenow', String(R.page + 1));
    el.slider.setAttribute('aria-valuetext', 'Página ' + (R.page + 1) + ' de ' + total);
    R.book.page = R.page;
    R.book.lastReadAt = Date.now();
    R.seen[R.page] = true;
    saveProgressThrottled();
    updateBookmarkButton();
    updateModeIcon();
    preloadNeighbours();
    if (R.mode === 'scroll' && R.source) pinNearbyScrollPages();
  }

  /** Decode/cache the adjacent pages so page turns feel instant. */
  var preloadTimer = null;
  function preloadNeighbours() {
    if (!R || !R.source || R.source.type !== 'cbz') return;
    if (preloadTimer) clearTimeout(preloadTimer);
    preloadTimer = setTimeout(function () {
      preloadTimer = null;
      if (!R || !R.source) return;
      var total = R.source.pageCount;
      var forward = R.dir === 'rtl' ? [-1, -2, 1] : [1, 2, -1];
      var indices = [];
      (R.mode === 'double' ? [spreadStep(R.page, 1), spreadStep(R.page, -1)] : forward).forEach(function (i) {
        if (i >= 0 && i < total && indices.indexOf(i) === -1) indices.push(i);
      });
      R.source.pin(indices.concat([R.page, R.page + 1, R.page - 1]));
      indices.forEach(function (i) {
        try { R.source.urlFor(i); } catch (e) { /* ignore */ }
      });
    }, 90);
  }

  var progressTimer = null;
  function saveProgressThrottled() {
    if (progressTimer) return;
    progressTimer = setTimeout(async function () {
      progressTimer = null;
      if (!R) return;
      try {
        await Library.saveProgress(R.book, R.page);
        Library.renderContinue();
        if (R.book.finished) maybeSendChatProgress(true);
      } catch (e) { /* ignore */ }
    }, 400);
  }

  function updateModeIcon() {
    var btn = U.$('#btnMode');
    if (!btn) return;
    var map = { single: 'single', double: 'double', scroll: 'scroll' };
    btn.innerHTML = U.icon(map[R.mode] || 'single');
  }

  function updateBookmarkButton() {
    if (!R) return;
    var has = R.bookmarks.some(function (b) { return b.page === R.page; });
    el.bookmark.classList.toggle('is-on', has);
    el.bookmark.setAttribute('aria-pressed', has ? 'true' : 'false');
  }

  function paintChrome() {
    el.stage.dataset.bg = R.bg;
    el.stage.style.background = R.bg === 'white' ? '#eef0f4' : R.bg === 'charcoal' ? '#16161b' : '#06060a';
    el.brightness.style.opacity = String(U.clamp(1 - R.brightness, 0, 0.85));
    el.root.classList.toggle('is-night', !!R.night);
    el.progress.style.width = '0%';
  }

  function setChrome(show) {
    if (!R) return;
    R.chrome = show;
    el.root.classList.toggle('is-immersive', !show);
    if (show) scheduleChromeHide();
  }

  function scheduleChromeHide() {
    if (!R) return;
    if (el.root.classList.contains('is-immersive')) return;
    if (R.chromeTimer) clearTimeout(R.chromeTimer);
    R.chromeTimer = setTimeout(function () {
      if (!R) return;
      if (R.mode === 'scroll') return;
      setChrome(false);
    }, 4200);
  }

  function toggleChrome() {
    if (!R) return;
    setChrome(!R.chrome);
  }

  /* ---------------- bookmarks ---------------- */
  Reader.toggleBookmark = async function () {
    if (!R) return;
    var existing = R.bookmarks.find(function (b) { return b.page === R.page; });
    if (existing) {
      await DB.del('bookmarks', existing.id);
      R.bookmarks = R.bookmarks.filter(function (b) { return b.id !== existing.id; });
      U.toast('Marcador eliminado', 'ok', 1800);
    } else {
      var mk = { id: U.uid(), bookId: R.book.id, page: R.page, note: '', createdAt: Date.now() };
      await DB.put('bookmarks', mk);
      R.bookmarks.push(mk);
      U.toast('Página ' + (R.page + 1) + ' marcada', 'ok', 1800);
    }
    updateBookmarkButton();
  };

  /* ---------------- scroll mode ---------------- */
  var scrollBuildToken = 0;

  async function buildScroll(startPage) {
    var token = ++scrollBuildToken;
    el.paged.hidden = true;
    el.scroll.hidden = false;
    el.scroll.innerHTML = '';
    el.scroll.scrollTop = 0;
    var stage = stageSize();
    var aspectHint = R.book.aspect || 1.5;

    // measure first page aspect for placeholders
    try {
      var first = await sourcePageAspect(startPage);
      if (first) aspectHint = first;
    } catch (e) { /* keep hint */ }
    if (token !== scrollBuildToken) return;

    var frag = document.createDocumentFragment();
    for (var i = 0; i < R.source.pageCount; i++) {
      var block = document.createElement('div');
      block.className = 'scroll-page is-pending';
      block.dataset.index = String(i);
      block.style.minHeight = Math.round(stage.w * aspectHint) + 'px';
      block.style.setProperty('--gap', '8px');
      var num = document.createElement('span');
      num.className = 'scroll-page__num';
      num.textContent = String(i + 1);
      block.appendChild(num);
      frag.appendChild(block);
    }
    el.scroll.appendChild(frag);

    if (typeof IntersectionObserver === 'function') {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var target = entry.target;
          var idx = parseInt(target.dataset.index, 10);
          if (entry.isIntersecting && !target.dataset.rendered) {
            target.dataset.rendered = '1';
            renderScrollPage(target, idx);
          }
        });
      }, { root: el.scroll, rootMargin: '120% 0px' });
      R.scrollObserver = observer;
      U.$$('.scroll-page', el.scroll).forEach(function (b) { observer.observe(b); });
    } else {
      // Fallback for webviews without IntersectionObserver
      var renderVisible = function () {
        var vh = el.scroll.clientHeight;
        var top = el.scroll.scrollTop;
        U.$$('.scroll-page', el.scroll).forEach(function (block) {
          if (block.dataset.rendered) return;
          if (block.offsetTop < top + vh * 2 && block.offsetTop + block.offsetHeight > top - vh) {
            block.dataset.rendered = '1';
            renderScrollPage(block, parseInt(block.dataset.index, 10));
          }
        });
      };
      el.scroll.addEventListener('scroll', renderVisible, { passive: true });
      R.scrollFallback = renderVisible;
      renderVisible();
    }

    el.scroll.addEventListener('scroll', onScroll, { passive: true });
    el.scroll.addEventListener('scroll', updateScrollPageFromView, { passive: true });

    await U.nextFrame();
    if (token !== scrollBuildToken) return;
    if (R.scrollFallback) R.scrollFallback();
    scrollToPage(startPage, false);
    updateScrollPageFromView();
    updatePageUi();
    scheduleChromeHide();
  }

  async function sourcePageAspect(index) {
    try {
      if (R.source.type === 'cbz') {
        var url = await R.source.urlFor(index);
        var img = await new Promise(function (res) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = url; });
        return img ? img.naturalHeight / img.naturalWidth : null;
      }
      var size = await R.source.pageSize(index);
      return size.height / size.width;
    } catch (e) { return null; }
  }

  async function renderScrollPage(block, index) {
    try {
      if (R.source.type === 'cbz') {
        var url = await R.source.urlFor(index);
        if (!block.isConnected) return;
        var img = new Image();
        img.src = url;
        img.alt = 'Página ' + (index + 1);
        img.loading = 'lazy';
        img.decoding = 'async';
        img.onload = function () {
          block.style.minHeight = '';
          block.classList.remove('is-pending');
        };
        block.insertBefore(img, block.firstChild);
      } else {
        var stage = stageSize();
        var size = await R.source.pageSize(index);
        var blockW = el.scroll.clientWidth || stage.w;
        var h = Math.round(blockW * (size.height / size.width));
        var canvas = await R.source.renderCanvas(index, blockW, h);
        if (!block.isConnected) return;
        block.style.minHeight = '';
        block.classList.remove('is-pending');
        block.insertBefore(canvas, block.firstChild);
      }
    } catch (err) {
      block.classList.remove('is-pending');
      block.innerHTML = '<div class="page-missing">Página no disponible</div>';
    }
  }

  function scrollToPage(index, smooth) {
    var node = el.scroll.querySelector('.scroll-page[data-index="' + index + '"]');
    if (!node) return;
    var top = node.offsetTop;
    if (smooth) el.scroll.scrollTo({ top: top, behavior: 'smooth' });
    else el.scroll.scrollTop = top;
    R.page = index;
  }

  var scrollRaf = null;
  function onScroll() {
    if (!R || R.mode !== 'scroll') return;
    if (scrollRaf) return;
    scrollRaf = U.raf(function () {
      scrollRaf = null;
      if (!R) return;
      el.progress.style.width = ((el.scroll.scrollTop + el.scroll.clientHeight / 2) / el.scroll.scrollHeight * 100) + '%';
    });
  }

  function updateScrollPageFromView() {
    if (!R || R.mode !== 'scroll') return;
    var blocks = el.scroll.querySelectorAll('.scroll-page');
    if (!blocks.length) return;
    var mid = el.scroll.scrollTop + el.scroll.clientHeight / 2;
    var best = 0, bestDist = Infinity;
    for (var i = 0; i < blocks.length; i++) {
      var center = blocks[i].offsetTop + blocks[i].offsetHeight / 2;
      var d = Math.abs(center - mid);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best !== R.page) {
      R.page = best;
      updatePageUi();
      updateBookmarkButton();
    }
  }

  function pinNearbyScrollPages() {
    if (!R || R.source.type !== 'cbz') return;
    var keep = [];
    for (var i = Math.max(0, R.page - 2); i <= Math.min(R.source.pageCount - 1, R.page + 4); i++) keep.push(i);
    R.source.pin(keep);
  }

  /* ---------------- gestures ---------------- */
  function initGestures() {
    var pointers = new Map();
    var gesture = null;

    el.stage.addEventListener('pointerdown', function (e) {
      if (!R) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { el.stage.setPointerCapture(e.pointerId); } catch (err) {}

      if (pointers.size === 2) {
        startPinch();
        return;
      }
      if (pointers.size > 2) return;

      gesture = {
        mode: null,
        startX: e.clientX, startY: e.clientY,
        lastX: e.clientX, lastY: e.clientY,
        startTime: Date.now(),
        moved: false,
        zoomStart: Object.assign({}, R.zoom),
        baseW: R.base.w, baseH: R.base.h,
        stage: stageSize(),
        dragTarget: null,
        ghostReady: false,
        dx: 0,
        vx: 0,
        lastT: Date.now()
      };
      if (R.mode === 'paged' || R.mode === 'single' || R.mode === 'double') {
        // prepare neighbour preview lazily on first horizontal movement
      }
    });

    el.stage.addEventListener('pointermove', function (e) {
      if (!R) return;
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinch) { movePinch(); return; }
      if (!gesture) return;

      var dx = e.clientX - gesture.startX;
      var dy = e.clientY - gesture.startY;
      gesture.dx = dx;
      var now = Date.now();
      var dt = Math.max(1, now - gesture.lastT);
      gesture.vx = (e.clientX - gesture.lastX) / dt;
      gesture.lastX = e.clientX; gesture.lastY = e.clientY; gesture.lastT = now;

      if (!gesture.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        gesture.moved = true;
        // decide intent
        var zoomed = R.zoom.scale > 1.02;
        var overflowX = R.base.w * R.zoom.scale > gesture.stage.w + 2;
        var overflowY = R.base.h * R.zoom.scale > gesture.stage.h + 2;
        if (zoomed) gesture.mode = 'pan';
        else if (Math.abs(dx) > Math.abs(dy)) gesture.mode = overflowX ? 'pan' : 'swipe';
        else gesture.mode = overflowY ? 'pan' : 'none';
        if (R.mode === 'scroll') gesture.mode = 'none';
      }

      if (gesture.mode === 'swipe') {
        var direction = swipeDirection(dx);
        var stage = gesture.stage;
        var target = R.mode === 'double' ? spreadStep(R.page, direction) : R.page + direction;
        var can = target >= 0 && target <= R.source.pageCount - 1;
        if (!can) {
          var rubber = (gesture.dx) * 0.28;
          activeLayer().style.transform = 'translate3d(' + rubber + 'px,0,0)';
          return;
        }
        activeLayer().style.transform = 'translate3d(' + dx + 'px,0,0)';
        var ghost = otherLayer();
        if (!gesture.ghostPrepared) {
          gesture.ghostPrepared = true;
          gesture.ghostTarget = target;
          ghost.style.transition = 'none';
          ghost.style.opacity = '1';
          ghost.style.zIndex = '2';
          ghost.querySelector('.page-holder').innerHTML = '<div class="page-missing"></div>';
          renderInto(ghost, target).then(function () {
            if (!gesture || !R) return;
            ghost.style.transform = 'translate3d(' + (dx < 0 ? stage.w : -stage.w) + 'px,0,0)';
          });
        }
        var ghostOffset = dx < 0 ? stage.w : -stage.w;
        ghost.style.transform = 'translate3d(' + (dx + ghostOffset) + 'px,0,0)';
      } else if (gesture.mode === 'pan') {
        var z = gesture.zoomStart;
        var next = { scale: z.scale, tx: z.tx + dx, ty: z.ty + dy };
        R.zoom = clampZoom(next, gesture.baseW, gesture.baseH, gesture.stage);
        applyZoom(activeLayer(), R.zoom);
      }
    });

    function endPointer(e) {
      if (!R) { pointers.clear(); return; }
      pointers.delete(e.pointerId);
      if (pinch && pointers.size < 2) {
        finishPinch();
        return;
      }
      if (!gesture) return;
      var g = gesture;
      gesture = null;
      if (g.mode === 'swipe') {
        var stage = g.stage;
        var threshold = stage.w * 0.2;
        var direction = swipeDirection(g.dx);
        var target = R.mode === 'double' ? spreadStep(R.page, direction) : R.page + direction;
        var can = target >= 0 && target <= R.source.pageCount - 1;
        var commit = can && (Math.abs(g.dx) > threshold || Math.abs(g.vx) > 0.45);
        var ghost = otherLayer();
        if (commit && g.ghostPrepared) {
          var dur = 240;
          activeLayer().style.transition = 'transform ' + dur + 'ms cubic-bezier(.22,.68,0,1)';
          ghost.style.transition = 'transform ' + dur + 'ms cubic-bezier(.22,.68,0,1)';
          activeLayer().style.transform = 'translate3d(' + (g.dx < 0 ? -stage.w : stage.w) + 'px,0,0)';
          ghost.style.transform = 'translate3d(0,0,0)';
          var prevLayer = activeLayer();
          setTimeout(function () {
            if (!R) return;
            R.active = R.active === 'a' ? 'b' : 'a';
            R.page = clampPage(R.book, target);
            clearLayer(prevLayer);
            var act = activeLayer();
            act.style.transition = ''; act.style.transform = ''; act.style.zIndex = '';
            var contentW = parseFloat(act.querySelector('.zoom').style.width) || 0;
            var contentH = parseFloat(act.querySelector('.zoom').style.height) || 0;
            R.base = { w: contentW, h: contentH };
            resetZoom(act, contentW, contentH, stageSize());
            updatePageUi();
          }, dur + 10);
        } else {
          var back = 220;
          activeLayer().style.transition = 'transform ' + back + 'ms cubic-bezier(.22,.68,0,1)';
          activeLayer().style.transform = '';
          ghost.style.transition = 'transform ' + back + 'ms cubic-bezier(.22,.68,0,1)';
          ghost.style.transform = 'translate3d(' + (g.dx < 0 ? stage.w : -stage.w) + 'px,0,0)';
          setTimeout(function () {
            if (!R) return;
            clearLayer(ghost);
            activeLayer().style.transition = '';
            activeLayer().style.transform = '';
          }, back + 20);
        }
        scheduleChromeHide();
        return;
      }
      if (g.mode === 'pan') {
        scheduleChromeHide();
        return;
      }
      // tap
      var dt = Date.now() - g.startTime;
      if (!g.moved && dt < 400) handleTap(g.startX, g.startY);
    }

    el.stage.addEventListener('pointerup', endPointer);
    el.stage.addEventListener('pointercancel', endPointer);

    /* wheel / trackpad zoom on desktop */
    el.stage.addEventListener('wheel', function (e) {
      if (!R) return;
      if (R.mode === 'scroll' && !e.ctrlKey) return; // let the strip scroll normally
      if (R.mode !== 'scroll' || e.ctrlKey) {
        e.preventDefault();
        var factor = Math.exp(-e.deltaY * 0.0022);
        var target = U.clamp(R.zoom.scale * factor, 1, 6);
        zoomAt(e.clientX, e.clientY, target);
        scheduleChromeHide();
      }
    }, { passive: false });

    /* pinch */
    var pinch = null;
    function startPinch() {
      if (!R) return;
      var pts = Array.from(pointers.values());
      if (pts.length < 2) return;
      var mx = (pts[0].x + pts[1].x) / 2;
      var my = (pts[0].y + pts[1].y) / 2;
      var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      pinch = {
        dist: dist, midX: mx, midY: my,
        zoom: Object.assign({}, R.zoom),
        stage: stageSize(),
        baseW: R.base.w, baseH: R.base.h
      };
      if (gesture) { gesture.mode = 'none'; }
      if (activeLayer()) activeLayer().style.transition = 'none';
    }
    function movePinch() {
      if (!pinch || !R) return;
      var pts = Array.from(pointers.values());
      if (pts.length < 2) return;
      var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      var mx = (pts[0].x + pts[1].x) / 2;
      var my = (pts[0].y + pts[1].y) / 2;
      var ratio = dist / pinch.dist;
      var newScale = U.clamp(pinch.zoom.scale * ratio, 1, 6);
      var z = pinch.zoom;
      var tx = mx - (pinch.midX - z.tx) * (newScale / z.scale);
      var ty = my - (pinch.midY - z.ty) * (newScale / z.scale);
      var next = clampZoom({ scale: newScale, tx: tx, ty: ty }, pinch.baseW, pinch.baseH, pinch.stage);
      R.zoom = next;
      applyZoom(activeLayer(), next);
    }
    function finishPinch() {
      pinch = null;
      if (!R) return;
      if (R.zoom.scale < 1.05) {
        R.zoom = { scale: 1, tx: R.zoom.tx, ty: R.zoom.ty };
        var stage = stageSize();
        R.zoom = clampZoom(R.zoom, R.base.w, R.base.h, stage);
        applyZoom(activeLayer(), R.zoom);
      }
      scheduleChromeHide();
    }

    /* double tap */
    var lastTap = { t: 0, x: 0, y: 0 };
    function handleTap(x, y) {
      var now = Date.now();
      if (now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
        lastTap.t = 0;
        if (R.zoom.scale > 1.05) {
          R.zoom = { scale: 1, tx: R.zoom.tx, ty: R.zoom.ty };
          R.zoom = clampZoom(R.zoom, R.base.w, R.base.h, stageSize());
          activeLayer().style.transition = 'transform .22s ease';
          applyZoom(activeLayer(), R.zoom);
          setTimeout(function () { if (R) activeLayer().style.transition = ''; }, 240);
        } else {
          zoomAt(x, y, Math.min(2.6, 6));
        }
        return;
      }
      lastTap = { t: now, x: x, y: y };

      // tap zones
      if (R.mode === 'scroll') { toggleChrome(); return; }
      var stage = stageSize();
      var rel = x / stage.w;
      var isRtl = R.dir === 'rtl';
      if (rel < 0.26) { isRtl ? Reader.next() : Reader.prev(); return; }
      if (rel > 0.74) { isRtl ? Reader.prev() : Reader.next(); return; }
      toggleChrome();
    }
  }

  function zoomAt(x, y, scale) {
    if (!R) return;
    var stage = stageSize();
    var z = R.zoom;
    var newScale = U.clamp(scale, 1, 6);
    var tx = x - (x - z.tx) * (newScale / z.scale);
    var ty = y - (y - z.ty) * (newScale / z.scale);
    var next = clampZoom({ scale: newScale, tx: tx, ty: ty }, R.base.w, R.base.h, stage);
    R.zoom = next;
    var layer = activeLayer();
    layer.style.transition = 'transform .2s ease';
    applyZoom(layer, next);
    setTimeout(function () { if (R) layer.style.transition = ''; }, 230);
  }

  /* ---------------- reader UI wiring ---------------- */
  function initUi() {
    U.$('#btnReaderBack').addEventListener('click', function () { Reader.close(); });
    U.$('#btnPrev').addEventListener('click', function () { Reader.prev(); scheduleChromeHide(); });
    U.$('#btnNext').addEventListener('click', function () { Reader.next(); scheduleChromeHide(); });
    U.$('#btnBookmark').addEventListener('click', function () { Reader.toggleBookmark(); scheduleChromeHide(); });
    U.$('#btnMode').addEventListener('click', function () { cycleMode(); });
    U.$('#btnReaderMore').addEventListener('click', openReaderMenu);
    U.$('#btnReaderSettings').addEventListener('click', openReaderSettings);
    U.$('#btnThumbs').addEventListener('click', openThumbnails);

    /* slider */
    var track = el.slider;
    var scrubbing = false;
    function positionFromEvent(e) {
      var r = track.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      return U.clamp(x / r.width, 0, 1);
    }
    function scrub(e) {
      var pos = positionFromEvent(e);
      var index = Math.round(pos * (R.source.pageCount - 1));
      el.sliderFill.style.width = (pos * 100) + '%';
      el.sliderThumb.style.left = (pos * 100) + '%';
      el.pageLabel.textContent = (index + 1) + ' / ' + R.source.pageCount;
      return index;
    }
    el.slider.addEventListener('pointerdown', function (e) {
      if (!R) return;
      scrubbing = true;
      el.slider.classList.add('is-scrubbing');
      try { el.slider.setPointerCapture(e.pointerId); } catch (err) {}
      scrub(e);
      e.preventDefault();
    });
    el.slider.addEventListener('pointermove', function (e) { if (scrubbing) scrub(e); });
    el.slider.addEventListener('pointerup', function (e) {
      if (!scrubbing || !R) return;
      scrubbing = false;
      el.slider.classList.remove('is-scrubbing');
      var target = scrub(e);
      if (R.mode === 'scroll') { R.page = target; scrollToPage(target, false); updatePageUi(); }
      else Reader.goTo(target, { animate: false });
      updatePageUi();
      scheduleChromeHide();
    });
    el.slider.addEventListener('pointercancel', function () { scrubbing = false; el.slider.classList.remove('is-scrubbing'); });
    el.slider.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { Reader.next(); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { Reader.prev(); e.preventDefault(); }
    });

    /* keyboard */
    document.addEventListener('keydown', function (e) {
      if (!R) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': case ' ':
          if (R.dir === 'rtl') Reader.prev(); else Reader.next();
          e.preventDefault(); break;
        case 'ArrowLeft': case 'PageUp':
          if (R.dir === 'rtl') Reader.next(); else Reader.prev();
          e.preventDefault(); break;
        case 'Home': Reader.goTo(0); e.preventDefault(); break;
        case 'End': Reader.goTo(R.source.pageCount - 1); e.preventDefault(); break;
        case 'Escape':
          if (U.hasOpenSheet && U.hasOpenSheet()) break;
          Reader.close(); e.preventDefault(); break;
        case 'f': case 'F': toggleFullscreen(); break;
        case 'm': case 'M': Reader.toggleBookmark(); break;
        case '+': case '=': zoomAt(stageSize().w / 2, stageSize().h / 2, R.zoom.scale * 1.3); break;
        case '-': zoomAt(stageSize().w / 2, stageSize().h / 2, R.zoom.scale / 1.3); break;
        case 'b': case 'B': cycleMode(); break;
        case 't': case 'T': openThumbnails(); break;
      }
      scheduleChromeHide();
    });

    /* resize */
    window.addEventListener('resize', U.debounce(async function () {
      if (!R) return;
      if (R.mode === 'scroll') {
        // keep position roughly stable
        var idx = R.page;
        await buildScroll(idx);
      } else {
        R.active && await resetActiveLayer();
      }
    }, 250));

    /* history back */
    window.addEventListener('popstate', function () {
      if (R) Reader.close();
    });

    initGestures();
  }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    } catch (e) { /* ignore */ }
  }

  /* ---------------- modes / settings ---------------- */
  function setMode(mode, opts) {
    if (!R) return;
    mode = mode || 'single';
    if (mode === R.mode) return;
    var wasPage = R.page;
    R.mode = mode;
    R.book.prefs = Object.assign({}, R.book.prefs, { mode: mode });
    persistPrefs();
    if (mode === 'scroll') {
      buildScroll(wasPage);
    } else {
      scrollBuildToken++;
      if (R.scrollObserver) { R.scrollObserver.disconnect(); R.scrollObserver = null; }
      el.scroll.hidden = true;
      el.paged.hidden = false;
      R.page = clampPage(R.book, wasPage);
      resetActiveLayer();
    }
    updatePageUi();
    if (!opts || opts.toast !== false) {
      U.toast(mode === 'single' ? 'Página única' : mode === 'double' ? 'Página doble' : 'Tira vertical', 'info', 1600);
    }
  }
  Reader.setMode = setMode;
  Reader.setDir = setDir;
  Reader.setFit = setFit;
  Reader.setBackground = setBackground;
  Reader.setBrightness = setBrightness;
  Reader.toggleNight = toggleNight;

  function cycleMode() {
    var order = ['single', 'double', 'scroll'];
    var idx = order.indexOf(R.mode);
    setMode(order[(idx + 1) % order.length]);
  }

  function setDir(dir) {
    if (!R) return;
    R.dir = dir;
    R.book.prefs = Object.assign({}, R.book.prefs, { dir: dir });
    persistPrefs();
    U.toast(dir === 'rtl' ? 'Dirección: derecha → izquierda' : 'Dirección: izquierda → derecha', 'info', 1600);
  }

  function setFit(fit) {
    if (!R) return;
    R.fit = fit;
    R.book.prefs = Object.assign({}, R.book.prefs, { fit: fit });
    persistPrefs();
    if (R.mode === 'scroll') buildScroll(R.page);
    else resetActiveLayer();
  }

  function setBackground(bg) {
    if (!R) return;
    R.bg = bg;
    R.book.prefs = Object.assign({}, R.book.prefs, { bg: bg });
    persistPrefs();
    paintChrome();
  }

  function setBrightness(value) {
    if (!R) return;
    R.brightness = value;
    R.book.prefs = Object.assign({}, R.book.prefs, { brightness: value });
    persistPrefs();
    paintChrome();
  }

  function toggleNight() {
    if (!R) return;
    R.night = !R.night;
    R.book.prefs = Object.assign({}, R.book.prefs, { night: R.night });
    persistPrefs();
    paintChrome();
    return R.night;
  }

  function toggleAnimate() {
    if (!R) return;
    R.animate = !R.animate;
    R.book.prefs = Object.assign({}, R.book.prefs, { animate: R.animate });
    persistPrefs();
    return R.animate;
  }

  var prefsTimer = null;
  function persistPrefs() {
    if (!R) return;
    var book = R.book;
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(function () { DB.put('books', book).catch(function () {}); }, 300);
  }

  function openReaderSettings() {
    if (!R) return;
    var body = U.el('div');

    function segmented(options, current, onChange) {
      var wrap = U.el('div', { class: 'segmented' });
      options.forEach(function (o) {
        var btn = U.el('button', { class: current === o.id ? 'is-active' : '', html: (o.icon ? U.icon(o.icon) : '') + '<span>' + o.label + '</span>' });
        btn.addEventListener('click', function () {
          Array.prototype.forEach.call(wrap.children, function (c) { c.classList.remove('is-active'); });
          btn.classList.add('is-active');
          onChange(o.id);
        });
        wrap.appendChild(btn);
      });
      return wrap;
    }

    function block(label, content, wide) {
      var b = U.el('div', { class: 'rs-block' + (wide ? ' rs-block--wide' : '') });
      b.appendChild(U.el('div', { class: 'rs-block__label', text: label }));
      b.appendChild(content);
      return b;
    }

    var grid = U.el('div', { class: 'rs-grid' });
    grid.appendChild(block('Modo', segmented([
      { id: 'single', icon: 'single', label: 'Página' },
      { id: 'double', icon: 'double', label: 'Doble' },
      { id: 'scroll', icon: 'scroll', label: 'Tira' }
    ], R.mode, setMode)));
    grid.appendChild(block('Dirección', segmented([
      { id: 'ltr', icon: 'ltr', label: 'Izq.' },
      { id: 'rtl', icon: 'rtl', label: 'Der.' }
    ], R.dir, setDir)));
    grid.appendChild(block('Ajuste', segmented([
      { id: 'page', icon: 'fit-page', label: 'Página' },
      { id: 'width', icon: 'fit-width', label: 'Ancho' },
      { id: 'height', icon: 'fit-height', label: 'Alto' }
    ], R.fit, setFit)));
    grid.appendChild(block('Fondo', segmented([
      { id: 'black', label: 'Negro' },
      { id: 'charcoal', label: 'Gris' },
      { id: 'white', label: 'Claro' }
    ], R.bg, setBackground)));

    var bright = U.el('div', { class: 'brightness-row' });
    bright.innerHTML = U.icon('moon') + '<input type="range" min="25" max="100" value="' + Math.round(R.brightness * 100) + '" aria-label="Brillo">' + U.icon('sun');
    var range = bright.querySelector('input');
    range.addEventListener('input', function () { setBrightness(parseInt(range.value, 10) / 100); });
    grid.appendChild(block('Brillo', bright, true));

    // toggles
    var toggles = U.el('div', { style: { marginTop: '14px' } });
    function toggleRow(icon, title, sub, value, onChange) {
      var row = U.el('div', { class: 'setting-row' });
      row.innerHTML = '<div class="setting-row__ico">' + U.icon(icon) + '</div>' +
        '<div class="setting-row__body"><div class="setting-row__title">' + title + '</div><div class="setting-row__sub">' + sub + '</div></div>';
      var sw = U.el('button', { class: 'switch' + (value ? ' is-on' : ''), role: 'switch', 'aria-checked': value ? 'true' : 'false' });
      sw.addEventListener('click', function () {
        var next = !sw.classList.contains('is-on');
        sw.classList.toggle('is-on', next);
        sw.setAttribute('aria-checked', next ? 'true' : 'false');
        onChange(next);
      });
      row.appendChild(sw);
      return row;
    }
    toggles.appendChild(toggleRow('moon', 'Modo nocturno', 'Reduce el brillo azul para leer de noche', R.night, function () { toggleNight(); }));
    toggles.appendChild(toggleRow('scroll', 'Animación de página', 'Desliza las páginas con transición', R.animate, function () { toggleAnimate(); }));
    var savedDefaults = App.settings.reader;
    toggles.appendChild(toggleRow('check', 'Usar como predeterminado', 'Aplicar este modo a todos los cómics nuevos', savedDefaults.mode === R.mode && savedDefaults.fit === R.fit && savedDefaults.dir === R.dir, function (on) {
      if (on) {
        App.saveSetting('reader', Object.assign({}, savedDefaults, { mode: R.mode, fit: R.fit, dir: R.dir, bg: R.bg }));
        U.toast('Ajustes guardados como predeterminados', 'ok', 1800);
      }
    }));
    grid.appendChild(toggles);
    body.appendChild(grid);

    U.sheet({ title: 'Ajustes de lectura', sub: R.book.title, content: body });
  }

  function openReaderMenu() {
    if (!R) return;
    var content = U.el('div', { class: 'sheet-menu' });
    function item(icon, label, sub, fn) {
      var b = U.el('button', { class: 'menu-item', html: U.icon(icon) });
      var wrap = U.el('span', { class: 'menu-item__label' });
      wrap.appendChild(document.createTextNode(label));
      if (sub) wrap.appendChild(U.el('small', { text: sub }));
      b.appendChild(wrap);
      b.addEventListener('click', function () { sheet.close(); setTimeout(fn, 80); });
      content.appendChild(b);
    }
    item('thumbs', 'Miniaturas', 'Ir a una página', openThumbnails);
    item('bookmark', R.bookmarks.some(function (m) { return m.page === R.page; }) ? 'Quitar marcador' : 'Marcar esta página', 'Página ' + (R.page + 1), function () { Reader.toggleBookmark(); });
    item('fit-page', 'Ajustes de lectura', 'Modo, brillo, fondo…', openReaderSettings);
    item('info', 'Detalles del cómic', 'Metadatos, colecciones, notas', function () { Reader.close(); setTimeout(function () { Library.openDetails(R ? R.book.id : ''); }, 200); });
    item('share', 'Compartir archivo', 'Enviar el cómic al chat', function () {
      Library.exportBook(R.book);
    });
    item('fullscreen', 'Pantalla completa', null, toggleFullscreen);
    var sheet = U.sheet({ title: 'Lector', sub: R.book.title, content: content });
  }

  /* ---------------- thumbnails ---------------- */
  async function openThumbnails() {
    if (!R || !R.source) return;
    var content = U.el('div');
    var grid = U.el('div', { class: 'thumb-grid' });
    content.appendChild(U.el('div', { class: 'sheet__sub', style: { padding: '0 0 10px' }, text: R.source.pageCount + ' páginas · toca para saltar' }));
    content.appendChild(grid);

    var urls = [];
    var io = null;
    var items = [];
    var aspect = R.book.aspect || 1.5;
    var sheet = U.sheet({
      title: 'Miniaturas',
      content: content,
      wide: true,
      onClose: function () {
        if (io) io.disconnect();
        urls.forEach(function (u) { URL.revokeObjectURL(u); });
        urls = [];
      }
    });

    for (var i = 0; i < R.source.pageCount; i++) {
      var thumb = U.el('button', { class: 'thumb' + (i === R.page ? ' is-current' : ''), 'data-page': String(i), 'aria-label': 'Página ' + (i + 1) });
      thumb.style.aspectRatio = '1 / ' + aspect.toFixed(3);
      thumb.innerHTML = '<span class="thumb__ph">' + (i + 1) + '</span><span class="thumb__num">' + (i + 1) + '</span>';
      grid.appendChild(thumb);
      items.push({ el: thumb, index: i, rendered: false, pending: false });
    }

    async function loadThumb(item) {
      if (!item || item.rendered || item.pending) return;
      item.pending = true;
      try {
        if (R.source.type === 'cbz') {
          var url = await R.source.rawUrl(item.index);
          if (!item.el.isConnected) { URL.revokeObjectURL(url); return; }
          urls.push(url);
          var img = document.createElement('img');
          img.loading = 'lazy';
          img.decoding = 'async';
          img.alt = '';
          img.onload = function () {
            var ph = item.el.querySelector('.thumb__ph');
            if (ph) ph.remove();
            item.rendered = true;
          };
          item.el.insertBefore(img, item.el.firstChild);
          img.src = url;
        } else {
          var size = await R.source.pageSize(item.index);
          var w = 160;
          var h = Math.round(w * (size.height / size.width));
          var canvas = await R.source.renderCanvas(item.index, w, h);
          if (!item.el.isConnected) return;
          var ph2 = item.el.querySelector('.thumb__ph');
          if (ph2) ph2.remove();
          item.el.insertBefore(canvas, item.el.firstChild);
          item.rendered = true;
        }
      } catch (e) {
        item.pending = false;
      }
    }

    grid.addEventListener('click', function (e) {
      var t = e.target.closest('[data-page]');
      if (!t) return;
      var page = parseInt(t.getAttribute('data-page'), 10);
      sheet.close();
      setTimeout(function () {
        if (!R) return;
        if (R.mode === 'scroll') { R.page = page; scrollToPage(page, false); updatePageUi(); }
        else Reader.goTo(page, { animate: false });
        scheduleChromeHide();
      }, 180);
    });

    // Create the observer only once the sheet is actually on screen,
    // otherwise entries are reported while the sheet is still translated
    // below the viewport and never fire again.
    var startObserving = function () {
      if (!items.length) return;
      if (typeof IntersectionObserver === 'function') {
        io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var idx = parseInt(entry.target.dataset.page, 10);
            loadThumb(items[idx]);
          });
        }, { root: null, rootMargin: '400px 0px' });
        items.forEach(function (item) { io.observe(item.el); });
      }
      // always preload around the current page
      for (var k = Math.max(0, R.page - 3); k <= Math.min(items.length - 1, R.page + 6); k++) {
        loadThumb(items[k]);
      }
    };

    setTimeout(function () {
      var cur = grid.querySelector('.thumb.is-current');
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center' });
      startObserving();
    }, 340);
  }

  /* ---------------- sessions, stats, wake lock ---------------- */
  var sessionTimer = null;
  var wakeLock = null;

  function startSessionTimer() {
    stopSessionTimer();
    sessionTimer = setInterval(function () {
      if (!R) return;
      if (document.hidden) return;
      R.sessionSeconds += 1;
      var pages = Object.keys(R.seen).length;
      if (R.sessionSeconds % 20 === 0) {
        flushStats(R);
      }
      if (R.sessionSeconds % 12 === 0) {
        maybeSyncProgress(R.book);
      }
    }, 1000);
  }

  function stopSessionTimer() {
    if (sessionTimer) { clearInterval(sessionTimer); sessionTimer = null; }
  }

  /** Write the reading activity accumulated since the last flush to IndexedDB. */
  async function flushStats(runtime) {
    if (!runtime || runtime.destroyed && !runtime.flushed) { /* still allow final flush */ }
    if (!runtime) return;
    var totalSec = runtime.sessionSeconds || 0;
    var pages = Object.keys(runtime.seen).length;
    var deltaSec = totalSec - (runtime.flushedSeconds || 0);
    var deltaPages = pages - (runtime.flushedPages || 0);
    if (deltaSec <= 0 && deltaPages <= 0) return;
    runtime.flushedSeconds = totalSec;
    runtime.flushedPages = pages;
    try {
      var day = U.dayKey();
      var row = await DB.get('stats', day);
      row = row || { date: day, seconds: 0, pages: 0 };
      row.seconds = (row.seconds || 0) + deltaSec;
      row.pages = (row.pages || 0) + deltaPages;
      await DB.put('stats', row);
    } catch (e) { /* storage hiccup — never break reading */ }
  }

  async function persistSession(runtime) {
    if (!runtime) return;
    var seconds = runtime.sessionSeconds || 0;
    var pages = Object.keys(runtime.seen).length;
    if (seconds > 0 || pages > 0) {
      runtime.book.readingTime = (runtime.book.readingTime || 0) + Math.max(0, seconds - (runtime.countedSeconds || 0));
      runtime.countedSeconds = seconds;
      await flushStats(runtime);
      await Library.saveProgress(runtime.book, runtime.page);
      if (seconds > 25) {
        U.toast('+' + U.formatDuration(seconds) + ' de lectura guardados', 'info', 2200);
      }
      if (global.App) App.renderStats();
    }
  }

  async function requestWakeLock() {
    if (!App.settings.wakeLock) return;
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', function () { wakeLock = null; });
    } catch (e) { wakeLock = null; }
  }

  function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  }

  document.addEventListener('visibilitychange', function () {
    if (!R) return;
    if (!document.hidden && App.settings.wakeLock) requestWakeLock();
  });

  /* ---------------- webxdc progress sync ---------------- */
  function maybeSyncProgress(book) {
    if (!R && !book) return;
    if (!App.settings.syncProgress) return;
    if (!WX.available) return;
    var b = book || (R && R.book);
    if (!b || !b.hash) return;
    var payload = {
      type: 'progress',
      book: b.hash,
      title: b.title,
      page: b.page,
      pageCount: b.pageCount,
      updatedAt: Date.now(),
      by: WX.selfName || WX.selfAddr || 'otro dispositivo'
    };
    WX.queueUpdate('progress:' + b.hash, payload);
  }

  function maybeSendChatProgress(finished) {
    if (!R) return;
    if (!WX.available || !App.settings.syncProgress) return;
    if (finished) {
      WX.sendNow({
        type: 'finished',
        book: R.book.hash,
        title: R.book.title,
        page: R.book.page,
        pageCount: R.book.pageCount,
        updatedAt: Date.now(),
        by: WX.selfName || ''
      }, '', { info: (WX.selfName || 'Alguien') + ' terminó ' + R.book.title.slice(0, 40), summary: 'Terminado' });
    }
  }
  Reader.maybeSyncProgress = maybeSyncProgress;

  /* ---------------- init ---------------- */
  Reader.init = function () {
    el = {
      root: U.$('#reader'),
      stage: U.$('#readerStage'),
      paged: U.$('#paged'),
      scroll: U.$('#scrollView'),
      loading: U.$('#readerLoading'),
      bar: U.$('#readerBar'),
      foot: U.$('#readerFoot'),
      title: U.$('#readerTitle'),
      meta: U.$('#readerMeta'),
      pageLabel: U.$('#pageLabel'),
      slider: U.$('#pageSlider'),
      sliderFill: U.$('#sliderFill'),
      sliderThumb: U.$('#sliderThumb'),
      progress: U.$('#readerProgressFill'),
      bookmark: U.$('#btnBookmark'),
      layerA: U.$('.page-layer[data-layer="a"]'),
      layerB: U.$('.page-layer[data-layer="b"]'),
      brightness: U.$('#readerBrightness')
    };
    initUi();
  };

  Reader.current = null;
  Reader.isOpen = function () { return !!R; };

  global.Reader = Reader;
})(window);
