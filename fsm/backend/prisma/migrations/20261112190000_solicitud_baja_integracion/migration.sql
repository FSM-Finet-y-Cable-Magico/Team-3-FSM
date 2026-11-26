-- Retiro por morosidad pedido por G8 (acuerdo del 12-11-2026).
--
-- Igual que `solicitud_instalacion_integracion`: sin FK a tablas compartidas y
-- con los ids de G8 sueltos. La UNICA FK es a `orden_trabajo`, que es nuestra.
--
-- Contra `finet_global_validacion` esta migracion NO corre: `g3_app` no tiene
-- CREATE en `public`. La tiene que aplicar el administrador del esquema, igual
-- que aplico la tabla de instalaciones. Hasta entonces el endpoint de bajas
-- funciona solo contra la base propia.
CREATE TABLE "solicitud_baja_integracion" (
    "id_solicitud" SERIAL NOT NULL,
    "request_id" VARCHAR(150) NOT NULL,
    "trace_id" VARCHAR(100) NOT NULL,
    "hash_payload" VARCHAR(64) NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_cliente_externo" INTEGER NOT NULL,
    "id_contrato_externo" INTEGER NOT NULL,
    "id_servicio_externo" INTEGER NOT NULL,
    "id_solicitud_retiro_externa" INTEGER NOT NULL,
    "id_ticket_externo" INTEGER,
    "rut_cliente" VARCHAR(12) NOT NULL,
    "direccion_retiro" VARCHAR(200) NOT NULL,
    "comuna_retiro" VARCHAR(80) NOT NULL,
    "observaciones" TEXT,
    "id_ot" INTEGER,
    "estado" VARCHAR(30) NOT NULL,
    "motivo_cancelacion" VARCHAR(300),
    "fecha_creacion" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitud_baja_integracion_pkey" PRIMARY KEY ("id_solicitud")
);

CREATE UNIQUE INDEX "solicitud_baja_integracion_request_id_key" ON "solicitud_baja_integracion"("request_id");

CREATE UNIQUE INDEX "solicitud_baja_integracion_id_ot_key" ON "solicitud_baja_integracion"("id_ot");

CREATE INDEX "solicitud_baja_integracion_id_empresa_idx" ON "solicitud_baja_integracion"("id_empresa");

ALTER TABLE "solicitud_baja_integracion"
  ADD CONSTRAINT "solicitud_baja_integracion_id_ot_fkey"
  FOREIGN KEY ("id_ot") REFERENCES "orden_trabajo"("id_ot") ON DELETE SET NULL ON UPDATE CASCADE;
