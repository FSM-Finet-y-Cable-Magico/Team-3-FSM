-- Puertos por caja SmartOLT (ver docs/superpowers/specs/2026-11-12-puertos-caja-smartolt-design.md).
--
-- Aditiva: una columna nullable y una tabla nueva, sin tocar filas existentes.
--
-- Se aplica UNA vez. Los IF NOT EXISTS protegen la columna, la tabla y el
-- indice, pero la FK no tiene guarda: correrla dos veces falla en el ultimo
-- paso. En la base global de la VPS la aplica el admin a mano (`g3_app` no
-- puede alterar el esquema), y tiene que ser ANTES de desplegar este codigo:
-- sin la columna `odb_puerto`, la ingesta falla en cada sondeo.

-- AlterTable
ALTER TABLE "registro_ont" ADD COLUMN IF NOT EXISTS "odb_puerto" SMALLINT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "odb_smartolt" (
    "id_odb_smartolt" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_externo" VARCHAR(40) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "capacidad" SMALLINT,
    "zona" VARCHAR(80),
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "odb_smartolt_pkey" PRIMARY KEY ("id_odb_smartolt")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "odb_smartolt_id_empresa_id_externo_key" ON "odb_smartolt"("id_empresa", "id_externo");

-- AddForeignKey
ALTER TABLE "odb_smartolt" ADD CONSTRAINT "odb_smartolt_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresa"("id_empresa") ON DELETE RESTRICT ON UPDATE CASCADE;
