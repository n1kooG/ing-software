\pset pager off
\echo '--- Q1 HU06: búsqueda exacta por SKU'
EXPLAIN (ANALYZE, BUFFERS OFF, TIMING ON, COSTS OFF, SUMMARY ON)
SELECT p.sku, p.modelo, p.nombre, p.marca, i.stock_fisico, i.ubicacion_bodega
  FROM producto p JOIN inventario i ON i.sku = p.sku WHERE p.sku = 'SKU-02500';

\echo '--- Q2 HU06: predictiva por prefijo de SKU'
EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, SUMMARY ON)
SELECT p.sku, p.nombre, i.stock_fisico FROM producto p JOIN inventario i ON i.sku = p.sku
 WHERE p.sku LIKE 'SKU-025%' ORDER BY p.sku LIMIT 10;

\echo '--- Q3 HU06: predictiva por fragmento de modelo/nombre (con índices trigram)'
EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, SUMMARY ON)
SELECT p.sku, p.modelo, p.nombre, i.stock_fisico, i.ubicacion_bodega
  FROM producto p JOIN inventario i ON i.sku = p.sku
 WHERE p.sku LIKE upper('c4c')||'%' OR p.modelo ILIKE '%c4c%' OR p.nombre ILIKE '%c4c%' LIMIT 20;

\echo '--- Q3b mismo query SIN índices (referencia)'
SET enable_indexscan = off; SET enable_bitmapscan = off; SET enable_indexonlyscan = off;
EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, SUMMARY ON)
SELECT p.sku, p.modelo, p.nombre, i.stock_fisico, i.ubicacion_bodega
  FROM producto p JOIN inventario i ON i.sku = p.sku
 WHERE p.sku LIKE upper('c4c')||'%' OR p.modelo ILIKE '%c4c%' OR p.nombre ILIKE '%c4c%' LIMIT 20;
RESET enable_indexscan; RESET enable_bitmapscan; RESET enable_indexonlyscan;

\echo '--- Q4 HU05: pedidos pendientes de preparar (índice parcial)'
EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, SUMMARY ON)
SELECT id_orden, codigo_externo, canal_origen, fecha_orden, estado_orden FROM orden_venta
 WHERE estado_orden IN ('PENDIENTE_PREPARACION','ARMADO','ETIQUETADO') ORDER BY fecha_orden;

\echo '--- Q5 HU10: unidades vendidas por SKU en el mes (rotación)'
EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, SUMMARY ON)
SELECT d.sku, sum(d.cantidad_vendida) AS unidades
  FROM detalle_venta d JOIN orden_venta o ON o.id_orden = d.id_orden
 WHERE o.fecha_orden >= now() - interval '30 days' GROUP BY d.sku ORDER BY unidades DESC LIMIT 10;

\echo '--- Q6 AuditLog: últimos 50 eventos'
EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, SUMMARY ON)
SELECT id_log, fecha_hora, id_usuario, accion FROM audit_log ORDER BY fecha_hora DESC LIMIT 50;

\echo '--- Q7 AuditLog: exportación por rango de fechas'
EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, SUMMARY ON)
SELECT count(*) FROM audit_log WHERE fecha_hora >= now() - interval '2 days';
