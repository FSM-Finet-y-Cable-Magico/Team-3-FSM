import { SetMetadata } from '@nestjs/common';

/**
 * Marca un handler (o un controller entero) como accesible sin autenticacion.
 *
 * Desde que JwtAuthGuard y RolesGuard estan registrados como APP_GUARD en
 * app.module.ts, todo endpoint nace protegido. Este decorador es la unica
 * forma de declarar una excepcion, y es deliberadamente explicita: si no
 * aparece, el endpoint exige token y rol.
 *
 * Ojo: `@Public()` quita las dos cosas, token y rol. Un endpoint que necesita
 * saber quien es el usuario pero acepta cualquier rol NO va aqui — va con un
 * `@Roles(...)` que liste los roles permitidos (ver cambiar-password en
 * auth.controller.ts).
 */
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
