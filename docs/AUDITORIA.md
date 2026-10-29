# Auditoría técnica de Comicverse

> Auditoría profunda de la versión **1.0.0** del lector webxdc, realizada el **29 de octubre de 2026**,
> con correcciones aplicadas y verificadas en la versión **1.0.1**.
>
> Reproducible con `node tests/audit.mjs` (17 secciones, ~50 s) más `tests/smoke.mjs` (37 comprobaciones)
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
| 17 | Consola | errores y `pageerror` durante toda la sesión |

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

## 4. Métricas finales (v1.0.1)

| Métrica | Valor | Nota |
|---------|-------|------|
| Arranque en frío | **~0,7 s** | hasta `Library` interactiva, en Chromium headless |
| Recursos iniciales | **13 archivos / 701 KB** | incluido PDF.js y JSZip locales |
| Heap JS tras 6 ciclos abrir/cerrar lector | **32 MB, plano** | sin crecimiento acumulado |
| URLs `blob:` vivas tras cerrar | **1** | la del documento base; la tira vuelve a 1 |
| Listeners `mousemove`/`mouseup` retenidos | **0** | antes 13 + 13 |
| Listeners `scroll` por construcción de la tira | **0** | registrados una sola vez |
| Importar CBZ de 10,4 MB | **271 ms** | hash + índice de 18 páginas |
| Abrir CBZ / primera página | **68 ms / 50 ms** | con caché de 6 páginas y pin ±2 |
| Abrir PDF de 3,8 MB (10 páginas) | **247 ms** | rasterizado por página bajo demanda |
| Biblioteca de 250 cómics | **7 ms** de render | 250 tarjetas |
| Actualizaciones al chat por lectura | **1** (batch) | 191 B, muy por debajo de 128 KB |
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
node tests/audit.mjs               # 17 secciones → tests/audit-findings.json
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
| `assets/js/app.js` | retirada del manejador duplicado del FAB; versión 1.0.1 |
| `assets/css/app.css` | contraste `--faint`, chips de 40 px, sin anillo de foco en contenedores modales |
| `index.html` | viewport con zoom permitido |
| `tests/audit.mjs` | nueva suite de auditoría (17 secciones) |
| `dev/docs-shots.mjs` | capturas deterministas (selección de libros por título) |
