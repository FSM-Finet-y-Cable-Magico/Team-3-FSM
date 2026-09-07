ALTER TABLE "alerta" ADD COLUMN "id_ot_generada" INTEGER;
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_id_ot_generada_fkey"
  FOREIGN KEY ("id_ot_generada") REFERENCES "orden_trabajo"("id_ot") ON DELETE SET NULL ON UPDATE CASCADE;
