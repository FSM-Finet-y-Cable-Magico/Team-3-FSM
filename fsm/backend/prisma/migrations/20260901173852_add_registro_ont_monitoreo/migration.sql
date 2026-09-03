-- AlterTable
ALTER TABLE "historial_conexion_ont" ADD COLUMN     "id_registro_ont" INTEGER;

-- AlterTable
ALTER TABLE "monitoreo_ont" ADD COLUMN     "id_registro_ont" INTEGER;

-- AlterTable
ALTER TABLE "orden_trabajo" ALTER COLUMN "fecha_programada" SET DATA TYPE TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "registro_ont" (
    "id_registro_ont" SERIAL NOT NULL,
    "numero_serie" VARCHAR(80) NOT NULL,
    "id_externo" VARCHAR(40),
    "olt_externo" VARCHAR(40),
    "board" SMALLINT,
    "puerto_pon" SMALLINT,
    "zona" VARCHAR(80),
    "odb" VARCHAR(50),
    "modelo" VARCHAR(80),
    "nombre_cliente_ext" VARCHAR(160),
    "direccion_cliente_ext" VARCHAR(200),
    "id_unidad" INTEGER,
    "id_cliente" INTEGER,
    "id_caja_nap" INTEGER,
    "primera_vez" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultima_vez" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registro_ont_pkey" PRIMARY KEY ("id_registro_ont")
);

-- CreateIndex
CREATE UNIQUE INDEX "registro_ont_numero_serie_key" ON "registro_ont"("numero_serie");

-- CreateIndex
CREATE INDEX "monitoreo_ont_id_registro_ont_timestamp_medicion_idx" ON "monitoreo_ont"("id_registro_ont", "timestamp_medicion");

-- AddForeignKey
ALTER TABLE "monitoreo_ont" ADD CONSTRAINT "monitoreo_ont_id_registro_ont_fkey" FOREIGN KEY ("id_registro_ont") REFERENCES "registro_ont"("id_registro_ont") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_conexion_ont" ADD CONSTRAINT "historial_conexion_ont_id_registro_ont_fkey" FOREIGN KEY ("id_registro_ont") REFERENCES "registro_ont"("id_registro_ont") ON DELETE SET NULL ON UPDATE CASCADE;
