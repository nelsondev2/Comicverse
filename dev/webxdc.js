/*
 * Comicverse — webxdc browser simulator.
 *
 * This file is ONLY used while developing in a normal browser (dev/serve.py).
 * It must never be packaged inside the .xdc: real messengers (Delta Chat,
 * Cheogram…) inject their own webxdc.js into the app root.
 */
(function () {
  'use strict';
  console.info('[comicverse] webxdc simulator active');

  var listeners = [];
  var lastSerial = 0;

  window.webxdc = {
    selfAddr: 'dev@localhost',
    selfName: 'Desarrollador',
    isBroadcast: false,
    isAppSender: true,
    sendUpdateInterval: 1000,
    sendUpdateMaxSize: 128000,

    sendUpdate: function (update, descr) {
      console.log('[webxdc] sendUpdate', update);
      lastSerial += 1;
      var enriched = Object.assign({}, update, { serial: lastSerial, max_serial: lastSerial });
      listeners.forEach(function (fn) { try { fn(enriched); } catch (e) { console.error(e); } });
    },

    setUpdateListener: function (cb) {
      listeners.push(cb);
      return Promise.resolve();
    },

    importFiles: function (filter) {
      return new Promise(function (resolve) {
        var input = document.createElement('input');
        input.type = 'file';
        input.multiple = filter && filter.multiple !== false;
        if (filter && filter.extensions) input.accept = filter.extensions.join(',');
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', function () {
          resolve(Array.prototype.slice.call(input.files || []));
          input.remove();
        });
        input.click();
      });
    },

    sendToChat: function (message) {
      console.log('[webxdc] sendToChat', message);
      if (message && message.file && message.file.blob) {
        var url = URL.createObjectURL(message.file.blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = message.file.name || 'file';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      }
      return Promise.resolve();
    }
  };
})();
