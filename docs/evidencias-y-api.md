# Evidencias, permisos y consultas acotadas

## Acceso a OT

| Operación | ADMIN / JEFE_TECNICO | TECNICO |
| --- | --- | --- |
| GET /api/ordenes/:id | OT de su empresa | Solo OT asignadas a su usuario |
| PATCH /api/ordenes/:id/estado | OT de su empresa | Solo OT asignadas a su usuario |
| POST /api/ordenes/:id/foto | 403 por rol | Solo OT asignadas a su usuario |
| POST /api/ordenes/:id/cerrar | 403 por rol | Solo OT asignadas a su usuario y estado EN_CURSO |

La regla por asignación vive en OrdenesService y usa entidades tipadas. Un técnico que intenta acceder a una OT ajena de su empresa recibe 403 con «No tienes permiso para ver esta OT.». Una OT inexistente o de otra empresa mantiene 404, salvo operaciones rechazadas previamente por rol. La autorización de foto consulta solo id_tecnico; no hidrata el detalle ni su historial.

## Prevención de nuevas evidencias en base64

CloudinaryService recibe configuración mediante ConfigService. Si falta cualquiera de sus tres valores, registra una advertencia al arrancar sin valores ni secretos; subir una foto devuelve 503. Se puede seguir desarrollando el resto de las funciones. No existe un modo de persistencia local en base64.

La subida usa un stream y responde siempre con url_cloudinary, formato y tamano_kb derivados de la respuesta del proveedor. Un fallo del SDK devuelve un mensaje 503 sin detalles internos. FotoDto valida URLs HTTP(S) con protocolo explícito, también cuando se envía el cierre directamente sin usar la pantalla de subida; rechaza data:, javascript:, ftp: y URLs relativas.

Las miniaturas del historial solicitan f_auto,q_auto,w_128,h_128,c_fill para contenedores de 64 px, con carga diferida. Las previsualizaciones del cierre usan object URLs del archivo local. Se revocan al eliminar, fallar o desmontar; una navegación cancela peticiones pendientes y evita que continúe el lote de archivos. Cambiar entre dos rutas de cierre reinicia el ciclo de vida de la pantalla. Cancelar la petición del navegador no garantiza borrar una imagen que el proveedor ya hubiera recibido: no se implementa eliminación remota automática.

Las URLs históricas no transformables y firmadas se conservan. La optimización de descarga no borra ni convierte evidencias históricas.

## Comprobación histórica de solo lectura y recuperación pendiente

No se inspeccionó la base remota y no se afirma que existan o no filas antiguas en base64. Un responsable con acceso puede contar casos sin volcar imágenes ni datos de clientes:

~~~sql
BEGIN TRANSACTION READ ONLY;
SELECT ot.id_empresa, COUNT(*) AS evidencias_embebidas,
       SUM(octet_length(f.url_cloudinary)) AS bytes_texto
FROM evidencia_foto f
JOIN orden_trabajo ot ON ot.id_ot = f.id_ot
WHERE f.url_cloudinary LIKE 'data:%'
GROUP BY ot.id_empresa;
COMMIT;
~~~

Si hay casos, la recuperación requiere otro trabajo autorizado: respaldo; inventario de IDs y empresa; validación del contenido; carga a la cuenta de imágenes acordada; verificación de cada objeto; reemplazo transaccional de la URL con trazabilidad y plan de reversión. No eliminar la evidencia anterior antes de comprobar su recuperación. **Prevenir nuevos casos no sanea los históricos**; este PR no ejecuta ese proceso.

## Paginación e historial

GET /api/clientes y GET /api/ordenes usan la misma normalización: por defecto page=1 y limit=20; máximo 100 por página. Se aceptan cadenas numéricas, se truncan fracciones, cero vuelve al valor por defecto y negativos se acotan a 1. Entradas no numéricas/no finitas vuelven al valor por defecto. Una página cuyo offset exceda el entero permitido por PostgreSQL vuelve a 1. La respuesta devuelve page y limit efectivos, junto a total y data.

El detalle de OT incluye las 20 transiciones más recientes, ordenadas por fecha descendente. El timeline existente consume esa ventana. Consultar el historial completo necesitaría una funcionalidad paginada aparte; aumentar silenciosamente el límite no sustituye esa funcionalidad.
