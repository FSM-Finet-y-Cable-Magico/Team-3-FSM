import { Logger } from '@nestjs/common';
import { request as httpsRequest, Agent } from 'node:https';
import type { PeerCertificate, TLSSocket } from 'node:tls';

/**
 * Cliente de la API del TOMODAT2 (el sistema donde FiNet dibuja su planta).
 *
 *   Base : https://sys.tomodat.com.br/tomodat/api
 *   Auth : header `Authorization: <token>` — el token pelado, SIN "Bearer".
 *
 * Es la segunda fuente de topología, además del KML exportado a mano. Lo que
 * el KML no trae y esto sí:
 *
 *   - El `name` real de cada caja. 166 de las 911 cajas del KML se llaman
 *     literalmente "nap", sin número. Si el nombre está en la base de Tomodat
 *     y lo pierde el exportador, esto lo resuelve solo.
 *   - La capacidad real (`total_ports` / `free_ports` por splitter). Hoy
 *     asumimos 16 puertos para todas, y el ligado ONT→caja usa ese número
 *     como tope de exclusividad.
 *   - La jerarquía caja→mufa→OLT, vía las fusiones de `get_connections`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * SOLO LECTURA. La API tiene `POST /clients/` y `DELETE /clients/{id}`, que
 * crean y BORRAN clientes en la planta real de FiNet. No se implementan acá
 * a propósito: lo que no existe no se puede llamar por equivocación.
 * ────────────────────────────────────────────────────────────────────────
 *
 * ── Sobre el certificado vencido ────────────────────────────────────────
 *
 * El certificado de `sys.tomodat.com.br` venció el 2026-07-21. Node rechaza
 * la conexión con CERT_HAS_EXPIRED, así que sin hacer nada esto no conecta.
 *
 * La salida fácil sería `rejectUnauthorized: false`, y es justamente la que
 * no se toma: deja de verificarse CUALQUIER cosa sobre el otro extremo, y
 * quedaríamos mandando un token que da permiso de borrar clientes a quien
 * sea que conteste en esa IP.
 *
 * Lo que se hace en cambio es fijar el certificado: se acepta uno solo, el
 * de Tomodat, comparando su huella SHA-256. Un intermediario no puede
 * presentar ese certificado porque no tiene la llave privada. Se pierde la
 * expiración, no la identidad.
 *
 * Es un parche con fecha de vencimiento. Cuando Tomodat renueve, la huella
 * cambia, este cliente va a fallar con un mensaje que dice exactamente qué
 * pasó, y ahí corresponde BORRAR el pinning y volver a la validación normal
 * — no actualizar la huella.
 */

/** Huella del certificado servido por sys.tomodat.com.br, tomada el 2026-09-05. */
const HUELLA_SHA256 =
  '27:43:5B:7A:FB:5A:9D:23:AF:73:F2:89:A4:7B:5E:EB:01:C2:A2:F3:DC:CB:DE:2F:25:5F:3F:75:18:23:17:40';

const BASE_DEFECTO = 'https://sys.tomodat.com.br/tomodat/api';
const TIMEOUT_MS = 20_000;

/**
 * Un punto de acceso: armario, caja de empalme, caja de atención o PAC.
 *
 * OJO con `dot`: la documentación declara `lat`/`lng` como `number`, pero la
 * API real los manda como STRING ("-33.5924553728"). Verificado contra la
 * cuenta de FiNet el 2026-09-05. Por eso existe `coordenadaDe()` — sumar dos
 * de estos sin convertir concatena en vez de sumar, y el error se propaga
 * silencioso hasta que una distancia sale NaN.
 */
export interface PuntoAccesoTomodat {
  id: number;
  name: string;
  access_point_type_id?: number;
  /** El tipo real de equipo, con su nombre de catálogo. Más confiable que
   *  adivinarlo del nombre, que es lo que hace el parser de KML. */
  access_point_type?: { id: number; name: string; icon?: string } | null;
  dot?: { id?: number; lat: number | string; lng: number | string } | null;
  category?: number | null;
  percentage_free?: number | null;
  cost?: number | null;
  color?: string | null;
  /** Metros desde el punto consultado. Solo en la búsqueda por radio. */
  distance?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: number | null;
  updated_by?: number | null;
}

/** Lee `dot` tolerando que lat/lng vengan como string. */
export function coordenadaDe(
  p: PuntoAccesoTomodat,
): { lat: number; lng: number } | null {
  if (!p.dot) return null;
  const lat = Number(p.dot.lat);
  const lng = Number(p.dot.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export interface SplitterTomodat {
  name?: string;
  total_ports?: number;
  free_ports_number?: number;
  free_ports?: number[];
}

export interface CajaViableTomodat extends PuntoAccesoTomodat {
  splitters?: SplitterTomodat[];
}

export interface ConexionTomodat {
  id: number;
  access_point_id: number;
  cable_id?: number | null;
  splitter_id?: number | null;
  side?: string;
  direction?: number;
  client_id?: number | null;
  fusions_in?: FusionTomodat[];
  fusions_out?: FusionTomodat[];
}

export interface FusionTomodat {
  id: number;
  access_point_connection_id_in?: number;
  access_point_connection_id_out?: number;
  fiber_in?: number;
  fiber_out?: number;
  connection_type?: number;
  loss?: number;
}

export class ErrorTomodat extends Error {}

export class TomodatClient {
  private readonly logger = new Logger(TomodatClient.name);
  private readonly base: string;

  constructor(
    private readonly token: string,
    base = process.env.TOMODAT_BASE_URL || BASE_DEFECTO,
  ) {
    if (!token) throw new ErrorTomodat('Falta TOMODAT_API_TOKEN');
    // Sin la barra final, para poder pegar rutas que empiezan con "/".
    this.base = base.replace(/\/+$/, '');
    if (this.base.startsWith('http://')) {
      // La documentación de Tomodat publica la base como http:// y el servidor
      // responde 301 a https. Seguir ese redirect es tarde: el PRIMER request
      // ya salió con el token en texto plano.
      throw new ErrorTomodat(
        'TOMODAT_BASE_URL no puede ser http://: el token viajaría en claro ' +
          'antes del redirect a https. Usar https:// directamente.',
      );
    }
  }

  /**
   * Cajas dentro de un radio. Es el único listado que ofrece la API: no hay
   * un "traeme todas", así que para barrer la red hay que consultar alrededor
   * de coordenadas que ya conozcamos.
   *
   * `raio` va en metros.
   */
  async puntosAccesoEnRadio(lat: number, lng: number, radioM: number) {
    return this.get<PuntoAccesoTomodat[]>(
      `/access_points/${lat}/${lng}/${Math.round(radioM)}`,
    );
  }

  /** Conexiones y fusiones de una caja. De acá sale la jerarquía de la planta. */
  async conexionesDe(idPuntoAcceso: number) {
    return this.get<ConexionTomodat[]>(
      `/access_points/get_connections/${idPuntoAcceso}`,
    );
  }

  /**
   * Cajas que podrían atender una ubicación, con el detalle de puertos libres
   * por splitter. Es la fuente de la capacidad real de cada caja.
   */
  async viabilidad(lat: number, lng: number) {
    return this.get<CajaViableTomodat[]>(`/clients/viability/${lat}/${lng}/`);
  }

  private async get<T>(ruta: string): Promise<T> {
    const { cuerpo, status } = await this.pedir(ruta);

    let json: unknown;
    try {
      json = JSON.parse(cuerpo);
    } catch {
      throw new ErrorTomodat(
        `Tomodat devolvió algo que no es JSON en ${ruta} (HTTP ${status}): ` +
          cuerpo.slice(0, 200),
      );
    }

    // Ojo: la API responde HTTP 200 incluso cuando falla. Un token inválido
    // devuelve 200 con {"message":"Auth error","status":0,...}, así que el
    // código de estado no alcanza para saber si salió bien.
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      const obj = json as Record<string, unknown>;
      if (typeof obj.message === 'string') {
        throw new ErrorTomodat(`Tomodat rechazó ${ruta}: ${obj.message}`);
      }
    }
    if (status >= 400) {
      throw new ErrorTomodat(`Tomodat respondió HTTP ${status} en ${ruta}`);
    }
    return json as T;
  }

  private pedir(ruta: string): Promise<{ cuerpo: string; status: number }> {
    const url = `${this.base}${ruta}`;
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: 'GET',
          headers: { Authorization: this.token, Accept: 'application/json' },
          timeout: TIMEOUT_MS,
          // La verificación estándar se apaga porque el certificado está
          // vencido, y se reemplaza por la comparación de huella de abajo.
          // Las dos cosas van juntas: una sin la otra no sirve.
          agent: new Agent({ rejectUnauthorized: false }),
        },
        (res) => {
          const cert = (res.socket as TLSSocket).getPeerCertificate?.();
          const problema = this.certificadoInesperado(cert);
          if (problema) {
            res.destroy();
            req.destroy();
            return reject(new ErrorTomodat(problema));
          }
          let cuerpo = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => (cuerpo += c));
          res.on('end', () => resolve({ cuerpo, status: res.statusCode ?? 0 }));
        },
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new ErrorTomodat(`Tomodat no respondió en ${TIMEOUT_MS}ms`));
      });
      req.on('error', (e) => reject(new ErrorTomodat(`Tomodat: ${e.message}`)));
      req.end();
    });
  }

  /** Devuelve el motivo si el certificado no es el esperado, o null si lo es. */
  private certificadoInesperado(cert?: PeerCertificate): string | null {
    if (!cert || !cert.fingerprint256) {
      return 'No se pudo leer el certificado de Tomodat. Se corta la conexión ' +
        'en vez de mandar el token a ciegas.';
    }
    const visto = cert.fingerprint256.toUpperCase();
    if (visto !== HUELLA_SHA256.toUpperCase()) {
      return (
        'El certificado de sys.tomodat.com.br cambió.\n' +
        `  esperado: ${HUELLA_SHA256}\n` +
        `  recibido: ${visto}\n` +
        'Lo más probable es que Tomodat por fin lo haya renovado. Si es así, ' +
        'BORRAR el pinning de tomodat.client.ts y volver a la validación TLS ' +
        'normal — no actualizar la huella. Si el certificado sigue vencido y ' +
        'aun así cambió, no conectarse y avisar.'
      );
    }
    return null;
  }
}
