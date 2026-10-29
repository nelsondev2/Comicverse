/* Comicverse — webxdc integration with graceful browser fallbacks.
 *
 * Everything the reader needs works offline & stand-alone. When the app runs
 * inside a messenger (Delta Chat, Cheogram, …) we use the webxdc API for
 * importing files, exporting to the chat and syncing reading progress.
 */
(function (global) {
  'use strict';

  var WX = {
    available: false,
    selfName: '',
    selfAddr: '',
    isBroadcast: false,
    isAppSender: false,
    updates: [],
    handlers: []
  };

  function api() { return global.webxdc || null; }

  WX.init = function () {
    var w = api();
    WX.available = !!w;
    if (!w) return;
    try {
      WX.selfName = w.selfName || '';
      WX.selfAddr = w.selfAddr || '';
      WX.isBroadcast = !!w.isBroadcast;
      WX.isAppSender = !!w.isAppSender;
      WX.sendUpdateInterval = typeof w.sendUpdateInterval === 'number' ? w.sendUpdateInterval : 10000;
      WX.sendUpdateMaxSize = typeof w.sendUpdateMaxSize === 'number' ? w.sendUpdateMaxSize : 128000;
    } catch (e) { /* keep defaults */ }

    if (typeof w.setUpdateListener === 'function') {
      try {
        var maybe = w.setUpdateListener(function (update) {
          WX.updates.push(update);
          WX.handlers.forEach(function (fn) {
            try { fn(update); } catch (e) { console.error(e); }
          });
        }, 0);
        if (maybe && typeof maybe.catch === 'function') {
          maybe.catch(function (err) { console.warn('[comicverse] update listener', err); });
        }
      } catch (e) { console.warn('[comicverse] setUpdateListener', e); }
    }
  };

  WX.onUpdate = function (fn) { WX.handlers.push(fn); };

  /** Import files: webxdc picker when available, <input type=file> otherwise. */
  WX.importFiles = function (opts) {
    opts = opts || {};
    var w = api();
    if (w && typeof w.importFiles === 'function') {
      return w.importFiles({
        extensions: opts.extensions || ['.cbz', '.pdf', '.zip', '.cbr'],
        mimeTypes: opts.mimeTypes || ['application/pdf', 'application/zip', 'application/x-cbz'],
        multiple: opts.multiple !== false
      }).catch(function (err) {
        console.warn('[comicverse] importFiles failed, using input', err);
        return legacyImport(opts);
      });
    }
    return legacyImport(opts);
  };

  function legacyImport(opts) {
    return new Promise(function (resolve) {
      var input = document.getElementById('fileInput');
      if (!input) { resolve([]); return; }
      if (opts && opts.extensions) input.setAttribute('accept', opts.extensions.join(','));
      var done = false;
      var finish = function (files) {
        if (done) return;
        done = true;
        input.value = '';
        input.removeEventListener('change', onChange);
        resolve(files);
      };
      var onChange = function () {
        finish(Array.prototype.slice.call(input.files || []));
      };
      input.addEventListener('change', onChange);
      input.click();
      // If the user cancels there is no event; resolve quietly when focus returns.
      global.addEventListener('focus', function once() {
        global.removeEventListener('focus', once);
        setTimeout(function () {
          if (!done && (!input.files || !input.files.length)) finish([]);
        }, 600);
      });
    });
  }

  /** Send a file to the chat (or download it in a plain browser). */
  WX.sendToChat = async function (file, text) {
    var w = api();
    if (w && typeof w.sendToChat === 'function') {
      return w.sendToChat({
        file: { blob: file.blob, name: file.name },
        text: text || ''
      });
    }
    U.shareFallback(file.blob, file.name);
    return true;
  };

  /* ---------- throttled updates (respecting messenger limits) ---------- */
  var pending = {};
  var lastSent = 0;
  var flushTimer = null;

  function flush() {
    var w = api();
    flushTimer = null;
    if (!w || typeof w.sendUpdate !== 'function') return;
    var keys = Object.keys(pending);
    if (!keys.length) return;
    var wait = Math.max(0, (lastSent + (WX.sendUpdateInterval || 10000)) - Date.now());
    if (wait > 0) {
      if (!flushTimer) flushTimer = setTimeout(flush, wait + 30);
      return;
    }
    var batch = pending;
    pending = {};
    var items = keys.map(function (k) { return batch[k]; });
    var merged = { type: 'batch', items: items };
    var first = items[0] || {};
    var update = { payload: merged };
    // Messenger UI (e.g. Delta Chat) shows these next to the app icon/message.
    if (first.title) update.document = String(first.title).slice(0, 20);
    if (typeof first.page === 'number' && first.pageCount) {
      update.summary = 'Pág. ' + (first.page + 1) + '/' + first.pageCount;
    }
    try {
      w.sendUpdate(update, '');
      lastSent = Date.now();
    } catch (err) {
      console.warn('[comicverse] sendUpdate', err);
    }
  }

  WX.queueUpdate = function (key, payload, descr) {
    pending[key] = payload;
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 80);
  };

  WX.sendNow = function (payload, descr, extra) {
    var w = api();
    if (!w || typeof w.sendUpdate !== 'function') return false;
    try {
      var update = { payload: payload };
      if (extra) Object.assign(update, extra);
      w.sendUpdate(update, descr || '');
      lastSent = Date.now();
      return true;
    } catch (e) { return false; }
  };

  /** Unwrap batch payloads so the app only sees individual messages. */
  WX.unwrap = function (update) {
    if (!update || !update.payload) return [];
    var p = update.payload;
    if (p && p.type === 'batch' && Array.isArray(p.items)) return p.items;
    return [p];
  };

  global.WX = WX;
})(window);
