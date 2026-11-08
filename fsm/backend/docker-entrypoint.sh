#!/bin/sh
# Arranque del backend en contenedor.
#
# Antes esto era un `sh -c "migrate deploy && db seed && node ..."` dentro del
# CMD. Se saco a un archivo por dos razones: para poder apagar la migracion
# sin reconstruir la imagen, y porque con `exec` el proceso de node queda como
# PID 1 y recibe las senales de `docker stop` en vez de que las coma el shell.
set -e

# MIGRAR_AL_ARRANCAR decide si el contenedor aplica migraciones y siembra
# antes de levantar.
#
# ENCENDIDO POR DEFECTO: es el comportamiento de siempre y el que necesita
# nuestra propia base, donde el despliegue es "git pull && up -d" y no hay un
# paso manual que aplique el esquema.
#
# Se apaga SOLO contra una base que no administramos. En
# `finet_global_validacion` el usuario `g3_app` no tiene CREATE en `public`,
# asi que `prisma migrate deploy` falla; como iba encadenado con `&&`, el
# contenedor nunca llegaba a `node` y quedaba en crash-loop. El seed falla por
# lo mismo: hace upsert en `rol` y `empresa`, donde solo tenemos SELECT.
#
# Opt-out explicito: solo el string exacto "false" lo apaga. Un valor vacio o
# mal escrito deja las migraciones encendidas, que es el lado seguro --el
# esquema desactualizado es peor que una migracion de mas--. Mismo criterio
# que AVISOS_MANTENCION_ENABLED en docker-compose.vps.yml.
if [ "${MIGRAR_AL_ARRANCAR:-true}" = "false" ]; then
  echo "[arranque] MIGRAR_AL_ARRANCAR=false: no se aplican migraciones ni seed."
  echo "[arranque] El esquema y los datos base los administra otro."
else
  echo "[arranque] Aplicando migraciones..."
  npx prisma migrate deploy

  echo "[arranque] Sembrando datos base..."
  npx prisma db seed
fi

echo "[arranque] Levantando el servidor."
exec node dist/src/main
