/**
 * Datos de demo del panel de cortes. SOLO RAILWAY: la VPS es la base real.
 *
 *   npx tsx scripts/demo-cortes.ts            suspende 3 contratos activos de la empresa 1
 *   npx tsx scripts/demo-cortes.ts --revertir los devuelve como estaban
 *
 * Lo que toco queda en `log_auditoria` (accion DEMO_CORTES_SUSPENDER), y de ahi
 * lo lee `--revertir`: no hace falta guardar ningun archivo.
 */
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { diaEnZona } from '../src/cortes/cortes.js';

const ACCION = 'DEMO_CORTES_SUSPENDER';
const url = process.env.DATABASE_URL ?? '';
if (!/rlwy\.net|railway/i.test(url)) {
  console.error('Este script solo corre contra la base de Railway. DATABASE_URL apunta a otra parte.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function suspender() {
  const activos = (await prisma.contrato.findMany({
    where: { id_empresa: 1, id_cliente: { not: null } },
    select: { id_contrato: true, estado: true, fecha_suspension: true },
    orderBy: { id_contrato: 'asc' },
  })).filter((c) => c.estado.trim().toLowerCase() === 'activo').slice(0, 3);
  if (activos.length === 0) {
    console.log('No hay contratos activos con cliente en la empresa 1.');
    return;
  }
  // El dia de hoy en Chile, no en UTC: de noche UTC ya es manana.
  const hoy = new Date(diaEnZona(new Date()));
  for (const c of activos) {
    await prisma.contrato.update({ where: { id_contrato: c.id_contrato }, data: { estado: 'Suspendido', fecha_suspension: hoy } });
  }
  await prisma.log_auditoria.create({
    data: {
      accion: ACCION,
      entidad_afectada: 'contrato',
      valor_anterior: activos.map((c) => ({ id_contrato: c.id_contrato, estado: c.estado, fecha_suspension: c.fecha_suspension })),
    },
  });
  console.log(`Suspendidos para la demo: ${activos.map((c) => c.id_contrato).join(', ')}`);
}

async function revertir() {
  const ultimo = await prisma.log_auditoria.findFirst({ where: { accion: ACCION }, orderBy: { fecha_hora: 'desc' } });
  const previos = (ultimo?.valor_anterior ?? []) as { id_contrato: number; estado: string; fecha_suspension: string | null }[];
  if (previos.length === 0) {
    console.log('No hay nada que revertir.');
    return;
  }
  for (const p of previos) {
    await prisma.contrato.update({
      where: { id_contrato: p.id_contrato },
      data: { estado: p.estado, fecha_suspension: p.fecha_suspension ? new Date(p.fecha_suspension) : null },
    });
  }
  await prisma.log_auditoria.delete({ where: { id_log: ultimo!.id_log } });
  console.log(`Revertidos: ${previos.map((p) => p.id_contrato).join(', ')}`);
}

(process.argv.includes('--revertir') ? revertir() : suspender())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
