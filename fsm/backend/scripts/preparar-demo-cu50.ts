/**
 * Deja listas las dos OT de planta externa del paso 7 de la demo (CU-50).
 *
 *   npx tsx scripts/preparar-demo-cu50.ts
 *
 * Correrlo poco antes de grabar: las fechas se calculan desde "ahora".
 *
 * - OT A, en NAP 9: intervencion en unas 36 h. El aviso sale 24 h antes, o sea
 *   dentro de las proximas 24 h, que es lo que hace aparecer el recordatorio
 *   en el dashboard (`AvisosMantencionService.proximos`).
 * - OT B, en NAP 10: manana temprano, a menos de 24 h. Programarla da la
 *   excepcion 1 del CU.
 *
 * Volver a correrlo reprograma las mismas dos OT (las encuentra por la marca
 * en `observaciones`), las devuelve a ASIGNADA y borra sus avisos y las
 * lineas que estos dejaron en el historial, asi la toma se puede repetir. Los clientes de demo quedan en puertos de cada caja,
 * porque el aviso llega a los clientes de los puertos ocupados.
 */
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const ID_EMPRESA = 1; // FiNet
const ID_TECNICO = 36; // Tecnico demo G3
const ID_CATEGORIA_PLANTA_EXTERNA = 4; // Falla de planta externa
const ZONA = 'America/Santiago';
const HORA = 3_600_000;

const OTS = [
  {
    marca: 'DEMO CU-50 A',
    caja: 'NAP 9',
    clientes: [15, 16, 17, 18, 19],
    texto:
      'Mantención programada de planta externa: cambio de splitter en la caja NAP 9.',
  },
  {
    marca: 'DEMO CU-50 B',
    caja: 'NAP 10',
    clientes: [23, 22],
    texto:
      'Mantención de planta externa mañana temprano: reordenar acometidas en la caja NAP 10.',
  },
];

/** La fecha `dias` despues de hoy (hora de Chile) a las `hora`:00 de Chile. */
function diaALas(ahora: Date, dias: number, hora: number) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(ahora)
      .map((p) => [p.type, p.value]),
  );
  // Se parte de la hora como si fuera UTC y se corrige por el desfase de Chile.
  const ingenua = Date.UTC(
    Number(partes.year),
    Number(partes.month) - 1,
    Number(partes.day) + dias,
    hora,
  );
  const horaChile = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONA,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ingenua)),
  );
  return new Date(ingenua + ((hora - horaChile + 24) % 24) * HORA);
}

const redondearHora = (d: Date) =>
  new Date(Math.ceil(d.getTime() / HORA) * HORA);

async function main() {
  const ahora = new Date();
  const fechaA = redondearHora(new Date(ahora.getTime() + 36 * HORA));
  let fechaB = diaALas(ahora, 1, 8);
  const faltanB = (fechaB.getTime() - ahora.getTime()) / HORA;
  if (faltanB < 2 || faltanB >= 23)
    fechaB = redondearHora(new Date(ahora.getTime() + 12 * HORA));
  const fechas = [fechaA, fechaB];

  const usadas: number[] = [];
  for (const [i, def] of OTS.entries()) {
    const caja = await prisma.caja_nap.findUnique({
      where: { identificador_unico: def.caja },
    });
    if (!caja || caja.id_empresa !== ID_EMPRESA)
      throw new Error(`No existe la caja ${def.caja} de FiNet`);

    // Clientes en la caja: los que falten van al primer puerto libre.
    for (const id_cliente of def.clientes) {
      const yaEsta = await prisma.puerto_nap.findFirst({
        where: {
          id_caja_nap: caja.id_caja_nap,
          id_cliente_asociado: id_cliente,
        },
      });
      if (yaEsta) continue;
      const libre = await prisma.puerto_nap.findFirst({
        where: { id_caja_nap: caja.id_caja_nap, estado: 'LIBRE' },
        orderBy: { numero_puerto: 'asc' },
      });
      if (!libre)
        throw new Error(`La caja ${def.caja} no tiene puertos libres`);
      await prisma.puerto_nap.update({
        where: { id_puerto: libre.id_puerto },
        data: { estado: 'OCUPADO', id_cliente_asociado: id_cliente },
      });
    }

    const datos = {
      id_empresa: ID_EMPRESA,
      id_caja_nap: caja.id_caja_nap,
      id_tecnico: ID_TECNICO,
      id_categoria_falla: ID_CATEGORIA_PLANTA_EXTERNA,
      tipo_ot: 'PREVENTIVO',
      prioridad: 'ALTA',
      estado: 'ASIGNADA',
      fecha_programada: fechas[i],
      observaciones: `${def.texto}\n\n[${def.marca}]`,
    };
    const existente = await prisma.orden_trabajo.findFirst({
      where: {
        id_empresa: ID_EMPRESA,
        observaciones: { contains: `[${def.marca}]` },
      },
    });
    let id_ot: number;
    if (existente) {
      id_ot = existente.id_ot;
      await prisma.$transaction([
        prisma.log_notificacion.deleteMany({ where: { id_ot } }),
        prisma.historial_ot.deleteMany({
          where: {
            id_ot,
            observaciones: { startsWith: 'Aviso de mantención' },
          },
        }),
        prisma.orden_trabajo.update({ where: { id_ot }, data: datos }),
      ]);
    } else {
      const creada = await prisma.orden_trabajo.create({ data: datos });
      id_ot = creada.id_ot;
      await prisma.historial_ot.createMany({
        data: [
          {
            id_ot,
            id_usuario: 1,
            estado_anterior: null,
            estado_nuevo: 'PENDIENTE',
          },
          {
            id_ot,
            id_usuario: 1,
            estado_anterior: 'PENDIENTE',
            estado_nuevo: 'ASIGNADA',
          },
        ],
      });
    }
    usadas.push(id_ot);
  }

  const fmt = (d: Date) =>
    d.toLocaleString('es-CL', {
      timeZone: ZONA,
      dateStyle: 'full',
      timeStyle: 'short',
    });
  console.log(
    `OT #${usadas[0]} (NAP 9, 5 clientes): intervención ${fmt(fechaA)}; el aviso sale ${fmt(new Date(fechaA.getTime() - 24 * HORA))}`,
  );
  console.log(
    `OT #${usadas[1]} (NAP 10, mañana temprano): intervención ${fmt(fechaB)}; a menos de 24 h, se rechaza`,
  );
  console.log(
    'Válido para grabar hasta',
    fmt(new Date(Math.min(fechaA.getTime() - 24 * HORA, fechaB.getTime()))),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
