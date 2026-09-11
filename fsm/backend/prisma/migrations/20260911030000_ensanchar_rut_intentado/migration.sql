-- `intento_fallido.rut_intentado` guarda el nombre de usuario del intento, no un
-- RUT: el login es por `nombre_usuario` desde CU-39, pero la columna se quedo con
-- el tipo del diseno original, VarChar(12).
--
-- `usuario.nombre_usuario` admite 50 caracteres y el formato acordado es
-- "nombre.apellido", asi que casi todas las cuentas de tecnico pasan de 12. Para
-- esas, el INSERT de cada intento fallido violaba el largo y reventaba:
--
--   * el 401 de "usuario o contrasena incorrectos" salia como 500, porque el
--     registro del intento ocurre ANTES de lanzar el 401; y
--   * no quedaba ninguna fila, asi que el bloqueo por intentos fallidos de C6
--     (#19) nunca se activaba para esas cuentas: la consulta de bloqueo busca
--     justamente por `rut_intentado`.
--
-- Solo se amplia el largo. Ampliar un VarChar no reescribe la tabla ni toca las
-- filas existentes, y el indice (rut_intentado, bloqueado_hasta) se mantiene.
ALTER TABLE "intento_fallido"
  ALTER COLUMN "rut_intentado" TYPE VARCHAR(50);
