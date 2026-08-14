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

Crear el archivo `fsm/backend/.env` con las variables de entorno. **Pedir las credenciales al equipo por el canal privado (no subirlas nunca al repo):**

```bash
DATABASE_URL="pedir al equipo"
JWT_SECRET="pedir al equipo"
FRONTEND_URL="http://localhost:5173"
PORT=3000
CLOUDINARY_CLOUD_NAME="pedir al equipo"
CLOUDINARY_API_KEY="pedir al equipo"
CLOUDINARY_API_SECRET="pedir al equipo"
```

> Las variables de Cloudinary son opcionales para desarrollo local — si se dejan vacías, las fotos se guardan en base64 automáticamente.

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

La BD está en Railway (compartida entre los 4 grupos del proyecto).  
**No ejecutar `prisma db push` ni `prisma migrate dev`** sin coordinar con el equipo — afecta tablas compartidas.

Para cambios de schema, coordinar en el canal del equipo primero.
