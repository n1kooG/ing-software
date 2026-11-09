# SGI Tienda Oregón

Avance del Proyecto Integrado (INACAP). Stack: React (PWA) + Node.js/Express + PostgreSQL + Redis.
Esta guía es para **Windows 10/11** y usa PowerShell. No usa Docker.

## 1. Instalar lo necesario (una sola vez)

1. **Node.js 22 LTS** (o superior): https://nodejs.org (instalador "LTS", dejar las opciones por defecto).
2. **PostgreSQL 16**: https://www.postgresql.org/download/windows/ (instalador de EDB).
   - Durante la instalación te pide una contraseña para el usuario `postgres`: anótala, la necesitas abajo.
   - Deja el puerto 5432 y desmarca Stack Builder al final.
3. **Git** (si aún no lo tienes): https://git-scm.com/download/win

Redis no es obligatorio: sin él todo funciona, solo que el dashboard no usa caché.

Abre **PowerShell** (menú Inicio → "PowerShell") y agrega las herramientas de PostgreSQL al PATH de esta sesión:

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\16\bin"
$env:PGCLIENTENCODING = "UTF8"
node -v     # debe mostrar v22 o superior
psql -V     # debe mostrar psql (PostgreSQL) 16.x
```

Estas dos líneas valen solo para la ventana abierta: repítelas cada vez que abras una PowerShell nueva (o agrega la carpeta al PATH de Windows desde "Variables de entorno").

## 2. Base de datos

Desde la carpeta del proyecto, en PowerShell (te pedirá la contraseña de `postgres` en cada comando):

```powershell
createdb -U postgres sgi_oregon
psql -U postgres -d sgi_oregon -f db/01_modelo_datos.sql
psql -U postgres -d sgi_oregon -f db/02_datos_ejemplo.sql     # datos de ejemplo, solo para desarrollo
```

## 3. Backend (http://localhost:3000)

```powershell
cd backend
copy .env.example .env
notepad .env
```

En el Bloc de notas que se abre, cambia estas dos líneas y guarda:

- `DATABASE_URL=postgres://postgres:TU_CLAVE@localhost:5432/sgi_oregon` (tu contraseña de `postgres` en lugar de `TU_CLAVE`; si tiene símbolos como `@` o `#`, escríbelos codificados, por ejemplo `%40` y `%23`).
- `JWT_SECRET=` un texto largo y aleatorio. Para generarlo: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` y pega el resultado.
- Si no instalaste Redis, pon un `#` delante de la línea `REDIS_URL=...`.

Luego:

```powershell
npm install
npm run dev
```

Prueba que responde: abre http://localhost:3000/api/health (debe mostrar `"bd":"ok"`).
Para correr las pruebas automáticas (con la base de datos creada): `npm test` en la carpeta `backend`.

## 4. Frontend (http://localhost:5173)

En otra ventana de PowerShell:

```powershell
cd frontend
npm install
npm run dev
```

Abre http://localhost:5173 en el navegador.

## 5. Usuarios de ejemplo

Clave de los tres: `Demo-Oregon-2026`

| Correo | Rol | Qué ve |
|---|---|---|
| `admin@tiendaoregon.cl` | Administrador | Catálogo, usuarios, recepción de compras, carga masiva |
| `bodega@tiendaoregon.cl` | Bodega | Descarga de camión (vista de celular) |
| `chofer@tiendaoregon.cl` | Chofer | Bienvenida (la ruta aún no tiene pantalla) |

El login pide solo correo y contraseña; el rol sale de la base de datos y define la pantalla de destino.

## 6. Cosas útiles

- **Reiniciar la base de datos desde cero** (borra todo lo cargado): `dropdb -U postgres sgi_oregon`, y repetir los tres comandos del paso 2.
- **Pruebas de integridad de la base de datos:** `psql -U postgres -d sgi_oregon -f db/03_pruebas_integridad.sql` (deben aprobar las 39; si fallan, reinicia la base).
- **`psql` o `createdb` no se reconocen:** falta la línea del PATH del paso 1 en esa ventana.
- **Puerto 5173 o 3000 ocupado:** cierra el otro programa, o corre el frontend con `npm run dev -- --port 5174` (y en `backend/.env` pon `CORS_ORIGIN=http://localhost:5174`).
- **PowerShell no deja ejecutar `npm`** ("la ejecución de scripts está deshabilitada"): usa el Símbolo del sistema (cmd) en vez de PowerShell, o ejecuta una vez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

> Esta guía de Windows no se ha probado en una máquina Windows: el desarrollo y las pruebas se hicieron en Mac. Si algún paso falla, avisar para corregirlo.

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
