import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ClientesService } from './clientes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const RUT = '11111111-1';

// Doble del Decimal de Prisma: no es un number y se entrega como string.
const decimal = (valor: string) => ({ toString: () => valor, valueOf: () => valor });

// fecha_inicio es un DATE puro, que Postgres entrega a medianoche UTC.
const contratoBase = {
  id_contrato: 1,
  fecha_inicio: new Date('2024-01-15T00:00:00.000Z'),
  estado: 'ACTIVO',
  plan: {
    nombre_comercial: 'Fibra 600',
    velocidad_mbps: 600,
    precio_mensual: decimal('29990.00'),
  },
};

describe('servicios activos de la ficha de cliente', () => {
  let clienteMock: any;
  const findFirst = jest.fn(async (_args?: any) => clienteMock);
  const findMany = jest.fn(async () => []);
  const count = jest.fn(async () => 0);
  let service: ClientesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    clienteMock = {
      id_cliente: 1,
      rut: RUT,
      nombre_completo: 'Ana Soto',
      estado: 'ACTIVO',
      direcciones: [],
      contratos: [contratoBase],
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ClientesService,
        {
          provide: PrismaService,
          useValue: { cliente: { findFirst }, orden_trabajo: { findMany, count } },
        },
      ],
    }).compile();
    service = moduleRef.get(ClientesService);
  });

  it('entrega el precio como numero y la fecha sin hora', async () => {
    const { cliente } = await service.consultarPorRut(RUT, 1);
    const servicio = cliente.contratos_activos[0];

    expect(servicio.plan?.precio_mensual).toBe(29990);
    // Con un ISO completo el front, en zona de Chile, mostraria el dia 14.
    expect(servicio.fecha_inicio).toBe('2024-01-15');
  });

  it('tolera contratos sin plan y planes sin velocidad', async () => {
    clienteMock.contratos = [
      { ...contratoBase, id_contrato: 2, plan: null },
      { ...contratoBase, id_contrato: 3, plan: { ...contratoBase.plan, velocidad_mbps: null } },
    ];

    const { cliente } = await service.consultarPorRut(RUT, 1);

    expect(cliente.contratos_activos[0].plan).toBeNull();
    expect(cliente.contratos_activos[1].plan?.velocidad_mbps).toBeNull();
  });

  it('acota los contratos a la empresa, los ordena y pone techo a la lectura', async () => {
    await service.consultarPorRut(RUT, 7);
    const { contratos } = findFirst.mock.calls[0][0].include;

    expect(contratos.where).toEqual({ estado: 'ACTIVO', id_empresa: 7 });
    expect(contratos.orderBy).toEqual({ fecha_inicio: 'desc' });
    expect(contratos.take).toBeGreaterThan(0);
  });
});
