import { Logger } from '@nestjs/common';
import type {
  FuenteMonitoreo,
  FiltroConsulta,
  LecturaOnt,
  OltInfo,
  OntDetalle,
  EstadoConexion,
} from './fuente-monitoreo.js';

/**
 * Cliente de la API de SmartOLT.
 *
 *   Base      : https://<dominio-white-label>/api   (SMARTOLT_BASE_URL)
 *   Auth      : header `X-Token: <SMARTOLT_API_TOKEN>`
 *   Requisito : la cuenta SmartOLT tiene que whitelistear la IP de salida de
 *               este servidor. Si el hosting no tiene IP fija, hay que resolverlo
 *               (proxy con IP fija o whitelistear un rango).
 *
 * Verificado contra la cuenta real de FiNet (2026-09-04):
 *   - `/system/get_olts` existe y funciona tal como se esperaba.
 *   - `/onu/get_all_onus_signals` y `/onu/get_all_onus_statuses` NO EXISTEN en
 *     esta cuenta ("Unknown method") — eran una suposición de la doc pública.
 *     Todo (censo + señal + estado) viene junto en un solo endpoint:
 *     `/onu/get_all_onus_details`, bajo la clave `onus` (no `response`).
 *   - Ese endpoint tiene un límite de **15 llamadas/hora** (mucho más bajo que
 *     `get_olts`, que tiene 1000/hora) — de ahí el caché de abajo: si
 *     `listarOntDetalles` y `listarLecturas` se llaman en el mismo ciclo de
 *     ingesta (pasa siempre que aparece una ONT nueva, ver
 *     `monitoreo.service.ts`), comparten una sola llamada real.
 */

interface RawOlt {
  id?: number | string;
  name?: string;
  ip?: string;
  location?: string;
}

/** Un registro de `/onu/get_all_onus_details` trae censo + señal + estado juntos. */
interface RawOnu {
  sn?: string;
  unique_external_id?: string;
  olt_id?: number | string;
  board?: number | string;
  port?: number | string;
  zone_name?: string;
  odb_name?: string;
  name?: string;
  address?: string;
  onu_type_name?: string;
  status?: string;
  signal_1310?: string | number;
  signal_1490?: string | number;
  last_status_change?: string;
}

/** SmartOLT envuelve la mayoría de las respuestas: { status: true, response: [...] }. */
interface RespuestaSmartOlt<T> {
  status?: boolean;
  response?: T[];
  error?: string;
}

const TTL_CACHE_ONUS_MS = 10_000;

export class SmartOltClient implements FuenteMonitoreo {
  readonly nombre = 'smartolt';
  private readonly logger = new Logger(SmartOltClient.name);

  // Memoiza la última respuesta de `get_all_onus_details` por unos segundos:
  // el objetivo no es cachear entre ciclos de poll (cada ciclo debe traer
  // datos frescos), solo evitar la doble llamada dentro de un mismo ciclo
  // cuando `ingestarLecturas` pide detalles y lecturas seguidas.
  private cacheOnus: { en: number; datos: Promise<RawOnu[]> } | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {
    if (!baseUrl || !token) {
      throw new Error(
        'SmartOltClient: faltan SMARTOLT_BASE_URL o SMARTOLT_API_TOKEN. ' +
          'Usá MONITOREO_FUENTE=mock hasta tener las credenciales.',
      );
    }
  }

  async listarOlts(): Promise<OltInfo[]> {
    const raw = await this.get<RawOlt>('/system/get_olts');
    return raw.map((o) => ({
      id_externo: String(o.id ?? ''),
      nombre: o.name ?? null,
      ip_gestion: o.ip ?? null,
      ubicacion: o.location ?? null,
    }));
  }

  async listarOntDetalles(filtro?: FiltroConsulta): Promise<OntDetalle[]> {
    const onus = await this.obtenerOnus(filtro);
    return onus
      .filter((o) => o.sn)
      .map((o) => ({
        sn: String(o.sn),
        id_externo: o.unique_external_id ?? String(o.sn),
        olt_externo: String(o.olt_id ?? ''),
        board: this.num(o.board),
        puerto_pon: this.num(o.port),
        zona: o.zone_name ?? null,
        odb: o.odb_name ?? null,
        nombre_cliente: o.name ?? null,
        direccion_cliente: o.address ?? null,
        modelo: o.onu_type_name ?? null,
      }));
  }

  async listarLecturas(filtro?: FiltroConsulta): Promise<LecturaOnt[]> {
    const onus = await this.obtenerOnus(filtro);
    return onus
      .filter((o) => o.sn)
      .map((o) => ({
        sn: String(o.sn),
        // 1490nm es la que "ve" la ONT (downstream) — la relevante para el
        // cliente. 1310nm (upstream) es fallback si falta la primera.
        potencia_rx_dbm: this.num(o.signal_1490 ?? o.signal_1310),
        estado: this.mapearEstado(o.status),
        medido_en: this.fecha(o.last_status_change) ?? new Date(),
      }));
  }

  // ---- internos ----

  /** `get_all_onus_details`, memoizado por `TTL_CACHE_ONUS_MS` (ver comentario de clase). */
  private obtenerOnus(filtro?: FiltroConsulta): Promise<RawOnu[]> {
    const ahora = Date.now();
    if (this.cacheOnus && ahora - this.cacheOnus.en < TTL_CACHE_ONUS_MS) {
      return this.cacheOnus.datos;
    }
    const datos = this.getOnusCrudo(filtro);
    this.cacheOnus = { en: ahora, datos };
    // Si la llamada falla, no dejar el error cacheado: el próximo pedido
    // reintenta en vez de repetir el mismo fallo por `TTL_CACHE_ONUS_MS`.
    datos.catch(() => {
      this.cacheOnus = null;
    });
    return datos;
  }

  private async getOnusCrudo(filtro?: FiltroConsulta): Promise<RawOnu[]> {
    const url = new URL(this.baseUrl.replace(/\/$/, '') + '/onu/get_all_onus_details');
    if (filtro?.olt_externo) url.searchParams.set('olt_id', filtro.olt_externo);
    if (filtro?.zona) url.searchParams.set('zone', filtro.zona);

    const res = await this.fetchConManejo(url);
    const json = (await res.json()) as { onus?: RawOnu[]; status?: boolean; error?: string };
    if (json.status === false) {
      throw new Error(`SmartOLT get_all_onus_details: ${json.error ?? 'respuesta con status=false'}`);
    }
    return json.onus ?? [];
  }

  private async get<T>(ruta: string, filtro?: FiltroConsulta): Promise<T[]> {
    const url = new URL(this.baseUrl.replace(/\/$/, '') + ruta);
    if (filtro?.olt_externo) url.searchParams.set('olt_id', filtro.olt_externo);
    if (filtro?.zona) url.searchParams.set('zone', filtro.zona);

    const res = await this.fetchConManejo(url);
    const json = (await res.json()) as RespuestaSmartOlt<T> | T[];
    if (Array.isArray(json)) return json;
    if (json.status === false) {
      throw new Error(`SmartOLT ${ruta}: ${json.error ?? 'respuesta con status=false'}`);
    }
    return json.response ?? [];
  }

  private async fetchConManejo(url: URL): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'X-Token': this.token, Accept: 'application/json' },
      });
    } catch (e) {
      throw new Error(`SmartOLT ${url.pathname}: fallo de red (${(e as Error).message})`);
    }

    if (!res.ok) {
      // 401/403 casi siempre = IP no whitelisteada o token inválido.
      // 429 = límite de llamadas/hora agotado (get_all_onus_details es de 15/hora).
      const cuerpo = await res.text().catch(() => '');
      throw new Error(`SmartOLT ${url.pathname}: HTTP ${res.status} ${res.statusText} ${cuerpo.slice(0, 200)}`);
    }
    return res;
  }

  /**
   * Chequear "power fail" ANTES que "offline"/"power": una versión anterior
   * de este mapeo usaba `includes('power')` para offline, lo que también
   * capturaba "Power fail" — perdiendo la distinción real que trae la cuenta
   * (ONT sin alimentación no es lo mismo que caída de fibra/config).
   */
  private mapearEstado(status?: string): EstadoConexion {
    const s = (status ?? '').trim().toLowerCase();
    if (s === 'online') return 'ONLINE';
    if (s === 'power fail') return 'POWER_FAIL';
    if (s === 'los' || s === 'dying gasp') return 'LOS';
    if (s === 'offline') return 'OFFLINE';
    return 'DESCONOCIDO';
  }

  private num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private fecha(v: string | undefined): Date | null {
    if (!v) return null;
    const d = new Date(v.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  }
}
