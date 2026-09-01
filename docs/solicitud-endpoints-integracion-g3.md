# Solicitud de endpoints para integración — Terreno / FSM (G3) → T1 Inventario / G8 CRM

> **Quién pide:** Grupo 3 — Sistema de Gestión de Órdenes de Trabajo en Terreno (FSM).
>
> **Para qué:** desacoplar la creación, asignación y cierre de órdenes de trabajo (OT) de los datos administrados por Inventario/Bodega y CRM.
>
> **Flujos beneficiados:** consulta y creación de OT, vista móvil del técnico, instalación, reparación, reemplazo, baja e historial del cliente.
>
> **Acuerdo de base:** los sistemas no comparten tablas. Toda integración será mediante API REST con cuerpos JSON. G3 no consultará ni modificará directamente las bases de datos de T1 o G8.

---

## 0. Formato general propuesto

- Prefijo sugerido para las rutas: `/api`.
- Respuesta exitosa:

  ```json
  {
    "success": true,
    "data": {},
    "message": "Operación realizada correctamente"
  }
  ```

- Respuesta de error:

  ```json
  {
    "success": false,
    "data": null,
    "message": "Descripción clara del error"
  }
  ```

- Usar códigos HTTP según corresponda: `400` para datos inválidos, `401` para autenticación ausente, `403` para acceso denegado, `404` para recurso inexistente y `409` para conflictos de estado o stock.
- Autenticación entre sistemas: proponemos `X-API-KEY`, con una clave distinta por sistema y ambiente. Si se acuerda JWT de servicio, necesitamos que el token incluya `id_empresa` y el identificador del sistema consumidor.
- Todas las operaciones deben quedar acotadas por `id_empresa` (`1 = Finet`, `2 = Cable Mágico`) y nunca deben retornar datos de otra empresa.
- Fechas y horas en ISO 8601 con zona horaria, por ejemplo `2026-09-01T14:30:00Z`.
- Las cantidades pueden ser decimales porque algunos consumibles se registran por metros u otra unidad fraccionable.
- En listados, proponemos `page`, `limit`, `total` y un límite máximo de 100 registros por página.
- Para operaciones que descuentan o mueven inventario pedimos soportar el header `Idempotency-Key`, de modo que un reintento no duplique el consumo.

---

## 1. Solicitudes al Equipo 1 (Inventario y Bodega)

### 1.1 — Catálogo de equipos y materiales disponibles para una OT

La aplicación móvil debe mostrar únicamente ítems activos de la empresa y distinguir entre equipos serializados y consumibles.

| Ítem | Detalle |
|---|---|
| Endpoint | `GET /api/tipos-equipo` |
| Query params | `id_empresa`, `activo=true`, opcional `categoria` |
| Datos esperados | `id_tipo_equipo`, `nombre`, `categoria`, `requiere_serie_individual`, `unidad_medida`, `activo` |
| Uso en G3 | Construir el selector de materiales/equipos al cerrar una OT |
| Caso sin datos | `200` con lista vacía |

Ejemplo de respuesta:

```json
{
  "success": true,
  "data": [
    {
      "id_tipo_equipo": 3,
      "nombre": "ONT Wi-Fi 6",
      "categoria": "ONT",
      "requiere_serie_individual": true,
      "unidad_medida": "UNIDAD",
      "activo": true
    },
    {
      "id_tipo_equipo": 7,
      "nombre": "Cable drop",
      "categoria": "CONSUMIBLE",
      "requiere_serie_individual": false,
      "unidad_medida": "METRO",
      "activo": true
    }
  ],
  "message": "Catálogo obtenido"
}
```

### 1.2 — Inventario personal disponible del técnico

Antes de permitir el cierre, G3 debe conocer el saldo que el técnico realmente tiene asignado. No nos sirve el stock general de una bodega si la unidad no está en poder del técnico.

| Ítem | Detalle |
|---|---|
| Endpoint | `GET /api/inventario/tecnicos/{id_tecnico}` |
| Query params | `id_empresa`, opcional `disponible=true` |
| Datos esperados | `id_tecnico`, `actualizado_en`, `equipos[]` y `consumibles[]` |
| Equipo serializado | `id_unidad`, `numero_serie`, `id_tipo_equipo`, `nombre`, `estado` |
| Consumible | `id_tipo_equipo`, `nombre`, `unidad_medida`, `cantidad_disponible` |
| Caso sin asignación | `200` con ambos arreglos vacíos |

```json
{
  "success": true,
  "data": {
    "id_tecnico": 45,
    "actualizado_en": "2026-09-01T14:20:00Z",
    "equipos": [
      {
        "id_unidad": 501,
        "numero_serie": "NS-001",
        "id_tipo_equipo": 3,
        "nombre": "ONT Wi-Fi 6",
        "estado": "ASIGNADO_TECNICO"
      }
    ],
    "consumibles": [
      {
        "id_tipo_equipo": 7,
        "nombre": "Cable drop",
        "unidad_medida": "METRO",
        "cantidad_disponible": 80.5
      }
    ]
  },
  "message": "Inventario personal obtenido"
}
```

### 1.3 — Validación previa del inventario usado en el cierre

Este endpoint permite informar faltantes antes de enviar el cierre definitivo. La validación no debe descontar ni reservar stock.

| Ítem | Detalle |
|---|---|
| Endpoint | `POST /api/inventario/validaciones` |
| Datos de entrada | `id_empresa`, `id_ot`, `id_tecnico`, `equipos[]`, `consumibles[]` |
| Datos de respuesta | `valido` y `errores[] { codigo, campo, mensaje }` |
| Conflicto | `409` si una serie no pertenece al técnico, ya fue instalada o no existe saldo suficiente |

```json
{
  "id_empresa": 1,
  "id_ot": 123,
  "id_tecnico": 45,
  "equipos": [
    {
      "numero_serie": "NS-001",
      "id_tipo_equipo": 3,
      "accion": "INSTALAR"
    }
  ],
  "consumibles": [
    {
      "id_tipo_equipo": 7,
      "cantidad": 50.5
    }
  ]
}
```

### 1.4 — Confirmación atómica del consumo y movimiento de inventario

Al cerrar una OT, T1 debe registrar en una sola transacción el consumo de materiales y los cambios de estado/ubicación de cada equipo. Si una acción falla, ninguna debe aplicarse.

| Ítem | Detalle |
|---|---|
| Endpoint | `POST /api/inventario/ordenes/{id_ot}/consumo` |
| Header requerido | `Idempotency-Key: cierre-ot-{id_ot}-{uuid}` |
| Datos de entrada | Identificación de empresa, técnico, cliente, dirección, tipo de OT, equipos y consumibles |
| Datos de respuesta | `id_movimiento`, `referencia`, acciones aplicadas y fecha de registro |
| Conflicto | `409` sin cambios parciales cuando falta saldo, una serie no está disponible o el cierre ya fue procesado con otro contenido |
| Reintento idéntico | `200` con el resultado original, sin duplicar movimientos |

```json
{
  "id_empresa": 1,
  "id_ot": 123,
  "tipo_ot": "INSTALACION",
  "id_tecnico": 45,
  "fecha_completada": "2026-09-01T14:30:00Z",
  "cliente": {
    "id_cliente": 10,
    "rut": "12345678-5"
  },
  "direccion": {
    "id_direccion": 20,
    "direccion_completa": "Av. Ejemplo 123",
    "comuna": "Valparaíso"
  },
  "equipos": [
    {
      "numero_serie": "NS-001",
      "id_tipo_equipo": 3,
      "accion": "INSTALAR"
    },
    {
      "numero_serie": "NS-002",
      "id_tipo_equipo": 3,
      "accion": "RETIRAR",
      "estado_destino": "PENDIENTE_DIAGNOSTICO"
    }
  ],
  "consumibles": [
    {
      "id_tipo_equipo": 7,
      "cantidad": 50.5
    }
  ]
}
```

Respuesta esperada:

```json
{
  "success": true,
  "data": {
    "id_movimiento": 987,
    "referencia": "SRV-2026-00123",
    "id_ot": 123,
    "procesado_en": "2026-09-01T14:30:03Z",
    "equipos_procesados": 2,
    "consumibles_procesados": 1
  },
  "message": "Consumo de la OT registrado"
}
```

### 1.5 — Consulta de una unidad por número de serie

Necesitamos validar una serie al instalar, retirar o reemplazar un equipo y mostrar un error comprensible al técnico.

| Ítem | Detalle |
|---|---|
| Endpoint | `GET /api/unidades/serie/{numero_serie}` |
| Query params | `id_empresa` |
| Datos esperados | `id_unidad`, `numero_serie`, tipo de equipo, estado, ubicación actual y asignación actual |
| Caso no encontrado | `404` |

La asignación puede indicar `BODEGA`, `TECNICO` o `CLIENTE`, pero solo necesitamos identificadores y estado; no requerimos acceso a tablas internas.

### 1.6 — Reverso de inventario por reapertura o anulación de OT

Si una OT cerrada se anula por una corrección autorizada, G3 debe poder solicitar el reverso sin alterar manualmente datos de T1.

| Ítem | Detalle |
|---|---|
| Endpoint | `POST /api/inventario/ordenes/{id_ot}/reverso` |
| Header requerido | `Idempotency-Key` |
| Datos de entrada | `id_empresa`, `id_usuario_solicitante`, `motivo`, `referencia_cierre` |
| Datos de respuesta | Identificador del reverso y detalle de movimientos compensatorios |
| Regla esperada | Nunca borrar movimientos originales; generar movimientos compensatorios auditables |

> **Pregunta abierta para T1:** ¿el reverso puede automatizarse para todos los casos o existen estados —por ejemplo, equipo ya reasignado o enviado a diagnóstico— que exigirán revisión manual? En ese caso esperamos `409` con el motivo y un identificador de incidencia.

---

## 2. Solicitudes al Grupo 8 (CRM / dueño funcional del cliente)

G3 necesita consultar la ficha vigente del cliente para crear una OT y mostrar al técnico sus datos de contacto y dirección. La escritura de datos maestros debe quedar en CRM; FSM guardará en la OT solo los identificadores y la instantánea mínima necesaria para trazabilidad.

### 2.1 — Cliente por RUT

| Ítem | Detalle |
|---|---|
| Endpoint | `GET /api/clientes/rut/{rut}` |
| Query params | `id_empresa` |
| Datos esperados | Identificación, contacto, estado, condición de cliente conflictivo, direcciones y contrato/plan vigente |
| Caso no encontrado | `404` con mensaje claro |

```json
{
  "success": true,
  "data": {
    "id_cliente": 10,
    "id_empresa": 1,
    "rut": "12345678-5",
    "nombre_completo": "Cliente de ejemplo",
    "telefono": "+56912345678",
    "email": "cliente@ejemplo.cl",
    "estado": "ACTIVO",
    "es_conflictivo": false,
    "observacion_operativa": null,
    "direcciones": [
      {
        "id_direccion": 20,
        "direccion_completa": "Av. Ejemplo 123",
        "comuna": "Valparaíso",
        "ciudad": "Valparaíso",
        "referencia": "Casa azul",
        "es_principal": true
      }
    ],
    "contrato_vigente": {
      "id_contrato": 30,
      "estado": "ACTIVO",
      "plan": {
        "id_plan": 4,
        "nombre_comercial": "Fibra 600"
      }
    }
  },
  "message": "Cliente encontrado"
}
```

### 2.2 — Búsqueda paginada de clientes

| Ítem | Detalle |
|---|---|
| Endpoint | `GET /api/clientes` |
| Query params | `id_empresa`, `busqueda`, `estado`, `page`, `limit` |
| Comportamiento | Nombre parcial desde 3 caracteres, insensible a mayúsculas y tildes; RUT exacto o parcial normalizado |
| Datos esperados | Resumen del cliente y dirección principal |
| Caso sin resultados | `200` con `items: []` y `total: 0` |

### 2.3 — Detalle de cliente por identificador

| Ítem | Detalle |
|---|---|
| Endpoint | `GET /api/clientes/{id_cliente}` |
| Query params | `id_empresa`, opcional `include=direcciones,contrato` |
| Uso en G3 | Refrescar la ficha asociada a una OT sin depender de que el RUT cambie o se reformatee |
| Caso no encontrado o de otra empresa | `404` para no filtrar existencia entre empresas |

### 2.4 — Tickets que requieren visita técnica

Cuando CRM determine que un caso no se resolvió de forma remota, G3 necesita recibir los antecedentes para crear la OT sin volver a digitarlos.

Proponemos que G8 llame este webhook de G3:

`POST {API_G3}/api/integraciones/crm/tickets`

Cuerpo esperado:

```json
{
  "id_ticket": 7001,
  "codigo_seguimiento": "TK-2026-07001",
  "id_empresa": 1,
  "id_cliente": 10,
  "rut_cliente": "12345678-5",
  "id_direccion": 20,
  "id_categoria_falla": 4,
  "categoria_falla_otro": null,
  "prioridad": "ALTA",
  "descripcion": "Cliente sin conexión desde la mañana",
  "origen": "CRM",
  "resuelto_remotamente": false,
  "fecha_creacion": "2026-09-01T12:00:00Z"
}
```

| Comportamiento pedido | Detalle |
|---|---|
| Idempotencia | `id_ticket` debe ser único; repetir el mismo evento retorna la OT ya creada |
| Validación | G3 validará empresa, cliente, dirección y categoría antes de crear la OT |
| Respuesta | `id_ot`, `estado`, `fecha_creacion` y `id_ticket` |
| Alternativa pull | Si G8 no puede emitir webhooks, exponer `GET /api/tickets/{id_ticket}` y `GET /api/tickets?requiere_visita=true&desde=...` |

### 2.5 — Actualizaciones relevantes de la ficha del cliente

Para evitar usar un teléfono, dirección o estado desactualizado en una OT todavía abierta, solicitamos un webhook de cambios relevantes:

`POST {API_G3}/api/integraciones/crm/clientes/{id_cliente}/actualizacion`

```json
{
  "id_cliente": 10,
  "id_empresa": 1,
  "evento": "CLIENTE_ACTUALIZADO",
  "version": 12,
  "actualizado_en": "2026-09-01T13:00:00Z",
  "campos_modificados": ["telefono", "direcciones"]
}
```

El evento puede contener solo metadatos: al recibirlo, G3 consultará `GET /api/clientes/{id_cliente}`. Así evitamos que el webhook replique toda la ficha.

### 2.6 — Resultado del ticket después del cierre técnico

G3 ofrece notificar a CRM cuando cierre una OT originada por un ticket:

`POST {API_G8}/api/integraciones/ordenes/{id_ot}/cierre`

Necesitamos que G8 confirme la ruta y el contrato definitivo. Proponemos enviar:

```json
{
  "id_ot": 123,
  "id_ticket": 7001,
  "id_empresa": 1,
  "tipo_ot": "REPARACION",
  "estado": "CERRADA",
  "id_tecnico": 45,
  "fecha_completada": "2026-09-01T14:30:00Z",
  "id_categoria_falla": 4,
  "categoria_falla_otro": null,
  "resuelto_remotamente": false,
  "resultado": "RESUELTO",
  "observaciones": "Conector reemplazado y potencia normalizada"
}
```

> **Pregunta abierta para G8:** ¿el cierre de la OT debe cerrar automáticamente el ticket o dejarlo en un estado intermedio como `PENDIENTE_CONFIRMACION_CLIENTE`?

---

## 3. Lo que G3 ofrece a los otros equipos

El detalle definitivo se puede acordar en documentos separados, pero G3 puede exponer:

- `GET /api/ordenes/{id_ot}`: estado, técnico asignado, agenda y resultado de una OT.
- `GET /api/ordenes`: listado filtrable por empresa, técnico, estado, tipo y rango de fechas.
- `GET /api/ordenes/{id_ot}/cierre`: resumen técnico del cierre, evidencias, potencia óptica y materiales declarados.
- Webhook hacia T1 al confirmar el cierre, usando el contrato descrito en 1.4.
- Webhook hacia G8 para actualizar el ticket asociado, usando el contrato descrito en 2.6.

La exposición de estos endpoints entre sistemas requerirá autenticación de servicio; no se reutilizarán tokens personales de administradores o técnicos.

---

## 4. Orden recomendado para el cierre distribuido

Para evitar que una OT figure cerrada si Inventario rechazó el consumo, proponemos esta secuencia:

1. El técnico completa evidencias, potencia óptica, resultado y materiales en G3.
2. G3 consulta/valida los datos vigentes del cliente si es necesario.
3. G3 llama a la validación de T1 (`POST /api/inventario/validaciones`).
4. G3 solicita a T1 el consumo atómico con `Idempotency-Key`.
5. Solo después de la confirmación de T1, G3 marca la OT como `CERRADA`.
6. Si existe un ticket de CRM, G3 notifica el cierre a G8.
7. Si falla el paso 6, G3 conserva la OT cerrada y reintenta la notificación; no revierte inventario por una indisponibilidad temporal de CRM.

> **Decisión pendiente:** si T1 confirma el consumo y G3 falla antes de persistir el cierre, G3 consultará el resultado mediante la misma `Idempotency-Key` y reintentará. Por eso la idempotencia y una consulta de estado de operación son requisitos bloqueantes.

Endpoint complementario solicitado a T1:

`GET /api/inventario/operaciones/{idempotency_key}`

---

## 5. Resumen de solicitudes

| # | Equipo | Endpoint | Estado | Prioridad | Uso en G3 |
|---:|---|---|---|---|---|
| 1 | T1 | `GET /api/tipos-equipo` | Por confirmar/construir | Alta | Selector de equipos y materiales |
| 2 | T1 | `GET /api/inventario/tecnicos/{id_tecnico}` | Por confirmar/construir | **Bloqueante** | Saldo personal del técnico |
| 3 | T1 | `POST /api/inventario/validaciones` | Por confirmar/construir | Alta | Validación antes del cierre |
| 4 | T1 | `POST /api/inventario/ordenes/{id_ot}/consumo` | Por confirmar/construir | **Bloqueante** | Cierre atómico de instalación/reparación |
| 5 | T1 | `GET /api/unidades/serie/{numero_serie}` | Por confirmar/construir | Alta | Instalación, retiro y reemplazo |
| 6 | T1 | `POST /api/inventario/ordenes/{id_ot}/reverso` | Por confirmar/construir | Media | Anulación controlada |
| 7 | T1 | `GET /api/inventario/operaciones/{idempotency_key}` | Por confirmar/construir | **Bloqueante** | Recuperación ante fallos parciales |
| 8 | G8 | `GET /api/clientes/rut/{rut}` | Por confirmar/construir | **Bloqueante** | Crear OT y ficha en terreno |
| 9 | G8 | `GET /api/clientes?busqueda=...` | Por confirmar/construir | Alta | Búsqueda de cliente |
| 10 | G8 | `GET /api/clientes/{id_cliente}` | Por confirmar/construir | Alta | Refrescar ficha vinculada |
| 11 | G8 → G3 | `POST /api/integraciones/crm/tickets` | Por construir en G3; contrato por confirmar | **Bloqueante** | Crear OT desde atención CRM |
| 12 | G8 → G3 | `POST /api/integraciones/crm/clientes/{id}/actualizacion` | Por construir en G3; contrato por confirmar | Media | Sincronizar cambios relevantes |
| 13 | G3 → G8 | `POST /api/integraciones/ordenes/{id_ot}/cierre` | Ruta de G8 por confirmar | Alta | Actualizar/cerrar ticket CRM |

---

## 6. Checklist de acuerdos pendientes

- [ ] Confirmar URL base de T1 y G8 por ambiente (desarrollo, pruebas y producción).
- [ ] Confirmar mecanismo de autenticación, rotación de claves y responsables.
- [ ] Confirmar catálogo común de estados de unidad y unidades de medida.
- [ ] Confirmar si `id_tecnico` de G3 coincide con el identificador usado por T1 o requiere una tabla de equivalencias.
- [ ] Confirmar cuál sistema asigna el identificador maestro de cliente y dirección.
- [ ] Confirmar contrato de idempotencia y tiempo de retención de sus resultados.
- [ ] Confirmar política de timeout, reintentos y manejo de webhooks fallidos.
- [ ] Confirmar si el cierre de OT cierra el ticket CRM o queda pendiente de validación.
- [ ] Publicar ejemplos de errores `400`, `404` y `409` para los flujos bloqueantes.
- [ ] Probar aislamiento por `id_empresa` y que ninguna respuesta mezcle datos de Finet y Cable Mágico.

> **Prioridad general:** los ítems 2, 4, 7, 8 y 11 son bloqueantes. Sin inventario personal, consumo idempotente, recuperación de la operación, ficha maestra del cliente y creación de OT desde CRM, el flujo distribuido no puede cerrarse de extremo a extremo sin volver a compartir tablas.
