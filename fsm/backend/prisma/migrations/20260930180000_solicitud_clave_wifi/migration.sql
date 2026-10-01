-- Acuerdo con G2 §6.4: el portal manda la clave WiFi cifrada por endpoint y no
-- por la base compartida, porque el §6.5 prohibe que G8 pueda leerla.
--
-- Tabla NUEVA y nuestra: no toca ninguna tabla ni fila existente. G2 la escribe
-- solo a traves de POST /api/integraciones/contrasena-wifi.
--
-- `clave_cifrada` guarda el ciphertext TAL COMO LLEGA, cifrado con nuestra
-- llave publica. No se descifra para guardarlo: G8 puede leer la fila y no
-- puede descifrarla, que es justo lo que pide el §6.5.
--
-- Se aplica sola al desplegar: el CMD del Dockerfile corre `prisma migrate
-- deploy` antes de arrancar (ver #47, resuelto). Es CREATE TABLE, aditivo, asi
-- que no necesita ventana: no toca nada que G1 ni G8 esten leyendo.

-- CreateTable
CREATE TABLE "solicitud_clave_wifi" (
    "id_solicitud" SERIAL NOT NULL,
    "request_id" VARCHAR(64) NOT NULL,
    "huella" VARCHAR(64) NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_contrato" INTEGER NOT NULL,
    "id_ticket" VARCHAR(64) NOT NULL,
    "trace_id" VARCHAR(64) NOT NULL,
    "clave_cifrada" TEXT NOT NULL,
    "leida_en" TIMESTAMP(3),
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitud_clave_wifi_pkey" PRIMARY KEY ("id_solicitud")
);

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_clave_wifi_request_id_key" ON "solicitud_clave_wifi"("request_id");

-- CreateIndex
CREATE INDEX "solicitud_clave_wifi_id_empresa_estado_idx" ON "solicitud_clave_wifi"("id_empresa", "estado");
