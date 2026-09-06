# Desarrollo local y despliegue compartido

## Flujo manual local

Usar una base local o de pruebas separada y comprobar host, puerto, nombre y propietario antes de cualquier escritura. Las suites automatizadas del backend usan dobles en memoria y un DATABASE_URL de prueba en 127.0.0.1:1; no necesitan PostgreSQL ni credenciales del equipo.

Para ejecutar la aplicación con PostgreSQL local:

1. Copiar fsm/backend/.env.example y fsm/frontend/.env.example a sus archivos .env respectivos. Definir credenciales propias de esa base y un JWT_SECRET local.
2. Instalar dependencias en cada proyecto con npm install. En backend, npm install ejecuta prisma generate: genera TypeScript, **no aplica migraciones**.
3. Solo después de comprobar que DATABASE_URL apunta a la base local aislada, ejecutar desde fsm/backend:

~~~sh
npx prisma migrate deploy
# Opcional, para crear los datos iniciales; exige SEED_ADMIN_PASSWORD propia.
npx prisma db seed
npm run start:dev
~~~

4. Desde fsm/frontend, ejecutar npm run dev. PUBLIC_API_URL debe indicar el backend local.

El seed no modifica la contraseña de admin.finet si ya existe. Generación del cliente, migración y seed son tres operaciones distintas.

## Docker local

El docker-compose.yml versionado crea su propio PostgreSQL, conecta el backend a postgres:5432 y publica la base en loopback. Su DATABASE_URL se construye dentro de Compose; no toma la URL del backend manual. Usar credenciales nuevas en el .env de la raíz y un nombre de proyecto propio para separar el volumen de otros stacks locales:

~~~sh
cp .env.example .env
# Completar JWT_SECRET y SEED_ADMIN_PASSWORD con valores locales.
docker compose -p fsm-pruebas up --build
~~~

El puerto 5432 debe estar libre. Cambiar el nombre del proyecto separa volúmenes, pero no evita conflictos de puertos.

**El Dockerfile actual ya incluía** en main el CMD que ejecuta prisma migrate deploy, prisma db seed y luego node dist/src/main. Este PR documenta ese comportamiento; no lo introduce. La imagen modifica la base indicada en DATABASE_URL al arrancar: este flujo se destina a la base local de Compose. Para varias réplicas hay que separar migración/seed del arranque, según advierte el propio Dockerfile.

PUBLIC_API_URL se incorpora al build del frontend; cambiarlo requiere reconstruir la imagen. Sin Cloudinary el backend arranca, avisa en logs y la subida de evidencia responde 503; el resto de las funciones queda disponible.

## Railway y otras bases compartidas

No se ejecutaron migraciones, db push, seeds ni escrituras en Railway o bases compartidas durante este trabajo. No se cambiaron credenciales ni configuración de servicios desplegados.

La presencia del Dockerfile **no prueba** qué comandos usa Railway: pueden existir comandos o configuración en su panel que no estén versionados. Antes de un despliegue con cambios de esquema, el responsable debe contrastar la configuración efectiva, los logs y la compatibilidad de la base con los otros grupos, y coordinar el procedimiento en el entorno destino. Este PR no automatiza ese procedimiento ni declara validada la base remota.

## Índices de #19 y estado de migraciones

La migración 20260816212819_add_indices_rendimiento ya estaba en main y contiene 13 CREATE INDEX. Estar versionada no demuestra que esté aplicada ni permite afirmar que los índices falten en una base concreta. Comprobar el destino con consultas de solo lectura:

~~~sql
BEGIN TRANSACTION READ ONLY;
SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"
ORDER BY started_at;
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' ORDER BY tablename, indexname;
COMMIT;
~~~

Contrastar los nombres con el archivo de migración. La comprobación local, si se realiza, solo valida esa base local. #19 y #47 siguen abiertos respecto de la instalación y la configuración real del despliegue compartido.
