# Comicverse

**Lector de cómics CBZ y PDF para [webxdc](https://webxdc.org) — dentro de tu chat, sin conexión y sin cuentas.**

Comicverse es una mini-app webxdc (Delta Chat, Cheogram, ArcaneChat…) escrita en HTML, CSS y JavaScript
puro: sin Node.js, sin React y sin frameworks. Todas las librerías van incluidas en el paquete, así que la
app funciona 100 % offline y nunca habla con ningún servidor.

![Comicverse](icon.png)

| Biblioteca | Lector | Página doble | Tira vertical |
| --- | --- | --- | --- |
| ![Biblioteca](docs/screenshots/03-library.png) | ![Lector](docs/screenshots/05-reader.png) | ![Doble página](docs/screenshots/08-spread.png) | ![Tira vertical](docs/screenshots/09-scroll.png) |

| Ficha del cómic | Ajustes de lectura | Miniaturas | Estanterías |
| --- | --- | --- | --- |
| ![Detalles](docs/screenshots/04-details.png) | ![Ajustes de lectura](docs/screenshots/06-reader-settings.png) | ![Miniaturas](docs/screenshots/07-thumbnails.png) | ![Estanterías](docs/screenshots/11-shelves.png) |

| PDF | Estadísticas | Ajustes | Escritorio |
| --- | --- | --- | --- |
| ![PDF](docs/screenshots/10-pdf.png) | ![Estadísticas](docs/screenshots/12-stats.png) | ![Ajustes](docs/screenshots/13-settings.png) | ![Escritorio](docs/screenshots/15-desktop.png) |

---

## Características

### Lectura
- **CBZ/ZIP** (descomprime en memoria con JSZip) y **PDF** (pdf.js en worker, render a canvas nítido por DPI).
- Tres modos: **página única**, **página doble** (con reparto correcto de portada e impares) y **tira vertical** (webtoon).
- **Zoom con pellizco** (1×–6×) con paneo limitado a los bordes de la página, **doble toque** para zoom rápido y rueda/trackpad en escritorio.
- Ajuste **página / ancho / alto**, fondo **negro / gris / claro**, control de **brillo**, **modo nocturno**.
- Dirección de lectura **izquierda→derecha** o **derecha→izquierda** (manga).
- Transiciones de página tipo «carrusel» (desactivables), gestos de swipe, zonas de toque, atajos de teclado.
- **Miniaturas** para saltar a cualquier página, marcador de página, barra de progreso con *scrub*.
- Preferencias **por cómic** + valores predeterminados globales.

### Biblioteca
- Importación múltiple con cola de progreso, **detección de duplicados** por hash y extracción automática de portada.
- **Metadatos ComicInfo.xml**: título, serie, autor, editorial, año, géneros y sinopsis.
- Búsqueda **sin acentos**, filtros (todos / leyendo / sin empezar / terminados / favoritos), orden y vistas **cuadrícula/lista**.
- Ficha de detalle: edición de título, autor, serie, etiquetas, notas, favoritos, colecciones y marcadores.
- **Continuar leyendo** en la portada, progreso visible en cada portada.
- **Estanterías inteligentes** (favoritos, en curso, terminados) y **colecciones** propias.

### Estadísticas y datos
- Tiempo de lectura, páginas leídas, racha de días y gráfico de los últimos 7 días.
- Copia de seguridad JSON (exportar/restaurar) y borrado completo de datos.
- Tema **oscuro / claro / automático**, seis acentos, diseño mobile-first con barra lateral en escritorio.

### Integración con el chat (webxdc)
- `webxdc.importFiles()` para importar CBZ/PDF directamente desde los adjuntos del chat.
- `webxdc.sendToChat()` para reenviar un cómic o la copia de seguridad.
- `sendUpdate()` / `setUpdateListener()` para **sincronizar el progreso de lectura** entre miembros del chat,
  con *throttling* respetando `sendUpdateInterval` y `sendUpdateMaxSize`, y agrupado (*batch*) de mensajes.
- Sin `webxdc.js` (navegador normal) usa `<input type=file>` y descarga de archivos, sin errores.

---

## Estructura

```
Comicverse/
├── index.html              # shell de la app (una sola página)
├── manifest.toml           # metadatos webxdc
├── icon.png                # icono 512×512
├── build.sh                # empaqueta release/comicverse-<version>.xdc
├── assets/
│   ├── css/app.css         # sistema de diseño completo (tokens, componentes, lector)
│   ├── js/
│   │   ├── util.js         # helpers, toasts, sheets/modales
│   │   ├── db.js           # IndexedDB (libros, archivos, marcadores, colecciones, stats)
│   │   ├── wx.js           # capa webxdc + fallbacks de navegador
│   │   ├── sources.js      # CBZ (JSZip) + PDF (pdf.js) + portadas
│   │   ├── library.js      # biblioteca, importación, metadatos, colecciones
│   │   ├── reader.js       # motor de lectura (paginado, doble, scroll, zoom, gestos)
│   │   ├── stats.js        # estadísticas
│   │   ├── settings.js     # ajustes, almacenamiento, backups
│   │   └── app.js          # arranque, navegación, estanterías, sync del chat
│   └── vendor/             # pdf.js 3.11 + JSZip 3.10 (locales, con sus licencias)
├── dev/                    # solo desarrollo: servidor local, simulador webxdc, icono, capturas
├── tests/                  # pruebas E2E con Chromium + generador de cómics de ejemplo
└── docs/                   # capturas del README y auditoría técnica (AUDITORIA.md)
```

`dev/` y `tests/` **nunca** se empaquetan en el `.xdc`, y `webxdc.js` tampoco: lo inyecta el mensajero.

---

## Desarrollo

```bash
python3 dev/serve.py 8080      # http://localhost:8080 (inyecta dev/webxdc.js como simulador)
```

El simulador de webxdc permite probar `importFiles`, `sendToChat` y las actualizaciones sin mensajero.

### Pruebas

```bash
node tests/make-fixtures.mjs   # genera 2 CBZ (con ComicInfo.xml) + 1 PDF de ejemplo
node tests/smoke.mjs           # 37 comprobaciones E2E + capturas en tests/shots
node tests/audit.mjs           # auditoría: red, fugas, memoria, a11y, sync, XSS, escala
node tests/xdc-test.mjs        # prueba el .xdc empaquetado como lo haría el mensajero
node dev/docs-shots.mjs        # regenera las capturas de docs/screenshots
```

Los resultados de la auditoría técnica (17 secciones, hallazgos y correcciones) están en
[`docs/AUDITORIA.md`](docs/AUDITORIA.md).

Todos los scripts usan Chromium headless mediante `puppeteer-core` (instalado aparte, fuera del repo).

---

## Empaquetar

```bash
./build.sh                     # → release/comicverse-1.0.1.xdc (~2,2 MB)
```

El `.xdc` es un ZIP con `index.html`, `manifest.toml`, `icon.png` y `assets/`. Comparte el archivo en
cualquier chat de Delta Chat y pulsa **Iniciar** para usarlo.

---

## Privacidad

Comicverse no tiene servidores, analíticas, cuentas ni permisos de red. Los cómics, las portadas, el progreso
y las estadísticas viven **solo** en el almacenamiento local del dispositivo (IndexedDB). Lo único que viaja
al chat es lo que el usuario decide enviar o el progreso de lectura (opcional y desactivable) mediante la API
del mensajero.

## Licencias de terceros

- **pdf.js** — Apache License 2.0 (`assets/vendor/pdfjs/LICENSE`)
- **JSZip** — MIT / GPLv3 (`assets/vendor/JSZIP-LICENSE.markdown`)
- Iconos e ilustraciones — SVG propios.

## Licencia

MIT.
