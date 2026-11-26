# Cortes y reactivaciones por morosidad — diseño

Fecha: 2026-11-13 · Rama: `feat/cortes-reactivaciones`

## Objetivo

Que el corte y la reactivación de un cliente moroso **se vean** en el FSM, aunque
la acción en SmartOLT la siga haciendo FiNet a mano.

Hoy no existen en el sistema. El acuerdo con G8 dice que G8 decide y G3 ejecuta
en SmartOLT ("SmartOLT escritura | G3 | P1. G8 solicitará acciones comerciales;
G3 ejecutará técnicamente"), pero nunca se definió el cómo. En la práctica, G8 ya
marca la suspensión en la base compartida: `contrato.estado = 'Suspendido'` con
`fecha_suspension`, y la reactivación vuelve el estado a `Activo`. No le envía
nada a G3. Nuestro token de SmartOLT es de solo lectura.

Criterio de éxito: en la demo, un cliente que G8 suspende aparece en "por
cortar". Alguien lo corta en SmartOLT y lo marca como hecho. Cuando G8 lo
reactiva, aparece en "por reactivar". Mientras está suspendido, su ONT no genera
alertas falsas. Si no paga y G8 pide el retiro, al aprobarlo se libera su puerto.

## Alcance

**Dentro:**

1. Panel "Cortes y reactivaciones".
2. El monitoreo reconoce a los clientes suspendidos.
3. La OT de retiro que pide G8 lleva la caja del cliente.
4. Un script de datos de demo para Railway.

**Fuera:**

- Escribir en SmartOLT (sigue siendo P1).
- Avisos a clientes.
- Endpoints nuevos para G8.
- Cambios de esquema: no se crean tablas, columnas ni migraciones.

## 1. Qué falta cortar o reactivar

Se calcula al pedirlo, cruzando `contrato` (de G8, solo lectura) con
`log_auditoria` (nuestro). No hay procesos en segundo plano ni estado propio.

- **Suspendido:** `lower(trim(contrato.estado))` empieza con `'suspend'`. En la
  base el estado viene escrito de varias formas (`activo`, `Activo`, `ACTIVO`),
  por eso se compara sin mayúsculas.
- **Registros nuestros:** filas de `log_auditoria` con
  `entidad_afectada = 'contrato'`, `id_entidad_afectada = id_contrato` y
  `accion` en `CORTE_SMARTOLT` o `REACTIVACION_SMARTOLT`. La última es la de
  `fecha_hora` mayor.

Una función pura `clasificarContrato(contrato, ultimoRegistro)` devuelve
`POR_CORTAR`, `POR_REACTIVAR` o `AL_DIA`:

| Contrato | Último registro nuestro | Resultado |
|---|---|---|
| Suspendido | ninguno | POR_CORTAR |
| Suspendido | CORTE con fecha **anterior** a `fecha_suspension` (G8 lo volvió a suspender) | POR_CORTAR |
| Suspendido | CORTE con fecha igual o posterior a `fecha_suspension` | AL_DIA |
| Suspendido | REACTIVACION | POR_CORTAR |
| Activo (`lower(trim(estado)) = 'activo'`) | CORTE | POR_REACTIVAR |
| Activo | REACTIVACION o ninguno | AL_DIA |
| Otro estado (pendiente, firmado, baja, …) | cualquiera | AL_DIA: solo se reactiva un contrato que G8 volvió a dejar activo; uno dado de baja va por retiro, no por reactivación |

Si `fecha_suspension` es null, cualquier CORTE posterior a la última
REACTIVACION cuenta como vigente. `fecha_suspension` es un DATE: se compara
contra el día del registro en la zona de operación (America/Santiago).

## 2. API (roles ADMIN y JEFE_TECNICO; empresa del token, ADMIN puede pasar `empresa`)

- `GET /api/cortes` responde
  `{ por_cortar: Fila[], por_reactivar: Fila[], historial: Registro[] }`.
  - **Fila:** `id_contrato`, `fecha_suspension`, `estado_contrato`, `plan`
    (nombre comercial), cliente (`id_cliente`, `nombre_completo`, `rut`,
    `telefono`), dirección principal y `onts[]`. Cada ONT trae `numero_serie`,
    `estado_conexion`, `odb`, `odb_puerto`, `olt_externo`/`board`/`puerto_pon`,
    tomados de `registro_ont` por `id_cliente`. Hoy casi siempre viene vacío.
  - **Historial:** los últimos 50 registros CORTE/REACTIVACION de la empresa,
    con usuario, fecha, contrato, cliente y observación.
  - `por_cortar` se ordena por `fecha_suspension` ascendente (lo más antiguo
    primero); `por_reactivar`, por la fecha del corte.
- `POST /api/cortes/:id_contrato/hecho` con body
  `{ accion: 'CORTE' | 'REACTIVACION', observacion?: string (≤ 300) }`.
  - 404 si el contrato no es de la empresa.
  - 409 si el contrato no está pendiente de esa acción, para que dos personas
    no registren el mismo corte.
  - Si todo va bien, inserta en `log_auditoria`: `accion` (`CORTE_SMARTOLT` o
    `REACTIVACION_SMARTOLT`), `entidad_afectada = 'contrato'`,
    `id_entidad_afectada`, `id_usuario` y en `valor_nuevo`
    `{ observacion, estado_contrato, fecha_suspension }`.
- **Sin permiso de lectura sobre `contrato`.** En la base global, `g3_app` puede
  no tenerlo. Ese error de Postgres (42501, o el equivalente de Prisma) se
  traduce en un 503 con el código `SIN_PERMISO_CONTRATO` y un mensaje claro. El
  panel lo muestra tal cual.

Módulo nuevo `cortes` (controller + `CortesService`), con la lógica pura en
`cortes.ts`.

## 3. Monitoreo: cliente suspendido

- `AlertasService.cargarEstado` obtiene, en una consulta **aparte**, el
  conjunto de `id_cliente` con contrato suspendido en la empresa. Si esa
  consulta falla por permisos, se registra un aviso en el log y se usa un
  conjunto vacío. El monitoreo nunca debe caerse por no poder leer `contrato`,
  por eso no va dentro de la consulta principal.
- `EstadoOnt` gana `suspendido?: boolean`, en true si su `id_cliente` está en
  ese conjunto.
- `esInactiva` devuelve true también para una ONT suspendida. Es el único punto
  por el que pasan el motor de alertas, el panel de críticos, la salud de cajas
  y la grilla SmartOLT, así que una ONT suspendida no alerta ni cuenta en los
  porcentajes de su caja.
- Para mostrarlo:
  - el detalle de caja de Topología (`OntDeCaja`) agrega `suspendido`;
  - las lecturas de Monitoreo (`lecturasRecientes`) agregan `suspendido`, con la
    misma consulta aparte y la misma protección;
  - la etiqueta es **"Suspendido por deuda"** y tiene prioridad sobre "posible
    baja".
- El resumen de Monitoreo los excluye de "fuera de línea" y los cuenta aparte
  (`suspendidos`), junto a las posibles bajas: "No incluye N posibles bajas (…)
  ni M clientes suspendidos por deuda".
- Un cliente cuenta como suspendido si tiene algún contrato suspendido y
  **ninguno activo**. Con un servicio activo y otro suspendido no se sabe a cuál
  corresponde la ONT, así que se sigue monitoreando.

## 4. Retiro por morosidad: la OT lleva la caja

En `BajasService.crear`, antes de crear la OT, se busca la caja del cliente:

1. `registro_ont.id_caja_nap` de las ONT del cliente (la más frecuente; si hay
   empate, la de `id_caja_nap` menor);
2. si no hay, la `id_caja_nap` del `puerto_nap` OCUPADO con
   `id_cliente_asociado` = el cliente;
3. si no hay ninguna, `null`, como hoy.

Se guarda en `orden_trabajo.id_caja_nap`. Al aprobar la OT, `moverPuerto(...,
'desconectar')` ya libera el puerto: no se toca.

## 5. Frontend

- Página `/admin/cortes` y entrada "Cortes" en el menú (ADMIN, JEFE_TECNICO).
- Arriba, un aviso: *"El corte y la reactivación se hacen en SmartOLT. Este
  panel solo registra que se hicieron."*
- Dos tablas, "Por cortar" y "Por reactivar", cada una con su contador.
  - Columnas: cliente (nombre, RUT, teléfono), dirección, plan, suspendido
    desde (o cortado el), y la ONT si se conoce (serie con enlace a su ficha,
    caja · puerto, estado). Si no se conoce: "Buscar en SmartOLT por nombre o
    RUT".
  - Botón "Hecho en SmartOLT", que abre un diálogo con observación opcional y
    confirmación. Al confirmar, la fila pasa al historial.
- Historial plegable con los últimos registros.
- Si el backend responde `SIN_PERMISO_CONTRATO`, se muestra el mensaje en lugar
  de las tablas.
- Monitoreo (lista de ONT) y Topología (detalle de caja) muestran la etiqueta
  "Suspendido por deuda".

## 6. Datos de demo

Script `fsm/backend/scripts/demo-cortes.ts`. Se niega a correr si
`DATABASE_URL` no apunta a Railway, porque la VPS es la base real. Para que el
panel muestre los dos estados, marca como `Suspendido`, con `fecha_suspension`
de hoy, 2 o 3 contratos `Activo` de la empresa 1. Imprime lo que tocó y tiene
un modo `--revertir` que los deja como estaban. Lo que hace un corte se prueba
a mano desde el panel.

## Pruebas

- `clasificarContrato`: cada fila de la tabla de la sección 1, más
  `fecha_suspension` null y el estado escrito de varias formas.
- `CortesService`:
  - aislamiento por empresa;
  - 409 al registrar algo que no está pendiente;
  - el registro en auditoría con su forma;
  - 503 `SIN_PERMISO_CONTRATO` ante un error de permisos.
- Monitoreo:
  - una ONT de un cliente suspendido no genera SIN_SENAL y no cuenta en el
    porcentaje de su caja;
  - si la consulta de suspendidos falla, el monitoreo sigue funcionando.
- `BajasService`: la OT toma la caja de la ONT, si no la del puerto, y si no
  queda en null.
- e2e: el panel lista, marca un corte (que pasa al historial) y muestra el
  mensaje de falta de permiso.
