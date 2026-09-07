/**
 * Contrasta el TIPO de equipo que dedujo nuestro parser de KML contra el que
 * declara Tomodat. SOLO LECTURA.
 *
 * `kml-parser.ts` adivina si un marcador es caja NAP, mufa, OLT o poste con
 * expresiones regulares sobre el nombre ("mufa", "cto", "nap", "ceo"...).
 * La API en cambio trae `access_point_type`, que sale del catálogo de equipos
 * del propio Tomodat: CTO, FK-CEO-6M-240F, FK-CEO-4T, ARMARIO1.
 *
 * Si el parser metió una mufa en `caja_nap`, esa "caja" aparece en el mapa del
 * jefe técnico como un punto al que mandar un técnico, y peor: participa del
 * cálculo de "% de una caja caída" del motor de alertas.
 *
 *   npx tsx scripts/verificar-tipos-tomodat.ts
 */
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  TomodatClient,
  coordenadaDe,
  type PuntoAccesoTomodat,
} from '../src/planta-externa/tomodat.client.js';

const ZONAS = [
  { lat: -33.592443, lng: -70.622449 },
  { lat: -33.549939, lng: -70.626761 },
  { lat: -33.579152, lng: -70.607197 },
  { lat: -33.592752, lng: -70.626245 },
];
const RADIO_M = 1500;
const TOLERANCIA_M = 20;
const TIPO_CTO = 3;

function metros(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const m = (((aLat + bLat) / 2) * Math.PI) / 180;
  const x = dLng * Math.cos(m);
  return Math.round(R * Math.sqrt(dLat * dLat + x * x));
}

async function main() {
  const tomodat = new TomodatClient(process.env.TOMODAT_API_TOKEN!);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  const porId = new Map<number, PuntoAccesoTomodat>();
  for (const z of ZONAS) {
    for (const p of await tomodat.puntosAccesoEnRadio(z.lat, z.lng, RADIO_M)) {
      porId.set(p.id, p);
    }
  }
  const noCto = [...porId.values()].filter((p) => p.access_point_type_id !== TIPO_CTO);

  const cajas = (
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

  console.log(`Puntos NO-CTO en las 4 zonas (mufas, armarios): ${noCto.length}`);
  console.log(`Nuestras caja_nap georreferenciadas           : ${cajas.length}\n`);

  // ── La parte que hay que hacer bien ────────────────────────────────────
  //
  // "Nuestra caja está a 6 m de una mufa" NO significa que sea una mufa: en
  // un mismo poste conviven las dos, y de hecho `nap (36)` tiene cuatro mufas
  // a menos de 20 m. Concluir ahí sería inventar un problema.
  //
  // Lo que delata una mufa guardada como caja es que NO tenga ningún CTO al
  // lado: si Tomodat dice que en esas coordenadas solo hay una mufa, entonces
  // lo que importamos como caja no era una caja.
  const todos = [...porId.values()];
  const malClasificadas: { caja: string; ont: number; cerca: string }[] = [];
  let conMufaVecina = 0;

  for (const c of cajas) {
    let ctosCerca = 0;
    const otrosCerca: string[] = [];
    for (const p of todos) {
      const co = coordenadaDe(p);
      if (!co) continue;
      if (metros(co.lat, co.lng, c.lat, c.lng) > TOLERANCIA_M) continue;
      if (p.access_point_type_id === TIPO_CTO) ctosCerca++;
      else otrosCerca.push(`${(p.name ?? '').trim()} [${p.access_point_type?.name ?? '?'}]`);
    }
    if (!otrosCerca.length) continue;
    conMufaVecina++;
    if (ctosCerca > 0) continue; // mufa vecina de una caja real: normal
    const ont = await prisma.registro_ont.count({ where: { id_caja_nap: c.id } });
    malClasificadas.push({ caja: c.nombre, ont, cerca: otrosCerca.join(', ') });
  }

  console.log('='.repeat(70));
  console.log(`caja_nap con algun equipo no-CTO a <=${TOLERANCIA_M}m : ${conMufaVecina}`);
  console.log('  (normal: la mufa y la caja suelen ir en el mismo poste)');
  console.log('');
  if (!malClasificadas.length) {
    console.log('caja_nap SIN ningun CTO al lado, o sea mal clasificadas: 0');
    console.log('El parser de KML no confundio mufas con cajas.');
  } else {
    console.log(`caja_nap SIN ningun CTO al lado — probables mufas: ${malClasificadas.length}`);
    console.log('(las que tienen ONT colgando ademas ensucian el motor de alertas)\n');
    malClasificadas.sort((a, b) => b.ont - a.ont);
    for (const s of malClasificadas.slice(0, 30)) {
      console.log(`  ${s.caja.padEnd(16)} ONT:${String(s.ont).padStart(3)}  -> ${s.cerca}`);
    }
    console.log(`\n  con ONT colgando: ${malClasificadas.filter((s) => s.ont > 0).length}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
