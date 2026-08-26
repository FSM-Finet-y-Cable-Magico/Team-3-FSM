# --- Etapa build ---
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
# npm ci falla acá: @tailwindcss/oxide resuelve una dependencia nativa
# opcional distinta en Linux/musl que en Windows, y esa rama no queda
# grabada en el lockfile generado en Windows. npm install la resuelve sola.
RUN npm install

COPY . .

# PUBLIC_API_URL se hornea en el bundle al momento del build (SvelteKit usa
# $env/static/public), por eso entra como build arg y no como env var de runtime.
ARG PUBLIC_API_URL=http://localhost:3000
ENV PUBLIC_API_URL=$PUBLIC_API_URL
ENV BUILD_ADAPTER=node

RUN npm run build

# --- Etapa producción ---
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

# adapter-node necesita ORIGIN seteado en runtime para validar submits que no
# sean GET (si no, tira "Cross-site POST form submissions are forbidden").
CMD ["node", "build"]
