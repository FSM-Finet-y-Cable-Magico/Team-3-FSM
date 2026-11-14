-- Columnas que la tabla `usuario` de la base global ya tiene (medido el
-- 14-11). IF NOT EXISTS: contra la global no hace nada; en una base propia
-- (local, pruebas) las agrega igual que alla.
ALTER TABLE "usuario" ADD COLUMN IF NOT EXISTS "rut" VARCHAR(12);
ALTER TABLE "usuario" ADD COLUMN IF NOT EXISTS "debe_cambiar_password" BOOLEAN DEFAULT false;
ALTER TABLE "usuario" ADD COLUMN IF NOT EXISTS "fecha_eliminacion" TIMESTAMPTZ(6);
