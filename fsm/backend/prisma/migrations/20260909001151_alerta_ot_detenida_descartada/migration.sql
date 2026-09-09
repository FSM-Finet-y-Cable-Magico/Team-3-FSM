-- AlterTable
ALTER TABLE "orden_trabajo" ADD COLUMN     "alerta_detenida_descartada_en" TIMESTAMP(3),
ADD COLUMN     "alerta_detenida_descartada_por" INTEGER;
