# BX

Sistema interno para administrar:

- saldos de clientes y proveedores (depósitos, pagos y comisiones N/A y C/F),
- las cajas de la matriz y las sucursales en MXN, USD, EUR, CAD y GBP,
- la compra y venta de divisas con costo promedio y utilidad cambiaria,
- traspasos entre cajas y el corte diario de las 4:30.

La contabilidad fiscal y los impuestos siguen en i-Money; BX es para la operación diaria.

## Cómo está hecho

| Parte | Qué es |
|---|---|
| `server/` | API en Node.js (sin framework) con MySQL. Aquí viven todas las reglas y los permisos. |
| `web/` | Pantallas en React (Vite). En producción el servidor las sirve ya compiladas. |

Decisiones importantes:

- **Partida doble.** Cada operación es un *asiento* con *partidas* que cuadran por moneda. Los saldos salen de sumar partidas; no hay saldos "a mano" que se puedan descuadrar.
- **Nada se borra.** Una operación equivocada se **cancela** con un asiento contrario, y queda el motivo y quién lo hizo.
- **Dinero en centavos** (enteros). Nunca decimales de computadora.
- **El servidor decide los permisos.** Un cajero solo recibe datos de su caja aunque intente pedir otros.
- **Bitácora** de todo: entradas al sistema, altas, operaciones, cancelaciones, cortes.
- **Cortes.** Después de las 4:30 las operaciones se registran con fecha del día siguiente. Un corte cierra el día de esa caja; solo un administrador o supervisor puede reabrirlo, con motivo.

### Roles

| Rol | Puede |
|---|---|
| Administrador | Todo, incluidos usuarios, sucursales, saldos iniciales y bitácora. |
| Administrador de cuentas | Clientes, proveedores, depósitos, pagos, ajustes y estados de cuenta. No ve cajas. |
| Supervisor de sucursales | Las cajas de las sucursales (no la matriz): opera, hace cortes y los reabre. |
| Cajero | Solo su caja: la ve, opera y hace su corte. |

### Cuentas contables

Se crean solas la primera vez que se usan:

| Código | Qué guarda |
|---|---|
| `CAJA:{caja}:{moneda}` | Efectivo de cada caja por moneda |
| `CONTRA:{caja}:{moneda}` | Costo en pesos de la divisa en existencia (para el costo promedio) |
| `POS:{caja}:{moneda}` | Contrapartida en unidades de divisa (cuenta de orden) |
| `CLI:{id}` | Saldo a favor de cada cliente |
| `PROV:{id}` | Lo que tenemos con cada proveedor |
| `NOID:{proveedor}` | Depósitos no identificados en proveedores internos |
| `ING:COMISIONES` / `COSTO:COMISIONES` | Comisión cobrada al cliente / pagada al proveedor |
| `ING:CAMBIARIA` | Utilidad por venta de divisas |
| `GASTO:{categoría}` | Gastos de operación |
| `AJ:CORTE` | Sobrantes y faltantes |
| `CAP:INICIAL`, `AJ:SALDOS`, `OTRAS:*` | Saldos iniciales, ajustes y movimientos sin contraparte |

## Instalar en una computadora para probar

Necesitas **Node.js 22 o más nuevo** y **MySQL 8**.

1. Crea la base de datos y su usuario (en la consola de MySQL):

   ```sql
   CREATE DATABASE bx CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'bx'@'localhost' IDENTIFIED BY 'una-contraseña-segura';
   GRANT ALL PRIVILEGES ON bx.* TO 'bx'@'localhost';
   ```

2. Configura el servidor:

   ```bash
   cd server
   npm install
   cp .env.example .env      # y escribe ahí la contraseña de MySQL
   npm run migrar            # crea las tablas
   npm run crear-admin -- --usuario tu_usuario --nombre "Tu Nombre"
   npm start
   ```

3. Compila las pantallas y dile al servidor dónde están:

   ```bash
   cd ../web
   npm install
   npm run build             # crea web/dist
   ```

   En `server/.env` quita el `#` de la línea `CARPETA_WEB=../web/dist` y reinicia el servidor (`npm start` dentro de `server/`).

4. Abre <http://localhost:3000> y entra con el administrador que creaste.

Para que otras computadoras de la red local entren, usa la IP de esta computadora (por ejemplo `http://192.168.1.50:3000`) y permite el puerto 3000 en el firewall.

### Mientras se programa

Con el servidor corriendo (`npm start` en `server/`), en otra terminal: `cd web && npm run dev` y abre <http://localhost:5173>. Los cambios en las pantallas se ven al instante.

## Pruebas

```bash
cd server
npm test
```

Las pruebas levantan la API completa contra una base SQLite en memoria (incluida en Node) y recorren el flujo real: roles, depósitos, compra y venta de divisas, cortes con faltante y envío a matriz, cancelaciones y que el libro cuadre.

## API (resumen)

Todas las rutas empiezan con `/api`. Las que escriben piden la cabecera `X-BX: 1` (protección contra otros sitios).

| Método y ruta | Quién | Para qué |
|---|---|---|
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/yo`, `POST /auth/password` | todos | Sesión y cambio de contraseña |
| `GET/POST/PATCH /usuarios`, `POST /usuarios/:id/restablecer` | admin | Usuarios |
| `GET/POST/PATCH /clientes`, `GET /clientes/:id/estado-cuenta` | admin, cuentas | Clientes |
| `GET/POST/PATCH /proveedores`, `GET /proveedores/:id/estado-cuenta` | admin, cuentas | Proveedores |
| `GET/POST /operaciones` | admin, cuentas | Depósitos, pagos, ajustes, saldos iniciales |
| `GET /cajas`, `POST/PATCH /cajas` (admin) | cajas | Cajas con existencias, costo promedio y estado de corte |
| `GET/POST /cajas/:id/movimientos` | cajas | Compra, venta, entrada, salida, gasto, traspaso |
| `GET /cajas/:id/corte?fecha=`, `GET/POST /cajas/:id/cortes`, `POST /cortes/:id/reabrir` | cajas | Corte diario |
| `GET /asientos/:id`, `POST /asientos/:id/cancelar` | según la operación | Detalle y cancelación |
| `GET /resumen`, `GET /verificar-libro`, `GET /bitacora` | según rol | Tablero, revisión contable y bitácora |
