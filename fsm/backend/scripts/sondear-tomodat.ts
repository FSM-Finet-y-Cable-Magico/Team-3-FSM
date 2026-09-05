/**
 * Sondeo de la API de Tomodat. SOLO LECTURA.
 *
 * Responde una pregunta concreta: las 166 cajas que el KML exporta como "nap"
 * sin número, ¿tienen nombre de verdad en la base de Tomodat?
 *
 *   - Si lo tienen, el problema es del exportador de KML y lo resolvemos solos.
 *   - Si Tomodat también dice "nap", el dato no existe y el pedido a Tomodat
 *     del punto 3.1 del PENDIENTES sigue en pie.
 *
 * ── Dos trampas que costaron una conclusión falsa la primera vez ──────────
 *
 * 1. En un mismo poste conviven una mufa y una caja NAP a menos de 10 m. Si se
 *    empareja por cercanía sin mirar el tipo, la mufa "gana" y uno concluye que
 *    la caja sin número en realidad se llamaba "MUFA Z1-GPON". Por eso acá solo
 *    se comparan CTO contra CTO (`access_point_type_id === 3`).
 *
 * 2. Emparejar cada punto de Tomodat con NUESTRA caja más cercana permite que
 *    tres puntos distintos reclamen la misma caja. El emparejamiento es 1 a 1:
 *    se ordenan todos los pares candidatos por distancia y se van tomando de
 *    menor a mayor, descartando los que usen un extremo ya tomado.
 *
 * No escribe nada, ni en Tomodat ni en nuestra base.
 *
 *   npx tsx scripts/sondear-tomodat.ts
 */
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  TomodatClient,
  ErrorTomodat,
  coordenadaDe,
  type PuntoAccesoTomodat,
} from '../src/planta-externa/tomodat.client.js';

/** Centros de los grupos donde se concentran las cajas sin número. */
const ZONAS = [
  { nombre: 'zona A', lat: -33.592443, lng: -70.622449, sin_numero: 48 },
  { nombre: 'zona B', lat: -33.549939, lng: -70.626761, sin_numero: 38 },
  { nombre: 'zona C', lat: -33.579152, lng: -70.607197, sin_numero: 37 },
  { nombre: 'zona D', lat: -33.592752, lng: -70.626245, sin_numero: 20 },
];
const RADIO_M = 1500;
/** Más lejos que esto, no es la misma caja física. */
const TOLERANCIA_M = 20;
/** `access_point_type` 3 = CTO. Es lo que nosotros llamamos caja NAP. */
const TIPO_CTO = 3;

/** Nuestro nombre provisorio para una caja que el KML trajo sin número. */
const SIN_NUMERO = /^nap\s*\(\d+\)$/i;
/** Un nombre de Tomodat que tampoco identifica nada. */
const INUTIL = /^(nap|cto|caja)\s*(\(\d+\))?$/i;

function metros(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const m = (((aLat + bLat) / 2) * Math.PI) / 180;
  const x = dLng * Math.cos(m);
  return Math.round(R * Math.sqrt(dLat * dLat + x * x));
}

async function main() {
  const token = process.env.TOMODAT_API_TOKEN;
  if (!token) {
    console.error('Falta TOMODAT_API_TOKEN en fsm/backend/.env');
    process.exit(1);
  }

  const tomodat = new TomodatClient(token);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  const nuestras = (
    await prisma.caja_nap.findMany({
      where: { latitud: { not: null }, longitud: { not: null } },
      select: { id_caja_nap: true, identificador_unico: true, latitud: true, longitud: true },
    })
  ).map((c) => ({
    id: c.id_caja_nap,
    nombre: c.identificador_unico ?? '',
    lat: Number(c.latitud),
    lng: Number(c.longitud),
  }));

  const nuestrasSinNumero = nuestras.filter((c) => SIN_NUMERO.test(c.nombre)).length;
  console.log(`Nuestras cajas georreferenciadas : ${nuestras.length}`);
  console.log(`De esas, sin numero              : ${nuestrasSinNumero}\n`);

  // 1) Traer los puntos de las cuatro zonas, sin repetir por id.
  const porId = new Map<number, PuntoAccesoTomodat>();
  for (const z of ZONAS) {
    process.stdout.write(`${z.nombre} ... `);
    const puntos = await tomodat.puntosAccesoEnRadio(z.lat, z.lng, RADIO_M);
    for (const p of puntos) porId.set(p.id, p);
    console.log(`${puntos.length} puntos`);
  }
  const todos = [...porId.values()];
  const ctos = todos.filter((p) => p.access_point_type_id === TIPO_CTO);

  console.log(`\nPuntos de acceso distintos       : ${todos.length}`);
  console.log(`De esos, CTO (= caja NAP)        : ${ctos.length}`);

  // 2) LA PREGUNTA DE FONDO, que no necesita emparejar nada:
  //    ¿cuantas CTO no tienen nombre util EN LA PROPIA API?
  const ctoSinNombre = ctos.filter((p) => INUTIL.test((p.name ?? '').trim()));
  console.log(
    `De esas CTO, sin nombre util EN TOMODAT: ${ctoSinNombre.length}` +
      ` (${((100 * ctoSinNombre.length) / (ctos.length || 1)).toFixed(0)}%)`,
  );

  // 3) Emparejamiento 1 a 1, CTO contra caja nuestra, por distancia.
  const pares: { p: PuntoAccesoTomodat; c: (typeof nuestras)[0]; d: number }[] = [];
  for (const p of ctos) {
    const co = coordenadaDe(p);
    if (!co) continue;
    for (const c of nuestras) {
      const d = metros(co.lat, co.lng, c.lat, c.lng);
      if (d <= TOLERANCIA_M) pares.push({ p, c, d });
    }
  }
  pares.sort((a, b) => a.d - b.d);

  const usadosT = new Set<number>();
  const usadosN = new Set<number>();
  const emparejados: typeof pares = [];
  for (const par of pares) {
    if (usadosT.has(par.p.id) || usadosN.has(par.c.id)) continue;
    usadosT.add(par.p.id);
    usadosN.add(par.c.id);
    emparejados.push(par);
  }

  const deSinNumero = emparejados.filter((e) => SIN_NUMERO.test(e.c.nombre));
  const rescatables = deSinNumero.filter((e) => !INUTIL.test((e.p.name ?? '').trim()));

  console.log('\n' + '='.repeat(66));
  console.log('RESULTADO');
  console.log('='.repeat(66));
  console.log(`Emparejadas 1 a 1 (CTO vs caja nuestra, <=${TOLERANCIA_M}m): ${emparejados.length}`);
  console.log(`De esas, nuestras que estaban sin numero           : ${deSinNumero.length}`);
  console.log(`De esas, con nombre util del lado de Tomodat       : ${rescatables.length}`);

  if (rescatables.length) {
    console.log('\nNombres que la API tiene y el KML no:');
    for (const e of rescatables.slice(0, 25)) {
      console.log(`  ${e.c.nombre.padEnd(12)} -> "${(e.p.name ?? '').trim()}"  (${e.d}m, ap ${e.p.id})`);
    }
  }

  const sinRescate = deSinNumero.length - rescatables.length;
  console.log(
    `\nSin numero en los DOS lados                       : ${sinRescate}` +
      ` (${((100 * sinRescate) / (deSinNumero.length || 1)).toFixed(0)}% de las emparejadas)`,
  );

  // 4) De yapa: el tipo de equipo, que hoy nuestro parser adivina del nombre.
  const porTipo = new Map<string, number>();
  for (const p of todos) {
    const k = `${p.access_point_type_id} ${p.access_point_type?.name ?? '?'}`;
    porTipo.set(k, (porTipo.get(k) ?? 0) + 1);
  }
  console.log('\nTipos de equipo que declara la API (el KML no los trae):');
  for (const [k, n] of [...porTipo].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  if (e instanceof ErrorTomodat) console.error('\n' + e.message);
  else console.error(e);
  process.exit(1);
});
