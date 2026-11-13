import type { PrismaService } from '../prisma/prisma.service.js';
import { esActivo, esSuspendido } from './cortes.js';

function comoTexto(e: unknown): string {
  try {
    return `${(e as { message?: string })?.message ?? ''} ${JSON.stringify(e)}`;
  } catch {
    return String(e);
  }
}

/**
 * Postgres responde 42501 cuando el usuario no tiene permiso sobre la tabla.
 * Con el adapter de Prisma el codigo puede venir en `code`, en el mensaje o
 * metido en `meta`: se busca en todo.
 */
export function esFaltaDePermiso(e: unknown): boolean {
  return (e as { code?: string })?.code === '42501' || /42501|permission denied/i.test(comoTexto(e));
}

/**
 * Clientes de la empresa suspendidos por deuda: con algun contrato suspendido
 * y NINGUNO activo. Con un servicio activo y otro suspendido no se sabe a cual
 * corresponde la ONT, asi que se sigue monitoreando.
 *
 * Nunca lanza. El monitoreo la llama en cada lectura, y no puede caerse porque
 * `g3_app` pierda el permiso sobre `contrato`, que es de G8. Si falla, avisa y
 * devuelve un conjunto vacio: nadie queda marcado como suspendido.
 */
export async function clientesSuspendidos(
  prisma: PrismaService,
  id_empresa: number,
  logger?: { warn(m: string): void },
): Promise<Set<number>> {
  let contratos: { id_cliente: number | null; estado: string | null }[];
  try {
    contratos = await prisma.contrato.findMany({
      where: { id_empresa, id_cliente: { not: null } },
      select: { id_cliente: true, estado: true },
    });
  } catch (e) {
    logger?.warn(`No se pudo leer contrato para marcar clientes suspendidos: ${(e as Error)?.message ?? e}`);
    return new Set();
  }
  const suspendidos = new Set<number>();
  const activos = new Set<number>();
  for (const c of contratos) {
    if (c.id_cliente == null) continue;
    if (esSuspendido(c.estado)) suspendidos.add(c.id_cliente);
    else if (esActivo(c.estado)) activos.add(c.id_cliente);
  }
  return new Set([...suspendidos].filter((id) => !activos.has(id)));
}
