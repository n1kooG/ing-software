-- =====================================================================
-- SGI Tienda Oregón - Datos de ejemplo (tomados de las pantallas y casos de prueba del informe)
-- Reproduce: catálogo (TH-4500, UT-FORNO), factura N° 54691 de Gama Chile S.A. (PI-01),
--            carga de lote de ventas (PI-02), asignación a chofer (PI-03).
-- =====================================================================

-- Roles y permisos (JSONB). Formato "modulo:accion", igual que validarToken(jwt, "pedidos:importar")
INSERT INTO rol (nombre_rol, descripcion, permisos) VALUES
 ('ADMINISTRADOR', 'Jefatura Administrativa y Comercial: acceso total, incluye costos y márgenes',
  '["catalogo:leer","catalogo:escribir","costos:leer","precios:leer","precios:escribir",
    "compras:recepcionar","pedidos:importar","pedidos:leer","pedidos:asignar_chofer",
    "inventario:leer","alertas:leer","reportes:leer","auditoria:leer","usuarios:administrar"]'),
 ('BODEGA', 'Operario de bodega: consulta de stock, preparación de pedidos y descarga de camión; sin costos ni márgenes',
  '["inventario:consultar","pedidos:preparar","compras:confirmar_descarga"]'),
 ('CHOFER', 'Chofer de reparto: hoja de ruta y cierre de entregas; sin costos ni márgenes',
  '["ruta:leer","entregas:registrar"]');

-- Usuarios (clave de demostración con bcrypt cost 12; nunca se almacena en texto plano)
INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol) VALUES
 ('11.111.111-1', 'Jefatura Administrativa', 'admin@tiendaoregon.cl',
   crypt('Demo-Oregon-2026', gen_salt('bf', 12)), (SELECT id_rol FROM rol WHERE nombre_rol = 'ADMINISTRADOR')),
 ('22.222.222-2', 'Juan Bodeguero',          'bodega@tiendaoregon.cl',
   crypt('Demo-Oregon-2026', gen_salt('bf', 12)), (SELECT id_rol FROM rol WHERE nombre_rol = 'BODEGA')),
 ('33.333.333-3', 'Carlos Chofer',           'chofer@tiendaoregon.cl',
   crypt('Demo-Oregon-2026', gen_salt('bf', 12)), (SELECT id_rol FROM rol WHERE nombre_rol = 'CHOFER'));

-- Catálogo maestro
INSERT INTO producto (sku, modelo, nombre, marca, costo_adquisicion_neto, stock_minimo) VALUES
 ('TH-4500',      'TH-4500',          'Hervidor Eléctrico 1.7L',          'Thomas',       14990, 5),
 ('UT-FORNO',     'FORNO 40',         'Horno Eléctrico 40L',              'Ursus Trotter', 45990, 5),
 ('GM-ELEGANCE',  'ELEGANCE ST KERA', 'Alisador Elegance ST Kera',        'GAMA',         19406, 0),
 ('GM-KERATION',  'KERATION DIGITAL', 'Alisador Keration Digital',        'GAMA',         26465, 0),
 ('GM-COCONUT',   'COCONUT ST',       'Secador Gama Coconut ST',          'GAMA',         15876, 0),
 ('GM-INNOVA',    'INNOVA DIGITAL',   'Cepillo Innova Digital',           'GAMA',         14700, 0),
 ('GM-566-29',    '566 29 ACC',       'Cortapelo Gama 566 29 ACC',        'GAMA',         20582, 0),
 ('GM-GCXMASTER', 'GCXMASTER',        'Cortapelo Gama GCXMaster',         'GAMA',         17641, 0);

INSERT INTO inventario (sku, stock_fisico, ubicacion_bodega) VALUES
 ('TH-4500', 24, 'Pasillo A - Estante 2'),
 ('UT-FORNO', 4, 'Pasillo B - Estante 1'),
 ('GM-ELEGANCE', 0, NULL), ('GM-KERATION', 0, NULL), ('GM-COCONUT', 0, NULL),
 ('GM-INNOVA', 0, NULL),   ('GM-566-29', 0, NULL),   ('GM-GCXMASTER', 0, NULL);

-- Precios por canal (el margen lo calcula el trigger)
INSERT INTO lista_precio (sku, canal_venta, precio_venta_neto) VALUES
 ('TH-4500',  'WEB',       22990), ('TH-4500',  'MAYORISTA', 18500),
 ('UT-FORNO', 'WEB',       69990), ('UT-FORNO', 'MAYORISTA', 56900);

-- ---------------------------------------------------------------------
-- HU03 / PI-01: recepción de la factura N° 54691 en UNA transacción ACID
-- ---------------------------------------------------------------------
BEGIN;
  INSERT INTO recepcion_compra (id_usuario, numero_factura, rut_proveedor, nombre_proveedor, fecha_emision,
                                forma_pago, url_pdf_factura, monto_neto, monto_iva, monto_total)
  VALUES ((SELECT id_usuario FROM usuario WHERE email = 'admin@tiendaoregon.cl'),
          '54691', '78.806.090-4', 'GAMA CHILE S.A.', DATE '2026-09-22', 'Contado',
          'facturas/78806090-4_54691.pdf', 165828, 31507, 197335);

  INSERT INTO detalle_recepcion (id_recepcion, sku, cantidad_recibida, precio_unitario_neto)
  SELECT (SELECT id_recepcion FROM recepcion_compra WHERE numero_factura = '54691'), v.sku, v.cant, v.precio
    FROM (VALUES ('GM-ELEGANCE', 1, 19406), ('GM-KERATION', 1, 26465), ('GM-COCONUT', 2, 15876),
                 ('GM-INNOVA', 2, 14700),   ('GM-566-29', 2, 20582),   ('GM-GCXMASTER', 1, 17641)) AS v(sku, cant, precio);

  UPDATE inventario i
     SET stock_fisico = i.stock_fisico + d.cantidad_recibida                -- incrementarFisico()
    FROM detalle_recepcion d
   WHERE d.id_recepcion = (SELECT id_recepcion FROM recepcion_compra WHERE numero_factura = '54691')
     AND i.sku = d.sku;

  INSERT INTO audit_log (id_usuario, tabla_afectada, accion, valores_nuevos, ip_origen)
  VALUES ((SELECT id_usuario FROM usuario WHERE email = 'admin@tiendaoregon.cl'),
          'recepcion_compra', 'RECEPCIÓN',
          '{"numero_factura":"54691","proveedor":"GAMA CHILE S.A.","unidades":9,"monto_total":197335}', '192.168.1.15');
COMMIT;

-- ---------------------------------------------------------------------
-- HU04 / PI-02: importación de lote de ventas en UNA transacción (rebaja atómica de stock)
-- ---------------------------------------------------------------------
BEGIN;
  INSERT INTO lote_importacion (id_usuario, nombre_archivo, url_archivo_s3, total_ordenes, total_lineas)
  VALUES ((SELECT id_usuario FROM usuario WHERE email = 'admin@tiendaoregon.cl'),
          'ventas_lote_201.xlsx', 'lotes/201/ventas_lote_201.xlsx', 2, 2);

  INSERT INTO orden_venta (id_lote, codigo_externo, canal_origen, nombre_cliente, direccion_despacho, comuna, telefono_contacto)
  VALUES (currval(pg_get_serial_sequence('lote_importacion', 'id_lote')), 'ORD-1024', 'Mayorista',
          'Distribuidora Oriente SpA', 'Av. Providencia 1251', 'Providencia', '+56 9 8765 4321'),
         (currval(pg_get_serial_sequence('lote_importacion', 'id_lote')), 'ORD-1025', 'Mercado Libre',
          'Juan Pérez', 'Av. Apoquindo 4400', 'Las Condes', '+56 9 1234 5678');

  INSERT INTO detalle_venta (id_orden, sku, cantidad_vendida, precio_unitario)
  SELECT o.id_orden, v.sku, v.cant, v.precio
    FROM (VALUES ('ORD-1024', 'TH-4500', 4, 18500), ('ORD-1025', 'UT-FORNO', 1, 69990)) AS v(cod, sku, cant, precio)
    JOIN orden_venta o ON o.codigo_externo = v.cod;

  -- rebajarDefinitivo(): descuento condicionado; si no alcanza el stock no se actualiza ninguna fila
  UPDATE inventario i
     SET stock_fisico = i.stock_fisico - t.total
    FROM (SELECT sku, sum(cantidad_vendida) AS total FROM detalle_venta GROUP BY sku) t
   WHERE i.sku = t.sku AND i.stock_fisico >= t.total;

  INSERT INTO audit_log (id_usuario, tabla_afectada, accion, valores_nuevos, ip_origen)
  VALUES ((SELECT id_usuario FROM usuario WHERE email = 'admin@tiendaoregon.cl'),
          'orden_venta', 'IMPORTACIÓN',
          '{"id_lote":1,"archivo":"ventas_lote_201.xlsx","ordenes":2,"lineas":2}', '192.168.1.15');
COMMIT;

-- ---------------------------------------------------------------------
-- HU05 / HU07 / PI-03: picking en bodega, asignación de chofer y salida a ruta
-- ---------------------------------------------------------------------
UPDATE orden_venta SET estado_orden = 'ARMADO'     WHERE codigo_externo IN ('ORD-1024', 'ORD-1025');
UPDATE orden_venta SET estado_orden = 'ETIQUETADO' WHERE codigo_externo IN ('ORD-1024', 'ORD-1025');
UPDATE orden_venta SET estado_orden = 'EN_CAMION'  WHERE codigo_externo IN ('ORD-1024', 'ORD-1025');

INSERT INTO despacho (id_orden, id_usuario_chofer)
SELECT o.id_orden, (SELECT id_usuario FROM usuario WHERE email = 'chofer@tiendaoregon.cl')
  FROM orden_venta o WHERE o.codigo_externo IN ('ORD-1024', 'ORD-1025');

UPDATE orden_venta SET estado_orden = 'EN_RUTA' WHERE codigo_externo IN ('ORD-1024', 'ORD-1025');
