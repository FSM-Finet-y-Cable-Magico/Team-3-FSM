import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ApiScope {
  grupo: string;
  empresas: number[];
}

/**
 * Guard para los endpoints servidor-a-servidor de `/api/integraciones/*`.
 *
 * Estos endpoints van con `@Public()` (no hay JWT de usuario en una llamada
 * entre sistemas) y este guard encima. Valida el header `X-API-KEY` contra las
 * claves configuradas y deja en `request.apiScope` las empresas que esa clave
 * puede leer.
 *
 * Formato de `INTEGRACION_API_KEYS` (en el .env):
 *   grupo:clave:empresas   separados por ";"
 *   ej: G1:key-larga-random:1,2;G8:otra-key:1,2
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly claves = new Map<string, ApiScope>();

  constructor(config: ConfigService) {
    const raw = config.get<string>('INTEGRACION_API_KEYS') ?? '';
    for (const entrada of raw.split(';').map((s) => s.trim()).filter(Boolean)) {
      const [grupo, clave, empresas] = entrada.split(':');
      if (!grupo || !clave) continue;
      this.claves.set(clave, {
        grupo,
        empresas: (empresas ?? '')
          .split(',')
          .map((n) => parseInt(n.trim(), 10))
          .filter((n) => Number.isFinite(n)),
      });
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const clave = req.headers['x-api-key'];
    if (typeof clave !== 'string' || !clave) {
      throw new UnauthorizedException('Falta el header X-API-KEY');
    }
    const scope = this.claves.get(clave);
    if (!scope) {
      throw new UnauthorizedException('X-API-KEY inválida');
    }
    req.apiScope = scope;
    return true;
  }
}
