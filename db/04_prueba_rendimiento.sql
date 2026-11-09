-- Datos sintéticos SOLO para medir rendimiento (no son datos del cliente)
INSERT INTO rol (nombre_rol, descripcion, permisos) VALUES ('ADMINISTRADOR','a','[]'),('BODEGA','b','[]'),('CHOFER','c','[]');
INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol) VALUES
 ('11.111.111-1','Admin','admin@t.cl','x',1),('22.222.222-2','Bodega','bodega@t.cl','x',2),('33.333.333-3','Chofer','chofer@t.cl','x',3);

INSERT INTO producto (sku, modelo, nombre, marca, costo_adquisicion_neto, stock_minimo)
SELECT 'SKU-' || lpad(n::text, 5, '0'),
       upper(substr(md5(n::text), 1, 8)),
       (ARRAY['Hervidor','Horno','Aspiradora','Batidora','Licuadora','Secador','Plancha','Cafetera'])[1 + n % 8]
         || ' ' || upper(substr(md5((n * 7)::text), 1, 6)),
       (ARRAY['Thomas','Ursus Trotter','GAMA','Blank'])[1 + n % 4], 10000 + (n % 90) * 1000, 5
FROM generate_series(1, 5000) n;
INSERT INTO inventario (sku, stock_fisico, ubicacion_bodega)
SELECT sku, (random() * 60)::int, 'Pasillo ' || chr(65 + (random() * 5)::int) || ' - Estante ' || (1 + (random() * 4)::int) FROM producto;

INSERT INTO lote_importacion (id_usuario, nombre_archivo, url_archivo_s3, total_ordenes, total_lineas)
SELECT 1, 'lote_' || n || '.xlsx', 'lotes/' || n || '/x.xlsx', 100, 250 FROM generate_series(1, 1000) n;

INSERT INTO orden_venta (id_lote, codigo_externo, canal_origen, fecha_orden, nombre_cliente, estado_orden)
SELECT 1 + n % 1000, 'ORD-' || n,
       (ARRAY['Mercado Libre','Paris','Ripley','Mayorista','Venta Directa Web'])[1 + n % 5],
       now() - (random() * interval '365 days'), 'Cliente ' || n,
       CASE WHEN n % 200 = 0 THEN 'PENDIENTE_PREPARACION' WHEN n % 200 = 1 THEN 'ARMADO' ELSE 'ENTREGADO' END
FROM generate_series(1, 100000) n;

INSERT INTO detalle_venta (id_orden, sku, cantidad_vendida, precio_unitario)
SELECT o.id_orden, 'SKU-' || lpad((1 + (o.id_orden * k) % 5000)::text, 5, '0'), 1 + o.id_orden % 4, 20000
FROM orden_venta o, generate_series(1, 3) k
ON CONFLICT DO NOTHING;

INSERT INTO audit_log (id_usuario, tabla_afectada, accion, valores_nuevos, ip_origen, fecha_hora)
SELECT 1 + n % 3, (ARRAY['orden_venta','recepcion_compra','despacho','inventario'])[1 + n % 4],
       (ARRAY['IMPORTACIÓN','RECEPCIÓN','ENTREGA','PICKING'])[1 + n % 4],
       jsonb_build_object('n', n), '192.168.1.15', now() - (n * interval '2 minutes')
FROM generate_series(1, 300000) n;

ANALYZE;
SELECT 'productos' t, count(*) FROM producto UNION ALL SELECT 'ordenes', count(*) FROM orden_venta
UNION ALL SELECT 'detalle_venta', count(*) FROM detalle_venta UNION ALL SELECT 'audit_log', count(*) FROM audit_log;
