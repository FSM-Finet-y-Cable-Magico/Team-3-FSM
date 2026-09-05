-- Renombra `alerta` a `alerta_monitoreo` para alinear con el nombre acordado
-- en el acta de levantamiento con FiNet (migración M-01 de ese documento).
--
-- Va como migración nueva y no editando la que creó la tabla, porque esa ya
-- está en la rama remota y algún compañero puede haberla aplicado: reescribir
-- una migración aplicada deja su base en un estado que Prisma ya no reconoce.
--
-- Se renombran también constraints, índices y la secuencia: `ALTER TABLE ...
-- RENAME TO` deja esos nombres con el prefijo viejo, y Prisma los vería como
-- drift en la próxima migración.

ALTER TABLE "alerta" RENAME TO "alerta_monitoreo";

ALTER TABLE "alerta_monitoreo" RENAME CONSTRAINT "alerta_pkey" TO "alerta_monitoreo_pkey";
ALTER TABLE "alerta_monitoreo" RENAME CONSTRAINT "alerta_id_empresa_fkey" TO "alerta_monitoreo_id_empresa_fkey";
ALTER TABLE "alerta_monitoreo" RENAME CONSTRAINT "alerta_id_cliente_fkey" TO "alerta_monitoreo_id_cliente_fkey";
ALTER TABLE "alerta_monitoreo" RENAME CONSTRAINT "alerta_id_caja_nap_fkey" TO "alerta_monitoreo_id_caja_nap_fkey";
ALTER TABLE "alerta_monitoreo" RENAME CONSTRAINT "alerta_id_registro_ont_fkey" TO "alerta_monitoreo_id_registro_ont_fkey";
ALTER TABLE "alerta_monitoreo" RENAME CONSTRAINT "alerta_id_ot_generada_fkey" TO "alerta_monitoreo_id_ot_generada_fkey";
ALTER TABLE "alerta_monitoreo" RENAME CONSTRAINT "alerta_resuelta_por_fkey" TO "alerta_monitoreo_resuelta_por_fkey";

ALTER INDEX "alerta_id_empresa_resuelta_idx" RENAME TO "alerta_monitoreo_id_empresa_resuelta_idx";
ALTER INDEX "alerta_tipo_clave_caja_resuelta_idx" RENAME TO "alerta_monitoreo_tipo_clave_caja_resuelta_idx";

ALTER SEQUENCE "alerta_id_alerta_seq" RENAME TO "alerta_monitoreo_id_alerta_seq";
