# Grupo 3 → Grupo 2 · Respuesta a su documento del 30-09

**30-09-2026 · Grupo 3 — Gestión de Terreno y Planta Externa**

Gracias por el detalle; nos resolvió una duda que teníamos mal planteada. Respondemos en el
mismo orden y cerramos con lo que les toca a ustedes.

---

## 1. Formato del RUT: tienen razón, el desvío era nuestro

Su punto 1 nos hizo revisar nuestro propio código y encontramos el problema en nuestra casa.

Nosotros **guardábamos el RUT tal como llegaba a la API**, sin normalizar. En el respaldo de
producción del 29-09 hay **14 filas con guion y 11 sin guion**, de 25 clientes. Ustedes cumplen el
§11 del Documento 0 y nosotros no.

Lo llamativo es que nuestro componente de formulario ya emitía el valor limpio y solo *mostraba*
el formato con puntos — el estándar se cumplía en el frontend y se perdía en el backend.

**Ya está corregido** (PR #110, pendiente de merge): el alta guarda en forma canónica, sin puntos
ni guion. **Adoptamos el Documento 0 §11, como proponen.**

Dos precisiones para que no queden dudas entre capas:

- **Almacenamiento en BD:** sin puntos ni guion (`123456785`), Documento 0 §11.
- **APIs entre grupos:** sin puntos y **con** guion (`12345678-5`), que es lo que ya fija el §3 del
  acuerdo con G8 y lo que nuestros endpoints validan hoy.

No hay contradicción: son dos capas distintas. Nuestros endpoints seguirán aceptando y exigiendo
`12345678-5`; lo que cambia es lo que escribimos en la base.

**Las 14 filas viejas con guion no las tocamos todavía.** Es dato compartido y preferimos coordinarlo,
sobre todo con G8, que según el §3 pasa a ser quien crea clientes. Cuando ustedes dejen de crear y
G8 confirme su formato, migramos las filas históricas de una vez. Mientras tanto, **nuestras lecturas
toleran las dos grafías**, así que nada se rompe en el intertanto — y les recomendamos hacer lo mismo
en cualquier búsqueda suya por RUT.

## 2. `lista_negra`: confirmado

Anotado, gracias. Nos sirve saber que `intento_fallido` y `sesion_portal` son suyas.

## 3. Cambio de clave WiFi: las seis definiciones

**Aviso importante: este endpoint todavía no existe.** No construyan contra él hasta que les
confirmemos que está desplegado. Lo que sigue es el contrato que vamos a implementar, para que
puedan avanzar en paralelo.

Estamos de acuerdo con el §6.4 y el §6.5: la clave cifrada va por endpoint y no por la base
compartida. Su razonamiento es correcto.

### 3.1 Llave pública

**RSA-OAEP con SHA-256, 3072 bits**, que les entregamos en PEM (SPKI).

**Todavía no la generamos.** Es la única pieza que nos falta y depende de resolver dónde
custodiamos la mitad privada en nuestro despliegue; no queremos improvisar eso. Se la mandamos en
cuanto esté, por canal aparte de este documento.

Propusieron RSA-OAEP/SHA-256 y coincidimos. Sobre el tamaño: 3072 en vez de 2048 porque el
contenido son credenciales de cliente y el costo de cifrado es irrelevante al volumen que
manejamos. Si 2048 les simplifica algo de su lado, díganlo y lo conversamos.

### 3.2 Endpoint

```
POST /api/integraciones/contrasena-wifi
```

Sigue el patrón de los que ya tenemos con G1 y G8 (`/api/integraciones/instalaciones`,
`/api/integraciones/tickets`).

### 3.3 Autenticación

**Header `X-API-KEY`**, una clave por grupo, igual que G1 y G8. Les emitimos una clave para G2 y se
la mandamos junto con la llave pública.

Un detalle de nuestra implementación que les conviene saber: **la clave no puede contener `:`**,
porque nuestro archivo de configuración usa ese carácter como separador. Si les mandamos una que
lo tenga, la integración responde 403 sin explicar por qué. Se la vamos a generar sin `:`, pero si
alguna vez la rotan, tenlo presente.

### 3.4 Qué nos mandan

Los campos que proponen nos sirven tal cual. Con las convenciones que ya usamos en los otros
endpoints:

| Campo | Formato |
|---|---|
| `ciphertext` | base64 de la clave cifrada con nuestra llave pública |
| `id_ticket` | el ticket del CRM, como string |
| `id_contrato` | número JSON, no string |
| `id_empresa` | número JSON — lo validamos contra el alcance de su clave de API |
| `request_id` | UUID v4 |
| `trace_id` | UUID v4 |

No necesitamos ningún campo extra.

### 3.5 Qué les devolvemos

Respondemos en la **misma llamada**, no hay aviso posterior. Envoltorio `{ "success": true, "data": {...} }`,
como el resto de nuestros endpoints.

| Situación | Código | `data` |
|---|---|---|
| Aplicado | 201 | `request_id`, `id_solicitud`, `estado`, `fecha` |
| Reintento idéntico | 200 | lo mismo de la original, más `duplicado: true` |
| Mismo `request_id`, contenido distinto | 409 | el conflicto |
| Dato inválido | 400 | el campo que falla |
| Clave de API mala o fuera de alcance | 401 / 403 | — |

### 3.6 Reintentos

**Sí, pueden reintentar con el mismo `request_id` sin que el cambio se aplique dos veces.**

Esa convención ya existe y está implementada para las solicitudes de instalación de G8; la
reutilizamos acá con el mismo comportamiento. Concretamente:

- `request_id` nuevo → 201, se procesa.
- mismo `request_id` con el mismo contenido → 200 con `duplicado: true`, **no se reaplica**.
- mismo `request_id` con contenido distinto → 409, no se procesa.

Ese último caso es a propósito: si cambia el contenido, el `request_id` ya no identifica el mismo
hecho y preferimos fallar ruidosamente antes que adivinar cuál vale.

## 4. Las dos migraciones: confirmado

Gracias por aclararlo, nos sirve para el inventario.

Sobre `solicitud_contrasena_wifi`: entendemos que **hoy** guarda la clave cifrada en la base
compartida, y coincidimos en que la versión 2.0 del acuerdo lo corrige. No la tocamos ni
dependemos de ella. Cuando el flujo nuevo esté andando, coordinamos su retiro según el §6.7 y el
§13.3.

Sobre `arreglar_largo_token_sesion_portal`: sin problema, solo agranda una columna que no leemos.

---

## Lo que esperamos de ustedes

1. **Confirmar el tamaño de llave** (3072, o 2048 si les simplifica).
2. **Confirmar que el contrato del punto 3 les sirve** tal como quedó, antes de que lo construyamos.

## Lo que les debemos

1. La **llave pública** en PEM y la **clave de API** de G2.
2. El **endpoint desplegado** — les avisamos cuándo, y no antes de tener sus dos confirmaciones.
