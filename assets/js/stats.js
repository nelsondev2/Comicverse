/* Comicverse — reading statistics (all local) */
(function (global) {
  'use strict';

  var Stats = {};

  function sum(arr, key) {
    return arr.reduce(function (acc, row) { return acc + (row[key] || 0); }, 0);
  }

  function lastDays(n) {
    var days = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ key: U.dayKey(d), date: d, label: ['D', 'L', 'M', 'X', 'J', 'V', 'S'][d.getDay()] });
    }
    return days;
  }

  function streak(rows) {
    var map = {};
    rows.forEach(function (r) { if (r.seconds > 30 || r.pages > 0) map[r.date] = true; });
    var count = 0;
    var d = new Date();
    // today counts only if there is activity, otherwise start from yesterday
    if (!map[U.dayKey(d)]) d.setDate(d.getDate() - 1);
    while (map[U.dayKey(d)]) {
      count++;
      d.setDate(d.getDate() - 1);
      if (count > 3650) break;
    }
    return count;
  }

  Stats.render = async function () {
    var host = U.$('#statsContent');
    if (!host) return;
    var rows = await DB.getAll('stats').catch(function () { return []; });
    var books = Library.books;
    var totalSeconds = sum(rows, 'seconds');
    var totalPagesRead = sum(rows, 'pages');
    var finished = books.filter(function (b) { return b.finished; }).length;
    var reading = books.filter(function (b) { return !b.finished && b.page > 0; }).length;
    var favs = books.filter(function (b) { return b.favorite; }).length;
    var pagesInLibrary = books.reduce(function (a, b) { return a + (b.pageCount || 0); }, 0);
    var days = lastDays(7);
    var byDay = {};
    rows.forEach(function (r) { byDay[r.date] = r; });
    var maxPages = Math.max(1, days.reduce(function (m, d) { return Math.max(m, (byDay[d.key] && byDay[d.key].pages) || 0); }, 0));
    var today = U.dayKey();
    var streakDays = streak(rows);

    var html = '';
    html += '<div class="stat-grid">' +
      '<div class="stat-card stat-card--accent"><div class="stat-card__ico">' + U.icon('clock') + '</div><b>' + U.formatDuration(totalSeconds) + '</b><span>Tiempo de lectura</span></div>' +
      '<div class="stat-card"><div class="stat-card__ico">' + U.icon('file') + '</div><b>' + totalPagesRead + '</b><span>Páginas leídas</span></div>' +
      '<div class="stat-card"><div class="stat-card__ico">' + U.icon('check') + '</div><b>' + finished + '</b><span>Cómics terminados</span></div>' +
      '<div class="stat-card"><div class="stat-card__ico">' + U.icon('heart') + '</div><b>' + favs + '</b><span>Favoritos</span></div>' +
    '</div>';

    html += '<div class="chart-card"><div class="chart-title">Últimos 7 días</div><div class="chart-bars">';
    days.forEach(function (d) {
      var pages = (byDay[d.key] && byDay[d.key].pages) || 0;
      var h = Math.round((pages / maxPages) * 78) + (pages > 0 ? 8 : 3);
      html += '<div class="chart-bar' + (d.key === today ? ' is-today' : '') + '">' +
        '<span class="chart-bar__val">' + (pages || '') + '</span>' +
        '<div class="chart-bar__fill" style="height:' + h + '%"></div>' +
        '<span class="chart-bar__label">' + d.label + '</span></div>';
    });
    html += '</div></div>';

    html += '<div class="chart-card"><div class="chart-title">Resumen</div>' +
      '<div class="stat-row"><span>Racha de lectura</span><b>' + streakDays + (streakDays === 1 ? ' día' : ' días') + '</b></div>' +
      '<div class="stat-row"><span>Media por sesión</span><b>' + (rows.length ? U.formatDuration(totalSeconds / Math.max(1, rows.length)) : '—') + '</b></div>' +
      '<div class="stat-row"><span>Cómics en curso</span><b>' + reading + '</b></div>' +
      '<div class="stat-row"><span>Páginas en tu biblioteca</span><b>' + pagesInLibrary.toLocaleString('es') + '</b></div>' +
      '<div class="stat-row"><span>Colecciones</span><b>' + Library.collections.length + '</b></div>' +
    '</div>';

    if (!books.length) {
      html += '<div class="hint-card">' + U.icon('info') + '<span>Añade tu primer cómic para empezar a registrar tu actividad. Todo se guarda únicamente en este dispositivo.</span></div>';
    } else if (!totalPagesRead) {
      html += '<div class="hint-card">' + U.icon('clock') + '<span>Aún no hay actividad registrada. Abre un cómic y las estadísticas se actualizarán automáticamente.</span></div>';
    } else {
      html += '<div class="hint-card">' + U.icon('info') + '<span>Estas cifras nunca salen de tu dispositivo. Comicverse funciona sin conexión y sin cuentas.</span></div>';
    }

    host.innerHTML = html;
  };

  global.Stats = Stats;
})(window);
