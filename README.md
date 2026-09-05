# Team 3 FSM — FiNet & Cable Mágico Litoral

Sistema de Gestión de Órdenes de Trabajo (FSM) para técnicos en terreno.

**Stack:** NestJS · Prisma · PostgreSQL (Railway) · SvelteKit · Tailwind CSS

---

## Requisitos previos

- [Node.js](https://nodejs.org/) v20 o superior
- npm v9 o superior
- Git

---

## Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/FSM-Finet-y-Cable-Magico/Team-3-FSM.git
cd Team-3-FSM
```

### 2. Configurar el Backend

```bash
cd fsm/backend
npm install
```

Crear el archivo `fsm/backend/.env` a partir de su ejemplo y usar una base local aislada. Para desarrollo y pruebas, definir valores propios, sin reutilizar credenciales remotas:

```bash
DATABASE_URL="postgresql://fsm:fsm@127.0.0.1:5432/fsm"
JWT_SECRET="reemplazar-por-un-secreto-local-propio"
FRONTEND_URL="http://localhost:5173"
PORT=3000
CLOUDINARY_CLOUD_NAME=""
CLOUDINARY_API_KEY=""
CLOUDINARY_API_SECRET=""
SEED_ADMIN_PASSWORD=""
```

> Cloudinary es opcional para desarrollar las demás funciones. Sin configuración, el backend avisa al arrancar y subir evidencia devuelve 503. El cierre solo admite URLs HTTP(S); no se guardan imágenes en base64. Ver [evidencias y recuperación histórica](docs/evidencias-y-api.md).

> `SEED_ADMIN_PASSWORD` solo hace falta si se va a sembrar la base (ver más abajo). No tiene valor por defecto a propósito.

Generar el cliente Prisma:

```bash
npx prisma generate
```

### 3. Configurar el Frontend

```bash
cd fsm/frontend
npm install
cp .env.example .env
```

`.env.example` ya trae el valor para desarrollo local (`PUBLIC_API_URL=http://localhost:3000`), así que no hay que editar nada para levantar el proyecto. Sin este paso el build y `npm run dev` fallan con `"PUBLIC_API_URL" is not exported by "$env/static/public"`.

### 4. Migrar y sembrar la base local (solo si hace falta)

Comprobar primero que DATABASE_URL apunta a una base local aislada y ejecutar `npx prisma migrate deploy` desde el backend. Consultar los [flujos manual, Docker y despliegue compartido](docs/despliegue.md) antes de operar sobre una base.

Sembrar **requiere definir `SEED_ADMIN_PASSWORD`** en `fsm/backend/.env`: es la contraseña inicial del usuario `admin.finet`. El seed no trae ninguna contraseña por defecto y falla con un error si la variable no está definida, para que ninguna base quede con una credencial conocida.

```bash
cd fsm/backend
npx prisma db seed
```

Elegir una contraseña propia, no reutilizar la de otro entorno y no subirla al repo. En el primer ingreso el sistema obliga a cambiarla (CU-39). Si el usuario `admin.finet` ya existe, el seed **no** lo modifica: no pisa la contraseña que se haya cambiado después.

---

## Correr la aplicación

### Backend (puerto 3000)

```bash
cd fsm/backend
npm run start:dev
```

### Frontend (puerto 5173)

```bash
cd fsm/frontend
npm run dev
```

Abrir en el navegador: [http://localhost:5173](http://localhost:5173)

---

## Alternativa: Docker Compose

Levanta Postgres + backend + frontend con un solo comando, contra una base **local y aislada** (no la de Railway). Útil para probar en una máquina sin Node instalado, o sin tocar la base compartida.

```bash
cp .env.example .env   # el de la raíz del repo — no confundir con fsm/backend/.env.example ni fsm/frontend/.env.example, que son para el flujo manual de arriba
```

Completar como mínimo `JWT_SECRET` y `SEED_ADMIN_PASSWORD` (cualquier valor sirve, es una base nueva). Cloudinary es opcional.

```bash
docker compose up --build
```

Migra y siembra la base automáticamente al arrancar (empresas, roles, categorías, planes y `admin.finet` con la contraseña de `SEED_ADMIN_PASSWORD`) — no hace falta correr `prisma db seed` a mano. El seed es idempotente, así que reiniciar el stack no duplica nada.

Backend en `:3000`, frontend en `:5173`.

> Si cambian `PUBLIC_API_URL` en el `.env` después de un `up` inicial, necesitan repetir con `--build` — se hornea en el build del frontend, un `up -d` sin rebuild reusa la imagen vieja y el navegador sigue apuntando a la URL anterior.

---

## Credenciales de prueba

Pedir al equipo por el canal privado.

---

## Estructura del proyecto

```
fsm/
├── backend/                 # API REST — NestJS + Prisma
│   ├── src/
│   │   ├── auth/            # Login, JWT, cambio de contraseña
│   │   ├── clientes/        # Gestión de clientes y fichas
│   │   ├── ordenes/         # OT: crear, asignar, cerrar, historial
│   │   ├── dashboard/       # Indicadores en tiempo real (WebSocket)
│   │   └── prisma/          # Conexión a base de datos
│   └── prisma/
│       └── schema.prisma    # Esquema de la BD
│
└── frontend/                # SvelteKit + Tailwind CSS v4
    └── src/
        ├── lib/
        │   ├── api/         # Clientes HTTP hacia el backend
        │   ├── components/  # Componentes reutilizables
        │   └── stores/      # Estado global (auth, dashboard)
        └── routes/
            ├── (app)/       # Vistas escritorio (admin / jefe técnico)
            │   ├── dashboard/
            │   ├── clientes/
            │   └── ot/
            └── terreno/     # Vistas móvil (técnico en terreno)
```

---

## Flujos principales

### Escritorio (Admin / Jefe Técnico)
1. Login → Dashboard con indicadores en tiempo real
2. Clientes → buscar por RUT, crear, editar, marcar conflictivo, ver historial de fallas
3. Órdenes de Trabajo → crear OT, asignar técnico con bloque horario, cambiar estados
4. Usuarios → crear y gestionar cuentas

### Móvil (Técnico)
1. Login → redirige automáticamente a `/terreno`
2. Ver OT del día asignadas
3. Iniciar trabajo (ASIGNADA → EN_CURSO)
4. Cerrar OT con wizard: fotos → materiales → potencia óptica + llamada de cortesía
5. Ver historial de fallas del cliente

---

## Base de datos

El entorno compartido usa Railway (entre los 4 grupos del proyecto); el desarrollo y las pruebas deben usar una base local aislada o dobles en memoria.
**No ejecutar `prisma db push` ni `prisma migrate dev`** sin coordinar con el equipo — afecta tablas compartidas.

Para cambios de schema, coordinar en el canal del equipo primero.


## Arquitectura y validación

[Resultados y límites de la validación del PR consolidado](docs/validacion-consolidado.md).

- [Módulos actuales y objetivo por incremento](docs/arquitectura.md).
- [Desarrollo local, Docker y despliegue compartido](docs/despliegue.md).
- [Permisos, evidencias e historial/paginación](docs/evidencias-y-api.md).
- [Comandos de pruebas del backend](fsm/backend/README.md) y [pruebas de navegador del frontend](fsm/frontend/README.md).

La fuente del esquema es `fsm/backend/prisma/schema.prisma` junto con `prisma/migrations`. `mere_finet.sql` es una referencia histórica no autoritativa. Los 13 índices de #19 ya están versionados; su aplicación debe comprobarse en cada base de destino.
