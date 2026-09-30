# Arquitectura actual y evolución por incremento

Estado contrastado con la rama del Incremento 3 (29 de septiembre de 2026). La existencia de una tabla en Prisma no implica que su módulo funcional esté implementado.

## Módulos que funcionan hoy

| Módulo | Responsabilidad y ubicación |
| --- | --- |
| AuthModule | Login JWT, cambio de contraseña, alta, listado y desactivación de cuentas (CU-43); src/auth. La estrategia JWT rechaza el token de una cuenta desactivada y resuelve la empresa activa del ADMIN (CU-33, header X-Empresa-Activa). Los guards globales ejecutan autenticación antes de roles. |
| ClientesModule | Registro, ficha, búsqueda (incluida por zona), historial por dirección (CU-07), semáforo de riesgo (MOD RF-32), lista roja por RUT y dirección (CU-35), baja de servicio (CU-25) y catálogo de planes en solo lectura; src/clientes. |
| OrdenesModule | Crear, asignar, consultar, cambiar estado, subir evidencia y cerrar OT; aprobación del cierre (MOD RF-04), resolución remota (CU-56), llamadas de cortesía (CU-31) y reserva de puerto NAP (CU-20); src/ordenes. Arma el payload de cierre para G1 y G8 y decide cuándo avisarlo (CIERRE_FAN_OUT_MOMENTO). |
| TicketsModule | Tickets de soporte: alta, gestión, reclasificación y derivación a OT (CU-29, CU-30, CU-32); src/tickets. Sin migración: model ticket ya existía. |
| IntegracionesModule | API servidor a servidor para G1 y G8 con X-API-KEY: órdenes, cierres y reconciliación, solicitudes de instalación sin cliente (P0 de G8), estado de una OT y tickets desde canales digitales; src/integraciones. |
| DashboardModule | Indicadores de OT y técnicos, cierres por aprobar y rechazados del día, y consolidado de empresas (CU-34); src/dashboard. El WebSocket notifica cambios a la sala de cada empresa. **No equivale a monitorear ONT.** |
| MonitoreoModule | Lecturas de ONT, alertas de red e historial de interrupciones por ONT (CU-14); src/monitoreo. El poller consulta la fuente (SmartOLT o mock). |
| PlantaExternaModule | Topología, cajas y puertos NAP, importación KML y reconciliación de puertos con las ONT ligadas (CU-20); src/planta-externa. |
| ReportesModule | Reportes diario, periódicos, a pedido y comparativo, con exportación, y resumen diario de materiales (CU-23); src/reportes. |
| NotificacionesModule | Plantillas, avisos masivos por alerta y avisos anticipados de mantención con su poller (CU-50); src/notificaciones. Todo envío se registra SIMULADO: no hay proveedor contratado. |
| AuditoriaModule | Consulta y exportación del log de auditoría (CU-41), solo ADMIN; src/auditoria. |
| ConfiguracionModule | Umbral de desconexión por empresa (RF-46); src/configuracion. |
| CloudinaryModule | Infraestructura de subida de evidencias; src/cloudinary. No es un módulo funcional de negocio. |
| PrismaModule / ConfigModule | Persistencia y configuración. Prisma y sus migraciones son la fuente del esquema. |

Técnicos permanece dentro de OrdenesModule: consulta de técnicos y carga de OT activas, además de la asignación; las cuentas se administran en AuthModule. Inventario no es de G3: desde el acuerdo con G1 (Opción A), el cierre solo **declara** los materiales y equipos usados y G1 valida saldo y descuenta. G3 no escribe movimiento_inventario.

El frontend SvelteKit separa escritorio (/admin) y terreno (/terreno). Las APIs de lib/api consumen la API Nest a través de http.ts, que agrega el token y la empresa activa del ADMIN a toda petición; los stores mantienen la sesión, la empresa activa y el estado del dashboard. La sesión se guarda en sessionStorage por decisión explícita: ver ADR-001 más abajo.

## Arquitectura objetivo y alcance por incremento

| Etapa | Estado |
| --- | --- |
| Incremento 1 | Auth, Clientes, OT, técnicos dentro de OT y dashboard de indicadores. |
| Incremento 2 | Planta externa y topología, monitoreo de ONT y alertas, reportería, notificaciones, integración con G1. |
| Incremento 3 | Tickets, aprobación del cierre, integración con G8 (P0), auditoría, empresa activa, semáforo y lista roja, baja de servicio, puertos NAP, avisos de mantención y las pantallas sobre backend existente (CU-14, CU-23, CU-34). |
| Fuera de alcance declarado | CU-36 (deuda: dominio comercial), personalización del plan por contrato (RF-53, B-01), CU-24 en escritura (inventario es de G1), el envío real de notificaciones y el catálogo administrable de zonas (del Grupo 2, D-02). |

Migraciones del Incremento 3, todas aditivas: solicitud_instalacion_integracion (ventana 1, P0 de G8); lista_negra.nivel y log_notificacion.id_ot (ventana 2). Se aplican solo con `prisma migrate deploy` en la ventana anunciada a G1 y G8.

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
