ALTER TABLE "registro_ont" ADD COLUMN "caja_confirmada_por" INTEGER;
ALTER TABLE "registro_ont" ADD COLUMN "caja_confirmada_en" TIMESTAMP(3);
ALTER TABLE "registro_ont" ADD CONSTRAINT "registro_ont_caja_confirmada_por_fkey"
  FOREIGN KEY ("caja_confirmada_por") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;
