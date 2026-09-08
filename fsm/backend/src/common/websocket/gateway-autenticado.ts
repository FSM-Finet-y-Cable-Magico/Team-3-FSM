import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/** Mismo payload que firma `auth.service.ts` y que valida `jwt.strategy.ts`. */
export interface TokenPayload {
  userId: number;
  nombre_usuario: string;
  rol: string;
  id_empresa: number;
}

/**
 * Base de los gateways que emiten por empresa.
 *
 * Existe para no repetir la autenticacion: los WebSocket no pasan por
 * `JwtAuthGuard` --ese guard es de HTTP-- asi que cada gateway tiene que
 * validar el token por su cuenta. Duplicar eso en cada uno es como se termina
 * con dos gateways que autentican distinto, y uno de los dos mal.
 *
 * Tres decisiones que hereda todo el que extienda esta clase:
 *
 * 1. La empresa sale SIEMPRE del token, nunca del mensaje del cliente. Si el
 *    cliente eligiera su sala, cualquiera podria escuchar la de la otra empresa.
 *
 * 2. La sala se une en el handler de `join_empresa`, NO en `handleConnection`.
 *    Es contraintuitivo y ya costo una vez: si el cliente no emite ese mensaje,
 *    se conecta bien pero no recibe nada, y el sintoma parece "el WebSocket no
 *    anda".
 *
 * 3. Sin token, con token vencido o sin `id_empresa`, se corta la conexion en
 *    vez de dejarla abierta sin sala. Falla ruidoso, no en silencio.
 */
export abstract class GatewayAutenticado implements OnGatewayConnection, OnGatewayDisconnect {
  abstract server: Server;

  protected abstract readonly logger: Logger;

  /** Nombre del evento con el que este gateway publica sus actualizaciones. */
  protected abstract readonly evento: string;

  constructor(
    protected readonly jwtService: JwtService,
    protected readonly configService: ConfigService,
  ) {}

  handleConnection(client: Socket) {
    const token = this.extraerToken(client);
    if (!token) return this.rechazar(client, 'sin token');

    let payload: TokenPayload;
    try {
      // Mismo secreto que jwt.strategy.ts; verify() valida tambien la expiracion.
      payload = this.jwtService.verify<TokenPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      return this.rechazar(client, 'token invalido o vencido');
    }

    // `id_empresa` es nullable en el modelo usuario, asi que el token puede no
    // traerlo. Sin empresa no hay sala a la que unirse.
    if (typeof payload.id_empresa !== 'number') {
      return this.rechazar(client, 'token sin id_empresa');
    }

    client.data.user = payload;
    this.logger.log(`Cliente conectado: ${client.id} (empresa ${payload.id_empresa})`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  /** Une al cliente a la sala de SU empresa. Lo llama el `@SubscribeMessage`. */
  protected unirAEmpresa(client: Socket) {
    const user = client.data.user as TokenPayload | undefined;
    if (!user) return this.rechazar(client, 'join sin sesion');

    const room = `empresa_${user.id_empresa}`;
    client.join(room);
    client.emit('joined', { room });
  }

  /** Publica a todos los clientes de una empresa. */
  emitirActualizacion(id_empresa: number, datos: unknown) {
    this.server.to(`empresa_${id_empresa}`).emit(this.evento, datos);
  }

  private extraerToken(client: Socket): string | null {
    const desdeAuth = (client.handshake.auth as { token?: unknown })?.token;
    if (typeof desdeAuth === 'string' && desdeAuth.length > 0) return desdeAuth;

    // Un cliente Socket.io fuera del navegador puede mandarlo por cabecera.
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);

    return null;
  }

  private rechazar(client: Socket, motivo: string) {
    this.logger.warn(`Conexion rechazada (${motivo}): ${client.id}`);
    client.disconnect(true);
  }
}
