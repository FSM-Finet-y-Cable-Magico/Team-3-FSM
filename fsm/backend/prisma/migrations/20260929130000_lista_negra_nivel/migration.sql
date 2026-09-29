-- MOD RF-32 (semaforo de riesgo) y CU-35 (lista roja por direccion), D3 del plan.
--
-- Columna NUEVA y nullable en lista_negra, tabla de G3: no toca filas existentes
-- ni otras tablas. Las filas previas quedan con nivel NULL, que el servicio lee
-- como ROJO porque marcaban "conflictivo".
--
-- Se aplica SOLO con `prisma migrate deploy`, en la ventana anunciada a G1 y G8.

-- AlterTable
ALTER TABLE "lista_negra" ADD COLUMN     "nivel" VARCHAR(10);

