/**
 * Siembra MINIMA para la base compartida `finet_global_validacion`.
 *
 * El seed normal (`prisma/seed.ts`) no sirve contra esa base: hace upsert en
 * `empresa`, `rol` y `plan`, donde `g3_app` solo tiene SELECT, y el arranque
 * se corta ahi. Este script crea unicamente lo que es del FSM y para lo que
 * tenemos permiso:
 *
 *   - el administrador del FSM
 *   - un jefe tecnico y dos tecnicos de prueba, para poder asignar y cerrar OT
 *   - las 7 categorias de falla (RF)
 *   - las 4 plantillas de notificacion (RF-43)
 *
 * NO TOCA `empresa`, `rol` ni `plan`. Esas las administra el dueno de la base.
 *
 * Se corre A MANO, una sola vez al cambiar de base. No va en el arranque del
 * contenedor: contra la base global el arranque lleva MIGRAR_AL_ARRANCAR=false
 * justamente para no escribir nada sin que alguien lo decida.
 *
 *   cd fsm/backend
 *   DATABASE_URL='...' SEED_ADMIN_PASSWORD='...' SEED_PRUEBA_PASSWORD='...' \
 *     npx tsx prisma/seed-global.ts
 *
 * Es idempotente: correrlo de nuevo no duplica ni pisa nada.
 */
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { nombresEnBase, ROL, type CodigoRol } from '../src/auth/roles.constants.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/** Los usuarios que se crean. Las contrasenas vienen del entorno. */
const USUARIOS: {
  nombre_usuario: string;
  nombre_completo: string;
  email: string;
  rol: CodigoRol;
  clave: 'admin' | 'prueba';
  /** Si el primer ingreso obliga a cambiarla (CU-39). */
  temporal: boolean;
}[] = [
  {
    nombre_usuario: 'admin.finet',
    nombre_completo: 'Administrador FSM',
    email: 'admin@finet.cl',
    rol: ROL.ADMIN,
    clave: 'admin',
    temporal: true,
  },
  {
    nombre_usuario: 'jefe.prueba',
    nombre_completo: 'Jefe Tecnico de Prueba',
    email: 'jefe.prueba@finet.cl',
    rol: ROL.JEFE_TECNICO,
    clave: 'prueba',
    // Las cuentas de prueba NO fuerzan cambio de clave: el flujo de CU-39
    // bloquea todo hasta cambiarla, y eso frena las pruebas automatizadas
    // que G1 y G8 corren contra este entorno.
    temporal: false,
  },
  {
    nombre_usuario: 'tecnico.prueba1',
    nombre_completo: 'Tecnico de Prueba Uno',
    email: 'tecnico.prueba1@finet.cl',
    rol: ROL.TECNICO,
    clave: 'prueba',
    temporal: false,
  },
  {
    nombre_usuario: 'tecnico.prueba2',
    nombre_completo: 'Tecnico de Prueba Dos',
    email: 'tecnico.prueba2@finet.cl',
    rol: ROL.TECNICO,
    clave: 'prueba',
    temporal: false,
  },
];

const CATEGORIAS = [
  { nombre: 'Sintonización de TV', sla_horas: 4 },
  { nombre: 'Internet lento', sla_horas: 4 },
  { nombre: 'Colector defectuoso', sla_horas: 8 },
  { nombre: 'Falla de planta externa', sla_horas: 2 },
  { nombre: 'IPTV pirata', sla_horas: 24 },
  { nombre: 'Cliente ausente', sla_horas: 48 },
  { nombre: 'Otro', sla_horas: 8 },
];

// Identicas a las de seed.ts. Van con `id_empresa` en null: son del sistema.
const PLANTILLAS = [
  {
    tipo_evento: 'CORTE_MASIVO_CAJA_NAP',
    canal: 'SMS',
    contenido_texto:
      'Hola {{cliente}}: detectamos una falla que afecta el servicio en {{zona}}. ' +
      'Estimamos restablecerlo en {{tiempo_estimado}}. {{empresa}}',
    tiempo_estimado_reparacion: '4 a 6 horas',
  },
  {
    tipo_evento: 'CORTE_IMPREVISTO',
    canal: 'SMS',
    contenido_texto:
      'Hola {{cliente}}: un daño en la red dejó sin servicio a {{zona}}. ' +
      'Ya hay una cuadrilla en terreno. Estimamos {{tiempo_estimado}}. {{empresa}}',
    tiempo_estimado_reparacion: '6 a 12 horas',
  },
  {
    tipo_evento: 'MANTENCION_PROGRAMADA',
    canal: 'SMS',
    contenido_texto:
      'Hola {{cliente}}: el {{fecha}} haremos una mantención programada en {{zona}}. ' +
      'El servicio se interrumpirá {{tiempo_estimado}}. {{empresa}}',
    tiempo_estimado_reparacion: 'cerca de 2 horas',
  },
  {
    tipo_evento: 'FALLA_TELEVISION',
    canal: 'SMS',
    contenido_texto:
      'Hola {{cliente}}: estamos trabajando en una falla del servicio de televisión en {{zona}}. ' +
      'Estimamos {{tiempo_estimado}}. Su internet no está afectado. {{empresa}}',
    tiempo_estimado_reparacion: '3 a 5 horas',
  },
];

async function main() {
  // Se valida todo antes de escribir, para no dejar la base a medio sembrar.
  // Sin valores por defecto: sembrar es una decision explicita de quien corre.
  const passwordAdmin = process.env.SEED_ADMIN_PASSWORD;
  const passwordPrueba = process.env.SEED_PRUEBA_PASSWORD;

  if (!passwordAdmin) {
    throw new Error('Falta SEED_ADMIN_PASSWORD: la contrasena inicial de admin.finet.');
  }
  if (!passwordPrueba) {
    throw new Error(
      'Falta SEED_PRUEBA_PASSWORD: la contrasena de las tres cuentas de prueba ' +
        '(jefe.prueba, tecnico.prueba1, tecnico.prueba2). Distinta de la del admin.',
    );
  }
  if (passwordAdmin === passwordPrueba) {
    throw new Error(
      'SEED_ADMIN_PASSWORD y SEED_PRUEBA_PASSWORD no pueden ser iguales: las cuentas ' +
        'de prueba las conoce todo el equipo y la del administrador no deberia.',
    );
  }

  // La empresa NO se crea: solo se busca. Si no existe, el dueno de la base
  // tiene que cargarla primero.
  const empresa = await prisma.empresa.findFirst({ orderBy: { id_empresa: 'asc' } });
  if (!empresa) {
    throw new Error(
      'No hay ninguna empresa en la base. Este script no las crea --no tenemos ' +
        'permiso de escritura en `empresa`--. Pedirle al administrador que la cargue.',
    );
  }
  console.log(`Empresa: ${empresa.id_empresa} (${empresa.nombre ?? 'sin nombre'})`);

  const hashes = {
    admin: await bcrypt.hash(passwordAdmin, 12),
    prueba: await bcrypt.hash(passwordPrueba, 12),
  };

  for (const u of USUARIOS) {
    // El rol se busca por todos sus nombres posibles: la base compartida los
    // nombra distinto que la nuestra (ver src/auth/roles.constants.ts).
    let rol = await prisma.rol.findFirst({
      where: { nombre_rol: { in: nombresEnBase(u.rol) } },
    });

    // JEFE_TECNICO no tiene equivalente confirmado en la base compartida: el
    // candidato es `Soporte` y el administrador todavia no lo confirma, asi
    // que no esta mapeado. Sin rol el usuario no podria hacer nada, y lo que
    // se necesita de el --aprobar cierres-- lo puede un administrador: los
    // decoradores son `@Roles('ADMIN', 'JEFE_TECNICO')`. Se crea como
    // administrador y se avisa, en vez de crear una cuenta inutil.
    let degradado = false;
    if (!rol && u.rol === ROL.JEFE_TECNICO) {
      rol = await prisma.rol.findFirst({ where: { nombre_rol: { in: nombresEnBase(ROL.ADMIN) } } });
      degradado = true;
    }

    if (!rol) {
      console.warn(`  ! ${u.nombre_usuario}: no existe el rol ${u.rol}. Se omite.`);
      continue;
    }

    const usuario = await prisma.usuario.upsert({
      where: { nombre_usuario: u.nombre_usuario },
      // Si ya existe no se toca: reafirmar el hash pisaria una contrasena que
      // alguien ya cambio, y volver a poner es_password_temporal alteraria el
      // flujo de cambio obligatorio (CU-39).
      update: {},
      create: {
        empresa: { connect: { id_empresa: empresa.id_empresa } },
        nombre_completo: u.nombre_completo,
        nombre_usuario: u.nombre_usuario,
        email: u.email,
        password_hash: hashes[u.clave],
        activo: true,
        es_password_temporal: u.temporal,
      },
    });

    const yaTiene = await prisma.usuario_rol.findFirst({
      where: { id_usuario: usuario.id_usuario, id_rol: rol.id_rol },
    });
    if (!yaTiene) {
      await prisma.usuario_rol.create({
        data: {
          usuario: { connect: { id_usuario: usuario.id_usuario } },
          rol: { connect: { id_rol: rol.id_rol } },
        },
      });
    }

    const aviso = degradado
      ? `  (como ${rol.nombre_rol}: JEFE_TECNICO no existe en esta base todavia)`
      : '';
    console.log(`Usuario: ${u.nombre_usuario} -> ${rol.nombre_rol}${aviso}`);
  }

  let nuevasCategorias = 0;
  for (const cat of CATEGORIAS) {
    const existe = await prisma.categoria_falla.findFirst({ where: { nombre: cat.nombre } });
    if (!existe) {
      await prisma.categoria_falla.create({ data: cat });
      nuevasCategorias++;
    }
  }
  console.log(`Categorias de falla: ${nuevasCategorias} creadas, ${CATEGORIAS.length - nuevasCategorias} ya estaban`);

  let nuevasPlantillas = 0;
  for (const pl of PLANTILLAS) {
    const existe = await prisma.plantilla_notificacion.findFirst({
      where: { tipo_evento: pl.tipo_evento, id_empresa: null },
    });
    if (!existe) {
      await prisma.plantilla_notificacion.create({ data: pl });
      nuevasPlantillas++;
    }
  }
  console.log(`Plantillas: ${nuevasPlantillas} creadas, ${PLANTILLAS.length - nuevasPlantillas} ya estaban`);

  console.log('\nListo. No se toco `empresa`, `rol` ni `plan`.');
}

main()
  .catch((e) => {
    console.error('\nFallo la siembra:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
