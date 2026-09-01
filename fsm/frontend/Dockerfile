# --- Etapa build ---
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
# npm install, no npm ci: en Linux npm exige entradas top-level de @emnapi/core
# y @emnapi/runtime (peers opcionales de @napi-rs/wasm-runtime, el fallback WASM
# de rollup) que el lockfile no incluye, y `npm ci` aborta con
# "Missing: @emnapi/core from lock file". npm install resuelve esa rama sola.
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

# node_modules propio y solo de producción: adapter-node empaqueta el resto
# (vite, svelte, tailwind, typescript no hacen falta en runtime), así que no
# se reutiliza el node_modules completo del builder. npm install --omit=dev
# (no `npm ci`: mismo problema de @emnapi que el builder — `npm ci` valida el
# sync del lockfile completo aunque se omitan devDeps).
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=builder /app/build ./build

EXPOSE 3000

# adapter-node necesita ORIGIN seteado en runtime para validar submits que no
# sean GET (si no, tira "Cross-site POST form submissions are forbidden").
CMD ["node", "build"]
