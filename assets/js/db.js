/* Comicverse — IndexedDB persistence layer (offline, no server, no accounts) */
(function (global) {
  'use strict';

  var DB_NAME = 'comicverse';
  var DB_VERSION = 1;
  var dbPromise = null;
  var DB = {};

  var STORES = {
    books: { keyPath: 'id', indexes: [['addedAt', 'addedAt'], ['lastReadAt', 'lastReadAt'], ['title', 'title'], ['hash', 'hash']] },
    files: { keyPath: 'id', indexes: [] },
    bookmarks: { keyPath: 'id', indexes: [['bookId', 'bookId']] },
    collections: { keyPath: 'id', indexes: [] },
    stats: { keyPath: 'date', indexes: [] },
    settings: { keyPath: 'key', indexes: [] }
  };

  function request(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  DB.open = function () {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('IndexedDB no disponible')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (event) {
        var idb = req.result;
        Object.keys(STORES).forEach(function (name) {
          var def = STORES[name];
          if (!idb.objectStoreNames.contains(name)) {
            var store = idb.createObjectStore(name, { keyPath: def.keyPath });
            def.indexes.forEach(function (pair) {
              store.createIndex(pair[0], pair[1], { unique: false });
            });
          }
        });
        event.target.transaction.oncomplete = function () { /* ready */ };
      };
      req.onsuccess = function () {
        var idb = req.result;
        idb.onversionchange = function () { try { idb.close(); } catch (e) {} };
        resolve(idb);
      };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { /* another tab holds an old version */ };
    });
    return dbPromise;
  };

  function tx(storeName, mode) {
    return DB.open().then(function (idb) {
      var t = idb.transaction(storeName, mode || 'readonly');
      return { store: t.objectStore(storeName), tx: t };
    });
  }

  DB.get = function (store, key) {
    return tx(store).then(function (c) { return request(c.store.get(key)); });
  };

  DB.getAll = function (store) {
    return tx(store).then(function (c) { return request(c.store.getAll()); });
  };

  DB.getAllByIndex = function (store, index, value) {
    return tx(store).then(function (c) {
      return request(c.store.index(index).getAll(value));
    });
  };

  DB.put = function (store, value) {
    return tx(store, 'readwrite').then(function (c) {
      return new Promise(function (resolve, reject) {
        var req = c.store.put(value);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  };

  DB.putMany = function (store, values) {
    if (!values.length) return Promise.resolve();
    return tx(store, 'readwrite').then(function (c) {
      return new Promise(function (resolve, reject) {
        var done = 0;
        values.forEach(function (v) {
          var req = c.store.put(v);
          req.onsuccess = function () { done++; if (done === values.length) resolve(); };
          req.onerror = function () { reject(req.error); };
        });
      });
    });
  };

  DB.del = function (store, key) {
    return tx(store, 'readwrite').then(function (c) {
      return new Promise(function (resolve, reject) {
        var req = c.store.delete(key);
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error); };
      });
    });
  };

  DB.clear = function (store) {
    return tx(store, 'readwrite').then(function (c) { return request(c.store.clear()); });
  };

  DB.count = function (store) {
    return tx(store).then(function (c) { return request(c.store.count()); });
  };

  /* ---------- settings ---------- */
  DB.getSetting = function (key, fallback) {
    return DB.get('settings', key).then(function (row) {
      return row && row.value !== undefined ? row.value : fallback;
    }).catch(function () { return fallback; });
  };

  DB.setSetting = function (key, value) {
    return DB.put('settings', { key: key, value: value });
  };

  /* ---------- storage estimate ---------- */
  DB.estimate = function () {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().then(function (e) {
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }).catch(function () { return { usage: 0, quota: 0 }; });
    }
    return Promise.resolve({ usage: 0, quota: 0 });
  };

  DB.persist = function () {
    if (navigator.storage && navigator.storage.persist) {
      return navigator.storage.persist().catch(function () { return false; });
    }
    return Promise.resolve(false);
  };

  global.DB = DB;
})(window);
