/* Comicverse — lector ZIP diferido (lazy).
 *
 * JSZip.loadAsync() copia el archivo completo a memoria antes de poder leer
 * una sola página: con un tomo de manga de 300 MB eso son varios segundos y
 * cientos de MB de RAM. Este lector solo lee el índice central (unos pocos KB
 * al final del archivo) y descomprime cada página bajo demanda desde un corte
 * del Blob, así que abrir un tomo grande es casi instantáneo.
 *
 * Usa DecompressionStream('deflate-raw') (Chrome 80+, WebView moderno). Si no
 * está disponible, o el ZIP es ZIP64/cifrado, `Sources` sigue usando JSZip.
 */
(function (global) {
  'use strict';

  var EOCD_SIG = 0x06054b50;
  var CEN_SIG = 0x02014b50;
  var LOC_SIG = 0x04034b50;

  var SUPPORTED = typeof global.DecompressionStream === 'function';

  function u16(dv, o) { return dv.getUint16(o, true); }
  function u32(dv, o) { return dv.getUint32(o, true); }

  function decodeName(bytes, utf8Flag) {
    try {
      return new TextDecoder(utf8Flag ? 'utf-8' : 'utf-8').decode(bytes);
    } catch (e) {
      var s = '';
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    }
  }

  function findEocd(tail) {
    for (var i = tail.byteLength - 22; i >= 0; i--) {
      if (u32(tail, i) === EOCD_SIG) {
        return {
          disk: u16(tail, i + 4),
          cdDisk: u16(tail, i + 6),
          entries: u16(tail, i + 10),
          cdSize: u32(tail, i + 12),
          cdOffset: u32(tail, i + 16)
        };
      }
    }
    return null;
  }

  function parseCentralDirectory(buf) {
    var dv = new DataView(buf);
    var entries = [];
    var o = 0;
    while (o + 46 <= buf.byteLength) {
      if (u32(dv, o) !== CEN_SIG) break;
      var flags = u16(dv, o + 8);
      var method = u16(dv, o + 10);
      var csize = u32(dv, o + 20);
      var usize = u32(dv, o + 24);
      var nameLen = u16(dv, o + 28);
      var extraLen = u16(dv, o + 30);
      var commentLen = u16(dv, o + 32);
      var localOffset = u32(dv, o + 42);
      var name = decodeName(new Uint8Array(buf, o + 46, nameLen), (flags & 0x800) !== 0);
      entries.push({
        name: name,
        flags: flags,
        method: method,
        csize: csize,
        usize: usize,
        localOffset: localOffset,
        dir: /\/$/.test(name)
      });
      o += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  var LazyZip = { supported: SUPPORTED };

  LazyZip.open = async function (blob) {
    if (!SUPPORTED) throw new Error('DecompressionStream no disponible');
    if (!blob || !blob.size) throw new Error('Archivo vacío');
    if (blob.size < 22) throw new Error('ZIP no válido');

    var tailLen = Math.min(blob.size, 66000);
    var tailStart = blob.size - tailLen;
    var tailBuf = await blob.slice(tailStart).arrayBuffer();
    var eocd = findEocd(new DataView(tailBuf), tailStart);
    if (!eocd) throw new Error('No se encontró el índice del ZIP');
    if (eocd.entries === 0xffff || eocd.cdOffset === 0xffffffff || eocd.cdSize === 0xffffffff) {
      throw new Error('ZIP64 no soportado por el lector diferido');
    }
    if (eocd.disk !== 0 || eocd.cdDisk !== 0) throw new Error('ZIP multidisk no soportado');

    var cdStart = eocd.cdOffset;
    var cdSize = eocd.cdSize;
    if (cdStart + cdSize > blob.size) throw new Error('Índice del ZIP corrupto');
    var cdBuf = await blob.slice(cdStart, cdStart + cdSize).arrayBuffer();
    var entries = parseCentralDirectory(cdBuf);
    if (!entries.length) throw new Error('ZIP sin entradas');

    var byName = new Map();
    entries.forEach(function (e) { byName.set(e.name, e); });

    var zip = {
      size: blob.size,
      names: entries.filter(function (e) { return !e.dir; }).map(function (e) { return e.name; }),
      entry: function (name) { return byName.get(name) || null; }
    };

    /* El desplazamiento real de los datos requiere leer la cabecera local. */
    async function dataOffset(entry) {
      if (entry._dataOffset != null) return entry._dataOffset;
      var head = new DataView(await blob.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
      if (u32(head, 0) !== LOC_SIG) throw new Error('Cabecera local dañada');
      var nameLen = u16(head, 26);
      var extraLen = u16(head, 28);
      entry._dataOffset = entry.localOffset + 30 + nameLen + extraLen;
      return entry._dataOffset;
    }

    function streamFor(entry) {
      var start = entry._dataOffset;
      var slice = blob.slice(start, start + entry.csize);
      if (entry.method === 0) return slice.stream();
      if (entry.method !== 8) throw new Error('Compresión no soportada');
      return slice.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    }

    zip.readBlob = async function (entry, mime) {
      if (!entry) throw new Error('Entrada no encontrada');
      if (entry.flags & 0x1) throw new Error('ZIP cifrado no soportado');
      await dataOffset(entry);
      if (entry.method === 0) {
        var raw = blob.slice(entry._dataOffset, entry._dataOffset + entry.csize);
        return mime ? raw.slice(0, raw.size, mime) : raw;
      }
      var buf = await new Response(streamFor(entry)).arrayBuffer();
      return new Blob([buf], mime ? { type: mime } : undefined);
    };

    zip.readText = async function (entry) {
      if (!entry) return '';
      if (entry.flags & 0x1) throw new Error('ZIP cifrado no soportado');
      await dataOffset(entry);
      return new Response(streamFor(entry)).text();
    };

    return zip;
  };

  global.LazyZip = LazyZip;
})(window);
