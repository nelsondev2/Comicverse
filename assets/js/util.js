/* Comicverse — utilities, DOM helpers, toasts and sheets (classic script, no build step) */
(function (global) {
  'use strict';

  var U = {};

  /* ---------- DOM ---------- */
  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.charAt(0) === 'o' && k.charAt(1) === 'n' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (prop) {
            if (prop.indexOf('--') === 0) node.style.setProperty(prop, v[prop]);
            else node.style[prop] = v[prop];
          });
        }
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  };

  U.icon = function (name, cls) {
    return '<svg class="ico ' + (cls || '') + '"><use href="#i-' + name + '"/></svg>';
  };
  U.iconEl = function (name, cls) {
    var wrap = document.createElement('span');
    wrap.innerHTML = U.icon(name, cls);
    return wrap.firstChild;
  };

  /** Lowercased, accent-insensitive text used for searching and sorting. */
  U.fold = function (s) {
    var str = String(s == null ? '' : s).toLowerCase();
    try {
      if (str.normalize) str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) { /* old engines */ }
    return str;
  };

  U.escape = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ---------- misc ---------- */
  U.clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  U.debounce = function (fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  U.throttle = function (fn, ms) {
    var last = 0, timer = null, lastArgs;
    return function () {
      var now = Date.now(), remaining = ms - (now - last);
      lastArgs = arguments;
      if (remaining <= 0) {
        clearTimeout(timer); timer = null; last = now;
        fn.apply(this, lastArgs);
      } else if (!timer) {
        var self = this;
        timer = setTimeout(function () { timer = null; last = Date.now(); fn.apply(self, lastArgs); }, remaining);
      }
    };
  };

  U.uid = function () {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  };

  U.raf = function (fn) { return global.requestAnimationFrame ? requestAnimationFrame(fn) : setTimeout(fn, 16); };

  U.nextFrame = function () {
    return new Promise(function (res) { U.raf(function () { U.raf(res); }); });
  };

  U.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* ---------- numbers & text ---------- */
  U.formatBytes = function (bytes) {
    if (!bytes && bytes !== 0) return '—';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = 0, n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)).toString().replace('.', ',') + ' ' + units[i];
  };

  U.formatDuration = function (seconds) {
    seconds = Math.max(0, Math.round(seconds || 0));
    var h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
    if (h > 0) return h + ' h ' + (m > 0 ? m + ' min' : '');
    if (m > 0) return m + ' min';
    return seconds > 0 ? seconds + ' s' : '0 min';
  };

  U.percent = function (a, b) {
    if (!b) return 0;
    return U.clamp(Math.round((a / b) * 100), 0, 100);
  };

  var dtf = null;
  U.dateLabel = function (ts, style) {
    if (!ts) return '—';
    var d = new Date(ts);
    try {
      if (!dtf) dtf = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
      if (style === 'short') return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(d);
      return dtf.format(d);
    } catch (e) {
      return d.toLocaleDateString();
    }
  };

  U.relativeTime = function (ts) {
    if (!ts) return 'nunca';
    var diff = Date.now() - ts;
    var min = Math.round(diff / 60000);
    if (min < 1) return 'ahora mismo';
    if (min < 60) return 'hace ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'hace ' + h + ' h';
    var d = Math.round(h / 24);
    if (d === 1) return 'ayer';
    if (d < 30) return 'hace ' + d + ' días';
    return U.dateLabel(ts, 'short');
  };

  U.dayKey = function (d) {
    d = d || new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  };

  U.titleFromFilename = function (name) {
    var base = String(name || '').replace(/^.*[\\/]/, '').replace(/\.(cbz|cbr|pdf|zip|cbt|cb7)$/i, '');
    base = base.replace(/[_]+/g, ' ');
    // strip common scan/download suffixes
    base = base.replace(/\s*[-–]\s*(digital|scan|spanish|castellano|español|complete|repack)\b.*$/i, '');
    // separators used by scene releases -> spaces
    base = base.replace(/\s*[-.]+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    // keep year markers readable
    base = base.replace(/\s*\((\d{4})\)\s*/g, ' ($1) ');
    if (!base) return 'Cómic sin título';
    // sentence case: capitalise the first letter and words after punctuation
    base = base.toLowerCase();
    base = base.replace(/(^|[\s¿¡¡"'(])([a-záéíóúüñ])/g, function (m, pre, ch) { return pre + ch.toUpperCase(); });
    base = base.replace(/\b(De|Del|La|Las|El|Los|Y|En|Con|Por|Para|Que)\b/g, function (w) { return w.toLowerCase(); });
    base = base.charAt(0).toUpperCase() + base.slice(1);
    return base;
  };

  var collator = null;
  U.naturalCompare = function (a, b) {
    try {
      if (!collator) collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
      return collator.compare(a, b);
    } catch (e) {
      return String(a).localeCompare(String(b));
    }
  };

  U.sortNames = function (list) {
    return list.slice().sort(U.naturalCompare);
  };

  U.isImageName = function (name) {
    return /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(name);
  };

  U.imageMimeFor = function (name) {
    var ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1];
    ext = (ext || '').toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'avif') return 'image/avif';
    if (ext === 'bmp') return 'image/bmp';
    return 'image/jpeg';
  };

  U.hexToRgb = function (hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  /* ---------- hashing ---------- */
  U.hashBlob = async function (blob) {
    var head = blob.slice(0, Math.min(blob.size, 3 * 1024 * 1024));
    var size = blob.size;
    var hex = '';
    try {
      if (global.crypto && crypto.subtle) {
        var buf = await head.arrayBuffer();
        var digest = await crypto.subtle.digest('SHA-256', buf);
        hex = Array.prototype.map.call(new Uint8Array(digest), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('').slice(0, 32);
      }
    } catch (e) { hex = ''; }
    if (!hex) {
      // deterministic fallback (non-crypto) so dedupe still works
      var bytes = new Uint8Array(await head.arrayBuffer());
      var h = 2166136261;
      for (var i = 0; i < bytes.length; i += 7) {
        h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0;
      }
      hex = h.toString(16) + '-' + bytes.length.toString(16);
    }
    return hex + '-' + size.toString(36);
  };

  /* ---------- toasts ---------- */
  var toastHost = null;
  U.toast = function (message, type, ms) {
    if (!toastHost) toastHost = U.$('#toasts');
    if (!toastHost) return;
    type = type || 'info';
    var iconName = type === 'ok' ? 'check' : type === 'err' ? 'info' : 'info';
    var node = U.el('div', { class: 'toast toast--' + type, html: U.icon(iconName) + '<span>' + U.escape(message) + '</span>' });
    toastHost.appendChild(node);
    var remove = function () {
      if (!node.parentNode) return;
      node.classList.add('is-out');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 260);
    };
    var t = setTimeout(remove, ms || 3200);
    node.addEventListener('click', function () { clearTimeout(t); remove(); });
  };

  /* ---------- overlay stack ---------- */
  var overlays = [];

  function lockScroll(on) {
    document.body.style.overflow = on ? 'hidden' : '';
  }

  function topOverlay() { return overlays[overlays.length - 1]; }

  function removeOverlay(o) {
    if (o.closed) return;
    o.closed = true;
    var i = overlays.indexOf(o);
    if (i >= 0) overlays.splice(i, 1);
    o.els.forEach(function (n) {
      if (n.classList) n.classList.remove('is-in');
    });
    setTimeout(function () {
      o.els.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    }, 320);
    if (!overlays.length) lockScroll(false);
    if (o.onClose) o.onClose();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var top = topOverlay();
    if (top && top.dismissable) {
      // stop other document-level handlers (e.g. the reader) from reacting too
      e.stopImmediatePropagation();
      e.preventDefault();
      removeOverlay(top);
    }
  }, true);

  /**
   * Open a bottom sheet (or centred dialog).
   * opts: { title, sub, html, content(Node), footer, center, wide, dismissable, onMount, onClose, className }
   */
  U.sheet = function (opts) {
    opts = opts || {};
    var backdrop = U.el('div', { class: 'sheet-backdrop' });
    var sheet = U.el('div', {
      class: 'sheet' + (opts.center ? ' sheet--center' : '') + (opts.wide ? ' sheet--wide' : '') + (opts.className ? ' ' + opts.className : ''),
      role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Diálogo'
    });

    if (!opts.center) sheet.appendChild(U.el('div', { class: 'sheet__grab' }));

    if (opts.title || opts.sub) {
      var head = U.el('div', { class: 'sheet__head' });
      var titleWrap = U.el('div', { style: { flex: '1', minWidth: '0' } });
      if (opts.title) titleWrap.appendChild(U.el('div', { class: 'sheet__title', text: opts.title }));
      if (opts.sub) titleWrap.appendChild(U.el('div', { class: 'sheet__sub', style: { padding: '2px 0 0' }, text: opts.sub }));
      head.appendChild(titleWrap);
      var closeBtn = U.el('button', { class: 'icon-btn', 'aria-label': 'Cerrar', html: U.icon('close') });
      head.appendChild(closeBtn);
      sheet.appendChild(head);
    }

    var body = U.el('div', { class: 'sheet__body' });
    if (opts.html) body.innerHTML = opts.html;
    if (opts.content) body.appendChild(opts.content);
    sheet.appendChild(body);

    var closed = false;
    var api = {
      el: sheet, body: body, close: function () { var o = overlays.find(function (x) { return x.els.indexOf(sheet) >= 0; }); if (o) removeOverlay(o); }
    };

    if (opts.footer) {
      var foot = U.el('div', { class: 'sheet__foot' });
      if (typeof opts.footer === 'string') foot.innerHTML = opts.footer;
      else foot.appendChild(opts.footer);
      sheet.appendChild(foot);
      api.footer = foot;
    }

    var dismissable = opts.dismissable !== false;
    var overlay = { els: [sheet, backdrop], dismissable: dismissable, closed: false, onClose: opts.onClose };

    backdrop.addEventListener('click', function () {
      if (dismissable) removeOverlay(overlay);
    });
    if (sheet.querySelector('.sheet__head .icon-btn')) {
      sheet.querySelector('.sheet__head .icon-btn').addEventListener('click', function () { removeOverlay(overlay); });
    }

    // drag to dismiss
    if (dismissable && !opts.center) {
      var startY = null, delta = 0, dragging = false;
      var grab = sheet.querySelector('.sheet__grab') || sheet.querySelector('.sheet__head');
      var onDown = function (e) {
        if (e.target.closest('button, input, textarea, select, a')) return;
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        dragging = true; delta = 0;
        sheet.style.transition = 'none';
      };
      var onMove = function (e) {
        if (!dragging) return;
        var y = e.touches ? e.touches[0].clientY : e.clientY;
        delta = Math.max(0, y - startY);
        sheet.style.transform = 'translateY(' + delta + 'px)';
        backdrop.style.opacity = String(Math.max(0, 1 - delta / 480));
      };
      var onUp = function () {
        if (!dragging) return;
        dragging = false;
        sheet.style.transition = '';
        backdrop.style.opacity = '';
        sheet.style.transform = '';
        if (delta > 110) removeOverlay(overlay);
      };
      if (grab) {
        grab.addEventListener('touchstart', onDown, { passive: true });
        grab.addEventListener('touchmove', onMove, { passive: true });
        grab.addEventListener('touchend', onUp);
        grab.addEventListener('mousedown', onDown);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    overlays.push(overlay);
    lockScroll(true);
    U.nextFrame().then(function () {
      backdrop.classList.add('is-in');
      sheet.classList.add('is-in');
      if (opts.onMount) opts.onMount(api);
    });
    return api;
  };

  U.hasOpenSheet = function () { return overlays.length > 0; };

  U.closeAllSheets = function () {
    overlays.slice().reverse().forEach(removeOverlay);
  };

  U.confirm = function (opts) {
    return new Promise(function (resolve) {
      var done = false;
      var footer = U.el('div', { style: { display: 'flex', gap: '10px', width: '100%' } });
      var cancel = U.el('button', { class: 'btn btn--ghost', style: { flex: '1' }, text: opts.cancelText || 'Cancelar' });
      var ok = U.el('button', {
        class: 'btn ' + (opts.danger ? 'btn--danger' : 'btn--primary'),
        style: { flex: '1' },
        text: opts.confirmText || 'Aceptar'
      });
      footer.appendChild(cancel); footer.appendChild(ok);
      var s = U.sheet({
        center: true, title: opts.title || '¿Seguro?',
        content: U.el('p', { class: 'muted', style: { fontSize: '13.5px', lineHeight: '1.55', padding: '2px 0 14px' }, text: opts.message || '' }),
        footer: footer,
        onClose: function () { if (!done) { done = true; resolve(false); } }
      });
      cancel.addEventListener('click', function () { done = true; resolve(false); s.close(); });
      ok.addEventListener('click', function () { done = true; resolve(true); s.close(); });
    });
  };

  U.prompt = function (opts) {
    return new Promise(function (resolve) {
      var done = false;
      var input = U.el(opts.multiline ? 'textarea' : 'input', {
        class: opts.multiline ? 'textarea' : 'input',
        placeholder: opts.placeholder || '',
        value: opts.value || ''
      });
      var content = U.el('div', null, [
        U.el('label', { class: 'field__label', text: opts.label || '' }),
        input
      ]);
      var footer = U.el('div', { style: { display: 'flex', gap: '10px', width: '100%' } });
      var cancel = U.el('button', { class: 'btn btn--ghost', style: { flex: '1' }, text: 'Cancelar' });
      var ok = U.el('button', { class: 'btn btn--primary', style: { flex: '1' }, text: opts.confirmText || 'Guardar' });
      footer.appendChild(cancel); footer.appendChild(ok);
      var s = U.sheet({
        center: true, title: opts.title || '', content: content, footer: footer,
        onClose: function () { if (!done) { done = true; resolve(null); } },
        onMount: function () { setTimeout(function () { input.focus(); if (input.select) input.select(); }, 60); }
      });
      var submit = function () { done = true; resolve(input.value.trim()); s.close(); };
      cancel.addEventListener('click', function () { done = true; resolve(null); s.close(); });
      ok.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !opts.multiline) { e.preventDefault(); submit(); }
      });
    });
  };

  U.shareFallback = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = U.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 1500);
  };

  U.copyText = async function (text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* ignore */ }
    try {
      var ta = U.el('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e) { return false; }
  };

  global.U = U;
})(window);
