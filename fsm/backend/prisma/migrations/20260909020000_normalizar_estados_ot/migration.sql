-- Normaliza a mayusculas los valores de `orden_trabajo` que llegaron en
-- formato titulo.
--
-- Por que existe esto: `orden_trabajo` es una tabla compartida y el CRM del
-- Grupo 8 escribe su propio vocabulario --'Instalacion', 'Pendiente',
-- 'Completada', 'Media'-- mientras el nuestro es en mayusculas. Como todas
-- nuestras consultas comparan contra el valor exacto, esas filas quedan
-- invisibles: no salen en el listado de OT, no se pueden asignar, no entran en
-- los reportes y no las ve el tecnico.
--
-- En produccion habia 5 filas asi. La peor era la OT 23, creada el 16 de junio,
-- en 'Pendiente' y sin una sola entrada de historial: nadie de nuestro lado la
-- vio nunca, asi que esa instalacion jamas se agendo.
--
-- OJO: esto arregla lo que ya esta, NO evita que vuelva a pasar. Mientras el
-- Grupo 8 siga escribiendo su vocabulario van a aparecer filas nuevas. La
-- solucion de fondo es acordar UN vocabulario para estas tres columnas, y eso
-- es coordinacion entre grupos, no codigo.
--
-- No se hace UPPER() a ciegas: solo se toca la fila si su valor en mayusculas
-- coincide con uno del catalogo. Un valor que no reconocemos --con tilde, o de
-- otro sistema-- se deja como esta y sigue a la vista, en vez de quedar
-- convertido en algo que no era.

UPDATE orden_trabajo
SET estado = UPPER(estado)
WHERE estado IS NOT NULL
  AND estado <> UPPER(estado)
  AND UPPER(estado) IN (
    'PENDIENTE', 'PENDIENTE_CLIENTE_AUSENTE', 'ASIGNADA',
    'EN_CURSO', 'COMPLETADA', 'CANCELADA'
  );

UPDATE orden_trabajo
SET tipo_ot = UPPER(tipo_ot)
WHERE tipo_ot IS NOT NULL
  AND tipo_ot <> UPPER(tipo_ot)
  AND UPPER(tipo_ot) IN (
    'INSTALACION', 'REPARACION', 'REEMPLAZO', 'PREVENTIVO', 'BAJA'
  );

UPDATE orden_trabajo
SET prioridad = UPPER(prioridad)
WHERE prioridad IS NOT NULL
  AND prioridad <> UPPER(prioridad)
  AND UPPER(prioridad) IN ('CRITICA', 'ALTA', 'MEDIA', 'BAJA');

-- `cliente.estado` esta peor que las de arriba.
--
-- En produccion conviven SEIS grafias sobre 22 clientes: 'Activo' (9),
-- 'activo' (6), 'ACTIVO' (3), 'Pendiente' (2), 'Baja' (1) y 'Moroso' (1).
-- Nosotros filtramos por 'ACTIVO' exacto, asi que el dashboard informa
-- 3 clientes activos cuando en realidad hay 18. Es un 83 % menos, y en el
-- indicador mas visible que tiene el sistema.
--
-- Aca no hay un catalogo escrito de nuestro lado --el DTO acepta cualquier
-- texto, cosa que tambien hay que arreglar-- asi que se listan una por una las
-- grafias que existen hoy y se entienden. Cualquier otra queda sin tocar.
--
-- Pasar 'Activo' a 'ACTIVO' no cambia el significado de nada: es la misma
-- palabra. Lo que si hay que acordar con el Grupo 8 es CUALES son los estados
-- validos, y eso no lo resuelve una migracion.

UPDATE cliente
SET estado = UPPER(estado)
WHERE estado IS NOT NULL
  AND estado <> UPPER(estado)
  AND UPPER(estado) IN ('ACTIVO', 'PENDIENTE', 'BAJA', 'MOROSO', 'SUSPENDIDO');
