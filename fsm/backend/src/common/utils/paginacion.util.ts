/** Mantiene el clamp de la API y evita valores no representables por Prisma/Postgres. */
export function normalizarPaginacion(page: unknown = 1, limit: unknown = 20) {
  const entero = (valor: unknown, defecto: number) => {
    if (typeof valor !== 'number' && typeof valor !== 'string') return defecto;
    const numero = Number(valor);
    return Number.isFinite(numero) ? Math.trunc(numero) || defecto : defecto;
  };
  const limitSeguro = Math.min(100, Math.max(1, entero(limit, 20)));
  let pageSeguro = Math.max(1, entero(page, 1));
  const skip = (pageSeguro - 1) * limitSeguro;
  if (!Number.isSafeInteger(pageSeguro) || skip > 2147483647) pageSeguro = 1;
  return { page: pageSeguro, limit: limitSeguro, skip: (pageSeguro - 1) * limitSeguro };
}
