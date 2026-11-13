# Puertos por caja SmartOLT — diseño

Fecha: 2026-11-12 · Rama: `feat/puertos-caja-smartolt` (sale de `feat/panel-cajas-smartolt`, PR #138)

## Objetivo

Ver, por cada caja NAP **tal como la conoce SmartOLT**, qué puertos del divisor
están ocupados y por qué ONT, y cuáles no tienen registro. Hoy la página de
topología muestra los 16 puertos "sin registro" aunque SmartOLT sepa que, por
ejemplo, la ONT `GPON6B7459FE` está en `NAP203 (Puerto 3)`.

Criterio de éxito: al abrir una caja se ve su grilla con la capacidad real de
SmartOLT y cada ONT en el puerto que dice SmartOLT; lo que no cuadra (dos ONT
en un puerto, ONT sin puerto) se ve explícito, no se esconde.

Despliegue objetivo: Railway (backend) + Vercel (frontend). La VPS queda de
respaldo; su base global necesita que el admin aplique la migración a mano.

## Datos de origen (SmartOLT)

- `odb_port`, en `/onu/get_all_onus_details`: la posición de la ONT en la caja.
  Poblado en 682 de 940 ONT (medido en la prueba del 28-09-2026). Viene en la
  misma llamada que ya hace el sondeo: no cuesta llamadas extra.
- `nr_of_ports`, en `/system/get_odbs`: la capacidad de la caja. Poblado en 300
  de 301. Es OTRA llamada, y el límite de SmartOLT es de 15 llamadas/hora
  compartido con los demás grupos: no se puede pedir al abrir cada caja.

## 1. Esquema (una migración Prisma)

- `registro_ont.odb_puerto SMALLINT NULL`.
- Tabla nueva `odb_smartolt`:

  | columna | tipo |
  |---|---|
  | `id_odb_smartolt` | SERIAL PK |
  | `id_empresa` | INT NOT NULL, FK `empresa` |
  | `id_externo` | VARCHAR(40) NOT NULL (id del ODB en SmartOLT) |
  | `nombre` | VARCHAR(80) NOT NULL |
  | `capacidad` | SMALLINT NULL |
  | `zona` | VARCHAR(80) NULL |
  | `actualizado_en` | TIMESTAMP(3) NOT NULL DEFAULT now |

  Único `(id_empresa, id_externo)`.

Ambos cambios son aditivos. En Railway los aplica el arranque del contenedor
(`MIGRAR_AL_ARRANCAR` por defecto en true). En la base global de la VPS los
aplica el admin con el SQL de la migración más los `GRANT` a `g3_app`.

## 2. Ingesta

- `OntDetalle` gana `odb_puerto: number | null`. `SmartOltClient` lo lee de
  `odb_port`; las fuentes CSV y mock lo devuelven en null.
- **Ubicación de todas las ONT en cada sondeo.** Hoy el censo solo se escribe
  para las ONT sin `id_unidad`, así que una ONT ya enriquecida nunca recibiría
  su puerto. Se agrega un paso que, con el censo del mismo sondeo, actualiza
  `odb` y `odb_puerto` de las ONT de la empresa **solo donde cambiaron**.
- **Catálogo.** `CatalogoOdbService.refrescar(id_empresa)` llama a
  `listarOdbs()` y hace upsert por `(id_empresa, id_externo)`. El sondeo lo
  llama si el `actualizado_en` más reciente de la empresa tiene más de 24 h (o
  no hay filas). Si la fuente no implementa `listarOdbs`, no hace nada. Un fallo
  del catálogo se registra en el log y no corta el sondeo.
- Endpoint manual `POST /api/monitoreo/catalogo-odb` (solo ADMIN) que fuerza el
  refresco y devuelve cuántas cajas se crearon o actualizaron.

## 3. La grilla de una caja

La caja es la del panel de críticos: `claveDeCaja` = `olt/placa/puerto|NOMBRE
NORMALIZADO`. Sus ONT son las de la empresa con esa clave, sin excluir bajas.

Una función pura `armarGrilla(onts, catalogo)` arma:

- **Capacidad.** Se busca en el catálogo por nombre estricto (trim, mayúsculas,
  espacios colapsados, el mismo criterio de `capacidad-cajas.service.ts`),
  probando primero la grafía más usada en la caja y después las demás. Si
  ninguna calza, o calzan entradas con capacidades distintas: capacidad
  estimada = máx(8, puerto más alto ocupado) y `capacidad_estimada: true`.
- **Puertos 1..capacidad.** Cada uno queda `OCUPADO` (con sus ONT: serie,
  cliente, estado, potencia, `posible_baja`) o `SIN_REGISTRO`.
  `posible_baja` es `esInactiva`, la misma regla del panel.
- **Conflictos.** Un puerto con dos o más ONT queda `OCUPADO` con
  `conflicto: true`. Una ONT con puerto mayor a la capacidad va a
  `fuera_de_rango`.
- **Sin puerto.** Las ONT de la caja sin `odb_puerto` van a `sin_puerto`.

## 4. API (roles ADMIN y JEFE_TECNICO, empresa del token; ADMIN puede pasar `empresa`)

- `GET /api/monitoreo/cajas-smartolt?zona=` → lista de todas las cajas:
  `clave, nombre, olt_externo, board, puerto_pon, zona, capacidad,
  capacidad_estimada, ocupados, ont_total, sin_puerto`. Ordenada por zona y
  nombre.
- `GET /api/monitoreo/cajas-smartolt/:clave` (clave con `encodeURIComponent`)
  → la caja con `puertos[]`, `fuera_de_rango[]`, `sin_puerto[]`. 404 si la
  clave no existe en la empresa.
- `POST /api/monitoreo/catalogo-odb` → ver ingesta.

## 5. Frontend

- Tercera pestaña en `/admin/monitoreo`, **"Puertos por caja"**: tabla de cajas
  con nombre, OLT · placa/puerto, zona, ocupación `ocupados / capacidad` (con
  `~` si es estimada) y ONT sin puerto. Busca por nombre y usa el filtro de zona
  existente. Cada fila enlaza a la caja.
- Página `/admin/monitoreo/cajas/[clave]`: cabecera con nombre, zona, OLT y
  totales; grilla de puertos como la de topología (ocupado / sin registro /
  conflicto), con el aviso "sin registro no es libre"; debajo, las listas de
  fuera de rango y sin puerto.
- En el panel de críticos, cada fila suma un enlace "Puertos" a esa página.

## Fuera de alcance

La página de topología de Tomodat, la tabla `puerto_nap`, el registro en
terreno (CU-20) y el ligado ONT → caja de Tomodat no cambian.

## Pruebas

- `SmartOltClient`: mapea `odb_port` (número, string, vacío).
- Ubicación en el sondeo: escribe solo las filas que cambiaron, y alcanza a
  ONT con `id_unidad`.
- Catálogo: no llama a la fuente si el refresco tiene menos de 24 h; upsert por
  id externo; un fallo no corta el sondeo.
- `armarGrilla`: capacidad del catálogo, estimada por ausencia y por homónimas
  que difieren, conflicto, fuera de rango, sin puerto, posible baja.
- Endpoints: aislamiento por empresa y 404 de clave inexistente.
