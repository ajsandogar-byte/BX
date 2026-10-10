# BX — notas para trabajar en este repo

Sistema interno de una casa de cambios (matriz + 14 sucursales): saldos de clientes y proveedores, cajas multimoneda, cortes. La contabilidad fiscal vive en i-Money; no se integra.

## Reglas que no se rompen

- Dinero siempre en **centavos enteros** (`BIGINT`). Convertir con `aCentavos` / `aPesos` (`server/src/lib/dinero.js`).
- Toda operación pasa por `registrar()` en `server/src/contabilidad/libro.js` con partidas generadas por `reglas.js`. Las partidas deben cuadrar por moneda. Positivo = cargo, negativo = abono.
- Nada se borra: se cancela con `cancelar()` (asiento contrario).
- Todo cambio de efectivo de una caja lleva su movimiento de `inventario`; la tabla `inventario` debe coincidir siempre con las cuentas `CAJA:*` (lo revisa `GET /api/verificar-libro`).
- Permisos en el servidor (`server/src/auth/permisos.js`). Una caja sin acceso responde 404, no 403.
- Fechas de operación en hora de Ciudad de México; después de `HORA_CORTE` se usa el día siguiente; nunca en un día ya cerrado por corte.
- SQL portable entre MySQL y SQLite (las pruebas usan SQLite): sin `ENUM`, `ON DUPLICATE KEY`, funciones de fecha de MySQL ni JSON en SQL. `FOR UPDATE` sí (las pruebas lo quitan).
- Textos para el usuario en español, claros, diciendo qué pasó y cómo arreglarlo.

## Comandos

- `cd server && npm test` — pruebas (node:test + SQLite en memoria).
- `npm run migrar`, `npm run crear-admin -- --usuario x --nombre "X"`, `npm start`.
- Migraciones nuevas: archivo `server/db/migraciones/NNN_descripcion.sql`, nunca editar una ya aplicada.

## Pantallas (`web/`)

- React 19 + Vite, sin librerías extra. Rutas por hash (`#/cajas`), secciones por rol en `App.jsx`.
- `api.js` manda `X-BX: 1` y convierte errores; `useDatos(ruta)` para cargar. Los montos se mandan como texto tal cual los escribe el usuario; el servidor los convierte.
- Estilos en `estilos.css` (tokens del prototipo, modo oscuro automático). El prototipo original está en `docs/prototipo.html`.

## Pendiente

- Importación de estados de cuenta de proveedores internos (tabla `edocta_lineas` ya existe), asignación a clientes y "No identificados" con `reglas.noIdentificado`.
