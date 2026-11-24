import type { PrismaService } from '../prisma/prisma.service.js';

export interface UltimaLectura {
  estado_conexion: string | null;
  /** Decimal de Postgres como texto; `Number()` al usarlo. */
  potencia_actual_dbm: string | null;
  timestamp_medicion: Date;
}

/**
 * La ultima lectura ESCRITA (mayor `id_monitoreo`) de cada ONT pedida.
 *
 * Existe porque `monitoreos: { orderBy, take: 1 }` dentro de un `include` de
 * Prisma no corta en la base: trae TODAS las lecturas de esas ONT y se queda
 * con una en memoria. Con la purga apagada, en la VPS eran 1,4 M de filas
 * (24-11-2026) y la pantalla de monitoreo tardaba 15-30 s.
 *
 * Aca es un `LATERAL ... LIMIT 1` por ONT, que entra por el indice
 * (id_registro_ont, id_monitoreo DESC): cuesta lo mismo con 1 000 filas que
 * con millones.
 */
export async function ultimasLecturas(
  prisma: PrismaService,
  ids: number[],
): Promise<Map<number, UltimaLectura>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();

  const filas = await prisma.$queryRaw<({ id_registro_ont: number } & UltimaLectura)[]>`
    SELECT r.id AS id_registro_ont, u.estado_conexion,
           u.potencia_actual_dbm::text AS potencia_actual_dbm, u.timestamp_medicion
      FROM unnest(${unicos}::int[]) AS r(id)
      JOIN LATERAL (
        SELECT m.estado_conexion, m.potencia_actual_dbm, m.timestamp_medicion
          FROM monitoreo_ont m
         WHERE m.id_registro_ont = r.id
         ORDER BY m.id_monitoreo DESC
         LIMIT 1
      ) u ON true
  `;
  return new Map(
    filas.map((f) => [
      f.id_registro_ont,
      {
        estado_conexion: f.estado_conexion,
        potencia_actual_dbm: f.potencia_actual_dbm,
        timestamp_medicion: f.timestamp_medicion,
      },
    ]),
  );
}

/**
 * Agrega a cada registro `monitoreos: [ultima]` (o `[]`), la misma forma que
 * tenia el `include` anidado, para no tocar a quien lo consume.
 */
export async function conUltimaLectura<T extends { id_registro_ont: number }>(
  prisma: PrismaService,
  registros: T[],
): Promise<(T & { monitoreos: UltimaLectura[] })[]> {
  const ultimas = await ultimasLecturas(prisma, registros.map((r) => r.id_registro_ont));
  return registros.map((r) => {
    const u = ultimas.get(r.id_registro_ont);
    return { ...r, monitoreos: u ? [u] : [] };
  });
}
