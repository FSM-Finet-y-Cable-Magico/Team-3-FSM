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
 *   Base      : https://<subdominio>.smartolt.com/api   (SMARTOLT_BASE_URL)
 *   Auth      : header `X-Token: <SMARTOLT_API_TOKEN>`
 *   Requisito : la cuenta SmartOLT tiene que whitelistear la IP de salida de
 *               este servidor. Si el hosting no tiene IP fija, hay que resolverlo
 *               (proxy con IP fija o whitelistear un rango).
 *
 * Endpoints usados (todos GET):
 *   /system/get_olts
 *   /onu/get_all_onus_details      (?olt_id= / ?zone=)
 *   /onu/get_all_onus_signals      (?olt_id= / ?zone=)
 *   /onu/get_all_onus_statuses     (?olt_id= / ?zone=)
 *
 * Las formas `Raw*` de abajo son la MEJOR SUPOSICIÓN a partir de la doc pública
 * (postman.com/smartolt). Al conectar contra la cuenta real hay que verificar
 * los nombres de campo exactos y ajustar SOLO los mapeadores `mapear*` — el
 * resto del módulo no cambia.
 */

interface RawOlt {
  id?: number | string;
  olt_id?: number | string;
  name?: string;
  ip?: string;
  location?: string;
}

interface RawOnuDetalle {
  sn?: string;
  onu_id?: number | string;
  olt_id?: number | string;
  board?: number | string;
  port?: number | string;
  pon_port?: number | string;
  zone?: string;
  odb?: string;
  name?: string;
  address?: string;
  onu_type?: string;
  model?: string;
}

interface RawOnuSignal {
  sn?: string;
  onu_id?: number | string;
  /** Potencia que ve la ONT. Es la relevante para el cliente. */
  onu_rx_power?: number | string;
  onu_rx_signal?: number | string;
  /** Potencia que ve el OLT. Fallback. */
  olt_rx_power?: number | string;
}

interface RawOnuStatus {
  sn?: string;
  onu_id?: number | string;
  status?: string;
}

/** SmartOLT envuelve las respuestas: { status: true, response: [...] }. */
interface RespuestaSmartOlt<T> {
  status?: boolean;
  response?: T[];
  error?: string;
}

export class SmartOltClient implements FuenteMonitoreo {
  readonly nombre = 'smartolt';
  private readonly logger = new Logger(SmartOltClient.name);

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
      id_externo: String(o.olt_id ?? o.id ?? ''),
      nombre: o.name ?? null,
      ip_gestion: o.ip ?? null,
      ubicacion: o.location ?? null,
    }));
  }

  async listarOntDetalles(filtro?: FiltroConsulta): Promise<OntDetalle[]> {
    const raw = await this.get<RawOnuDetalle>('/onu/get_all_onus_details', filtro);
    return raw
      .filter((o) => o.sn)
      .map((o) => ({
        sn: String(o.sn),
        id_externo: String(o.onu_id ?? ''),
        olt_externo: String(o.olt_id ?? ''),
        board: this.num(o.board),
        puerto_pon: this.num(o.pon_port ?? o.port),
        zona: o.zone ?? null,
        odb: o.odb ?? null,
        nombre_cliente: o.name ?? null,
        direccion_cliente: o.address ?? null,
        modelo: o.model ?? o.onu_type ?? null,
      }));
  }

  async listarLecturas(filtro?: FiltroConsulta): Promise<LecturaOnt[]> {
    // Señales y estados llegan por separado; se cruzan por SN.
    const [signals, statuses] = await Promise.all([
      this.get<RawOnuSignal>('/onu/get_all_onus_signals', filtro),
      this.get<RawOnuStatus>('/onu/get_all_onus_statuses', filtro),
    ]);

    const estadoPorSn = new Map<string, EstadoConexion>();
    for (const s of statuses) {
      if (s.sn) estadoPorSn.set(String(s.sn), this.mapearEstado(s.status));
    }

    const ahora = new Date();
    return signals
      .filter((s) => s.sn)
      .map((s) => {
        const sn = String(s.sn);
        return {
          sn,
          potencia_rx_dbm: this.num(s.onu_rx_power ?? s.onu_rx_signal ?? s.olt_rx_power),
          estado: estadoPorSn.get(sn) ?? 'DESCONOCIDO',
          medido_en: ahora,
        };
      });
  }

  // ---- internos ----

  private async get<T>(ruta: string, filtro?: FiltroConsulta): Promise<T[]> {
    const url = new URL(this.baseUrl.replace(/\/$/, '') + ruta);
    if (filtro?.olt_externo) url.searchParams.set('olt_id', filtro.olt_externo);
    if (filtro?.zona) url.searchParams.set('zone', filtro.zona);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'X-Token': this.token, Accept: 'application/json' },
      });
    } catch (e) {
      throw new Error(`SmartOLT ${ruta}: fallo de red (${(e as Error).message})`);
    }

    if (!res.ok) {
      // 401/403 casi siempre = IP no whitelisteada o token inválido.
      const cuerpo = await res.text().catch(() => '');
      throw new Error(`SmartOLT ${ruta}: HTTP ${res.status} ${res.statusText} ${cuerpo.slice(0, 200)}`);
    }

    const json = (await res.json()) as RespuestaSmartOlt<T> | T[];
    if (Array.isArray(json)) return json;
    if (json.status === false) {
      throw new Error(`SmartOLT ${ruta}: ${json.error ?? 'respuesta con status=false'}`);
    }
    return json.response ?? [];
  }

  private mapearEstado(status?: string): EstadoConexion {
    const s = (status ?? '').toLowerCase();
    if (s.includes('online')) return 'ONLINE';
    if (s.includes('los') || s.includes('dying')) return 'LOS';
    if (s.includes('offline') || s.includes('power') || s.includes('disabled')) return 'OFFLINE';
    return 'DESCONOCIDO';
  }

  private num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
}
