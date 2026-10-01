import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IntegracionesController } from './integraciones.controller.js';
import { IntegracionesService } from './integraciones.service.js';
import { InstalacionesService } from './instalaciones.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { CrearTicketIntegracionDto } from '../tickets/dto/tickets.dto.js';

/**
 * CU-29: el actor es el cliente final, que reporta desde "formulario web o
 * bot". Esos canales son de otros grupos (portal y bot), asi que entran por la
 * API de integracion, con su API key y dentro de su scope de empresas.
 */
describe('tickets desde canales digitales', () => {
  const crear = jest.fn(async (..._a: unknown[]): Promise<any> => ({ id_ticket: 1, codigo_seguimiento: 'TK-ABCDEFG', vence_en: 'x' }));
  const porCodigo = jest.fn(async (..._a: unknown[]): Promise<any> => ({ codigo_seguimiento: 'TK-ABCDEFG', estado: 'ABIERTO' }));
  const ctrl = new IntegracionesController(
    {} as IntegracionesService,
    {} as InstalacionesService,
    { crear, porCodigo } as unknown as TicketsService,
    {} as never,
  );
  const req = { apiScope: { grupo: 'G2', empresas: [1] } };
  const dto = { id_empresa: 1, rut_cliente: '12345678-5', id_categoria: 1, descripcion: 'Sin internet', origen: 'BOT' };

  it('crea el ticket a nombre del sistema, en la empresa pedida', async () => {
    const r = await ctrl.crearTicket(req, dto as CrearTicketIntegracionDto);
    expect(crear).toHaveBeenCalledWith(
      { rut_cliente: '12345678-5', id_categoria: 1, descripcion: 'Sin internet', origen: 'BOT' },
      { userId: null, id_empresa: 1 },
    );
    expect(r).toEqual({ success: true, data: { id_ticket: 1, codigo_seguimiento: 'TK-ABCDEFG', vence_en: 'x' } });
  });

  it('403 fuera del scope de la API key', async () => {
    await expect(ctrl.crearTicket(req, { ...dto, id_empresa: 2 } as CrearTicketIntegracionDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(ctrl.seguimientoTicket(req, 'TK-ABCDEFG', '2')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el seguimiento por codigo responde en el envoltorio', async () => {
    await expect(ctrl.seguimientoTicket(req, 'TK-ABCDEFG', '1')).resolves.toEqual({
      success: true,
      data: { codigo_seguimiento: 'TK-ABCDEFG', estado: 'ABIERTO' },
    });
    expect(porCodigo).toHaveBeenCalledWith('TK-ABCDEFG', 1);
  });

  it('desde un canal digital el origen tiene que ser digital', async () => {
    const errs = await validate(plainToInstance(CrearTicketIntegracionDto, { ...dto, origen: 'TELEFONO' }));
    expect(errs.map((e) => e.property)).toEqual(['origen']);
  });
});
