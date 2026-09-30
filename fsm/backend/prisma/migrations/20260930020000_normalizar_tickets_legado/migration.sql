-- Normaliza los tickets escritos ANTES del modulo de tickets (CU-29/30/32).
--
-- Produccion tiene 10 filas con un vocabulario que no es el de
-- `tickets.constants.ts`: "Abierto", "Escalado", "Resuelto", "Cerrado" y
-- "cerrado", con prioridades y origenes en caja mezclada. Comprobado contra los
-- datos: ninguna calza literal, ninguna admite transicion --`TRANSICIONES_TICKET`
-- devuelve vacio para un estado que no conoce-- ninguna se puede reclasificar, y
-- el filtro por estado, que compara exacto, no las encuentra. O sea que quedan
-- inertes: se ven en el listado pero no se pueden gestionar.
--
-- Nada las esta regenerando: `POST /integraciones/tickets` escribe el
-- vocabulario canonico, asi que esto es de una sola vez.
--
-- Solo DATOS. No toca el esquema. Se aplica con `prisma migrate deploy` en la
-- ventana anunciada a G1 y G8, como las demas.

-- 1. Caja distinta, mismo significado.
UPDATE "ticket" SET "estado" = 'ABIERTO'
 WHERE upper("estado") = 'ABIERTO' AND "estado" <> 'ABIERTO';

-- 2. "Cerrado" no existe en el modelo nuevo: RESUELTO es el estado terminal y
--    es el que lleva `fecha_cierre`. Las dos filas afectadas ya la tienen, asi
--    que el mapeo no inventa nada.
UPDATE "ticket" SET "estado" = 'RESUELTO'
 WHERE upper("estado") IN ('RESUELTO', 'CERRADO') AND "estado" <> 'RESUELTO';

-- 3. "Escalado" NO es DERIVADO_OT por defecto. DERIVADO_OT afirma que existe
--    una OT --de ahi sale, y a ella vuelve al completarse o cancelarse-- y las
--    tres filas con ese estado no tienen ninguna OT ligada. Marcarlas asi seria
--    dejarlas esperando algo que no existe.
--
--    Se decide por el dato, no por el caso: con tecnico asignado hay alguien
--    trabajandolo (EN_PROGRESO); sin nadie asignado, vuelve a la cola (ABIERTO).
UPDATE "ticket" SET "estado" = CASE
         WHEN "id_usuario_asignado" IS NOT NULL THEN 'EN_PROGRESO'
         ELSE 'ABIERTO'
       END
 WHERE upper("estado") = 'ESCALADO'
   AND NOT EXISTS (SELECT 1 FROM "orden_trabajo" o WHERE o."id_ticket" = "ticket"."id_ticket");

-- 4. Un "Escalado" que SI tenga OT es exactamente DERIVADO_OT. Hoy no hay
--    ninguno, pero la regla queda escrita para que el resultado no dependa de
--    cuando se corra.
UPDATE "ticket" SET "estado" = 'DERIVADO_OT'
 WHERE upper("estado") = 'ESCALADO'
   AND EXISTS (SELECT 1 FROM "orden_trabajo" o WHERE o."id_ticket" = "ticket"."id_ticket");

-- 5. Prioridad y origen: solo caja. "CRM" se conserva tal cual; es de donde
--    vinieron de verdad cinco de estos tickets y se agrega al vocabulario en
--    vez de reescribirlo como otro canal.
UPDATE "ticket" SET "prioridad" = upper("prioridad")
 WHERE "prioridad" <> upper("prioridad");

UPDATE "ticket" SET "origen" = upper("origen")
 WHERE "origen" IS NOT NULL AND "origen" <> upper("origen");
