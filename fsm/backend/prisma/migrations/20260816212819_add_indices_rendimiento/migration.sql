-- C6 del informe de auditoria del 2026-08-14 / issue #19.
-- Solo CREATE INDEX: no altera columnas, no crea ni borra tablas.
-- PENDIENTE DE APLICAR. Se materializa con `prisma migrate deploy` en la
-- instalacion definitiva en servidor propio de FiNet. NO aplicar contra la
-- base compartida de Railway.

-- CreateIndex
CREATE INDEX "usuario_id_empresa_idx" ON "usuario"("id_empresa");
-- CreateIndex
CREATE INDEX "cliente_id_empresa_fecha_creacion_idx" ON "cliente"("id_empresa", "fecha_creacion");
-- CreateIndex
CREATE INDEX "direccion_servicio_id_cliente_idx" ON "direccion_servicio"("id_cliente");
-- CreateIndex
CREATE INDEX "plan_id_empresa_idx" ON "plan"("id_empresa");
-- CreateIndex
CREATE INDEX "tipo_equipo_id_empresa_idx" ON "tipo_equipo"("id_empresa");
-- CreateIndex
CREATE INDEX "orden_trabajo_id_empresa_estado_idx" ON "orden_trabajo"("id_empresa", "estado");
-- CreateIndex
CREATE INDEX "orden_trabajo_id_tecnico_estado_idx" ON "orden_trabajo"("id_tecnico", "estado");
-- CreateIndex
CREATE INDEX "orden_trabajo_id_empresa_fecha_creacion_idx" ON "orden_trabajo"("id_empresa", "fecha_creacion");
-- CreateIndex
CREATE INDEX "orden_trabajo_id_cliente_idx" ON "orden_trabajo"("id_cliente");
-- CreateIndex
CREATE INDEX "orden_trabajo_id_empresa_tipo_ot_idx" ON "orden_trabajo"("id_empresa", "tipo_ot");
-- CreateIndex
CREATE INDEX "historial_ot_id_ot_fecha_hora_idx" ON "historial_ot"("id_ot", "fecha_hora");
-- CreateIndex
CREATE INDEX "stock_consumible_id_tipo_equipo_idx" ON "stock_consumible"("id_tipo_equipo");
-- CreateIndex
CREATE INDEX "intento_fallido_rut_intentado_bloqueado_hasta_idx" ON "intento_fallido"("rut_intentado", "bloqueado_hasta");
