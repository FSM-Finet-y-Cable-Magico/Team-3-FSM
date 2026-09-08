import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportesService, type Reporte, type ReporteComparativo } from './reportes.service.js';
import { ExportacionService } from './exportacion.service.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

interface UsuarioAutenticado {
  userId: number;
  rol: string;
  id_empresa: number;
}

type Formato = 'json' | 'pdf' | 'xlsx';

@Controller('reportes')
export class ReportesController {
  constructor(
    private readonly reportes: ReportesService,
    private readonly exportacion: ExportacionService,
  ) {}

  /** Qué se puede pedir y con qué filtros, para armar la pantalla. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('opciones')
  opciones() {
    return {
      tipos: ['diario', 'on-demand', 'semanal', 'mensual', 'comparativo'],
      formatos: ['json', 'pdf', 'xlsx'],
      filtros: ['id_tecnico', 'desde', 'hasta'],
    };
  }

  /** RF-38 (a) / CU-45: el resumen del día anterior. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('diario')
  async diario(
    @CurrentUser() user: UsuarioAutenticado,
    @Res({ passthrough: true }) res: Response,
    @Query('fecha') fecha?: string,
    @Query('formato') formato?: string,
    @Query('id_tecnico') idTecnico?: string,
    @Query('empresa') empresa?: string,
  ) {
    // Por defecto AYER, no hoy: el reporte diario resume la jornada cerrada.
    const dia = fecha ? this.fecha(fecha) : this.ayer();
    const rango = this.reportes.rangoDeDia(dia);
    const r = await this.reportes.construir(this.empresaDe(user, empresa), rango, {
      etiqueta: dia.toLocaleDateString('es-CL'),
      id_tecnico: this.entero(idTecnico),
    });
    return this.responder(r, formato, res);
  }

  /** RF-38 (b) / CU-26: el usuario elige el rango. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('on-demand')
  async onDemand(
    @CurrentUser() user: UsuarioAutenticado,
    @Res({ passthrough: true }) res: Response,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('formato') formato?: string,
    @Query('id_tecnico') idTecnico?: string,
    @Query('empresa') empresa?: string,
  ) {
    if (!desde || !hasta) throw new BadRequestException('Indique desde y hasta');
    const d = this.fecha(desde);
    const h = this.fecha(hasta);
    if (h < d) throw new BadRequestException('El rango termina antes de empezar');

    // `hasta` se toma INCLUSIVO para quien consulta --si pide 1 al 30 espera que
    // el 30 entre-- y se convierte al limite exclusivo que usa el constructor.
    const fin = this.reportes.rangoDeDia(h).hasta;
    const r = await this.reportes.construir(
      this.empresaDe(user, empresa),
      { desde: this.reportes.rangoDeDia(d).desde, hasta: fin },
      {
        etiqueta: `${d.toLocaleDateString('es-CL')} a ${h.toLocaleDateString('es-CL')}`,
        id_tecnico: this.entero(idTecnico),
      },
    );
    return this.responder(r, formato, res);
  }

  /** RF-39 / CU-60: la semana o el mes cerrado. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('periodico')
  async periodico(
    @CurrentUser() user: UsuarioAutenticado,
    @Res({ passthrough: true }) res: Response,
    @Query('tipo') tipo?: string,
    @Query('fecha') fecha?: string,
    @Query('formato') formato?: string,
    @Query('empresa') empresa?: string,
  ) {
    if (tipo !== 'semanal' && tipo !== 'mensual') {
      throw new BadRequestException("tipo debe ser 'semanal' o 'mensual'");
    }
    // Sin fecha, el período CERRADO anterior: es lo que el CU genera solo.
    const ref = fecha ? this.fecha(fecha) : this.periodoAnterior(tipo);
    const rango = tipo === 'semanal' ? this.reportes.rangoDeSemana(ref) : this.reportes.rangoDeMes(ref);

    const fin = new Date(rango.hasta);
    fin.setDate(fin.getDate() - 1);
    const etiqueta =
      tipo === 'semanal'
        ? `semana ${rango.desde.toLocaleDateString('es-CL')} a ${fin.toLocaleDateString('es-CL')}`
        : `${rango.desde.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })}`;

    const r = await this.reportes.construir(this.empresaDe(user, empresa), rango, {
      etiqueta,
      // Las dos secciones que RF-39 agrega sobre RF-38.
      incluirPeriodico: true,
    });
    return this.responder(r, formato, res);
  }

  /**
   * RF-41 / CU-47: panel comparativo entre empresas.
   *
   * Solo ADMIN, como fija el RF. Es el unico reporte que NO acepta el parametro
   * `empresa`: comparar es justamente ver todas, y dejar elegir una haria del
   * comparativo un reporte normal con otro nombre.
   */
  @Roles('ADMIN')
  @Get('comparativo')
  async comparativo(
    @Res({ passthrough: true }) res: Response,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('formato') formato?: string,
  ) {
    if (!desde || !hasta) throw new BadRequestException('Indique desde y hasta');
    const d = this.fecha(desde);
    const h = this.fecha(hasta);
    if (h < d) throw new BadRequestException('El rango termina antes de empezar');

    const c = await this.reportes.comparativo(
      { desde: this.reportes.rangoDeDia(d).desde, hasta: this.reportes.rangoDeDia(h).hasta },
      `${d.toLocaleDateString('es-CL')} a ${h.toLocaleDateString('es-CL')}`,
    );
    return this.responderComparativo(c, formato, res);
  }

  // ---------------------------------------------------------------------------

  private async responder(r: Reporte, formato: string | undefined, res: Response) {
    const f = (formato ?? 'json') as Formato;
    if (f === 'json') return r;
    if (f !== 'pdf' && f !== 'xlsx') throw new BadRequestException("formato debe ser 'pdf' o 'xlsx'");

    const archivo = f === 'pdf' ? await this.exportacion.aPdf(r) : await this.exportacion.aExcel(r);
    res.setHeader('Content-Type', archivo.contentType);
    // `filename*` ademas del `filename` para que un nombre con tildes no se
    // corrompa en la descarga.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${archivo.nombre}"; filename*=UTF-8''${encodeURIComponent(archivo.nombre)}`,
    );
    res.setHeader('Content-Length', String(archivo.contenido.length));
    res.end(archivo.contenido);
    return undefined;
  }

  private async responderComparativo(
    c: ReporteComparativo,
    formato: string | undefined,
    res: Response,
  ) {
    const f = (formato ?? 'json') as Formato;
    if (f === 'json') return c;
    if (f !== 'pdf' && f !== 'xlsx') throw new BadRequestException("formato debe ser 'pdf' o 'xlsx'");

    const archivo =
      f === 'pdf' ? await this.exportacion.comparativoAPdf(c) : await this.exportacion.comparativoAExcel(c);
    res.setHeader('Content-Type', archivo.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${archivo.nombre}"; filename*=UTF-8''${encodeURIComponent(archivo.nombre)}`,
    );
    res.setHeader('Content-Length', String(archivo.contenido.length));
    res.end(archivo.contenido);
    return undefined;
  }

  private fecha(v: string) {
    const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`Fecha inválida: ${v}`);
    return d;
  }

  private ayer() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  }

  private periodoAnterior(tipo: 'semanal' | 'mensual') {
    const d = new Date();
    if (tipo === 'semanal') d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    return d;
  }

  private entero(v?: string) {
    if (!v) return undefined;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }

  /** Igual que en el resto: solo ADMIN puede mirar otra empresa. */
  private empresaDe(user: UsuarioAutenticado, empresa?: string) {
    return user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
  }
}
