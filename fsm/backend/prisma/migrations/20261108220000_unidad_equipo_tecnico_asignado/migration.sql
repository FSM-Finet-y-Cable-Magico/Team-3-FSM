-- El FSM valida la serie de un equipo al cerrar una OT: para instalarlo, el
-- equipo tiene que estar asignado AL tecnico que cierra. Ese dato lo escribe
-- G1 en `unidad_equipo.id_tecnico_asignado`.
--
-- En la base compartida `finet_global_validacion` la columna YA existe (el
-- modelo consolidado la trae) y esta migracion no se corre ahi: contra esa
-- base el contenedor arranca con MIGRAR_AL_ARRANCAR=false. Es para nuestra
-- base propia y los ambientes de desarrollo, donde faltaba.
--
-- Aditiva y nullable: no toca ninguna fila. IF NOT EXISTS por si se aplica
-- sobre una base que ya la tenga.

-- AlterTable
ALTER TABLE "unidad_equipo" ADD COLUMN IF NOT EXISTS "id_tecnico_asignado" INTEGER;
