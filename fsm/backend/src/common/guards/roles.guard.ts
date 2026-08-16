import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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
