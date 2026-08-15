import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

// Mismo payload que firma auth.service.ts y que valida jwt.strategy.ts.
interface TokenPayload {
  userId: number;
  nombre_usuario: string;
  rol: string;
  id_empresa: number;
}

@WebSocketGateway({ cors: { origin: process.env.FRONTEND_URL }, namespace: '/dashboard' })
export class DashboardGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private readonly logger = new Logger(DashboardGateway.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  afterInit() {
    this.logger.log('Dashboard WebSocket iniciado');
  }

  handleConnection(client: Socket) {
    const token = this.extraerToken(client);
    if (!token) {
      this.rechazar(client, 'sin token');
      return;
    }

    let payload: TokenPayload;
    try {
      // Mismo secreto que jwt.strategy.ts; verify() valida tambien la expiracion.
      payload = this.jwtService.verify<TokenPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      this.rechazar(client, 'token invalido o vencido');
      return;
    }

    // id_empresa es nullable en el modelo usuario, asi que el token puede no
    // traerlo. Sin empresa no hay sala a la que unirse.
    if (typeof payload.id_empresa !== 'number') {
      this.rechazar(client, 'token sin id_empresa');
      return;
    }

    client.data.user = payload;
    this.logger.log(`Cliente conectado: ${client.id} (empresa ${payload.id_empresa})`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  @SubscribeMessage('join_empresa')
  handleJoinEmpresa(client: Socket) {
    // La empresa sale del token guardado en handleConnection y nunca del
    // mensaje: el cliente no elige a que sala se suscribe.
    const user = client.data.user as TokenPayload | undefined;
    if (!user) {
      this.rechazar(client, 'join sin sesion');
      return;
    }

    const room = `empresa_${user.id_empresa}`;
    client.join(room);
    client.emit('joined', { room });
  }

  emitirActualizacion(id_empresa: number, datos: unknown) {
    this.server.to(`empresa_${id_empresa}`).emit('dashboard_update', datos);
  }

  private extraerToken(client: Socket): string | null {
    const desdeAuth = (client.handshake.auth as { token?: unknown })?.token;
    if (typeof desdeAuth === 'string' && desdeAuth.length > 0) {
      return desdeAuth;
    }

    // Un cliente Socket.io fuera del navegador puede mandarlo por cabecera.
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7);
    }

    return null;
  }

  private rechazar(client: Socket, motivo: string) {
    this.logger.warn(`Conexion rechazada (${motivo}): ${client.id}`);
    client.disconnect(true);
  }
}
