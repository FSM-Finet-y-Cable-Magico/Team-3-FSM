# Arquitectura actual y evolución por incremento

Estado contrastado con main en 29e0526e6c4c5c97e516cd1c589a8af231d489e6 (5 de septiembre de 2026) y con los cambios de este PR. La existencia de una tabla en Prisma no implica que su módulo funcional esté implementado.

## Módulos que funcionan hoy

| Módulo | Responsabilidad y ubicación |
| --- | --- |
| AuthModule | Login JWT, cambio de contraseña y gestión de usuarios; src/auth. Los guards globales ejecutan autenticación antes de roles. |
| ClientesModule | Registro, ficha, consulta por RUT, conflictividad, planes e historial de OT; src/clientes. El listado y la gestión están reservados a ADMIN/JEFE_TECNICO. |
| OrdenesModule | Crear, asignar, consultar, cambiar estado, subir evidencia y cerrar OT; src/ordenes. Centraliza permisos por asignación y empresa. |
| DashboardModule | Indicadores de gestión de OT y técnicos; src/dashboard. El WebSocket notifica cambios a la sala de cada empresa. **No equivale a monitorear ONT.** |
| CloudinaryModule | Infraestructura de subida de evidencias extraída en este PR; src/cloudinary. No es un nuevo módulo funcional de negocio. |
| PrismaModule / ConfigModule | Persistencia y configuración. Prisma y sus migraciones son la fuente del esquema. |

Técnicos permanece dentro de OrdenesModule: consulta de técnicos y carga de OT activas, además de la asignación; las cuentas se administran en AuthModule. Inventario todavía no tiene módulo propio: el catálogo de materiales y el descuento de stock con movimiento/auditoría viven en OrdenesService.cerrarOT. Mantener esas ubicaciones evita una extracción sin necesidad funcional en este incremento.

El frontend SvelteKit separa escritorio (rutas del grupo app) y terreno. Las APIs de lib/api consumen la API Nest; los stores mantienen la sesión y el estado del dashboard. Alert, Spinner, Cargando y Paginacion concentran patrones comunes. La sesión continúa en sessionStorage: m5 de #24 está pendiente.

## Arquitectura objetivo y alcance por incremento

| Etapa | Estado / objetivo respaldado por los documentos disponibles |
| --- | --- |
| Incremento 1, integrado en main | Auth, Clientes, OT, técnicos dentro de OT y dashboard de indicadores. El cierre ya registra evidencias, materiales, potencia y llamada. |
| Incremento 2, planificación | Planta externa y topología; monitoreo de ONT/alertas; ampliación de operaciones de OT y reportería/notificaciones. Estas capacidades requieren servicios y pantallas propios y coordinación sobre DTO, esquema y transacción de cierre. No se incorporan en este PR. |
| Incrementos posteriores / decisiones pendientes | Inventario como módulo propio y consolidación de Notificaciones/Monitoreo según alcance aprobado. La extracción de Técnicos puede evaluarse si crecen sus responsabilidades. No se fija una fecha ni un compromiso de entrega nuevo. |

La arquitectura declarada originalmente (OT, Monitoreo, Técnicos, Inventario y Notificaciones) representa un objetivo, no la lista de módulos hoy montados. Debe incorporar también Auth y Clientes, y separar indicadores del dashboard de telemetría de ONT.

Fuentes consultadas: issues #38 y #24; contexto-proyecto.md (25/08/2026); plan-incremento-2-programacion.md y auditoria-plan-incremento-2-2026-09-04.md, disponibles durante la revisión en C:/dev/auditorias. La auditoría del plan advierte que parte de la infraestructura de SmartOLT/Tomodat se describía desde una rama aún no integrada. Este documento describe **main**, sin asumir que esa rama se haya entregado ni que su despliegue funcione.

El documento académico externo no estuvo disponible y **no fue actualizado**. #38 queda parcialmente atendido: resta trasladar/referenciar esta arquitectura en el entregable del curso. Cuando se agregue un módulo, actualizar esta tabla junto al cambio de app.module.ts.

## Decisiones que permanecen abiertas

- #36: restricciones y referencias de movimiento_inventario; sin cambios de esquema aquí.
- #30: el RUT actualmente tiene unicidad global en Prisma y el alta busca por RUT sin empresa. Es comportamiento existente, **no una decisión de negocio aprobada** en este PR.
- #51: nuevos índices y conversión de fechas/zona horaria requieren trabajo y mediciones separados.
- #24 m5: migración de sessionStorage a cookies HttpOnly.
