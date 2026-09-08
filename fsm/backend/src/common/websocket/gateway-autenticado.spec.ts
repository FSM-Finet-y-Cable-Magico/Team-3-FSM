import { describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { GatewayAutenticado } from './gateway-autenticado.js';

/**
 * Fija el aislamiento de los WebSocket.
 *
 * Importa mas que en un endpoint HTTP: los gateways NO pasan por el
 * `JwtAuthGuard` global --ese es de HTTP-- asi que si esta clase se equivoca,
 * no hay una segunda barrera detras. Un cliente que lograra unirse a la sala de
 * otra empresa recibiria sus lecturas de red en vivo.
 */
class GatewayDePrueba extends GatewayAutenticado {
  server: any = { to: jest.fn(() => ({ emit: jest.fn() })) };
  protected readonly logger = new Logger('prueba');
  protected readonly evento = 'evento_prueba';
  // `unirAEmpresa` es protected: se expone para poder ejercitarlo.
  unir(client: any) {
    this.unirAEmpresa(client);
  }
}

const socket = (over: Record<string, unknown> = {}) => ({
  id: 'sock-1',
  handshake: { auth: {}, headers: {} },
  data: {} as Record<string, unknown>,
  join: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn(),
  ...over,
});

const construir = (verify: () => unknown) =>
  new GatewayDePrueba({ verify } as any, { get: () => 'secreto' } as any);

describe('autenticacion de los gateways', () => {
  it('corta la conexion si no viene token', () => {
    const g = construir(() => ({}));
    const c = socket();

    g.handleConnection(c as any);

    expect(c.disconnect).toHaveBeenCalledWith(true);
    expect(c.data.user).toBeUndefined();
  });

  it('corta la conexion si el token no es valido o vencio', () => {
    const g = construir(() => {
      throw new Error('jwt expired');
    });
    const c = socket({ handshake: { auth: { token: 'lo-que-sea' }, headers: {} } });

    g.handleConnection(c as any);

    expect(c.disconnect).toHaveBeenCalledWith(true);
  });

  it('corta la conexion si el token no trae id_empresa', () => {
    // `id_empresa` es nullable en el modelo usuario, asi que puede faltar. Sin
    // empresa no hay sala, y dejar la conexion abierta sin sala confunde: el
    // cliente cree que escucha y no llega nada.
    const g = construir(() => ({ userId: 1, nombre_usuario: 'x', rol: 'ADMIN' }));
    const c = socket({ handshake: { auth: { token: 't' }, headers: {} } });

    g.handleConnection(c as any);

    expect(c.disconnect).toHaveBeenCalledWith(true);
  });

  it('acepta el token por cabecera Authorization, no solo por auth', () => {
    // Un cliente Socket.io fuera del navegador lo manda asi.
    const g = construir(() => ({ userId: 1, nombre_usuario: 'x', rol: 'ADMIN', id_empresa: 3 }));
    const c = socket({ handshake: { auth: {}, headers: { authorization: 'Bearer t' } } });

    g.handleConnection(c as any);

    expect(c.disconnect).not.toHaveBeenCalled();
    expect((c.data.user as any).id_empresa).toBe(3);
  });

  it('la sala sale del TOKEN, nunca de lo que mande el cliente', () => {
    // Lo central: si el cliente eligiera su sala, cualquiera escucharia la de
    // la otra empresa mandando otro numero.
    const g = construir(() => ({ userId: 1, nombre_usuario: 'x', rol: 'ADMIN', id_empresa: 7 }));
    const c = socket({ handshake: { auth: { token: 't' }, headers: {} } });

    g.handleConnection(c as any);
    g.unir(c as any);

    expect(c.join).toHaveBeenCalledWith('empresa_7');
    expect(c.join).toHaveBeenCalledTimes(1);
  });

  it('no une a nadie que no haya pasado por la autenticacion', () => {
    const g = construir(() => ({}));
    const c = socket();

    g.unir(c as any);

    expect(c.join).not.toHaveBeenCalled();
    expect(c.disconnect).toHaveBeenCalledWith(true);
  });

  it('publica solo a la sala de la empresa indicada', () => {
    const g = construir(() => ({}));

    g.emitirActualizacion(4, { hola: true });

    expect(g.server.to).toHaveBeenCalledWith('empresa_4');
  });
});
