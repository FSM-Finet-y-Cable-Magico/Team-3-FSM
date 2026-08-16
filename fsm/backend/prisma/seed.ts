import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  // Se valida antes de escribir nada, para no dejar la base a medio sembrar.
  // A proposito no hay valor por defecto: sembrar tiene que ser una decision
  // explicita de quien corre el seed.
  const passwordAdmin = process.env.SEED_ADMIN_PASSWORD;
  if (!passwordAdmin) {
    throw new Error(
      'Falta la variable SEED_ADMIN_PASSWORD. Definila en fsm/backend/.env con la ' +
        'contrasena inicial del administrador antes de correr el seed (ver README). ' +
        'El seed no trae contrasena por defecto.',
    );
  }

  const finet = await prisma.empresa.upsert({
    where: { rut_empresa: '76123456-7' },
    update: {},
    create: { nombre: 'FiNet Limitada', rut_empresa: '76123456-7', esquema_db: 'finet' },
  });

  const cableMagico = await prisma.empresa.upsert({
    where: { rut_empresa: '76654321-0' },
    update: {},
    create: { nombre: 'Cable Mágico Litoral', rut_empresa: '76654321-0', esquema_db: 'cable_magico' },
  });

  for (const nombreRol of ['ADMIN', 'JEFE_TECNICO', 'TECNICO', 'COORDINADOR', 'COMERCIAL']) {
    await prisma.rol.upsert({
      where: { nombre_rol: nombreRol },
      update: {},
      create: { nombre_rol: nombreRol },
    });
  }

  const passwordHash = await bcrypt.hash(passwordAdmin, 12);

  const adminUser = await prisma.usuario.upsert({
    where: { nombre_usuario: 'admin.finet' },
    // Si el admin ya existe no se toca: reafirmar el hash pisaria la
    // contrasena que ya haya cambiado, y volver a poner es_password_temporal
    // alteraria el estado del flujo de cambio obligatorio (CU-39).
    update: {},
    create: {
      empresa: { connect: { id_empresa: finet.id_empresa } },
      nombre_completo: 'Administrador FSM',
      nombre_usuario: 'admin.finet',
      email: 'admin@finet.cl',
      password_hash: passwordHash,
      activo: true,
      // El primer ingreso obliga a cambiarla (CU-39).
      es_password_temporal: true,
    },
  });

  const rolAdmin = await prisma.rol.findUnique({ where: { nombre_rol: 'ADMIN' } });
  if (rolAdmin) {
    const existe = await prisma.usuario_rol.findFirst({
      where: { usuario: { id_usuario: adminUser.id_usuario }, rol: { id_rol: rolAdmin.id_rol } },
    });
    if (!existe) {
      await prisma.usuario_rol.create({
        data: {
          usuario: { connect: { id_usuario: adminUser.id_usuario } },
          rol: { connect: { id_rol: rolAdmin.id_rol } },
        },
      });
    }
  }

  const categorias = [
    { nombre: 'Sintonización de TV', sla_horas: 4 },
    { nombre: 'Internet lento', sla_horas: 4 },
    { nombre: 'Colector defectuoso', sla_horas: 8 },
    { nombre: 'Falla de planta externa', sla_horas: 2 },
    { nombre: 'IPTV pirata', sla_horas: 24 },
    { nombre: 'Cliente ausente', sla_horas: 48 },
    { nombre: 'Otro', sla_horas: 8 },
  ];
  for (const cat of categorias) {
    const existe = await prisma.categoria_falla.findFirst({ where: { nombre: cat.nombre } });
    if (!existe) await prisma.categoria_falla.create({ data: cat });
  }

  const planes = [
    { nombre_comercial: 'Plan 100 Mbps', velocidad_mbps: 100, precio_mensual: 19990, tipo_plan: 'FIBRA', tipo_cliente: 'RESIDENCIAL' },
    { nombre_comercial: 'Plan 200 Mbps', velocidad_mbps: 200, precio_mensual: 24990, tipo_plan: 'FIBRA', tipo_cliente: 'RESIDENCIAL' },
    { nombre_comercial: 'Plan 400 Mbps', velocidad_mbps: 400, precio_mensual: 34990, tipo_plan: 'FIBRA', tipo_cliente: 'RESIDENCIAL' },
  ];
  for (const plan of planes) {
    const existe = await prisma.plan.findFirst({
      where: { nombre_comercial: plan.nombre_comercial, empresa: { id_empresa: finet.id_empresa } },
    });
    if (!existe) await prisma.plan.create({
      data: { ...plan, empresa: { connect: { id_empresa: finet.id_empresa } } },
    });
  }

  console.log('Seed completado');
  console.log('FiNet id=' + finet.id_empresa + ' | Cable Magico id=' + cableMagico.id_empresa);
  console.log('Admin: admin.finet (contrasena: la de SEED_ADMIN_PASSWORD)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
