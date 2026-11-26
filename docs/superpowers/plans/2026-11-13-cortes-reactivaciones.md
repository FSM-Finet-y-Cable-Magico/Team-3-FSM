# Cortes y reactivaciones por morosidad — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** que el corte y la reactivación de un cliente moroso se vean en el FSM (panel, monitoreo y retiro), aunque la acción en SmartOLT la siga haciendo FiNet a mano.

**Arquitectura:** un módulo `cortes` calcula, al pedirlo, qué contratos falta cortar o reactivar cruzando `contrato` (G8, solo lectura) con nuestros registros en `log_auditoria`. Una función compartida `clientesSuspendidos` le dice al monitoreo qué clientes están suspendidos para no alertar por ellos. La OT de retiro que pide G8 pasa a llevar la caja del cliente. Sin cambios de esquema.

**Stack:** NestJS 11 + Prisma 7 (adapter-pg), Jest (ESM), SvelteKit 2 / Svelte 5 + Tailwind 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-cortes-reactivaciones-design.md`

## Restricciones globales

- Sin cambios de esquema: ni migraciones, ni tablas, ni columnas.
- Nada escribe en `contrato` ni en `cliente`. Desde G3 son solo lectura; así está en la base global.
- Acciones en `log_auditoria`: `CORTE_SMARTOLT` y `REACTIVACION_SMARTOLT`, con `entidad_afectada = 'contrato'` e `id_entidad_afectada = id_contrato`.
- Sin permiso sobre `contrato`: el panel responde 503 con `codigo: 'SIN_PERMISO_CONTRATO'`, y el monitoreo sigue funcionando sin la marca de suspendido.
- Roles del panel: `ADMIN` y `JEFE_TECNICO`. La empresa es la del token: para el ADMIN, el `JwtStrategy` ya la toma de la cabecera de empresa activa.
- Zona de operación para comparar días: `America/Santiago` (`ZONA_OPERACION`).
- Etiqueta en pantalla: **"Suspendido por deuda"**. Texto fijo del panel: *"El corte y la reactivación se hacen en SmartOLT. Este panel solo registra que se hicieron."*
- `id_log` es BigInt: se convierte a `Number` antes de responder, porque Nest no serializa BigInt.
- Los comandos del backend se corren desde `fsm/backend`; los del frontend, desde `fsm/frontend`.

## Foco de revisión

Lo que el spec implica y es más probable que falle en uso real, con la tarea que lo prueba:

1. **Estado del contrato con espacios o mayúsculas** (`'  SUSPENDIDO '`, `'activo'`): debe contar como suspendido o activo. → Tareas 1 y 2.
2. **Cliente con un contrato suspendido y otro activo:** no debe quedar marcado como suspendido en el monitoreo. → Tarea 2.
3. **Corte registrado a las 23:30 del día anterior a la suspensión, en hora de Chile** (ya es el día siguiente en UTC): debe seguir "por cortar". → Tarea 1.
4. **Dos personas registran el mismo corte:** la segunda recibe 409 y no queda un registro duplicado. → Tarea 3.
5. **Contrato sin cliente (`id_cliente` null):** se lista sin romper el panel. → Tarea 3.

---

### Tarea 1: Regla de qué falta cortar o reactivar

**Archivos:**
- Crear: `fsm/backend/src/cortes/cortes.ts`
- Prueba: `fsm/backend/src/cortes/cortes.spec.ts`

**Interfaces:**
- Produce:
  - `ACCION_CORTE = 'CORTE_SMARTOLT'`, `ACCION_REACTIVACION = 'REACTIVACION_SMARTOLT'`
  - `type EstadoCorte = 'POR_CORTAR' | 'POR_REACTIVAR' | 'AL_DIA'`
  - `esSuspendido(estado: string | null | undefined): boolean`
  - `esActivo(estado: string | null | undefined): boolean`
  - `diaEnZona(instante: Date, zona?: string): string` (formato `'AAAA-MM-DD'`)
  - `diaDeFecha(fecha: Date): string`
  - `interface ContratoParaCorte { estado: string | null; fecha_suspension: Date | null }`
  - `interface RegistroCorte { accion: string; fecha_hora: Date }`
  - `clasificarContrato(c: ContratoParaCorte, ultimo: RegistroCorte | null): EstadoCorte`

- [ ] **Paso 1: escribir la prueba (falla)**

```ts
// fsm/backend/src/cortes/cortes.spec.ts
import { describe, expect, it } from '@jest/globals';
import { ACCION_CORTE, ACCION_REACTIVACION, clasificarContrato, diaEnZona, esActivo, esSuspendido } from './cortes.js';

const SUSP = new Date('2026-11-13T00:00:00.000Z'); // DATE de Prisma: medianoche UTC
const corte = (iso: string) => ({ accion: ACCION_CORTE, fecha_hora: new Date(iso) });
const reactivacion = (iso: string) => ({ accion: ACCION_REACTIVACION, fecha_hora: new Date(iso) });

describe('estado del contrato', () => {
  it('reconoce suspendido y activo sin importar mayusculas ni espacios', () => {
    expect(esSuspendido('Suspendido')).toBe(true);
    expect(esSuspendido('  SUSPENDIDO ')).toBe(true);
    expect(esSuspendido('Activo')).toBe(false);
    expect(esActivo('activo')).toBe(true);
    expect(esActivo(' ACTIVO ')).toBe(true);
    expect(esActivo('Pendiente')).toBe(false);
    expect(esActivo(null)).toBe(false);
  });
});

describe('clasificarContrato', () => {
  it('suspendido sin registro: por cortar', () => {
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: SUSP }, null)).toBe('POR_CORTAR');
  });

  it('suspendido con un corte registrado ese mismo dia o despues: al dia', () => {
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: SUSP }, corte('2026-11-13T15:00:00Z'))).toBe('AL_DIA');
  });

  it('suspendido otra vez despues de un corte viejo: por cortar', () => {
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: SUSP }, corte('2026-10-01T15:00:00Z'))).toBe('POR_CORTAR');
  });

  it('un corte a las 23:30 de Chile del dia anterior sigue siendo anterior, aunque en UTC ya sea el dia 13', () => {
    // 2026-11-12 23:30 en Santiago (UTC-3) = 2026-11-13 02:30 UTC.
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: SUSP }, corte('2026-11-13T02:30:00Z'))).toBe('POR_CORTAR');
    expect(diaEnZona(new Date('2026-11-13T02:30:00Z'))).toBe('2026-11-12');
  });

  it('suspendido cuyo ultimo registro es una reactivacion: por cortar', () => {
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: SUSP }, reactivacion('2026-11-14T10:00:00Z'))).toBe('POR_CORTAR');
  });

  it('sin fecha de suspension, el ultimo corte cuenta como vigente', () => {
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: null }, corte('2026-01-01T10:00:00Z'))).toBe('AL_DIA');
  });

  it('activo con un corte como ultimo registro: por reactivar', () => {
    expect(clasificarContrato({ estado: 'Activo', fecha_suspension: null }, corte('2026-11-13T15:00:00Z'))).toBe('POR_REACTIVAR');
  });

  it('activo ya reactivado, o que nunca se corto: al dia', () => {
    expect(clasificarContrato({ estado: 'activo', fecha_suspension: null }, reactivacion('2026-11-14T10:00:00Z'))).toBe('AL_DIA');
    expect(clasificarContrato({ estado: 'ACTIVO', fecha_suspension: null }, null)).toBe('AL_DIA');
  });

  it('otro estado (baja, pendiente) con un corte: al dia, no se reactiva', () => {
    expect(clasificarContrato({ estado: 'Baja', fecha_suspension: null }, corte('2026-11-13T15:00:00Z'))).toBe('AL_DIA');
    expect(clasificarContrato({ estado: 'Pendiente', fecha_suspension: null }, corte('2026-11-13T15:00:00Z'))).toBe('AL_DIA');
  });
});
```

- [ ] **Paso 2: correrla y ver que falla**

Correr: `npm test -- src/cortes/cortes.spec.ts`
Esperado: FAIL, porque el módulo `./cortes.js` no existe.

- [ ] **Paso 3: implementar**

```ts
// fsm/backend/src/cortes/cortes.ts
import { ZONA_OPERACION } from '../common/utils/dia-habil.util.js';

/**
 * Cortes y reactivaciones por morosidad.
 *
 * G8 decide: marca `contrato.estado = 'Suspendido'` (con `fecha_suspension`) y
 * lo devuelve a `Activo` al reactivar. G3 ejecuta en SmartOLT, que hoy es a
 * mano: nuestro token es de solo lectura. Lo unico que guarda el FSM es que
 * alguien lo hizo, en `log_auditoria`. Ver el spec del 13-11-2026.
 */
export const ACCION_CORTE = 'CORTE_SMARTOLT';
export const ACCION_REACTIVACION = 'REACTIVACION_SMARTOLT';

export type EstadoCorte = 'POR_CORTAR' | 'POR_REACTIVAR' | 'AL_DIA';

// En la base el estado viene como 'activo', 'Activo' y 'ACTIVO'.
const normal = (estado: string | null | undefined) => (estado ?? '').trim().toLowerCase();

export const esSuspendido = (estado: string | null | undefined): boolean => normal(estado).startsWith('suspend');
export const esActivo = (estado: string | null | undefined): boolean => normal(estado) === 'activo';

/** Dia calendario de `instante` en la zona de operacion, como 'AAAA-MM-DD'. */
export function diaEnZona(instante: Date, zona: string = ZONA_OPERACION): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);
}

/** `fecha_suspension` es DATE: Prisma la entrega como medianoche UTC de ese dia. */
export const diaDeFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

export interface ContratoParaCorte {
  estado: string | null;
  fecha_suspension: Date | null;
}

export interface RegistroCorte {
  accion: string;
  fecha_hora: Date;
}

/**
 * Que le falta a un contrato, dado el ultimo CORTE/REACTIVACION registrado.
 *
 * Solo se reactiva un contrato que G8 volvio a dejar ACTIVO: uno dado de baja
 * va por el retiro, no por la reactivacion. Si G8 vuelve a suspender despues
 * de un corte viejo, cambia `fecha_suspension` y el contrato vuelve a "por
 * cortar".
 */
export function clasificarContrato(c: ContratoParaCorte, ultimo: RegistroCorte | null): EstadoCorte {
  if (esSuspendido(c.estado)) {
    if (!ultimo || ultimo.accion !== ACCION_CORTE) return 'POR_CORTAR';
    if (c.fecha_suspension && diaEnZona(ultimo.fecha_hora) < diaDeFecha(c.fecha_suspension)) return 'POR_CORTAR';
    return 'AL_DIA';
  }
  if (esActivo(c.estado) && ultimo?.accion === ACCION_CORTE) return 'POR_REACTIVAR';
  return 'AL_DIA';
}
```

- [ ] **Paso 4: correr la prueba y ver que pasa**

Correr: `npm test -- src/cortes/cortes.spec.ts`
Esperado: PASS (10 pruebas).

- [ ] **Paso 5: commit**

```bash
git add fsm/backend/src/cortes/cortes.ts fsm/backend/src/cortes/cortes.spec.ts
git commit -m "feat(cortes): regla de qué contratos falta cortar o reactivar"
```

---

### Tarea 2: Clientes suspendidos, a prueba de permisos

**Archivos:**
- Crear: `fsm/backend/src/cortes/suspendidos.ts`
- Prueba: `fsm/backend/src/cortes/suspendidos.spec.ts`

**Interfaces:**
- Consume: `esSuspendido`, `esActivo` (Tarea 1).
- Produce:
  - `esFaltaDePermiso(e: unknown): boolean`
  - `clientesSuspendidos(prisma: PrismaService, id_empresa: number, logger?: { warn(m: string): void }): Promise<Set<number>>`. Nunca lanza: si falla, devuelve un conjunto vacío y avisa en el log.

- [ ] **Paso 1: escribir la prueba (falla)**

```ts
// fsm/backend/src/cortes/suspendidos.spec.ts
import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaService } from '../prisma/prisma.service.js';
import { clientesSuspendidos, esFaltaDePermiso } from './suspendidos.js';

const prismaCon = (findMany: (a?: any) => Promise<unknown>) =>
  ({ contrato: { findMany: jest.fn(findMany) } }) as unknown as PrismaService & { contrato: { findMany: jest.Mock } };

describe('clientesSuspendidos', () => {
  it('marca al cliente con un contrato suspendido y ninguno activo', async () => {
    const prisma = prismaCon(async () => [
      { id_cliente: 1, estado: 'Suspendido' },
      { id_cliente: 2, estado: '  SUSPENDIDO ' },
      { id_cliente: 3, estado: 'Activo' },
    ]);
    expect([...(await clientesSuspendidos(prisma, 1))].sort()).toEqual([1, 2]);
    expect(prisma.contrato.findMany.mock.calls[0][0]).toMatchObject({ where: { id_empresa: 1 } });
  });

  it('no marca al cliente que ademas tiene un contrato activo: no se sabe de cual es la ONT', async () => {
    const prisma = prismaCon(async () => [
      { id_cliente: 7, estado: 'Suspendido' },
      { id_cliente: 7, estado: 'activo' },
    ]);
    expect((await clientesSuspendidos(prisma, 1)).size).toBe(0);
  });

  it('si no puede leer contrato devuelve vacio y avisa, sin lanzar', async () => {
    const prisma = prismaCon(async () => {
      throw Object.assign(new Error('permission denied for table contrato'), { code: '42501' });
    });
    const warn = jest.fn();
    expect((await clientesSuspendidos(prisma, 1, { warn })).size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('esFaltaDePermiso', () => {
  it('reconoce el 42501 de Postgres venga como venga', () => {
    expect(esFaltaDePermiso(Object.assign(new Error('x'), { code: '42501' }))).toBe(true);
    expect(esFaltaDePermiso(new Error('permission denied for table contrato'))).toBe(true);
    expect(esFaltaDePermiso({ meta: { driverAdapterError: { cause: { originalCode: '42501' } } } })).toBe(true);
    expect(esFaltaDePermiso(new Error('connection refused'))).toBe(false);
  });
});
```

- [ ] **Paso 2: correrla y ver que falla**

Correr: `npm test -- src/cortes/suspendidos.spec.ts`
Esperado: FAIL, porque el módulo no existe.

- [ ] **Paso 3: implementar**

```ts
// fsm/backend/src/cortes/suspendidos.ts
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
```

- [ ] **Paso 4: correr la prueba y ver que pasa**

Correr: `npm test -- src/cortes/suspendidos.spec.ts`
Esperado: PASS (4 pruebas).

- [ ] **Paso 5: commit**

```bash
git add fsm/backend/src/cortes/suspendidos.ts fsm/backend/src/cortes/suspendidos.spec.ts
git commit -m "feat(cortes): clientes suspendidos por deuda, sin caerse si falta el permiso"
```

---

### Tarea 3: API del panel (`GET /api/cortes`, `POST /api/cortes/:id/hecho`)

**Archivos:**
- Crear: `fsm/backend/src/cortes/dto/registrar-corte.dto.ts`, `fsm/backend/src/cortes/cortes.service.ts`, `fsm/backend/src/cortes/cortes.controller.ts`, `fsm/backend/src/cortes/cortes.module.ts`
- Modificar: `fsm/backend/src/app.module.ts` (importar `CortesModule` en `imports`, después de `AuditoriaModule`)
- Prueba: `fsm/backend/src/cortes/cortes.service.spec.ts`

**Interfaces:**
- Consume: Tarea 1 (`clasificarContrato`, `diaDeFecha`, `ACCION_*`) y Tarea 2 (`esFaltaDePermiso`).
- Produce:
  - `GET /api/cortes` responde `{ por_cortar: FilaCorte[]; por_reactivar: FilaCorte[]; historial: RegistroHistorial[] }`.
  - `FilaCorte = { id_contrato; estado_contrato; fecha_suspension: 'AAAA-MM-DD' | null; plan: string | null; cliente: { id_cliente; nombre_completo; rut; telefono } | null; direccion: { direccion_completa; comuna } | null; onts: { numero_serie; estado_conexion; odb; odb_puerto; olt_externo; board; puerto_pon }[]; ultimo_registro: { accion; fecha_hora } | null }`
  - `RegistroHistorial = { id_log: number; accion; fecha_hora; usuario: string | null; id_contrato: number; cliente: string | null; observacion: string | null }`
  - `POST /api/cortes/:id/hecho` recibe `{ accion: 'CORTE' | 'REACTIVACION'; observacion?: string }` y responde `{ id_log: number; accion; fecha_hora }`.

- [ ] **Paso 1: escribir la prueba (falla)**

```ts
// fsm/backend/src/cortes/cortes.service.spec.ts
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CortesService } from './cortes.service.js';
import { ACCION_CORTE } from './cortes.js';

const contrato = (id: number, estado: string, extra: Record<string, unknown> = {}) => ({
  id_contrato: id,
  estado,
  fecha_suspension: estado.toLowerCase().startsWith('suspend') ? new Date('2026-11-13T00:00:00Z') : null,
  id_cliente: 100 + id,
  plan: { nombre_comercial: 'FULL S' },
  cliente: { id_cliente: 100 + id, nombre_completo: `Cliente ${id}`, rut: '11111111-1', telefono: '9 1234 5678', direcciones: [{ direccion_completa: 'Calle 1', comuna: 'La Granja' }] },
  ...extra,
});

describe('CortesService', () => {
  let contratos: any[];
  let registros: any[];
  let prisma: any;
  let service: CortesService;

  beforeEach(() => {
    contratos = [];
    registros = [];
    prisma = {
      contrato: {
        findMany: jest.fn(async () => contratos),
        findFirst: jest.fn(async ({ where }: any) => contratos.find((c) => c.id_contrato === where.id_contrato && where.id_empresa === 1) ?? null),
      },
      log_auditoria: {
        findMany: jest.fn(async () => registros),
        findFirst: jest.fn(async () => registros[0] ?? null),
        create: jest.fn(async ({ data }: any) => ({ id_log: 77n, accion: data.accion, fecha_hora: new Date('2026-11-13T15:00:00Z') })),
      },
      registro_ont: { findMany: jest.fn(async () => []) },
    };
    service = new CortesService(prisma as unknown as PrismaService);
  });

  it('separa por cortar y por reactivar, solo de la empresa pedida', async () => {
    contratos = [contrato(1, 'Suspendido'), contrato(2, 'Activo'), contrato(3, 'Activo')];
    registros = [{ id_log: 5n, accion: ACCION_CORTE, fecha_hora: new Date('2026-11-01T12:00:00Z'), id_entidad_afectada: 2, valor_nuevo: { observacion: 'listo' }, usuario: { nombre_completo: 'Ana' } }];

    const r = await service.listar(1);

    expect(prisma.contrato.findMany.mock.calls[0][0].where).toEqual({ id_empresa: 1 });
    expect(r.por_cortar.map((f) => f.id_contrato)).toEqual([1]);
    expect(r.por_reactivar.map((f) => f.id_contrato)).toEqual([2]);
    expect(r.por_cortar[0]).toMatchObject({ fecha_suspension: '2026-11-13', plan: 'FULL S', direccion: { comuna: 'La Granja' } });
    expect(r.historial[0]).toMatchObject({ id_log: 5, usuario: 'Ana', id_contrato: 2, cliente: 'Cliente 2', observacion: 'listo' });
  });

  it('un contrato sin cliente se lista igual', async () => {
    contratos = [contrato(9, 'Suspendido', { id_cliente: null, cliente: null })];
    const r = await service.listar(1);
    expect(r.por_cortar[0]).toMatchObject({ id_contrato: 9, cliente: null, direccion: null, onts: [] });
  });

  it('registra un corte pendiente en log_auditoria', async () => {
    contratos = [contrato(1, 'Suspendido')];
    const r = await service.registrar(1, 1, 'CORTE', 'hecho por Daniel', 4);

    expect(prisma.log_auditoria.create.mock.calls[0][0].data).toMatchObject({
      id_usuario: 4,
      accion: 'CORTE_SMARTOLT',
      entidad_afectada: 'contrato',
      id_entidad_afectada: 1,
      valor_nuevo: { observacion: 'hecho por Daniel', estado_contrato: 'Suspendido', fecha_suspension: '2026-11-13' },
    });
    expect(r).toMatchObject({ id_log: 77, accion: 'CORTE_SMARTOLT' });
  });

  it('409 si el contrato no esta pendiente de esa accion (por ejemplo, un segundo clic)', async () => {
    contratos = [contrato(1, 'Suspendido')];
    registros = [{ accion: ACCION_CORTE, fecha_hora: new Date('2026-11-13T15:00:00Z') }];
    await expect(service.registrar(1, 1, 'CORTE', undefined, 4)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.registrar(1, 1, 'REACTIVACION', undefined, 4)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.log_auditoria.create).not.toHaveBeenCalled();
  });

  it('404 por un contrato de otra empresa', async () => {
    contratos = [contrato(1, 'Suspendido')];
    await expect(service.registrar(2, 1, 'CORTE', undefined, 4)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('503 SIN_PERMISO_CONTRATO si la base niega leer contrato', async () => {
    prisma.contrato.findMany.mockImplementation(async () => {
      throw Object.assign(new Error('permission denied for table contrato'), { code: '42501' });
    });
    const e = await service.listar(1).catch((x) => x);
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect(e.getResponse()).toMatchObject({ codigo: 'SIN_PERMISO_CONTRATO' });
  });
});
```

- [ ] **Paso 2: correrla y ver que falla**

Correr: `npm test -- src/cortes/cortes.service.spec.ts`
Esperado: FAIL, porque `./cortes.service.js` no existe.

- [ ] **Paso 3: implementar el DTO, el servicio, el controlador y el módulo**

```ts
// fsm/backend/src/cortes/dto/registrar-corte.dto.ts
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegistrarCorteDto {
  @IsIn(['CORTE', 'REACTIVACION'])
  accion!: 'CORTE' | 'REACTIVACION';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacion?: string;
}
```

```ts
// fsm/backend/src/cortes/cortes.service.ts
import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCION_CORTE, ACCION_REACTIVACION, clasificarContrato, diaDeFecha } from './cortes.js';
import { esFaltaDePermiso } from './suspendidos.js';

const ACCIONES = [ACCION_CORTE, ACCION_REACTIVACION];
const MAX_HISTORIAL = 50;

const SELECT_CONTRATO = {
  id_contrato: true,
  estado: true,
  fecha_suspension: true,
  id_cliente: true,
  plan: { select: { nombre_comercial: true } },
  cliente: {
    select: {
      id_cliente: true,
      nombre_completo: true,
      rut: true,
      telefono: true,
      direcciones: { where: { es_principal: true }, take: 1, select: { direccion_completa: true, comuna: true } },
    },
  },
} as const;

/**
 * Panel de cortes y reactivaciones. Lee `contrato` (de G8, solo lectura) y
 * registra en `log_auditoria` que alguien hizo el corte o la reactivacion en
 * SmartOLT. No escribe en SmartOLT ni en `contrato`.
 */
@Injectable()
export class CortesService {
  constructor(private prisma: PrismaService) {}

  async listar(id_empresa: number) {
    const contratos = await this.conPermiso(() =>
      this.prisma.contrato.findMany({ where: { id_empresa }, select: SELECT_CONTRATO }),
    );
    const ids = contratos.map((c) => c.id_contrato);
    // `log_auditoria` no tiene empresa: se acota por los contratos de la empresa.
    const registros = ids.length
      ? await this.prisma.log_auditoria.findMany({
          where: { entidad_afectada: 'contrato', id_entidad_afectada: { in: ids }, accion: { in: ACCIONES } },
          orderBy: [{ fecha_hora: 'desc' }, { id_log: 'desc' }],
          select: {
            id_log: true,
            accion: true,
            fecha_hora: true,
            id_entidad_afectada: true,
            valor_nuevo: true,
            usuario: { select: { nombre_completo: true } },
          },
        })
      : [];
    const ultimo = new Map<number, (typeof registros)[number]>();
    for (const r of registros) {
      if (r.id_entidad_afectada != null && !ultimo.has(r.id_entidad_afectada)) ultimo.set(r.id_entidad_afectada, r);
    }

    const idsCliente = [...new Set(contratos.map((c) => c.id_cliente).filter((x): x is number => x != null))];
    const onts = idsCliente.length
      ? await this.prisma.registro_ont.findMany({
          where: { id_empresa, id_cliente: { in: idsCliente } },
          select: {
            id_cliente: true,
            numero_serie: true,
            odb: true,
            odb_puerto: true,
            olt_externo: true,
            board: true,
            puerto_pon: true,
            monitoreos: { orderBy: { id_monitoreo: 'desc' }, take: 1, select: { estado_conexion: true } },
          },
        })
      : [];

    const fila = (c: (typeof contratos)[number]) => {
      const u = ultimo.get(c.id_contrato);
      return {
        id_contrato: c.id_contrato,
        estado_contrato: c.estado,
        fecha_suspension: c.fecha_suspension ? diaDeFecha(c.fecha_suspension) : null,
        plan: c.plan?.nombre_comercial ?? null,
        cliente: c.cliente
          ? { id_cliente: c.cliente.id_cliente, nombre_completo: c.cliente.nombre_completo, rut: c.cliente.rut, telefono: c.cliente.telefono }
          : null,
        direccion: c.cliente?.direcciones[0] ?? null,
        onts: onts
          .filter((o) => c.id_cliente != null && o.id_cliente === c.id_cliente)
          .map((o) => ({
            numero_serie: o.numero_serie,
            estado_conexion: o.monitoreos[0]?.estado_conexion ?? null,
            odb: o.odb,
            odb_puerto: o.odb_puerto,
            olt_externo: o.olt_externo,
            board: o.board,
            puerto_pon: o.puerto_pon,
          })),
        ultimo_registro: u ? { accion: u.accion, fecha_hora: u.fecha_hora } : null,
      };
    };

    const clasificados = contratos.map((c) => ({ c, estado: clasificarContrato(c, ultimo.get(c.id_contrato) ?? null) }));
    const nombre = new Map(contratos.map((c) => [c.id_contrato, c.cliente?.nombre_completo ?? null]));

    return {
      // Lo mas antiguo primero: es lo que lleva mas tiempo esperando.
      por_cortar: clasificados
        .filter((x) => x.estado === 'POR_CORTAR')
        .map((x) => fila(x.c))
        .sort((a, b) => (a.fecha_suspension ?? '9999').localeCompare(b.fecha_suspension ?? '9999')),
      por_reactivar: clasificados
        .filter((x) => x.estado === 'POR_REACTIVAR')
        .map((x) => fila(x.c))
        .sort((a, b) => +(a.ultimo_registro?.fecha_hora ?? 0) - +(b.ultimo_registro?.fecha_hora ?? 0)),
      historial: registros.slice(0, MAX_HISTORIAL).map((r) => ({
        id_log: Number(r.id_log), // BigInt: Nest no lo serializa
        accion: r.accion,
        fecha_hora: r.fecha_hora,
        usuario: r.usuario?.nombre_completo ?? null,
        id_contrato: r.id_entidad_afectada!,
        cliente: nombre.get(r.id_entidad_afectada!) ?? null,
        observacion: (r.valor_nuevo as { observacion?: string | null } | null)?.observacion ?? null,
      })),
    };
  }

  async registrar(
    id_empresa: number,
    id_contrato: number,
    accion: 'CORTE' | 'REACTIVACION',
    observacion: string | undefined,
    id_usuario: number,
  ) {
    const c = await this.conPermiso(() =>
      this.prisma.contrato.findFirst({
        where: { id_contrato, id_empresa },
        select: { id_contrato: true, estado: true, fecha_suspension: true },
      }),
    );
    if (!c) throw new NotFoundException(`Contrato ${id_contrato} no encontrado`);

    const ultimo = await this.prisma.log_auditoria.findFirst({
      where: { entidad_afectada: 'contrato', id_entidad_afectada: id_contrato, accion: { in: ACCIONES } },
      orderBy: [{ fecha_hora: 'desc' }, { id_log: 'desc' }],
      select: { accion: true, fecha_hora: true },
    });
    const esperado = accion === 'CORTE' ? 'POR_CORTAR' : 'POR_REACTIVAR';
    if (clasificarContrato(c, ultimo) !== esperado) {
      throw new ConflictException({
        codigo: 'NO_PENDIENTE',
        message:
          accion === 'CORTE'
            ? 'Este contrato no está pendiente de corte: ya se registró o G8 lo reactivó.'
            : 'Este contrato no está pendiente de reactivación.',
      });
    }

    const r = await this.prisma.log_auditoria.create({
      data: {
        id_usuario,
        accion: accion === 'CORTE' ? ACCION_CORTE : ACCION_REACTIVACION,
        entidad_afectada: 'contrato',
        id_entidad_afectada: id_contrato,
        valor_nuevo: {
          observacion: observacion?.trim() || null,
          estado_contrato: c.estado,
          fecha_suspension: c.fecha_suspension ? diaDeFecha(c.fecha_suspension) : null,
        },
      },
    });
    return { id_log: Number(r.id_log), accion: r.accion, fecha_hora: r.fecha_hora };
  }

  /** `contrato` es de G8: si la base nos niega leerlo, se dice claro. */
  private async conPermiso<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (esFaltaDePermiso(e)) {
        throw new ServiceUnavailableException({
          codigo: 'SIN_PERMISO_CONTRATO',
          message:
            'El sistema no tiene permiso para leer los contratos de la base compartida. ' +
            'Hay que pedirle al admin: GRANT SELECT ON contrato TO g3_app.',
        });
      }
      throw e;
    }
  }
}
```

```ts
// fsm/backend/src/cortes/cortes.controller.ts
import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CortesService } from './cortes.service.js';
import { RegistrarCorteDto } from './dto/registrar-corte.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';

/**
 * Cortes y reactivaciones por morosidad. El ADMIN cambia de empresa con la
 * cabecera de empresa activa, que ya resuelve el JwtStrategy.
 */
@Controller('cortes')
export class CortesController {
  constructor(private cortes: CortesService) {}

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get()
  listar(@CurrentUser() user: UsuarioAutenticado) {
    return this.cortes.listar(user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post(':id/hecho')
  hecho(
    @CurrentUser() user: UsuarioAutenticado,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RegistrarCorteDto,
  ) {
    return this.cortes.registrar(user.id_empresa, id, dto.accion, dto.observacion, user.userId);
  }
}
```

```ts
// fsm/backend/src/cortes/cortes.module.ts
import { Module } from '@nestjs/common';
import { CortesController } from './cortes.controller.js';
import { CortesService } from './cortes.service.js';

@Module({
  // PrismaModule es global.
  controllers: [CortesController],
  providers: [CortesService],
})
export class CortesModule {}
```

En `fsm/backend/src/app.module.ts`, agregar `import { CortesModule } from './cortes/cortes.module.js';` junto a los demás imports, y `CortesModule,` en el arreglo `imports`, después de `AuditoriaModule,`.

- [ ] **Paso 4: correr la prueba, el typecheck y la suite completa**

Correr: `npm test -- src/cortes` y después `npx tsc --noEmit -p tsconfig.json`
Esperado: PASS (20 pruebas en `src/cortes`) y el typecheck sin errores.

- [ ] **Paso 5: commit**

```bash
git add fsm/backend/src/cortes fsm/backend/src/app.module.ts
git commit -m "feat(cortes): API del panel de cortes y reactivaciones"
```

---

### Tarea 4: El motor de alertas no alerta por un cliente suspendido

**Archivos:**
- Modificar: `fsm/backend/src/monitoreo/reglas-alerta.ts` (`EstadoOnt` y `esInactiva`)
- Modificar: `fsm/backend/src/monitoreo/alertas.service.ts` (`cargarEstado`)
- Prueba: `fsm/backend/src/monitoreo/suspendidos-monitoreo.spec.ts`

**Interfaces:**
- Consume: `clientesSuspendidos` (Tarea 2).
- Produce: `EstadoOnt.suspendido?: boolean`. `esInactiva(o)` devuelve `true` si `o.suspendido`. `cargarEstado` llena `suspendido`.

- [ ] **Paso 1: escribir la prueba (falla)**

```ts
// fsm/backend/src/monitoreo/suspendidos-monitoreo.spec.ts
import { describe, expect, it, jest } from '@jest/globals';
import { AlertasService } from './alertas.service.js';
import { esInactiva, evaluar, type EstadoOnt } from './reglas-alerta.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const AHORA = new Date('2026-11-13T15:00:00Z');
const ont = (id: number, extra: Partial<EstadoOnt> = {}): EstadoOnt => ({
  id_registro_ont: id, numero_serie: `SN-${id}`, id_cliente: id, id_caja_nap: null,
  olt_externo: '2', board: 1, puerto_pon: 7, caja_normalizada: 'NAP 5',
  estado_conexion: 'OFFLINE', potencia_dbm: null, sin_senal_desde: new Date('2026-11-13T12:00:00Z'), ...extra,
});

describe('cliente suspendido por deuda', () => {
  it('cuenta como inactiva aunque este en linea', () => {
    expect(esInactiva({ estado_conexion: 'ONLINE', sin_senal_desde: null, suspendido: true }, AHORA)).toBe(true);
  });

  it('su ONT caida no genera SIN_SENAL', () => {
    const propuestas = evaluar([ont(1, { suspendido: true })], AHORA, 30);
    expect(propuestas.filter((p) => p.tipo === 'SIN_SENAL')).toHaveLength(0);
    // Control: la misma ONT sin suspender si alerta.
    expect(evaluar([ont(1)], AHORA, 30).filter((p) => p.tipo === 'SIN_SENAL')).toHaveLength(1);
  });

  it('cargarEstado marca las ONT de clientes suspendidos', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ ...ont(1), potencia_dbm: null }, { ...ont(2), potencia_dbm: null }]),
      contrato: { findMany: jest.fn(async () => [{ id_cliente: 1, estado: 'Suspendido' }]) },
    } as unknown as PrismaService;
    const r = await new AlertasService(prisma).cargarEstado(1);
    expect(r.map((o) => [o.id_cliente, o.suspendido])).toEqual([[1, true], [2, false]]);
  });

  it('si no puede leer contrato, cargarEstado sigue funcionando sin marcar a nadie', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ ...ont(1), potencia_dbm: null }]),
      contrato: { findMany: jest.fn(async () => { throw Object.assign(new Error('permission denied'), { code: '42501' }); }) },
    } as unknown as PrismaService;
    const r = await new AlertasService(prisma).cargarEstado(1);
    expect(r).toHaveLength(1);
    expect(r[0].suspendido).toBe(false);
  });
});
```

- [ ] **Paso 2: correrla y ver que falla**

Correr: `npm test -- src/monitoreo/suspendidos-monitoreo.spec.ts`
Esperado: FAIL. `esInactiva` devuelve `false` para la ONT en línea suspendida, y `suspendido` queda `undefined`.

- [ ] **Paso 3: implementar**

En `reglas-alerta.ts`, dentro de `interface EstadoOnt`, después de `nombre_cliente?: string | null;`:

```ts
  /**
   * El cliente esta suspendido por deuda (contrato de G8 suspendido y ninguno
   * activo). Su ONT caida es esperada: no es incidente. Ver `clientesSuspendidos`.
   */
  suspendido?: boolean;
```

Reemplazar `esInactiva` por:

```ts
export function esInactiva(
  o: Pick<EstadoOnt, 'estado_conexion' | 'sin_senal_desde' | 'suspendido'>,
  ahora: Date,
): boolean {
  // Suspendido por deuda: fuera del padron igual que una baja, este o no en linea.
  if (o.suspendido) return true;
  if (!estaCaida(o)) return false;
  if (!o.sin_senal_desde) return false;
  return (ahora.getTime() - o.sin_senal_desde.getTime()) / 86_400_000 > DIAS_MAX_INCIDENTE;
}
```

En `alertas.service.ts`, agregar `import { clientesSuspendidos } from '../cortes/suspendidos.js';` y, en `cargarEstado`, justo antes de `return filas.map((f) => ({`:

```ts
    // Aparte de la consulta principal a proposito: si se pierde el permiso
    // sobre `contrato` (de G8), el monitoreo no puede caerse. Ver `clientesSuspendidos`.
    const suspendidos = await clientesSuspendidos(this.prisma, id_empresa, this.logger);
```

y, en el objeto que arma cada fila, después de `nombre_cliente: f.nombre_cliente_ext,`:

```ts
      suspendido: f.id_cliente != null && suspendidos.has(f.id_cliente),
```

- [ ] **Paso 4: correr las pruebas de monitoreo**

Correr: `npm test -- src/monitoreo src/planta-externa`
Esperado: PASS, incluidas las 4 nuevas. Las pruebas existentes que simulan Prisma sin `contrato` siguen pasando: `clientesSuspendidos` atrapa el error y devuelve un conjunto vacío.

- [ ] **Paso 5: commit**

```bash
git add fsm/backend/src/monitoreo/reglas-alerta.ts fsm/backend/src/monitoreo/alertas.service.ts fsm/backend/src/monitoreo/suspendidos-monitoreo.spec.ts
git commit -m "feat(monitoreo): un cliente suspendido por deuda no genera alertas ni cuenta en su caja"
```

---

### Tarea 5: La marca "suspendido" en la lista de ONT, el resumen y el detalle de caja

**Archivos:**
- Modificar: `fsm/backend/src/monitoreo/monitoreo.service.ts` (`lecturasRecientes`, `detalleOnt`, `estadoCliente`, `resumen`, `aVista`)
- Modificar: `fsm/backend/src/planta-externa/salud-cajas.service.ts` (mapeo de `onts` en `detalle`)
- Prueba: `fsm/backend/src/monitoreo/resumen-bajas.spec.ts` y `fsm/backend/src/planta-externa/salud-cajas.service.spec.ts` (agregar casos)

**Interfaces:**
- Consume: `clientesSuspendidos` (Tarea 2) y `EstadoOnt.suspendido` (Tarea 4).
- Produce:
  - Las lecturas y `detalleOnt` agregan `suspendido: boolean`, y su `posible_baja` es `false` si la ONT está suspendida.
  - `resumen` agrega `suspendidos: number` y los excluye de `por_estado` y de `posibles_bajas`.
  - El detalle de caja de Topología agrega `suspendido: boolean` en cada ONT.

- [ ] **Paso 1: escribir las pruebas (fallan)**

En `resumen-bajas.spec.ts`:
- en el `useValue` de `PrismaService`, reemplazar `{ registro_ont: { findMany } }` por `{ registro_ont: { findMany }, contrato: { findMany: contratoFindMany } }`;
- declarar arriba `const contratoFindMany = jest.fn(async (_a?: any) => [] as any[]);`;
- en la función `ont(...)`, agregar el parámetro opcional `id_cliente: number | null = null` y usarlo en el objeto;
- agregar al final del `describe`:

```ts
  it('el cliente suspendido no es posible baja ni fuera de linea: se cuenta aparte', async () => {
    contratoFindMany.mockImplementation(async () => [{ id_cliente: 9, estado: 'Suspendido' }]);
    findMany.mockImplementation(async () => [
      ont('A', 'ONLINE', dias(30)),
      ont('S', 'OFFLINE', dias(800), undefined, 9),
    ]);

    const l = await service.lecturasRecientes(1);
    expect(l.find((o) => o.numero_serie === 'S')).toMatchObject({ suspendido: true, posible_baja: false });

    const r = await service.resumen(1);
    expect(r).toMatchObject({ suspendidos: 1, posibles_bajas: 0 });
    expect(r.por_estado).toMatchObject({ ONLINE: 1, OFFLINE: 0 });
  });
```

En `salud-cajas.service.spec.ts`, agregar al final del `describe`:

```ts
  it('el detalle marca la ONT de un cliente suspendido, y no como posible baja', async () => {
    cajaFindMany.mockImplementation(async () => [
      { id_caja_nap: 1, identificador_unico: 'NAP 5', zona: 'Z', numero_poste: null, latitud: -33.5, longitud: -71.6, mufa: null },
    ]);
    cargarEstado.mockImplementation(async () => [ont(1, { numero_serie: 'S', estado_conexion: 'OFFLINE', suspendido: true })]);

    const d = await service.detalle(1, 1);

    expect(d.onts[0]).toMatchObject({ numero_serie: 'S', suspendido: true, posible_baja: false });
  });
```

- [ ] **Paso 2: correrlas y ver que fallan**

Correr: `npm test -- src/monitoreo/resumen-bajas.spec.ts src/planta-externa/salud-cajas.service.spec.ts`
Esperado: FAIL, porque `suspendido` y `suspendidos` no existen.

- [ ] **Paso 3: implementar**

En `monitoreo.service.ts`, agregar `import { clientesSuspendidos } from '../cortes/suspendidos.js';`. Después:

- En `lecturasRecientes`, reemplazar las dos últimas líneas por:

```ts
    const ahora = new Date();
    const suspendidos = await clientesSuspendidos(this.prisma, id_empresa, this.logger);
    return registros.map((r) => this.aVista(r, ahora, suspendidos));
```

- En `detalleOnt`, reemplazar `{ ...this.aVista(registro, new Date()), historial_conexion: registro.historial }` por:

```ts
{ ...this.aVista(registro, new Date(), await clientesSuspendidos(this.prisma, id_empresa, this.logger)), historial_conexion: registro.historial }
```

- En `estadoCliente`, reemplazar las dos últimas líneas por:

```ts
    const ahora = new Date();
    const suspendidos = await clientesSuspendidos(this.prisma, id_empresa, this.logger);
    return { id_cliente, onts: registros.map((r) => this.aVista(r, ahora, suspendidos)) };
```

- En `resumen`, declarar `let suspendidos = 0;` junto a `let posibles_bajas = 0;`, poner al inicio del `for` (antes de `if (v.posible_baja)`):

```ts
      if (v.suspendido) {
        suspendidos++;
        continue;
      }
```

  y agregar `suspendidos,` al objeto que se devuelve, después de `posibles_bajas,`.

- En `aVista`, cambiar la firma a `private aVista(r: {...}, ahora: Date, suspendidos: Set<number> = new Set())`. Antes del `return`:

```ts
    const suspendido = r.id_cliente != null && suspendidos.has(r.id_cliente);
```

  y en el objeto, reemplazar la línea de `posible_baja` por:

```ts
      /** Caida hace mas de 7 dias: equipo de un cliente que se fue. Ver `esInactiva`. */
      posible_baja: !suspendido && esInactiva({ estado_conexion: estado, sin_senal_desde }, ahora),
      /** Cliente suspendido por deuda (contrato de G8): su caida es esperada. */
      suspendido,
```

En `salud-cajas.service.ts`, en el mapeo de `onts` del `detalle`, reemplazar `posible_baja: esInactiva(o, ahora),` por:

```ts
          posible_baja: !o.suspendido && esInactiva(o, ahora),
          suspendido: !!o.suspendido,
```

- [ ] **Paso 4: correr las pruebas**

Correr: `npm test -- src/monitoreo src/planta-externa` y `npx tsc --noEmit -p tsconfig.json`
Esperado: PASS y el typecheck limpio.

- [ ] **Paso 5: commit**

```bash
git add fsm/backend/src/monitoreo/monitoreo.service.ts fsm/backend/src/monitoreo/resumen-bajas.spec.ts fsm/backend/src/planta-externa/salud-cajas.service.ts fsm/backend/src/planta-externa/salud-cajas.service.spec.ts
git commit -m "feat(monitoreo): la lista de ONT, el resumen y el detalle de caja muestran a los suspendidos por deuda"
```

---

### Tarea 6: La OT de retiro de G8 lleva la caja del cliente

**Archivos:**
- Modificar: `fsm/backend/src/integraciones/bajas.service.ts` (`crear` y un método privado nuevo `cajaDelCliente`)
- Prueba: `fsm/backend/src/integraciones/bajas.service.spec.ts`

**Interfaces:**
- Produce: la OT de `BAJA` que crea `BajasService.crear` sale con `id_caja_nap` (o `null`). Con eso, `aprobarCierre` libera el puerto mediante `moverPuerto(..., 'desconectar')`, que no se toca.

- [ ] **Paso 1: escribir la prueba (falla)**

En `bajas.service.spec.ts`, dentro de `prismaFalso`:
- agregar a `opciones` los campos `ontsCliente?: { id_caja_nap: number | null }[]` y `puertoCliente?: { id_caja_nap: number | null } | null`;
- agregar al objeto `prisma`:

```ts
    registro_ont: { findMany: jest.fn(async () => opciones.ontsCliente ?? []) },
    puerto_nap: { findFirst: jest.fn(async () => opciones.puertoCliente ?? null) },
```

Agregar al final del archivo:

```ts
describe('la OT de retiro lleva la caja del cliente', () => {
  it('toma la caja mas frecuente de sus ONT', async () => {
    const { prisma, creado } = prismaFalso({ ontsCliente: [{ id_caja_nap: 30 }, { id_caja_nap: 12 }, { id_caja_nap: 12 }] });
    await new BajasService(prisma).crear(SCOPE, dto());
    expect(creado.ot[0]).toMatchObject({ id_caja_nap: 12 });
  });

  it('a falta de ONT, la de su puerto ocupado', async () => {
    const { prisma, creado } = prismaFalso({ puertoCliente: { id_caja_nap: 44 } });
    await new BajasService(prisma).crear(SCOPE, dto());
    expect(creado.ot[0]).toMatchObject({ id_caja_nap: 44 });
  });

  it('sin ninguna de las dos, queda en null como antes', async () => {
    const { prisma, creado } = prismaFalso();
    await new BajasService(prisma).crear(SCOPE, dto());
    expect(creado.ot[0]).toMatchObject({ id_caja_nap: null });
  });
});
```

- [ ] **Paso 2: correrla y ver que falla**

Correr: `npm test -- src/integraciones/bajas.service.spec.ts`
Esperado: FAIL, porque `id_caja_nap` no viene en la OT creada.

- [ ] **Paso 3: implementar**

En `bajas.service.ts`, agregar `import { ESTADO_PUERTO } from '../planta-externa/dto/editar-topologia.dto.js';`.

En `crear`, después del bloque `if (activa) { ... }` y antes de `try {`:

```ts
    // Sin la caja, aprobar el retiro no libera el puerto: `moverPuerto` la necesita.
    const id_caja_nap = await this.cajaDelCliente(cliente.id_cliente, dto.id_empresa);
```

En el `data` de `tx.orden_trabajo.create`, después de `id_direccion: ...`:

```ts
            id_caja_nap,
```

Agregar el método privado a la clase:

```ts
  /**
   * La caja del cliente: la que mas se repite entre sus ONT (lo que dice
   * SmartOLT) y, si no tiene ninguna ligada, la de su puerto OCUPADO. Null si
   * no se sabe; la OT sale igual, como antes.
   */
  private async cajaDelCliente(id_cliente: number, id_empresa: number): Promise<number | null> {
    const onts = await this.prisma.registro_ont.findMany({
      where: { id_cliente, id_empresa, id_caja_nap: { not: null } },
      select: { id_caja_nap: true },
    });
    if (onts.length > 0) {
      const veces = new Map<number, number>();
      for (const o of onts) veces.set(o.id_caja_nap!, (veces.get(o.id_caja_nap!) ?? 0) + 1);
      return [...veces].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    }
    const puerto = await this.prisma.puerto_nap.findFirst({
      where: { id_cliente_asociado: id_cliente, estado: ESTADO_PUERTO.OCUPADO, id_caja_nap: { not: null } },
      orderBy: { id_puerto: 'asc' },
      select: { id_caja_nap: true },
    });
    return puerto?.id_caja_nap ?? null;
  }
```

- [ ] **Paso 4: correr las pruebas**

Correr: `npm test -- src/integraciones` y `npx tsc --noEmit -p tsconfig.json`
Esperado: PASS (las existentes y las 3 nuevas) y el typecheck limpio.

- [ ] **Paso 5: commit**

```bash
git add fsm/backend/src/integraciones/bajas.service.ts fsm/backend/src/integraciones/bajas.service.spec.ts
git commit -m "fix(integraciones): la OT de retiro de G8 lleva la caja del cliente y al aprobarla libera el puerto"
```

---

### Tarea 7: Página "Cortes y reactivaciones"

**Archivos:**
- Crear: `fsm/frontend/src/lib/api/cortes.api.ts`, `fsm/frontend/src/routes/admin/cortes/+page.svelte`
- Modificar: `fsm/frontend/src/routes/admin/+layout.svelte` (ícono y entrada en `navLinks`)
- Prueba: `fsm/frontend/test/flujos.spec.ts` (prueba nueva)

**Interfaces:**
- Consume: la API de la Tarea 3.
- Produce: la ruta `/admin/cortes`.

- [ ] **Paso 1: escribir la prueba e2e (falla)**

Agregar en `flujos.spec.ts`, antes de `// CU-25: baja de servicio.`:

```ts
test('Cortes: lista lo que falta cortar en SmartOLT, lo registra y pasa al historial', async ({ page }) => {
  await preparar(page);
  let cortado = false;
  const cuerpos: unknown[] = [];
  const fila = {
    id_contrato: 5, estado_contrato: 'Suspendido', fecha_suspension: '2026-11-13', plan: 'FULL S',
    cliente: { id_cliente: 55, nombre_completo: 'Cliente Moroso', rut: '11111111-1', telefono: '9 1234 5678' },
    direccion: { direccion_completa: 'Calle 1', comuna: 'La Granja' }, onts: [], ultimo_registro: null,
  };
  await page.route('http://127.0.0.1:3000/api/cortes', (route) => route.fulfill({ json: {
    por_cortar: cortado ? [] : [fila],
    por_reactivar: [],
    historial: cortado ? [{ id_log: 1, accion: 'CORTE_SMARTOLT', fecha_hora: '2026-11-13T15:00:00Z', usuario: 'Admin Prueba', id_contrato: 5, cliente: 'Cliente Moroso', observacion: 'listo' }] : [],
  } }));
  await page.route('http://127.0.0.1:3000/api/cortes/5/hecho', (route) => {
    cuerpos.push(route.request().postDataJSON());
    cortado = true;
    return route.fulfill({ status: 201, json: { id_log: 1, accion: 'CORTE_SMARTOLT', fecha_hora: '2026-11-13T15:00:00Z' } });
  });
  await login(page, 'admin'); await page.goto('/admin/cortes');

  await expect(page.getByText('El corte y la reactivación se hacen en SmartOLT')).toBeVisible();
  await expect(page.getByText('Cliente Moroso')).toBeVisible();
  await expect(page.getByText('Buscar en SmartOLT por nombre o RUT')).toBeVisible();

  await page.getByRole('button', { name: 'Hecho en SmartOLT' }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Observación (opcional)').fill('listo');
  await dialogo.getByRole('button', { name: 'Registrar corte' }).click();

  expect(cuerpos).toEqual([{ accion: 'CORTE', observacion: 'listo' }]);
  await expect(page.getByText('No hay contratos por cortar.')).toBeVisible();
  await page.getByText('Historial').click();
  await expect(page.getByText('Admin Prueba')).toBeVisible();
});

test('Cortes: sin permiso sobre contrato lo dice en vez de romperse', async ({ page }) => {
  await preparar(page);
  await page.route('http://127.0.0.1:3000/api/cortes', (route) => route.fulfill({ status: 503, json: {
    codigo: 'SIN_PERMISO_CONTRATO',
    message: 'El sistema no tiene permiso para leer los contratos de la base compartida. Hay que pedirle al admin: GRANT SELECT ON contrato TO g3_app.',
  } }));
  await login(page, 'admin'); await page.goto('/admin/cortes');
  await expect(page.getByText('no tiene permiso para leer los contratos')).toBeVisible();
});
```

- [ ] **Paso 2: correrla y ver que falla**

Correr: `npx playwright test test/flujos.spec.ts -g "Cortes" --reporter=line`
Esperado: FAIL, porque la página no existe y el texto no aparece. Antes de correr, verificar que el puerto 5173 esté libre (ver la memoria "servidores dev en Windows").

- [ ] **Paso 3: implementar el cliente de la API, la página y la entrada del menú**

```ts
// fsm/frontend/src/lib/api/cortes.api.ts
import { API_URL } from './config.js';
import { pedirJson } from './http.js';

/** Cortes y reactivaciones por morosidad: G8 suspende, FiNet corta a mano en SmartOLT, el FSM registra. */

export interface FilaCorte {
  id_contrato: number;
  estado_contrato: string;
  fecha_suspension: string | null;
  plan: string | null;
  cliente: { id_cliente: number; nombre_completo: string; rut: string | null; telefono: string | null } | null;
  direccion: { direccion_completa: string; comuna: string } | null;
  onts: {
    numero_serie: string;
    estado_conexion: string | null;
    odb: string | null;
    odb_puerto: number | null;
    olt_externo: string | null;
    board: number | null;
    puerto_pon: number | null;
  }[];
  ultimo_registro: { accion: string; fecha_hora: string } | null;
}

export interface RegistroCorte {
  id_log: number;
  accion: string;
  fecha_hora: string;
  usuario: string | null;
  id_contrato: number;
  cliente: string | null;
  observacion: string | null;
}

export interface PanelCortes {
  por_cortar: FilaCorte[];
  por_reactivar: FilaCorte[];
  historial: RegistroCorte[];
}

export function listarCortes(token: string): Promise<PanelCortes> {
  return pedirJson(token, `${API_URL}/api/cortes`, undefined, 'No se pudo cargar el panel de cortes');
}

export function registrarCorte(token: string, id_contrato: number, accion: 'CORTE' | 'REACTIVACION', observacion?: string) {
  return pedirJson(
    token,
    `${API_URL}/api/cortes/${id_contrato}/hecho`,
    { method: 'POST', body: JSON.stringify({ accion, ...(observacion?.trim() ? { observacion: observacion.trim() } : {}) }) },
    'No se pudo registrar',
  );
}
```

```svelte
<!-- fsm/frontend/src/routes/admin/cortes/+page.svelte -->
<script lang="ts">
  import Alert from '$lib/components/Alert.svelte';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.store';
  import { listarCortes, registrarCorte, type FilaCorte, type PanelCortes } from '$lib/api/cortes.api';

  let token = $state('');
  let panel = $state<PanelCortes | null>(null);
  let cargando = $state(true);
  let error = $state('');
  let aviso = $state('');

  /** Fila cuyo dialogo de confirmacion esta abierto. */
  let pendiente = $state<{ fila: FilaCorte; accion: 'CORTE' | 'REACTIVACION' } | null>(null);
  let observacion = $state('');
  let guardando = $state(false);
  let errorDialogo = $state('');

  onMount(() => {
    authStore.checkAuth();
    const state = get(authStore);
    if (!state.isAuthenticated) {
      goto('/login');
      return;
    }
    if (!['ADMIN', 'JEFE_TECNICO'].includes(state.usuario?.rol ?? '')) {
      goto(state.usuario?.rol === 'TECNICO' ? '/terreno' : '/admin/dashboard');
      return;
    }
    token = state.token ?? '';
    cargar();
  });

  async function cargar() {
    cargando = true;
    error = '';
    try {
      panel = await listarCortes(token);
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo cargar el panel de cortes';
    } finally {
      cargando = false;
    }
  }

  function abrir(fila: FilaCorte, accion: 'CORTE' | 'REACTIVACION') {
    pendiente = { fila, accion };
    observacion = '';
    errorDialogo = '';
  }

  async function confirmar() {
    if (!pendiente) return;
    guardando = true;
    errorDialogo = '';
    try {
      await registrarCorte(token, pendiente.fila.id_contrato, pendiente.accion, observacion);
      aviso = `${pendiente.accion === 'CORTE' ? 'Corte' : 'Reactivación'} de ${pendiente.fila.cliente?.nombre_completo ?? `contrato #${pendiente.fila.id_contrato}`} registrado`;
      pendiente = null;
      await cargar();
    } catch (e) {
      // Aca aterriza el 409: otra persona ya lo registro.
      errorDialogo = e instanceof Error ? e.message : 'No se pudo registrar';
    } finally {
      guardando = false;
    }
  }

  function fecha(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  }
</script>

<svelte:head><title>Cortes y reactivaciones</title></svelte:head>

<div class="mb-6">
  <h1 class="text-2xl font-bold text-slate-900">Cortes y reactivaciones</h1>
  <p class="text-sm text-slate-500 mt-0.5">Clientes que G8 suspendió o reactivó por deuda</p>
</div>

<div class="mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
  <strong>El corte y la reactivación se hacen en SmartOLT.</strong> Este panel solo registra que se hicieron.
</div>

{#if aviso}
  <div role="status" class="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center justify-between">
    <span>{aviso}</span>
    <button onclick={() => (aviso = '')} class="text-emerald-600 hover:text-emerald-800 cursor-pointer" aria-label="Cerrar aviso">✕</button>
  </div>
{/if}

{#if cargando && !panel}
  <p class="text-center py-10 text-slate-500">Cargando...</p>
{:else if error}
  <Alert class="rounded-lg text-sm">{error}</Alert>
{:else if panel}
  {#each [
    { titulo: 'Por cortar', filas: panel.por_cortar, accion: 'CORTE' as const, vacio: 'No hay contratos por cortar.' },
    { titulo: 'Por reactivar', filas: panel.por_reactivar, accion: 'REACTIVACION' as const, vacio: 'No hay contratos por reactivar.' },
  ] as bloque (bloque.accion)}
    <section class="bg-white rounded-xl border border-slate-200 mb-5 overflow-hidden">
      <h2 class="px-5 py-3 text-lg font-semibold text-slate-900 border-b border-slate-200">
        {bloque.titulo} <span class="text-slate-500 font-normal">({bloque.filas.length})</span>
      </h2>
      {#if bloque.filas.length === 0}
        <p class="px-5 py-4 text-sm text-slate-500">{bloque.vacio}</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 text-left">
              <tr>
                <th class="px-4 py-2.5 font-medium">Cliente</th>
                <th class="px-4 py-2.5 font-medium">Dirección</th>
                <th class="px-4 py-2.5 font-medium">Plan</th>
                <th class="px-4 py-2.5 font-medium">{bloque.accion === 'CORTE' ? 'Suspendido desde' : 'Cortado el'}</th>
                <th class="px-4 py-2.5 font-medium">Equipo</th>
                <th class="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              {#each bloque.filas as f (f.id_contrato)}
                <tr>
                  <td class="px-4 py-2.5">
                    {#if f.cliente}
                      <a href="/admin/clientes/{f.cliente.id_cliente}" class="btn-texto">{f.cliente.nombre_completo}</a>
                      <span class="block text-xs text-slate-500">{f.cliente.rut ?? ''}{f.cliente.telefono ? ` · ${f.cliente.telefono}` : ''}</span>
                    {:else}
                      <span class="text-slate-500">Cliente no registrado (contrato #{f.id_contrato})</span>
                    {/if}
                  </td>
                  <td class="px-4 py-2.5 text-slate-700">{f.direccion ? `${f.direccion.direccion_completa}, ${f.direccion.comuna}` : '—'}</td>
                  <td class="px-4 py-2.5 text-slate-700">{f.plan ?? '—'}</td>
                  <td class="px-4 py-2.5 text-slate-700 tabular-nums">
                    {bloque.accion === 'CORTE' ? (f.fecha_suspension ?? '—') : fecha(f.ultimo_registro?.fecha_hora ?? null)}
                  </td>
                  <td class="px-4 py-2.5">
                    {#if f.onts.length}
                      {#each f.onts as o (o.numero_serie)}
                        <a href={`/admin/monitoreo/ont/${encodeURIComponent(o.numero_serie)}`} class="btn-texto font-mono text-xs">{o.numero_serie}</a>
                        <span class="block text-xs text-slate-500">
                          {o.odb ?? 'Sin caja'}{o.odb_puerto ? ` · puerto ${o.odb_puerto}` : ''} · {o.estado_conexion ?? 'sin lectura'}
                        </span>
                      {/each}
                    {:else}
                      <span class="text-xs text-slate-500">Buscar en SmartOLT por nombre o RUT</span>
                    {/if}
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button onclick={() => abrir(f, bloque.accion)} class="btn btn-secundario whitespace-nowrap">Hecho en SmartOLT</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/each}

  <details class="bg-white rounded-xl border border-slate-200 p-5">
    <summary class="cursor-pointer text-lg font-semibold text-slate-900">Historial</summary>
    {#if panel.historial.length === 0}
      <p class="mt-3 text-sm text-slate-500">Todavía no se registra ningún corte ni reactivación.</p>
    {:else}
      <ul class="mt-3 divide-y divide-slate-100 text-sm">
        {#each panel.historial as h (h.id_log)}
          <li class="py-2.5 flex items-start justify-between gap-4">
            <div>
              <p class="font-medium text-slate-900">
                {h.accion === 'CORTE_SMARTOLT' ? 'Corte' : 'Reactivación'} · {h.cliente ?? `contrato #${h.id_contrato}`}
              </p>
              {#if h.observacion}<p class="text-slate-600">{h.observacion}</p>{/if}
            </div>
            <p class="text-xs text-slate-500 text-right shrink-0">{fecha(h.fecha_hora)}<br />{h.usuario ?? '—'}</p>
          </li>
        {/each}
      </ul>
    {/if}
  </details>
{/if}

{#if pendiente}
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-1000" role="dialog" aria-modal="true" aria-labelledby="titulo-corte">
    <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-3 text-sm">
      <h2 id="titulo-corte" class="text-lg font-semibold text-slate-900">
        {pendiente.accion === 'CORTE' ? 'Registrar corte' : 'Registrar reactivación'}
      </h2>
      <p class="text-slate-600">
        Confirma que {pendiente.accion === 'CORTE' ? 'cortaste' : 'reactivaste'} en SmartOLT el servicio de
        <strong>{pendiente.fila.cliente?.nombre_completo ?? `contrato #${pendiente.fila.id_contrato}`}</strong>.
      </p>
      <div>
        <label for="obs-corte" class="block text-sm font-medium text-slate-700 mb-1">Observación (opcional)</label>
        <textarea id="obs-corte" bind:value={observacion} maxlength="300" rows="2"
          class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"></textarea>
      </div>
      {#if errorDialogo}<p class="text-red-600">{errorDialogo}</p>{/if}
      <div class="flex gap-3">
        <button onclick={() => (pendiente = null)} class="flex-1 btn btn-secundario">Cancelar</button>
        <button onclick={confirmar} disabled={guardando} class="flex-1 btn btn-primario">
          {guardando ? 'Registrando...' : pendiente.accion === 'CORTE' ? 'Registrar corte' : 'Registrar reactivación'}
        </button>
      </div>
    </div>
  </div>
{/if}
```

En `+layout.svelte`, agregar junto a los demás íconos:

```ts
  // Enchufe desconectado: corte del servicio por deuda.
  const ICON_CORTE = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 5.636a9 9 0 11-12.728 0M12 3v9"/></svg>`;
```

y en `navLinks`, después de la entrada de Topología:

```ts
    // Cortes y reactivaciones por morosidad: G8 suspende, FiNet corta en SmartOLT.
    { href: '/admin/cortes', label: 'Cortes', icon: ICON_CORTE, roles: ['ADMIN', 'JEFE_TECNICO'] },
```

- [ ] **Paso 4: correr las pruebas**

Correr: `npx playwright test test/flujos.spec.ts -g "Cortes" --reporter=line` y `npm run check`
Esperado: PASS (2 pruebas) y `svelte-check` sin errores nuevos. El único error esperado es el previo de `PUBLIC_API_URL` en `config.ts`.

- [ ] **Paso 5: commit**

```bash
git add fsm/frontend/src/lib/api/cortes.api.ts fsm/frontend/src/routes/admin/cortes fsm/frontend/src/routes/admin/+layout.svelte fsm/frontend/test/flujos.spec.ts
git commit -m "feat(cortes): página Cortes y reactivaciones"
```

---

### Tarea 8: Etiqueta "Suspendido por deuda" en Monitoreo y Topología

**Archivos:**
- Modificar: `fsm/frontend/src/lib/api/monitoreo.api.ts` (`ResumenMonitoreo.suspendidos`, `LecturaOnt.suspendido`)
- Modificar: `fsm/frontend/src/lib/api/topologia.api.ts` (`OntDeCaja.suspendido`)
- Modificar: `fsm/frontend/src/routes/admin/monitoreo/+page.svelte` (tarjeta "Fuera de línea", filtro, orden y fila de la lista de ONT)
- Modificar: `fsm/frontend/src/routes/admin/topologia/[id]/+page.svelte` (columna Estado de la tabla de ONT)
- Prueba: `fsm/frontend/test/flujos.spec.ts`

**Interfaces:**
- Consume: los campos de la Tarea 5.

- [ ] **Paso 1: escribir la prueba e2e (falla)**

Agregar antes de `test('CU-14: desde el monitoreo se abre el historial...`:

```ts
test('Monitoreo: un cliente suspendido por deuda se muestra con su etiqueta y no cuenta como fuera de linea', async ({ page }) => {
  await preparar(page);
  await page.route('http://127.0.0.1:3000/api/monitoreo/resumen', (route) => route.fulfill({ json: {
    total_ont: 2, por_estado: { ONLINE: 1 }, posibles_bajas: 0, suspendidos: 1, potencia_fuera_de_rango: 0, fecha_actualizacion: '2026-11-13T15:00:00Z',
  } }));
  await page.route('http://127.0.0.1:3000/api/monitoreo/ont?*', (route) => route.fulfill({ json: [
    { numero_serie: 'ACTIVA1', id_unidad: null, id_cliente: 1, zona: 'Z', olt_externo: '2', nombre_cliente_ext: null, estado_conexion: 'ONLINE', potencia_actual_dbm: -21, potencia_fuera_de_rango: false, medido_en: null, posible_baja: false, suspendido: false },
    { numero_serie: 'MOROSO1', id_unidad: null, id_cliente: 9, zona: 'Z', olt_externo: '2', nombre_cliente_ext: null, estado_conexion: 'OFFLINE', potencia_actual_dbm: null, potencia_fuera_de_rango: false, medido_en: null, posible_baja: false, suspendido: true },
  ] }));
  await page.route('http://127.0.0.1:3000/api/monitoreo/criticos-por-caja*', (route) => route.fulfill({ json: { cajas: [], totales: { cajas_afectadas: 0, clientes_criticos: 0, criticos_sin_caja: 0 } } }));
  await login(page, 'admin'); await page.goto('/admin/monitoreo');

  await expect(page.getByText('ni 1 clientes suspendidos por deuda')).toBeVisible();
  await page.getByRole('tab', { name: 'Todas las ONT' }).click();
  await expect(page.getByRole('row', { name: /MOROSO1/ })).toContainText('Suspendido por deuda');
});
```

- [ ] **Paso 2: correrla y ver que falla**

Correr: `npx playwright test test/flujos.spec.ts -g "suspendido por deuda" --reporter=line`
Esperado: FAIL, porque el texto no aparece.

- [ ] **Paso 3: implementar**

`monitoreo.api.ts`:
- en `ResumenMonitoreo`, después de `posibles_bajas: number;`, agregar `/** Clientes suspendidos por deuda: su caída es esperada. */ suspendidos?: number;`;
- en `LecturaOnt`, después de `posible_baja: boolean;`, agregar `/** Cliente suspendido por deuda (contrato de G8). */ suspendido?: boolean;`.

`topologia.api.ts`, en `OntDeCaja`, después de `posible_baja: boolean;`, agregar `suspendido?: boolean;`.

`monitoreo/+page.svelte`:
- En `prioridad`, la primera línea pasa a ser `if (o.posible_baja || o.suspendido) return 4;`.
- En `ontsFiltradas`, el filtro de bajas pasa a ser `.filter((o) => mostrarBajas || !(o.posible_baja || o.suspendido))`.
- En la tarjeta "Fuera de línea", reemplazar el bloque `{#if resumen.posibles_bajas > 0} ... {/if}` por:

```svelte
        {#if resumen.posibles_bajas > 0 || (resumen.suspendidos ?? 0) > 0}
          <!-- Se dicen aparte para que el total cierre: ni una baja vieja ni un
               cliente cortado por deuda son un incidente. -->
          <p class="text-xs text-slate-500 mt-0.5">
            No incluye {resumen.posibles_bajas} posibles bajas (caídas hace más de 7 días){#if (resumen.suspendidos ?? 0) > 0}
              ni {resumen.suspendidos} clientes suspendidos por deuda{/if}
          </p>
        {/if}
```

- En la fila de la lista de ONT, reemplazar el `<tr ...>` y el contenido de la primera `<td>` por:

```svelte
            <tr class="hover:bg-slate-50 transition-colors duration-200 {o.posible_baja || o.suspendido ? 'text-slate-500' : ''}">
              <td class="px-3 py-2">
                <span
                  class="px-2 py-0.5 rounded-md text-xs font-semibold border
                         {o.posible_baja || o.suspendido
                           ? 'bg-slate-100 text-slate-600 border-slate-200'
                           : (estadoClase[o.estado_conexion ?? 'DESCONOCIDO'] ?? estadoClase.DESCONOCIDO)}"
                >
                  {o.estado_conexion ?? 'DESCONOCIDO'}
                </span>
                {#if o.suspendido}
                  <span class="block text-xs text-amber-700 mt-0.5">Suspendido por deuda</span>
                {:else if o.posible_baja}
                  <span class="block text-xs text-slate-500 mt-0.5">Posible baja</span>
                {/if}
              </td>
```

`topologia/[id]/+page.svelte`, en la tabla de ONT:
- `<tr class={o.posible_baja ? 'opacity-60' : ''}>` pasa a `<tr class={o.posible_baja || o.suspendido ? 'opacity-60' : ''}>`;
- el bloque `{#if o.posible_baja} ... {/if}` se reemplaza por:

```svelte
                  {#if o.suspendido}
                    <span class="block text-xs text-amber-700">Suspendido por deuda: no cuenta en el estado</span>
                  {:else if o.posible_baja}
                    <span class="block text-xs text-slate-500">Posible baja: no cuenta en el estado</span>
                  {/if}
```

- [ ] **Paso 4: correr las pruebas**

Correr: `npx playwright test test/flujos.spec.ts -g "Monitoreo|CU-14|CU-15|Topologia|Cortes" --reporter=line` y `npm run check`
Esperado: todo PASS. La prueba "Monitoreo: las posibles bajas..." sigue pasando, porque el texto "No incluye 1 posibles bajas (caídas hace más de 7 días)" se mantiene.

- [ ] **Paso 5: commit**

```bash
git add fsm/frontend/src/lib/api/monitoreo.api.ts fsm/frontend/src/lib/api/topologia.api.ts fsm/frontend/src/routes/admin/monitoreo/+page.svelte "fsm/frontend/src/routes/admin/topologia/[id]/+page.svelte" fsm/frontend/test/flujos.spec.ts
git commit -m "feat(monitoreo): etiqueta Suspendido por deuda en Monitoreo y Topología"
```

---

### Tarea 9: Script de datos de demo (solo Railway)

**Archivos:**
- Crear: `fsm/backend/scripts/demo-cortes.ts`

No lleva prueba automática: es una herramienta de demo y solo toca la base de Railway. Se verifica corriéndola.

- [ ] **Paso 1: escribir el script**

```ts
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
  const hoy = new Date(new Date().toISOString().slice(0, 10));
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
```

- [ ] **Paso 2: comprobar que se niega fuera de Railway**

Correr (desde `fsm/backend`, en Git Bash): `DATABASE_URL=postgresql://x@localhost:5432/x npx tsx scripts/demo-cortes.ts`
Esperado: "Este script solo corre contra la base de Railway..." y código de salida 1.

- [ ] **Paso 3: commit**

```bash
git add fsm/backend/scripts/demo-cortes.ts
git commit -m "chore(cortes): script de datos de demo para Railway"
```

No se corre contra Railway en este paso. Se corre en la Tarea 10, con el visto bueno del usuario.

---

### Tarea 10: Verificación completa y entrega

- [ ] **Paso 1: suite completa del backend, con el proceso en UTC como Railway**

Correr (en `fsm/backend`): `npx tsc --noEmit -p tsconfig.json` y después `TZ=UTC npm test`
Esperado: typecheck limpio y todas las suites en verde. Si algo falla, nombrarlo en el reporte.

- [ ] **Paso 2: frontend**

Correr (en `fsm/frontend`): `npm run check`, `PUBLIC_API_URL=http://127.0.0.1:3000 npm run build` y `npx playwright test --reporter=line`
Esperado: build OK. En la suite e2e, las únicas fallas aceptables son las dos que ya fallan en `main` ("MOD RF-04: el jefe tecnico aprueba un cierre desde el detalle" y "CU-31: no conforme pide el reclamo..."); cualquier otra se investiga.

- [ ] **Paso 3: prueba manual contra Railway (con el visto bueno del usuario)**

1. `npx tsx scripts/demo-cortes.ts`
2. Levantar el backend local con `MONITOREO_FUENTE=mock MONITOREO_POLL_ENABLED=false MONITOREO_PURGA_ENABLED=false npm run start:dev` y el frontend con `PUBLIC_API_URL=http://127.0.0.1:3000 npx vite dev --port 5173`. Abrir `http://localhost:5173/admin/cortes` (CORS solo acepta `localhost`).
3. Registrar un corte y ver que pasa al historial.
4. Revertir con `npx tsx scripts/demo-cortes.ts --revertir`.
5. Cerrar los servidores por puerto (3000 y 5173).

- [ ] **Paso 4: PR**

Subir la rama, abrir el PR contra `main` con el resumen del spec y el resultado de las pruebas, y esperar los checks. El merge se hace con el visto bueno del usuario.
