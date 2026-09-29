-- P0-a del acuerdo con G8 (Respuesta de G8 del 24-09, §4 y §11).
--
-- Tabla NUEVA y propia de G3: guarda cada solicitud de instalacion que llega por
-- POST /api/integraciones/instalaciones, con su snapshot de persona y direccion
-- y la correlacion con el CRM (request_id, trace_id, prospecto, contrato, plan).
--
-- Es aditiva: no modifica ninguna tabla existente. La unica FK es hacia
-- orden_trabajo, que es de G3; los ids de G8 y id_empresa van sin FK.
--
-- Se aplica SOLO con `prisma migrate deploy`, en la ventana anunciada a G1 y G8
-- con este SQL compartido antes. Nunca `db push` ni `migrate dev` contra Railway.

-- CreateTable
CREATE TABLE "solicitud_instalacion_integracion" (
    "id_solicitud" SERIAL NOT NULL,
    "request_id" VARCHAR(100) NOT NULL,
    "trace_id" VARCHAR(100) NOT NULL,
    "hash_payload" VARCHAR(64) NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_prospecto_externo" INTEGER NOT NULL,
    "id_contrato_externo" INTEGER NOT NULL,
    "id_plan_externo" INTEGER,
    "rut" VARCHAR(12) NOT NULL,
    "nombre_completo" VARCHAR(120) NOT NULL,
    "telefono" VARCHAR(21) NOT NULL,
    "direccion_completa" VARCHAR(200) NOT NULL,
    "comuna" VARCHAR(80) NOT NULL,
    "ciudad" VARCHAR(80),
    "observaciones" TEXT,
    "requisitos_equipamiento" JSONB,
    "id_ot" INTEGER,
    "estado" VARCHAR(30) NOT NULL,
    "fecha_creacion" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitud_instalacion_integracion_pkey" PRIMARY KEY ("id_solicitud")
);

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_instalacion_integracion_request_id_key" ON "solicitud_instalacion_integracion"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_instalacion_integracion_id_ot_key" ON "solicitud_instalacion_integracion"("id_ot");

-- CreateIndex
CREATE INDEX "solicitud_instalacion_integracion_id_empresa_idx" ON "solicitud_instalacion_integracion"("id_empresa");

-- AddForeignKey
ALTER TABLE "solicitud_instalacion_integracion" ADD CONSTRAINT "solicitud_instalacion_integracion_id_ot_fkey" FOREIGN KEY ("id_ot") REFERENCES "orden_trabajo"("id_ot") ON DELETE SET NULL ON UPDATE CASCADE;

