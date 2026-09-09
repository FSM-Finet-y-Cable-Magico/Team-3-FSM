import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfiguracionService } from './configuracion.service.js';
import { ActualizarConfiguracionDto } from './dto/actualizar-configuracion.dto.js';
import { UMBRAL_DESCONEXION_MIN_DEFECTO } from '../monitoreo/monitoreo.constants.js';

/**
 * RF-46: "El valor de N es configurable por el administrador en un rango de 10
 * a 120 minutos".
 *
 * El motor ya leia el valor y caia al default si estaba en null, pero no habia
 * como escribirlo: sin endpoint ni pantalla, el unico camino era SQL directo,
 * o sea que el RF no estaba cumplido.
 */
describe('RF-46 · umbral de desconexion configurable', () => {
  let service: ConfiguracionService;
  const findUnique = jest.fn(async (_a: unknown) => null as any);
  const update = jest.fn(async (_a: unknown) => ({}) as any);

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ConfiguracionService,
        { provide: PrismaService, useValue: { empresa: { findUnique, update } } },
      ],
    }).compile();
    service = mod.get(ConfiguracionService);
  });

  // --- El rango, que es lo que fija el RF ---------------------------------

  const validar = async (valor: unknown) => {
    const dto = plainToInstance(ActualizarConfiguracionDto, {
      umbral_desconexion_min: valor,
    });
    return validate(dto);
  };

  it('rechaza 9 y acepta 10: el limite inferior del RF', async () => {
    expect(await validar(9)).toHaveLength(1);
    expect(await validar(10)).toHaveLength(0);
  });

  it('rechaza 121 y acepta 120: el limite superior del RF', async () => {
    expect(await validar(121)).toHaveLength(1);
    expect(await validar(120)).toHaveLength(0);
  });

  it('rechaza los minutos fraccionados', async () => {
    // La columna es SmallInt: 30.5 se guardaria truncado y en silencio.
    expect(await validar(30.5)).toHaveLength(1);
  });

  it('acepta null explicito para volver al valor del sistema', async () => {
    expect(await validar(null)).toHaveLength(0);
  });

  // --- Lectura y escritura -------------------------------------------------

  it('dice cual es el umbral vigente cuando la empresa no configuro ninguno', async () => {
    // Un null no significa "sin umbral": significa que rige el del sistema, y
    // la Vista tiene que poder mostrar cual es sin recalcularlo.
    findUnique.mockResolvedValue({ id_empresa: 1, nombre: 'FiNet', umbral_desconexion_min: null });

    const r = await service.obtener(1);

    expect(r.umbral_desconexion_min).toBeNull();
    expect(r.umbral_vigente).toBe(UMBRAL_DESCONEXION_MIN_DEFECTO);
    expect(r).toMatchObject({ umbral_min: 10, umbral_max: 120 });
  });

  it('guarda el valor sobre la empresa que corresponde', async () => {
    findUnique.mockResolvedValue({ id_empresa: 2, nombre: 'Cable Mágico', umbral_desconexion_min: 45 });

    await service.actualizar(2, { umbral_desconexion_min: 45 });

    expect((update.mock.calls[0][0] as any).where).toEqual({ id_empresa: 2 });
    expect((update.mock.calls[0][0] as any).data).toEqual({ umbral_desconexion_min: 45 });
  });

  it('omitir el campo no pisa el valor que ya estaba', async () => {
    findUnique.mockResolvedValue({ id_empresa: 1, nombre: 'FiNet', umbral_desconexion_min: 45 });

    await service.actualizar(1, {});

    expect(update).not.toHaveBeenCalled();
  });

  it('no escribe sobre una empresa que no existe', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.actualizar(99, { umbral_desconexion_min: 30 })).rejects.toThrow(
      /Empresa no encontrada/,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
