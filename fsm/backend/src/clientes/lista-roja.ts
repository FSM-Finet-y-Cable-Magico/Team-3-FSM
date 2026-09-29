import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * MOD RF-32 (semaforo de riesgo) y CU-35 (lista roja). D3 del plan: el nivel
 * vive en `lista_negra`, tabla de G3, y no en `cliente`. Cada cambio de nivel
 * es una fila nueva, asi que la tabla es a la vez el estado y su historial: el
 * nivel vigente de un cliente es el de su ultima fila.
 *
 * Funciones sueltas y no un servicio: las usan ClientesService y
 * OrdenesService (al crear la OT), y como servicio obligaria a inyectarlo en
 * todo lo que construye OrdenesService.
 */

export const NIVEL_RIESGO = { VERDE: 'VERDE', AMARILLO: 'AMARILLO', ROJO: 'ROJO' } as const;
export type NivelRiesgo = (typeof NIVEL_RIESGO)[keyof typeof NIVEL_RIESGO];
export const NIVELES_RIESGO: NivelRiesgo[] = [NIVEL_RIESGO.VERDE, NIVEL_RIESGO.AMARILLO, NIVEL_RIESGO.ROJO];

/** MOD RF-32 y CU-37: AMARILLO y ROJO exigen justificacion de 20 caracteres. */
export const MIN_JUSTIFICACION_RIESGO = 20;
export const MENSAJE_JUSTIFICACION_RIESGO =
  'Debe ingresar una descripción con al menos 20 caracteres para justificar el marcado.';

/** Textos de CU-35. */
export const mensajeVetado = (motivo: string) =>
  `CLIENTE VETADO — Motivo: ${motivo}. No es posible crear la instalación hasta regularizar la situación.`;
export const ADVERTENCIA_DIRECCION =
  'Esta dirección tiene antecedentes de clientes vetados. Verifique la identidad del solicitante antes de continuar.';
export const MENSAJE_SOLO_ADMIN = 'Solo el administrador puede anular un bloqueo por lista roja.';

/**
 * Filas de un cliente, de la mas nueva a la mas vieja. Una fila sin nivel es
 * anterior a la columna: marcaba "conflictivo", que es ROJO.
 */
export function nivelVigente(filasDesdeLaUltima: { nivel: string | null }[]): NivelRiesgo {
  if (filasDesdeLaUltima.length === 0) return NIVEL_RIESGO.VERDE;
  const n = filasDesdeLaUltima[0].nivel;
  return (NIVELES_RIESGO as string[]).includes(n ?? '') ? (n as NivelRiesgo) : NIVEL_RIESGO.ROJO;
}

/**
 * Para comparar direcciones escritas por personas distintas: sin tildes,
 * mayusculas, puntuacion ni espacios de mas. "Av. Ejemplo 1234, La Pintana" y
 * "AV EJEMPLO 1234 la pintana" son la misma.
 */
export function normalizarDireccion(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const textoDireccion = (d: { direccion_completa: string; comuna: string }) =>
  `${d.direccion_completa}, ${d.comuna}`;

/**
 * CU-35, excepcion 2: ¿la direccion es la de algun cliente que hoy esta en
 * ROJO? Dos pasos, porque un cliente que ya volvio a VERDE tiene una fila
 * nueva sin direccion y la vieja con direccion ya no vale.
 */
export async function direccionConAntecedentes(
  prisma: Pick<PrismaService, 'lista_negra'>,
  id_empresa: number,
  direccion: { direccion_completa: string; comuna: string },
  excluir_cliente?: number,
): Promise<boolean> {
  const buscada = normalizarDireccion(textoDireccion(direccion));
  const conDireccion = await prisma.lista_negra.findMany({
    where: { cliente: { id_empresa }, direccion_vetada: { not: null } },
    select: { id_vetado: true, id_cliente: true, nivel: true, direccion_vetada: true },
  });
  const candidatos = [
    ...new Set(
      conDireccion
        .filter((f) => f.id_cliente !== null && f.id_cliente !== excluir_cliente)
        .filter((f) => normalizarDireccion(f.direccion_vetada ?? '') === buscada)
        .map((f) => f.id_cliente as number),
    ),
  ];
  if (candidatos.length === 0) return false;

  const filas = await prisma.lista_negra.findMany({
    where: { id_cliente: { in: candidatos } },
    orderBy: { id_vetado: 'desc' },
    select: { id_vetado: true, id_cliente: true, nivel: true, direccion_vetada: true },
  });
  return candidatos.some(
    (id) => nivelVigente(filas.filter((f) => f.id_cliente === id)) === NIVEL_RIESGO.ROJO,
  );
}
