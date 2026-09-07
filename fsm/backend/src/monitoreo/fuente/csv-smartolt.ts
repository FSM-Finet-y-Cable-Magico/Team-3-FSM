import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import type {
  FuenteMonitoreo,
  FiltroConsulta,
  LecturaOnt,
  OltInfo,
  OntDetalle,
  EstadoConexion,
} from './fuente-monitoreo.js';

interface FilaOnu {
  sn: string;
  oltNombre: string;
  board: number | null;
  puertoPon: number | null;
  zona: string | null;
  direccion: string | null;
  odb: string | null;
  estadoRaw: string;
  signal1310: number | null;
  signal1490: number | null;
  nombre: string | null;
  ultimoCambio: Date | null;
}

/**
 * Fuente de monitoreo a partir del CSV que exporta el panel SmartOLT
 * ("Configuración → Exportación de base de datos ONU"). No necesita token de
 * API ni IP whitelisteada — solo el archivo. Es un puente hasta tener acceso
 * a la API: mismo censo y estado, pero es una FOTO FIJA — para actualizarla
 * hay que volver a exportar del panel y reiniciar el backend.
 *
 * `SMARTOLT_CSV_PATH` en el .env apunta al archivo. Guardarlo FUERA del repo
 * y no commitearlo nunca: trae RUT, teléfono y dirección de clientes reales.
 */
export class CsvSmartOltFuente implements FuenteMonitoreo {
  readonly nombre = 'csv';
  private readonly logger = new Logger(CsvSmartOltFuente.name);
  private filas: FilaOnu[] | null = null;

  constructor(private readonly ruta: string) {
    if (!ruta) {
      throw new Error(
        'CsvSmartOltFuente: falta SMARTOLT_CSV_PATH. Usá MONITOREO_FUENTE=mock si no tenés el export.',
      );
    }
  }

  async listarOlts(): Promise<OltInfo[]> {
    const nombres = new Set(this.cargar().map((f) => f.oltNombre));
    return [...nombres].map((nombre) => ({
      id_externo: nombre,
      nombre,
      ip_gestion: null,
      ubicacion: null,
    }));
  }

  async listarOntDetalles(filtro?: FiltroConsulta): Promise<OntDetalle[]> {
    return this.filtrar(filtro).map((f) => ({
      sn: f.sn,
      id_externo: f.sn,
      olt_externo: f.oltNombre,
      board: f.board,
      puerto_pon: f.puertoPon,
      zona: f.zona,
      odb: f.odb,
      nombre_cliente: f.nombre,
      direccion_cliente: f.direccion,
      modelo: null,
    }));
  }

  async listarLecturas(filtro?: FiltroConsulta): Promise<LecturaOnt[]> {
    return this.filtrar(filtro).map((f) => ({
      sn: f.sn,
      // 1490nm es la longitud de onda downstream (OLT→ONT): es la potencia
      // que "ve" la ONT, la relevante para el cliente. 1310nm (upstream) es
      // fallback si por algún motivo falta la primera.
      potencia_rx_dbm: f.signal1490 ?? f.signal1310 ?? null,
      estado: this.mapearEstado(f.estadoRaw),
      medido_en: f.ultimoCambio ?? new Date(),
    }));
  }

  // ---- filtro + carga ----

  private filtrar(filtro?: FiltroConsulta): FilaOnu[] {
    return this.cargar().filter((f) => {
      if (filtro?.olt_externo && f.oltNombre !== filtro.olt_externo) return false;
      if (filtro?.zona && f.zona !== filtro.zona) return false;
      return true;
    });
  }

  /** Parsea una sola vez y cachea en memoria; el archivo no cambia en caliente. */
  private cargar(): FilaOnu[] {
    if (this.filas) return this.filas;

    let texto: string;
    try {
      texto = readFileSync(this.ruta, 'utf-8');
    } catch (e) {
      throw new Error(
        `CsvSmartOltFuente: no se pudo leer SMARTOLT_CSV_PATH (${this.ruta}): ${(e as Error).message}`,
      );
    }

    const filas = parsearCsv(texto);
    if (filas.length === 0) throw new Error('CsvSmartOltFuente: CSV vacío');

    const encabezado = filas[0];
    const col = (nombre: string): number => {
      const i = encabezado.indexOf(nombre);
      if (i === -1) throw new Error(`CsvSmartOltFuente: falta la columna "${nombre}" en el CSV`);
      return i;
    };

    const iSn = col('SN');
    const iOlt = col('OLT');
    const iBoard = col('Board');
    const iPort = col('Port');
    const iZone = col('Zone');
    const iAddress = col('Address');
    const iOdb = col('ODB (Splitter)');
    const iStatus = col('Status');
    const iSignal1310 = col('Signal 1310');
    const iSignal1490 = col('Signal 1490');
    const iName = col('Name');
    const iUltimoCambio = col('Last status change');

    const resultado: FilaOnu[] = [];
    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      const sn = fila[iSn]?.trim();
      const estadoRaw = fila[iStatus]?.trim();
      // Las filas de continuación (una segunda VLAN/service port del mismo
      // ONU) repiten el SN pero no traen Status: se descartan acá, la fila
      // principal ya trae todo lo que usa este módulo.
      if (!sn || !estadoRaw) continue;

      resultado.push({
        sn,
        oltNombre: fila[iOlt]?.trim() || 'OLT-desconocido',
        board: entero(fila[iBoard]),
        puertoPon: entero(fila[iPort]),
        zona: vacioNull(fila[iZone]),
        direccion: vacioNull(fila[iAddress]),
        odb: vacioNull(fila[iOdb]),
        estadoRaw,
        signal1310: decimal(fila[iSignal1310]),
        signal1490: decimal(fila[iSignal1490]),
        // Se guarda el campo Name tal cual: en el export real a veces viene
        // "DIRECCION / NAPx POSy / NOMBRE / RUT / TELEFONO" todo junto, y no
        // vale la pena adivinar el recorte — es solo referencia (nombre_cliente_ext),
        // no se usa para vincular el cliente real.
        nombre: vacioNull(fila[iName]),
        ultimoCambio: fechaHora(fila[iUltimoCambio]),
      });
    }

    this.logger.log(`CSV cargado: ${resultado.length} ONU (de ${this.ruta})`);
    this.filas = resultado;
    return resultado;
  }

  private mapearEstado(raw: string): EstadoConexion {
    const s = raw.toLowerCase();
    if (s === 'online') return 'ONLINE';
    if (s === 'power fail') return 'POWER_FAIL';
    if (s === 'offline') return 'OFFLINE';
    return 'DESCONOCIDO';
  }
}

function vacioNull(v: string | undefined): string | null {
  const s = v?.trim();
  return s ? s : null;
}

function entero(v: string | undefined): number | null {
  const s = v?.trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function decimal(v: string | undefined): number | null {
  const s = v?.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function fechaHora(v: string | undefined): Date | null {
  const s = v?.trim();
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parser CSV consciente de comillas (RFC 4180-ish): soporta comas dentro de
 * campos entre comillas y comillas escapadas como "". El export de SmartOLT
 * trae campos con comas embebidas (ej. direcciones tipo
 * "POS1,ROSA ESTER 02971 TORRE D D114"), así que un split(',') ingenuo rompe
 * el parseo.
 */
function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let enComillas = false;
  let i = 0;
  const n = texto.length;

  while (i < n) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        enComillas = false;
        i++;
        continue;
      }
      campo += c;
      i++;
      continue;
    }
    if (c === '"') {
      enComillas = true;
      i++;
      continue;
    }
    if (c === ',') {
      fila.push(campo);
      campo = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
      i++;
      continue;
    }
    campo += c;
    i++;
  }
  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}
