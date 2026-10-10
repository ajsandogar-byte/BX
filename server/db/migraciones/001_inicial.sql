-- BX · Esquema inicial
-- Reglas de diseño:
--   * El dinero se guarda en CENTAVOS (BIGINT). Nunca en flotante.
--   * Nada se borra: las operaciones se cancelan con un asiento contrario.
--   * Cada operación es un asiento con partidas que cuadran por moneda (partida doble).
--   * Las fechas de operación son DATE en hora de Ciudad de México; las marcas de tiempo, DATETIME en UTC.

CREATE TABLE cajas (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(80)  NOT NULL UNIQUE,
  tipo        VARCHAR(10)  NOT NULL CHECK (tipo IN ('matriz','sucursal')),
  activa      TINYINT      NOT NULL DEFAULT 1,
  creado_en   DATETIME     NOT NULL
);

CREATE TABLE usuarios (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  nombre                 VARCHAR(120) NOT NULL,
  usuario                VARCHAR(40)  NOT NULL UNIQUE,
  password_hash          VARCHAR(255) NOT NULL,
  rol                    VARCHAR(12)  NOT NULL CHECK (rol IN ('admin','cuentas','supervisor','cajero')),
  caja_id                INT NULL,
  activo                 TINYINT      NOT NULL DEFAULT 1,
  debe_cambiar_password  TINYINT      NOT NULL DEFAULT 1,
  creado_en              DATETIME     NOT NULL,
  ultimo_acceso          DATETIME NULL,
  FOREIGN KEY (caja_id) REFERENCES cajas(id)
);

CREATE TABLE sesiones (
  token_hash  CHAR(64)    NOT NULL PRIMARY KEY,
  usuario_id  INT         NOT NULL,
  creado_en   DATETIME    NOT NULL,
  expira_en   DATETIME    NOT NULL,
  ip          VARCHAR(64) NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
CREATE INDEX ix_sesiones_usuario ON sesiones (usuario_id);

CREATE TABLE clientes (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  nombre         VARCHAR(160) NOT NULL,
  comision_base  DECIMAL(7,4) NOT NULL,
  modalidad      VARCHAR(2)   NOT NULL CHECK (modalidad IN ('NA','CF')),
  atiende_id     INT NULL,
  notas          TEXT NULL,
  activo         TINYINT      NOT NULL DEFAULT 1,
  creado_en      DATETIME     NOT NULL,
  FOREIGN KEY (atiende_id) REFERENCES usuarios(id)
);

CREATE TABLE proveedores (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(160) NOT NULL,
  tipo          VARCHAR(8)   NOT NULL CHECK (tipo IN ('interno','externo')),
  comision_na   DECIMAL(7,4) NOT NULL,
  comision_cf   DECIMAL(7,4) NOT NULL,
  mapeo_edocta  TEXT NULL,
  notas         TEXT NULL,
  activo        TINYINT      NOT NULL DEFAULT 1,
  creado_en     DATETIME     NOT NULL
);

-- Catálogo de cuentas contables. Se crean solas la primera vez que se usan.
CREATE TABLE cuentas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  codigo        VARCHAR(80)  NOT NULL UNIQUE,
  nombre        VARCHAR(200) NOT NULL,
  naturaleza    VARCHAR(10)  NOT NULL CHECK (naturaleza IN ('activo','pasivo','capital','ingreso','gasto','orden')),
  moneda        CHAR(3)      NOT NULL,
  caja_id       INT NULL,
  cliente_id    INT NULL,
  proveedor_id  INT NULL,
  creado_en     DATETIME     NOT NULL
);
CREATE INDEX ix_cuentas_caja ON cuentas (caja_id);
CREATE INDEX ix_cuentas_cliente ON cuentas (cliente_id);
CREATE INDEX ix_cuentas_proveedor ON cuentas (proveedor_id);

-- Un asiento = una operación. Las cancelaciones son otro asiento que apunta al original.
CREATE TABLE asientos (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  tipo                VARCHAR(30)  NOT NULL,
  fecha_operacion     DATE         NOT NULL,
  caja_id             INT NULL,
  caja_destino_id     INT NULL,
  cliente_id          INT NULL,
  proveedor_id        INT NULL,
  usuario_id          INT          NOT NULL,
  referencia          VARCHAR(120) NULL,
  concepto            VARCHAR(255) NULL,
  datos               TEXT NULL,
  cancela_a           BIGINT NULL,
  cancelado_por       BIGINT NULL,
  motivo_cancelacion  VARCHAR(255) NULL,
  creado_en           DATETIME     NOT NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
CREATE INDEX ix_asientos_fecha ON asientos (fecha_operacion);
CREATE INDEX ix_asientos_caja ON asientos (caja_id, fecha_operacion);
CREATE INDEX ix_asientos_destino ON asientos (caja_destino_id, fecha_operacion);
CREATE INDEX ix_asientos_cliente ON asientos (cliente_id);
CREATE INDEX ix_asientos_proveedor ON asientos (proveedor_id);

-- Monto en centavos: positivo = cargo (debe), negativo = abono (haber).
CREATE TABLE partidas (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  asiento_id  BIGINT  NOT NULL,
  cuenta_id   INT     NOT NULL,
  moneda      CHAR(3) NOT NULL,
  monto       BIGINT  NOT NULL,
  FOREIGN KEY (asiento_id) REFERENCES asientos(id),
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id)
);
CREATE INDEX ix_partidas_cuenta ON partidas (cuenta_id);
CREATE INDEX ix_partidas_asiento ON partidas (asiento_id);

-- Existencia por caja y moneda (centavos) y costo en pesos de la divisa. Sirve de candado
-- para operaciones simultáneas y para el costo promedio.
CREATE TABLE inventario (
  caja_id   INT     NOT NULL,
  moneda    CHAR(3) NOT NULL,
  cantidad  BIGINT  NOT NULL DEFAULT 0,
  costo     BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (caja_id, moneda),
  FOREIGN KEY (caja_id) REFERENCES cajas(id)
);

CREATE TABLE cortes (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  caja_id             INT          NOT NULL,
  fecha               DATE         NOT NULL,
  estado              VARCHAR(10)  NOT NULL CHECK (estado IN ('cerrado','reabierto')),
  esperado            TEXT         NOT NULL,
  contado             TEXT         NOT NULL,
  diferencia          TEXT         NOT NULL,
  enviado             TEXT         NOT NULL,
  nota                VARCHAR(255) NULL,
  usuario_id          INT          NOT NULL,
  creado_en           DATETIME     NOT NULL,
  reabierto_por       INT NULL,
  reabierto_en        DATETIME NULL,
  motivo_reapertura   VARCHAR(255) NULL,
  FOREIGN KEY (caja_id) REFERENCES cajas(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
CREATE INDEX ix_cortes_caja ON cortes (caja_id, estado, fecha);

-- Líneas importadas de estados de cuenta de proveedores internos.
CREATE TABLE edocta_lineas (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  proveedor_id  INT          NOT NULL,
  huella        CHAR(32)     NOT NULL,
  fecha         DATE         NOT NULL,
  descripcion   VARCHAR(255) NULL,
  referencia    VARCHAR(120) NULL,
  abono         BIGINT       NOT NULL DEFAULT 0,
  cargo         BIGINT       NOT NULL DEFAULT 0,
  saldo         BIGINT NULL,
  estado        VARCHAR(10)  NOT NULL CHECK (estado IN ('pendiente','noident','asignado')),
  asiento_id    BIGINT NULL,
  archivo       VARCHAR(255) NULL,
  importado_por INT          NOT NULL,
  importado_en  DATETIME     NOT NULL,
  UNIQUE (proveedor_id, huella),
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
);
CREATE INDEX ix_edocta_estado ON edocta_lineas (proveedor_id, estado);

-- Bitácora: quién hizo qué y cuándo.
CREATE TABLE bitacora (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT NULL,
  accion      VARCHAR(60)  NOT NULL,
  entidad     VARCHAR(40)  NULL,
  entidad_id  VARCHAR(40)  NULL,
  detalle     TEXT NULL,
  ip          VARCHAR(64)  NULL,
  creado_en   DATETIME     NOT NULL
);
CREATE INDEX ix_bitacora_fecha ON bitacora (creado_en);

-- La matriz siempre existe.
INSERT INTO cajas (id, nombre, tipo, activa, creado_en) VALUES (1, 'Matriz', 'matriz', 1, '2026-01-01 00:00:00');
INSERT INTO inventario (caja_id, moneda, cantidad, costo) VALUES (1,'MXN',0,0), (1,'USD',0,0), (1,'EUR',0,0), (1,'CAD',0,0), (1,'GBP',0,0);
