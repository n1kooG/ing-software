-- =====================================================================
-- SGI Tienda Oregón - Modelo físico PostgreSQL (Amazon RDS)
-- Proyecto Integrado INACAP - Comercial Oregon SpA
-- Basado en: Diagrama de Clases (vista lógica 4+1), pantallas UI y plan de pruebas
-- Convención: tablas y columnas en snake_case, mismos nombres del diagrama de clases
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- búsqueda predictiva por SKU / modelo / nombre
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- bcrypt (crypt / gen_salt) para el hash de claves

-- ---------------------------------------------------------------------
-- Función de validación de RUT chileno (módulo 11), usada en CHECK
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_rut_valido(p_rut TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  cuerpo TEXT; dv TEXT; suma INT := 0; mult INT := 2; i INT; resto INT; esperado TEXT;
BEGIN
  IF p_rut !~ '^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$' THEN RETURN FALSE; END IF;
  cuerpo := regexp_replace(split_part(p_rut, '-', 1), '\.', '', 'g');
  dv     := upper(split_part(p_rut, '-', 2));
  FOR i IN REVERSE length(cuerpo)..1 LOOP
    suma := suma + substr(cuerpo, i, 1)::INT * mult;
    mult := CASE WHEN mult = 7 THEN 2 ELSE mult + 1 END;
  END LOOP;
  resto    := 11 - (suma % 11);
  esperado := CASE resto WHEN 11 THEN '0' WHEN 10 THEN 'K' ELSE resto::TEXT END;
  RETURN dv = esperado;
END $$;

-- =====================================================================
-- MÓDULO SEGURIDAD (HU08): Rol, Usuario
-- =====================================================================
CREATE TABLE rol (
  id_rol       SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre_rol   VARCHAR(20)  NOT NULL UNIQUE CHECK (nombre_rol = upper(nombre_rol)),
  descripcion  VARCHAR(200) NOT NULL,
  permisos     JSONB        NOT NULL DEFAULT '[]'::jsonb
               CHECK (jsonb_typeof(permisos) = 'array')      -- List<string> del diagrama de clases
);

CREATE TABLE usuario (
  id_usuario         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rut                VARCHAR(12)  NOT NULL UNIQUE CHECK (fn_rut_valido(rut)),
  nombre_completo    VARCHAR(120) NOT NULL,
  email              VARCHAR(120) NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash      VARCHAR(100) NOT NULL,                  -- bcrypt, cost >= 12 (PU-06)
  id_rol             SMALLINT     NOT NULL REFERENCES rol (id_rol)
                     ON UPDATE RESTRICT ON DELETE RESTRICT,
  activo             BOOLEAN      NOT NULL DEFAULT TRUE,
  intentos_fallidos  SMALLINT     NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),  -- bloqueo por intentos fallidos (plan de seguridad)
  bloqueado_hasta    TIMESTAMPTZ,                                                     -- NULL = cuenta sin bloqueo
  ultimo_acceso      TIMESTAMPTZ,                                                     -- último inicio de sesión exitoso
  fecha_creacion     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_usuario_email_lower ON usuario (lower(email));  -- login sin distinguir mayúsculas
CREATE INDEX ix_usuario_rol ON usuario (id_rol);

-- =====================================================================
-- MÓDULO CATÁLOGO E INVENTARIO (HU01, HU02, HU06, HU09): Producto, Inventario, ListaPrecio
-- =====================================================================
CREATE TABLE producto (
  sku                     VARCHAR(30)   PRIMARY KEY
                          CHECK (sku = upper(btrim(sku)) AND sku <> ''),   -- SKU normalizado y único (HU01)
  modelo                  VARCHAR(60)   NOT NULL,
  nombre                  VARCHAR(150)  NOT NULL,
  marca                   VARCHAR(60)   NOT NULL,
  descripcion             TEXT,
  categoria               VARCHAR(60),                                      -- T05
  costo_adquisicion_neto  NUMERIC(12,2) NOT NULL CHECK (costo_adquisicion_neto >= 0),
  stock_minimo            INTEGER       NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  estado                  VARCHAR(10)   NOT NULL DEFAULT 'ACTIVO'
                          CHECK (estado IN ('ACTIVO', 'INACTIVO'))          -- inactivar() en vez de borrar
);

CREATE TABLE inventario (
  id_inventario    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku              VARCHAR(30) NOT NULL UNIQUE                              -- relación 1 a 1 con producto
                   REFERENCES producto (sku) ON UPDATE RESTRICT ON DELETE RESTRICT,
  stock_fisico     INTEGER     NOT NULL DEFAULT 0 CHECK (stock_fisico >= 0), -- nunca negativo (PU-05)
  stock_reservado  INTEGER     NOT NULL DEFAULT 0 CHECK (stock_reservado >= 0),
  ubicacion_bodega VARCHAR(40),                                             -- "Pasillo A - Estante 2"
  CONSTRAINT ck_reservado_menor_fisico CHECK (stock_reservado <= stock_fisico)
);

CREATE TABLE lista_precio (
  id_lista           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku                VARCHAR(30)   NOT NULL REFERENCES producto (sku)
                     ON UPDATE RESTRICT ON DELETE RESTRICT,
  canal_venta        VARCHAR(15)   NOT NULL
                     CHECK (canal_venta IN ('WEB', 'MARKETPLACE', 'MAYORISTA')),   -- T09
  precio_venta_neto  NUMERIC(12,2) NOT NULL CHECK (precio_venta_neto > 0),
  margen_porcentual  NUMERIC(6,2),                                          -- calculado por trigger (T11)
  CONSTRAINT ux_lista_sku_canal UNIQUE (sku, canal_venta)                   -- una tarifa por canal y SKU
);

-- ---------------------------------------------------------------------
-- Regla: SKU inmutable (CU-03)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_producto_sku_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El SKU es inmutable: no se puede cambiar % por %', OLD.sku, NEW.sku
        USING ERRCODE = 'integrity_constraint_violation';
END $$;
CREATE TRIGGER trg_producto_sku_inmutable
  BEFORE UPDATE OF sku ON producto
  FOR EACH ROW WHEN (OLD.sku IS DISTINCT FROM NEW.sku)
  EXECUTE FUNCTION fn_producto_sku_inmutable();

-- ---------------------------------------------------------------------
-- Regla: margen = (precio - costo) / precio * 100 (PU-02, PU-03) y precio > costo
--        El costo vive solo en producto: la tarifa nunca puede alterarlo (T11)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_lista_precio_margen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_costo NUMERIC;
BEGIN
  SELECT costo_adquisicion_neto INTO v_costo FROM producto WHERE sku = NEW.sku;
  IF NEW.precio_venta_neto <= v_costo THEN
    RAISE EXCEPTION 'El precio de venta (%) debe ser mayor al costo neto (%) del SKU %',
          NEW.precio_venta_neto, v_costo, NEW.sku USING ERRCODE = 'check_violation';
  END IF;
  NEW.margen_porcentual := round((NEW.precio_venta_neto - v_costo) / NEW.precio_venta_neto * 100, 2);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_lista_precio_margen
  BEFORE INSERT OR UPDATE OF precio_venta_neto ON lista_precio
  FOR EACH ROW EXECUTE FUNCTION fn_lista_precio_margen();

CREATE OR REPLACE FUNCTION fn_producto_recalcular_margenes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE lista_precio
     SET margen_porcentual = round((precio_venta_neto - NEW.costo_adquisicion_neto) / precio_venta_neto * 100, 2)
   WHERE sku = NEW.sku;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_producto_recalcular_margenes
  AFTER UPDATE OF costo_adquisicion_neto ON producto
  FOR EACH ROW EXECUTE FUNCTION fn_producto_recalcular_margenes();

-- =====================================================================
-- MÓDULO COMPRAS (HU03): RecepcionCompra, DetalleRecepcion
-- =====================================================================
CREATE TABLE recepcion_compra (
  id_recepcion      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_usuario        INTEGER       NOT NULL REFERENCES usuario (id_usuario)
                    ON UPDATE RESTRICT ON DELETE RESTRICT,                  -- Usuario "registra" la recepción
  numero_factura    VARCHAR(20)   NOT NULL,
  rut_proveedor     VARCHAR(12)   NOT NULL CHECK (fn_rut_valido(rut_proveedor)),
  nombre_proveedor  VARCHAR(120)  NOT NULL,
  fecha_emision     DATE          NOT NULL,                                 -- fecha de la factura electrónica
  fecha_recepcion   TIMESTAMPTZ   NOT NULL DEFAULT now(),                   -- fecha de ingreso a bodega
  forma_pago        VARCHAR(30)   NOT NULL,
  url_pdf_factura   TEXT,                                                   -- clave del objeto en Amazon S3
  monto_neto        NUMERIC(14,2) NOT NULL CHECK (monto_neto >= 0),
  monto_iva         NUMERIC(14,2) NOT NULL CHECK (monto_iva >= 0),
  monto_total       NUMERIC(14,2) NOT NULL,
  estado_documento  VARCHAR(20)   NOT NULL DEFAULT 'CONFORME'
                    CHECK (estado_documento IN ('CONFORME', 'CON_DISCREPANCIA')),
  CONSTRAINT ux_factura_proveedor UNIQUE (rut_proveedor, numero_factura),   -- no se registra dos veces la misma factura
  CONSTRAINT ck_total_factura CHECK (monto_total = monto_neto + monto_iva)
);
CREATE INDEX ix_recepcion_fecha   ON recepcion_compra (fecha_recepcion);
CREATE INDEX ix_recepcion_usuario ON recepcion_compra (id_usuario);

CREATE TABLE detalle_recepcion (
  id_detalle_rec       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_recepcion         INTEGER       NOT NULL REFERENCES recepcion_compra (id_recepcion)
                       ON UPDATE RESTRICT ON DELETE CASCADE,                -- composición
  sku                  VARCHAR(30)   NOT NULL REFERENCES producto (sku)
                       ON UPDATE RESTRICT ON DELETE RESTRICT,
  cantidad_recibida    INTEGER       NOT NULL CHECK (cantidad_recibida > 0),
  precio_unitario_neto NUMERIC(12,2) NOT NULL CHECK (precio_unitario_neto >= 0),
  observaciones_dano   VARCHAR(300),
  CONSTRAINT ux_detrec_recepcion_sku UNIQUE (id_recepcion, sku)
);
CREATE INDEX ix_detrec_sku ON detalle_recepcion (sku);

-- =====================================================================
-- MÓDULO VENTAS Y DESPACHO (HU04, HU05, HU07):
--   LoteImportacion, OrdenVenta, DetalleVenta, Despacho
-- =====================================================================
CREATE TABLE lote_importacion (
  id_lote          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_usuario       INTEGER      NOT NULL REFERENCES usuario (id_usuario)
                   ON UPDATE RESTRICT ON DELETE RESTRICT,
  nombre_archivo   VARCHAR(150) NOT NULL,                                   -- ej. ventas_lote_201.xlsx
  url_archivo_s3   TEXT         NOT NULL,                                   -- urlArchivo (secuencia HU04)
  fecha_carga      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  total_ordenes    INTEGER      NOT NULL CHECK (total_ordenes >= 0),
  total_lineas     INTEGER      NOT NULL CHECK (total_lineas >= 0)
);
CREATE INDEX ix_lote_usuario ON lote_importacion (id_usuario);
CREATE INDEX ix_lote_fecha   ON lote_importacion (fecha_carga);

CREATE TABLE orden_venta (
  id_orden              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_lote               INTEGER      NOT NULL REFERENCES lote_importacion (id_lote)
                        ON UPDATE RESTRICT ON DELETE RESTRICT,
  codigo_externo        VARCHAR(40)  NOT NULL,                              -- ORD-1024, MKP-FAL-0810
  canal_origen          VARCHAR(30)  NOT NULL,                              -- Mercado Libre, Paris, Ripley, ...
  fecha_orden           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  rut_cliente           VARCHAR(12)  CHECK (rut_cliente IS NULL OR fn_rut_valido(rut_cliente)),
  nombre_cliente        VARCHAR(120) NOT NULL,
  direccion_despacho    VARCHAR(200),
  comuna                VARCHAR(60),
  telefono_contacto     VARCHAR(20),
  estado_orden          VARCHAR(25)  NOT NULL DEFAULT 'PENDIENTE_PREPARACION'
                        CHECK (estado_orden IN ('PENDIENTE_PREPARACION', 'ARMADO', 'ETIQUETADO',
                                                'EN_CAMION', 'EN_RUTA', 'ENTREGADO', 'RECHAZADO')),
  numero_documento_sii  VARCHAR(20),                                        -- boleta / factura (T30)
  CONSTRAINT ux_orden_canal_codigo UNIQUE (canal_origen, codigo_externo)    -- evita rebajar stock dos veces
);
CREATE INDEX ix_orden_lote          ON orden_venta (id_lote);
CREATE INDEX ix_orden_fecha         ON orden_venta (fecha_orden);
CREATE INDEX ix_orden_estado_fecha  ON orden_venta (estado_orden, fecha_orden DESC);
CREATE INDEX ix_orden_pendientes    ON orden_venta (fecha_orden)
       WHERE estado_orden IN ('PENDIENTE_PREPARACION', 'ARMADO', 'ETIQUETADO');   -- lista de picking (HU05)

-- Flujo de estados de la orden: bodega (4 estados, reversibles) -> ruta -> cierre
CREATE OR REPLACE FUNCTION fn_orden_transicion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bodega TEXT[] := ARRAY['PENDIENTE_PREPARACION', 'ARMADO', 'ETIQUETADO', 'EN_CAMION'];
BEGIN
  IF NEW.estado_orden = OLD.estado_orden THEN RETURN NEW; END IF;
  IF (OLD.estado_orden = ANY (bodega) AND NEW.estado_orden = ANY (bodega))
     OR (OLD.estado_orden = 'EN_CAMION' AND NEW.estado_orden = 'EN_RUTA')
     OR (OLD.estado_orden = 'EN_RUTA'   AND NEW.estado_orden IN ('ENTREGADO', 'RECHAZADO')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Transición de estado no permitida: % -> %', OLD.estado_orden, NEW.estado_orden
        USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER trg_orden_transicion
  BEFORE UPDATE OF estado_orden ON orden_venta
  FOR EACH ROW EXECUTE FUNCTION fn_orden_transicion();

CREATE TABLE detalle_venta (
  id_detalle_vta   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_orden         INTEGER       NOT NULL REFERENCES orden_venta (id_orden)
                   ON UPDATE RESTRICT ON DELETE CASCADE,                    -- composición
  sku              VARCHAR(30)   NOT NULL REFERENCES producto (sku)
                   ON UPDATE RESTRICT ON DELETE RESTRICT,
  cantidad_vendida INTEGER       NOT NULL CHECK (cantidad_vendida > 0),
  precio_unitario  NUMERIC(12,2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal         NUMERIC(14,2) GENERATED ALWAYS AS (cantidad_vendida * precio_unitario) STORED,
  CONSTRAINT ux_detventa_orden_sku UNIQUE (id_orden, sku)
);
CREATE INDEX ix_detventa_sku ON detalle_venta (sku);                        -- reportes de rotación (HU10)

CREATE TABLE despacho (
  id_despacho        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_orden           INTEGER      NOT NULL UNIQUE                           -- orden 1 : 0..1 despacho
                     REFERENCES orden_venta (id_orden) ON UPDATE RESTRICT ON DELETE RESTRICT,
  id_usuario_chofer  INTEGER      NOT NULL REFERENCES usuario (id_usuario)
                     ON UPDATE RESTRICT ON DELETE RESTRICT,
  fecha_asignacion   DATE         NOT NULL DEFAULT CURRENT_DATE,
  estado_entrega     VARCHAR(10)  NOT NULL DEFAULT 'PENDIENTE'
                     CHECK (estado_entrega IN ('PENDIENTE', 'ENTREGADO', 'RECHAZADO')),
  motivo_rechazo     VARCHAR(300),
  fecha_cierre       TIMESTAMPTZ,
  url_evidencia_s3   TEXT,                                                  -- foto de rechazo / firma en S3
  CONSTRAINT ck_rechazo_con_causal
        CHECK (estado_entrega <> 'RECHAZADO' OR length(btrim(coalesce(motivo_rechazo, ''))) > 0),
  CONSTRAINT ck_cierre_coherente
        CHECK ((estado_entrega = 'PENDIENTE') = (fecha_cierre IS NULL))
);
CREATE INDEX ix_despacho_chofer_estado ON despacho (id_usuario_chofer, estado_entrega);

-- Regla: solo un usuario activo con rol CHOFER puede ser asignado a un despacho
CREATE OR REPLACE FUNCTION fn_despacho_solo_chofer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
                  WHERE u.id_usuario = NEW.id_usuario_chofer AND u.activo AND r.nombre_rol = 'CHOFER') THEN
    RAISE EXCEPTION 'El usuario % no es un chofer activo', NEW.id_usuario_chofer
          USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_despacho_solo_chofer
  BEFORE INSERT OR UPDATE OF id_usuario_chofer ON despacho
  FOR EACH ROW EXECUTE FUNCTION fn_despacho_solo_chofer();

-- =====================================================================
-- MÓDULO AUDITORÍA (AuditLog inmutable, Tríada CIA)
-- =====================================================================
CREATE TABLE audit_log (
  id_log              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_usuario          INTEGER     REFERENCES usuario (id_usuario)
                      ON UPDATE RESTRICT ON DELETE RESTRICT,               -- NULL solo en intentos de login fallido
  tabla_afectada      VARCHAR(40) NOT NULL,
  accion              VARCHAR(30) NOT NULL,                                -- IMPORTACIÓN, RECEPCIÓN, ENTREGA, ...
  valores_anteriores  JSONB,
  valores_nuevos      JSONB,
  ip_origen           INET        NOT NULL,
  geolocalizacion     VARCHAR(40)                                              -- 'latitud,longitud' del dispositivo (PI-04); opcional
                      CHECK (geolocalizacion ~ '^-?[0-9]{1,2}\.[0-9]{1,6},-?[0-9]{1,3}\.[0-9]{1,6}$'),
  fecha_hora          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_fecha          ON audit_log (fecha_hora DESC);   -- bitácora cronológica y exportes por rango
CREATE INDEX ix_audit_usuario_fecha  ON audit_log (id_usuario, fecha_hora DESC);
CREATE INDEX ix_audit_tabla_accion   ON audit_log (tabla_afectada, accion);

CREATE OR REPLACE FUNCTION fn_audit_log_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log es inmutable: operación % no permitida', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER trg_audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log_inmutable();
CREATE TRIGGER trg_audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION fn_audit_log_inmutable();

-- =====================================================================
-- Índices de búsqueda sobre el catálogo (HU06: búsqueda predictiva < 2 s)
-- =====================================================================
CREATE INDEX ix_producto_sku_prefijo   ON producto (sku varchar_pattern_ops);   -- LIKE 'TH-%'
CREATE INDEX ix_producto_modelo_trgm   ON producto USING gin (modelo gin_trgm_ops);
CREATE INDEX ix_producto_nombre_trgm   ON producto USING gin (nombre gin_trgm_ops);

-- =====================================================================
-- Vista de apoyo a HU09 (alertas de stock crítico) y KPI "Stock crítico" del dashboard
-- =====================================================================
CREATE VIEW v_stock_critico AS
SELECT p.sku, p.nombre, p.marca, i.stock_fisico, p.stock_minimo, i.ubicacion_bodega
  FROM producto p
  JOIN inventario i ON i.sku = p.sku
 WHERE p.estado = 'ACTIVO' AND i.stock_fisico <= p.stock_minimo;
