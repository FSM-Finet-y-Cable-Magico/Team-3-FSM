-- La ultima lectura de una ONT es la de mayor id_monitoreo (la ultima
-- escrita). Sin este indice, cargarEstado ordenaba toda monitoreo_ont en cada
-- carga de topologia y monitoreo: 1,4 M de filas en la VPS el 24-11.
-- IF NOT EXISTS: es una tabla de G3 en la base global; si alguien ya lo creo
-- a mano, no falla.
CREATE INDEX IF NOT EXISTS "monitoreo_ont_id_registro_ont_id_monitoreo_idx"
  ON "monitoreo_ont" ("id_registro_ont", "id_monitoreo" DESC);
