-- =====================================================================
-- SGI Tienda Oregón - Pruebas de integridad del modelo de datos
-- Cada prueba intenta violar una regla y verifica el código SQLSTATE devuelto por PostgreSQL.
-- =====================================================================
CREATE TEMP TABLE resultado (id TEXT, prueba TEXT, esperado TEXT, obtenido TEXT, ok BOOLEAN);

CREATE FUNCTION pg_temp.espera_error(p_id TEXT, p_prueba TEXT, p_sqlstate TEXT, p_sql TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_state TEXT := 'sin error';
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  INSERT INTO resultado VALUES (p_id, p_prueba, p_sqlstate, v_state, v_state = p_sqlstate);
END $$;

CREATE FUNCTION pg_temp.espera_valor(p_id TEXT, p_prueba TEXT, p_esperado TEXT, p_sql TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  EXECUTE p_sql INTO v;
  INSERT INTO resultado VALUES (p_id, p_prueba, p_esperado, v, v = p_esperado);
END $$;

\o /dev/null
-- ---- Integridad de entidad y de dominio ------------------------------------------------------
SELECT pg_temp.espera_error('IN-01', 'HU01: SKU duplicado es rechazado', '23505',
  $q$INSERT INTO producto (sku, modelo, nombre, marca, costo_adquisicion_neto) VALUES ('TH-4500','X','Duplicado','Thomas',1000)$q$);
SELECT pg_temp.espera_error('IN-02', 'HU01: SKU en minúsculas no normalizado es rechazado', '23514',
  $q$INSERT INTO producto (sku, modelo, nombre, marca, costo_adquisicion_neto) VALUES ('th-9999','X','Minuscula','Thomas',1000)$q$);
SELECT pg_temp.espera_error('IN-03', 'CU-03: el SKU es inmutable', '23000',
  $q$UPDATE producto SET sku = 'TH-4501' WHERE sku = 'TH-4500'$q$);
SELECT pg_temp.espera_error('IN-04', 'RUT inválido (módulo 11) es rechazado', '23514',
  $q$INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol) VALUES ('11.111.111-9','X','x@x.cl','h',1)$q$);
SELECT pg_temp.espera_error('IN-05', 'Correo duplicado (sin distinguir mayúsculas) es rechazado', '23505',
  $q$INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol) VALUES ('12.345.678-5','X','ADMIN@tiendaoregon.cl','h',1)$q$);
SELECT pg_temp.espera_error('IN-06', 'Rol.permisos debe ser un arreglo JSON', '23514',
  $q$INSERT INTO rol (nombre_rol, descripcion, permisos) VALUES ('PRUEBA','x','{"a":1}')$q$);

-- ---- Integridad referencial -----------------------------------------------------------------
SELECT pg_temp.espera_error('IR-01', 'DetalleVenta con SKU inexistente es rechazado', '23503',
  $q$INSERT INTO detalle_venta (id_orden, sku, cantidad_vendida, precio_unitario) VALUES ((SELECT min(id_orden) FROM orden_venta),'NO-EXISTE',1,100)$q$);
SELECT pg_temp.espera_error('IR-02', 'No se puede borrar un producto con movimientos', '23503',
  $q$DELETE FROM producto WHERE sku = 'TH-4500'$q$);
SELECT pg_temp.espera_error('IR-03', 'No se puede borrar un usuario con historial', '23503',
  $q$DELETE FROM usuario WHERE email = 'admin@tiendaoregon.cl'$q$);

-- ---- Reglas de inventario (PU-04, PU-05) ----------------------------------------------------
SELECT pg_temp.espera_error('INV-01', 'PU-05: stock físico negativo es rechazado (3 un. - 5 un.)', '23514',
  $q$UPDATE inventario SET stock_fisico = stock_fisico - 5 WHERE sku = 'UT-FORNO'$q$);
SELECT pg_temp.espera_valor('INV-02', 'PU-05: rebaja condicionada no modifica filas si no alcanza el stock', '0',
  $q$WITH r AS (UPDATE inventario SET stock_fisico = stock_fisico - 5 WHERE sku = 'UT-FORNO' AND stock_fisico >= 5 RETURNING 1) SELECT count(*)::text FROM r$q$);
SELECT pg_temp.espera_valor('INV-03', 'PU-04: stock TH-4500 tras vender 4 de 24 unidades', '20',
  $q$SELECT stock_fisico::text FROM inventario WHERE sku = 'TH-4500'$q$);
SELECT pg_temp.espera_valor('INV-04', 'PI-01: stock GM-COCONUT tras recibir 2 unidades de la factura 54691', '2',
  $q$SELECT stock_fisico::text FROM inventario WHERE sku = 'GM-COCONUT'$q$);
SELECT pg_temp.espera_valor('INV-05', 'PI-01: unidades físicas recibidas en el sistema = 9', '9',
  $q$SELECT sum(stock_fisico)::text FROM inventario WHERE sku LIKE 'GM-%'$q$);
SELECT pg_temp.espera_valor('INV-06', 'HU09: UT-FORNO figura en stock crítico (3 un. <= mínimo 5)', '1',
  $q$SELECT count(*)::text FROM v_stock_critico WHERE sku = 'UT-FORNO'$q$);

-- ---- Cálculos financieros (PU-01, PU-02, PU-03) ---------------------------------------------
SELECT pg_temp.espera_valor('FIN-01', 'PU-02: margen TH-4500 canal WEB = 34.80 %', '34.80',
  $q$SELECT margen_porcentual::text FROM lista_precio WHERE sku='TH-4500' AND canal_venta='WEB'$q$);
SELECT pg_temp.espera_valor('FIN-02', 'PU-03: margen TH-4500 canal MAYORISTA = 18.97 %', '18.97',
  $q$SELECT margen_porcentual::text FROM lista_precio WHERE sku='TH-4500' AND canal_venta='MAYORISTA'$q$);
SELECT pg_temp.espera_error('FIN-03', 'PU-03: precio de venta menor o igual al costo es rechazado', '23514',
  $q$UPDATE lista_precio SET precio_venta_neto = 14990 WHERE sku='TH-4500' AND canal_venta='MAYORISTA'$q$);
SELECT pg_temp.espera_valor('FIN-04', 'PU-01: neto de la factura 54691 = suma del detalle', '165828.00',
  $q$SELECT sum(cantidad_recibida * precio_unitario_neto)::text FROM detalle_recepcion$q$);
SELECT pg_temp.espera_valor('FIN-05', 'PU-01: IVA 19 % redondeado = 31.507', '31507',
  $q$SELECT round(monto_neto * 0.19, 0)::text FROM recepcion_compra WHERE numero_factura='54691'$q$);
SELECT pg_temp.espera_valor('FIN-06', 'PU-01: total facturado = 197.335', '197335.00',
  $q$SELECT monto_total::text FROM recepcion_compra WHERE numero_factura='54691'$q$);
SELECT pg_temp.espera_error('FIN-07', 'Total de factura distinto de neto + IVA es rechazado', '23514',
  $q$INSERT INTO recepcion_compra (id_usuario,numero_factura,rut_proveedor,nombre_proveedor,fecha_emision,forma_pago,monto_neto,monto_iva,monto_total)
     VALUES (1,'99999','78.806.090-4','GAMA CHILE S.A.',CURRENT_DATE,'Contado',1000,190,1000)$q$);
SELECT pg_temp.espera_error('FIN-08', 'HU03: la misma factura del mismo proveedor no se registra dos veces', '23505',
  $q$INSERT INTO recepcion_compra (id_usuario,numero_factura,rut_proveedor,nombre_proveedor,fecha_emision,forma_pago,monto_neto,monto_iva,monto_total)
     VALUES (1,'54691','78.806.090-4','GAMA CHILE S.A.',CURRENT_DATE,'Contado',1000,190,1190)$q$);
UPDATE producto SET costo_adquisicion_neto = 16000 WHERE sku = 'TH-4500';      -- cambio de costo por Administración
SELECT pg_temp.espera_valor('FIN-09', 'T11: cambiar el costo (14.990 -> 16.000) recalcula el margen WEB', '30.40',
  $q$SELECT margen_porcentual::text FROM lista_precio WHERE sku='TH-4500' AND canal_venta='WEB'$q$);
UPDATE producto SET costo_adquisicion_neto = 14990 WHERE sku = 'TH-4500';

-- ---- Ventas, despacho y trazabilidad --------------------------------------------------------
SELECT pg_temp.espera_error('VD-01', 'HU04: importar dos veces la misma orden del mismo canal es rechazado', '23505',
  $q$INSERT INTO orden_venta (id_lote, codigo_externo, canal_origen, nombre_cliente) VALUES (1,'ORD-1024','Mayorista','Repetida')$q$);
SELECT pg_temp.espera_error('VD-02', 'Estado de orden fuera del flujo (EN_RUTA -> ARMADO) es rechazado', '23514',
  $q$UPDATE orden_venta SET estado_orden = 'ARMADO' WHERE codigo_externo = 'ORD-1024'$q$);
SELECT pg_temp.espera_error('VD-03', 'HU07: despacho RECHAZADO sin causal es rechazado', '23514',
  $q$UPDATE despacho SET estado_entrega='RECHAZADO', fecha_cierre=now() WHERE id_orden=(SELECT id_orden FROM orden_venta WHERE codigo_externo='ORD-1025')$q$);
SELECT pg_temp.espera_error('VD-04', 'Solo un usuario con rol CHOFER puede asignarse a un despacho', '23514',
  $q$UPDATE despacho SET id_usuario_chofer=(SELECT id_usuario FROM usuario WHERE email='bodega@tiendaoregon.cl') WHERE id_orden=(SELECT id_orden FROM orden_venta WHERE codigo_externo='ORD-1024')$q$);
SELECT pg_temp.espera_valor('VD-05', 'HU07: cierre de entrega con causal es aceptado', '1',
  $q$WITH u AS (UPDATE despacho SET estado_entrega='RECHAZADO', motivo_rechazo='Cliente ausente en domicilio', fecha_cierre=now()
                WHERE id_orden=(SELECT id_orden FROM orden_venta WHERE codigo_externo='ORD-1025') RETURNING 1) SELECT count(*)::text FROM u$q$);
-- se restaura el estado para dejar los datos de ejemplo intactos
UPDATE despacho SET estado_entrega='PENDIENTE', motivo_rechazo=NULL, fecha_cierre=NULL
 WHERE id_orden=(SELECT id_orden FROM orden_venta WHERE codigo_externo='ORD-1025');

SELECT pg_temp.espera_error('AUD-01', 'AuditLog: UPDATE no permitido', '42501',
  $q$UPDATE audit_log SET accion = 'ALTERADO'$q$);
SELECT pg_temp.espera_error('AUD-02', 'AuditLog: DELETE no permitido', '42501',
  $q$DELETE FROM audit_log$q$);
SELECT pg_temp.espera_error('AUD-03', 'AuditLog: TRUNCATE no permitido', '42501',
  $q$TRUNCATE audit_log$q$);
SELECT pg_temp.espera_error('AUD-04', 'PI-04: geolocalización con formato inválido es rechazada', '23514',
  $q$INSERT INTO audit_log (id_usuario, tabla_afectada, accion, ip_origen, geolocalizacion) VALUES (NULL,'despacho','ENTREGA','10.0.0.5','Providencia')$q$);
DO $$
DECLARE v_estado TEXT := 'insert rechazado';
BEGIN
  BEGIN
    INSERT INTO audit_log (id_usuario, tabla_afectada, accion, ip_origen, geolocalizacion)
    VALUES (NULL, 'despacho', 'ENTREGA', '10.0.0.5', '-33.4263,-70.6155');
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'revertir prueba';    -- el evento de prueba no se conserva
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_estado := 'insert aceptado';
            WHEN OTHERS THEN v_estado := 'error inesperado';
  END;
  INSERT INTO resultado VALUES ('AUD-05', 'PI-04: geolocalización válida (lat,lon) es aceptada', 'insert aceptado', v_estado, v_estado = 'insert aceptado');
END $$;

-- ---- Atomicidad (T16): una venta que no alcanza stock revierte TODA la carga ------------------
DO $$
DECLARE v_ordenes_antes INT; v_ordenes_despues INT; v_estado TEXT := 'sin error';
BEGIN
  SELECT count(*) INTO v_ordenes_antes FROM orden_venta;
  BEGIN
    INSERT INTO orden_venta (id_lote, codigo_externo, canal_origen, nombre_cliente)
    VALUES (1, 'ORD-ROLLBACK', 'Ripley', 'Cliente de prueba');
    INSERT INTO detalle_venta (id_orden, sku, cantidad_vendida, precio_unitario)
    VALUES ((SELECT id_orden FROM orden_venta WHERE codigo_externo='ORD-ROLLBACK'), 'UT-FORNO', 10, 69990);
    UPDATE inventario SET stock_fisico = stock_fisico - 10 WHERE sku = 'UT-FORNO';   -- falla: CHECK >= 0
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
  END;
  SELECT count(*) INTO v_ordenes_despues FROM orden_venta;
  INSERT INTO resultado VALUES ('ACID-01', 'T16: venta sin stock revierte la orden completa (ROLLBACK)',
                                '23514 / órdenes sin cambio', v_estado || ' / ' || (v_ordenes_despues - v_ordenes_antes)::text || ' nuevas',
                                v_estado = '23514' AND v_ordenes_despues = v_ordenes_antes);
END $$;

-- ---- Autenticación (PU-06, PU-07, PU-08) ----------------------------------------------------
SELECT pg_temp.espera_valor('SEG-01', 'PU-06: la clave se guarda con bcrypt cost 12 (prefijo $2a$12$)', '$2a$12$',
  $q$SELECT left(password_hash, 7) FROM usuario WHERE email='admin@tiendaoregon.cl'$q$);
SELECT pg_temp.espera_valor('SEG-02', 'PU-07: clave correcta valida contra el hash', 'true',
  $q$SELECT (password_hash = crypt('Demo-Oregon-2026', password_hash))::text FROM usuario WHERE email='admin@tiendaoregon.cl'$q$);
SELECT pg_temp.espera_error('SEG-04', 'Plan de seguridad: intentos fallidos negativos son rechazados', '23514',
  $q$UPDATE usuario SET intentos_fallidos = -1 WHERE email='admin@tiendaoregon.cl'$q$);
SELECT pg_temp.espera_valor('SEG-03', 'PU-08: clave incorrecta es rechazada', 'false',
  $q$SELECT (password_hash = crypt('clave-falsa', password_hash))::text FROM usuario WHERE email='admin@tiendaoregon.cl'$q$);

\o
\echo
\echo '==================== RESULTADO DE PRUEBAS DE INTEGRIDAD ===================='
SELECT id, prueba, esperado, obtenido, CASE WHEN ok THEN 'OK' ELSE 'FALLA' END AS estado FROM resultado ORDER BY id;
SELECT count(*) AS total, count(*) FILTER (WHERE ok) AS aprobadas, count(*) FILTER (WHERE NOT ok) AS fallidas FROM resultado;
