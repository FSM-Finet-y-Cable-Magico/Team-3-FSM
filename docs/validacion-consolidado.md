# Validación del PR consolidado — 05/09/2026

## Punto de partida

- Repositorio limpio en main; no había cambios locales ajenos que preservar. No se encontraron AGENTS.md aplicables.
- Rama fix/issues-baja-media-consolidado creada desde origin/main actualizado: 29e0526e6c4c5c97e516cd1c589a8af231d489e6. Se volvió a comprobar esa referencia antes de preparar el PR.
- Revisados los issues #19, #22, #24, #30, #36, #38, #39, #40, #41, #43, #47, #50 y #51/#53, con sus comentarios; los PRs #42, #46, #48, #49 y #52 y los documentos disponibles en C:/dev/auditorias.
- #48 y #52 estaban abiertos. Se incorporaron mediante cherry-pick -x los commits 1c29fd89803fa31b7a8ab108fd083e2b85f33122 y 802b9a6af43aa0f6b0b7ca8d8c15ea43fde0e753, conservando la autoría de EduardoUNAB. Se adaptaron sus límites de paginación y el ciclo de vida de las subidas. No se fusionaron ni cambiaron de estado esos PRs.

## Baseline antes de modificar

| Comando | Resultado inicial |
| --- | --- |
| Backend npm run build | Compilación sin errores |
| Backend npx tsc --noEmit | 2 errores: supertest/types e import sin extensión en test/app.e2e-spec.ts |
| Backend npm test -- --runInBand | La suite de AppController falla antes de ejecutar tests: Cannot use import statement outside a module |
| Backend npm run test:e2e -- --runInBand | Mismo fallo de módulos; 0 tests ejecutados |
| Frontend npm run check / npm run build | Fallan por falta de @sveltejs/adapter-node en node_modules, aunque ya estaba declarado; se instalaron las dependencias existentes para completar el entorno |

La instalación inicial del frontend no implicó una actualización masiva. Los únicos paquetes de desarrollo nuevos solicitados por este PR son @playwright/test 1.63.0 y @types/node 24.12.4 para las pruebas reproducibles de navegador. No se cambian versiones de dependencias preexistentes ni dependencias del backend.

## Resultado final ejecutado

Entorno: Windows, Node 24.19.0, Prisma generado 7.8.0, Jest 30.4.2 y ts-jest 29.4.11. PUBLIC_API_URL local: http://127.0.0.1:3000. Los tests del backend fijan variables de prueba antes de cargar AppModule, incluido DATABASE_URL en 127.0.0.1:1 y claves ficticias.

| Comando | Resultado |
| --- | --- |
| Backend npx prisma generate | Cliente 7.8.0 generado correctamente, sin migrar la base |
| Backend npm run build | Aprobado |
| Backend npx tsc --noEmit | Aprobado, 0 errores |
| Backend npm test -- --runInBand | 3 suites, 17 pruebas aprobadas |
| Backend npm run test:e2e -- --runInBand | 1 suite, 50 pruebas aprobadas |
| Frontend npm run check | 0 errores, 17 advertencias en 7 archivos; no se silenciaron diagnósticos |
| Frontend npm run build | Aprobado con adapter-auto |
| Frontend npm run test:e2e (PLAYWRIGHT_CHANNEL=msedge) | 9 pruebas aprobadas, 0 omitidas, 0 reintentos de la suite |
| git diff --check | Sin errores al completar el trabajo |

La advertencia de Node sobre VM Modules es esperada para Jest ESM. En este entorno, adapter-auto no detecta un destino de producción durante el build local; no significa que se haya desplegado la aplicación.

Las primeras corridas de navegador detectaron fallos del propio arnés (intercepción demasiado amplia de rutas, interacción antes de hidratación y un selector con texto incorrecto). Se corrigieron y se ejecutaron nuevamente todos los casos; no se omitió ninguna prueba fallida. La comprobación final de tipos también detectó la necesidad de @types/node para el arnés; se añadió explícitamente. Los estilos Tailwind compartidos se ubicaron en app.css, evitando diagnósticos de directivas desconocidas dentro de componentes.

## Evidencia funcional y visual

- Guards reales: login público; 401 para tokens ausentes, inválidos o vencidos; 403 para roles insuficientes y para handlers sin @Roles.
- Servicios reales: autorización por asignación/empresa; técnicos propios/ajenos/sin asignar; 404 en recursos inexistentes/de otra empresa; cierre y foto siguen siendo exclusivos de TECNICO, también al invocar el servicio directamente.
- CloudinaryService real: advertencia de arranque sin secretos, 503 sin configuración, subida exitosa y fallida con el transporte simulado. El cierre HTTP rechaza data URIs y otros protocolos antes de persistir; el camino válido registra evidencia, material, llamada, historial y auditoría.
- Consultas: paginación de Clientes con 125 filas de su empresa y otras 5 ajenas; límite efectivo de 100, segunda página, valores no finitos/offsets inválidos y metadatos coherentes. El detalle limita a las 20 transiciones más recientes de un conjunto de 25. También se comprueba la paginación del SQL de listarOT con el Prisma.Sql real.
- Navegador: paginación de Clientes, rutas directas y menú del técnico, miniaturas diferidas, eliminación mientras otra foto sube, fallas, salida con lote pendiente, cierre que envía la URL remota y navegación SPA entre IDs de OT.
- Revisión visual de capturas de Clientes en escritorio, historial expandido, previsualización de evidencia a 390×844 y banner de error de subida. Se conserva el diseño y la geometría de los componentes. Los screenshots se generan en fsm/frontend/test-results, ignorado por Git, con imágenes y datos locales de prueba.

## Correcciones que ya estaban integradas

**#40:** #49 está fusionado desde 19/08/2026. main ya usa mi_dia=true y limit=30 en terreno; calcula el día operativo en America/Santiago en el backend, filtra por empresa/técnico y muestra aviso si totalDia excede lo recibido. No se reimplementó esta vista ni se atribuye ese filtrado a este PR. La limpieza nueva en esa pantalla elimina el userId sin uso (#51) y reutiliza componentes (#24).

**#24 m1:** #46 está fusionado (1c0cd3be4eede43dffe0bc4e983f7f32786603d4). El dashboard ya comprueba destruido después de sus esperas y limpia socket/intervalo en onDestroy. Ese archivo permanece sin cambios frente a main. m10 se cubre en #41.

**#19:** ya están versionados los 13 índices de 20260816212819_add_indices_rendimiento. No se modificaron schema.prisma ni migraciones.

## Límites y pendientes

- El motor de Docker Desktop no está iniciado (pipe dockerDesktopLinuxEngine no disponible). No se levantó PostgreSQL aislado ni se comprobó la aplicación local de índices; esa verificación era opcional para este alcance. Las pruebas autorizadas usan dobles en memoria.
- El navegador integrado y el visor local fallaron al iniciar su entorno aislado. La revisión se completó con Playwright/Edge en una sesión nueva, usando ejecución aprobada y capturas locales.
- No se consultaron ni modificaron Railway o bases compartidas. No se verificó su esquema, sus índices ni la configuración efectiva de despliegue.
- No se midió transferencia contra Cloudinary real ni se usaron credenciales del servicio. El contrato y las URLs generadas están probados con dobles; no se atribuyen mediciones de rendimiento reales a estas pruebas.
- La persistencia en memoria no comprueba planes SQL, concurrencia o rollback reales de PostgreSQL.
- Las evidencias históricas no fueron inspeccionadas, borradas ni convertidas. Se documenta la consulta de solo lectura y la recuperación separada que correspondería si existen casos.
- #24 sigue parcial por m5 (cookies HttpOnly); #51 por índices/fechas; #38 por el documento académico externo; #47/#19 por el destino compartido y su procedimiento efectivo. #36 y la decisión de unicidad del RUT de #30 permanecen fuera de alcance.
