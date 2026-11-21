# Plan del Incremento 3 — orden para cerrar el 100% del catálogo de CU

**Estado:** propuesta de orden de trabajo. Ventana: dos semanas, 10 días hábiles, 7 personas.

Estado del código contrastado con `origin/main` en 7cf50a3 (11-09-2026). El catálogo de referencia es `Requerimientos-y-Casos-de-uso-Grupo3.docx` (CU-01 a CU-56), más los CU nuevos del acta de levantamiento con FiNet. El Incremento 2 está cerrado: nada de lo que entró ahí se replanifica acá.

**El hallazgo que ordena el plan:** el bloque más grande —tickets, CU-29/30/32— no necesita migración ni decisión de nadie, porque `model ticket` ya existe completo en el esquema. Puede arrancar el Día 1. El camino crítico es otro: la aprobación del cierre de OT (MOD RF-04), que acopla un acuse de G1, un módulo sin tests y rehacer documentación ya entregada en el Incremento 1.

---

## 1. Qué falta para el 100%

### 1.1 Parciales — hay backend, falta cerrar

| CU | Qué falta exactamente |
| --- | --- |
| CU-14 Historial de microdesconexiones | `GET /monitoreo/ont/:sn` existe y funciona; ningún consumidor en el frontend. Falta la vista. |
| CU-20 Disponibilidad de puertos NAP | Código y pantalla existen. `puerto_nap` tiene 14.576 filas todas en `LIBRE`, así que la disponibilidad muestra 100 % falso. Es problema de datos, no de código. |
| CU-23 Resumen diario de materiales | `reportes.service.agruparMateriales` ya lo calcula. Falta vista y flujo propio. |
| CU-31 Llamada de cortesía post-OT | `tx.llamada_cortes.create()` ya corre dentro del cierre. Falta endpoint y vista propios. |
| CU-33 Cambio de empresa activa | El backend acepta `?empresa=` para ADMIN y `GET /dashboard/empresas` ya existe. No hay selector en la vista. |
| CU-34 Datos consolidados de empresas | `GET /dashboard/empresa/:id` ya existe. Falta la pantalla. |
| CU-56 Modalidad de resolución | `resuelto_remotamente` ya está en el DTO de cierre y en el dashboard. Falta tratamiento propio. |

### 1.2 No implementados

| CU | Situación |
| --- | --- |
| CU-29 · CU-30 · CU-32 Tickets de soporte | `model ticket` ya existe completo (`schema.prisma:228`) y `orden_trabajo.id_ticket` es `@unique`. No existe `src/tickets/`. **Sin migración.** |
| CU-07 Historial de cliente por dirección | La búsqueda acepta `?direccion=`, pero no hay historial por dirección. |
| CU-25 Baja de servicio | `cliente.estado='BAJA'` y `tipo_ot='BAJA'` ya son valores válidos. Falta el flujo. |
| CU-35 Verificar cliente en lista roja | `lista_negra.direccion_vetada` existe pero `marcarConflictivo` no la puebla. Falta el chequeo por dirección. |
| CU-41 Consulta del log de auditoría | `log_auditoria` se escribe en todo el sistema. Cero endpoints de consulta. |
| CU-43 Desactivar cuenta de usuario | `usuario.activo` existe. `auth.controller.ts` solo tiene login, cambiar-password, POST y GET usuarios. |
| CU-50 Notificación anticipada de mantención (RF-44, 24 h) | Solo existe la constante `TIPO_EVENTO.MANTENCION_PROGRAMADA`. Sin programación. |

### 1.3 Nuevos del acta con FiNet

Con la renumeración del Día 1: **CU-59** catálogo de planes (lectura), **CU-60** cambio de plan (fuera de alcance), **CU-61** catálogo de zonas, **CU-62** aprobación del cierre de OT. Más **rehacer CU-37** (semáforo de riesgo) y **rehacer CU-04** (aprobación).

---

## 2. Día 1 — seis decisiones que bloquean a todo el equipo

Media jornada de los siete. Sin esto, el Día 2 arranca con siete personas escribiendo sobre supuestos distintos.

**D1 · Renumeración de CU.** El acta asignó CU-57 a CU-62 a sus requerimientos nuevos, pero el documento entregado del Incremento 2 ya usó **CU-57 = servicios activos del cliente** y **CU-58 = búsqueda por criterios múltiples**. Hay colisión. Los CU nuevos pasan a **CU-59 a CU-62**. Publicar la tabla de mapeo acta→catálogo antes de que nadie escriba una ficha.

**D2 · Higiene de repositorio.** Mergear los PR #85 y #86, poner `main` local al día —está 5 commits atrás de `origin/main`— y que todas las ramas del Incremento 3 nazcan de ahí. Hay más de 40 ramas vivas; siete personas partiendo de un main desactualizado se traduce en una semana 2 de conflictos.

**D3 · Semáforo derivado, no columna en `cliente`.** `lista_negra` es tabla nuestra y ya tiene `id_cliente`, `motivo` y `direccion_vetada`. Agregar `nivel VARCHAR(10)` ahí es aditivo sobre estructura propia: el semáforo se deriva de la última fila vigente y se sincroniza `cliente.es_conflictivo = (nivel === 'ROJO')` dentro de la transacción que ya existe en `clientes.service.ts:259`. Con esto MOD RF-32 sale de la migración compartida M-01.

**D4 · Aprobación sin migración.** `orden_trabajo.estado` es `VARCHAR(25)` y `PENDIENTE_APROBACION` mide 20 caracteres: entra sin migrar. Quién aprobó y por qué se registra en `historial_ot`, que ya guarda `estado_anterior`, `estado_nuevo`, `id_usuario` y observaciones. Con esto MOD RF-04 también sale de M-01.

> Tomadas D3 y D4, M-01 se reduce a RF-53 y RF-58 —justamente los que quedan fuera de alcance o en riesgo— y el bloqueante B-01 deja de estar en el camino crítico de nada que sí vayamos a entregar.

**D5 · Aviso formal a G1, enviado el Día 1 y no cuando el código esté.** Dos cosas: que el evento de cierre pasará a emitirse en la aprobación y no en el cierre del técnico, y que aparecerá el estado `PENDIENTE_APROBACION` en `GET /integraciones/ordenes`. Pedir acuse. G3 ya no descuenta stock —Opción A del acuerdo G1↔G3— pero **el fan-out del cierre es lo que dispara el descuento en G1**: si no se mueve, G1 descuenta por un cierre que el supervisor todavía puede rechazar.

**D6 · Congelar vocabularios.** `ESTADO_TICKET`, `PRIORIDAD_TICKET`, `ORIGEN_TICKET` y `NIVEL_RIESGO`, al estilo de `src/ordenes/estado-equipo.constants.ts`. Verificar que cada literal entre en su columna: `ticket.prioridad` es `VARCHAR(10)` y `ticket.estado` es `VARCHAR(20)`. Es el mismo error que ya costó una migración con `EN_MANTENCION` en `puerto_nap`.

### Dos cosas que no hay que decidir

- **`@nestjs/schedule` no hace falta.** `MonitoreoPollerService` ya usa `setInterval` con `OnModuleInit`/`OnModuleDestroy`, y su comentario dice que se eligió así para no sumar dependencia. CU-50 copia ese patrón.
- **CU-33 y CU-34 no necesitan backend nuevo.** `GET /dashboard/empresas` y `GET /dashboard/empresa/:id` ya existen.

---

## 3. Fuera de alcance — se declara ahora, no el Día 10

- **CU-36 Desbloqueo de cliente por pago de deuda.** No existe `model deuda`; `factura`, `pago` y `contrato` son dominio comercial de otro grupo. Implementarlo exigiría crear tablas comerciales sobre la base compartida.
- **CU-60 Personalización del plan por contrato (RF-53).** B-01 sin resolver, más migración sobre `contrato`, que tiene `factura`, `pago` y `credenciales_tvip` colgando. Es la peor relación riesgo/valor de la lista.
- **CU-24 Estado de ONT por movimiento, en su versión de escritura.** El acuerdo G1↔G3 Opción A establece que G3 no escribe inventario. Se redefine como vista de solo lectura del estado del equipo, en vez de dejarlo abierto.

### Alcance reducido

- **CU-59 Catálogo de planes (RF-52)** → solo lectura. `GET /clientes/planes` ya existe. El alta y la edición quedan como pendiente atribuido a B-01.
- **CU-50** → programación, regla de 24 h y registro `SIMULADO`. El envío real no es alcance del equipo: no hay proveedor contratado y los cuatro canales son constantes. Escribirlo así en la ficha evita que en la revisión se lea como incompleto.

---

## 4. Fase 1 · Días 1-4 — todo lo que no depende de nadie

Cinco tracks en paralelo. Ninguno necesita migración ni decisión externa.

### Track TICKETS — 2 personas

El bloque más grande, y arranca primero por ser el único grande sin dependencias. Orden interno estricto:

1. **`tickets.constants.ts`** (es D6). Bloquea backend y frontend por igual.
2. **Lectura** (CU-30 parte 1): `tickets.module.ts` más `listarTickets` paginado y `obtenerTicket`, con aislamiento por `id_empresa`. Desde acá el frontend arranca en paralelo.
3. **Creación** (CU-29): `crearTicket` y `codigo_seguimiento`. Es `@unique` y `VARCHAR(20)`, así que el formato y el manejo de colisión son decisión explícita, no accidente.
4. **Gestión** (CU-30 parte 2): asignar, cambiar estado y cerrar, con `fecha_cierre` y `resuelto_remotamente` —que conecta con CU-56—. Validar transiciones contra las constantes del paso 1, no con strings sueltos.
5. **Reclasificación** (CU-32): cambiar `id_categoria`, recalcular el SLA desde `categoria_falla.sla_horas` y auditar con `valor_anterior`/`valor_nuevo`, que son `Json?` y existen para exactamente este caso. Depende del paso 4, porque reclasificar un ticket cerrado tiene que estar prohibido.
6. **Escalación ticket → OT**: va al final, porque es el único punto que toca código existente. Dos cuidados: `crearOT` recibe `rut_cliente` y no `id_cliente`, y rechaza `INSTALACION` para clientes conflictivos; un ticket con `id_cliente` nulo no puede escalar por ese camino.
7. **Specs**, espejando `clientes.service.spec.ts`. Mínimo: aislamiento por empresa (un ticket de otra empresa devuelve 404), transiciones inválidas de estado, y que la reclasificación escriba auditoría.

**Qué reutilizar sin volver a escribirlo:** `src/clientes/` como forma del módulo —no `src/ordenes`, que ya arrastra `forwardRef`, gateway y fan-out—; `JwtAuthGuard` y `RolesGuard` son `APP_GUARD` globales, así que solo hace falta `@Roles(...)` en cada handler; `normalizarPaginacion` de `src/common/utils/paginacion.util.ts`; y `roles-declarados.spec.ts`, que descubre los controllers por disco y va a cubrir `tickets.controller.ts` automáticamente — un handler sin `@Roles` rompe el test en vez de producir un 403 silencioso.

Estimación: 5 a 6 días de dos personas entre backend, frontend y specs. Entra en la ventana siempre que el paso 1 salga el Día 1 y el paso 6 no se adelante.

### Track OT / APROBACIÓN — 1 persona

Es el camino crítico del incremento.

1. **Primero los tests de caracterización de `src/integraciones`.** Es el módulo que este cambio toca y hoy no tiene ni un test. Fijar el contrato actual: los tres endpoints de órdenes, el envoltorio `{ success, data }` y el `ApiKeyGuard` por scope. Sin esa red, un cambio en el contrato con G1 se detecta en la demo.
2. Recién después: `PENDIENTE_APROBACION` en `cerrarOT()`, más `aprobarCierre()` y `rechazarCierre()` con `@Roles('ADMIN','JEFE_TECNICO')`.

### Track DATOS / PLANTA — 1 persona

**CU-20**, la mejor relación valor/riesgo del incremento. La lógica ya está escrita en `planta-externa.service.ts` —buscar el primer puerto `LIBRE`, pasarlo a `OCUPADO` y asociar el cliente— y la fuente de verdad es `registro_ont` con `id_caja_nap`, que el ligado del Incremento 2 ya pobló. Es un servicio de reconciliación idempotente, no una migración. Atención: `puerto_nap` no tiene `id_empresa`, el tenant se resuelve por `caja_nap`.

### Track FRONTEND — 1 o 2 personas

**CU-33 va primero**, y es la dependencia que más fácil se pasa por alto: el selector de empresa cambia cómo cada `$lib/api/*.api.ts` arma la URL. Si entra al final, hay que retrofitear tickets, auditoría, materiales y consolidado uno por uno. Después, **CU-14**, que es una vista sobre un endpoint que ya existe.

### Track ADMIN / AUDITORÍA — 1 persona

**CU-43** (`usuario.activo` ya existe, así que es un `PATCH /auth/usuarios/:id/activo` más el toggle: media jornada) y **CU-41**. Dos trampas de CU-41 que hay que decidir al escribirlo, no al depurarlo:

- `log_auditoria.id_log` es **BigInt**, así que `JSON.stringify` lanza `TypeError`. Serializar a string en el servicio.
- `log_auditoria` **no tiene `id_empresa`**: el aislamiento por empresa sale de `usuario: { id_empresa }`, lo que descarta en silencio las filas con `id_usuario` nulo, es decir las escrituras del sistema como las del poller. Hay que decidir si el ADMIN las ve, y documentarlo.

---

## 5. Fase 2 · Días 4-7

- **Tickets:** frontend `/admin/tickets` y `/admin/tickets/[id]`, espejo de `/admin/ot`. El backend cierra con la escalación a OT.
- **OT / aprobación:** panel de aprobación. **El fan-out se mueve solo si llegó el acuse de G1.** Si no llegó, se deja detrás de una bandera de configuración: el patrón ya existe en `OrdenesModule`, que elige `WebhookFanOut` o `NoOpFanOut` según `CIERRE_WEBHOOK_*_URL`.
- **Clientes:** **CU-35 primero** —poblar `direccion_vetada` en `marcarConflictivo` y chequear la lista roja por dirección al registrar cliente y al crear OT, junto al chequeo de `es_conflictivo` que ya está en `ordenes.service.ts:65`—. **Después** MOD RF-32 encima, y CU-37 rehecho. Al revés se escribe dos veces.
- **Zonas:** CU-61 es `model zona` —tabla nueva, propia y aditiva—, su CRUD, y el backfill desde los strings que ya existen en `caja_nap.zona` y `registro_ont.zona`. RF-58, que es la FK en `direccion_servicio`, queda esperando M-01.
- **Exposición, lo barato:** CU-31, CU-56, CU-23 y CU-34. Son cuatro CU que consisten en pantalla sobre lógica ya escrita. Es el trabajo ideal para quien tenga menos rodaje, y sube mucho el porcentaje de cobertura del catálogo.

## 6. Fase 3 · Días 7-9

- **CU-50:** copiar el patrón de `MonitoreoPollerService`. La regla de 24 h se valida al programar —400 si falta menos— y el tick emite a T-24 h con `estado_envio: SIMULADO`.
- **CU-25** baja de servicio: es flujo, no esquema. Al cerrar la OT de tipo `BAJA` hay que liberar el `puerto_nap`, así que se apoya en CU-20 de la Fase 1.
- **CU-07** historial por dirección. Aviso de rendimiento: `orden_trabajo` tiene `@@index([id_cliente])` pero no sobre `id_direccion`, así que consultar por dirección hace scan. Resolver filtrando por cliente y agrupando en memoria, o agregar el índice —aditivo, pero sobre tabla compartida, así que entra en la ventana coordinada—.
- Cierre de tickets: specs y pulido.

## 7. Fase 4 · Día 10 — no es día de código

Congelación de código a mediodía. La tarde es para **CU-04 rehecho** (ficha, sus dos diagramas de secuencia y sus casos de prueba), `docs/arquitectura.md` —cuya tabla de módulos y párrafo de inventario ya están desactualizados y lo van a estar más con `tickets` y `zonas`— y la evidencia del catálogo completo.

Si algo necesita el Día 10 para programarse, ya está fuera de plazo.

---

## 8. Dependencias externas, con fecha límite

| Dependencia | De quién | Qué bloquea | Límite para seguir siendo viable |
| --- | --- | --- | --- |
| B-01 · dueño de `plan` y `contrato` | G1 / G8 | CU-59, CU-60 | Día 2 |
| B-02 · acuse sobre el nuevo momento del evento de cierre y el estado nuevo | G1 | Mover el fan-out en MOD RF-04 | **Día 4.** Sin acuse, se entrega el panel con el fan-out sin mover y se documenta como deuda |
| M-01 sobre `direccion_servicio` | Dueño de esa tabla | RF-58 | Día 3 |
| Proveedor de notificaciones | FiNet | Envío real de CU-50 | No llega a tiempo. Ya está acotado en §3 |
| Ventana de `migrate deploy` en Railway | G1 + G8 | `lista_negra.nivel`, `model zona` | **Pedirla el Día 1**, aunque la migración sea del Día 6. Coordinar con dos grupos toma días, no horas |

## 9. Riesgos que probablemente no se vean venir

1. **La documentación de CU-04.** Es trabajo de documento, no de código, y compite por la misma persona que hace el panel de aprobación.
2. **Las más de 40 ramas y el main desactualizado.** Por eso D2 es del Día 1 y no de la semana 2.
3. **`src/integraciones` sin tests.** Es deuda que se cobra justo en el cambio más delicado del incremento.
4. **`PENDIENTE_APROBACION` es un valor nuevo en una columna que otros grupos leen.** La migración `20260905020000_normalizar_estados_ot` existe precisamente porque ese vocabulario se acordó con ellos.

## 10. Verificación

- **Por CU:** cada uno se da por cerrado con la pantalla funcionando, no con `curl`. El plan del Incremento 2 ya lo advertía, y CU-14, CU-33 y CU-34 son exactamente ese caso.
- **Tickets:** `npm test` en `fsm/backend` con los specs nuevos. `roles-declarados.spec.ts` debe seguir pasando: cubre el controller nuevo automáticamente.
- **Integraciones:** los tests de caracterización deben pasar antes y después de mover el fan-out. Ese es el criterio de que no rompimos a G1.
- **CU-20:** contar puertos por estado antes y después de la reconciliación. La disponibilidad tiene que dejar de ser 100 %.
- **Migraciones:** solo `migrate deploy`, solo en la ventana coordinada, nunca `db push` ni `migrate dev` sobre la base compartida.
- **Cierre:** `npm run build` limpio en backend y frontend antes de la congelación del Día 10.
