-- RF-49: categoria de falla al cerrar OT de reparacion
-- RF-09: observacion de cliente ausente
ALTER TABLE "orden_trabajo" ADD COLUMN "id_categoria_falla" INTEGER;
ALTER TABLE "orden_trabajo" ADD COLUMN "categoria_falla_otro" VARCHAR(120);
ALTER TABLE "orden_trabajo" ADD COLUMN "obs_cliente_ausente" VARCHAR(500);

ALTER TABLE "orden_trabajo"
  ADD CONSTRAINT "orden_trabajo_id_categoria_falla_fkey"
  FOREIGN KEY ("id_categoria_falla")
  REFERENCES "categoria_falla"("id_categoria")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
