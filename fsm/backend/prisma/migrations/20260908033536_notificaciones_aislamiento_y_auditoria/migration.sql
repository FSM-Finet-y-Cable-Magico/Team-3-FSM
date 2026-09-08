-- AlterTable
ALTER TABLE "log_notificacion" ADD COLUMN     "id_alerta" INTEGER,
ADD COLUMN     "mensaje_enviado" TEXT;

-- AlterTable
ALTER TABLE "plantilla_notificacion" ADD COLUMN     "id_empresa" INTEGER;

-- CreateIndex
CREATE INDEX "log_notificacion_id_alerta_idx" ON "log_notificacion"("id_alerta");

-- CreateIndex
CREATE INDEX "log_notificacion_id_cliente_idx" ON "log_notificacion"("id_cliente");

-- CreateIndex
CREATE INDEX "plantilla_notificacion_id_empresa_idx" ON "plantilla_notificacion"("id_empresa");

-- AddForeignKey
ALTER TABLE "plantilla_notificacion" ADD CONSTRAINT "plantilla_notificacion_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresa"("id_empresa") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_notificacion" ADD CONSTRAINT "log_notificacion_id_alerta_fkey" FOREIGN KEY ("id_alerta") REFERENCES "alerta_monitoreo"("id_alerta") ON DELETE SET NULL ON UPDATE CASCADE;
