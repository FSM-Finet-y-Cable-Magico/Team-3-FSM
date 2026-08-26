# --- Etapa build ---
FROM node:24-alpine AS builder
WORKDIR /app

# Todo el código entra antes de instalar: el generador de Prisma (postinstall)
# necesita ver tsconfig.json para emitir imports internos en .js — si no lo
# encuentra, genera un cliente con imports a .ts que node no puede resolver.
COPY . .

# npm ci falla acá: hay dependencias nativas opcionales cuya resolución en
# Linux difiere de la que quedó grabada en el lockfile generado en Windows.
# npm install resuelve la diferencia sin tocar el resto.
RUN npm install

RUN npm run build

# --- Etapa producción ---
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Se copia node_modules completo (incluye prisma CLI y devDeps de nest build)
# para poder correr `prisma migrate deploy` al iniciar, sin reinstalar nada.
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Aplica migraciones pendientes contra DATABASE_URL antes de levantar el server.
# Pensado para una sola instancia (no hay lock entre réplicas) — si en el VPS
# compartido se corre más de una copia del backend a la vez, sacar la migración
# de aquí y correrla aparte como paso de despliegue.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
