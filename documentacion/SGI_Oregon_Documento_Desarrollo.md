# SGI Tienda Oregón — Documento de desarrollo

> Versión del informe del Proyecto Integrado (INACAP, Ingeniería Informática) preparada para **desarrollar**. Contiene solo lo necesario para construir el sistema; los diagramas están transcritos a texto. **El informe es la documentación del proyecto: no se inventan funcionalidades fuera de él.**

## 0. Decisiones vigentes (prevalecen sobre cualquier figura o mockup)

1. **Login sin selector de rol.** El usuario ingresa correo y contraseña; el rol sale de la base de datos y define la pantalla de destino (ADMINISTRADOR → `/dashboard`, BODEGA → `/bodega`, CHOFER → `/ruta`). El mockup (Fig. 12) muestra tres botones de rol: se **omiten** en el desarrollo (retroalimentación del profesor).
2. **Roles del sistema: 3** (ADMINISTRADOR, BODEGA, CHOFER). "Jefatura Administrativa" y "Jefatura Comercial" son ambas ADMINISTRADOR.
3. **No se usa Docker** (no está en el informe). La BD de producción es **Amazon RDS PostgreSQL**; en desarrollo se usan PostgreSQL y Redis locales.
4. **Frontend:** se construye a partir de los mockups (Figs. 12–23) con la paleta de la sección 0.3.
5. **Plazo real: 19 días para el proyecto completo** (Sprints 1–4). El plan del informe sigue siendo de 12 semanas; no se modifica.
6. El **rol efectivo se lee de la BD en cada petición** (el JWT lleva solo `sub`). Cualquier rol enviado por el cliente se ignora.

### 0.1 Stack
- Frontend: React 18 PWA (Vite). Backend: Node.js + Express, API REST, JWT + RBAC. BD: PostgreSQL 16. Caché: Redis en el mismo EC2 (KPI del dashboard, TTL 30 s). Archivos: Amazon S3 (Excel procesados, PDF de facturas, fotos de rechazo). Despliegue: EC2 t3.small + RDS db.t4g.micro + S3, una zona de disponibilidad, HTTPS/TLS 1.3.

### 0.2 Plan de sprints (resumen; el detalle está en la sección 2.3)
| Sprint | Duración | Historias | Tareas |
|---|---|---|---|
| 0 | 1 semana | Preparación | — |
| 1 | 3 semanas | HU08 (seguridad), HU01 (catálogo), HU02 (precios y márgenes) + arquitectura base | T01–T12, T45–T48 |
| 2 | 2 semanas | HU03 (recepción), HU04 (importación masiva) | T13–T22, T49 |
| 3 | 2 semanas | HU05, HU06, HU07 (preparación, consulta de stock, ruta/entregas) | T23–T34, T50 |
| 4 | 2 semanas | HU09 (alertas de stock), HU10 (reportes/auditoría) | T35–T44, T51 |
| Puesta en marcha | 2 semanas | Pruebas de aceptación | — |

### 0.3 Estilo visual de los mockups
Ver la nota de estilo en la Figura 13 (naranja `#FF4400`, azul marino `#0B172A`, fondo `#F7FAFC`, botones oscuros `#202529`, verde éxito, rojo alerta).

### 0.4 Archivos de base de datos (carpeta `db/`)
`01_modelo_datos.sql` (esquema, triggers, vista `v_stock_critico`, 12 tablas, 13 FK) · `02_datos_ejemplo.sql` (**solo desarrollo**: usuarios y productos de ejemplo) · `03_pruebas_integridad.sql` (39 pruebas) · `04_prueba_rendimiento.sql` · `05_explain.sql` · `06_concurrencia.sql`.
Usuarios semilla (contraseña `Demo-Oregon-2026`): `admin@tiendaoregon.cl`, `bodega@tiendaoregon.cl`, `chofer@tiendaoregon.cl`.
En producción (RDS) la conexión debe usar SSL y **no** se ejecuta `02_datos_ejemplo.sql`.

### 0.5 Organización del código
Organización lógica del informe (Fig. 7): presentación (vistas jefaturas/bodega/chofer + compartido), api (rutas + middleware JWT/RBAC/validación), dominio (seguridad, catálogo, compras, ventas, inventario, reportes, auditoría), persistencia, infraestructura (config, excel, pdf, almacenamiento S3). Se mantiene la estructura actual del repositorio (`backend/src/routes`, `middleware`, etc.) y se agrupa por dominio sin renombrar lo que ya funciona.

### 0.6 Notas de implementación
- La orden de compra digital de la Fig. 4 **no tiene tabla** en el modelo de 12 tablas. No crear tablas nuevas: en HU03 la recepción se registra contra la factura (`recepcion_compra` + `detalle_recepcion`).
- Los permisos son cadenas `modulo:accion` guardadas en `rol.permisos` (JSONB); ver la sección 7.2.
- Ningún endpoint devuelve costo o margen a BODEGA ni CHOFER (se omite el campo, no se oculta en el front).

---


## 1 Introducción

Comercial Oregon SpA, empresa dedicada a la comercialización de artículos para el hogar y electrodomésticos a través de web, marketplaces y venta mayorista, gestiona hoy su inventario mediante planillas Excel descentralizadas. Durante el levantamiento de requerimientos, las jefaturas manifestaron un nulo control sobre las existencias, descuadres frecuentes de inventario, compras a proveedores sin respaldo fiscal y quiebres de stock que se detectan recién cuando el producto ya no está en bodega. A su vez, el personal de bodega y el chofer de despacho señalaron la necesidad de operar desde sus teléfonos personales, sin depender de lectores físicos de código de barras.

Para dar respuesta a esta realidad se diseñó el Sistema de Gestión de Inventario (SGI) Tienda Oregón, una aplicación web responsiva (PWA) con acceso diferenciado por roles (Administrador, Bodega y Chofer) que centraliza el catálogo maestro, la recepción de mercadería contra factura, la importación masiva de pedidos multicanal desde Excel, la preparación y despacho de pedidos, las alertas de stock crítico y los reportes de gestión, resguardando la información de costos y márgenes frente al personal operativo.

El proyecto se planificó con la metodología ágil Scrum, a partir de un Product Backlog de diez historias de usuario priorizadas mediante MoSCoW y organizadas en cuatro sprints (uno de tres semanas y tres de dos semanas), precedidos por un Sprint 0 de preparación y seguidos por dos semanas de pruebas de aceptación y puesta en marcha. La solución se documentó con el paradigma de vistas 4+1 y se sustenta en una arquitectura en la nube sobre AWS, con React, Node.js, PostgreSQL y Redis, a un costo operativo cercano a CLP 50.000 mensuales. Complementan el informe el diseño de interfaces, el modelo de datos, el plan de seguridad basado en RBAC y el modelo STRIDE, el plan de aseguramiento de calidad y el plan de recursos, costos y mitigación de riesgos.

## 2 Planificación y gestión ágil

### 2.1 Metodología de desarrollo seleccionada

Se seleccionó la metodología ágil Scrum fundamentada directamente en los hallazgos y prioridades levantadas durante las entrevistas con las contrapartes de Comercial Oregon. En dicho levantamiento, la Jefatura Administrativa evidenció la urgencia de erradicar los descuadres de inventario y evitar compras sin respaldo fiscal; asimismo, las entrevistas con el encargado de bodega y el chofer de despacho evidenciaron la necesidad de operar desde sus teléfonos personales mediante interfaces móviles claras y sin requerir lectores físicos de código de barras. Esta realidad operativa descartó modelos rígidos en cascada y respaldó la adopción de ciclos iterativos cortos con revisiones periódicas, permitiendo probar las vistas de pedidos y despacho directamente en sus dispositivos e incorporar su retroalimentación de forma continua.

Se evaluó también Kanban (Anderson, 2010), cuyo flujo continuo resulta útil para la operación diaria, pero que no fija objetivos ni revisiones periódicas con el cliente. Scrum (Schwaber & Sutherland, 2020) aporta lo que este proyecto necesita: un Product Backlog priorizado, sprints de duración fija con un objetivo definido y ceremonias de planificación, revisión y retrospectiva con la contraparte. Del enfoque Kanban se incorporó solo el tablero visual de tareas, que se mantiene en Jira o Trello dentro de cada sprint. El orden de los sprints combina la prioridad MoSCoW con las dependencias técnicas entre historias: primero seguridad, catálogo y precios (Sprint 1), luego el ingreso y la salida de mercadería (Sprint 2), después las interfaces móviles de bodega y chofer, que dependen de los pedidos ya cargados (Sprint 3), y al final las alertas y los reportes, que se alimentan de todos los movimientos de inventario (Sprint 4). La duración también es fija en cada ciclo: un Sprint 0 de una semana para preparar repositorio, tablero y entorno; un Sprint 1 de tres semanas, por concentrar los cimientos de los que dependen las demás historias; tres sprints de dos semanas; y dos semanas finales de pruebas de aceptación y puesta en marcha (12 semanas en total).

### 2.2 Product Backlog priorizado

**Tabla 1. Product Backlog priorizado con método MoSCoW**

| **ID** | **Historia de Usuario** | **Rol Responsable** | **Prioridad MoSCoW** | **Nivel de Urgencia** |
|---|---|---|---|---|
| **HU01** | Como Jefatura Administrativa, quiero registrar y administrar los productos en un catálogo maestro con SKU, modelo, nombre, marca y costo neto, para mantener una identificación única de los artículos y evitar duplicidades en el sistema. | Jefatura Administrativa | Must Have | Nivel 1 (Muy Urgente) |
| **HU08** | Como Jefatura Administrativa, quiero asignar perfiles y permisos diferenciados a cada trabajador con inicio de sesión seguro, para proteger la información de costos y ganancias frente al personal operativo. | Jefatura Administrativa | Must Have | Nivel 1 (Muy Urgente) |
| **HU03** | Como Jefatura Administrativa, quiero registrar la mercadería que llega en los camiones asociándola a la factura del proveedor, para que el stock en bodega se aumente de forma automática y oficial. | Jefatura Administrativa | Must Have | Nivel 1 (Muy Urgente) |
| **HU04** | Como Jefatura Comercial, quiero subir archivos de Excel con los pedidos de ventas de diferentes canales, para no tener que transcribir pedidos a mano y rebajar el stock disponible al instante. | Jefatura Comercial | Must Have | Nivel 1 (Muy Urgente) |
| **HU05** | Como Operario de Bodega, quiero ver la lista de pedidos pendientes en una pantalla web adaptada al celular, para preparar las cajas en los pasillos sin tener que imprimir hojas ni ir al computador de la oficina. | Operario de Bodega | Should Have | Nivel 2 (Urgente) |
| **HU06** | Como Operario de Bodega, quiero consultar cuántas unidades reales quedan de un producto buscando por SKU o modelo desde mi celular, para confirmar existencias de inmediato sin interrumpir a la administración. | Operario de Bodega | Should Have | Nivel 2 (Urgente) |
| **HU02** | Como Jefatura Comercial, quiero configurar precios de venta específicos para web, marketplaces y mayoristas, para calcular ganancias reales sin modificar los costos ingresados por administración. | Jefatura Comercial | Should Have | Nivel 2 (Urgente) |
| **HU09** | Como Jefatura Administrativa o Comercial, quiero recibir alertas visuales en el sistema cuando un producto esté por agotarse, para realizar compras a proveedores a tiempo y no quedarnos sin mercadería. | Jefatura Administrativa / Jefatura Comercial | Should Have | Nivel 2 (Urgente) |
| **HU07** | Como Chofer, quiero ver en el celular las entregas del día y marcar si fueron entregadas o rechazadas, para registrar el cierre del despacho sin usar planillas en papel. | Chofer | Could Have | Nivel 3 (Moderadamente Urgente) |
| **HU10** | Como Jefatura Administrativa o Comercial, quiero generar reportes de ventas, rotación de productos e inventario inmovilizado, para analizar el rendimiento mensual y tomar decisiones comerciales basadas en datos. | Jefatura Administrativa / Jefatura Comercial | Could Have | Nivel 4 (Poco Urgente) |

### 2.3 Sprint backlog

#### 2.3.1 Sprint 1

**Duración: 3 semanas**

**Sprint Goal: Sentar la arquitectura base, la autenticación con roles de seguridad (RBAC) para proteger costos/márgenes, la administración de usuarios con auditoría y el registro centralizado del catálogo maestro con precios multicanal**

**Tabla 2. Sprint backlog: Sprint 1**

| **ID Historia** | **Tarea Técnica** | **Responsable** | **Horas Estimadas** | **Estado** | **Criterio de Aceptación** |
|---|---|---|---|---|---|
| Base | T45: Configurar la arquitectura base: repositorio con revisión por pull request, API REST Node.js por capas, conexión a PostgreSQL y Redis, y bucket S3 privado en el entorno de pruebas. | Leonardo Aguilar | 12 | Por Hacer | API base respondiendo en el entorno de pruebas de AWS; base de datos creada con los scripts del modelo; credenciales en variables de entorno y no en el código. |
| HU08 | T01: Diseñar e implementar el modelo relacional de usuarios, roles y permisos (Administrador, Bodega, Chofer). | Danitza Isla | 8 | Por Hacer | Tablas creadas con claves primarias y foráneas; roles correctamente tipificados en base de datos relacional. |
| HU08 | T02: Implementar módulo de login y autenticación con cifrado/hash seguro de credenciales. | Nicolás Gacitúa | 6 | Por Hacer | Inicio de sesión funcional; passwords almacenadas con hash; sesiones inactivas expiran tras inactividad. |
| HU08 | T03: Configurar middleware y restricciones en vistas para ocultar costos de compra y márgenes a bodega/chofer. | Amalia Aillañir | 8 | Por Hacer | Las cuentas con perfil Bodega o Chofer no visualizan costos ni márgenes en pantalla ni en respuestas API/código fuente. |
| HU08 | T04: Ejecutar pruebas de seguridad de perfiles, control de acceso y concurrencia de sesiones. | Leonardo Aguilar | 4 | Por Hacer | Validación exitosa de accesos denegados a rutas administrativas desde cuentas operativas sin privilegios. |
| HU08 | T46: Implementar el servicio central de auditoría (AuditLog inmutable) y registrar inicios de sesión, cambios de permisos y accesos denegados. | Leonardo Aguilar | 6 | Por Hacer | Cada inicio de sesión, rechazo y acceso denegado queda registrado con fecha, usuario, rol, acción e IP de origen; el registro no puede modificarse ni borrarse. |
| HU08 | T47: Implementar la API de administración de usuarios: crear, asignar rol y dar de baja (CU-08). | Amalia Aillañir | 6 | Por Hacer | Solo el Administrador gestiona usuarios; la baja impide el ingreso sin borrar el historial; cada cambio queda en el AuditLog. |
| HU08 | T48: Desarrollar la interfaz de administración de usuarios y roles. | Danitza Isla | 8 | Por Hacer | Pantalla del Administrador para listar, crear, cambiar el rol y dar de baja usuarios, con confirmación visual y mensajes de error claros. |
| HU01 | T05: Diseñar y crear la tabla del catálogo maestro (SKU, nombre, modelo, marca, categoría, costo neto). | Danitza Isla | 6 | Por Hacer | Esquema relacional implementado con restricciones de integridad y tipos de datos normalizados. |
| HU01 | T06: Desarrollar interfaz CRUD web para listar, registrar y editar artículos (perfil Jefatura Administrativa). | Nicolás Gacitúa | 10 | Por Hacer | Formulario funcional con validación de campos vacíos y tabla administrativa con paginación. |
| HU01 | T07: Implementar validación en backend de unicidad estricta para código SKU e integridad de catálogo. | Amalia Aillañir | 6 | Por Hacer | El sistema rechaza el intento de duplicar un SKU arrojando una alerta clara en la interfaz. |
| HU01 | T08: Programar pruebas unitarias sobre creación y edición de productos para descartar duplicidades. | Leonardo Aguilar | 4 | Por Hacer | 100% de test unitarios aprobados validando unicidad y persistencia en base de datos. |
| HU02 | T09: Modelar tabla para tarifas y precios diferenciados por canal (Web, Marketplaces, Mayorista). | Danitza Isla | 6 | Por Hacer | Tabla de precios vinculada al SKU mediante clave foránea, admitiendo tarifas simultáneas por canal. |
| HU02 | T10: Diseñar interfaz de gestión de precios por canal de venta para el perfil Jefatura Comercial. | Nicolás Gacitúa | 10 | Por Hacer | Pantalla intuitiva donde la jefatura comercial actualiza valores de venta con confirmación visual. |
| HU02 | T11: Implementar cálculo automático de margen porcentual protegiendo el costo base de alteraciones no autorizadas. | Amalia Aillañir | 8 | Por Hacer | El margen comercial se calcula automáticamente en base al costo registrado por administración sin poder sobreescribir dicho costo. |
| HU02 | T12: Realizar pruebas de integración entre catálogo de productos y actualización de precios multicanal. | Leonardo Aguilar | 4 | Por Hacer | Flujo probado de extremo a extremo: cambio de precio reflejado en el canal respectivo sin inconsistencias. |

El Sprint 1 es el único de tres semanas y construye los cimientos estructurales y de seguridad indispensables para el sistema: la arquitectura base, la autenticación con roles, la administración de usuarios, el servicio de auditoría y el catálogo maestro con sus precios por canal. Selecciona las historias de mayor prioridad e impacto técnico del Product Backlog (HU08, HU01 y HU02); HU02 se incluye aquí, aunque es Should Have, porque en el catálogo maestro el precio de cada canal se gestiona en la misma pantalla que el producto (CU-03). Los requerimientos se descompusieron en dieciséis tareas técnicas atómicas y medibles que suman 112 horas, bajo la capacidad de 120 horas del sprint (4 integrantes × 10 h/semana × 3 semanas). Esta planificación temprana mitiga de inmediato los riesgos más críticos detectados en el levantamiento inicial, como la exposición de costos comerciales sensibles y la duplicidad en la identificación de productos, y deja al término del ciclo un incremento de software funcional, testeado y alineado con los criterios de calidad y seguridad exigidos por Comercial Oregon.

#### 2.3.2 Sprint 2

**Duración:** 2 semanas

**Sprint Goal: Reemplazar el manejo manual de entradas por compras a proveedores, con confirmación de la descarga en bodega, y automatizar la ingesta masiva de pedidos multicanal mediante planillas Excel con rebaja atómica de stock.**

**Tabla 3. Sprint backlog: Sprint 2**

| **ID Historia** | **Tarea Técnica** | **Responsable** | **Horas Estimadas** | **Estado** | **Criterio de Aceptación / DoD** |
|---|---|---|---|---|---|
| HU03 | T13: Diseñar modelo relacional para recepciones de compras y detalle de facturas de proveedores. | Danitza Isla | 8 | Por Hacer | Tablas RecepcionCompra y DetalleRecepcion creadas con integridad referencial. |
| HU03 | T14: Construir formulario web para registro de compras, número de factura y cantidades recibidas por SKU. | Nicolás Gacitúa | 8 | Por Hacer | Formulario operativo que captura cabecera de factura y detalle de ítems ingresados, y adjunta el PDF de la factura (almacenado en S3). |
| HU03 | T15: Implementar lógica transaccional atómica para incremento automático del stock físico en bodega. | Amalia Aillañir | 8 | Por Hacer | El método incrementarFisico() suma existencias en la misma transacción de BD. |
| HU03 | T16: Pruebas transaccionales de ingreso de mercadería y control de excepciones en BD. | Danitza Isla | 4 | Por Hacer | Pruebas de rollback y consistencia ACID ejecutadas con éxito ante caídas. |
| HU03 | T49: Implementar la confirmación de descarga del camión por Bodega: conteo de bultos contra la factura o guía (CU-11). | Nicolás Gacitúa | 4 | Por Hacer | Bodega confirma la descarga desde el celular y la confirmación queda registrada con usuario y hora en el AuditLog. |
| HU04 | T17: Desarrollar parser y lector de archivos Excel (.xlsx) con validación de estructura de columnas. | Amalia Aillañir | 10 | Por Hacer | Módulo capaz de cargar y parsear planillas de pedidos multicanal sin bloqueos; conserva una copia del archivo procesado en S3. |
| HU04 | T18: Implementar motor de validaciones fila por fila (SKU existente, cantidades > 0, stock disponible). | Leonardo Aguilar | 8 | Por Hacer | Validación exhaustiva que detiene y reporta registros erróneos antes de procesar. |
| HU04 | T19: Diseñar interfaz web para subida de archivos Excel y visualización de informe previo de inconsistencias. | Nicolás Gacitúa | 8 | Por Hacer | Pantalla intuitiva con drag-and-drop y tabla de revisión de errores fila por fila. |
| HU04 | T20: Programar lógica transaccional de rebaja atómica de stock disponible tras importación exitosa. | Danitza Isla | 8 | Por Hacer | Ejecución del método rebajarDefinitivo() descontando stock de manera inmediata. |
| HU04 | T21: Integrar registro en bitácora AuditLog del archivo procesado, usuario e ítems importados. | Leonardo Aguilar | 6 | Por Hacer | Trazabilidad inmutable de la carga masiva registrada con usuario y timestamp. |
| HU04 | T22: Pruebas de carga masiva con planillas de prueba de Marketplaces y control de estrés de datos. | Leonardo Aguilar | 6 | Por Hacer | Pruebas con archivos de más de 200 filas procesadas sin bloqueos ni errores. |

Este sprint busca fortalecer el control de inventario del sistema mediante dos funcionalidades complementarias. Por un lado, se implementa el registro de recepciones de mercadería desde proveedores, que incluye el diseño de la base de datos, un formulario de ingreso y la actualización automática y segura del stock físico en bodega, la confirmación de la descarga del camión por parte de Bodega (CU-11) y el almacenamiento en S3 del PDF de la factura. Por otro lado, se desarrolla la importación masiva de pedidos desde planillas Excel de distintos canales de venta, con validaciones previas de los datos, una interfaz para revisar errores, la rebaja automática del stock disponible y el registro de cada carga en una bitácora de auditoría y la conservación en S3 de la planilla procesada. Ambas funcionalidades se complementan con pruebas que aseguran la consistencia de los datos y el buen rendimiento del sistema. El trabajo está distribuido entre cuatro integrantes del equipo y, en conjunto, apunta a mantener un inventario confiable, trazable y actualizado tanto en las entradas como en las salidas de productos, proporcionando al cliente la posibilidad de simular la entrada y salida de productos para evidenciar el funcionamiento. Las 78 horas del sprint quedan bajo su capacidad de 80 horas.

#### 2.3.3 Sprint 3

**Duración:** 2 semanas

**Sprint Goal: Habilitar interfaces web móviles y ergonómicas para que bodega realice picking/packing y consultas ágiles, el chofer confirme entregas en terreno y la administración supervise los pedidos y asigne choferes.**

**Tabla 4. Sprint backlog: Sprint 3**

| **ID Historia** | **Tarea Técnica** | **Responsable** | **Horas Estimadas** | **Estado** | **Criterio de Aceptación / DoD** |
|---|---|---|---|---|---|
| HU05 | T23: Diseñar interfaz web responsiva (Mobile-First) con botones grandes para preparación de pedidos. | Nicolás Gacitúa | 8 | Por Hacer | Vistas optimizadas para pantallas de celular y manipulación táctil en pasillos. |
| HU05 | T24: Desarrollar listado interactivo de pedidos pendientes clasificados por canal de venta. | Amalia Aillañir | 8 | Por Hacer | Lista filtrable de órdenes que permite a los operarios revisar ítems a armar. |
| HU05 | T25: Implementar endpoint y acciones de cambio de estado del pedido (Sin recolectar, Armado, Etiquetado, En camión) con checklist de ítems y descarga de etiqueta (CU-10). | Leonardo Aguilar | 8 | Por Hacer | Cambio de estado persistido en BD siguiendo las transiciones permitidas, informando al flujo logístico. |
| HU05 | T26: Pruebas de usabilidad en dispositivos móviles dentro del entorno físico de bodega. | Leonardo Aguilar | 4 | Por Hacer | Evaluación de ergonomía y velocidad de interacción en smartphones del personal. |
| HU06 | T27: Construir endpoint optimizado y barra de búsqueda predictiva en tiempo real por SKU y modelo. | Amalia Aillañir | 6 | Por Hacer | Consulta ágil que retorna stock físico y ubicación en bodega en menos de 2 segundos. |
| HU06 | T28: Adaptar vista de consulta rápida de existencias para smartphones de operarios de bodega. | Nicolás Gacitúa | 6 | Por Hacer | Interfaz limpia sin datos de costos ni información administrativa reservada. |
| HU06 | T29: Pruebas de velocidad de consulta y concurrencia de búsqueda en bodega. | Leonardo Aguilar | 4 | Por Hacer | Tiempo de respuesta medido y validado bajo múltiples consultas simultáneas. |
| HU07 | T30: Crear modelo y tabla de despachos asociada a la orden de venta y al usuario Chofer. | Danitza Isla | 6 | Por Hacer | Esquema relacional de Despacho vinculado al documento tributario (boleta/factura). |
| HU07 | T50: Desarrollar la supervisión de pedidos y la asignación de chofer para generar la hoja de ruta (CU-06). | Nicolás Gacitúa | 6 | Por Hacer | El Administrador ve el estado de cada pedido y asigna un chofer; la asignación queda registrada en el AuditLog. |
| HU07 | T31: Desarrollar interfaz móvil exclusiva para el Chofer con la hoja de ruta del día. | Danitza Isla | 8 | Por Hacer | Vista simplificada donde el chofer revisa los bultos con dirección y contacto. |
| HU07 | T32: Implementar formulario de cierre de entrega ('Entregado' / 'Rechazado' con causal y foto de evidencia). | Amalia Aillañir | 6 | Por Hacer | Registro en tiempo real del estado de entrega en terreno con guardado inmediato; la foto de rechazo se almacena en S3. |
| HU07 | T33: Conectar el despacho cerrado con el registro inmutable de auditoría (AuditLog). | Danitza Isla | 4 | Por Hacer | Registro de hora, usuario y motivo de rechazo si correspondiera en auditoría. |
| HU07 | T34: Pruebas integrales de flujo de despacho en terreno y validación de estados de entrega. | Leonardo Aguilar | 4 | Por Hacer | Flujo completo verificado desde asignación en bodega hasta entrega del chofer. |

El Sprint 3 tiene como objetivo central digitalizar y movilizar la operación logística del proyecto mediante el desarrollo de interfaces web móviles y ergonómicas que faciliten el trabajo en terreno. Por un lado, busca optimizar la labor del personal de bodega permitiéndoles realizar pedidos mediante pantallas táctiles adaptadas a los pasillos, revisar listas de pedidos pendientes por canal de venta y actualizar los estados en tiempo real. Por otro lado, integra un sistema de consultas ágiles de stock por SKU y modelo que devuelve la ubicación física del producto. Además, la Jefatura Administrativa supervisa los pedidos y asigna chofer para generar la hoja de ruta (CU-06). Finalmente, abarca el módulo del chófer con un esquema relacional de despachos vinculado a facturas/boletas, permitiéndole visualizar su hoja de ruta diaria y registrar el cierre de la entrega (Entregado o Rechazado con causal) con guardado inmediato en un historial inmutable de auditoría (AuditLog); en caso de rechazo se guarda una foto de evidencia en S3. Las 78 horas del sprint quedan bajo su capacidad de 80 horas.

#### 2.3.4 Sprint 4

**Duración:** 2 semanas

**Sprint Goal: Integrar el patrón Observer para alertas reactivas de stock crítico y refresco de métricas con caché Redis, consolidar métricas de rotación mensual, entregar el dashboard administrativo final y habilitar la consulta y exportación de la bitácora de auditoría.**

**Tabla 5. Sprint backlog: Sprint 4**

| **ID Historia** | **Tarea Técnica** | **Responsable** | **Horas Estimadas** | **Estado** | **Criterio de Aceptación / DoD** |
|---|---|---|---|---|---|
| HU09 | T35: Implementar interfaces y clases del Patrón Observer (SujetoInventario, InventarioObserver). | Amalia Aillañir | 8 | Por Hacer | Estructura desacoplada implementada conforme al diagrama de clases del sistema. |
| HU09 | T36: Construir servicio concreto AlertaStockCriticoService que evalúe umbrales mínimos por producto. | Amalia Aillañir | 8 | Por Hacer | Disparo automático del evento de alerta ante stock_fisico <= stock_minimo. |
| HU09 | T37: Diseñar componentes visuales de alerta (badges, banners y compras sugeridas) en panel directivo. | Nicolás Gacitúa | 6 | Por Hacer | Notificaciones destacadas visibles en el panel de Jefatura Administrativa y Comercial. |
| HU09 | T38: Pruebas unitarias y de integración de la reactividad del patrón Observer ante rebajas de stock. | Leonardo Aguilar | 4 | Por Hacer | Tests automáticos que certifican que la alerta se genera sin polling continuo. |
| HU10 | T39: Modelar vistas y consultas SQL analíticas para consolidados de ventas (semanal, mensual, anual). | Danitza Isla | 8 | Por Hacer | Consultas SQL de agregación optimizadas con métricas de facturación y volumen. |
| HU10 | T40: Desarrollar lógica de cálculo de rotación de inventario y detección de artículos inmovilizados. | Danitza Isla | 8 | Por Hacer | Algoritmo que clasifica productos con alta rotación vs. stock sin movimiento. |
| HU10 | T41: Integrar librería de gráficos dinámicos (Chart.js) en el Dashboard administrativo. | Nicolás Gacitúa | 8 | Por Hacer | Gráficos interactivos de ventas, márgenes globales y rotación mensual. |
| HU10 | T42: Desarrollar módulo de exportación de reportes de gestión y de la bitácora a planillas descargables (.xlsx / PDF). | Nicolás Gacitúa | 6 | Por Hacer | Botón de exportación rápida de métricas y de la bitácora para análisis directivo. |
| HU10 | T51: Desarrollar la consulta de la bitácora de auditoría con filtros por usuario, acción y fecha (CU-07). | Danitza Isla | 4 | Por Hacer | El Administrador consulta Fecha, Usuario, Rol, Acción, Módulo e IP de origen y filtra los registros; la exportación usa el módulo de T42. |
| HU10 | T43: Vincular el observador DashboardMetricObserver para el refresco automático de métricas clave y la invalidación de la caché Redis de KPI (vigencia de 30 s). | Leonardo Aguilar | 8 | Por Hacer | Métricas del panel sincronizadas reactivamente ante movimientos de inventario; respuesta de la API bajo 400 ms (PR-04). |
| HU10 | T44: Pruebas finales de estrés, validación con usuarios directivos y cierre integral del proyecto. | Leonardo Aguilar | 6 | Por Hacer | Aprobación formal de jefaturas y cumplimiento pleno de la Definición de Terminado. |

El Sprint 4 tiene como propósito central ofrecer a la administración de tienda oregon herramientas visuales e inteligentes para tomar decisiones a tiempo y evitar quedarse sin mercadería, en esta etapa final, se le entrega al cliente un panel de control interactivo (dashboard) que muestra de forma clara el desempeño de las ventas, los márgenes y la rotación de los artículos, junto con un sistema de alertas visuales automáticas y reportes descargables en Excel y PDF. Esta entrega da respuesta directa a lo planteado por las jefaturas durante la entrevista, donde manifestaron que actualmente tienen nulo control sobre el inventario y se percatan de los quiebres cuando el producto ya no está físicamente en bodega, con estas nuevas funciones la pantalla les advertirá de inmediato cuándo un producto llega a su stock crítico y les sugerirá compras a proveedores antes de que ocurra una falta de stock. También se habilita la consulta y exportación de la bitácora de auditoría (CU-07) y se aplica la caché Redis a los indicadores del dashboard, con vigencia de 30 segundos, para cumplir el tiempo de respuesta exigido (PR-04). Las 74 horas del sprint quedan bajo su capacidad de 80 horas.

## 3 Arquitectura de software (paradigma 4+1)

La arquitectura del SGI se documenta con el modelo de vistas 4+1 (Kruchten, 1995): la vista lógica (diagrama de clases), la vista de procesos (secuencia, actividades y comunicación), la vista de desarrollo (componentes y paquetes), la vista física (despliegue) y los escenarios (casos de uso) que integran a las demás.

### 3.1 Vista lógica

#### 3.1.1 Diagrama de clases

#### Figura 1. Diagrama de clases del SGI Oregón (vista lógica)

**Diagrama de clases (UML) — 12 clases.** Notación: `+` método público, `-` atributo. Las flechas indican navegabilidad; "composición" = el hijo no existe sin el padre.

| Clase | Atributos | Métodos |
|---|---|---|
| Rol | id_rol:int, nombre_rol:string, descripcion:string, permisos:List<string> | asignarPermiso(permiso) |
| Usuario | id_usuario:int, rut:string, nombre_completo:string, email:string, password_hash:string, activo:boolean | autenticar(password):boolean, tienePermiso(accion):boolean |
| LoteImportacion | id_lote, id_usuario, nombre_archivo, url_archivo_s3, fecha_carga:datetime, total_ordenes:int, total_lineas:int | — |
| OrdenVenta | id_orden, id_lote, codigo_externo, canal_origen, rut_cliente, nombre_cliente, direccion_despacho, comuna, telefono_contacto, estado_orden, numero_documento_sii | procesarCargaMasiva(excel):boolean, cambiarEstado(estado) |
| DetalleVenta | id_detalle_vta, id_orden, sku, cantidad_vendida:int, precio_unitario:decimal, subtotal:decimal | — |
| Despacho | id_despacho, id_orden, id_usuario_chofer, fecha_asignacion:date, estado_entrega:string, motivo_rechazo:string | registrarEntrega(), registrarRechazo(motivo) |
| RecepcionCompra | id_recepcion, numero_factura, rut_proveedor, nombre_proveedor, fecha_recepcion:datetime, estado_documento | registrarIngreso() |
| DetalleRecepcion | id_detalle_rec, id_recepcion, sku, cantidad_recibida:int, observaciones_dano:string | — |
| AuditLog | id_log, id_usuario, tabla_afectada, accion, valores_anteriores:json, valores_nuevos:json, ip_origen, geolocalizacion, fecha_hora:timestamp | registrarEvento() |
| Producto | sku:string, modelo, nombre, marca, descripcion, costo_adquisicion_neto:decimal, stock_minimo:int, estado | actualizarDatos(), inactivar() |
| Inventario | id_inventario, sku, stock_fisico:int, stock_reservado:int, ubicacion_bodega | getStockDisponible():int, incrementarFisico(cant), rebajarDefinitivo(cant), verificarStockMinimo():boolean |
| ListaPrecio | id_lista, sku, canal_venta, precio_venta_neto:decimal, margen_porcentual:float | calcularMargen(costo):float, actualizarPrecio(precio) |

**Relaciones (cardinalidad):**
- Rol 1 ← 1..* Usuario: el rol *clasifica* a los usuarios.
- Usuario 1 → 0..* LoteImportacion (*carga*); Usuario 1 → 0..* RecepcionCompra (*registra*); Usuario 1 → 0..* AuditLog (*genera*); Usuario 1 → 0..* Despacho (*asignado a*, como chofer).
- LoteImportacion 1 → 1..* OrdenVenta (*agrupa*).
- OrdenVenta 1 ◆— 1..* DetalleVenta (composición, *compone*); OrdenVenta 1 — 0..1 Despacho (*despachada en*).
- DetalleVenta 0..* → 1 Producto (*referencia*).
- RecepcionCompra 1 ◆— 1..* DetalleRecepcion (composición); DetalleRecepcion 0..* → 1 Producto (*referencia*).
- Producto 1 ◆— 1 Inventario (*controla existencia*); Producto 1 ◆— 1..* ListaPrecio (*tiene precios por canal*).

Patrón Observer previsto (Sprint 4, T35/T36/T43): `SujetoInventario`, `InventarioObserver`, `AlertaStockCriticoService`, `DashboardMetricObserver`; se dispara cuando `stock_fisico <= stock_minimo`.

### 3.2 Vista de procesos

#### 3.2.1 Diagrama de secuencia

#### Figura 2. Diagrama de secuencia: carga masiva de pedidos multicanal (HU04)

**Diagrama de secuencia — HU04, carga masiva de pedidos multicanal (35 pasos).** Participantes: actor Jefatura Comercial, UI Jefaturas, Gateway REST, Seguridad, Importador Excel, Almacenamiento S3, Catálogo, Ventas y Pedidos, Inventario, Auditoría, PostgreSQL.

1. El usuario elige la planilla `.xlsx` en la UI. 2. La UI hace `POST /pedidos/importaciones` (archivo + token JWT) al Gateway.
3. Gateway → Seguridad: `validarToken(jwt, "pedidos:importar")`. 4. Seguridad responde el rol.
- **Si token inválido o rol sin permiso:** 403 Acceso denegado → la UI muestra "Sin permisos".
- **Si autorizado:**
  7. Gateway → Importador: `importar(archivo, usuario)`. 8–9. El Importador guarda el archivo en S3 y recibe `urlArchivo`. 10. `parsearFilas()` y valida campos obligatorios.
  11–14. **Por cada fila:** `existeSKU(sku)` al Catálogo (true/false) y `consultarStock(sku)` a Inventario (`stockDisponible`).
  - **Si SKU inexistente o stock insuficiente:** 15–17. `errorValidación(fila, motivo)` → **422 Carga detenida** → la UI muestra "Error en fila N: motivo". No se escribe nada.
  - **Si el lote es válido:** 18. `crearPedidos(lote)` en Ventas y Pedidos. 19. `BEGIN TRANSACTION`.
    20–22. **Por cada línea:** `descontarStock(sku, cantidad)` → Inventario ejecuta `SELECT ... FOR UPDATE` y `UPDATE stock` → responde ok / stock insuficiente.
    - **Si algún descuento falla (venta concurrente):** 23. `ROLLBACK`; 24–27. error → **409 Conflicto** ("stock cambió").
    - **Si todos los descuentos están ok:** 28. `INSERT pedidos` con estado `PENDIENTE_PREPARACION`; 29–30. `registrarEvento("IMPORTACIÓN", usuario, lote)` → `INSERT audit_log`; 31. `COMMIT`; 32–35. resumen (nPedidos, nLíneas) → **201 Created** → la UI muestra "N pedidos enviados a bodega".

Regla clave: validación completa antes de escribir, y rebaja de stock + creación de pedidos + auditoría en **una sola transacción**.

#### 3.2.2 Diagrama de actividades

#### Figura 3. Diagrama de actividades: proceso de despacho y abastecimiento

**Diagrama de actividades con 4 carriles — proceso de despacho y abastecimiento.** (La imagen original tiene errores tipográficos en algunas etiquetas; aquí se transcribe el flujo previsto.)

- **Carril Jefatura Comercial/Administrativa:** inicio → descargar planillas de pedidos multicanal → subir archivo Excel (.xlsx) consolidado al SGI.
- **Carril Sistema SGI Oregón (Backend):** decisión ¿SKU existe en catálogo y hay stock suficiente?
  - **No:** detener la carga, indicar la fila con error y notificar el error → fin.
  - **Sí:** descontar stock disponible de forma transaccional (ACID) → cambiar estado a "Pendiente de Preparación".
- **Carril Operario de Bodega:** visualizar lista de pedidos pendientes en la interfaz móvil → identificar productos en pasillos por SKU y modelo → empaquetar bultos y cambiar estado a "Listo para despacho".
- **Carril Chofer/Repartidor:** consultar hoja de ruta diaria asignada en el celular → trasladar bultos a la dirección del cliente → decisión ¿entrega exitosa en cliente?
  - **Sí:** vincular N° de boleta/factura del cliente → cambiar estado del pedido a "Entregado".
  - **No:** registrar motivo de rechazo o no entrega → cambiar estado a "Rechazado / No entregado".
- **Cierre (Backend):** registrar cierre de operación e historial en AuditLog → fin.

#### Figura 4. Diagrama de actividades: recepción de mercadería y abastecimiento (HU03)

**Diagrama de actividades con 3 carriles — flujo secundario, recepción de mercadería y abastecimiento (HU03).**

1. *Jefatura Administrativa:* registrar orden de compra digital en el SGI. (Nota: el modelo de datos entregado **no tiene tabla de orden de compra**; ver "Notas de implementación".)
2. *Bodega:* recibir el camión del proveedor y solicitar factura o guía de despacho → abrir Despacho › Descarga de camión en el celular e ingresar N° de factura o guía.
3. *Sistema:* cargar el detalle esperado por SKU.
4. *Bodega:* descargar el camión y contar físicamente los bultos por SKU → decisión ¿conteo y estado conformes?
   - **No:** registrar observaciones (producto dañado, faltante o cantidad real) → continúa.
   - **Sí/continúa:** marcar productos descargados y presionar "Confirmar descarga conforme".
5. *Sistema:* validar la factura contra la orden de compra y las cantidades recibidas → decisión ¿factura, orden y conteo coinciden?
   - **No:** notifica a la Jefatura, que revisa la discrepancia y autoriza el ingreso por lo efectivamente recibido.
   - **Sí (o autorizado):** confirmar ingreso e incrementar stock físico (transacción ACID) → actualizar historial de compras y registrar evento RECEPCIÓN en AuditLog.
6. *Bodega:* ubicar la mercadería en pasillo y estante y actualizar su ubicación en bodega → fin.

#### 3.2.3 Diagrama de comunicación

#### Figura 5. Diagrama de comunicación: registro de recepción de mercadería (HU03)

**Diagrama de comunicación — HU03, registro de recepción de mercadería.** Mensajes numerados:

1. Jefatura Administrativa → UI Jefaturas: `registrarRecepción(rutProveedor, nFactura, fecha, ítems, observaciones)`
1.1 UI → Gateway REST: `POST /compras/recepciones` (JWT)
1.1.1 Gateway → Seguridad: `validarToken(jwt, "compras:recepcionar")`
1.1.2 Gateway → Compras y Recepción: `registrarRecepción(dto)`
1.1.2.1 Compras → Catálogo: `validarSKUs(ítems)`
1.1.2.2 Compras → PostgreSQL: `BEGIN`
1.1.2.3 Compras → PostgreSQL: `INSERT recepción, detalle y observaciones`
1.1.2.4 Compras → Inventario, **por cada ítem**: `incrementarStock(sku, cantidad)` → 1.1.2.4.1 Inventario → PostgreSQL: `UPDATE stock`
1.1.2.5 Compras → Auditoría: `registrarEvento("RECEPCIÓN", usuario, nFactura)` → 1.1.2.5.1 Auditoría → PostgreSQL: `INSERT audit_log`
1.1.2.6 Compras → PostgreSQL: `COMMIT`

(Nota: `compras:recepcionar` es el permiso del ADMINISTRADOR; el operario de BODEGA confirma la descarga con `compras:confirmar_descarga`.)

### 3.3 Vista de desarrollo

#### 3.3.1 Diagrama de componentes

#### Figura 6. Diagrama de componentes del SGI Oregón

**Diagrama de componentes — SGI Oregón.** Cliente → servidor → base de datos.

- **Cliente:** PWA React (UI Jefaturas: carga Excel, recepción) → `HTTPS + JWT` → Gateway REST.
- **Servidor de aplicaciones — API REST (Node.js)**, componentes:
  - **Gateway REST** (enrutador/delegación): delega a todos los demás; llama a Seguridad (`validarToken`) y a Caché Redis (`consultarKPI`).
  - **Seguridad** (autenticación + RBAC; clases Usuario, Rol).
  - **Caché Redis** (KPI del dashboard, TTL 30 s; corre en el mismo servidor).
  - **Importador Excel** (parser + validador .xlsx; `OrdenVenta.procesarCargaMasiva()`): `POST /pedidos/importaciones`; usa `guardarArchivo` hacia **Amazon S3** (archivos Excel); `existeSKU` hacia Catálogo; `consultarStock` hacia Inventario; `crearPedidos(lote)` hacia Ventas y Pedidos.
  - **Catálogo** (productos y precios por canal; Producto, ListaPrecio).
  - **Compras y Recepción** (factura y detalle; RecepcionCompra, DetalleRecepcion): `POST /compras/recepciones`; `validarSKUs` hacia Catálogo; `incrementarStock` hacia Inventario; `registrarEvento(RECEPCIÓN)` hacia Auditoría.
  - **Ventas y Pedidos** (órdenes de venta y despacho; OrdenVenta, DetalleVenta, Despacho): `descontarStock` hacia Inventario; `registrarEvento(IMPORTACIÓN)` hacia Auditoría.
  - **Inventario** (motor de stock ACID; Inventario).
  - **Auditoría** (bitácora inmutable; AuditLog).
  - **Acceso a Datos (ORM/Repositorios)**, usado por todos los módulos → `TCP 5432 (VPC privada)` → **PostgreSQL (Amazon RDS)**.

#### 3.3.2 Diagrama de paquetes

#### Figura 7. Diagrama de paquetes del SGI Oregón

**Diagrama de paquetes — organización del código (paquete raíz `sgi-oregon`).**

- **presentacion (Frontend React PWA):** `vistas.chofer`, `vistas.bodega`, `vistas.jefaturas`, y `compartido` (componentes UI, clienteApi, sesión). Las tres vistas importan `compartido`. La presentación accede a `api` por HTTPS.
- **api (capa de servicios REST):** `rutas` (controladores por épica) → importa `middleware` (JWT, RBAC, validación). Las rutas acceden al dominio; el middleware accede a `dominio.seguridad`.
- **dominio (lógica de negocio):** `seguridad` (HU08), `catalogo` (Épica Catálogo: HU01, HU02), `compras` (HU03), `ventas` (HU04, HU05, HU07), `inventario` (HU06, HU09), `reportes` (HU10), `auditoria` (AuditLog).
  - Dependencias: `compras` → `catalogo` e `inventario`; `ventas` → `catalogo` e `inventario`; `reportes` → `ventas` e `inventario`; `inventario` → `auditoria`.
- **persistencia (PostgreSQL):** `migraciones`, `repositorios` (importa `entidades`), `entidades`.
- **infraestructura:** `config`, `pdf` (generador), `excel` (parser .xlsx), `almacenamiento` (Amazon S3).
- El dominio accede a `persistencia` e `infraestructura`.

### 3.4 Vista física

#### 3.4.1 Diagrama de despliegue

#### Figura 8. Diagrama de despliegue del SGI Oregón

**Diagrama de despliegue — SGI Oregón (AWS, una sola zona de disponibilidad).**

- **Dispositivos cliente (capa de presentación)**, todos por `HTTPS / TLS 1.3 · puerto 443` → Internet Gateway:
  - *Estación de trabajo (oficina)* — Jefatura Comercial y Administrativa: navegador web, panel de administración, carga masiva Excel (.xlsx), informes PDF/Excel.
  - *Smartphone Bodega (móvil)* — Operario de Bodega: Web App responsiva/PWA, picking y empaque, buscador rápido SKU/modelo, descarga de camión.
  - *Smartphone Terreno (móvil)* — Chofer/Repartidor: Web App responsiva/PWA, hoja de ruta diaria, registro de entregas/rechazos, captura de firma y vinculación SII.
- **Región AWS → VPC (zona de disponibilidad única):**
  - *Servidor de aplicaciones (EC2 t3.small)*, subred pública, grupo de seguridad solo 443, TLS Let's Encrypt: API REST Node.js + PWA React, validador y parser Excel, control de acceso (RBAC/JWT), motor de reglas de negocio (ACID), alertas de stock mínimo, caché Redis (KPI del dashboard).
  - *Amazon RDS for PostgreSQL* (subred privada, db.t4g.micro, 20 GB SSD): catálogo, stock, pedidos y compras; usuarios y roles; AuditLog; respaldos automáticos. Conexión desde EC2 por `TCP 5432` (subred privada).
  - *Amazon S3* (~5 GB, durable, regional): archivos Excel procesados, comprobantes PDF, fotos de rechazo, respaldos programados (snapshots de la BD). Acceso desde EC2 por API HTTPS / VPC Endpoint; RDS envía snapshots y respaldos a S3.
- **Evolución prevista (no incluida en el costo):** balanceador de carga + 2.º servidor en otra zona + RDS Multi-AZ.

### 3.5 Vista de escenarios (+1)

#### 3.5.1 Diagrama de casos de uso

#### Figura 9. Diagrama de casos de uso general del SGI

**Diagrama de casos de uso general — sistema "SGI Tienda Oregón".**

Actores: Jefatura Administrativa, Jefatura Comercial, Operario de Bodega, Chofer. (En la implementación, ambas jefaturas son el rol de sistema `ADMINISTRADOR`.)

| Caso de uso | Actores asociados |
|---|---|
| Administrar Catálogo Maestro | Jefatura Administrativa, Jefatura Comercial |
| Registrar Recepción de Mercadería | Jefatura Administrativa |
| Administrar Usuarios y Permisos RBAC | Jefatura Administrativa |
| Configurar Precios y Márgenes por Canal | Jefatura Comercial (y Administrativa) |
| Importar Pedidos Masivos | Jefatura Comercial y Administrativa |
| Visualizar Alertas de Stock Mínimo | Jefaturas |
| Generar Reportes Consolidados | Jefaturas |
| Preparar Pedidos en Celular | Operario de Bodega |
| Consultar Stock en Pasillos | Operario de Bodega |
| Gestionar Hoja de Ruta y Entregas | Chofer |

Los casos de las jefaturas (catálogo, recepción, usuarios, precios, importación) hacen `«include»` del caso **Autenticar Usuario / Iniciar Sesión**.

#### Figura 10. Caso de uso: importación masiva de pedidos

**Caso de uso: Importación masiva de pedidos.** Actores: Jefatura Comercial y Jefatura Administrativa → **Importar Pedidos Masivos**, que incluye (`«include»`):
- Validar Formato y Columnas (.xlsx)
- Verificar Existencia de SKU y Stock → extendido (`«extend»`) por *Notificar Fila con Error de SKU* y *Notificar Quiebre de Stock Insuficiente*
- Rebajar Inventario Disponible (ACID)
- Crear Órdenes "Pendiente Preparación"
- Registrar Auditoría Transaccional

#### Figura 11. Caso de uso: preparación de pedidos en celular

**Caso de uso: Preparación de pedidos en celular.** Actor: Operario de Bodega → **Preparar Pedidos en Celular**, que incluye (`«include»`):
- Aplicar Restricción Visual RBAC (ocultar costos y márgenes)
- Listar Pedidos Pendientes (priorizar SKU y modelo)
- Verificar Ítems Físicos en Pasillo → extendido (`«extend»`) por *Registrar Discrepancia Física en Pasillo (producto dañado o faltante)*
- Actualizar Estado a "Listo para Despacho".

## 4 Tecnologías e infraestructura cloud

Para garantizar la disponibilidad, seguridad y rendimiento del Sistema de Gestión de Inventario (SGI Oregón), realizamos un análisis técnico y económico enfocado en elegir la base tecnológica ideal para Comercial Oregon SpA.

En primer lugar, evaluamos las tres principales plataformas de servicios en la nube del mercado:

- Amazon Web Services (AWS)
- Google Cloud Platform (GCP)
- Microsoft Azure
seleccionando AWS por su estabilidad, su perfecta integración con bases de datos relacionales y su costo accesible.

Asimismo, comparamos los diferentes stacks de desarrollo para optar por una arquitectura moderna y ligera basada en React (PWA) en el frontend, Node.js en el backend y PostgreSQL para asegurar la transaccionalidad estricta (ACID) del inventario, junto con una caché Redis (Redis Ltd., s. f.) que acelera la lectura de los KPI del dashboard.

Finalmente, dimensionamos los recursos cloud necesarios para soportar la operación concurrente de la empresa por un costo operativo estimado de aproximadamente $50.000 CLP mensuales (equivalente a unos 53 dólares), eliminando los problemas de planillas Excel descentralizadas y garantizando una operación fluida tanto en la oficina como en bodega y terreno

### 4.4 Dimensionamiento y costos operativos

**Tabla 8. Dimensionamiento y costos operativos mensuales en AWS**

| **Servicio AWS** | **Configuración Técnica** | **Función Principal en el SGI Oregón** | **Costo Mensual Aprox. (USD / CLP)** |
|---|---|---|---|
| Amazon EC2 | Instancia t3.small<br>(2 vCPU, 2 GB RAM) | Servidor de aplicaciones: Aloja la API REST (Node.js) y sirve la PWA (React). | US$ 25<br>(~$23.750 CLP) |
| Amazon RDS for PostgreSQL | Instancia<br>db.t4g.micro + 20 GB SSD | Base de datos relacional centralizada: Catálogo, stock, pedidos, compras y AuditLog. | US$ 23<br>(~$21.850 CLP) |
| Amazon S3 | Almacenamiento de objetos (~5 GB) | Resguardo de archivos Excel procesados, comprobantes PDF y respaldos exportados. | US$ 1<br>(~$950 CLP) |
| Caché Redis | En el mismo EC2 t3.small (límite de memoria ≈ 128 MB) | Caché de los KPI del dashboard (vigencia 30 s, PR-04). Sin servicio adicional. | US$ 0<br>(~$0 CLP) |
| Snapshots, Respaldos y Red | Copias automáticas y tráfico HTTPS | Política de respaldos y conectividad segura desde oficina, bodega y terreno. | US$ 4<br>(~$3.800 CLP) |
| TOTAL ESTIMADO | Infraestructura Cloud Producción | Soporta operación concurrente y almacenamiento seguro | US$ 53 / mes<br>(~$50.350 CLP) |

## 5 Diseño de interfaces de usuario (UI/UX)

### 5.1 Login con acceso por roles

#### Figura 12. Pantalla de inicio de sesión

**Mockup — Inicio de sesión.** Barra superior blanca con el logo y el título "Sistema de Gestión de **Inventario**" (la palabra Inventario en naranja). Fondo: fotografía de una bodega con estanterías y cajas (marcas Thomas, Gama, Ursus Trotter, Blank). Tarjeta blanca centrada:
- Título "Iniciar Sesión", subtítulo "Accede a tu cuenta de Comercial Oregón".
- Campo **Usuario** (placeholder "Ingrese su usuario") y campo **Contraseña** (placeholder "Ingrese su contraseña").
- ~~Selector "Seleccione su rol" con tres botones (Administrador, Bodega, Chofer)~~ — **ELIMINADO EN EL DESARROLLO** por retroalimentación del profesor: el rol se obtiene del usuario en la base de datos y define la interfaz a la que se redirige.
- Casilla "Recordar usuario" (opcional; si se implementa, solo recuerda el correo, nunca la contraseña ni el token).
- Botón naranja de ancho completo "Iniciar Sesión".
En el desarrollo, el campo "Usuario" corresponde al correo electrónico.

### 5.2 Panel del rol administrador

#### Figura 13. Panel del administrador: dashboard general y métricas

**Estilo visual común de los mockups (aproximado a partir de las capturas):** fondo de página gris muy claro `#F7FAFC`; barra lateral oscura azul marino `#0B172A` con texto gris azulado; color de acento/ítem activo naranja `#FF4400`; botones primarios oscuros `#202529` y botón de login naranja; tarjetas blancas con borde fino y esquinas redondeadas; insignias (badges) de estado en verde (éxito/abastecido), rojo (alerta/quiebre), amarillo (pendiente/en ruta), celeste (en picking); tipografía sans-serif; logo = bolsa de compras turquesa/naranja con la letra "ó". Paneles de oficina: barra lateral izquierda con 7 ítems (Dashboard General, Catálogo Maestro, Compras y Facturas, Carga Masiva, Pedidos y Despachos, Reportes y Auditoría, Usuarios y Roles), pie con nombre del rol ("Jefatura Administrativa") y enlace rojo "Salir del Sistema". Paneles de Bodega y Chofer: móvil, sin barra lateral; encabezado con logo y botón "Salir"; Bodega con barra de navegación inferior de 3 pestañas (Buscador, Pedidos, Despacho).

**Mockup — Panel del administrador: Dashboard General y Métricas.** Título "Dashboard General y Métricas", subtítulo "Supervisión integral de existencias, valorización contable y ventas del día." Arriba a la derecha, botón/insignia roja "2 Quiebres Detectados" (con campana).
- 4 tarjetas KPI: **Valorización inventario** `$28.450.900` (con "156 SKUs Activos" en verde); **Stock crítico** "2 Artículos" en rojo ("Requiere Reorden"); **Ventas del día** "48 Órdenes" en azul ("Multicanal (Mkt + Web)"); **Margen promedio** "34.8%" en verde ("Utilidad bruta estimada").
- Tabla "Productos más Vendidos y Estado de Reposición": columnas SKU, Producto, Marca, Ventas (Mes), Stock Actual, Estado. Filas de ejemplo: TH-4500 / Hervidor Eléctrico 1.7L / Thomas / 142 un. / 24 un. / insignia verde "Abastecido"; UT-FORNO / Horno Eléctrico 40L / Ursus Trotter / 89 un. / 3 un. / insignia roja "Quiebre Inminente".
(Cifras de ejemplo; los KPI reales se calculan desde la base y se cachean en Redis 30 s.)

#### Figura 14. Panel del administrador: catálogo maestro de productos

**Mockup — Panel del administrador: Catálogo Maestro de Productos.** Subtítulo "Identificación única con SKU inmutable, costos de adquisición y precios por canal." Botón oscuro "+ Crear Producto" arriba a la derecha. Tabla con columnas: **SKU** (enlace azul), **Descripción / Modelo**, **Marca**, **Ubicación**, **Costo Neto ($)** (en negrita), **Precio Web ($)**, **Precio Mayorista ($)**, **Stock Físico**, **Acción** (botón con ícono de lápiz = editar).
Filas de ejemplo: TH-4500 · Hervidor Eléctrico 1.7L · Thomas · Pasillo A - Estante 2 · $14.990 · $22.990 · $18.500 · 24 un.; UT-FORNO · Horno Eléctrico 40L · Ursus Trotter · Pasillo B - Estante 1 · $45.990 · $69.990 · $56.900 · 4 un.
Reglas: el SKU no se puede modificar después de creado; el costo solo lo ve el Administrador; los precios por canal (WEB, MAYORISTA y marketplaces) se editan desde esta misma pantalla (CU-03).

#### Figura 15. Panel del administrador: módulo de compras y recepción

**Mockup — Panel del administrador: Módulo de Compras y Recepción.** Subtítulo "Ingreso formal de mercadería contra Factura Electrónica SII, desglose multiproducto y archivo digital en PDF." Insignia roja arriba a la derecha "Factura Electrónica SII N° 54691".
**1. Cabecera del Documento Tributario (Proveedor):** R.U.T. Proveedor* (78.806.090-4), Razón Social Proveedor* (GAMA CHILE S.A.), N° Factura Electrónica* (54691), Fecha de Emisión (selector de fecha, 22-09-2026), Forma de Pago (lista; "Contado"). Botón "Adjuntar PDF" para subir el documento de factura (.pdf) con la leyenda "Permite archivar digitalmente la factura tributaria oficial para respaldo contable y auditorías CIA."
**2. Detalle de Ítems y Unidades Físicas Facturadas:** fila de captura con lista desplegable "Producto / Modelo" (ej. "GM-ELEGANCE ALISADOR ELEGANCE ST KERA"), "Cantidad" y "Precio Unitario Neto ($)" + botón oscuro "Añadir Ítem a Factura". Tabla de ítems con columnas SKU, Descripción del Producto, Marca (insignia), Cantidad, Precio Neto ($), Total Neto ($) y botón rojo "Quitar". Ejemplo: GM-ELEGANCE 1 un. $19.406; GM-KERATION 1 un. $26.465; GM-COCONUT 2 un. $15.876 (total $31.752); GM-INNOVA 2 un. $14.700 ($29.400); GM-566-29 2 un. $20.582 ($41.164); GM-GCXMASTER 1 un. $17.641.
Resumen: **Total unidades físicas 9 un.; Monto neto $165.828; I.V.A. (19%) $31.507; Total facturado $197.335.** Botón verde "Confirmar Ingreso y Actualizar Stock en Bodega" (una sola transacción: crea la recepción, el detalle, incrementa el stock físico y registra la auditoría).

#### Figura 16. Panel del administrador: importación masiva de ventas multicanal (HU04)

**Mockup — Panel del administrador: Importación Masiva de Ventas Multicanal (HU04).** Subtítulo "Carga planillas Excel (.xlsx) de Mercado Libre, Ripley, Paris o Mayoristas para rebajar stock en tiempo real." Botón "Descargar Plantilla Base (.xlsx)" arriba a la derecha. Zona central de arrastrar y soltar con ícono de Excel y el texto "Arrastre o seleccione el archivo .xlsx de ventas"; "Formatos compatibles: Mercado Libre, Paris, Ripley, Venta Directa Web y Mayorista"; "(Columnas: RUT CLIENTE, NOMBRE CLIENTE, SKU, NOMBRE PRODUCTO, CANTIDAD, PRECIO, MARCA)". Botones: "Obtener Formato Base" y "Simular Carga de Planilla" (la simulación valida y muestra el informe previo de inconsistencias fila por fila antes de confirmar, T19).

#### Figura 17. Panel del administrador: gestión de pedidos y despachos

**Mockup — Panel del administrador: Gestión de Pedidos y Despachos.** Subtítulo "Control del flujo: preparación en bodega y asignación a hoja de ruta para reparto." Tabla con columnas **N° Orden**, **Cliente / Destino**, **Canal**, **Ítems**, **Estado Operativo**, **Acción**.
Filas de ejemplo: `#ORD-1024` · Distribuidora Oriente SpA (Providencia) · Mayorista · 4 cajas (TH-4500) · insignia celeste "En Picking (Bodega)" · botón "Asignar Chofer"; `#ORD-1025` · Juan Pérez (Villarrica) · Mercado Libre · 1 bulto (UT-FORNO) · insignia amarilla "En Ruta (Chofer)" · botón "Ver Ruta".

#### Figura 18. Panel del administrador: reportes y bitácora de auditoría

**Mockup — Panel del administrador: Reportes y Bitácora de Auditoría (Audit Log).** Subtítulo "Cumplimiento de la Tríada CIA: trazabilidad inmutable de todas las acciones del sistema." Botones "Exportar Excel" (verde) y "Exportar PDF" (rojo). Tabla en tipografía monoespaciada con columnas **Fecha / Hora**, **Usuario**, **Rol**, **Acción Ejecutada**, **Módulo**, **IP Origen**.
Filas de ejemplo: `13/10/2026 14:22` · Susana Cortes · Administrador · "Importación masiva lote #201 (48 órdenes)" · Ventas · 192.168.1.15; `13/10/2026 13:10` · Operario Bodega 1 · Bodega · "Confirmación picking orden #ORD-1024" · Bodega · 192.168.1.42; `13/10/2026 11:05` · Conductor Reparto · Chofer · "Marcado de entrega exitosa orden #ORD-1020" · Ruta · 186.105.88.12.

#### Figura 19. Panel del administrador: administración de usuarios y roles

**Mockup — Panel del administrador: Administración de Usuarios y Roles.** Subtítulo "Gestión de accesos y restricción estricta de costos y márgenes al personal operativo." Botón oscuro "Crear Usuario" arriba a la derecha. Tabla con columnas **Nombre**, **Correo Electrónico**, **Rol Asignado** (insignia: Administrador oscura; Bodega y Chofer grises), **Acceso a Márgenes y Costos** ("Permitido (Total)" en verde / "Bloqueado / Oculto" en rojo), **Estado** (insignia verde "Activo").
Filas de ejemplo: Jefatura Administrativa · admin@tiendaoregon.cl · Administrador · Permitido (Total) · Activo; Juan Bodeguero · bodega@tiendaoregon.cl · Bodega · Bloqueado / Oculto · Activo; Carlos Chofer · chofer@tiendaoregon.cl · Chofer · Bloqueado / Oculto · Activo.

### 5.3 Panel del rol bodega

#### Figura 20. Panel de bodega: búsqueda rápida de pasillo y stock

**Mockup — Panel de Bodega (móvil): Búsqueda rápida de pasillo y stock.** Encabezado con logo "Tienda Oregón / Panel bodega" y botón rojo "Salir". Tarjeta "BÚSQUEDA RÁPIDA DE PASILLO Y STOCK" con un campo de búsqueda grande con ícono de lupa (placeholder "Escriba SKU o modelo...") y la leyenda "Búsqueda predictiva optimizada para celular (< 2 segundos)". Resultado como tarjeta con borde izquierdo amarillo: insignia oscura con el SKU (TH-4500), insignia verde "24 un. Físicas", nombre "Hervidor Eléctrico 1.7L", "Marca: **Thomas**", y un recuadro "UBICACIÓN EN BODEGA" con ícono de pin rojo y "**Pasillo A - Estante 2**". No muestra costos ni márgenes. Barra de navegación inferior oscura con 3 pestañas: **Buscador** (activa, naranja), **Pedidos**, **Despacho**.

#### Figura 21. Panel de bodega: pedidos pendientes de recolección

**Mockup — Panel de Bodega (móvil): Pedidos pendientes de recolección.** Título "Pedidos Pendientes", subtítulo "Toque una orden para desplegar los productos a recolectar", insignia oscura "2 Lotes Pendientes". Cada pedido es una tarjeta con borde de color según estado:
- Cabecera: insignia oscura `Orden #MKP-FAL-0810`, fecha (08/10/2026), "Cliente: FALABELLA", "Despacho Consolidado Marketplace", insignia amarilla "Pedido sin recolectar", insignia azul "2 productos en total" y enlace "Ver detalle" (despliega/colapsa).
- Al desplegar: **CAMBIAR ESTADO** con 4 botones tipo píldora: *Sin recolectar*, *Armado*, *Etiquetado*, *En camión* (el activo se resalta); botón "Descargar Etiquetas de este Pedido" (documentos de despacho). "Detalle de productos a recolectar (2 unidades)" con la leyenda "Marque al recolectar": cada ítem tiene casilla (checklist), insignia `SKU: TH-1870`, nombre "ASPIRADORA THOMAS TH-1870", "Ubicación: Pasillo B - Estante 2 | Cantidad: 1 un." y botón "Comentarios" (para registrar discrepancias: dañado/faltante); segundo ítem `SKU: TH-8832M` "BATIDORA THOMAS TH-8832M", Pasillo A - Estante 3, 1 un. Botón verde de ancho completo "Completar Recolección de Falabella".
- Segunda tarjeta visible parcialmente: `Orden #ORD-CEL-0510` con insignia celeste "Pedido armado".
Los 4 estados corresponden a PENDIENTE_PREPARACION → ARMADO → ETIQUETADO → EN_CAMION (ver Tabla de estados de la orden).

#### Figura 22. Panel de bodega: despacho y descarga de camión

**Mockup — Panel de Bodega (móvil): Despacho | Descarga de camión.** Título "Despacho | Descarga Camión", subtítulo "Conteo y verificación física de bultos contra guía de despacho o factura", insignia gris "Control de Entrada". Campo "Factura o Guía" (ejemplo "Factura 48920"). Sección "VERIFICACIÓN FÍSICA DE BULTOS" con la leyenda "Marque cada producto descargado conforme": una fila por ítem con casilla, insignia `SKU: TH-4500`, "Hervidor Thomas (TH-4500)" y cantidad "10 unidades"; `SKU: UT-FORNO`, "Horno Forno 40 (UT-FORNO)", "5 unidades". Botón oscuro de ancho completo "Confirmar Descarga Conforme". Pestaña inferior activa: **Despacho**.

### 5.4 Panel del rol chofer

#### Figura 23. Panel del chofer: ruta de reparto diaria

**Mockup — Panel del Chofer (móvil): Ruta de reparto diaria.** Encabezado con ícono de camión azul "Ruta de Reparto Diaria / Chofer: Distribución Terreno" y botón rojo "Salir". Franja gris "Sector Santiago: Providencia - Las Condes - Santiago Centro" con insignia "3 Paradas Pendientes". Una tarjeta por parada:
- Insignia oscura "Parada 1: Orden #1024" + insignia amarilla "Pendiente"; nombre del cliente (Distribuidora Oriente SpA); dirección con pin rojo (Av. Providencia 1251, Providencia, Santiago); teléfono (+56 9 8765 4321) y "Bultos: 4 cajas grandes".
- Botón azul claro de ancho completo "Abrir Mapa" (abre la navegación GPS).
- Dos botones: verde "Entregado" y rojo con borde "Rechazado" (el rechazo exige causal; ver HU07/T32).
- Parada 2: Orden #1025, Juan Pérez (Mercado Libre), Av. Apoquindo 4400, Las Condes, +56 9 1234 5678, 1 paquete (Microondas). Parada 3: Orden #1026, Constanza Morales (Paris.cl), Av. Libertador Bernardo O'Higgins 1449, Santiago Centro, +56 9 9876 1122, 2 paquetes.

## 6 Modelo de base de datos y gestión de datos

### 6.1 Bases de datos estructuradas (Relacionales SQL - PostgreSQL)

Toda la información transaccional del SGI (catálogo, inventario, precios, compras, ventas, despachos, usuarios y auditoría) se almacena en una base de datos relacional **PostgreSQL** alojada en **Amazon RDS** (instancia db.t4g.micro con 20 GB SSD y respaldos automáticos, según el dimensionamiento del plan de recursos). El problema levantado en Comercial Oregon (descuadres de inventario, compras sin respaldo fiscal y quiebres de stock detectados tarde) es, en el fondo, un problema de **integridad de datos**; por eso las reglas críticas del negocio no se dejaron solo en la aplicación, sino que se declararon dentro de la propia base mediante llaves, restricciones, triggers y transacciones ACID (Haerder & Reuter, 1983).

El modelo físico se implementó y se probó en PostgreSQL 16 (PostgreSQL Global Development Group, 2023). Consta de **12 tablas**, 7 funciones, **7 triggers**, 1 vista (v_stock_critico), **13 llaves foráneas**, **31 restricciones CHECK**, **10 reglas de unicidad** y **40 índices**. Se entrega como script reproducible (01_modelo_datos.sql y 02_datos_ejemplo.sql, que carga los datos reales del proyecto: TH-4500, UT-FORNO, factura N° 54691 de Gama Chile S.A. y las órdenes ORD-1024 y ORD-1025).

**Tabla 9. Requisitos del SGI y mecanismo de PostgreSQL que los resuelve**

| **Requisito del proyecto** | **Mecanismo en PostgreSQL** | **Referencia** |
|---|---|---|
| Rebaja atómica de stock al importar ventas y recepción de factura en un solo paso | Transacciones ACID (BEGIN / COMMIT / ROLLBACK) y UPDATE condicionado (WHERE stock_fisico >= cantidad) | HU03, HU04, PU-04, T16 |
| El stock físico nunca puede ser negativo | CHECK (stock_fisico >= 0) y CHECK (stock_reservado <= stock_fisico) | PU-05 |
| Conciliación de factura al peso: Neto + IVA = Total | CHECK ck_total_factura y NUMERIC (sin errores de redondeo de FLOAT) | PU-01 |
| Margen = (precio − costo) / precio × 100 y precio siempre mayor al costo | Trigger BEFORE INSERT/UPDATE sobre lista_precio; recálculo automático si cambia el costo | PU-02, PU-03, T11 |
| Una misma factura u orden no se registra dos veces | UNIQUE (rut_proveedor, numero_factura) y UNIQUE (canal_origen, codigo_externo) | HU03, HU04 |
| Permisos por rol y trazas de auditoría con estructura variable | Tipo JSONB con CHECK de estructura | HU08, CU-07 |
| Búsqueda predictiva en menos de 2 segundos | Índices B-tree y GIN con pg_trgm | HU06, PR-01 |
| Clave de acceso almacenada con bcrypt (cost ≥ 12) | Extensión pgcrypto (crypt / gen_salt('bf', 12)) | PU-06, PU-07, PU-08 |
| Bitácora de auditoría que nadie pueda alterar | Triggers que bloquean UPDATE, DELETE y TRUNCATE sobre audit_log | PR-06, PI-07 |
| Costo operativo bajo y respaldos administrados | Motor de código abierto sobre Amazon RDS (respaldos y parches automáticos) | Plan de costos |

#### 6.1.1 Criterios de diseño del modelo

- **Fidelidad al proyecto:** cada tabla proviene de una clase del Diagrama de Clases (vista lógica 4+1) y conserva sus nombres de atributos en snake_case; las pantallas (UI) y los casos de prueba aportaron los atributos adicionales.
- **Claves primarias:** el SKU es clave natural de producto, porque HU01 lo define como identificador único e inmutable del catálogo; el resto de las tablas usa clave subrogada autogenerada (IDENTITY).
- **Integridad referencial:** todas las llaves foráneas usan ON DELETE RESTRICT, de modo que no se puede borrar un producto o usuario con historial. Solo las composiciones (detalle_recepcion y detalle_venta respecto de su cabecera) usan ON DELETE CASCADE.
- **Tipos de datos:** montos y costos en NUMERIC (nunca FLOAT), fechas con zona horaria (TIMESTAMPTZ) y estados como texto restringido por CHECK, que es más simple de mantener que un tipo ENUM.
- **Baja lógica:** los productos se inactivan (estado) y los usuarios se desactivan (activo); no se eliminan, para conservar la trazabilidad.

#### 6.1.2 Reglas de integridad implementadas y su evidencia

Cada regla se verificó contra una base PostgreSQL real con un script de 39 pruebas (03_pruebas_integridad.sql). Varias reproducen los casos del plan de calidad (PU-01 a PU-08, PI-01, PI-02) directamente sobre la base de datos. Resultado: **39 de 39 pruebas aprobadas**.

**Tabla 10. Reglas de integridad probadas en la base de datos**

| **Regla de negocio** | **Mecanismo** | **Prueba** | **Resultado** |
|---|---|---|---|
| SKU único y normalizado en mayúsculas (HU01) | PRIMARY KEY + CHECK (sku = upper(btrim(sku))) | IN-01, IN-02 | Rechaza duplicado (23505) y minúsculas (23514) |
| El SKU no puede modificarse (CU-03) | Trigger trg_producto_sku_inmutable | IN-03 | Rechaza el cambio |
| RUT válido (usuarios, proveedor, cliente) | CHECK fn_rut_valido (módulo 11) | IN-04 | Rechaza RUT inválido |
| Correo único sin distinguir mayúsculas | UNIQUE INDEX sobre lower(email) | IN-05 | Rechaza duplicado |
| Sin registros huérfanos ni borrados con historial | FOREIGN KEY ... ON DELETE RESTRICT | IR-01, IR-02, IR-03 | Rechaza (23503) |
| Stock negativo imposible: 3 un. − 5 un. (PU-05) | CHECK + UPDATE condicionado | INV-01, INV-02 | Rechaza; 0 filas modificadas |
| Venta TH-4500: 24 − 4 = 20 un. (PU-04) | Transacción ACID | INV-03 | Stock final = 20 |
| Venta sin stock revierte la orden completa (T16) | ROLLBACK de la transacción | ACID-01 | 0 órdenes nuevas |
| Factura 54691 suma 9 unidades físicas (PI-01) | Transacción única de recepción | INV-04, INV-05 | GM-COCONUT = 2; total = 9 |
| Alerta de stock crítico: UT-FORNO 3 ≤ mínimo 5 (HU09) | Vista v_stock_critico | INV-06 | UT-FORNO figura en la vista |
| Margen TH-4500 Web 34.80 % y Mayorista 18.97 % (PU-02, PU-03) | Trigger fn_lista_precio_margen | FIN-01, FIN-02 | 34.80 y 18.97 |
| Cambio de costo 14.990 → 16.000 recalcula el margen (T11) | Trigger fn_producto_recalcular_margenes | FIN-09 | Margen Web = 30.40 |
| Precio de venta mayor al costo neto | Trigger fn_lista_precio_margen | FIN-03 | Rechaza (23514) |
| Factura 54691: Neto $165.828 + IVA $31.507 = Total $197.335 (PU-01) | CHECK ck_total_factura | FIN-04 a FIN-07 | Cuadra al peso; rechaza totales erróneos |
| La misma factura del mismo proveedor no se registra dos veces (HU03) | UNIQUE (rut_proveedor, numero_factura) | FIN-08 | Rechaza (23505) |
| La misma orden del mismo canal no se importa dos veces (HU04) | UNIQUE (canal_origen, codigo_externo) | VD-01 | Rechaza (23505) |
| Flujo de estados de la orden (no se puede pasar de EN_RUTA a ARMADO) | Trigger fn_orden_transicion | VD-02 | Rechaza transición inválida |
| Un rechazo de entrega exige causal (HU07) | CHECK ck_rechazo_con_causal | VD-03, VD-05 | Rechaza sin motivo; acepta con motivo |
| Solo un chofer activo puede asignarse a un despacho | Trigger fn_despacho_solo_chofer | VD-04 | Rechaza otros roles |
| audit_log inmutable | Triggers sobre UPDATE, DELETE y TRUNCATE | AUD-01, AUD-02, AUD-03 | Rechaza (42501) |
| La bitácora registra la geolocalización de la entrega (PI-04) con formato «latitud,longitud» | CHECK sobre audit_log.geolocalizacion | AUD-04, AUD-05 | Rechaza texto libre (23514); acepta -33.4263,-70.6155 |
| Clave con bcrypt cost 12; correcta valida, incorrecta no (PU-06 a PU-08) | pgcrypto: crypt() y gen_salt('bf', 12) | SEG-01, SEG-02, SEG-03 | Prefijo $2a$12$; true / false |
| Los intentos fallidos de login no pueden ser negativos (bloqueo de cuenta) | CHECK intentos_fallidos >= 0 | SEG-04 | Rechaza (23514) |

#### 6.1.3 Ejemplo: transacción de importación de ventas (HU04 / PI-02)

La importación del lote ventas_lote_201.xlsx se ejecuta en **una sola transacción**: si cualquier paso falla, no queda ninguna orden ni descuento de stock a medias. La rebaja usa un UPDATE condicionado, equivalente a rebajarDefinitivo() del diagrama de clases:

**Código 1
Transacción de importación de ventas (HU04 / PI-02)**
```sql
BEGIN;
  INSERT INTO lote_importacion (id_usuario, nombre_archivo, url_archivo_s3, ...)
  VALUES (<admin>, 'ventas_lote_201.xlsx', 'lotes/201/ventas_lote_201.xlsx', ...);
 
  INSERT INTO orden_venta (id_lote, codigo_externo, canal_origen, ...);    -- ORD-1024, ORD-1025
  INSERT INTO detalle_venta (id_orden, sku, cantidad_vendida, ...);        -- 4 x TH-4500, 1 x UT-FORNO
 
  UPDATE inventario i
     SET stock_fisico = i.stock_fisico - t.total          -- rebajarDefinitivo()
    FROM (SELECT sku, sum(cantidad_vendida) AS total FROM detalle_venta GROUP BY sku) t
   WHERE i.sku = t.sku AND i.stock_fisico >= t.total;      -- si no alcanza el stock, no modifica nada
 
  INSERT INTO audit_log (id_usuario, tabla_afectada, accion, ...) VALUES (...);
COMMIT;
```

### 6.2 Almacenamiento no estructurado / semiestructurado (JSONB en BD y objetos en Amazon S3)

El SGI es principalmente relacional, pero tres tipos de información no encajan bien en columnas simples: (a) listas de longitud variable, como los permisos de un rol; (b) fotografías de un registro antes y después de un cambio, cuya forma depende de la tabla auditada; y (c) archivos binarios, como el PDF de la factura, la planilla .xlsx importada o la evidencia de una entrega. Para ellos se definió un esquema híbrido: **JSONB dentro de PostgreSQL** para lo semiestructurado y **objetos en Amazon S3** para lo no estructurado, guardando en la base únicamente la clave del objeto.

**Tabla 11. Datos semiestructurados y no estructurados del SGI**

| **Dato** | **Estructura** | **Dónde se guarda** | **Motivo** |
|---|---|---|---|
| rol.permisos | Lista de textos «modulo:accion» (List<string> del diagrama de clases) | JSONB (arreglo) con CHECK jsonb_typeof = 'array' | Agregar o quitar un permiso no exige migrar el esquema; se consulta con los operadores ? y @> |
| audit_log.valores_anteriores audit_log.valores_nuevos | Objeto JSON con la instantánea del registro afectado | JSONB | Cada módulo audita campos distintos (factura, lote, despacho); una única tabla inmutable sirve a todos |
| recepcion_compra.url_pdf_factura | PDF de la factura electrónica del proveedor | Objeto en S3; la BD guarda solo la clave | Respaldo fiscal de la compra (HU03) |
| lote_importacion.url_archivo_s3 | Planilla .xlsx cargada (ej. ventas_lote_201.xlsx) | Objeto en S3; la BD guarda solo la clave | Trazabilidad de la carga y posibilidad de reprocesarla (HU04) |
| despacho.url_evidencia_s3 | Fotografía de respaldo de un rechazo de entrega (opcional) | Objeto en S3; la BD guarda solo la clave | Evidencia ante un reclamo (HU07; «Fotos de rechazo» en el diagrama de despliegue) |

#### 6.2.1 Alternativas evaluadas y decisión

Antes de fijar este esquema se compararon tres opciones de almacenamiento para el SGI. La elección se basa en los requisitos del proyecto: transacciones que tocan varias tablas a la vez (HU03, HU04), control de integridad de inventario y costos (PU-01, PU-05) y un presupuesto de infraestructura de una sola base de datos (US$ 53 mensuales).

**Tabla 12. Comparación de alternativas de almacenamiento**

| **Criterio** | **PostgreSQL + JSONB + S3 (seleccionada)** | **MongoDB (base documental)** | **Solo archivos en S3** |
|---|---|---|---|
| **Transacciones entre varias tablas (rebaja de stock + orden + auditoría)** | ACID nativo; ROLLBACK completo ante cualquier error (T16) | Soporta transacciones multidocumento, pero el modelo del SGI es relacional y la atomicidad se diseñaría alrededor de documentos | No aplica: no hay transacciones |
| **Integridad de datos (SKU único, stock ≥ 0, Neto + IVA = Total)** | PRIMARY KEY, FOREIGN KEY, CHECK y triggers dentro de la base | Validación en la aplicación o esquemas de documento; sin llaves foráneas | No aplica |
| **Consultas del negocio (margen, rotación, stock crítico, reportes)** | SQL con uniones e índices; vista v_stock_critico | Requiere agregaciones y referencias manuales entre colecciones | Inviable |
| **Datos de estructura variable (permisos, auditoría)** | JSONB con índices GIN y CHECK de estructura | Natural | Posible, pero sin consulta |
| **Archivos (PDF de facturas, planillas .xlsx, fotos)** | Se guardan en S3; la base conserva solo la clave | GridFS u objetos externos | Natural |
| **Costo y operación** | Una sola instancia Amazon RDS ya presupuestada, con respaldos administrados | Segundo motor: costo y operación fuera del presupuesto | Bajo, pero insuficiente por sí solo |

**Decisión.** Se mantiene un único motor relacional: lo semiestructurado se limita a tres columnas que JSONB resuelve, y los archivos se guardan en S3 (no como BYTEA en la base, para no inflar los respaldos ni los 20 GB de la instancia). S3 ofrece una durabilidad de 99.999999999 %, la cifra usada en la comparación de plataformas cloud, a un costo cercano a US$ 1 mensual para ~5 GB.

#### 6.2.2 Consultas de ejemplo sobre los datos del proyecto

Las siguientes consultas se ejecutaron sobre la base cargada con los datos del proyecto. La primera es la base técnica de PU-09 y PI-07: solo el rol Administrador posee el permiso costos:leer.

**Código 2
Consulta de permisos por rol sobre la columna JSONB**
```sql
SELECT nombre_rol, permisos ? 'costos:leer' AS ve_costos, jsonb_array_length(permisos) AS n_permisos
  FROM rol ORDER BY id_rol;
```

**Tabla 13. Resultado de la consulta de permisos por rol**

| **nombre_rol** | **ve_costos** | **n_permisos** |
|---|---|---|
| ADMINISTRADOR | true | 14 |
| BODEGA | false | 3 |
| CHOFER | false | 2 |

La segunda consulta lee la instantánea JSON que quedó en el AuditLog al recepcionar la factura N° 54691 (PI-01):

**Código 3
Consulta sobre la instantánea JSON de la bitácora**
```sql
SELECT valores_nuevos->>'numero_factura' AS factura, valores_nuevos->>'proveedor' AS proveedor,
       (valores_nuevos->>'unidades')::int AS unidades, valores_nuevos->>'monto_total' AS monto_total
  FROM audit_log WHERE accion = 'RECEPCIÓN';
```

**Tabla 14. Resultado de la consulta sobre la bitácora de recepciones**

| **factura** | **proveedor** | **unidades** | **monto_total** |
|---|---|---|---|
| 54691 | GAMA CHILE S.A. | 9 | 197335 |

No se creó un índice GIN sobre estas columnas JSONB porque rol tiene 3 filas y audit_log se consulta por fecha, usuario y tabla (ver estrategia de indexación). Si en el futuro se consulta audit_log por el contenido del JSON, se agrega un índice GIN con jsonb_path_ops.

#### 6.2.3 Reglas de gestión de los objetos en Amazon S3

- **Acceso privado:** el bucket bloquea todo acceso público; solo la API accede a él, a través del VPC endpoint de S3 definido en el diagrama de despliegue. Las descargas se entregan con URL prefirmadas de corta duración.
- **Convención de claves:** facturas/<RUT proveedor>_<N° factura>.pdf (ej. facturas/78806090-4_54691.pdf) y lotes/<N° de lote>/<archivo>.xlsx. La base guarda solo la clave, nunca una URL pública.
- **Protección de los datos:** cifrado en tránsito (TLS) y en reposo (cifrado del lado del servidor) y versionado activado para recuperar un archivo sobrescrito o eliminado por error.
- **Respaldos:** las instantáneas (snapshots) de la base de datos también se almacenan en S3, según el diagrama de despliegue y el plan de costos.
- **Conservación:** los comprobantes de compra se conservan durante el plazo legal tributario indicado en la sección «Auditoría inmutable y cumplimiento legal».

### 6.3 Diagrama Entidad-Relación (DER) / Modelo Relacional

El modelo físico contiene 12 tablas organizadas en cinco módulos, identificados por color: **Seguridad** (rol, usuario), **Catálogo e inventario** (producto, inventario, lista_precio), **Compras** (recepcion_compra, detalle_recepcion), **Ventas y despacho** (lote_importacion, orden_venta, detalle_venta, despacho) y **Auditoría** (audit_log). El diagrama se generó a partir del catálogo real de la base de datos, por lo que coincide con el script entregado.

Notación pata de gallo: ‖ = uno y solo uno; ○‖ = cero o uno; ○< = cero o muchos. PK = clave primaria, FK = clave foránea, NN = NOT NULL, UQ = UNIQUE.

#### Figura 24. Diagrama Entidad-Relación general (12 tablas y 13 relaciones)

**Diagrama Entidad-Relación general (12 tablas, 13 relaciones).** Módulos por color: *Seguridad y Auditoría* (rol, usuario, audit_log); *Catálogo e inventario* (producto, inventario, lista_precio); *Compras* (recepcion_compra, detalle_recepcion); *Ventas y despacho* (lote_importacion, orden_venta, detalle_venta, despacho). Eje central: `usuario` y `producto`. Todo el contenido de este diagrama está en forma de texto en las tablas de este documento: las 12 tablas y sus columnas en el **Diccionario de datos** (sección 6.4), las 13 llaves foráneas con cardinalidad y regla de borrado en la **tabla de relaciones** (sección 6.3) y el DDL real en `db/01_modelo_datos.sql`.

Por legibilidad, el detalle de atributos se presenta en tres figuras por módulo. Las tablas con borde punteado son referencias a otra figura.

#### Figura 25. DER detallado: módulo de Seguridad y Auditoría

**DER detallado — módulo Seguridad y Auditoría:** `rol` 1—1..* `usuario` (id_rol, RESTRICT); `usuario` 0..1—0..* `audit_log` (id_usuario nulo solo en intentos de login fallidos). Todo el contenido de este diagrama está en forma de texto en las tablas de este documento: las 12 tablas y sus columnas en el **Diccionario de datos** (sección 6.4), las 13 llaves foráneas con cardinalidad y regla de borrado en la **tabla de relaciones** (sección 6.3) y el DDL real en `db/01_modelo_datos.sql`.

#### Figura 26. DER detallado: módulos de Catálogo e inventario y Compras

**DER detallado — módulos Catálogo e inventario y Compras:** `producto` 1—1 `inventario` (UNIQUE sku); `producto` 1—1..* `lista_precio` (único por SKU y canal); `usuario` 1—0..* `recepcion_compra`; `recepcion_compra` 1—1..* `detalle_recepcion` (CASCADE); `producto` 1—0..* `detalle_recepcion`. Todo el contenido de este diagrama está en forma de texto en las tablas de este documento: las 12 tablas y sus columnas en el **Diccionario de datos** (sección 6.4), las 13 llaves foráneas con cardinalidad y regla de borrado en la **tabla de relaciones** (sección 6.3) y el DDL real en `db/01_modelo_datos.sql`.

#### Figura 27. DER detallado: módulo de Ventas y despacho

**DER detallado — módulo Ventas y despacho:** `usuario` 1—0..* `lote_importacion`; `lote_importacion` 1—0..* `orden_venta`; `orden_venta` 1—1..* `detalle_venta` (CASCADE); `producto` 1—0..* `detalle_venta`; `orden_venta` 1—0..1 `despacho` (UNIQUE id_orden); `usuario` (chofer) 1—0..* `despacho`. Todo el contenido de este diagrama está en forma de texto en las tablas de este documento: las 12 tablas y sus columnas en el **Diccionario de datos** (sección 6.4), las 13 llaves foráneas con cardinalidad y regla de borrado en la **tabla de relaciones** (sección 6.3) y el DDL real en `db/01_modelo_datos.sql`.

#### 6.3.1 Relaciones, cardinalidades e integridad referencial

**Tabla 15. Llaves foráneas del modelo**

| **N°** | **Llave foránea (hija → padre)** | **Cardinalidad** | **Al borrar** | **Significado en el negocio** |
|---|---|---|---|---|
| 1 | usuario.id_rol → rol | Rol 1 — 1..* Usuario | RESTRICT | El rol clasifica a los usuarios (HU08) |
| 2 | recepcion_compra.id_usuario → usuario | Usuario 1 — 0..* Recepción | RESTRICT | El usuario registra la recepción de una factura |
| 3 | detalle_recepcion.id_recepcion → recepcion_compra | Recepción 1 — 1..* Detalle | CASCADE | Composición: el detalle no existe sin su factura |
| 4 | detalle_recepcion.sku → producto | Producto 1 — 0..* Detalle | RESTRICT | Producto recibido en la factura |
| 5 | inventario.sku → producto | Producto 1 — 1 Inventario | RESTRICT | Cada producto controla su existencia (UNIQUE sku) |
| 6 | lista_precio.sku → producto | Producto 1 — 1..* Precio | RESTRICT | Precios por canal; máximo uno por SKU y canal |
| 7 | lote_importacion.id_usuario → usuario | Usuario 1 — 0..* Lote | RESTRICT | El administrador que cargó el archivo |
| 8 | orden_venta.id_lote → lote_importacion | Lote 1 — 0..* Orden | RESTRICT | Un lote .xlsx contiene varias órdenes |
| 9 | detalle_venta.id_orden → orden_venta | Orden 1 — 1..* Detalle | CASCADE | Composición: líneas de la orden |
| 10 | detalle_venta.sku → producto | Producto 1 — 0..* Detalle | RESTRICT | Producto vendido |
| 11 | despacho.id_orden → orden_venta | Orden 1 — 0..1 Despacho | RESTRICT | Una orden tiene a lo más un despacho (UNIQUE id_orden) |
| 12 | despacho.id_usuario_chofer → usuario | Usuario 1 — 0..* Despacho | RESTRICT | Chofer asignado a la entrega |
| 13 | audit_log.id_usuario → usuario | Usuario 0..1 — 0..* Evento | RESTRICT | Quien genera el evento; vacío solo en intentos de login fallidos |

#### 6.3.2 Correspondencia con el Diagrama de Clases (vista lógica)

El modelo físico es una extensión directa del Diagrama de Clases: cada clase es una tabla y se agregaron los atributos que las pantallas y los casos de prueba exigen (cabecera tributaria de la factura, bloqueo de cuenta por intentos fallidos, trazabilidad del archivo importado y datos de cierre de la entrega). El Diagrama de Clases de la vista lógica se actualizó para incluir la clase LoteImportacion.

**Tabla 16. De clase a tabla y atributos agregados en el modelo físico**

| **Clase (vista lógica)** | **Tabla** | **Atributos agregados en el modelo físico y motivo** |
|---|---|---|
| Rol | rol | Sin cambios. permisos (List<string>) se implementa como JSONB. |
| Usuario | usuario | + intentos_fallidos, bloqueado_hasta, ultimo_acceso, fecha_creacion: bloqueo temporal de la cuenta por intentos fallidos, según el plan de seguridad. Los métodos autenticar() y tienePermiso() residen en la API (componente Seguridad). |
| Producto | producto | + categoria (T05). |
| Inventario | inventario | Sin cambios. |
| ListaPrecio | lista_precio | Sin cambios. margen_porcentual lo calcula un trigger. |
| RecepcionCompra | recepcion_compra | + id_usuario (asociación «registra»), fecha_emision, forma_pago, url_pdf_factura, monto_neto, monto_iva, monto_total: cabecera tributaria de HU03 / CU-04. |
| DetalleRecepcion | detalle_recepcion | + precio_unitario_neto: costo unitario facturado, necesario para conciliar la factura (PU-01). |
| OrdenVenta | orden_venta | + id_lote (origen de la orden) y fecha_orden. |
| DetalleVenta | detalle_venta | Sin cambios. subtotal es una columna generada. |
| Despacho | despacho | + fecha_cierre y url_evidencia_s3 (cierre de la entrega, HU07). |
| AuditLog | audit_log | + geolocalizacion: coordenadas del dispositivo al cerrar una entrega, que exige PI-04 (se incorporó también al Diagrama de Clases). |
| LoteImportacion | lote_importacion | Clase incorporada al Diagrama de Clases: registra cada archivo .xlsx importado (nombre, clave S3, totales, usuario) para saber de qué archivo proviene cada orden (HU04, PI-02). |

#### 6.3.3 Estados de la orden de venta

El estado de una orden se guarda en orden_venta.estado_orden y un trigger impide saltos inválidos (por ejemplo, de EN_RUTA a ARMADO). Los cuatro estados de bodega son reversibles, como exige el checklist de picking de HU05.

**Tabla 17. Estados de la orden: etiqueta de la interfaz y valor en la base**

| **Etiqueta en la interfaz** | **Valor en la BD** | **Lo cambia** | **Transición permitida** |
|---|---|---|---|
| Sin recolectar | PENDIENTE_PREPARACION | Bodega | Entre los 4 estados de bodega (reversibles) |
| Armado | ARMADO | Bodega | Entre los 4 estados de bodega (reversibles) |
| Etiquetado | ETIQUETADO | Bodega | Entre los 4 estados de bodega (reversibles) |
| En camión | EN_CAMION | Bodega | Hacia EN_RUTA, al asignar chofer |
| En ruta | EN_RUTA | Administrador (asigna chofer) | Hacia ENTREGADO o RECHAZADO |
| Entregado | ENTREGADO | Chofer | Estado final |
| Rechazado / En devolución | RECHAZADO | Chofer (con causal obligatoria) | Estado final |

#### 6.3.4 Modelo relacional

La Figura 28 presenta el modelo relacional completo (Codd, 1970): cada recuadro es una tabla con todas sus columnas y tipos de datos, y cada flecha es una llave foránea que va desde la tabla hija (columna FK) hacia la clave primaria (PK) de la tabla padre. Los números junto a las flechas indican la cardinalidad (1 = una fila padre; N = muchas filas hijas) y el color identifica el módulo. Las 13 uniones coinciden con la Tabla 15.

#### Figura 28. Modelo relacional del SGI Oregón: 12 tablas, claves y uniones por llave foránea

**Modelo relacional completo:** cada recuadro es una tabla con todas sus columnas y tipos; cada flecha es una llave foránea de la tabla hija hacia la clave primaria del padre, con cardinalidad (1 / N). Colores por módulo como en el DER general. Todo el contenido de este diagrama está en forma de texto en las tablas de este documento: las 12 tablas y sus columnas en el **Diccionario de datos** (sección 6.4), las 13 llaves foráneas con cardinalidad y regla de borrado en la **tabla de relaciones** (sección 6.3) y el DDL real en `db/01_modelo_datos.sql`.

El modelo cumple la tercera forma normal. Las únicas columnas derivadas que se almacenan a propósito son margen_porcentual y subtotal, porque los KPI del dashboard (margen promedio) las leen con frecuencia; se mantienen coherentes con un trigger y con una columna generada, respectivamente.

**Alcance deliberado.** Siguiendo el diagrama de clases, el proveedor y el cliente se registran dentro de recepcion_compra y orden_venta (RUT y nombre) y no como tablas maestras. Si el negocio requiere un maestro de proveedores o clientes, se extrae sin alterar el resto del modelo.

### 6.4 Diccionario de datos

El diccionario describe las 12 tablas con sus atributos, tipos de datos, llaves y restricciones. Convenciones: **PK** clave primaria, **FK** clave foránea (con la tabla que referencia), **UQ** valor único, **Nulo = No** equivale a NOT NULL. Los tipos corresponden a PostgreSQL; las restricciones CHECK y los triggers se describen en la última columna y están implementados en 01_modelo_datos.sql.

**Tabla 18. rol — Una fila por perfil de la aplicación (RBAC).**

| **Atributo** | **Tipo** | **Clave** | **Nulo** | **Restricciones y descripción** |
|---|---|---|---|---|
| **id_rol** | SMALLINT | PK | No | Identificador del rol (autogenerado). |
| **nombre_rol** | VARCHAR(20) | UQ | No | ADMINISTRADOR, BODEGA o CHOFER. UNIQUE; CHECK en mayúsculas. |
| **descripcion** | VARCHAR(200) |  | No | Descripción del perfil y de su alcance. |
| **permisos** | JSONB |  | No | Lista JSONB de permisos «modulo:accion». CHECK: debe ser un arreglo. Por defecto []. |

**Tabla 19. usuario — Cuentas de acceso. Índice único sobre lower(email).**

| **Atributo** | **Tipo** | **Clave** | **Nulo** | **Restricciones y descripción** |
|---|---|---|---|---|
| **id_usuario** | INTEGER | PK | No | Identificador del usuario (autogenerado). |
| **rut** | VARCHAR(12) | UQ | No | RUT con puntos y guion (11.111.111-1). UNIQUE; CHECK módulo 11. |
| **nombre_completo** | VARCHAR(120) |  | No | Nombre y apellido del usuario. |
| **email** | VARCHAR(120) |  | No | Correo de acceso. CHECK de formato; UNIQUE sin distinguir mayúsculas. |
| **password_hash** | VARCHAR(100) |  | No | Hash bcrypt con sal (cost ≥ 12). Nunca se guarda la clave en texto plano (PU-06). |
| **id_rol** | SMALLINT | FK → rol | No | Rol asignado. ON DELETE RESTRICT. |
| **activo** | BOOLEAN |  | No | TRUE = puede iniciar sesión. Baja lógica en lugar de borrado. Por defecto TRUE. |
| **intentos_fallidos** | SMALLINT |  | No | Intentos de login fallidos consecutivos. CHECK ≥ 0; por defecto 0. Se reinicia con un acceso exitoso. |
| **bloqueado_hasta** | TIMESTAMPTZ |  | Sí | Fecha y hora hasta la que la cuenta está bloqueada; NULL = sin bloqueo. |
| **ultimo_acceso** | TIMESTAMPTZ |  | Sí | Fecha y hora del último inicio de sesión exitoso. |
| **fecha_creacion** | TIMESTAMPTZ |  | No | Fecha y hora de alta de la cuenta. Por defecto now(). |

**Tabla 20. producto — Catálogo maestro (HU01, HU02). Trigger: SKU inmutable; al cambiar el costo se recalculan los márgenes.**

| **Atributo** | **Tipo** | **Clave** | **Nulo** | **Restricciones y descripción** |
|---|---|---|---|---|
| **sku** | VARCHAR(30) | PK | No | Código único del producto (clave natural). CHECK en mayúsculas y sin espacios; inmutable por trigger (CU-03). |
| **modelo** | VARCHAR(60) |  | No | Modelo comercial (ej. TH-4500). |
| **nombre** | VARCHAR(150) |  | No | Nombre del producto (ej. Hervidor Eléctrico 1.7L). |
| **marca** | VARCHAR(60) |  | No | Marca (ej. Thomas, Ursus Trotter, GAMA). |
| **descripcion** | TEXT |  | Sí | Descripción libre. Opcional. |
| **categoria** | VARCHAR(60) |  | Sí | Categoría del catálogo (T05). Opcional. |
| **costo_adquisicion_neto** | NUMERIC(12,2) |  | No | Costo neto de compra en CLP. CHECK ≥ 0. Dato reservado al Administrador. |
| **stock_minimo** | INTEGER |  | No | Umbral de stock crítico (HU09). CHECK ≥ 0; por defecto 0. |
| **estado** | VARCHAR(10) |  | No | ACTIVO o INACTIVO (inactivar() en vez de borrar). Por defecto ACTIVO. |

**Tabla 21. inventario — Existencias por SKU (HU05, HU09). CHECK ck_reservado_menor_fisico: stock_reservado ≤ stock_fisico.**

| **Atributo** | **Tipo** | **Clave** | **Nulo** | **Restricciones y descripción** |
|---|---|---|---|---|
| **id_inventario** | INTEGER | PK | No | Identificador del registro de existencias. |
| **sku** | VARCHAR(30) | FK → producto, UQ | No | Producto al que pertenece. UNIQUE: un registro por producto (relación 1 a 1). |
| **stock_fisico** | INTEGER |  | No | Unidades físicas en bodega. CHECK ≥ 0: nunca negativo (PU-05). |
| **stock_reservado** | INTEGER |  | No | Unidades comprometidas. CHECK ≥ 0 y ≤ stock_fisico. |
| **ubicacion_bodega** | VARCHAR(40) |  | Sí | Ubicación física (ej. Pasillo A - Estante 2). Opcional. |

**Tabla 22. lista_precio — Tarifas por canal. UNIQUE ux_lista_sku_canal (sku, canal_venta).**

| **Atributo** | **Tipo** | **Clave** | **Nulo** | **Restricciones y descripción** |
|---|---|---|---|---|
| **id_lista** | INTEGER | PK | No | Identificador de la tarifa. |
| **sku** | VARCHAR(30) | FK → producto | No | Producto tarificado. |
| **canal_venta** | VARCHAR(15) |  | No | WEB, MARKETPLACE o MAYORISTA (CHECK). UNIQUE junto con sku. |
| **precio_venta_neto** | NUMERIC(12,2) |  | No | Precio neto de venta. CHECK > 0 y, por trigger, mayor al costo del SKU. |
| **margen_porcentual** | NUMERIC(6,2) |  | Sí | (precio − costo) / precio × 100. Lo calcula un trigger (PU-02, PU-03) y se recalcula si cambia el costo. |

**Tabla 23. recepcion_compra — Cabecera de la factura (HU03). UNIQUE ux_factura_proveedor (rut_proveedor, numero_factura); CHECK ck_total_factura.**

| **Atributo** | **Tipo** | **Clave** | **Nulo** | **Restricciones y descripción** |
|---|---|---|---|---|
| **id_recepcion** | INTEGER | PK | No | Identificador de la recepción. |
| **id_usuario** | INTEGER | FK → usuario | No | Usuario que registra la recepción. |
| **numero_factura** | VARCHAR(20) |  | No | N° de la factura electrónica del proveedor. UNIQUE junto con rut_proveedor. |
| **rut_proveedor** | VARCHAR(12) |  | No | RUT del proveedor. CHECK módulo 11. |
| **nombre_proveedor** | VARCHAR(120) |  | No | Razón social del proveedor. |
| **fecha_emision** | DATE |  | No | Fecha de emisión de la factura. |
| **fecha_recepcion** | TIMESTAMPTZ |  | No | Fecha y hora de ingreso a bodega. Por defecto now(). |
| **forma_pago** | VARCHAR(30) |  | No | Forma de pago indicada en la factura (ej. Contado). |
| **url_pdf_factura** | TEXT |  | Sí | Clave del PDF de la factura en Amazon S3. Opcional. |
| **monto_neto** | NUMERIC(14,2) |  | No | Subtotal neto. CHECK ≥ 0. |
| **monto_iva** | NUMERIC(14,2) |  | No | IVA 19 %. CHECK ≥ 0. |
| **monto_total** | NUMERIC(14,2) |  | No | Total facturado. CHECK: monto_total = monto_neto + monto_iva. |
| **estado_documento** | VARCHAR(20) |  | No | CONFORME o CON_DISCREPANCIA. Por defecto CONFORME. |

**Tabla 24. detalle_recepcion — Líneas de la factura. UNIQUE ux_detrec_recepcion_sku (id_recepcion, sku).**

| **Atributo** | **Tipo** | **Clave** | **Nulo** | **Restricciones y descripción** |
|---|---|---|---|---|
| **id_detalle_rec** | INTEGER | PK | No | Identificador de la línea. |
| **id_recepcion** | INTEGER | FK → recepcion_compra | No | Factura a la que pertenece. ON DELETE CASCADE (composición). |
| **sku** | VARCHAR(30) | FK → producto | No | Producto recibido. |
| **cantidad_recibida** | INTEGER |  | No | Unidades recibidas. CHECK > 0. |
| **precio_unitario_neto** | NUMERIC(12,2) |  | No | Costo neto unitario facturado. CHECK ≥ 0. |
| **observaciones_dano** | VARCHAR(300) |  | Sí | Observación de bultos dañados. Opcional. |

**Tabla 25. lote_importacion — Un registro por planilla .xlsx cargada (HU04).**

| **Atributo** | **Tipo** | **Clave** | **Nulo** | **Restricciones y descripción** |
|---|---|---|---|---|
| **id_lote** | INTEGER | PK | No | Identificador del lote importado. |
| **id_usuario** | INTEGER | FK → usuario | No | Usuario que cargó el archivo. |
| **nombre_archivo** | VARCHAR(150) |  | No | Nombre del archivo .xlsx (ej. ventas_lote_201.xlsx). |
| **url_archivo_s3** | TEXT |  | No | Clave del archivo en Amazon S3. |
| **fecha_carga** | TIMESTAMPTZ |  | No | Fecha y hora de la carga. Por defecto now(). |
| **total_ordenes** | INTEGER |  | No | Órdenes contenidas en el archivo. CHECK ≥ 0. |
| **total_lineas** | INTEGER |  | No | Líneas de detalle del archivo. CHECK ≥ 0. |

**Tabla 26. orden_venta — Pedido multicanal (HU04, HU05). UNIQUE ux_orden_canal_codigo (canal_origen, codigo_externo). Trigger de transición de estados.**

| **Atributo** | **Tipo** | **Clave** | **Nulo** | **Restricciones y descripción** |
|---|---|---|---|---|
| **id_orden** | INTEGER | PK | No | Identificador interno de la orden. |
| **id_lote** | INTEGER | FK → lote_importacion | No | Lote de importación del que proviene. |
| **codigo_externo** | VARCHAR(40) |  | No | Código en el canal (ej. ORD-1024). UNIQUE junto con canal_origen: evita rebajar stock dos veces. |
| **canal_origen** | VARCHAR(30) |  | No | Canal de venta (Mercado Libre, Paris, Ripley, Mayorista, Venta Directa Web). |
| **fecha_orden** | TIMESTAMPTZ |  | No | Fecha y hora de la orden. Por defecto now(). |
| **rut_cliente** | VARCHAR(12) |  | Sí | RUT del cliente. Opcional; si existe, CHECK módulo 11. |
| **nombre_cliente** | VARCHAR(120) |  | No | Nombre o razón social del cliente. |
| **direccion_despacho** | VARCHAR(200) |  | Sí | Dirección de entrega. Opcional. |
| **comuna** | VARCHAR(60) |  | Sí | Comuna de entrega. Opcional. |
| **telefono_contacto** | VARCHAR(20) |  | Sí | Teléfono de contacto. Opcional. |
| **estado_orden** | VARCHAR(25) |  | No | PENDIENTE_PREPARACION, ARMADO, ETIQUETADO, EN_CAMION, EN_RUTA, ENTREGADO o RECHAZADO. Transiciones controladas por trigger. |
| **numero_documento_sii** | VARCHAR(20) |  | Sí | N° de boleta o factura asociada (T30). Opcional. |

**Tabla 27. detalle_venta — Líneas de la orden. UNIQUE ux_detventa_orden_sku (id_orden, sku).**

| **Atributo** | **Tipo** | **Clave** | **Nulo** | **Restricciones y descripción** |
|---|---|---|---|---|
| **id_detalle_vta** | INTEGER | PK | No | Identificador de la línea. |
| **id_orden** | INTEGER | FK → orden_venta | No | Orden a la que pertenece. ON DELETE CASCADE (composición). |
| **sku** | VARCHAR(30) | FK → producto | No | Producto vendido. |
| **cantidad_vendida** | INTEGER |  | No | Unidades vendidas. CHECK > 0. |
| **precio_unitario** | NUMERIC(12,2) |  | No | Precio neto unitario cobrado. CHECK ≥ 0. |
| **subtotal** | NUMERIC(14,2) |  | Sí | Columna generada: cantidad_vendida × precio_unitario. |

**Tabla 28. despacho — Entrega a cargo de un chofer (HU07). CHECK ck_rechazo_con_causal y ck_cierre_coherente.**

| **Atributo** | **Tipo** | **Clave** | **Nulo** | **Restricciones y descripción** |
|---|---|---|---|---|
| **id_despacho** | INTEGER | PK | No | Identificador del despacho. |
| **id_orden** | INTEGER | FK → orden_venta, UQ | No | Orden despachada. UNIQUE: a lo más un despacho por orden. |
| **id_usuario_chofer** | INTEGER | FK → usuario | No | Chofer asignado. Trigger: solo usuarios activos con rol CHOFER. |
| **fecha_asignacion** | DATE |  | No | Fecha de asignación. Por defecto la fecha actual. |
| **estado_entrega** | VARCHAR(10) |  | No | PENDIENTE, ENTREGADO o RECHAZADO. Por defecto PENDIENTE. |
| **motivo_rechazo** | VARCHAR(300) |  | Sí | Causal del rechazo. Obligatorio si estado_entrega = RECHAZADO. |
| **fecha_cierre** | TIMESTAMPTZ |  | Sí | NULL mientras esté PENDIENTE; obligatoria al cerrar (ck_cierre_coherente). |
| **url_evidencia_s3** | TEXT |  | Sí | Clave en S3 de la constancia de cierre. Opcional. |

**Tabla 29. audit_log — Bitácora inmutable: triggers bloquean UPDATE, DELETE y TRUNCATE (SQLSTATE 42501).**

| **Atributo** | **Tipo** | **Clave** | **Nulo** | **Restricciones y descripción** |
|---|---|---|---|---|
| **id_log** | BIGINT | PK | No | Identificador del evento (BIGINT autogenerado). |
| **id_usuario** | INTEGER | FK → usuario | Sí | Usuario autor del evento. NULL solo en intentos de login fallidos sin usuario identificado. |
| **tabla_afectada** | VARCHAR(40) |  | No | Tabla sobre la que se actúa (ej. recepcion_compra). |
| **accion** | VARCHAR(30) |  | No | Tipo de evento (IMPORTACIÓN, RECEPCIÓN, ENTREGA, ...). |
| **valores_anteriores** | JSONB |  | Sí | Instantánea JSONB antes del cambio. Opcional. |
| **valores_nuevos** | JSONB |  | Sí | Instantánea JSONB después del cambio. Opcional. |
| **ip_origen** | INET |  | No | Dirección IP del cliente (tipo INET). |
| **geolocalizacion** | VARCHAR(40) |  | Sí | Coordenadas «latitud,longitud» del dispositivo al registrar una entrega o rechazo (PI-04). CHECK de formato. Opcional. |
| **fecha_hora** | TIMESTAMPTZ |  | No | Fecha y hora del evento. Por defecto now(). |

### 6.5 Estrategia de indexación y rendimiento para búsquedas rápidas

PostgreSQL crea automáticamente un índice para cada clave primaria (12) y no lo hace para las llaves foráneas; por eso se indexaron explícitamente las columnas de unión. Además se diseñaron índices específicos para las consultas críticas del proyecto: **búsqueda predictiva en bodega en menos de 2 segundos (HU06, PR-01)**, la lista de pedidos por preparar (HU05), la rotación de productos (HU10), el login (CU-01) y la bitácora de auditoría (PR-06, PR-07). En total el modelo tiene 40 índices: 12 de clave primaria y los 28 siguientes.

**Tabla 30. Índices del modelo (excluye claves primarias)**

| **Índice** | **Tabla (columnas)** | **Tipo** | **Consulta o requisito que sirve** |
|---|---|---|---|
| ix_audit_fecha | audit_log (fecha_hora DESC) | B-tree | Bitácora cronológica: últimos eventos y exportes por rango (PR-07) |
| ix_audit_tabla_accion | audit_log (tabla_afectada, accion) | B-tree | Auditoría por módulo y tipo de acción |
| ix_audit_usuario_fecha | audit_log (id_usuario, fecha_hora DESC) | B-tree | Auditoría por usuario ordenada por fecha |
| despacho_id_orden_key | despacho (id_orden) | B-tree único | Una orden, a lo más un despacho |
| ix_despacho_chofer_estado | despacho (id_usuario_chofer, estado_entrega) | B-tree | Ruta diaria del chofer: paradas pendientes (HU07) |
| ix_detrec_sku | detalle_recepcion (sku) | B-tree | Historial de compras por SKU; llave foránea |
| ux_detrec_recepcion_sku | detalle_recepcion (id_recepcion, sku) | B-tree único | Un SKU por factura; carga del detalle de una factura |
| ix_detventa_sku | detalle_venta (sku) | B-tree | Rotación por SKU (HU10); llave foránea |
| ux_detventa_orden_sku | detalle_venta (id_orden, sku) | B-tree único | Un SKU por orden; carga del detalle de una orden |
| inventario_sku_key | inventario (sku) | B-tree único | Relación 1 a 1 y unión rápida producto-inventario |
| ux_lista_sku_canal | lista_precio (sku, canal_venta) | B-tree único | Una tarifa por SKU y canal; consulta de precios |
| ix_lote_fecha | lote_importacion (fecha_carga) | B-tree | Historial de cargas por fecha |
| ix_lote_usuario | lote_importacion (id_usuario) | B-tree | Llave foránea; lotes por usuario |
| ix_orden_estado_fecha | orden_venta (estado_orden, fecha_orden DESC) | B-tree | Filtro por estado ordenado por fecha (pedidos y despachos) |
| ix_orden_fecha | orden_venta (fecha_orden) | B-tree | Ventas del día / del mes (KPI y reportes HU10) |
| ix_orden_lote | orden_venta (id_lote) | B-tree | Órdenes de un lote; llave foránea |
| ix_orden_pendientes | orden_venta (fecha_orden)) | B-tree parcial | Índice parcial: solo órdenes por preparar (lista de picking, HU05) |
| ux_orden_canal_codigo | orden_venta (canal_origen, codigo_externo) | B-tree único | Evita importar dos veces la misma orden (HU04) |
| ix_producto_modelo_trgm | producto (modelo gin_trgm_ops) | GIN | Búsqueda por fragmento de modelo en HU06 (ILIKE '%fragmento%') |
| ix_producto_nombre_trgm | producto (nombre gin_trgm_ops) | GIN | Búsqueda por fragmento de nombre en HU06 |
| ix_producto_sku_prefijo | producto (sku varchar_pattern_ops) | B-tree | Búsqueda predictiva por prefijo de SKU (LIKE 'TH-%') en HU06 |
| ix_recepcion_fecha | recepcion_compra (fecha_recepcion) | B-tree | Compras por rango de fechas (reportes) |
| ix_recepcion_usuario | recepcion_compra (id_usuario) | B-tree | Llave foránea; recepciones por usuario |
| ux_factura_proveedor | recepcion_compra (rut_proveedor, numero_factura) | B-tree único | Evita facturas duplicadas (HU03) |
| rol_nombre_rol_key | rol (nombre_rol) | B-tree único | Unicidad del nombre de rol |
| ix_usuario_rol | usuario (id_rol) | B-tree | Listar usuarios por rol; llave foránea |
| usuario_rut_key | usuario (rut) | B-tree único | Unicidad de RUT; búsqueda por RUT |
| ux_usuario_email_lower | usuario (lower((email))) | B-tree único | Login por correo sin distinguir mayúsculas (CU-01) |

Dos decisiones merecen explicación. Primero, la búsqueda por fragmento (ILIKE '%c4c%') no puede usar un B-tree; se resolvió con índices **GIN con trigramas (pg_trgm)** sobre modelo y nombre. Segundo, en audit_log se descartó un índice BRIN: con la tabla crecida respondía la consulta «últimos 50 eventos» en 55 ms con un recorrido secuencial paralelo, mientras que el B-tree descendente ix_audit_fecha la resuelve en 0.048 ms.

#### 6.5.1 Evidencia de rendimiento (EXPLAIN ANALYZE)

Las consultas se midieron con EXPLAIN ANALYZE sobre una base de prueba con datos sintéticos generados solo para medir: **5.000 productos, 100.000 órdenes, 299.940 líneas de venta y 320.000 eventos de auditoría** (PostgreSQL 16 local). Los tiempos absolutos en una instancia RDS db.t4g.micro serán mayores, pero los planes de ejecución (uso de índices) se mantienen; la validación final con usuarios concurrentes corresponde a las pruebas PR-01 a PR-06 del plan de calidad.

**Tabla 31. Tiempos de ejecución de las consultas críticas**

| **Consulta** | **Requisito** | **Plan de ejecución** | **Tiempo** |
|---|---|---|---|
| Búsqueda exacta por SKU (SKU-02500) | HU06 / PR-01 | Index Scan sobre producto e inventario | 0.142 ms |
| Predictiva por prefijo de SKU (SKU-025%) | HU06 / PR-01 | Index Scan + Merge Join, LIMIT 10 | 1.576 ms |
| Predictiva por fragmento de modelo o nombre ('%c4c%') | HU06 / PR-01 | BitmapOr de índices B-tree y GIN trigrama | 0.280 ms (sin índices: 7.984 ms, 28 veces más) |
| Pedidos por preparar (1.000 filas) | HU05 | Bitmap Index Scan sobre ix_orden_pendientes | 3.286 ms |
| Unidades vendidas por SKU en 30 días (top 10) | HU10 | Hash Join + agregación paralela | 43.791 ms |
| Últimos 50 eventos de auditoría | AuditLog | Index Scan sobre ix_audit_fecha | 0.048 ms |
| Exportación de auditoría de 2 días (1.439 filas) | PR-07 | Index Only Scan sobre ix_audit_fecha | 0.306 ms |

Todas las búsquedas de bodega responden en menos de 2 ms, muy por debajo del SLA de 2 segundos del plan de calidad. La consulta de rotación (HU10) es la más costosa porque agrega casi 300.000 líneas; con 43.8 ms es aceptable para un reporte y, si el volumen crece, puede materializarse en una vista o tabla resumen.

#### 6.5.2 Concurrencia y escritura

**Tabla 32. Prueba de concurrencia: 20 clientes simultáneos venden 1 unidad de un SKU con 50 en stock (200 intentos)**

| **Método** | **Ventas registradas** | **Stock final** | **Resultado** |
|---|---|---|---|
| Ingenuo: leer stock, decidir y escribir sin protección | 200 | 40 | **Sobreventa:** 200 ventas con solo 50 unidades; actualizaciones perdidas |
| Seguro: UPDATE condicionado en una sola sentencia (el método del informe) | 50 | 0 | **Correcto:** 50 ventas, 150 rechazadas con StockInsuficienteException; sin stock negativo |

La prueba sustenta con evidencia la condición «cero condiciones de carrera» de PR-03 y la regla PU-05. Para la bitácora (PR-06) se midió la inserción en audit_log con **10 conexiones simultáneas y 320.000 eventos ya almacenados: 1.016 ms de latencia promedio y 9.841 inserciones por segundo**, frente a la meta de menos de 50 ms por registro y 1.000 registros por minuto (unos 17 por segundo). El costo de mantener los índices sobre las escrituras es, por tanto, despreciable para el volumen del negocio.

**Particionamiento:** no se justifica hoy (la tabla de mayor crecimiento, audit_log, con 320.000 filas ocupa 71 MB y responde en menos de 1 ms). Si superara decenas de millones de filas, se particionaría por rango de fecha_hora y se archivarían los períodos antiguos en S3. El mantenimiento de estadísticas y el vacuum quedan a cargo de los procesos automáticos de Amazon RDS.

## 7 Plan de seguridad y control de accesos

### 7.1 Políticas de autenticación y autorización

El problema central que levantó Comercial Oregon en materia de seguridad es la **exposición de costos y márgenes** a personas que no deben verlos, junto con la falta de trazabilidad de quién hizo qué. Por ello la política de acceso del SGI se apoya en tres principios: **identificación segura** de cada persona (HU08), **privilegios mínimos** por perfil (Administrador, Bodega y Chofer) y **denegación por defecto**: lo que un rol no tiene permitido expresamente, se le niega. Todas las reglas se validan en el servidor; la interfaz solo las refleja.

#### 7.1.1 Políticas de autenticación

**Tabla 33. Políticas de autenticación del SGI**

| **Política** | **Regla definida** | **Fuente en el proyecto** |
|---|---|---|
| **Identificación** | Cada persona tiene una cuenta única, identificada por su correo (único sin distinguir mayúsculas) y su RUT (validado con módulo 11). Solo las cuentas activas pueden iniciar sesión; las bajas son lógicas (usuario.activo). | CU-01, HU08, modelo de datos |
| **Almacenamiento de claves** | Hash bcrypt (Provos & Mazières, 1999) con sal aleatoria y factor de costo ≥ 12. La clave nunca se guarda, se registra ni se devuelve en texto plano. | PU-06; pruebas SEG-01 a SEG-03 |
| **Verificación de la clave** | Comparación contra el hash en tiempo constante, para evitar ataques de temporización (timing attacks). | PU-07 |
| **Mensaje de error único** | Ante usuario o clave incorrectos se responde lo mismo, sin indicar cuál falló (anti-enumeración de usuarios). | PU-08 |
| **Sesión** | Tras el login se emite un token JWT firmado (Jones et al., 2015), enviado únicamente por HTTPS (TLS 1.3; Rescorla, 2018). La API valida firma y vencimiento en cada petición. Las sesiones inactivas expiran; el tiempo de inactividad es un parámetro configurable que se acuerda con la Jefatura. | T02, diagrama de componentes y de despliegue |
| **Rol efectivo tras el login** | El usuario no elige su rol: el sistema lo obtiene de la base de datos (usuario.id_rol) y con él decide la interfaz a la que se redirige. Cualquier rol enviado por el cliente se ignora. | CU-01, PI-07 |
| **Bloqueo por intentos fallidos** | Cada clave incorrecta suma un intento (usuario.intentos_fallidos). Al llegar a 5 intentos consecutivos la cuenta se bloquea 15 minutos (usuario.bloqueado_hasta) y el login se rechaza con el mismo mensaje genérico. Un acceso exitoso reinicia el contador y registra usuario.ultimo_acceso. Los valores 5 y 15 minutos son parámetros iniciales, ajustables con la Jefatura. | Tabla usuario; prueba SEG-04 |
| **Registro de intentos** | Todo login fallido y todo bloqueo de cuenta quedan en el AuditLog con su IP de origen (id_usuario vacío si la cuenta no se identifica). | Tabla audit_log; CU-07 |
| **Gestión de cuentas** | Solo el Administrador crea usuarios, asigna roles y da de baja cuentas (permiso usuarios:administrar). Las bajas no borran el historial. | CU-08, HU08 |

#### 7.1.2 Políticas de autorización

- **Modelo RBAC (Ferraiolo & Kuhn, 1992):** cada rol agrupa una lista de permisos con formato «módulo:acción» (por ejemplo costos:leer), almacenada en rol.permisos. Un usuario tiene exactamente un rol.
- **Privilegios mínimos y denegación por defecto:** si el permiso no figura en la lista del rol, la API responde HTTP 403 Forbidden (PU-09, PI-07).
- **Validación en el servidor en cada petición:** el middleware de la API verifica el token y el permiso antes de ejecutar la operación. Ocultar un botón en pantalla no se considera una medida de seguridad (T03).
- **Respuestas sin datos sensibles:** para los perfiles Bodega y Chofer la API no incluye costo neto ni margen en sus respuestas, y por lo tanto tampoco aparecen en el código fuente que recibe el navegador (T03, PU-09).
- **Defensa en profundidad en la base de datos:** además del control de la API, el trigger fn_despacho_solo_chofer impide asignar un despacho a una cuenta que no sea un chofer activo (prueba VD-04).
- **Todo intento no autorizado se audita:** un acceso denegado queda registrado en el AuditLog (PI-07).

### 7.2 Matriz de control de acceso basada en roles (RBAC)

La matriz se construyó a partir de los permisos realmente cargados en la tabla rol del modelo de datos (02_datos_ejemplo.sql): el Administrador posee 14 permisos, Bodega 3 y Chofer 2. «Sí» indica que el rol tiene el permiso; «No» indica que la API lo deniega con HTTP 403.

**Tabla 34. Matriz de control de acceso basada en roles (RBAC)**

| **Módulo** | **Permiso** | **Qué permite** | **Administrador** | **Bodega** | **Chofer** |
|---|---|---|---|---|---|
| Catálogo maestro | catalogo:leer | Consultar productos y su ficha (CU-03) | Sí | No | No |
| Catálogo maestro | catalogo:escribir | Crear y editar productos; el SKU es inmutable (HU01) | Sí | No | No |
| Costos y márgenes | costos:leer | Ver costo neto de adquisición y margen (HU08, PU-09) | Sí | No | No |
| Precios | precios:leer | Ver precios de venta por canal (HU02) | Sí | No | No |
| Precios | precios:escribir | Configurar precios web, marketplace y mayorista (HU02) | Sí | No | No |
| Compras | compras:recepcionar | Registrar la factura del proveedor y su detalle (HU03, CU-04) | Sí | No | No |
| Compras | compras:confirmar_descarga | Confirmar la descarga del camión en bodega | No | Sí | No |
| Pedidos | pedidos:importar | Importar planillas .xlsx de ventas multicanal (HU04, CU-05) | Sí | No | No |
| Pedidos | pedidos:leer | Supervisar órdenes y su estado (CU-06) | Sí | No | No |
| Pedidos | pedidos:asignar_chofer | Asignar chofer y generar la hoja de ruta (CU-06) | Sí | No | No |
| Pedidos | pedidos:preparar | Picking, armado y etiquetado de pedidos (HU05, CU-10) | No | Sí | No |
| Inventario | inventario:leer | Ver existencias y su valorización en el dashboard (CU-02) | Sí | No | No |
| Inventario | inventario:consultar | Buscador por SKU o modelo: stock físico y ubicación (HU06, CU-09) | No | Sí | No |
| Alertas | alertas:leer | Ver alertas de stock crítico (HU09) | Sí | No | No |
| Reportes | reportes:leer | Ver y generar reportes de ventas y rotación (HU10) | Sí | No | No |
| Auditoría | auditoria:leer | Consultar y exportar la bitácora (CU-07) | Sí | No | No |
| Usuarios y roles | usuarios:administrar | Crear usuarios, asignar roles y dar de baja (CU-08) | Sí | No | No |
| Despacho | ruta:leer | Ver la hoja de ruta del día (HU07) | No | No | Sí |
| Despacho | entregas:registrar | Marcar entrega o rechazo, con causal obligatoria (HU07) | No | No | Sí |

**Lectura de la matriz.** El Administrador concentra la información financiera y la gestión de usuarios. Bodega y Chofer solo tienen permisos operativos y ninguno de los dos puede ver costos, márgenes, precios, reportes ni la bitácora. Los permisos operativos de Bodega y Chofer no se solapan, de modo que cada perfil solo ve su propia interfaz móvil.

#### 7.2.1 Capas donde se aplica el control de acceso

**Tabla 35. Defensa en capas del control de acceso**

| **Capa** | **Control** | **Qué impide** | **Prueba** |
|---|---|---|---|
| **Interfaz (PWA)** | Redirección al panel del rol y menús restringidos tras el login (CU-01) | Que el usuario navegue a pantallas que no le corresponden | PI-07 |
| **API (middleware)** | Validación de token y permiso en cada endpoint; HTTP 403 si falta el permiso; costo y margen excluidos de las respuestas | Acceso directo por URL o API a /admin-catalogo, /admin-auditoria y datos financieros | T04, PU-09, PI-07 |
| **Base de datos** | Restricciones y triggers (rol de chofer, flujo de estados, márgenes, stock ≥ 0) | Datos inválidos aunque la aplicación fallara | VD-04, IN-01 a IN-05, INV-01 y INV-02 |
| **Bitácora** | Registro del intento no autorizado en el AuditLog | Que el intento pase inadvertido | PI-07 |

### 7.3 Análisis de amenazas y vulnerabilidades mediante modelo STRIDE

STRIDE (Shostack, 2014) clasifica las amenazas en seis categorías según la propiedad de seguridad que vulneran: **S**poofing (suplantación), **T**ampering (manipulación), **R**epudiation (repudio), **I**nformation disclosure (divulgación de información), **D**enial of service (denegación de servicio) y **E**levation of privilege (elevación de privilegios). Se aplicó sobre los flujos de datos del diagrama de despliegue, con las fronteras de confianza entre (1) los dispositivos de oficina, bodega y terreno, que acceden por Internet; (2) el servidor de aplicación (EC2) dentro de la VPC; y (3) los servicios de datos: PostgreSQL en Amazon RDS y Amazon S3.

Los activos que se protegen son: costos y márgenes, existencias, facturas de compra, datos personales de usuarios y clientes (RUT, nombre, dirección, teléfono), credenciales, y la bitácora de auditoría.

**Tabla 36. Categorías STRIDE aplicadas al SGI**

| **Categoría** | **Propiedad vulnerada** | **Qué significa en el SGI** | **Dónde puede ocurrir** |
|---|---|---|---|
| **S – Suplantación** | Autenticidad | Alguien se hace pasar por un usuario legítimo (por ejemplo, como Administrador) | Login, token de sesión, celulares de bodega y chofer |
| **T – Manipulación** | Integridad | Se altera información: precios, costos, stock, planillas importadas o la bitácora | API, planillas .xlsx, base de datos |
| **R – Repudio** | No repudio | Un usuario niega haber importado ventas, recibido una factura o cerrado una entrega | Operaciones críticas de HU03, HU04 y HU07 |
| **I – Divulgación de información** | Confidencialidad | Se expone costo, margen, facturas o datos de clientes a quien no corresponde | Respuestas de la API, red WiFi o móvil, bucket de S3 |
| **D – Denegación de servicio** | Disponibilidad | El sistema deja de responder en horas de operación | Carga masiva de ventas, dashboard, servidor de aplicación y base de datos |
| **E – Elevación de privilegios** | Autorización | Bodega o Chofer logran hacer lo que solo el Administrador puede | Rutas /admin-*, endpoints de la API, entradas mal validadas |

### 7.4 Identificación de amenazas

Se identificaron 14 amenazas concretas del SGI. El nivel de riesgo es el **inherente** (antes de aplicar controles) y combina probabilidad e impacto para Comercial Oregon. La columna CIA indica la propiedad afectada: C = confidencialidad, I = integridad, D = disponibilidad. Los controles M1 a M12 se describen en la sección siguiente.

**Tabla 37. Identificación de amenazas y nivel de riesgo inherente**

| **ID** | **STRIDE** | **Activo o flujo** | **Amenaza** | **CIA** | **Riesgo** | **Controles** |
|---|---|---|---|---|---|---|
| A-01 | S | Login (CU-01) | Adivinar o probar claves de una cuenta, o descubrir qué correos existen según el mensaje de error | C | Alto | M2, M8, M11 |
| A-02 | S | Token JWT en celulares de bodega y chofer | Uso de un token robado o de una sesión olvidada abierta en un celular personal | C | Alto | M1, M3 |
| A-03 | T | API de precios, costos y stock | Alterar parámetros de una petición para cambiar precios, costos o stock, o inyectar SQL | I | Alto | M3, M5, M6 |
| A-04 | T | Planilla .xlsx de ventas (HU04) | Cargar un archivo manipulado, con estructura inválida o malicioso, que rebaje stock indebidamente | I | Alto | M5, M7 |
| A-05 | T | Tabla audit_log | Modificar o borrar registros de la bitácora para ocultar una acción | I | Alto | M8 |
| A-06 | R | Importación, recepción de facturas y entregas | Un usuario niega haber ejecutado una operación que alteró el inventario | I | Medio | M8 |
| A-07 | I | Costos y márgenes | Que Bodega o Chofer vean costos y márgenes en pantalla o en las respuestas de la API | C | Alto | M3 |
| A-08 | I | Tráfico oficina, bodega y ruta | Interceptar credenciales o datos en una red WiFi de bodega o en redes móviles | C | Alto | M1 |
| A-09 | I | Facturas PDF y planillas en S3 | Acceso no autorizado a los archivos almacenados | C | Alto | M4, M12 |
| A-10 | D | Carga masiva y dashboard | Una planilla grande o varias consultas simultáneas saturan el servidor y bloquean a bodega y choferes | D | Medio | M9 |
| A-11 | D | Servidor y base de datos | Falla del servidor de aplicación o de la base de datos, o pérdida de datos sin respaldo | D | Alto | M9 |
| A-12 | E | Rutas /admin-catalogo y /admin-auditoria | Un usuario Bodega o Chofer accede por URL o API directa a módulos del Administrador | C, I | Alto | M3, M8 |
| A-13 | E | Base de datos desde la red | Acceso directo a PostgreSQL desde Internet o desde un equipo no autorizado | C, I | Alto | M4 |
| A-14 | E | Cuentas de usuarios | Cuentas de personas que ya no trabajan en la empresa siguen activas con sus permisos | C | Medio | M10 |

### 7.5 Medidas de mitigación técnica implementadas

Cada amenaza identificada se cubre con al menos un control técnico. Todos los controles de la tabla forman parte del diseño del proyecto (diagramas de componentes y de despliegue, modelo de datos y plan de pruebas); la última columna indica dónde se verifica cada uno.

**Tabla 38. Medidas de mitigación técnica y su evidencia**

| **Cód.** | **Control** | **Cómo se implementa en el SGI** | **Amenazas** | **Evidencia** |
|---|---|---|---|---|
| M1 | Cifrado en tránsito | Todo el tráfico desde oficina, bodega y terreno usa HTTPS con TLS 1.3 en el puerto 443 hasta el servidor de aplicación (EC2); el grupo de seguridad solo abre el 443. El certificado se obtiene con Let's Encrypt. El token JWT viaja solo por HTTPS. | A-02, A-08 | Diagrama de despliegue; plan de costos |
| M2 | Protección de credenciales | Hash bcrypt (cost ≥ 12) con sal aleatoria; comparación en tiempo constante; mensaje único ante error; la clave no se escribe en registros. | A-01 | PU-06, PU-07, PU-08; SEG-01 a SEG-03 |
| M3 | Control de acceso RBAC en el servidor | Middleware de la API que valida token y permiso en cada endpoint, responde HTTP 403 y excluye costo y margen de las respuestas de Bodega y Chofer. | A-02, A-03, A-07, A-12 | T03, T04, PU-09, PI-07 |
| M4 | Segmentación de red | VPC con la base de datos en subred privada y el servidor de aplicación en subred pública, con un grupo de seguridad que solo permite el puerto 443. PostgreSQL acepta conexiones TCP 5432 únicamente desde el servidor de aplicación y no tiene acceso público; la API usa S3 a través del VPC endpoint. | A-09, A-13 | Diagrama de despliegue |
| M5 | Integridad en la base de datos | Llaves primarias y foráneas, restricciones CHECK y UNIQUE, triggers y transacciones ACID. El descuento de stock usa un UPDATE condicionado que impide sobreventa y stock negativo. | A-03, A-04 | Tabla 10 (39 de 39 pruebas); prueba de concurrencia |
| M6 | Consultas parametrizadas y validación de entradas | Acceso a datos mediante ORM o repositorios con parámetros, sin concatenar texto del usuario en SQL. Validación en el backend de tipo, largo y formato (RUT, SKU, cantidades). | A-03 | T07; diagrama de componentes |
| M7 | Validación de archivos de importación | Solo se aceptan planillas .xlsx con la estructura de columnas esperada; se procesan en una única transacción (todo o nada) y el archivo original queda en S3 y registrado en lote_importacion. | A-04 | T17, PR-02, ACID-01 |
| M8 | Bitácora inmutable | audit_log registra usuario, acción, módulo, IP y estado antes y después. Triggers bloquean UPDATE, DELETE y TRUNCATE. Incluye logins fallidos y accesos denegados. | A-01, A-05, A-06, A-12 | AUD-01 a AUD-03; PI-07; PR-06 |
| M9 | Disponibilidad y respaldo | RDS con respaldos automáticos diarios y snapshots en S3; caché Redis para aliviar la lectura del dashboard; importación de planillas en una transacción única. El despliegue usa un solo servidor y una sola zona de disponibilidad (acorde al presupuesto); la alta disponibilidad (balanceador, segundo servidor y RDS Multi-AZ) queda como evolución prevista. | A-10, A-11 | PR-02, PR-04; diagrama de despliegue; plan de costos |
| M10 | Gestión del ciclo de vida de cuentas | Solo el Administrador crea, cambia de rol o desactiva usuarios (usuarios:administrar). La baja es lógica e inmediata: una cuenta con activo = FALSE no puede iniciar sesión. | A-14 | CU-08, HU08 |
| M11 | Bloqueo temporal de cuenta | Contador usuario.intentos_fallidos y fecha usuario.bloqueado_hasta: tras 5 intentos fallidos consecutivos la cuenta se bloquea 15 minutos. El bloqueo se registra en el AuditLog. | A-01 | SEG-04; PU-08 |
| M12 | Protección de archivos en S3 | Bucket sin acceso público; descargas mediante URL prefirmadas de corta duración; cifrado en reposo del lado del servidor; versionado activado para recuperar un archivo sobrescrito o eliminado. | A-09 | Diagrama de despliegue |

### 7.6 Estándares y directrices de codificación segura

El equipo adopta como referencia el **OWASP Top 10:2025** (OWASP Foundation, 2025), la lista de los diez riesgos más críticos en aplicaciones web publicada por OWASP. La tabla traduce cada categoría a una regla de codificación concreta para el SGI.

**Tabla 39. Directrices de codificación segura según OWASP Top 10:2025**

| **OWASP 2025** | **Riesgo en el SGI** | **Directriz que debe cumplir el código** |
|---|---|---|
| A01 Control de acceso defectuoso (Broken Access Control) | Acceso por URL o API a módulos del Administrador | Verificar permiso en el servidor en cada endpoint; denegar por defecto; no confiar en el rol que envía el cliente. |
| A02 Configuración de seguridad incorrecta (Security Misconfiguration) | Servidor, base de datos o bucket mal configurados | Base de datos en subred privada y grupo de seguridad restringido; sin cuentas ni claves por defecto; secretos en variables de entorno y nunca en el repositorio; mensajes de error sin detalles internos. |
| A03 Fallas en la cadena de suministro de software (Software Supply Chain Failures) | Paquetes npm del backend, de la PWA y del lector de .xlsx | Versiones fijadas con el archivo de bloqueo (lock); revisar dependencias con npm audit antes de cada revisión de sprint; incorporar solo las librerías necesarias. |
| A04 Fallas criptográficas (Cryptographic Failures) | Claves, tokens y tráfico | bcrypt cost ≥ 12; TLS 1.3; JWT firmado con secreto fuera del código; no implementar algoritmos propios. |
| A05 Inyección (Injection) | SQL en la búsqueda predictiva (HU06) y en filtros; XSS en la PWA | Consultas parametrizadas; validar entradas; usar el escape por defecto de React y no insertar HTML sin sanear. |
| A06 Diseño inseguro (Insecure Design) | Reglas críticas del negocio | Modelar amenazas desde el diseño (STRIDE); imponer reglas clave en la base (CHECK, triggers, estados controlados) y no solo en la interfaz. |
| A07 Fallas de autenticación (Authentication Failures) | Inicio de sesión con rol definido por el servidor | Hash seguro, mensaje de error único, expiración de sesión y rol efectivo tomado de la base de datos. |
| A08 Fallas de integridad de software o datos (Software or Data Integrity Failures) | Planillas importadas y despliegues | Validar estructura y contenido del archivo; operar en una transacción atómica; desplegar solo desde el repositorio controlado. |
| A09 Fallas de registro y alertas (Security Logging and Alerting Failures) | Trazabilidad de operaciones | Registrar en el AuditLog logins fallidos, accesos denegados, importaciones, recepciones y entregas; no registrar claves ni tokens. |
| A10 Manejo inadecuado de condiciones excepcionales (Mishandling of Exceptional Conditions) | Stock insuficiente, fallas de base de datos | Excepciones controladas (StockInsuficienteException, AccesoDenegado); ROLLBACK ante error; ante duda, denegar; respuestas de error genéricas al usuario. |

**Prácticas de proceso complementarias:**

- Todo cambio entra por pull request en GitHub con revisión de al menos otro integrante del equipo antes de unirse a la rama principal.
- Las pruebas de la API en Postman incluyen casos negativos de seguridad: acceso sin token, token de otro rol y petición directa a rutas del Administrador (T04, PI-07).
- Las pruebas unitarias de seguridad PU-06 a PU-09 forman parte del criterio de aceptación de HU08.
- La función «Recordar usuario» de la pantalla de login solo puede recordar el correo; la clave y el token no se guardan en el dispositivo.

### 7.7 Auditoría inmutable y cumplimiento legal

La bitácora es el control que cierra el ciclo de seguridad: permite saber quién hizo qué, desde dónde y cuándo, y es la evidencia ante un descuadre, una disputa con un proveedor o un incidente. Se implementa en la tabla audit_log, cuyo reporte (CU-07) exige Fecha, Usuario, Rol, Acción, Módulo e IP de origen.

**Tabla 40. Campos del reporte de auditoría (CU-07) y su origen en la base de datos**

| **Campo del reporte** | **Columna en la base de datos** | **Observación** |
|---|---|---|
| **Fecha** | audit_log.fecha_hora | TIMESTAMPTZ; se asigna con la hora del servidor de base de datos |
| **Usuario** | audit_log.id_usuario → usuario | Vacío solo en intentos de login fallidos sin cuenta identificada |
| **Rol** | usuario.id_rol → rol.nombre_rol | Se obtiene por la unión con el usuario |
| **Acción** | audit_log.accion | Ej.: IMPORTACIÓN, RECEPCIÓN, ENTREGA |
| **Módulo** | audit_log.tabla_afectada | Tabla o módulo sobre el que se actuó |
| **IP de origen** | audit_log.ip_origen | Tipo INET |
| **Detalle del cambio** | audit_log.valores_anteriores / valores_nuevos | Instantánea JSONB antes y después de la operación |

#### 7.7.1 Cómo se garantiza la inmutabilidad

- **Sin permisos de modificación:** tres triggers sobre audit_log bloquean UPDATE, DELETE y TRUNCATE y devuelven el error SQLSTATE 42501. Las pruebas AUD-01, AUD-02 y AUD-03 comprueban que los tres intentos son rechazados.
- **Solo inserción:** los módulos del SGI únicamente agregan eventos; no existe operación de edición ni de borrado en la API de auditoría.
- **Sin impacto en el rendimiento:** con 320.000 eventos almacenados y 10 conexiones simultáneas, la inserción promedió 1.016 ms (meta PR-06: menos de 50 ms) y la exportación de 2 días de bitácora tardó 0.306 ms (PR-07).
- **Alcance:** la inmutabilidad se impone dentro de la base y protege frente a cualquier módulo del SGI. Las credenciales de propietario de la base de datos son de administración de infraestructura y no se usan desde la aplicación.

#### 7.7.2 Marco legal aplicable

El SGI trata datos personales (RUT, nombre y correo de los usuarios; RUT, nombre, dirección y teléfono de los clientes) y conserva documentos tributarios. El siguiente cuadro resume las normas chilenas de referencia y la respuesta del diseño. Es un resumen técnico para el proyecto y no constituye asesoría legal; la vigencia de la Ley 21.719 (1 de diciembre de 2026) debe confirmarse al momento de la puesta en marcha.

**Tabla 41. Normativa de referencia y respuesta del SGI**

| **Norma** | **Qué establece** | **Respuesta del SGI** |
|---|---|---|
| Ley 19.628 sobre protección de la vida privada (1999), vigente hasta que rija la Ley 21.719 | Regula el tratamiento de datos personales. | Se recogen solo los datos necesarios para facturar, despachar y autenticar; el acceso está restringido por rol (RBAC). |
| Ley 21.719 que regula la protección y el tratamiento de los datos personales (2024); vigencia prevista: 1 de diciembre de 2026; crea la Agencia de Protección de Datos Personales | Principios de licitud y lealtad, finalidad, proporcionalidad, calidad, responsabilidad, seguridad, transparencia y confidencialidad. Derechos de acceso, rectificación, supresión, oposición, portabilidad y bloqueo. Deber de seguridad y de notificar las vulneraciones de seguridad sin dilaciones indebidas. | Confidencialidad con RBAC y TLS 1.3; claves con bcrypt; datos mínimos por pantalla. La bitácora permite reconstruir un incidente para notificarlo. Las solicitudes de acceso o rectificación se atienden por RUT sobre orden_venta; la supresión se pondera con la obligación de conservar documentos tributarios. |
| Código Tributario (Decreto Ley 830, 1974), arts. 17 y 200, y Ley sobre Impuesto a las Ventas y Servicios (Decreto Ley 825, 1974), art. 58 | Conservar libros de contabilidad y documentos de respaldo mientras el SII pueda revisar las declaraciones, y los duplicados y originales de facturas y boletas; el plazo general es de 6 años. | La factura de cada compra se guarda en S3 (PDF) y en recepcion_compra (neto, IVA y total, cuadrados al peso: PU-01). Las llaves RESTRICT y la baja lógica evitan borrar documentos con historial. |
| Ley 21.459 sobre delitos informáticos (2022) | Tipifica, entre otros, el ataque a la integridad de un sistema informático (art. 1), el acceso ilícito (art. 2), la interceptación ilícita (art. 3), el ataque a la integridad de los datos (art. 4), la falsificación informática (art. 5), el fraude informático (art. 7) y el abuso de dispositivos (art. 8). | Los controles de acceso y la bitácora inmutable con usuario, IP y estado antes y después aportan evidencia para investigar y denunciar un acceso o una alteración ilícita. |

## 8 Plan de aseguramiento de calidad y pruebas

### 8.1 Estrategia de pruebas basada en casos de uso e historias de usuario

La estrategia de aseguramiento de calidad para el sistema de inventario de Tienda Oregon, se estructura bajo un enfoque metodológico multinivel, asegurando que cada incremento de software satisfaga los criterios de aceptación acordados en el Product Backlog y mitigue los riesgos identificados.

- Pruebas de Nivel 1 (Críticas): Enfocadas en el núcleo transaccional (HU01, HU03, HU04, HU08). Validan la unicidad inmutable del SKU, la atomicidad en la importación masiva de planillas Excel y la estricta segregación de roles mediante RBAC.
- Pruebas de Nivel 2 (Operativas en Terreno): Enfocadas en la usabilidad móvil y agilidad física en pasillos de bodega y transporte (HU05, HU06, HU07). Validan tiempos de respuesta en smartphones sin lectores de barras y el ocultamiento riguroso de costos/márgenes a los operarios.
- Pruebas de Nivel 3 (Analíticas y Gestión): Enfocadas en la supervisión administrativa (HU02, HU09, HU10), verificando la consistencia en el cálculo de márgenes, alertas de quiebre de stock y reportes de auditoría.

### 8.2 Diseño de casos de prueba

**Tabla 42. Casos de prueba basados en casos de uso**

| **ID** | **Módulo** | **Nombre del Caso de Uso** | **Descripción** | **Precondiciones** | **Resultado Esperado** |
|---|---|---|---|---|---|
| CU-01 | Autenticación y Login | Iniciar Sesión | El usuario ingresa su correo y contraseña; el sistema identifica su rol (Administrador, Bodega o Chofer) en la base de datos | Usuario registrado en sistema | Redirección a la interfaz correspondiente según rol |
| CU-02 | Dashboard General | Supervisión Integral de Existencias y Métricas | Visualizar valorización total ($28.450.900), SKUs activos (156), stock crítico, ventas del día (48 órdenes) y margen promedio (34.8%) | Sesión activa como Administrador | KPIs y alertas de quiebre desplegados en tiempo real |
| CU-03 | Catálogo Maestro | Gestión de Productos y Precios por Canal | Crear y editar productos con SKU inmutable, modelo, marca, ubicación física, costo neto, precio web, precio mayorista y stock | Sesión activa como Administrador | Producto persistido o actualizado en catálogo maestro |
| CU-04 | Compras y Facturas | Ingreso de Mercadería contra Factura SII | Registrar cabecera tributaria (RUT, Razón Social, N° Factura, Fecha, PDF) y detalle multiproducto calculando Neto, IVA y Total para actualizar stock | Factura electrónica válida emitida por proveedor | Stock incrementado en bodega y orden de compra registrada |
| CU-05 | Carga Masiva (HU04) | Importación Masiva de Ventas Multicanal | Cargar archivo .xlsx de Mercado Libre, Paris, Ripley, Venta Directa o Mayorista para rebajar stock en tiempo real | Plantilla con formato compatible | Stock rebajado automáticamente según ventas del archivo |
| CU-06 | Pedidos y Despachos | Asignación de Pedidos y Choferes | Supervisar órdenes de venta, estado de picking y asignar chofer para la hoja de ruta | Órdenes en estado generado/picking | Orden pasa a estado En Ruta y se asigna al chofer correspondiente |
| CU-07 | Reportes y Auditoría | Trazabilidad Inmutable (Audit Log) | Consultar y exportar (Excel/PDF) bitácora cronológica con Fecha, Usuario, Rol, Acción, Módulo e IP de origen | Acciones registradas en el sistema | Reporte exportado en formato seleccionado |
| CU-08 | Usuarios y Roles | Administración de Accesos y Privilegios RBAC | Crear usuarios, asignar roles y controlar restricciones a costos y márgenes | Sesión activa como Administrador | Usuario habilitado con permisos asignados |
| CU-09 | Bodega - Buscador | Búsqueda Predictiva de Pasillo y Stock | Buscar por SKU o modelo (< 2 seg) para ubicar pasillo, estante y existencias físicas | Sesión activa como Bodega | Despliegue de tarjeta con SKU, modelo, marca, stock físico y ubicación exacta |
| CU-10 | Bodega - Pedidos | Picking y Armado de Pedidos Multicanal | Gestionar pedidos por lote, cambiar estados (Sin recolectar, Armado, Etiquetado, En camión), marcar checklist y descargar etiquetas | Lotes de pedidos asignados a bodega | Pedido recolectado y listo para carga en camión |
| CU-11 | Bodega - Despacho | Control de Entrada y Descarga de Camión | Conteo físico y validación de bultos entrantes contra N° de Factura o Guía de despacho | Llegada de camión de proveedor con guía/factura | Descarga confirmada y mercadería ingresada formalmente |
| CU-12 | Chofer - Ruta Diaria | Gestión de Última Milla y Entrega en Terreno | Visualizar paradas secuenciales en hoja de ruta, abrir navegación GPS (Abrir Mapa) y marcar orden como Entregado o Rechazado | Pedidos asignados al chofer en ruta | Estado de la orden actualizado en tiempo real a Entregado o Rechazado |

### 8.3 Pruebas unitarias

#### 8.3.1 Propósito y alcance del nivel unitario

El nivel de pruebas unitarias tiene como objetivo aislar y validar el comportamiento de los componentes de software esenciales antes de su integración. Se enfoca en certificar la precisión matemática de los algoritmos financieros, la robustez de las reglas de control de stock y la invulnerabilidad de los mecanismos de seguridad criptográfica y autenticación en el Sistema de Gestión de Inventario para Tienda Oregon.

La estrategia cubre tres ejes críticos derivados de los casos de uso del sistema:

- **Lógica de negocio e inventario:** Integridad transaccional en la rebaja atómica de stock ante ventas multicanal  y prevención de quiebres físicos o números negativos en bodega.
- **Seguridad y hash de claves:** Verificación del cifrado unidireccional y robustez del mecanismo de acceso con segregación de roles RBAC .
- **Cálculos de márgenes y tributación:** Coherencia aritmética de la valorización neta, cálculo del IVA (19%) del Servicio de Impuestos Internos  y exactitud en los márgenes comerciales brutos reflejados en el Dashboard.

**Tabla 43. Pruebas unitarias**

| **ID** | **CU - Base** | **Tipo de Prueba** | **Escenario** | **Resultado Esperado** | **Criterio de Aceptación** |
|---|---|---|---|---|---|
| PU-01 | CU-04 Compras y Facturas | Lógica Tributaria (SII) | Factura N° 54691 de Gama Chile S.A.: 6 ítems (9 unidades físicas con costos netos unitarios variados) | Subtotal Neto: $165.828; I.V.A. (19%): $31.507; Total Facturado: $197.335 | Conciliación exacta al centavo; redondeo estándar sin truncar decimales conforme a normativa SII |
| PU-02 | CU-02 / CU-03 Catálogo y Dashboard | Finanzas / Catálogo | Costo Neto: $14.990, Precio Web: $22.990 (Hervidor TH-4500). Fórmula: ((Precio - Costo) / Precio) * 100 | Margen de ganancia calculado exactamente en 34.80% | El valor coincide exactamente con el KPI 'Margen Promedio' del Dashboard gerencial |
| PU-03 | CU-03 Catálogo Maestro | Finanzas / Mayorista | Costo Neto: $14.990, Precio Mayorista: $18.500 (Hervidor TH-4500) | Margen mayorista calculado en 18.97% | Valida que el precio mayorista sea superior al costo neto de adquisición |
| PU-04 | CU-05 Carga Masiva (HU04) | Lógica de Inventario | Stock físico inicial: 24 un. (Pasillo A - Estante 2). Venta procesada desde Mercado Libre: 4 un. | Stock final: 20 un.; Estado evaluado: Abastecido | Disminución atómica de existencias sin inconsistencias por concurrencia |
| PU-05 | CU-02 / CU-09 Control Existencias | Validación Límite (Frontera) | Stock actual: 3 un. (Horno UT-FORNO). Solicitud de rebaja masiva: 5 un. | Bloqueo transaccional; lanzamiento de excepción controlada StockInsuficienteException | Impide stock físico negativo; alerta de Quiebre Inminente / Detectado |
| PU-06 | CU-01 Autenticación y Login | Criptografía / Seguridad | Clave en texto plano de Administrador: 'Jefatura_Oregon2026$' | Generación de string hash mediante algoritmo bcrypt con cost factor >= 12 | Hash irreversible con salt aleatorio; nunca expone texto plano |
| PU-07 | CU-01 Autenticación y Login | Autenticación Positiva | Comparación de contraseña en texto plano válida contra hash bcrypt persistido en base de datos | Retorna True; inicio de sesión exitoso y emisión de token de sesión | Tiempo de validación constante para prevenir timing attacks |
| PU-08 | CU-01 Autenticación y Login | Autenticación Negativa | Comparación de contraseña incorrecta/falsa contra hash legítimo almacenado | Retorna False; bloqueo inmediato del acceso | Denegación sin revelar si falló el usuario o la contraseña (anti-enumeración) |
| PU-09 | CU-08 Usuarios y Roles (RBAC) | Reglas de Negocio / RBAC | Petición de lectura sobre Costo Neto y Margen con sesión de rol Bodega o Chofer | Retorna False o lanza excepción AccesoDenegado (HTTP 403 Forbidden) | Restricción estricta de atributos en estado 'Bloqueado / Oculto' según política de privilegios mínimos |

### 8.4 Pruebas integrales (end-to-end)

#### 8.4.1 Propósito y alcance del nivel de integración

Las pruebas integrales tienen como objetivo verificar que los distintos módulos, capas arquitectónicas y perfiles de usuario del sistema de gestión de inventario interactúen de forma sincronizada, sin pérdida de datos ni quiebres de consistencia transaccional.

A diferencia de las pruebas unitarias que evalúan funciones de forma aislada, este nivel valida procesos de negocio completos de extremo a extremo, que cruzan las fronteras entre el rol Administrador, el personal operativo de Bodega y los Choferes en terreno.

**Tabla 44. Pruebas integrales (end-to-end)**

| **ID** | **Flujo Integral** | **Módulos** | **Escenario** | **Datos de Prueba** | **Resultado Esperado** |
|---|---|---|---|---|---|
| PI-01 | Flujo E2E de Abastecimiento y Recepción Conforme | Compras y Facturas/ Despacho Bodega/ Catálogo Maestro/ Audit Log | Admin registra Factura SII N° 54691 de Gama Chile S.A. Bodega confirma descarga física de bultos en módulo Despacho. El sistema actualiza existencias e impacta auditoría. | Factura N° 54691: 9 unidades físicas de línea Gama (GM-ELEGANCE, GM-KERATION, GM-COCONUT, etc.). | Stock físico incrementado automáticamente en Catálogo Maestro; bultos validados en Despacho Bodega; evento registrado de forma inmutable en Audit Log. |
| PI-02 | Flujo E2E de Venta Multicanal y Rebaja de Stock | Carga Masiva (HU04)/ Dashboard General/ Buscador Bodega/ Audit Log | Admin importa planilla .xlsx con 48 órdenes de Mercado Libre y Web. El backend procesa el lote, descuenta existencias en tiempo real y actualiza KPIs en Dashboard. Bodega consulta existencias actualizadas en Buscador. | Archivo ventas_lote_201.xlsx con 4 unidades del Hervidor TH-4500. Stock inicial: 24 un. | Stock disminuye a 20 un. en Buscador Bodega y Catálogo; KPI Ventas del Día suma 48 órdenes; valorización global se actualiza; log registrado con IP y usuario. |
| PI-03 | Flujo E2E de Despacho, Picking y Asignación de Ruta | Pedidos y Despachos Admin/ Bodega Pedidos/ Chofer Ruta Diaria | Admin visualiza orden mayorista #ORD-1024 en picking. Bodega toma el lote del canal Mayorista, ejecuta checklist de picking, cambia estado a 'En camión' y descarga etiquetas. Admin asigna chofer y la orden pasa a 'En Ruta'. Chofer visualiza la parada en su celular. | Orden #ORD-1024 (Distribuidora Oriente SpA, canal Mayorista, 4 cajas TH-4500 en Pasillo A - Estante 2). | Orden transiciona de 'Sin recolectar' a 'Armado', 'Etiquetado' y 'En camión'; se refleja inmediatamente en la interfaz móvil del Chofer con botón 'Abrir Mapa'. |
| PI-04 | Flujo E2E de Última Milla y Cierre Operativo de Entrega | Chofer Ruta Diaria/ Pedidos y Despachos Admin/ Audit Log | Chofer se desplaza a Providencia 1251, abre mapa GPS y presiona botón verde 'Entregado' tras recibir firma/recepción conforme. El sistema liquida la parada y actualiza el SGI central. | Parada 1: Orden #1024, Distribuidora Oriente SpA, Providencia, 4 cajas grandes. | La parada cambia a 'Entregado' en móvil; el contador de paradas pendientes disminuye; en Pedidos y Despachos Admin la orden se marca cerrada; log registra IP y geolocalización. |
| PI-05 | Flujo E2E de Control de Incidencia y Rechazo en Reparto | Chofer Ruta Diaria/ Pedidos y Despachos Admin/ Bodega Despacho/ Audit Log | Chofer llega a destino (Parada 2: Orden #1025) y cliente no se encuentra en domicilio. Chofer presiona botón rojo 'Rechazado' con motivo de devolución. El sistema notifica al SGI para reingreso a bodega. | Orden #1025 (Mercado Libre, Juan Pérez, 1 bulto Horno UT-FORNO en Las Condes). | Orden marcada como 'Rechazada / En Devolución'; se bloquea rebaja definitiva y se genera tarea de reingreso en Despacho Bodega; evento trazable en auditoría. |
| PI-06 | Flujo E2E de Alerta de Quiebre y Reorden Crítico | Carga Masiva/ Dashboard General/ Catálogo Maestro/ Audit Log | Carga de ventas procesa venta de 2 unidades de Horno UT-FORNO (stock actual 3 un.). El stock remanente queda en 1 un., por debajo del umbral de seguridad. | Horno Eléctrico UT-FORNO (Costo $45.990, Stock inicial 3 un., umbral crítico 5 un.). | Dashboard activa automáticamente badge rojo 'Quiebre Inminente' y alerta '2 Quiebres Detectados'; se genera sugerencia de reorden de compra; log registra alerta. |
| PI-07 | Flujo Integral de Seguridad y Restricción RBAC de Extremo a Extremo | Login/ Usuarios y Roles/ Navegación Interfaz/ API Backend | Usuario con rol Bodega o Chofer inicia sesión. El sistema restringe la navegación exclusivamente a sus interfaces móviles e intercepta cualquier petición directa vía URL o API hacia módulos financieros o de auditoría. | Credenciales operativas: bodega@tiendaoregon.cl y chofer@tiendaoregon.cl. Intentos de acceso a /admin-auditoria y /admin-catalogo. | Sistema responde con código HTTP 403 Forbidden; costos y márgenes se mantienen 'Bloqueados / Ocultos'; intento no autorizado queda registrado en Audit Log. |

### 8.5 Pruebas de rendimiento y carga

#### 8.5.1 Propósito y alcance del nivel de rendimiento

Las pruebas no funcionales de rendimiento y carga evalúan el comportamiento, la estabilidad, el tiempo de respuesta y el consumo de recursos del sistema de gestión de inventario bajo condiciones de operación normal, picos de alta concurrencia y sobrecarga crítica.

El objetivo central es certificar que la arquitectura cumpla con los acuerdos de nivel de servicio  definidos para la operación de comercial oregón:

- Latencia móvil en bodega: Garantizar que las consultas predictivas de pasillo y existencias no superen los 2.0 segundos en conexiones móviles.
- Capacidad de procesamiento masivo: Procesar planillas de ventas multicanal, de miles de líneas sin bloquear el servidor web ni degradar la experiencia de otros usuarios.
- Resiliencia en concurrencia: Mantener la integridad de los datos cuando decenas de choferes y operarios sincronicen estados de entrega y picking en simultáneo durante las horas pico de despacho.

**Tabla 45. Pruebas de rendimiento y carga**

| **ID** | **Tipo de Prueba** | **Módulo** | **Objetivo de Rendimiento** | **Carga Simulada** | **Métrica Clave Evaluada** | **Resultado Esperado** |
|---|---|---|---|---|---|---|
| PR-01 | Rendimiento / Latencia | Bodega - Buscador Rápido (/api/stock/buscar) | Búsqueda predictiva ultrarrápida en dispositivos móviles en terreno | 30 operarios concurrentes consultando SKUs simultáneamente | Tiempo de Respuesta (Latencia p95) | Tiempo de respuesta < 2.0 segundos (SLA interfaz < 2 seg); consumo CPU servidor < 45% |
| PR-02 | Carga Transaccional | Carga Masiva de Ventas (/api/ventas/importar-lote) | Procesamiento asíncrono y rebaja atómica de inventario desde planillas .xlsx multicanal | Lote masivo de 5.000 líneas de venta (.xlsx con Mercado Libre, Ripley, Paris) | Throughput y Tiempo Total de Procesamiento | Procesamiento completo en < 15 segundos sin bloqueo del hilo principal (Worker en background); tasa de error 0% |
| PR-03 | Concurrencia y Sincronización | Chofer - Ruta Diaria y Liquidación (/api/despacho/liquidar-parada) | Marcado simultáneo de entregas/rechazos y actualización de estados en tiempo real | 20 choferes liquidando paradas simultáneamente en horas pico | Integridad Transaccional y Concurrencia (RPS) | Tiempo de respuesta < 1.2 segundos por liquidación; cero condiciones de carrera (Race Conditions) en persistencia |
| PR-04 | Carga y Agregación | Dashboard General y Métricas (/api/dashboard/kpis) | Cálculo en tiempo real de valorización de inventario ($28M+), márgenes promedio y detección de quiebres | 15 administradores y analistas consultando el panel con actualización automática cada 30s | Tiempo de Renderizado y Consulta a BD | Tiempo de carga inicial de métricas < 1.8 segundos; respuesta de API < 400 ms mediante caché Redis |
| PR-05 | Estrés y Límites del Sistema | Carga Masiva + Búsqueda Bodega (/api/carga y /api/stock) | Determinar el punto de quiebre (Breaking Point) y degradación del servidor bajo sobrecarga | Rampa incremental de 50 a 500 usuarios concurrentes con subida masiva de archivos | Tasa de Error HTTP (5xx) y Uso de Memoria RAM | La tasa de error debe mantenerse en 0% hasta los 250 usuarios concurrentes; degradación elegante sin caída del servicio |
| PR-06 | Rendimiento de Base de Datos y Escritura | Reportes y Bitácora de Auditoría (/api/auditoria/log) | Inserción masiva inmutable de trazas de auditoría (Tríada CIA) sin penalizar latencia de usuario | Inserción concurrente continua de 1.000 logs/minuto provenientes de todos los módulos | Latencia de Escritura y Tamaño de Pool de Conexiones | Tiempo de inserción en base de datos < 50 ms por registro; uso de conexiones de pool < 70% |
| PR-07 | Rendimiento de Exportación | Reportes y Auditoría (/api/auditoria/exportar-pdf) | Generación y streaming de reportes consolidados en PDF/Excel de auditoría | 10 solicitudes concurrentes de exportación de historial semestral (> 10.000 registros) | Consumo de CPU/RAM y Tiempo de Generación de Archivo | Generación y descarga de archivo en < 5.0 segundos; consumo de memoria acotado (< 512 MB por worker) |

## 9 Plan de recursos, costos y mitigación de riesgos

### 9.1 Supuestos de planificación

El SGI Oregón se construye en 12 semanas con 4 integrantes, un costo de infraestructura cercano a CLP 50.000 mensuales y un costo total estimado de CLP 4,3 millones, casi todo esfuerzo humano valorizado.

- **Duración: Sprint 0 de preparación (1 semana) + Sprint 1 de 3 semanas + 3 sprints de 2 semanas + 2 semanas de pruebas de aceptación y puesta en marcha = 12 semanas. Las fechas exactas las fija el cronograma del proyecto.**
- **Dedicación:** 10 horas semanales por integrante, compatibles con la carga académica.
- **Stack tecnológico:** frontend React como PWA responsiva, API REST en Node.js, base de datos PostgreSQL en Amazon RDS, caché Redis en el servidor de aplicaciones y archivos en Amazon S3. Es el mismo stack del diagrama de despliegue.
- **Moneda:** montos en pesos chilenos (CLP); los servicios cloud se cotizan en USD y se convierten a un tipo de cambio supuesto de CLP 950 por USD.
- **Valores referenciales:** los precios cloud son aproximados para la región sa-east-1 (São Paulo) y deben verificarse en la calculadora oficial de AWS (Amazon Web Services, s. f.) antes de la entrega.

### 9.2 Recursos humanos

El equipo aporta 480 horas en total (4 integrantes × 10 h/semana × 12 semanas); los roles técnicos se asignan según los entregables que ya lidera cada integrante.

**Tabla 46. Equipo del proyecto: roles, responsabilidades y dedicación**

| **Integrante** | **Rol en el proyecto** | **Responsabilidades principales** | **Dedicación** |
|---|---|---|---|
| Nicolás Gacitúa | Scrum Master y arquitecto de software | Ceremonias Scrum, arquitectura (componentes y paquetes), plan de recursos, desarrollo del login y de las interfaces web (PWA) | 10 h/semana |
| Leonardo Aguilar | Responsable de infraestructura y despliegue | Actividad y despliegue, configuración AWS, respaldos, arquitectura base, auditoría y pruebas de seguridad, integración y carga | 10 h/semana |
| Amalia Aillañir | Analista y responsable de planificación | Casos de uso, diagrama de clases, modelo de datos, cronograma, desarrollo backend (middleware, validaciones, importación y Observer) | 10 h/semana |
| Danitza Isla | Diseño de interacción y QA | Secuencia y comunicación, modelo de datos y lógica transaccional en la base, interfaces PWA de usuarios y chofer, pruebas | 10 h/semana |

**Contraparte del cliente y supervisión.** Su tiempo es un recurso crítico: sin validaciones en cada sprint review, Scrum pierde su ventaja.

**Tabla 47. Contraparte del cliente y supervisión**

| **Persona** | **Rol** | **Participación esperada** | **Horas estimadas** |
|---|---|---|---|
| Susana Cortés | Product Owner (Jefatura Administrativa) | Priorizar backlog, asistir a sprint reviews, validar HU01, HU03, HU08 | 15 h |
| Jairo Recabarren | Usuario clave de bodega | Probar picking y buscador en su celular (HU05, HU06) | 8 h |
| Manuel Rivera | Usuario clave de despacho | Probar hoja de ruta y registro de entregas (HU07) | 5 h |
| Geraldo Valenzuela | Docente supervisor | Revisión de avances y evaluación | Según calendario académico |

### 9.6 Asignación por sprint y riesgos de recursos

El plan suma 12 semanas y 480 horas. Las historias de cada sprint son las del Sprint backlog: HU08, HU01 y HU02 en el Sprint 1; HU03 y HU04 en el Sprint 2; HU05, HU06 y HU07 en el Sprint 3; y HU09 y HU10 en el Sprint 4. El Sprint 1 es el único de tres semanas porque concentra seguridad, usuarios, catálogo y precios, de los que dependen las demás historias. Las horas estimadas de las tareas (112, 78, 78 y 74 h) quedan bajo la capacidad de cada sprint (120 y 80 h) y ningún integrante supera sus 10 horas semanales; la holgura de 18 h cubre imprevistos. El liderazgo de cada sprint rota entre los cuatro integrantes.

**Tabla 51. Asignación de recursos por sprint**

| **Sprint** | **Semanas** | **Historias de usuario** | **Líder** | **Recursos clave** |
|---|---|---|---|---|
| Sprint 0 | 1 (40 h) | Configuración de repositorio, tablero Scrum, entorno AWS de pruebas, modelo de datos | Leonardo y Amalia | GitHub, AWS free tier, PlantUML |
| Sprint 1 | 3 (120 h) | HU08, HU01, HU02 y arquitectura base | Nicolás | PostgreSQL, Susana Cortés para validar HU01 y HU08 |
| Sprint 2 | 2 (80 h) | HU03, HU04 | Amalia | Planillas de prueba de marketplaces, Susana Cortés para validar HU03 |
| Sprint 3 | 2 (80 h) | HU05, HU06, HU07 | Danitza | Smartphones de prueba, Jairo Recabarren, Manuel Rivera |
| Sprint 4 | 2 (80 h) | HU09, HU10 | Leonardo | Susana Cortés para umbrales de stock, generador PDF/Excel |
| Puesta en marcha | 2 (80 h) | Pruebas de aceptación, migración del Excel maestro, capacitación, despliegue | Leonardo | Producción AWS, material de capacitación |

#### 9.6.1 Riesgos asociados a recursos

**Tabla 52. Riesgos asociados a recursos y su mitigación**

| **Riesgo** | **Impacto** | **Mitigación** |
|---|---|---|
| Mala señal de internet o WiFi en la bodega | Bodega no puede usar HU05 y HU06 | Medir cobertura en el Sprint 0; si falla, cotizar un punto de acceso WiFi (aprox. CLP 40.000) |
| Celulares personales antiguos o sin espacio | La PWA no funciona bien en todos los equipos | Probar en el Sprint 3 con los celulares reales de bodega y chofer |
| Baja disponibilidad del cliente para sprint reviews | Se valida tarde y se retrabaja | Fijar al inicio una reunión por sprint de 30 minutos por WhatsApp o videollamada |
| Carga académica de otros ramos | Se cae la dedicación de 10 h/semana | Contingencia del 10 % y reprogramar historias Could Have (HU07, HU10) |
| Conocimiento de infraestructura concentrado en una persona | Si Leonardo falta, nadie puede desplegar | Documentar el despliegue y rotar un segundo integrante en el Sprint 0 |
| Excel maestro actual con datos inconsistentes | La migración inicial carga errores al sistema | Limpieza del catálogo con Jairo Recabarren antes de la puesta en marcha |
