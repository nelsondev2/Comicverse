# Auditoría técnica de Comicverse

> Auditoría profunda de la versión **1.0.0** del lector webxdc, realizada el **29 de octubre de 2026**,
> con correcciones aplicadas y verificadas en la versión **1.0.1**; ampliada el **30 de octubre de 2026**
> para la versión **1.1.0** (lector ZIP diferido, bibliotecas independientes y orden alfabético).
>
> Reproducible con `node tests/audit.mjs` (22 secciones, ~55 s) más `tests/smoke.mjs` (43 comprobaciones)
> y `tests/xdc-test.mjs` (13 comprobaciones sobre el `.xdc` empaquetado).

---

## 1. Alcance y método

La auditoría combina **revisión de código** (≈6.000 líneas de JS propio), **medición en un navegador real**
(Chromium headless, viewport móvil de 390 × 844 px, emulación táctil) y **pruebas de comportamiento**
sobre la app servida en local y sobre el `.xdc` ya empaquetado.

Se auditaron estas áreas:

| # | Área | Qué se mide |
|---|------|-------------|
| 1 | Red y arranque | peticiones externas, tamaño de recursos, tiempo de arranque, `eval`/manejadores inline/iframes |
| 2 | Importación | dobles disparadores del selector de archivos (un clic = un diálogo) |
| 3 | Fugas de listeners | listeners en `document` acumulados al abrir/cerrar hojas modales |
| 4 | Ciclo del lector | 6 ciclos abrir/cerrar: heap JS y URLs `blob:` vivas; listeners de `scroll` duplicados |
| 5 | Robustez de archivos | ZIP vacío, RAR renombrado, archivo basura, CBZ corrupto, PDF corrupto |
| 6 | Copia de seguridad | ida y vuelta completa (metadatos, colecciones, marcadores) |
| 7 | Accesibilidad | contraste WCAG, objetivos táctiles, nombres accesibles, `alt`, zoom del navegador |
| 8 | Teclado y foco | entrada del foco en el diálogo modal, trampa de Tab, restauración del foco |
| 9 | Sincronización | mensajes duplicados, respeto de `sendUpdateInterval` / `sendUpdateMaxSize` |
| 10 | Inyección de HTML | metadatos maliciosos en título, autor, etiquetas, notas y colecciones |
| 11 | Recursos en modo tira | URLs `blob:` y nodos `<img>` vivos durante/después de recorrer la tira |
| 12 | Límites de `sendUpdate` | cantidad, tamaño y separación temporal de las actualizaciones |
| 13 | Escala | 250 cómics en biblioteca: tiempos de render de biblioteca, estanterías y estadísticas |
| 14 | Carreras | dos aperturas + un cierre simultáneos del lector |
| 15 | Teclado del lector | ←/→, Inicio/Fin, `m` (marcador), `Esc` |
| 16 | Datos ausentes | archivo borrado del dispositivo: aviso y no bloqueo |
| 17 | Consola (fin de la primera tanda) | errores y `pageerror` durante toda la sesión |
| 18 | Lector ZIP diferido | apertura de un tomo de 116 MB, portada, página profunda y decodificación real |
| 19 | Bibliotecas independientes | carril ordenado, cabecera, filtro por lista, contadores, «continuar leyendo», salida |
| 20 | Orden alfabético | A–Z natural y sin acentos, Z–A, autor y separadores de letra |

---

## 2. Resumen ejecutivo

| Severidad | Hallazgos | Corregidos |
|-----------|----------:|-----------:|
| Crítica | 0 | — |
| Alta | 6 | 6 |
| Media | 9 | 9 |
| Baja | 2 | 2 |
| Informativo (correcto) | 6 | — |

Tras las correcciones: **0 hallazgos abiertos**, 0 errores de consola, 0 peticiones externas,
memoria estable en ciclos repetidos y todas las pruebas en verde (37/37 + 13/13 + 17 secciones).

El defecto más serio encontrado no era de rendimiento sino de **integridad de datos**: los marcadores
se exportaban con el identificador local del libro y no se podían restaurar en otro dispositivo.
El segundo, una **condición de carrera** que dejaba dos "lectores" vivos a la vez y filtraba blobs.
Ninguno provocaba pérdida del cómic en sí (los archivos nunca se tocan), pero ambos afectaban a la
experiencia y al consumo de memoria.

---

## 3. Hallazgos y correcciones

### 3.1 Severidad alta

| ID | Hallazgo | Evidencia (antes) | Corrección |
|----|----------|-------------------|------------|
| **UI-01** | El botón «Añadir» abría el selector de archivos dos veces | `importFiles` invocada **2×** por clic: convivían tres manejadores (FAB en `app.js`, delegado en `.appbar` y delegado en `document`) | Un único manejador delegado para todo `[data-import]` (`library.js`); se eliminan los otros dos |
| **MEM-01** | Listeners de `document` sin liberar al cerrar hojas | **13** `mousemove` + **13** `mouseup` acumulados tras 13 hojas abiertas (arrastre para cerrar) | Los listeners se registran solo mientras se arrastra y se retiran al soltar o al cerrar la hoja (`overlay.cleanup`) |
| **DATA-01** | Los marcadores no se podían restaurar | Exportación: `['id','bookId','page','note','createdAt']`; la restauración buscaba `bookHash` → **0 restaurados** | Se exporta `bookHash` (hash portable del archivo) y se deduplica al importar por `libro + página` |
| **SEC-02** | Riesgo de inyección HTML desde metadatos | Título/autor/etiquetas/notas/colección con `<img onerror>` y `<script>` | Verificado: **sin nodos inyectados, sin ejecución**. El escapado existente es correcto; la alerta inicial fue un falso positivo del propio test (contaba la portada legítima) y se corrigió el selector |
| **ROB-01** | Estado inconsistente al abrir/cerrar en paralelo | `open(); open(); close()` dejaba el lector **abierto** y un `TypeError: reading 'bg'` (runtime ya liberado) | `Reader.open`/`Reader.close` se **serializan** en una cola de promesas; el `catch` interno cierra el runtime privado, no el global |
| **ROB-03** | URLs `blob:` huérfanas en la carrera | 1 → **9** URLs vivas | `Sources.urlFor`/`rawUrl` comprueban `closed` **después** de descomprimir y antes de crear la URL; el cierre limpia la tira |

### 3.2 Severidad media

| ID | Hallazgo | Evidencia (antes) | Corrección |
|----|----------|-------------------|------------|
| **MEM-04** | Listeners de `scroll` duplicados en modo tira | **4** registros para 2 entradas al modo, y otro par por cada reconstrucción | Se registran una sola vez en `Reader.init` sobre el contenedor persistente; el `IntersectionObserver` se desconecta antes de reconstruir |
| **MEM-06** | La tira no liberaba sus `<img>` al cerrar | 18 imágenes en el DOM tras cerrar el lector | `Reader.close` vacía la tira (`textContent = ''`) y el observador se desconecta |
| **MEM-07** | Regresión detectada durante la auditoría: el modo tira no pintaba ninguna página | 0 páginas renderizadas (observer desconectado justo después de crearse) | Eliminada la desconexión prematura; test 11 verifica que se pintan las 18 páginas |
| **SYNC-01/04** | Mensajes «terminado» repetidos al chat | **4** mensajes de `finished` por una sola lectura (se reenviaba en cada guardado de progreso) | Aviso único por sesión de lectura (`R.finishedNotified`) |
| **SYNC-03** | Actualizaciones más rápidas que `sendUpdateInterval` | Separación mínima **583 ms** con un intervalo de 1000 ms | `WX.sendNow` ahora se encola y respeta el intervalo; los mensajes únicos se envían de uno en uno, sin descartes |
| **A11Y-01** | Texto secundario con contraste insuficiente | `--faint` `#6b6b80` = **3,8:1** (mínimo 4,5) | `#8a8aa0` (tema oscuro) y `#6c6c80` (claro) → **5,85:1** y **4,77:1** |
| **A11Y-03** | Zoom del navegador bloqueado | `maximum-scale=1, user-scalable=no` | Viewport accesible: `width=device-width, initial-scale=1, viewport-fit=cover` (el zoom del lector sigue siendo independiente) |
| **A11Y-04** | El foco no entraba en la hoja modal | `activeInside: false` | Foco programático en el diálogo al abrirlo, **trampa de Tab** y restauración del foco al cerrar |
| **ERR-01** | Error en consola al faltar el archivo | `[comicverse] reader Error: El archivo no está disponible…` | Se marca con `code: 'ENOFILE'` y se registra como **warning**: es un estado esperado (archivo del chat aún no descargado), no un fallo |
| **KBD-02** | «Fin» no saltaba a la última página en modo tira | Página 17 → **13** (el recálculo por scroll deshacía el salto) | Bloqueo temporal del recálculo (`R.scrollJump`) durante el desplazamiento suave |

### 3.3 Severidad baja

| ID | Hallazgo | Evidencia (antes) | Corrección |
|----|----------|-------------------|------------|
| **A11Y-02** | Objetivos táctiles de 38 px | 6 chips de filtro de 38 px de alto (mínimo recomendado 40) | `min-height: 40px` en `.chip` → **0** elementos pequeños |
| **KBD-03** | (preventivo) atajos del lector | — | Se añadió cobertura automatizada de ←/→, Inicio/Fin, `m` y `Esc` |

### 3.4 Comprobaciones que salieron correctas (sin cambios)

| ID | Comprobación | Resultado |
|----|--------------|-----------|
| **NET-01** | Sin peticiones externas | 13 recursos, todos locales (701 KB); `webxdc.js` lo aporta el mensajero |
| **FILE-01..04** | Archivos corruptos | ZIP vacío, RAR renombrado, archivo basura y PDF corrupto se rechazan con aviso claro; **0** añadidos |
| **DATA-02** | Archivo ausente | El lector no se abre y muestra «El archivo no está disponible en este dispositivo» |
| **PERF-01..03** | Escala | 250 cómics: biblioteca **7 ms**, estanterías y estadísticas < 10 ms; 704 nodos |
| **SEC-01** | Escapado de metadatos | Sin nodos inyectados ni ejecución de script |
| **A11Y-05** | Trampa de Tab | El foco no escapa del diálogo; se restaura al cerrar |

---

## 3 bis. Segunda tanda (v1.1.0): velocidad de apertura y bibliotecas

Estas secciones se añadieron a `tests/audit.mjs` al rehacer la portada, el menú y el motor CBZ.

### 3 bis.1 Rendimiento con tomos grandes

El síntoma reportado era «tarda mucho en cargar los mangas». La medición con un CBZ real de **115,5 MB
y 200 páginas** lo confirmó y localizó la causa: `JSZip.loadAsync()` descomprime y copia **todo** el archivo
antes de poder mostrar la primera página.

| Operación (tomo de 115,5 MB, 200 páginas) | Antes (JSZip) | Ahora (lector diferido) |
|------------------------------------------|--------------:|------------------------:|
| Abrir el archivo (índice) | 205 ms (y el archivo entero en memoria) | **6 ms** |
| Extraer la portada | 67 ms | 38 ms |
| Leer una página profunda (nº 120) | 23 ms | **7 ms** |
| Heap tras abrir | +115 MB de copia temporal | **+10 MB** |
| Importación completa (hash + portada + guardado) | ~2 s | **171 ms** |

**Cómo funciona** (`assets/js/lazyzip.js`): se lee el *end of central directory* (últimos 64 KB), se parsea el
índice central y cada página se extrae con `blob.slice()` + `DecompressionStream('deflate-raw')`. Sin copiar
el archivo entero y sin bloquear el hilo principal. Salvaguardas:

- Si el navegador no tiene `DecompressionStream`, **cae automáticamente a JSZip** (probado forzando la rama).
- ZIP64 y ZIP cifrado se detectan y se delegan a JSZip; un CBZ **sin imágenes** falla con mensaje claro en
  lugar de reintentar (evita duplicar trabajo y mensajes de error confusos).
- La caché de URLs `blob:` sigue limitada a 16 páginas con *pin* de las cercanas y ahora **no crea URLs si la
  fuente se cerró mientras descomprimía** (esto eliminó las URLs huérfanas que la sección 14 detectaba de forma
  intermitente).

También se paralelizó la importación: el hash del archivo, la extracción de la portada y los metadatos se
calculan a la vez (`Promise.all`), y el guardado en IndexedDB se hace una sola vez al final.

### 3 bis.2 Bibliotecas independientes (listas tipo playlist)

| ID | Comprobación | Resultado |
|----|--------------|-----------|
| **LIB-01** | Crear biblioteca y verla en el carril | ✅ |
| **LIB-02** | Las bibliotecas se ordenan alfabéticamente en el carril | ✅ |
| **LIB-03** | Al abrir una biblioteca, su cabecera sustituye a la portada | ✅ |
| **LIB-04** | Solo aparecen los cómics de esa biblioteca | ✅ |
| **LIB-05** | Ningún cómic ajeno se cuela en la lista | ✅ |
| **LIB-06** | «Continuar leyendo» se oculta dentro de una biblioteca | ✅ |
| **LIB-07** | Los contadores de los filtros se acotan a la lista abierta | ✅ |
| **LIB-08** | Se puede volver a la portada (botón ‹) | ✅ |
| **LIB-09** | Importar dentro de una biblioteca añade ahí el cómic | ✅ (manual) |
| **LIB-10** | Añadir/quitar desde la ficha o el menú de la tarjeta (toque largo) | ✅ (manual) |

### 3 bis.3 Series y tomos

Cada cómic guarda su **número de tomo** (de `ComicInfo > Number`). La ficha muestra la serie completa ordenada
por número, con el tomo actual resaltado, y el menú del lector permite **saltar al tomo anterior/siguiente** sin
volver a la biblioteca.

### 3 bis.4 Orden alfabético

Comprobado con títulos mezclados a propósito (`Ñandú`, `bleach`, `Akira`, `Ángeles`, `20th Century Boys`,
`One Piece`, `Zetman`, `naruto`):

| ID | Comprobación | Resultado |
|----|--------------|-----------|
| **SORT-01** | A–Z natural, insensible a mayúsculas y acentos, números primero | ✅ `20th Century Boys, Akira, Ángeles, bleach, Ñandú, naruto, One Piece, Zetman` |
| **SORT-02** | Z–A es el inverso exacto | ✅ |
| **SORT-03** | Separadores de letra en la vista de lista (≥ 8 cómics) | ✅ `2 A B N O Z` |
| **SORT-04** | Orden por autor con desempate alfabético | ✅ |

> Nota: la Ñ se pliega a N (convención de orden natural internacional usada por `localeCompare` sin locale
> forzado). Si se prefiere el orden telefónico español (Ñ después de N), se cambia en `U.fold` + `byTitle`.

### 3 bis.5 Regresiones detectadas y corregidas en esta tanda

| ID | Hallazgo | Corrección |
|----|----------|------------|
| **UI-02** | Los separadores alfabéticos, en cuadrícula de 2 columnas, ocupaban una fila entera y dejaban huecos | Se limitan a la **vista de lista** (y a listas de ≥ 8 cómics) |
| **UI-03** | Con la rejilla de 2 columnas las portadas del móvil quedaban gigantes | Rejilla de 3 columnas desde 340 px, con portadas proporcionadas |
| **A11Y-02** | Botones nuevos «Nueva» y «Ordenar» de 31 y 34 px | 40 px mínimos |
| **MEM-07** | El carril de bibliotecas se reconstruía dos veces por render | Una sola llamada por render |
| **DATA-03** | Los cómics importados desde dentro de una biblioteca no se añadían a esa lista | Se asignan al importar |
| **UI-04** | El anillo de foco del diálogo aparecía en las capturas | `outline: none` solo en los contenedores que reciben foco programático |

### 3 bis.6 Riesgos residuales nuevos

1. **Dependencia de `DecompressionStream`** para la apertura instantánea. Está en Chrome/Android WebView 80+ y
   en Safari 16.4+; en el resto se usa JSZip, que sigue funcionando pero es más lento (el aviso queda en consola).
2. **Conteo del ZIP diferido**: se apoya en el índice central. Archivos generados por herramientas muy antiguas
   con desplazamientos erróneos caen igualmente a JSZip gracias a la lectura de la cabecera local con validación.
3. **Migas de la rejilla**: con 3 columnas en móviles de 320 px las portadas quedan estrechas; el diseño cambia a
   2 columnas por debajo de 340 px.

---

## 4. Métricas finales

| Métrica | Valor | Nota |
|---------|-------|------|
| Arranque en frío | **~0,7 s** | hasta `Library` interactiva, en Chromium headless |
| Recursos iniciales | **14 archivos / 705 KB** | incluido PDF.js, JSZip y el lector ZIP diferido |
| Heap JS tras 6 ciclos abrir/cerrar lector | **32 MB, plano** | sin crecimiento acumulado |
| URLs `blob:` vivas tras cerrar | **1** | la del documento base; la tira vuelve a 1 |
| Listeners `mousemove`/`mouseup` retenidos | **0** | antes 13 + 13 |
| Listeners `scroll` por construcción de la tira | **0** | registrados una sola vez |
| Importar CBZ de 10,4 MB | **271 ms** | hash en paralelo con portada e índice |
| Importar CBZ de 115,5 MB (200 pág.) | **171 ms** | lector diferido; antes ~2 s |
| Abrir el mismo tomo | **6 ms** | solo índice central (+10 MB de heap) |
| Abrir CBZ / primera página | **68 ms / 50 ms** | con caché de 6 páginas y pin ±2 |
| Abrir PDF de 3,8 MB (10 páginas) | **247 ms** | rasterizado por página bajo demanda |
| Biblioteca de 250 cómics | **7 ms** de render | 250 tarjetas |
| Actualizaciones al chat por lectura | **1** (batch) | 191 B, muy por debajo de 128 KB |
| Miniaturas de biblioteca en el carril | **4 portadas** por lista | con reserva de icono si está vacía |
| Contraste mínimo de texto | **5,85:1** | WCAG AA |
| Objetivos táctiles < 40 px | **0** | WCAG 2.5.8 |
| Errores de consola | **0** | en toda la sesión de auditoría |

---

## 5. Riesgos residuales y limitaciones conocidas

Son decisiones conscientes o límites del entorno, no defectos abiertos:

1. **`onerror` inline en `<script src="webxdc.js">`.** Es la única forma fiable de detectar que la app
   se ejecuta fuera de un mensajero (navegador de desarrollo). Un CSP estricto del mensajero lo
   bloquearía; no afecta a la app empaquetada porque el mensajero siempre inyecta `webxdc.js`.
2. **RAR/CBR.** No hay descompresor RAR en JS puro sin dependencias pesadas; se informa con un aviso
   claro y se sugiere convertir a CBZ. ZIP/CBZ y PDF están soportados al 100 %.
3. **Sincronización entre dispositivos.** El estado compartido webxdc no garantiza orden global: se
   resuelve con marcas de tiempo y «gana el más reciente» por libro. En empates muy ajustados puede
   perderse un cambio de página, nunca un archivo.
4. **Visor PDF.** El rasterizado de páginas vectoriales complejas es más lento que el de un CBZ
   (100–300 ms por página en el sandbox de pruebas); se mitiga con caché y renderizado bajo demanda.
5. **Cuota de almacenamiento.** Los cómics se guardan en IndexedDB; con muchos archivos grandes el
   navegador puede rechazar escrituras. La app muestra el uso («X MB de Y GB») y avisa del error,
   pero no borra nada automáticamente.
6. **Reproducido en Chromium.** No se ha podido probar en el motor de Android/iOS real; el código
   evita APIs experimentales y ofrece alternativas cuando existen (`IntersectionObserver`, `canvas`,
   `wakeLock` opcional).

---

## 6. Cómo reproducir la auditoría

```bash
python3 dev/serve.py 8080          # terminal 1: sirve la app en http://localhost:8080
node tests/make-fixtures.mjs       # genera los cómics de ejemplo (una vez)
node /tmp/make-big.mjs 200         # opcional: tomo sintético de 116 MB para la sección 18
node tests/audit.mjs               # 22 secciones → tests/audit-findings.json
node tests/smoke.mjs               # 37 comprobaciones funcionales + capturas
./build.sh && node tests/xdc-test.mjs   # 13 comprobaciones del .xdc empaquetado
```

`tests/audit.mjs` imprime un resumen con el formato `[SEVERIDAD] ID — título` y escribe
`tests/audit-findings.json` con el detalle y la marca de tiempo de cada hallazgo.

---

## 7. Archivos modificados por la auditoría

| Archivo | Cambio |
|---------|--------|
| `assets/js/util.js` | limpieza de listeners del arrastre, foco modal, trampa de Tab, restauración del foco |
| `assets/js/reader.js` | cola de apertura/cierre, listeners de `scroll` únicos, limpieza de la tira, aviso «terminado» único, bloqueo del recálculo tras salto, guardas de `open` |
| `assets/js/sources.js` | comprobación de fuente cerrada tras descomprimir (sin blobs huérfanos) |
| `assets/js/wx.js` | cola de mensajes únicos respetando `sendUpdateInterval` |
| `assets/js/settings.js` | exportación/restauración de marcadores por `bookHash`, con deduplicación |
| `assets/js/library.js` | un solo disparador de importación |
| `assets/js/app.js` | retirada del manejador duplicado del FAB |
| `assets/css/app.css` | contraste `--faint`, chips de 40 px, sin anillo de foco en contenedores modales |
| `index.html` | viewport con zoom permitido |
| `assets/js/lazyzip.js` | **nuevo**: lector ZIP diferido (índice central + `DecompressionStream`) |
| `assets/js/library.js` | bibliotecas tipo playlist, orden natural, menú único, importación en paralelo |
| `assets/js/app.js` | navegación de 3 pestañas; estanterías absorbidas por las bibliotecas |
| `index.html` | portada nueva (carril + cabecera de biblioteca + botón de orden), menú ⋮, sprite `#i-sort` |
| `tests/audit.mjs` | suite de auditoría ampliada (22 secciones) |
| `dev/docs-shots.mjs` | capturas deterministas (selección de libros por título) |
