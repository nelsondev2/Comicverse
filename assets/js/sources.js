/* Comicverse — page sources: CBZ (zip of images) and PDF (pdf.js).
 * Both work fully offline from a Blob stored in IndexedDB.
 */
(function (global) {
  'use strict';

  var Sources = {};
  var URL_CACHE_LIMIT = 16;

  if (global.pdfjsLib) {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdfjs/pdf.worker.min.js';
    } catch (e) { /* ignore */ }
  }

  function readMagic(blob) {
    return blob.slice(0, 8).arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf), s = '';
      for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      return s;
    });
  }

  function sniffKind(blob, name) {
    return readMagic(blob).then(function (magic) {
      if (magic.indexOf('%PDF') === 0) return 'pdf';
      if (magic.indexOf('PK\u0003\u0004') === 0 || magic.indexOf('PK\u0005\u0006') === 0) return 'cbz';
      if (/\.pdf$/i.test(name)) return 'pdf';
      if (/\.(cbz|zip)$/i.test(name)) return 'cbz';
      if (/\.(cbr|rar)$/i.test(name)) return 'unsupported';
      return 'cbz';
    });
  }

  Sources.open = function (opts) {
    return sniffKind(opts.blob, opts.name || '').then(function (kind) {
      if (kind === 'pdf') return openPdf(opts);
      if (kind === 'cbz') return openCbz(opts);
      throw new Error('Formato no compatible. Usa CBZ o PDF.');
    });
  };

  /* ================= CBZ ================= */
  function isPagePath(path) {
    if (/^__MACOSX\//i.test(path)) return false;
    if (/(^|\/)\.[^/]*$/.test(path)) return false;
    return U.isImageName(path);
  }

  function makeUrlCache(readBlob, pinnedRef) {
    var urls = new Map();
    var order = [];
    var closed = false;

    function evict(keep) {
      while (order.length > URL_CACHE_LIMIT) {
        var removed = false;
        for (var i = 0; i < order.length; i++) {
          var idx = order[i];
          if (idx === keep || pinnedRef()[idx]) continue;
          var row = urls.get(idx);
          if (row) { URL.revokeObjectURL(row.url); urls.delete(idx); }
          order.splice(i, 1);
          removed = true;
          break;
        }
        if (!removed) break;
      }
    }

    return {
      isClosed: function () { return closed; },
      urlFor: async function (index) {
        if (closed) throw new Error('Fuente cerrada');
        var hit = urls.get(index);
        if (hit) {
          var pos = order.indexOf(index);
          if (pos >= 0) { order.splice(pos, 1); order.push(index); }
          return hit.url;
        }
        var blob = await readBlob(index);
        if (closed) throw new Error('Fuente cerrada');
        var url = URL.createObjectURL(blob);
        urls.set(index, { url: url, size: blob.size });
        order.push(index);
        evict(index);
        return url;
      },
      clear: function () {
        closed = true;
        urls.forEach(function (row) { URL.revokeObjectURL(row.url); });
        urls.clear(); order.length = 0;
      }
    };
  }

  function openCbz(opts) {
    return openCbzLazy(opts.blob).catch(function (err) {
      if (err && err.fatal) throw err;
      if (global.LazyZip && global.LazyZip.supported) {
        console.warn('[comicverse] lector ZIP diferido no disponible, usando JSZip:', err && err.message);
      }
      return openCbzJsZip(opts);
    });
  }

  /* Camino rápido: solo lee el índice del ZIP y descomprime cada página al
     pedirla. Abrir un tomo de 300 MB pasa de segundos a milisegundos. */
  async function openCbzLazy(blob) {
    if (!global.LazyZip || !global.LazyZip.supported) throw new Error('lector no disponible');
    var zip = await global.LazyZip.open(blob);
    var names = zip.names.filter(isPagePath).sort(U.naturalCompare);
    if (!names.length) {
      // Un CBZ sin imágenes es un error de formato, no un fallo del lector:
      // no tiene sentido reintentar con JSZip.
      var err = new Error('El archivo CBZ no contiene imágenes');
      err.fatal = true;
      throw err;
    }
    var infoEntry = zip.names.filter(function (n) { return /comicinfo\.xml$/i.test(n); })[0];
    var readMeta = infoEntry ? zip.readText(zip.entry(infoEntry)).then(parseComicInfo).catch(function () { return null; }) : null;

    var pinned = {};
    var cache = makeUrlCache(function (index) {
      var entry = zip.entry(names[index]);
      if (!entry) throw new Error('Página no encontrada');
      return zip.readBlob(entry, U.imageMimeFor(names[index]));
    }, function () { return pinned; });

    var source = {
      type: 'cbz',
      lazy: true,
      pageCount: names.length,
      metaPromise: readMeta || Promise.resolve(null),
      entries: names,
      urlFor: cache.urlFor,
      blobFor: function (index) {
        var entry = zip.entry(names[index]);
        if (!entry) return Promise.reject(new Error('Página no encontrada'));
        return zip.readBlob(entry, U.imageMimeFor(names[index]));
      },
      rawUrl: async function (index) {
        var entry = zip.entry(names[index]);
        if (!entry) throw new Error('Página no encontrada');
        var b = await zip.readBlob(entry, U.imageMimeFor(names[index]));
        return URL.createObjectURL(b);
      },
      pin: function (indices) {
        pinned = {};
        (indices || []).forEach(function (i) { pinned[i] = true; });
      },
      pageSize: function (index) {
        return cache.urlFor(index).then(function (url) {
          return new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () { resolve({ width: img.naturalWidth, height: img.naturalHeight, url: url }); };
            img.onerror = function () { resolve({ width: 1000, height: 1500, url: url }); };
            img.src = url;
          });
        });
      },
      close: function () {
        cache.clear();
        zip = null;
      }
    };
    return source;
  }

  function openCbzJsZip(opts) {
    if (!global.JSZip) return Promise.reject(new Error('No se pudo cargar el lector de ZIP'));
    return global.JSZip.loadAsync(opts.blob, { createFolders: false }).then(function (zip) {
      var names = [];
      zip.forEach(function (path, entry) {
        if (entry.dir) return;
        if (!isPagePath(path)) return;
        names.push(path);
      });
      names.sort(U.naturalCompare);
      if (!names.length) throw new Error('El archivo CBZ no contiene imágenes');

      // Optional ComicInfo.xml metadata (used by most comic managers)
      var infoPath = null;
      var readMeta = null;
      zip.forEach(function (path, entry) {
        if (entry.dir) return;
        if (/comicinfo\.xml$/i.test(path) && !infoPath) infoPath = path;
      });
      if (infoPath) {
        var infoFile = zip.file(infoPath);
        if (infoFile) {
          readMeta = infoFile.async('string').then(parseComicInfo).catch(function () { return null; });
        }
      }

      var pinned = {};
      var cache = makeUrlCache(function (index) {
        var file = zip.file(names[index]);
        if (!file) throw new Error('Página no encontrada');
        return file.async('blob').then(function (blob) {
          return blob.slice(0, blob.size, U.imageMimeFor(names[index]));
        });
      }, function () { return pinned; });

      var source = {
        type: 'cbz',
        pageCount: names.length,
        metaPromise: readMeta || Promise.resolve(null),
        entries: names,
        urlFor: cache.urlFor,
        blobFor: function (index) {
          var file = zip.file(names[index]);
          if (!file) return Promise.reject(new Error('Página no encontrada'));
          return file.async('blob').then(function (blob) {
            return blob.slice(0, blob.size, U.imageMimeFor(names[index]));
          });
        },
        rawUrl: async function (index) {
          if (cache.isClosed()) throw new Error('Fuente cerrada');
          var file = zip.file(names[index]);
          if (!file) throw new Error('Página no encontrada');
          var blob = await file.async('blob');
          if (cache.isClosed()) throw new Error('Fuente cerrada');
          blob = blob.slice(0, blob.size, U.imageMimeFor(names[index]));
          return URL.createObjectURL(blob);
        },
        pin: function (indices) {
          pinned = {};
          (indices || []).forEach(function (i) { pinned[i] = true; });
        },
        pageSize: function (index) {
          return cache.urlFor(index).then(function (url) {
            return new Promise(function (resolve) {
              var img = new Image();
              img.onload = function () { resolve({ width: img.naturalWidth, height: img.naturalHeight, url: url }); };
              img.onerror = function () { resolve({ width: 1000, height: 1500, url: url }); };
              img.src = url;
            });
          });
        },
        close: function () {
          cache.clear();
          try { zip = null; } catch (e) {}
        }
      };
      return source;
    });
  }

  /** Parse ComicInfo.xml (schema from ComicRack, used by nearly every comic tool) */
  function parseComicInfo(xml) {
    if (!xml || !global.DOMParser) return null;
    try {
      var doc = new DOMParser().parseFromString(xml, 'text/xml');
      if (!doc || doc.getElementsByTagName('parsererror').length) return null;
      var txt = function (tag) {
        var node = doc.getElementsByTagName(tag)[0];
        return node && node.textContent ? node.textContent.trim() : '';
      };
      var meta = {
        title: txt('Title'),
        series: txt('Series'),
        number: txt('Number'),
        volume: txt('Volume'),
        writer: txt('Writer'),
        publisher: txt('Publisher'),
        year: txt('Year') || txt('SeriesStartYear'),
        summary: txt('Summary'),
        genre: txt('Genre'),
        manga: txt('Manga'),
        pageCount: txt('PageCount'),
        language: txt('LanguageISO'),
        web: txt('Web')
      };
      var hasAny = Object.keys(meta).some(function (k) { return meta[k]; });
      return hasAny ? meta : null;
    } catch (e) { return null; }
  }

  /* ================= PDF ================= */
  function openPdf(opts) {
    if (!global.pdfjsLib) return Promise.reject(new Error('No se pudo cargar el motor PDF'));
    var data = opts.blob.slice(0, opts.blob.size, 'application/pdf');
    var params = {
      data: null,
      cMapUrl: 'assets/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'assets/vendor/pdfjs/standard_fonts/',
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: false
    };
    return data.arrayBuffer().then(function (buf) {
      params.data = new Uint8Array(buf);
      return pdfjsLib.getDocument(params).promise;
    }).then(function (doc) {
      var closed = false;
      var renderTasks = new Map();

      var source = {
        type: 'pdf',
        doc: doc,
        pageCount: doc.numPages,
        urlFor: function () { return Promise.resolve(null); },
        rawUrl: function () { return Promise.resolve(null); },
        pin: function () {},
        pageSize: function (index) {
          return doc.getPage(index + 1).then(function (page) {
            var vp = page.getViewport({ scale: 1 });
            return { width: vp.width, height: vp.height };
          });
        },
        /** Render page `index` into a fresh canvas. */
        renderCanvas: async function (index, targetWidth, targetHeight, quality) {
          if (closed) throw new Error('Documento cerrado');
          var page = await doc.getPage(index + 1);
          var base = page.getViewport({ scale: 1 });
          var dpr = Math.min(global.devicePixelRatio || 1, quality === 'low' ? 1 : 2);
          var scale = 1;
          if (targetWidth && targetHeight) {
            scale = Math.min(targetWidth / base.width, targetHeight / base.height);
          } else if (targetWidth) {
            scale = targetWidth / base.width;
          } else if (targetHeight) {
            scale = targetHeight / base.height;
          }
          scale = Math.max(scale, 0.1);
          var viewport = page.getViewport({ scale: scale * dpr });
          var canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
          canvas.style.height = Math.floor(viewport.height / dpr) + 'px';
          var ctx = canvas.getContext('2d', { alpha: false });
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          var task = page.render({ canvasContext: ctx, viewport: viewport, intent: 'print' });
          renderTasks.set(index, task);
          await task.promise;
          renderTasks.delete(index);
          page.cleanup();
          return canvas;
        },
        cancelRenders: function () {
          renderTasks.forEach(function (task) { try { task.cancel(); } catch (e) {} });
          renderTasks.clear();
        },
        close: function () {
          closed = true;
          source.cancelRenders();
          try { doc.destroy(); } catch (e) {}
        }
      };
      return source;
    });
  }

  /* ================= covers ================= */
  function canvasToJpeg(canvas, width, quality) {
    return new Promise(function (resolve) {
      if (!canvas.toBlob) {
        // very old webviews
        var data = canvas.toDataURL('image/jpeg', quality || 0.82);
        var bin = atob(data.split(',')[1]);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type: 'image/jpeg' }));
        return;
      }
      canvas.toBlob(function (b) { resolve(b); }, 'image/jpeg', quality || 0.82);
    });
  }

  function drawImageCover(img, maxW) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    var scale = Math.min(1, maxW / w);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /** Build a cover thumbnail (JPEG blob) + aspect info from the first page. */
  Sources.buildCover = async function (source, maxWidth) {
    maxWidth = maxWidth || 420;
    if (source.type === 'cbz') {
      var url = await source.urlFor(0);
      var img = await new Promise(function (resolve, reject) {
        var im = new Image();
        im.onload = function () { resolve(im); };
        im.onerror = function () { reject(new Error('No se pudo decodificar la portada')); };
        im.src = url;
      });
      var canvas = drawImageCover(img, maxWidth);
      var aspect = img.naturalHeight / Math.max(1, img.naturalWidth);
      return {
        cover: canvas ? await canvasToJpeg(canvas, maxWidth, 0.82) : null,
        aspect: aspect || 1.5
      };
    }
    // PDF
    var page = await source.doc.getPage(1);
    var vp = page.getViewport({ scale: 1 });
    var scale = Math.min(2, maxWidth / vp.width);
    var view = page.getViewport({ scale: scale * Math.min(global.devicePixelRatio || 1, 2) });
    var c = document.createElement('canvas');
    c.width = Math.floor(view.width);
    c.height = Math.floor(view.height);
    var ctx2 = c.getContext('2d', { alpha: false });
    ctx2.fillStyle = '#fff'; ctx2.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx2, viewport: view }).promise;
    var cover = await canvasToJpeg(c, maxWidth, 0.82);
    page.cleanup();
    return { cover: cover, aspect: vp.height / Math.max(1, vp.width) };
  };

  /** Small data URL used as instant placeholder (keeps UI smooth). */
  Sources.blobToDataURL = function (blob) {
    return new Promise(function (resolve) {
      if (!blob) return resolve('');
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { resolve(''); };
      reader.readAsDataURL(blob);
    });
  };

  global.Sources = Sources;
})(window);
