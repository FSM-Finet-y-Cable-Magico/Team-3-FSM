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

/** Lo que se publica cuando entra una lectura nueva de la red. */
export interface ActualizacionMonitoreo {
  tipo: 'LECTURAS_INGESTADAS' | 'ALERTAS_EVALUADAS';
  /** Cuántas ONT trajo la corrida. */
  leidas?: number;
  /** Transiciones de estado detectadas en esa corrida. */
  cambios_estado?: number;
  /** Alertas abiertas al terminar de evaluar. */
  alertas_abiertas?: number;
  medido_en: string;
}

/**
 * Panel de monitoreo en vivo (CU-12 / RF-10).
 *
 * RF-10 pide que la potencia de cada ONT se vea "sin necesidad de refrescar la
 * página". Va por WebSocket y no por sondeo desde el navegador por una razon
 * concreta: **SmartOLT permite 15 llamadas por hora** en el endpoint que usamos,
 * y ese cupo lo comparte toda la cuenta. Si cada pestaña abierta preguntara por
 * su cuenta, tres jefes técnicos con el panel abierto agotarían el cupo en
 * minutos y dejarían al resto sin datos.
 *
 * El ingestor consulta SmartOLT una vez y publica el resultado a todos. El
 * navegador no le pregunta a nadie: escucha.
 *
 * Namespace propio, separado del dashboard: son dos canales con cadencias muy
 * distintas --el dashboard cambia cuando alguien toca una OT, esto cambia cuando
 * corre el poller-- y mezclarlos obligaría a cada cliente a filtrar eventos que
 * no le interesan.
 */
@WebSocketGateway({ cors: { origin: process.env.FRONTEND_URL }, namespace: '/monitoreo' })
export class MonitoreoGateway extends GatewayAutenticado implements OnGatewayInit {
  @WebSocketServer() server: Server;

  protected readonly logger = new Logger(MonitoreoGateway.name);
  protected readonly evento = 'monitoreo_update';

  constructor(jwtService: JwtService, configService: ConfigService) {
    super(jwtService, configService);
  }

  afterInit() {
    this.logger.log('Monitoreo WebSocket iniciado');
  }

  @SubscribeMessage('join_empresa')
  handleJoinEmpresa(client: Socket) {
    this.unirAEmpresa(client);
  }

  /** Azúcar sobre `emitirActualizacion`, para que los llamadores no armen el sobre. */
  publicar(id_empresa: number, datos: Omit<ActualizacionMonitoreo, 'medido_en'>) {
    this.emitirActualizacion(id_empresa, {
      ...datos,
      medido_en: new Date().toISOString(),
    } satisfies ActualizacionMonitoreo);
  }
}
