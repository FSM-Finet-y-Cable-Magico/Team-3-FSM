import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Este chequeo va ANTES del fail-closed de abajo, y el orden no es
    // cosmetico: un endpoint @Public() no lleva @Roles, asi que si el
    // fail-closed corriera primero denegaria POST /auth/login y nadie
    // podria entrar al sistema.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    // Fail-closed: sin metadatos de @Roles se deniega. Olvidar el decorador
    // debe romper el endpoint de forma ruidosa, no dejarlo abierto a
    // cualquier autenticado.
    if (!requiredRoles) {
      throw new ForbiddenException('No tienes permisos para esta acción');
    }

    const { user } = context.switchToHttp().getRequest();
    // Si esto se dispara con un endpoint no publico, lo mas probable es que
    // JwtAuthGuard no haya corrido antes: el orden de los APP_GUARD en
    // app.module.ts importa, y este guard depende de que aquel haya poblado
    // request.user.
    if (!user || !user.rol) {
      throw new ForbiddenException('No tienes permisos para esta acción');
    }

    const hasRole = requiredRoles.includes(user.rol);
    if (!hasRole) {
      throw new ForbiddenException('No tienes permisos para esta acción');
    }

    return true;
  }
}
