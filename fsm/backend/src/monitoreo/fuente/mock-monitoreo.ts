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
 * Fuente de datos falsa para desarrollo sin credenciales de SmartOLT.
 *
 * Devuelve un puñado de OLTs y ONTs fijas, y en cada `listarLecturas()` genera
 * mediciones con algo de variación para que:
 *   - el poller tenga qué persistir,
 *   - ocasionalmente cambie el estado de una ONT (y se pruebe el historial),
 *   - la potencia a veces caiga fuera del rango operativo.
 *
 * Los números de serie (`SN-...`) están pensados para coincidir con los que
 * siembre el seed o cargue el equipo en `unidad_equipo`, así el resolvedor de
 * ONT los liga a una unidad/cliente reales. Si no coinciden, las lecturas se
 * guardan igual con los enlaces en null.
 */
export class MockMonitoreo implements FuenteMonitoreo {
  readonly nombre = 'mock';
  private readonly logger = new Logger(MockMonitoreo.name);

  private readonly olts: OltInfo[] = [
    { id_externo: '1', nombre: 'OLT-Central', ip_gestion: '10.0.0.10', ubicacion: 'Nodo Centro' },
    { id_externo: '2', nombre: 'OLT-Norte', ip_gestion: '10.0.0.11', ubicacion: 'Nodo Norte' },
  ];

  private readonly onts: OntDetalle[] = [
    { sn: 'SN-0001', id_externo: '101', olt_externo: '1', board: 1, puerto_pon: 1, zona: 'Centro', odb: 'NAP-C-01', nombre_cliente: 'Cliente Demo 1', direccion_cliente: 'Calle Falsa 123', modelo: 'HG8310M' },
    { sn: 'SN-0002', id_externo: '102', olt_externo: '1', board: 1, puerto_pon: 1, zona: 'Centro', odb: 'NAP-C-01', nombre_cliente: 'Cliente Demo 2', direccion_cliente: 'Av. Siempre Viva 742', modelo: 'HG8310M' },
    { sn: 'SN-0003', id_externo: '103', olt_externo: '1', board: 1, puerto_pon: 2, zona: 'Centro', odb: 'NAP-C-02', nombre_cliente: 'Cliente Demo 3', direccion_cliente: 'Pasaje Sur 55', modelo: 'F601' },
    { sn: 'SN-0004', id_externo: '201', olt_externo: '2', board: 2, puerto_pon: 1, zona: 'Norte', odb: 'NAP-N-01', nombre_cliente: 'Cliente Demo 4', direccion_cliente: 'Ruta 5 Norte km 12', modelo: 'F601' },
    { sn: 'SN-0005', id_externo: '202', olt_externo: '2', board: 2, puerto_pon: 1, zona: 'Norte', odb: 'NAP-N-01', nombre_cliente: 'Cliente Demo 5', direccion_cliente: 'Los Aromos 8', modelo: 'HG8310M' },
  ];

  /** Estado "real" simulado de cada ONT, para que las transiciones sean coherentes. */
  private estadoActual = new Map<string, EstadoConexion>(
    this.onts.map((o) => [o.sn, 'ONLINE' as EstadoConexion]),
  );

  async listarOlts(): Promise<OltInfo[]> {
    return structuredClone(this.olts);
  }

  async listarOntDetalles(filtro?: FiltroConsulta): Promise<OntDetalle[]> {
    return structuredClone(this.onts.filter((o) => this.pasaFiltro(o, filtro)));
  }

  async listarLecturas(filtro?: FiltroConsulta): Promise<LecturaOnt[]> {
    const ahora = new Date();
    const onts = this.onts.filter((o) => this.pasaFiltro(o, filtro));

    return onts.map((o) => {
      // ~4% de las veces una ONT cambia de estado.
      if (Math.random() < 0.04) {
        const previo = this.estadoActual.get(o.sn) ?? 'ONLINE';
        const nuevo: EstadoConexion = previo === 'ONLINE' ? this.aleatorio(['OFFLINE', 'LOS']) : 'ONLINE';
        this.estadoActual.set(o.sn, nuevo);
      }

      const estado = this.estadoActual.get(o.sn) ?? 'ONLINE';
      // La mayoría dentro del rango operativo [-24, -19]; ~15% con excursión.
      const rango: [number, number] = Math.random() < 0.15 ? [-27, -17] : [-23.5, -19.5];
      const potencia_rx_dbm =
        estado === 'ONLINE'
          ? Math.round((this.entre(rango[0], rango[1]) + Number.EPSILON) * 100) / 100
          : null;

      return { sn: o.sn, potencia_rx_dbm, estado, medido_en: ahora };
    });
  }

  private pasaFiltro(o: OntDetalle, f?: FiltroConsulta): boolean {
    if (!f) return true;
    if (f.olt_externo && o.olt_externo !== f.olt_externo) return false;
    if (f.zona && o.zona !== f.zona) return false;
    return true;
  }

  private entre(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private aleatorio<T>(xs: T[]): T {
    return xs[Math.floor(Math.random() * xs.length)];
  }
}
