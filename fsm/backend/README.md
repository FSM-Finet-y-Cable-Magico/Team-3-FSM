# Backend FSM

NestJS con módulos ESM/NodeNext y cliente Prisma generado. Consultar la [instalación general](../../README.md) y el [procedimiento de despliegue](../../docs/despliegue.md).

## Compilación y pruebas

Desde esta carpeta, tras npm install:

~~~sh
npx prisma generate
npm run build
npx tsc --noEmit
npm test -- --runInBand
npm run test:e2e -- --runInBand
~~~

Jest usa ts-jest en ESM con el tsconfig real, resuelve imports relativos .js y carga el cliente Prisma generado sin reemplazarlo por un stub. Los scripts activan --experimental-vm-modules en Node: su advertencia es esperada. No se cambió el sistema de módulos de producción ni se actualizaron dependencias del backend.

Las suites definen variables locales de prueba antes de importar AppModule. La suite HTTP conserva los guards globales, estrategia JWT, DTO, servicios de OT/Clientes y CloudinaryService; reemplaza PrismaService por persistencia en memoria, AuthService por un doble de credenciales y el transporte de Cloudinary por un doble. No conecta con PostgreSQL, Cloudinary ni Railway. La batería deriva del arnés de #43/#42; amplía su alcance a la autorización de negocio y evita el stub del cliente generado que requería el parche CommonJS original.

Cubren permisos por rol/asignación/empresa, login público, handlers sin roles, tokens ausentes/incorrectos/expirados, consulta y cambios de estado, subida y cierre, URLs inválidas, paginación e historial limitado. Los dobles no validan planes SQL, bloqueos o rollback reales de PostgreSQL ni la conectividad con la cuenta real de Cloudinary.

## Ejecución local

npm run start:dev requiere una base local aislada y JWT_SECRET propios. Sin Cloudinary el arranque permanece disponible y las subidas devuelven 503. Leer [evidencias](../../docs/evidencias-y-api.md) para el contrato y el saneamiento histórico pendiente.
