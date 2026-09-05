ALTER TABLE "orden_trabajo" ADD COLUMN "id_caja_nap" INTEGER;
ALTER TABLE "orden_trabajo" ADD CONSTRAINT "orden_trabajo_id_caja_nap_fkey"
  FOREIGN KEY ("id_caja_nap") REFERENCES "caja_nap"("id_caja_nap") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "orden_trabajo_id_caja_nap_idx" ON "orden_trabajo"("id_caja_nap");
