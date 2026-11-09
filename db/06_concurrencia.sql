-- Prueba de concurrencia: 20 clientes simultáneos intentan vender 1 unidad de un SKU con 50 en stock
CREATE TABLE IF NOT EXISTS venta_test (id BIGSERIAL PRIMARY KEY, modo TEXT, sku TEXT);

-- Modo SEGURO: rebaja condicionada en una sola sentencia (equivale a SELECT ... FOR UPDATE + UPDATE de la secuencia HU04)
CREATE OR REPLACE FUNCTION fn_vender_seguro(p_sku TEXT, p_cant INT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  UPDATE inventario SET stock_fisico = stock_fisico - p_cant WHERE sku = p_sku AND stock_fisico >= p_cant;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN FALSE; END IF;               -- StockInsuficienteException en la capa de aplicación
  INSERT INTO venta_test (modo, sku) VALUES ('seguro', p_sku);
  RETURN TRUE;
END $$;

-- Modo INGENUO: leer, decidir y escribir sin bloqueo (condición de carrera)
CREATE OR REPLACE FUNCTION fn_vender_ingenuo(p_sku TEXT, p_cant INT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v INT;
BEGIN
  SELECT stock_fisico INTO v FROM inventario WHERE sku = p_sku;
  IF v < p_cant THEN RETURN FALSE; END IF;
  PERFORM pg_sleep(0.002);
  UPDATE inventario SET stock_fisico = v - p_cant WHERE sku = p_sku;
  INSERT INTO venta_test (modo, sku) VALUES ('ingenuo', p_sku);
  RETURN TRUE;
END $$;
