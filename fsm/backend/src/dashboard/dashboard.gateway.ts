import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GatewayAutenticado } from '../common/websocket/gateway-autenticado.js';

/**
 * Actualizaciones del dashboard en vivo (RF-57).
 *
 * La autenticacion, el manejo de salas y el corte de conexiones invalidas viven
 * en `GatewayAutenticado`, compartidos con el gateway de monitoreo. Acá queda
 * solo lo propio de este canal: su namespace y su evento.
 */
@WebSocketGateway({ cors: { origin: process.env.FRONTEND_URL }, namespace: '/dashboard' })
export class DashboardGateway extends GatewayAutenticado implements OnGatewayInit {
  @WebSocketServer() server: Server;

  protected readonly logger = new Logger(DashboardGateway.name);
  protected readonly evento = 'dashboard_update';

  constructor(jwtService: JwtService, configService: ConfigService) {
    super(jwtService, configService);
  }

  afterInit() {
    this.logger.log('Dashboard WebSocket iniciado');
  }

  @SubscribeMessage('join_empresa')
  handleJoinEmpresa(client: Socket) {
    this.unirAEmpresa(client);
  }
}
