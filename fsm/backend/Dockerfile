# --- Etapa build ---
FROM node:24-alpine AS builder
WORKDIR /app

# Solo lo que necesita `npm ci` + el generador de Prisma (postinstall) entra
# primero, para que editar código en src/ no invalide esta capa. El
# generador necesita ver tsconfig.json para emitir imports internos en .js —
# si no lo encuentra, genera un cliente con imports a .ts que node no puede
# resolver.
COPY package.json package-lock.json tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
# npm install, no npm ci: en Linux npm exige entradas top-level de @emnapi/core
# y @emnapi/runtime (peers opcionales de @napi-rs/wasm-runtime, vía
# unrs-resolver) que el lockfile no incluye, y `npm ci` aborta con
# "Missing: @emnapi/core from lock file". npm install resuelve esa rama sola.
RUN npm install

COPY . .
RUN npm run build

# --- Etapa producción ---
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Se copia node_modules completo (incluye prisma CLI, tsx para correr el
# seed, y devDeps de nest build) para poder correr `prisma migrate deploy` y
# el seed al iniciar, sin reinstalar nada.
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Aplica migraciones y siembra los datos base (empresas, roles, categorías,
# planes, admin.finet) antes de levantar el server. El seed es idempotente
# (upsert), así que correrlo en cada arranque no duplica ni pisa nada — pero
# sí requiere SEED_ADMIN_PASSWORD definida (ver docker-compose.yml).
# Pensado para una sola instancia (no hay lock entre réplicas) — si en el VPS
# compartido se corre más de una copia del backend a la vez, sacar migración
# y seed de aquí y correrlos aparte como paso de despliegue.
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/src/main"]
