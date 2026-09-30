-- CU-50 (aviso anticipado de mantencion, RF-44).
--
-- Columna NUEVA y nullable en log_notificacion, tabla de G3, con su indice y una
-- FK hacia orden_trabajo (tambien de G3). No toca filas existentes.
--
-- Va en la misma ventana que lista_negra.nivel. Solo `prisma migrate deploy`.

-- AlterTable
ALTER TABLE "log_notificacion" ADD COLUMN     "id_ot" INTEGER;

-- CreateIndex
CREATE INDEX "log_notificacion_estado_envio_fecha_envio_idx" ON "log_notificacion"("estado_envio", "fecha_envio");

-- AddForeignKey
ALTER TABLE "log_notificacion" ADD CONSTRAINT "log_notificacion_id_ot_fkey" FOREIGN KEY ("id_ot") REFERENCES "orden_trabajo"("id_ot") ON DELETE SET NULL ON UPDATE CASCADE;

