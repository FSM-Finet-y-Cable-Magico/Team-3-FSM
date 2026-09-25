# Arquitectura actual y evolución por incremento

Estado contrastado con main en 29e0526e6c4c5c97e516cd1c589a8af231d489e6 (5 de septiembre de 2026) y con los cambios de este PR. La existencia de una tabla en Prisma no implica que su módulo funcional esté implementado.

## Módulos que funcionan hoy

| Módulo | Responsabilidad y ubicación |
| --- | --- |
| AuthModule | Login JWT, cambio de contraseña y gestión de usuarios; src/auth. Los guards globales ejecutan autenticación antes de roles. |
| ClientesModule | Registro, ficha, consulta por RUT, conflictividad, planes e historial de OT; src/clientes. El listado y la gestión están reservados a ADMIN/JEFE_TECNICO. |
| OrdenesModule | Crear, asignar, consultar, cambiar estado, subir evidencia y cerrar OT; src/ordenes. Centraliza permisos por asignación y empresa. |
| DashboardModule | Indicadores de gestión de OT y técnicos; src/dashboard. El WebSocket notifica cambios a la sala de cada empresa. **No equivale a monitorear ONT.** |
| CloudinaryModule | Infraestructura de subida de evidencias extraída en este PR; src/cloudinary. No es un nuevo módulo funcional de negocio. |
| PrismaModule / ConfigModule | Persistencia y configuración. Prisma y sus migraciones son la fuente del esquema. |

Técnicos permanece dentro de OrdenesModule: consulta de técnicos y carga de OT activas, además de la asignación; las cuentas se administran en AuthModule. Inventario todavía no tiene módulo propio: el catálogo de materiales y el descuento de stock con movimiento/auditoría viven en OrdenesService.cerrarOT. Mantener esas ubicaciones evita una extracción sin necesidad funcional en este incremento.

El frontend SvelteKit separa escritorio (rutas del grupo app) y terreno. Las APIs de lib/api consumen la API Nest; los stores mantienen la sesión y el estado del dashboard. Alert, Spinner, Cargando y Paginacion concentran patrones comunes. La sesión se guarda en sessionStorage por decisión explícita: ver ADR-001 más abajo.

## Arquitectura objetivo y alcance por incremento

| Etapa | Estado / objetivo respaldado por los documentos disponibles |
| --- | --- |
| Incremento 1, integrado en main | Auth, Clientes, OT, técnicos dentro de OT y dashboard de indicadores. El cierre ya registra evidencias, materiales, potencia y llamada. |
| Incremento 2, planificación | Planta externa y topología; monitoreo de ONT/alertas; ampliación de operaciones de OT y reportería/notificaciones. Estas capacidades requieren servicios y pantallas propios y coordinación sobre DTO, esquema y transacción de cierre. No se incorporan en este PR. |
| Incrementos posteriores / decisiones pendientes | Inventario como módulo propio y consolidación de Notificaciones/Monitoreo según alcance aprobado. La extracción de Técnicos puede evaluarse si crecen sus responsabilidades. No se fija una fecha ni un compromiso de entrega nuevo. |

La arquitectura declarada originalmente (OT, Monitoreo, Técnicos, Inventario y Notificaciones) representa un objetivo, no la lista de módulos hoy montados. Debe incorporar también Auth y Clientes, y separar indicadores del dashboard de telemetría de ONT.

Fuentes consultadas: issues #38 y #24; contexto-proyecto.md (25/08/2026); plan-incremento-2-programacion.md y auditoria-plan-incremento-2-2026-09-04.md, disponibles durante la revisión en C:/dev/auditorias. La auditoría del plan advierte que parte de la infraestructura de SmartOLT/Tomodat se describía desde una rama aún no integrada. Este documento describe **main**, sin asumir que esa rama se haya entregado ni que su despliegue funcione.

El documento académico externo no estuvo disponible y **no fue actualizado**. #38 queda parcialmente atendido: resta trasladar/referenciar esta arquitectura en el entregable del curso. Cuando se agregue un módulo, actualizar esta tabla junto al cambio de app.module.ts.

## Registro de decisiones de arquitectura

### ADR-001 · Almacenamiento del token de sesión en la Vista

| | |
| --- | --- |
| **Estado** | Aceptada |
| **Fecha** | 11 de septiembre de 2026 |
| **Origen** | m5 de #24 y auditoría de XSS de la Vista del 11 de septiembre de 2026 |
| **Revisión** | Condicionada al dominio (ver *Condición de revisión*) |

#### Contexto

- La Vista (SvelteKit) está desplegada en Vercel, bajo `*.vercel.app`, y el Controlador (NestJS) en Railway. Son **dominios registrables distintos**.
- El Controlador autentica con un JWT en la cabecera `Authorization: Bearer` (`JwtStrategy` con `ExtractJwt.fromAuthHeaderAsBearerToken`). La Vista guarda ese token en `sessionStorage` (`lib/stores/auth.store.ts`) y lo pasa de forma explícita a cada llamada de `lib/api`. Los sockets lo envían en el `auth` del handshake.
- m5 de #24 advirtió que `sessionStorage` es legible por cualquier script que corra en la página: un XSS permitiría leer el token y llevárselo.
- **RNF-10** obliga a que la plataforma funcione en Safari Mobile sobre iOS, y los técnicos entran desde el navegador del celular.

#### Alternativas evaluadas

| Criterio | JWT en `sessionStorage` + `Bearer` (actual) | Cookie `httpOnly` |
| --- | --- | --- |
| Token ante un XSS | Legible: el script puede leerlo y exfiltrarlo | No legible desde JavaScript. El script igual puede hacer peticiones como el usuario mientras la página esté abierta |
| Vista y Controlador en dominios distintos | Funciona igual en todos los navegadores | Es cookie de terceros: exige `SameSite=None; Secure`, y **Safari/iOS la bloquea** por defecto |
| CSRF | No aplica: el navegador no adjunta el token por su cuenta | Requiere protección: con `SameSite=None` la cookie viaja también en peticiones que inician otros sitios |
| Vida de la sesión | Termina al cerrar la pestaña | La fija la cookie |
| Cambios necesarios | Ninguno | Emitir la cookie, leerla en `JwtStrategy`, protección CSRF, `credentials: 'include'` en cada petición, autenticar los sockets por cookie y ajustar los 34 archivos de la Vista que hoy pasan el token |

#### Decisión

Se **mantiene el JWT en `sessionStorage`**, enviado como `Authorization: Bearer`. No se migra a cookie `httpOnly` mientras la Vista y el Controlador estén en dominios registrables distintos.

#### Justificación

1. **La cookie incumpliría RNF-10.** En este despliegue sería de terceros y Safari/iOS no la enviaría: los técnicos quedarían sin sesión justo en el dispositivo con el que trabajan. Es un requisito ya comprometido con el cliente.
2. **La auditoría de XSS del 11 de septiembre sostiene la premisa** de que hoy no hay vía para ejecutar scripts inyectados en la Vista:
   - Los 5 `{@html}` pintan SVG constantes del código (menú lateral, `StatCard` y el botón de actualizar del dashboard). Ninguno recibe datos del usuario ni de la base.
   - Los campos de texto libre (razón de cliente conflictivo, observaciones de cierre, categoría de falla "otro" y plantillas de notificación con variables como `{{cliente}}`) se interpolan como texto, que Svelte escapa. Los links dentro de las observaciones se arman sin `{@html}` y solo con tramos que empiezan con `http(s)://`.
   - No hay `innerHTML`, `insertAdjacentHTML`, `eval`, `new Function` ni `document.write`. `app.html` no carga scripts de terceros, y la única dependencia de ejecución es `socket.io-client`.
   - En la base no hay marcado ni esquemas peligrosos guardados en esos campos.
   - Aparecieron dos huecos **latentes**, que no se pueden explotar desde la API y que corrige el PR #85: el enlace de la galería de fotos de la OT usaba la URL de la base sin revisar su esquema, y el prop `icono` de `StatCard`, que se pinta con `{@html}`, aceptaba cualquier `string`.

#### Consecuencias

- **Riesgo aceptado:** si en el futuro entra un XSS, podrá leer el token. La defensa depende de no abrir vías de inyección, así que en la Vista rigen dos reglas:
  - `{@html}` solo con constantes del código, nunca con datos.
  - Toda URL que venga de datos y termine en un `href` pasa por `urlSegura()` (`lib/utils/url.ts`).
- **No hay Content-Security-Policy configurada:** nada en `svelte.config.js`, ni hooks, ni cabeceras de Vercel. Hoy nada contendría un script inyectado ni un enlace `javascript:`. Queda planificada para después de la entrega del 13 de septiembre, **empezando por `Content-Security-Policy-Report-Only`** durante unos días antes de aplicarla. Así se detecta sin romper lo que una política estricta afectaría: las clases de Tailwind y los estilos en línea de Svelte (`style-src`), la API y Socket.io (`connect-src`) y las imágenes de Cloudinary (`img-src`).
- **La validación de URLs vive solo en el DTO del Controlador** (`FotoDto`, `@IsUrl` con `http` y `https`). La base es compartida con otros grupos, así que lo que se escriba sin pasar por la API no se valida. Ya hay 15 filas de `evidencia_foto` con `data:image` que ese DTO rechazaría (#53). Por eso la Vista no confía en las URLs que lee de la base.
- **El token se lee y se pasa a mano en 266 lugares de 34 archivos.** Después del 13 de septiembre se centraliza en un único cliente de API con interceptor. Será un refactor puro (mismos endpoints, cabeceras, errores, login y redirección por rol): sin cambiar dónde se guarda el token, sin tocar los sockets ni `JwtStrategy`, respetando el cierre por inactividad de RNF-08 (30 minutos; 60 para ADMIN) y en commits separados por área. **Ese refactor deja la migración futura a cookie acotada a uno o dos archivos de la Vista** (el cliente de API y el store de sesión), en lugar de 34. Del lado del Controlador seguirán haciendo falta la emisión de la cookie, `JwtStrategy`, CORS y los sockets.

#### Condición de revisión

Esta decisión se revisa **cuando la Vista y el Controlador queden bajo el mismo dominio registrable**, por ejemplo `app.finet.cl` y `api.finet.cl`. Recién ahí el navegador trata la cookie como propia del sitio: Safari la envía y basta `SameSite=Lax`, que además mitiga el CSRF desde otros sitios.

- **No es "cuando tengamos el VPS".** FiNet va a contratar un VPS más adelante, pero un VPS con la Vista y el Controlador en dominios distintos no habilita la migración: la habilita el dominio, no el servidor.
- Tampoco la habilitan dos dominios propios distintos, como `finet-app.cl` y `finet-api.cl`: para el navegador siguen siendo sitios distintos.

## Decisiones que permanecen abiertas

- #36: restricciones y referencias de movimiento_inventario; sin cambios de esquema aquí.
- #30: el RUT actualmente tiene unicidad global en Prisma y el alta busca por RUT sin empresa. Es comportamiento existente, **no una decisión de negocio aprobada** en este PR.
- #51: nuevos índices y conversión de fechas/zona horaria requieren trabajo y mediciones separados.
