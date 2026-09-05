
-- AlterTable
ALTER TABLE "empresa" ADD COLUMN     "umbral_desconexion_min" SMALLINT;

-- AlterTable
ALTER TABLE "registro_ont" ADD COLUMN     "id_empresa" INTEGER;

-- CreateTable
CREATE TABLE "alerta" (
    "id_alerta" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "severidad" VARCHAR(15),
    "mensaje" TEXT,
    "id_registro_ont" INTEGER,
    "id_cliente" INTEGER,
    "clave_caja" VARCHAR(120),
    "id_caja_nap" INTEGER,
    "resuelta" BOOLEAN NOT NULL DEFAULT false,
    "resuelta_por" INTEGER,
    "observacion_resolucion" TEXT,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resuelta_en" TIMESTAMP(3),

    CONSTRAINT "alerta_pkey" PRIMARY KEY ("id_alerta")
);

-- CreateIndex
CREATE INDEX "alerta_id_empresa_resuelta_idx" ON "alerta"("id_empresa", "resuelta");

-- CreateIndex
CREATE INDEX "alerta_tipo_clave_caja_resuelta_idx" ON "alerta"("tipo", "clave_caja", "resuelta");

-- CreateIndex
CREATE INDEX "registro_ont_id_empresa_idx" ON "registro_ont"("id_empresa");

-- AddForeignKey
ALTER TABLE "registro_ont" ADD CONSTRAINT "registro_ont_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresa"("id_empresa") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresa"("id_empresa") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_id_registro_ont_fkey" FOREIGN KEY ("id_registro_ont") REFERENCES "registro_ont"("id_registro_ont") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "cliente"("id_cliente") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_id_caja_nap_fkey" FOREIGN KEY ("id_caja_nap") REFERENCES "caja_nap"("id_caja_nap") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_resuelta_por_fkey" FOREIGN KEY ("resuelta_por") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;
