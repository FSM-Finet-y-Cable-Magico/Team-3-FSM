import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';
import { ReportesService } from './reportes.service.js';
import { ExportacionService } from './exportacion.service.js';

/**
 * RF-38, RF-39 y RF-40.
 *
 * Lo que se fija es el CALCULO, que es lo unico que un reporte tiene de propio:
 * el resto es dibujarlo. Los rangos llevan pruebas aparte porque son la fuente
 * clasica de errores silenciosos --el reporte sale, pero le falta un dia.
 */
describe('Reportes', () => {
  let service: ReportesService;
  let exportacion: ExportacionService;
  let ots: any[];

  const otFindMany = jest.fn(async (_a: unknown) => ots);
  const otCount = jest.fn(async (_a: unknown) => 0);
  const contratoFindMany = jest.fn(async (_a: unknown) => [] as any[]);
  const evaluar = jest.fn(async (_c: number, _e: number, _h?: Date) => ({
    activa: false, total_reparaciones_30_dias: 0, desde: new Date(), hasta: new Date(), ots: [] as any[],
  }));

  const ot = (over: Record<string, unknown> = {}) => ({
    id_ot: 1,
    tipo_ot: 'REPARACION',
    id_cliente: 1,
    fecha_creacion: new Date('2026-04-10T08:00:00'),
    fecha_completada: new Date('2026-04-10T12:00:00'),
    categoria_falla: { nombre: 'Internet lento' },
    tecnico: { id_usuario: 5, nombre_completo: 'Fernando Rojas' },
    materiales: [],
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    ots = [];
    const mod = await Test.createTestingModule({
      providers: [
        ReportesService,
        ExportacionService,
        {
          provide: PrismaService,
          useValue: {
            empresa: {
              findUnique: jest.fn(async (a: any) => ({
                id_empresa: a.where.id_empresa,
                nombre: a.where.id_empresa === 1 ? 'FiNet Limitada' : 'Cable Mágico Litoral',
              })),
              findMany: jest.fn(async () => [{ id_empresa: 1 }, { id_empresa: 2 }]),
            },
            orden_trabajo: { findMany: otFindMany, count: otCount },
            contrato: { findMany: contratoFindMany },
            cliente: { findFirst: jest.fn(async () => ({ nombre_completo: 'Vicente Diaz' })) },
          },
        },
        { provide: ReparacionesRecurrentesService, useValue: { evaluar } },
      ],
    }).compile();
    service = mod.get(ReportesService);
    exportacion = mod.get(ExportacionService);
  });

  const construir = (extra = {}) =>
    service.construir(1, service.rangoDeDia(new Date('2026-04-10T09:00:00')), { etiqueta: 'prueba', ...extra });

  // --- Rangos -----------------------------------------------------------------

  it('la semana va de lunes a lunes, tomando cualquier dia de esa semana', async () => {
    // 2026-04-10 es viernes; 2026-04-12, domingo. Los dos caen en la misma
    // semana, que empieza el lunes 6. El domingo es el caso que rompe la
    // aritmetica ingenua con getDay(), porque ahi getDay() vale 0.
    for (const dia of ['2026-04-10T15:00:00', '2026-04-12T23:30:00']) {
      const r = service.rangoDeSemana(new Date(dia));
      expect(r.desde.toISOString().slice(0, 10)).toBe('2026-04-06');
      expect(r.hasta.toISOString().slice(0, 10)).toBe('2026-04-13');
    }
  });

  it('el mes va del primero al primero del siguiente', () => {
    const r = service.rangoDeMes(new Date('2026-04-17T10:00:00'));
    expect(r.desde.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(r.hasta.toISOString().slice(0, 10)).toBe('2026-05-01');
  });

  it('el rango del dia es semiabierto, asi que no se pierde el ultimo segundo', async () => {
    // Con `lte 23:59:59` una OT cerrada a las 23:59:59.500 quedaba afuera.
    const r = service.rangoDeDia(new Date('2026-04-10T09:00:00'));
    expect(r.desde.getHours()).toBe(0);
    expect(r.hasta.getTime() - r.desde.getTime()).toBe(86_400_000);

    await construir();
    const where = (otFindMany.mock.calls[0][0] as any).where;
    expect(where.fecha_completada.lt).toEqual(r.hasta);
    expect(where.fecha_completada.gte).toEqual(r.desde);
  });

  it('cuenta por fecha de CIERRE y solo las completadas', async () => {
    // Un reporte de "lo que se hizo en abril" no puede incluir trabajo cerrado
    // en mayo, ni ordenes que siguen abiertas.
    await construir();
    const where = (otFindMany.mock.calls[0][0] as any).where;
    expect(where.estado).toBe('COMPLETADA');
    expect(where.fecha_creacion).toBeUndefined();
  });

  // --- Indicadores ------------------------------------------------------------

  it('separa instalaciones de reparaciones y saca porcentaje de fallas', async () => {
    ots = [
      ot({ tipo_ot: 'INSTALACION', categoria_falla: null }),
      ot({ categoria_falla: { nombre: 'Internet lento' } }),
      ot({ categoria_falla: { nombre: 'Internet lento' } }),
      ot({ categoria_falla: { nombre: 'IPTV pirata' } }),
    ];

    const r = await construir();

    expect(r.totales).toMatchObject({ ot_completadas: 4, instalaciones: 1, reparaciones: 3 });
    // El porcentaje es sobre las REPARACIONES, no sobre el total: una falla no
    // puede ser el 50 % de una instalacion.
    expect(r.fallas_por_categoria).toEqual([
      { etiqueta: 'Internet lento', cantidad: 2, pct: 67 },
      { etiqueta: 'IPTV pirata', cantidad: 1, pct: 33 },
    ]);
  });

  it('el tiempo promedio es null y no cero cuando no hay cierres', async () => {
    // Cero es un tiempo: mostrarlo haria creer que cierran al instante.
    ots = [ot({ fecha_completada: null })];

    const r = await construir();

    expect(r.por_tecnico[0].tiempo_promedio_horas).toBeNull();
  });

  it('promedia las horas entre creacion y cierre', async () => {
    ots = [
      ot({ fecha_creacion: new Date('2026-04-10T08:00:00'), fecha_completada: new Date('2026-04-10T10:00:00') }),
      ot({ fecha_creacion: new Date('2026-04-10T08:00:00'), fecha_completada: new Date('2026-04-10T12:00:00') }),
    ];

    const r = await construir();

    expect(r.por_tecnico[0]).toMatchObject({ completadas: 2, tiempo_promedio_horas: 3 });
  });

  it('no descarta las OT sin tecnico: las agrupa aparte', async () => {
    // Son las resueltas remotamente por el jefe tecnico. Descartarlas haria que
    // la suma por tecnico no cuadre con el total.
    ots = [ot(), ot({ tecnico: null })];

    const r = await construir();

    expect(r.por_tecnico.map((t) => t.tecnico)).toContain('Sin técnico asignado');
    expect(r.por_tecnico.reduce((n, t) => n + t.completadas, 0)).toBe(r.totales.ot_completadas);
  });

  it('suma materiales por tipo y los desglosa por tecnico', async () => {
    ots = [
      ot({ materiales: [{ cantidad: '2', tipo_equipo: { nombre: 'Conector SC/APC' } }] }),
      ot({
        tecnico: { id_usuario: 6, nombre_completo: 'Ana Soto' },
        materiales: [{ cantidad: '3', tipo_equipo: { nombre: 'Conector SC/APC' } }],
      }),
    ];

    const r = await construir();

    expect(r.materiales[0]).toMatchObject({ material: 'Conector SC/APC', cantidad: 5 });
    expect(r.materiales[0].por_tecnico).toEqual([
      { tecnico: 'Ana Soto', cantidad: 3 },
      { tecnico: 'Fernando Rojas', cantidad: 2 },
    ]);
  });

  // --- RF-39 ------------------------------------------------------------------

  it('las secciones de RF-39 solo aparecen en el reporte periodico', async () => {
    ots = [ot()];

    const diario = await construir();
    expect(diario.instalaciones_por_plan).toBeUndefined();
    expect(diario.clientes_recurrentes).toBeUndefined();

    const periodico = await construir({ incluirPeriodico: true });
    expect(periodico.instalaciones_por_plan).toBeDefined();
    expect(periodico.clientes_recurrentes).toBeDefined();
  });

  it('evalua la recurrencia a la fecha de cada cierre, no al final del periodo', async () => {
    // Es lo que permite ver a un cliente que fue recurrente a mitad de mes y
    // despues se arreglo. Por eso el servicio de RF-08 acepta un `hasta`.
    const cierre = new Date('2026-04-10T12:00:00');
    ots = [ot({ fecha_completada: cierre })];

    await construir({ incluirPeriodico: true });

    expect(evaluar).toHaveBeenCalledWith(1, 1, cierre);
  });

  it('lista al cliente recurrente con sus OT', async () => {
    ots = [ot()];
    evaluar.mockResolvedValueOnce({
      activa: true, total_reparaciones_30_dias: 4, desde: new Date(), hasta: new Date(),
      ots: [{ id_ot: 20 }, { id_ot: 18 }] as any,
    });

    const r = await construir({ incluirPeriodico: true });

    expect(r.clientes_recurrentes).toEqual([
      { id_cliente: 1, cliente: 'Vicente Diaz', reparaciones: 4, ots: [20, 18] },
    ]);
  });

  // --- RF-40 ------------------------------------------------------------------

  it('el nombre del archivo sigue el formato de CU-46', async () => {
    ots = [];
    const r = await construir();
    r.periodo.etiqueta = '2026-04';

    expect(exportacion.nombreArchivo(r, 'xlsx')).toBe('Reporte_FSM_FiNetLimitada_2026-04.xlsx');
  });

  it('exporta a Excel y a PDF archivos con contenido valido', async () => {
    ots = [ot()];
    const r = await construir();

    const xlsx = await exportacion.aExcel(r);
    const pdf = await exportacion.aPdf(r);

    // Firma de zip (PK) y de PDF: si el stream se devolviera antes de tiempo,
    // el archivo saldria truncado y estas dos comprobaciones lo detectan.
    expect(xlsx.contenido.subarray(0, 2).toString()).toBe('PK');
    expect(pdf.contenido.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.contenido.subarray(-6).toString()).toContain('EOF');
  });

  it('un periodo sin actividad exporta igual, no falla', async () => {
    // CU-60, Excepcion 1: la ausencia de actividad tambien es informacion.
    ots = [];
    const r = await construir();

    const xlsx = await exportacion.aExcel(r);
    expect(xlsx.contenido.length).toBeGreaterThan(0);
    expect(r.por_tecnico).toEqual([]);
  });

  // --- RF-41 ------------------------------------------------------------------

  describe('panel comparativo entre empresas', () => {
    const rango = () => ({
      desde: new Date('2026-04-01T00:00:00'),
      hasta: new Date('2026-05-01T00:00:00'),
    });

    it('incluye a TODAS las empresas, tambien las que no tuvieron actividad', async () => {
      // Cable Magico todavia no opera. Omitirla haria parecer que al panel le
      // falta algo; mostrarla en cero dice lo que realmente pasa.
      ots = [];

      const c = await service.comparativo(rango(), 'abril');

      expect(c.reportes.map((r) => r.empresa.id_empresa)).toEqual([1, 2]);
      expect(c.comparacion[0].valores).toHaveLength(2);
    });

    it('el tiempo promedio se pondera por OT, no promedia promedios', async () => {
      // Un tecnico con 1 OT de 10 h y otro con 9 de 1 h dan 1,9 h ponderado y
      // 5,5 h promediando promedios. Lo segundo le da el mismo peso al que hizo
      // una que al que hizo nueve.
      ots = [
        ot({ fecha_creacion: new Date('2026-04-10T00:00:00'), fecha_completada: new Date('2026-04-10T10:00:00') }),
        ...Array.from({ length: 9 }, () =>
          ot({
            tecnico: { id_usuario: 6, nombre_completo: 'Ana Soto' },
            fecha_creacion: new Date('2026-04-10T00:00:00'),
            fecha_completada: new Date('2026-04-10T01:00:00'),
          }),
        ),
      ];

      const c = await service.comparativo(rango(), 'abril');
      const tiempo = c.comparacion.find((m) => m.metrica === 'Tiempo promedio de cierre')!;

      expect(tiempo.valores[0].valor).toBe(1.9);
      expect(tiempo.mas_es_mejor).toBe(false);
    });

    it('el tiempo promedio es null cuando la empresa no cerro ninguna OT', async () => {
      ots = [];

      const c = await service.comparativo(rango(), 'abril');
      const tiempo = c.comparacion.find((m) => m.metrica === 'Tiempo promedio de cierre')!;

      expect(tiempo.valores.every((v) => v.valor === null)).toBe(true);
    });

    it('exporta el comparativo con una columna por empresa', async () => {
      ots = [ot()];

      const c = await service.comparativo(rango(), '2026-04');
      const xlsx = await exportacion.comparativoAExcel(c);
      const pdf = await exportacion.comparativoAPdf(c);

      expect(xlsx.nombre).toBe('Comparativo_FSM_2026-04.xlsx');
      expect(xlsx.contenido.subarray(0, 2).toString()).toBe('PK');
      expect(pdf.contenido.subarray(0, 5).toString()).toBe('%PDF-');
    });
  });
});
