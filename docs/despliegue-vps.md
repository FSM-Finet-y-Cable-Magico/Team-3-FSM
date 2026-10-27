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
git clone <url-del-repo> FSM-FineT
cd FSM-FineT
```

Crear el `.env` **en el servidor**, nunca versionarlo. Las variables que hacen
falta están en `.env.example`, más estas dos que son propias de este entorno:

```
DATABASE_URL=<la URL publica de Railway, la de junction.proxy.rlwy.net>
PUBLIC_API_URL=http://127.0.0.1:18300
```

`DATABASE_URL` tiene que ser la **pública**. La interna
(`postgres.railway.internal`) solo resuelve dentro de Railway y desde la VPS no
se alcanza.

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
