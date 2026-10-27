# Despliegue en la VPS de FiNet

La VPS `38.7.201.104` es la infraestructura definitiva del proyecto, compartida
por los cuatro grupos. Cada uno tiene su cuenta, su carpeta y su rango de
puertos; Docker corre en modo *rootless*, de modo que un grupo no puede tocar
los contenedores de otro.

**Lo nuestro:** cuenta `grupo3`, carpeta `/srv/finet/grupo3`, puertos `8300-8399`.

## Lo que cambia respecto de Railway

| | Railway | VPS |
|---|---|---|
| Aplicación | contenedores de Railway | contenedores nuestros en la VPS |
| Base de datos | Postgres de Railway | **la misma de Railway**, por su URL pública |
| Despliegue | automático al mergear | manual, con `docker compose` |
| Acceso | URL pública | túnel SSH |

La base **no se mueve**: sigue siendo la compartida con G1, G2 y G8. Por eso el
compose de la VPS no levanta Postgres. Levantar uno local dejaría dos bases
distintas y nadie sabría cuál es la buena.

## Primera vez

```bash
ssh grupo3@38.7.201.104
cd /srv/finet/grupo3
git clone <url-del-repo> Team-3-FSM
cd Team-3-FSM
```

Crear el `.env` **en el servidor**, nunca versionarlo. No alcanza con copiar el
`.env.example` de la raíz: ese cubre el compose de desarrollo y le faltan las
variables de monitoreo, webhooks y Tomodat, que están en
`fsm/backend/.env.example`. La lista completa para este entorno es esta:

```
# --- Propias de la VPS ---
# La URL PUBLICA de Railway. La interna (postgres.railway.internal) solo
# resuelve dentro de Railway y desde aca no se alcanza.
DATABASE_URL=postgresql://...@junction.proxy.rlwy.net:55656/railway
PUBLIC_API_URL=http://127.0.0.1:18300
FRONTEND_URL=http://127.0.0.1:18301

# --- Obligatorias: sin estas el compose no arranca ---
JWT_SECRET=<el mismo que Railway, o las sesiones emitidas alla dejan de valer>
SEED_ADMIN_PASSWORD=<la de Railway>

# --- Evidencia fotografica (sin esto no se puede cerrar una OT) ---
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# --- Integraciones con G1, G2 y G8 ---
# Comillas simples: el ";" sin comillas rompe el archivo si alguien lo
# carga con `source`, y bash deja la variable truncada en la primera clave.
INTEGRACION_API_KEYS='G1:...:1,2;G2:...:1;G8:...:1,2'
# Tambien entre comillas simples: trae espacios, y los saltos van como "
"
# literales. Con comillas DOBLES el parser los convierte antes de tiempo y la
# llave queda inservible.
WIFI_LLAVE_PRIVADA_PEM='-----BEGIN PRIVATE KEY-----
...'
CIERRE_FAN_OUT_MOMENTO=APROBACION
CIERRE_WEBHOOK_G1_URL=
CIERRE_WEBHOOK_G1_KEY=
CIERRE_WEBHOOK_G8_URL=
CIERRE_WEBHOOK_G8_KEY=

# --- Monitoreo de red ---
# Con "smartolt" el modulo construye el cliente real y ABORTA el arranque si le
# faltan las dos de abajo. Dejar "mock" si todavia no se tienen a mano.
MONITOREO_FUENTE=smartolt
SMARTOLT_BASE_URL=
SMARTOLT_API_TOKEN=

# --- Tareas de fondo: APAGADAS mientras Railway siga arriba (ver abajo) ---
MONITOREO_POLL_ENABLED=false
MONITOREO_PURGA_ENABLED=false
AVISOS_MANTENCION_ENABLED=false
```

### Las dos instancias no pueden correr las tareas de fondo a la vez

Mientras Railway y la VPS sirvan **la misma base**, las tareas periodicas van
apagadas aca y prendidas solo en Railway. Si corren en las dos:

- **El poller de monitoreo** duplica el consumo del rate limit de SmartOLT, que
  es de **15 llamadas por hora** y se comparte con los otros tres grupos. A 30
  minutos de intervalo, dos instancias se llevan 4 de las 15.
- **Los avisos de mantencion** le llegan dos veces al mismo cliente. Ojo con
  esta: es la unica que viene prendida por defecto y solo se apaga con el
  string exacto `false`.
- **La purga de `monitoreo_ont`** corre dos veces sobre la misma tabla.

Cuando se apague Railway, prenderlas aca.

## Levantar

```bash
docker compose -f docker-compose.vps.yml up -d --build
docker compose -f docker-compose.vps.yml ps
docker compose -f docker-compose.vps.yml logs --tail=100
```

El contenedor del backend aplica las migraciones y corre el seed al arrancar.
El seed es idempotente —cada inserción está protegida por una comprobación de
existencia y no borra nada— así que es seguro contra la base compartida.

## Verlo desde tu computador

Los servicios escuchan solo en loopback, así que no se alcanzan desde internet.
Hace falta un túnel SSH, en una consola local aparte:

```bash
ssh -N -L 127.0.0.1:18300:127.0.0.1:8300 grupo3@38.7.201.104   # backend
ssh -N -L 127.0.0.1:18301:127.0.0.1:8301 grupo3@38.7.201.104   # frontend
```

Dejar esas ventanas abiertas y entrar a `http://127.0.0.1:18301`. `Ctrl+C`
cierra el túnel.

## Por qué los puertos van en loopback

Los cuatro grupos comparten el mismo host. Un puerto publicado sin la dirección
`127.0.0.1` queda expuesto a internet, y uno fuera del rango `8300-8399` puede
chocar con el de otro grupo —el segundo en levantar falla, y el error no dice
que el culpable sea otro equipo—. Por eso el compose de la VPS ata todo a
loopback y usa el rango asignado.

## Pendiente de coordinar

Las integraciones con G1, G2 y G8 apuntan hoy a la URL de Railway. Cuando el
sistema quede en la VPS hay que acordar el cambio con los tres: tanto la URL
que ellos usan para llamarnos como la que nosotros usamos para avisarles el
cierre. Un cambio de URL mal hecho ya nos costó un webhook perdido.
