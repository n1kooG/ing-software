# SGI Tienda Oregón

Avance del Proyecto Integrado (INACAP). Stack del informe: React (PWA) + Node.js/Express + PostgreSQL + Redis.

## Requisitos (Mac)
- Node 20 o superior (`node -v`)
- PostgreSQL 16 y Redis locales: `brew install postgresql@16 redis`
- Sin Docker. En producción: Amazon RDS (PostgreSQL) + EC2 + S3.

## Puesta en marcha

```bash
# 1) Servicios locales
brew services start postgresql@16
brew services start redis

# 2) Base de datos (la primera vez; db/02 es solo para desarrollo)
createdb sgi_oregon
psql sgi_oregon -f db/01_modelo_datos.sql
psql sgi_oregon -f db/02_datos_ejemplo.sql

# 3) Backend  → http://localhost:3000
cd backend
cp .env.example .env        # edita JWT_SECRET y DATABASE_URL (con brew, el usuario de la BD es el de tu Mac, sin clave)
npm install
npm run dev
npm test                    # necesita la BD arriba

# 4) Frontend → http://localhost:5173
cd frontend
npm install
npm run dev
```

Usuarios de ejemplo (clave `Demo-Oregon-2026`): `admin@tiendaoregon.cl`, `bodega@tiendaoregon.cl`, `chofer@tiendaoregon.cl`.
El login pide solo correo y contraseña: el rol sale de la base de datos y define la pantalla de destino.

**Reiniciar la BD desde cero:** `dropdb sgi_oregon && createdb sgi_oregon` y repetir el paso 2.
Redis es opcional: sin él, el dashboard funciona sin caché (cabecera `X-Cache: OFF`).
Pruebas de integridad de la BD: `psql sgi_oregon -f db/03_pruebas_integridad.sql` (deben aprobar las 39).

## Estructura
```
db/          modelo relacional (12 tablas, triggers, vista de stock crítico), datos de ejemplo y pruebas de integridad
backend/     API REST (Express, ESM), capas routes → services → repositories
  src/routes/   auth, usuarios, productos, inventario, compras, pedidos, despachos, dashboard, auditoria, health
  tests/        pruebas con node --test (82)
frontend/    React + Vite, PWA (manifest + service worker que no cachea /api)
documentacion/  informe, documento de desarrollo, decisiones y capturas del diseño
```

## Resumen del avance

Proyecto: SGI Tienda Oregón (Comercial Oregon SpA). Estado al 8-nov-2026.

| Sprint | Alcance | Backend | Frontend |
|---|---|---|---|
| 1 | Seguridad, usuarios, catálogo y precios (HU01, HU02) | Hecho | Hecho |
| 2 | Recepción de compras, confirmación de descarga e importación de pedidos desde Excel (HU03, HU04) | Hecho | Hecho |
| 3 | Pedidos de Bodega, búsqueda predictiva y despacho con entrega del chofer (HU05, HU06, HU07) | Hecho | Pendiente |
| 4 | Alertas de stock, dashboard con KPI, reportes y bitácora exportable (HU09, HU10) | Pendiente | Pendiente |

**Seguridad y base**
- Login solo con correo y contraseña (bcrypt con pgcrypto); el rol sale de la base de datos en cada petición. Tres roles: Administrador, Bodega y Chofer.
- Bloqueo de 15 minutos tras 5 intentos fallidos y expiración de sesión por inactividad.
- Permisos por "módulo:acción" con denegación por defecto; cada acceso denegado queda en la bitácora inmutable.
- Costos y márgenes solo los ve quien tiene el permiso `costos:leer`.
- Módulo de archivos (S3) desactivable en desarrollo y `/api/health`.

**Catálogo y usuarios (Sprint 1)**
- Alta de usuarios, cambio de rol, baja y reactivación, sin poder dejar el sistema sin administradores.
- Catálogo con SKU único e inmutable, búsqueda, paginación y precios por canal (el margen lo calcula la base de datos).

**Compras y pedidos (Sprint 2)**
- Recepción de compras con neto, IVA y total, PDF de la factura y aumento de stock en una sola transacción.
- Confirmación de descarga del camión por Bodega (conforme o con discrepancia).
- Importación de pedidos desde Excel con validación de todas las filas antes de escribir, rebaja de stock atómica y rechazo de reimportaciones.

**Bodega y despacho (Sprint 3, solo backend)**
- Búsqueda de stock por SKU o modelo.
- Pedidos pendientes por canal, cambio de estado reversible, checklist, discrepancias y etiqueta en PDF.
- Asignación de chofer por el administrador, hoja de ruta, entrega o rechazo con causal, foto y geolocalización.

**Verificación:** 82 pruebas del backend aprobadas, 39 de 39 pruebas de integridad de la base de datos y build del frontend sin errores. Las pantallas se probaron contra el backend real, pero sin revisión visual completa.

**Decisiones y desviaciones respecto del documento:** `documentacion/DECISIONES.md`.

## Qué falta
- Pantallas del Sprint 3: pedidos de Bodega, búsqueda, asignación de chofer y ruta del chofer.
- Sprint 4: alertas de stock crítico, dashboard con indicadores y gráficos, reportes y exportación de la bitácora.
- Pruebas finales de integración y rendimiento, y despliegue en AWS (EC2, RDS y S3).

## Riesgos conocidos (antes de producción)
- El token JWT está en `sessionStorage`; se debe evaluar cookie httpOnly + CSRF.
- No hay límite de peticiones por IP en el login (solo el bloqueo por cuenta, que además permite bloquear a un usuario a propósito).
- `helmet` está con valores por defecto; falta ajustar CSP cuando el front se sirva desde otro origen.
- El `.env` de ejemplo usa claves de desarrollo. No reutilizar.
