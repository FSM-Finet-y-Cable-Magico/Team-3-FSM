# Puertos por caja SmartOLT — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ver, por cada caja NAP de SmartOLT, qué puertos del divisor ocupa cada ONT (dato `odb_port`) contra la capacidad real de la caja (`nr_of_ports`).

**Architecture:** La ingesta guarda `registro_ont.odb_puerto` para todas las ONT en cada sondeo y una copia diaria del catálogo de cajas en `odb_smartolt`. Una función pura arma la grilla de una caja a partir de sus ONT (misma clave que el panel de críticos: puerto PON + nombre) y del catálogo. Dos endpoints exponen la lista de cajas y la grilla; el frontend suma una pestaña en Monitoreo y una página por caja.

**Tech Stack:** NestJS 11 + Prisma 7 (PostgreSQL), Jest con ESM (`npm test` = `node --experimental-vm-modules`), SvelteKit 2 + Svelte 5 (runes) + Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-12-puertos-caja-smartolt-design.md`

## Global Constraints

- Rama `feat/puertos-caja-smartolt` (sale de `feat/panel-cajas-smartolt`, PR #138). No se toca `main`.
- Backend en `fsm/backend`, frontend en `fsm/frontend`. Comandos de prueba: `cd fsm/backend && npm test -- <ruta>`; frontend: `cd fsm/frontend && npx svelte-check --threshold error`.
- Toda consulta de datos se acota por `id_empresa`. El catálogo se guarda SIEMPRE bajo `RegistroOntService.idEmpresaFuente`, nunca la empresa del usuario.
- SmartOLT: `get_all_onus_details` tiene límite de 15 llamadas/hora compartido; ninguna tarea puede agregar llamadas a ese endpoint. `get_odbs` se llama a lo sumo una vez cada 24 h desde el sondeo (`VIGENCIA_CATALOGO_MS = 24 * 3_600_000`).
- Endpoints nuevos: `@Roles('ADMIN', 'JEFE_TECNICO')` para lectura, `@Roles('ADMIN')` para `POST catalogo-odb`. Un ADMIN puede pasar `?empresa=`.
- La clave de caja (`olt/placa/puerto|NOMBRE NORMALIZADO`) viaja SOLO como query `?clave=` armada con `URLSearchParams`, nunca como segmento de ruta.
- Capacidad estimada: 8 si el puerto más alto ocupado es ≤ 8, 16 si es ≤ 16, si no ese puerto.
- No se tocan `puerto_nap`, `caja_nap`, la página de topología ni CU-20.
- Comentarios y textos de UI en español, en el mismo tono que el código existente.

## Review Focus

1. **Catálogo bajo otra empresa:** un ADMIN de la empresa 2 que dispara `POST catalogo-odb` no debe escribir el catálogo de SmartOLT (de la empresa 1) bajo la empresa 2 → se guarda con `idEmpresaFuente`. Prueba en Task 4.
2. **Clave con espacios, `/` y `|`:** `2/1/7|NAP 53` debe ir y volver intacta → query param + `URLSearchParams`; el servicio la busca literal. Prueba en Task 6.
3. **`odb_port` basura (`""`, `"0"`, `"2.5"`, `"abc"`, negativo):** no inventa un puerto → `null`, y la ONT cae en "sin puerto". Pruebas en Task 2 y Task 5.
4. **Fuente que no informa el puerto (CSV, mock) vs SmartOLT que dice "sin puerto":** `undefined` no borra un puerto guardado; `null` sí. Prueba en Task 3.
5. **Base lenta entre lecturas y censo:** no debe disparar una segunda llamada a `get_all_onus_details` → censo y lecturas se piden con `Promise.all` antes de tocar la base. Prueba en Task 3.

---

### Task 1: Esquema — `registro_ont.odb_puerto` y tabla `odb_smartolt`

**Files:**
- Modify: `fsm/backend/prisma/schema.prisma` (modelo `registro_ont`, modelo `empresa`, modelo nuevo)
- Create: `fsm/backend/prisma/migrations/20261113120000_puertos_caja_smartolt/migration.sql`

**Interfaces:**
- Produces: `prisma.registro_ont` con campo `odb_puerto: number | null`; `prisma.odb_smartolt` con `id_odb_smartolt, id_empresa, id_externo, nombre, capacidad, zona, actualizado_en` y unique compuesto `id_empresa_id_externo`.

- [ ] **Step 1: Agregar `odb_puerto` a `registro_ont`**

En `schema.prisma`, dentro de `model registro_ont`, justo debajo de `odb String? @db.VarChar(50)`:

```prisma
  /// Puerto del divisor donde está conectada la ONT (SmartOLT `odb_port`).
  /// Null si SmartOLT no lo informa. Lo escribe la ingesta en cada sondeo.
  odb_puerto            Int?                     @db.SmallInt
```

- [ ] **Step 2: Agregar el modelo `odb_smartolt` y su relación en `empresa`**

Al final de `model empresa { ... }`, antes de la llave de cierre:

```prisma
  odbs_smartolt           odb_smartolt[]
```

Y un modelo nuevo, después de `model registro_ont`:

```prisma
/// Copia del catálogo de cajas de SmartOLT (`/system/get_odbs`).
///
/// Existe por la capacidad: `nr_of_ports` no viene en el censo de ONT, y pedir
/// el catálogo cada vez que alguien abre una caja gastaría la cuota de la API,
/// compartida con los otros grupos. El sondeo lo refresca a lo sumo una vez
/// al día (`CatalogoOdbService`).
///
/// Tabla de G3. No tiene serie de ONT: es un catálogo de cajas.
model odb_smartolt {
  id_odb_smartolt Int      @id @default(autoincrement())
  id_empresa      Int
  /// Id del ODB en SmartOLT. Estable, a diferencia del nombre.
  id_externo      String   @db.VarChar(40)
  nombre          String   @db.VarChar(80)
  capacidad       Int?     @db.SmallInt
  zona            String?  @db.VarChar(80)
  actualizado_en  DateTime @default(now())

  empresa empresa @relation(fields: [id_empresa], references: [id_empresa])

  @@unique([id_empresa, id_externo])
}
```

- [ ] **Step 3: Escribir la migración**

`fsm/backend/prisma/migrations/20261113120000_puertos_caja_smartolt/migration.sql`:

```sql
-- Puertos por caja SmartOLT (ver docs/superpowers/specs/2026-11-12-puertos-caja-smartolt-design.md).
--
-- Aditiva: una columna nullable y una tabla nueva, sin tocar filas existentes.
-- IF NOT EXISTS por si se aplica sobre una base donde ya se corrio a mano (la
-- base global de la VPS la aplica el admin; `g3_app` no puede alterar el esquema).

-- AlterTable
ALTER TABLE "registro_ont" ADD COLUMN IF NOT EXISTS "odb_puerto" SMALLINT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "odb_smartolt" (
    "id_odb_smartolt" SERIAL NOT NULL,
    "id_empresa" INTEGER NOT NULL,
    "id_externo" VARCHAR(40) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "capacidad" SMALLINT,
    "zona" VARCHAR(80),
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "odb_smartolt_pkey" PRIMARY KEY ("id_odb_smartolt")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "odb_smartolt_id_empresa_id_externo_key" ON "odb_smartolt"("id_empresa", "id_externo");

-- AddForeignKey
ALTER TABLE "odb_smartolt" ADD CONSTRAINT "odb_smartolt_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresa"("id_empresa") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 4: Validar que el SQL calza con el esquema**

```bash
cd fsm/backend
S="$TMPDIR/schema-antes.prisma"   # o cualquier ruta temporal fuera del repo
git show HEAD:fsm/backend/prisma/schema.prisma > "$S"
npx prisma validate
npx prisma migrate diff --from-schema "$S" --to-schema prisma/schema.prisma --script
```

Expected: `validate` OK. El `diff` imprime las mismas cuatro sentencias de la migración (sin los `IF NOT EXISTS`). Si difiere un nombre de constraint o un tipo, corregir `migration.sql` para que calce.

- [ ] **Step 5: Regenerar el cliente y compilar**

```bash
npx prisma generate
npx tsc --noEmit -p tsconfig.json
```

Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add fsm/backend/prisma/schema.prisma fsm/backend/prisma/migrations/20261113120000_puertos_caja_smartolt
git commit -m "feat(monitoreo): registro_ont.odb_puerto y catálogo odb_smartolt"
```

---

### Task 2: La fuente lee `odb_port`

**Files:**
- Modify: `fsm/backend/src/monitoreo/fuente/fuente-monitoreo.ts` (interfaz `OntDetalle`)
- Modify: `fsm/backend/src/monitoreo/fuente/smartolt.client.ts` (`RawOnu`, `listarOntDetalles`, helper nuevo)
- Test: `fsm/backend/src/monitoreo/fuente/smartolt.client.spec.ts` (nuevo)

**Interfaces:**
- Produces: `OntDetalle.odb_puerto?: number | null` — `undefined` = la fuente no lo sabe; `null` = SmartOLT dice que no tiene; número entero ≥ 1 = puerto.

- [ ] **Step 1: Escribir la prueba que falla**

`fsm/backend/src/monitoreo/fuente/smartolt.client.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SmartOltClient } from './smartolt.client.js';

/**
 * `odb_port` es la posición de la ONT dentro de su caja. SmartOLT lo manda
 * como número o como texto, y vacío cuando el instalador no lo cargó (258 de
 * 940 ONT en la muestra del 28-09). Lo que no es un entero positivo no es un
 * puerto: se guarda null en vez de inventar uno.
 */
describe('SmartOltClient · puerto de la ONT en su caja', () => {
  const fetchOriginal = globalThis.fetch;
  let onus: unknown[];

  beforeEach(() => {
    globalThis.fetch = jest.fn(
      async () => new Response(JSON.stringify({ status: true, onus }), { status: 200 }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  const onu = (sn: string, odb_port: unknown) => ({
    sn,
    olt_id: '3',
    board: '12',
    port: '1',
    odb_name: 'NAP203',
    odb_port,
  });

  it('lee odb_port como número, venga como texto o como número', async () => {
    onus = [onu('A', '3'), onu('B', 5)];

    const d = await new SmartOltClient('https://smartolt.test', 'tok').listarOntDetalles();

    expect(d.map((o) => o.odb_puerto)).toEqual([3, 5]);
  });

  it('deja en null lo que no es un puerto valido', async () => {
    onus = [
      onu('A', ''),
      onu('B', null),
      onu('C', '0'),
      onu('D', 'abc'),
      onu('E', '2.5'),
      onu('F', '-1'),
      onu('G', undefined),
    ];

    const d = await new SmartOltClient('https://smartolt.test', 'tok').listarOntDetalles();

    expect(d.map((o) => o.odb_puerto)).toEqual([null, null, null, null, null, null, null]);
  });
});
```

- [ ] **Step 2: Correrla y ver que falla**

Run: `cd fsm/backend && npm test -- src/monitoreo/fuente/smartolt.client.spec.ts`
Expected: FAIL — `odb_puerto` es `undefined` en todas.

- [ ] **Step 3: Implementar**

En `fuente-monitoreo.ts`, dentro de `interface OntDetalle`, debajo de `odb: string | null;`:

```ts
  /**
   * Posición de la ONT dentro de su caja (SmartOLT `odb_port`).
   *
   * Opcional a propósito, y la diferencia importa: `undefined` es "esta fuente
   * no lo sabe" (CSV, mock) y no debe borrar un puerto ya guardado; `null` es
   * "SmartOLT dice que no tiene" y sí lo borra.
   */
  odb_puerto?: number | null;
```

En `smartolt.client.ts`, dentro de `interface RawOnu`, debajo de `odb_name?: string;`:

```ts
  odb_port?: number | string | null;
```

En `listarOntDetalles`, debajo de `odb: o.odb_name ?? null,`:

```ts
        odb_puerto: this.puertoDeCaja(o.odb_port),
```

Y el helper, junto a `num`:

```ts
  /** Un puerto de caja es un entero positivo; cualquier otra cosa no se sabe. */
  private puertoDeCaja(v: unknown): number | null {
    const n = this.num(v);
    return n != null && Number.isInteger(n) && n > 0 ? n : null;
  }
```

- [ ] **Step 4: Correr la prueba y ver que pasa**

Run: `npm test -- src/monitoreo/fuente/smartolt.client.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add fsm/backend/src/monitoreo/fuente/fuente-monitoreo.ts fsm/backend/src/monitoreo/fuente/smartolt.client.ts fsm/backend/src/monitoreo/fuente/smartolt.client.spec.ts
git commit -m "feat(monitoreo): la fuente SmartOLT lee el puerto de la ONT en su caja"
```

---

### Task 3: La ingesta guarda caja y puerto de todas las ONT

**Files:**
- Modify: `fsm/backend/src/monitoreo/registro-ont.service.ts` (método nuevo `sincronizarUbicacion`, `enriquecer` escribe `odb_puerto`)
- Modify: `fsm/backend/src/monitoreo/monitoreo.service.ts` (`ingestarLecturas`, `ResumenIngesta`)
- Test: `fsm/backend/src/monitoreo/registro-ont.service.spec.ts` (describe nuevo)
- Test: `fsm/backend/src/monitoreo/monitoreo.service.spec.ts` (mock y prueba nueva)

**Interfaces:**
- Consumes: `OntDetalle.odb_puerto?` (Task 2), `registro_ont.odb_puerto` (Task 1).
- Produces: `RegistroOntService.sincronizarUbicacion(detalles: OntDetalle[]): Promise<number>` (filas cambiadas); `ResumenIngesta.ubicaciones_actualizadas: number`.

- [ ] **Step 1: Escribir las pruebas de `sincronizarUbicacion`**

Al final de `registro-ont.service.spec.ts` (agregar `import type { OntDetalle } from './fuente/fuente-monitoreo.js';` arriba):

```ts
/**
 * La caja y el puerto de cada ONT se mantienen al dia en CADA sondeo. Antes el
 * censo solo se escribia para las ONT sin unidad: una ONT ya enriquecida nunca
 * se enteraba de que la cambiaron de caja, y nunca recibiria su puerto.
 */
describe('registro_ont · caja y puerto de cada ONT segun la fuente', () => {
  let service: RegistroOntService;
  let actuales: any[];
  const findMany = jest.fn(async (_a: unknown) => actuales);
  const update = jest.fn((a: unknown) => a);
  const $transaction = jest.fn(async (ops: unknown[]) => ops);

  const det = (sn: string, odb: string | null, odb_puerto?: number | null): OntDetalle => ({
    sn,
    id_externo: sn,
    olt_externo: '3',
    board: 12,
    puerto_pon: 1,
    zona: 'ZONA 6',
    odb,
    ...(odb_puerto === undefined ? {} : { odb_puerto }),
    nombre_cliente: null,
    direccion_cliente: null,
    modelo: null,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    actuales = [];
    const mod = await Test.createTestingModule({
      providers: [
        RegistroOntService,
        { provide: PrismaService, useValue: { registro_ont: { findMany, update }, $transaction } },
        { provide: ConfigService, useValue: { get: () => 1 } },
      ],
    }).compile();
    service = mod.get(RegistroOntService);
  });

  it('escribe solo las ONT cuya caja o puerto cambio', async () => {
    actuales = [
      { numero_serie: 'A', odb: 'NAP203', odb_puerto: 3 },
      { numero_serie: 'B', odb: 'NAP203', odb_puerto: null },
      { numero_serie: 'C', odb: 'NAP61', odb_puerto: 1 },
    ];

    const n = await service.sincronizarUbicacion([
      det('A', 'NAP203', 3),
      det('B', 'NAP203', 4),
      det('C', 'NAP62', 1),
    ]);

    expect(n).toBe(2);
    expect(update.mock.calls.map((c) => c[0])).toEqual([
      { where: { numero_serie: 'B' }, data: { odb_puerto: 4 } },
      { where: { numero_serie: 'C' }, data: { odb: 'NAP62' } },
    ]);
  });

  it('busca por empresa de la fuente y no filtra por unidad: alcanza a las ONT de G1', async () => {
    await service.sincronizarUbicacion([det('A', 'NAP203', 3)]);

    expect((findMany.mock.calls[0][0] as any).where).toEqual({
      numero_serie: { in: ['A'] },
      id_empresa: 1,
    });
  });

  it('borra el puerto cuando SmartOLT dice que ya no tiene', async () => {
    actuales = [{ numero_serie: 'A', odb: 'NAP203', odb_puerto: 3 }];

    await service.sincronizarUbicacion([det('A', 'NAP203', null)]);

    expect(update.mock.calls[0][0]).toEqual({ where: { numero_serie: 'A' }, data: { odb_puerto: null } });
  });

  it('no toca el puerto si la fuente no lo informa (CSV, mock)', async () => {
    actuales = [{ numero_serie: 'A', odb: 'NAP203', odb_puerto: 3 }];

    const n = await service.sincronizarUbicacion([det('A', 'NAP203')]);

    expect(n).toBe(0);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('ignora ONT del censo que no estan registradas', async () => {
    actuales = [];

    const n = await service.sincronizarUbicacion([det('Z', 'NAP1', 2)]);

    expect(n).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correrlas y ver que fallan**

Run: `npm test -- src/monitoreo/registro-ont.service.spec.ts`
Expected: FAIL — `service.sincronizarUbicacion is not a function`.

- [ ] **Step 3: Implementar `sincronizarUbicacion` y `odb_puerto` en `enriquecer`**

En `registro-ont.service.ts`, en el `upsert` de `enriquecer`, agregar a `create` y a `update`, debajo de `odb: d.odb,`:

```ts
          ...(d.odb_puerto !== undefined ? { odb_puerto: d.odb_puerto } : {}),
```

Y el método nuevo, después de `enriquecer`:

```ts
  /**
   * Mantiene al dia DONDE esta cada ONT segun la fuente: su caja (`odb`) y su
   * puerto en la caja (`odb_puerto`).
   *
   * Corre en cada sondeo y sobre TODAS las ONT del censo, no solo las que no
   * tienen unidad como `enriquecer`: si no, una ONT ya enlazada a G1 nunca se
   * enteraria de que la movieron de caja ni recibiria su puerto. Escribe solo
   * las filas que cambiaron, asi que en un sondeo normal no escribe nada.
   *
   * `odb_puerto` undefined es "la fuente no lo sabe" y no se toca; null es
   * "SmartOLT dice que no tiene" y se escribe.
   *
   * @returns cuantas ONT cambiaron.
   */
  async sincronizarUbicacion(detalles: OntDetalle[]): Promise<number> {
    if (detalles.length === 0) return 0;

    const actuales = await this.prisma.registro_ont.findMany({
      where: { numero_serie: { in: detalles.map((d) => d.sn) }, id_empresa: this.idEmpresaFuente },
      select: { numero_serie: true, odb: true, odb_puerto: true },
    });
    const porSn = new Map(actuales.map((r) => [r.numero_serie, r]));

    const cambios = [];
    for (const d of detalles) {
      const r = porSn.get(d.sn);
      if (!r) continue;
      const data: { odb?: string | null; odb_puerto?: number | null } = {};
      if (r.odb !== d.odb) data.odb = d.odb;
      if (d.odb_puerto !== undefined && r.odb_puerto !== d.odb_puerto) data.odb_puerto = d.odb_puerto;
      if (Object.keys(data).length > 0) {
        cambios.push(this.prisma.registro_ont.update({ where: { numero_serie: d.sn }, data }));
      }
    }

    if (cambios.length > 0) await this.prisma.$transaction(cambios);
    return cambios.length;
  }
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npm test -- src/monitoreo/registro-ont.service.spec.ts`
Expected: PASS (las existentes y las 5 nuevas).

- [ ] **Step 5: Prueba de la ingesta**

En `monitoreo.service.spec.ts`:

1. Agregar `import type { OntDetalle } from './fuente/fuente-monitoreo.js';` si no está.
2. A nivel del `describe('MonitoreoService.ingestarLecturas')`, junto a las otras `let`:

```ts
  let detalles: OntDetalle[];
  let fuenteMock: FuenteMonitoreo;
  let registroMock: any;
```

3. En el `beforeEach`, inicializar `detalles = [];`, cambiar `const fuenteMock: FuenteMonitoreo = {` por `fuenteMock = {`, su `listarOntDetalles` por `jest.fn(async () => detalles)`, cambiar `const registroMock = {` por `registroMock = {` y agregarle:

```ts
      sincronizarUbicacion: jest.fn(async () => 0),
```

4. Prueba nueva al final del describe:

```ts
  it('actualiza caja y puerto de todas las ONT del censo, con una sola consulta a la fuente', async () => {
    lecturas = [{ sn: 'SN-0001', potencia_rx_dbm: -21.5, estado: 'ONLINE', medido_en: MEDIDO }];
    detalles = [
      {
        sn: 'SN-0001', id_externo: '1', olt_externo: '3', board: 12, puerto_pon: 1,
        zona: 'ZONA 6', odb: 'NAP203', odb_puerto: 3,
        nombre_cliente: null, direccion_cliente: null, modelo: null,
      },
    ];

    await service.ingestarLecturas();

    expect(registroMock.sincronizarUbicacion).toHaveBeenCalledWith(detalles);
    expect(fuenteMock.listarOntDetalles).toHaveBeenCalledTimes(1);
    // El censo se pide junto con las lecturas, antes de tocar la base: si se
    // pidiera despues y la base tardara mas que la cache del cliente (10 s),
    // SmartOLT cobraria una segunda llamada de su cuota de 15 por hora.
    const pedidoCenso = (fuenteMock.listarOntDetalles as jest.Mock).mock.invocationCallOrder[0];
    const primeraBase = (registroMock.asegurarRegistros as jest.Mock).mock.invocationCallOrder[0];
    expect(pedidoCenso).toBeLessThan(primeraBase);
  });
```

(Si `MEDIDO` o la forma de `LecturaOnt` difieren en el archivo, usar las del propio archivo: la prueba existente `'mapea la lectura a monitoreo_ont…'` ya arma una lectura.)

- [ ] **Step 6: Correrla y ver que falla**

Run: `npm test -- src/monitoreo/monitoreo.service.spec.ts`
Expected: FAIL — `sincronizarUbicacion` no se llama.

- [ ] **Step 7: Implementar en `ingestarLecturas`**

En `monitoreo.service.ts`, en `interface ResumenIngesta`, debajo de `registros_enriquecidos: number;`:

```ts
  /** ONT a las que el censo les cambio la caja o el puerto en este sondeo. */
  ubicaciones_actualizadas: number;
```

Reemplazar el inicio de `ingestarLecturas`:

```ts
    const t0 = Date.now();
    const lecturas = await this.fuente.listarLecturas(filtro);
    const sns = lecturas.map((l) => l.sn);

    const registros = await this.registro.asegurarRegistros(sns);

    // Enriquecer (censo + cruce con unidad_equipo) solo si hay ONT que todavía
    // no tienen unidad resuelta — evita pegarle a la fuente en cada tick.
    let registros_enriquecidos = 0;
    const sinUnidad = sns.filter((sn) => registros.get(sn)?.id_unidad == null);
    if (sinUnidad.length > 0) {
      const detalles = await this.fuente.listarOntDetalles(filtro);
      registros_enriquecidos = await this.registro.enriquecer(
```

por:

```ts
    const t0 = Date.now();
    // El censo se pide JUNTO con las lecturas y antes de tocar la base.
    // SmartOltClient responde los dos con una sola llamada a
    // get_all_onus_details (la memoiza 10 s), que tiene cuota de 15 por hora;
    // pedirlo despues de las consultas a la base arriesgaba una segunda llamada
    // si la base tardaba. El censo hace falta en cada tick: de ahi sale la caja
    // y el puerto de cada ONT.
    const [lecturas, detalles] = await Promise.all([
      this.fuente.listarLecturas(filtro),
      this.fuente.listarOntDetalles(filtro),
    ]);
    const sns = lecturas.map((l) => l.sn);

    const registros = await this.registro.asegurarRegistros(sns);

    // Enriquecer (cruce con unidad_equipo) solo las ONT que todavía no tienen
    // unidad resuelta.
    let registros_enriquecidos = 0;
    const sinUnidad = sns.filter((sn) => registros.get(sn)?.id_unidad == null);
    if (sinUnidad.length > 0) {
      registros_enriquecidos = await this.registro.enriquecer(
```

(el resto del bloque `if` queda igual). Inmediatamente después del cierre de ese `if`, agregar:

```ts
    // Caja y puerto de TODAS las ONT, no solo las que se enriquecieron.
    const ubicaciones_actualizadas = await this.registro.sincronizarUbicacion(detalles);
```

Y en el objeto `resumen`, debajo de `registros_enriquecidos,`:

```ts
      ubicaciones_actualizadas,
```

- [ ] **Step 8: Correr las pruebas del módulo**

Run: `npm test -- src/monitoreo`
Expected: PASS todo. Si alguna prueba existente compara `resumen` con `toEqual`, agregarle `ubicaciones_actualizadas: 0`.

- [ ] **Step 9: Commit**

```bash
git add fsm/backend/src/monitoreo/registro-ont.service.ts fsm/backend/src/monitoreo/registro-ont.service.spec.ts fsm/backend/src/monitoreo/monitoreo.service.ts fsm/backend/src/monitoreo/monitoreo.service.spec.ts
git commit -m "feat(monitoreo): la ingesta mantiene al dia caja y puerto de cada ONT"
```

---

### Task 4: Catálogo de cajas — `CatalogoOdbService` y refresco diario en el sondeo

**Files:**
- Create: `fsm/backend/src/monitoreo/catalogo-odb.service.ts`
- Modify: `fsm/backend/src/monitoreo/monitoreo-poller.service.ts` (inyecta y llama al catálogo)
- Modify: `fsm/backend/src/monitoreo/monitoreo.module.ts` (provider)
- Test: `fsm/backend/src/monitoreo/catalogo-odb.service.spec.ts` (nuevo)

**Interfaces:**
- Consumes: `prisma.odb_smartolt` (Task 1), `FuenteMonitoreo.listarOdbs?(): Promise<OdbInfo[]>` (existe), `RegistroOntService.idEmpresaFuente: number` (existe).
- Produces: `CatalogoOdbService.refrescar(): Promise<ResumenCatalogo>`, `CatalogoOdbService.refrescarSiVencido(ahora?: Date): Promise<boolean>` (nunca lanza), `interface ResumenCatalogo { disponible: boolean; cajas: number }`, `const VIGENCIA_CATALOGO_MS = 86_400_000`.

- [ ] **Step 1: Escribir las pruebas**

`fsm/backend/src/monitoreo/catalogo-odb.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import { FUENTE_MONITOREO, type OdbInfo } from './fuente/fuente-monitoreo.js';
import { CatalogoOdbService, VIGENCIA_CATALOGO_MS } from './catalogo-odb.service.js';

/**
 * El catalogo de cajas de SmartOLT trae la capacidad (`nr_of_ports`), que el
 * censo de ONT no dice. Se guarda una copia y se refresca a lo sumo una vez al
 * dia: pedirlo al abrir cada caja gastaria la cuota de la API.
 */
describe('catalogo de cajas de SmartOLT', () => {
  let service: CatalogoOdbService;
  let odbs: OdbInfo[];
  let ultimo: { actualizado_en: Date } | null;
  let fuente: any;
  const upsert = jest.fn((a: unknown) => a);
  const findFirst = jest.fn(async (_a: unknown) => ultimo);
  const $transaction = jest.fn(async (ops: unknown[]) => ops);

  const odb = (id: string, nombre: string, capacidad: number | null): OdbInfo => ({
    id_externo: id, nombre, capacidad, zona: 'ZONA 6', lat: null, lon: null,
  });

  async function armar(conCatalogo = true) {
    fuente = { nombre: 'test', ...(conCatalogo ? { listarOdbs: jest.fn(async () => odbs) } : {}) };
    const mod = await Test.createTestingModule({
      providers: [
        CatalogoOdbService,
        { provide: PrismaService, useValue: { odb_smartolt: { upsert, findFirst }, $transaction } },
        // La empresa de la fuente es la 7: el catalogo es de ella, no de quien lo pida.
        { provide: RegistroOntService, useValue: { idEmpresaFuente: 7 } },
        { provide: FUENTE_MONITOREO, useValue: fuente },
      ],
    }).compile();
    service = mod.get(CatalogoOdbService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    odbs = [odb('11', 'NAP53', 16), odb('12', 'NAP203', 8)];
    ultimo = null;
    await armar();
  });

  it('guarda cada caja por id externo, bajo la empresa duena de la fuente', async () => {
    const r = await service.refrescar();

    expect(r).toEqual({ disponible: true, cajas: 2 });
    const primera = upsert.mock.calls[0][0] as any;
    expect(primera.where).toEqual({ id_empresa_id_externo: { id_empresa: 7, id_externo: '11' } });
    expect(primera.create).toMatchObject({ id_empresa: 7, id_externo: '11', nombre: 'NAP53', capacidad: 16 });
    expect(primera.update).toMatchObject({ nombre: 'NAP53', capacidad: 16 });
  });

  it('descarta entradas sin id o sin nombre', async () => {
    odbs = [odb('', 'NAP1', 8), odb('13', '', 8), odb('14', 'NAP2', 16)];

    const r = await service.refrescar();

    expect(r.cajas).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('no pide el catalogo si se refresco hace menos de 24 h', async () => {
    const ahora = new Date('2026-11-13T12:00:00Z');
    ultimo = { actualizado_en: new Date(ahora.getTime() - VIGENCIA_CATALOGO_MS + 60_000) };

    expect(await service.refrescarSiVencido(ahora)).toBe(false);
    expect(fuente.listarOdbs).not.toHaveBeenCalled();
    expect((findFirst.mock.calls[0][0] as any).where).toEqual({ id_empresa: 7 });
  });

  it('lo pide si el ultimo refresco tiene mas de 24 h, o si nunca se pidio', async () => {
    const ahora = new Date('2026-11-13T12:00:00Z');
    ultimo = { actualizado_en: new Date(ahora.getTime() - VIGENCIA_CATALOGO_MS - 60_000) };
    expect(await service.refrescarSiVencido(ahora)).toBe(true);

    ultimo = null;
    expect(await service.refrescarSiVencido(ahora)).toBe(true);
    expect(fuente.listarOdbs).toHaveBeenCalledTimes(2);
  });

  it('un fallo de SmartOLT no se propaga: el sondeo sigue', async () => {
    fuente.listarOdbs.mockRejectedValueOnce(new Error('HTTP 429'));

    await expect(service.refrescarSiVencido()).resolves.toBe(false);
  });

  it('con una fuente sin catalogo (CSV, mock) no hace nada', async () => {
    await armar(false);

    expect(await service.refrescar()).toEqual({ disponible: false, cajas: 0 });
    expect(await service.refrescarSiVencido()).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correrlas y ver que fallan**

Run: `npm test -- src/monitoreo/catalogo-odb.service.spec.ts`
Expected: FAIL — no existe `./catalogo-odb.service.js`.

- [ ] **Step 3: Implementar el servicio**

`fsm/backend/src/monitoreo/catalogo-odb.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import { FUENTE_MONITOREO, type FuenteMonitoreo } from './fuente/fuente-monitoreo.js';

/** Cada cuanto se vuelve a pedir el catalogo de cajas a la fuente. */
export const VIGENCIA_CATALOGO_MS = 24 * 3_600_000;

export interface ResumenCatalogo {
  /** False si la fuente no expone catalogo (CSV, mock). */
  disponible: boolean;
  /** Cajas que trajo la fuente y se guardaron. */
  cajas: number;
}

/**
 * Copia local del catalogo de cajas de SmartOLT (`odb_smartolt`).
 *
 * Existe por la capacidad: `nr_of_ports` no viene en el censo de ONT, y la
 * grilla de puertos la necesita cada vez que alguien abre una caja. Pedirla
 * en ese momento gastaria la cuota de la API, compartida con los otros
 * grupos; con la copia basta una llamada al dia.
 *
 * El catalogo es de la empresa duena de las credenciales de la fuente
 * (`idEmpresaFuente`), nunca de quien pida el refresco: si un ADMIN de otra
 * empresa lo dispara, igual se guarda donde corresponde.
 */
@Injectable()
export class CatalogoOdbService {
  private readonly logger = new Logger(CatalogoOdbService.name);

  constructor(
    private prisma: PrismaService,
    private registro: RegistroOntService,
    @Inject(FUENTE_MONITOREO) private fuente: FuenteMonitoreo,
  ) {}

  async refrescar(): Promise<ResumenCatalogo> {
    if (!this.fuente.listarOdbs) return { disponible: false, cajas: 0 };

    const id_empresa = this.registro.idEmpresaFuente;
    const odbs = (await this.fuente.listarOdbs()).filter((o) => o.id_externo && o.nombre);
    const ahora = new Date();

    await this.prisma.$transaction(
      odbs.map((o) =>
        this.prisma.odb_smartolt.upsert({
          where: { id_empresa_id_externo: { id_empresa, id_externo: o.id_externo } },
          create: {
            id_empresa,
            id_externo: o.id_externo,
            nombre: o.nombre,
            capacidad: o.capacidad,
            zona: o.zona,
            actualizado_en: ahora,
          },
          update: { nombre: o.nombre, capacidad: o.capacidad, zona: o.zona, actualizado_en: ahora },
        }),
      ),
    );

    this.logger.log(`Catalogo de cajas: ${odbs.length} cajas guardadas`);
    return { disponible: true, cajas: odbs.length };
  }

  /**
   * Refresca solo si el ultimo refresco tiene mas de `VIGENCIA_CATALOGO_MS`.
   * Lo llama el sondeo en cada tick. NUNCA lanza: un catalogo viejo es mejor
   * que un sondeo cortado.
   *
   * @returns true si refresco.
   */
  async refrescarSiVencido(ahora = new Date()): Promise<boolean> {
    if (!this.fuente.listarOdbs) return false;
    try {
      const ultimo = await this.prisma.odb_smartolt.findFirst({
        where: { id_empresa: this.registro.idEmpresaFuente },
        orderBy: { actualizado_en: 'desc' },
        select: { actualizado_en: true },
      });
      if (ultimo && ahora.getTime() - ultimo.actualizado_en.getTime() < VIGENCIA_CATALOGO_MS) {
        return false;
      }
      await this.refrescar();
      return true;
    } catch (e) {
      this.logger.error(`No se pudo refrescar el catalogo de cajas: ${(e as Error).message}`);
      return false;
    }
  }
}
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npm test -- src/monitoreo/catalogo-odb.service.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Engancharlo al sondeo y al módulo**

En `monitoreo-poller.service.ts`: importar `import { CatalogoOdbService } from './catalogo-odb.service.js';`, agregar `private catalogo: CatalogoOdbService,` al constructor, y en `tick()` reemplazar el bloque `try/catch/finally` por:

```ts
    try {
      await this.monitoreo.ingestarLecturas();
    } catch (e) {
      this.logger.error(`Fallo en la ingesta: ${(e as Error).message}`);
    }
    try {
      // Aparte de la ingesta: si una falla, la otra corre igual. No lanza (ver
      // CatalogoOdbService), el try es solo por defensa.
      await this.catalogo.refrescarSiVencido();
    } finally {
      this.corriendo = false;
    }
```

En `monitoreo.module.ts`: importar `CatalogoOdbService` y agregarlo a `providers` después de `CapacidadCajasService`.

- [ ] **Step 6: Compilar y correr el módulo**

```bash
npx tsc --noEmit -p tsconfig.json
npm test -- src/monitoreo
```

Expected: sin errores, todo PASS.

- [ ] **Step 7: Commit**

```bash
git add fsm/backend/src/monitoreo/catalogo-odb.service.ts fsm/backend/src/monitoreo/catalogo-odb.service.spec.ts fsm/backend/src/monitoreo/monitoreo-poller.service.ts fsm/backend/src/monitoreo/monitoreo.module.ts
git commit -m "feat(monitoreo): copia diaria del catálogo de cajas de SmartOLT"
```

---

### Task 5: La grilla de una caja (funciones puras)

**Files:**
- Create: `fsm/backend/src/monitoreo/cajas-smartolt.ts`
- Modify: `fsm/backend/src/monitoreo/reglas-alerta.ts` (`EstadoOnt.odb_puerto?`)
- Modify: `fsm/backend/src/monitoreo/capacidad-cajas.service.ts` (usa `claveEstrictaNombre` en vez de su `clave` local)
- Modify: `fsm/backend/src/monitoreo/alertas.service.ts` (usa `masFrecuente` y `cabeceraDeCaja` del módulo nuevo; borra su `masFrecuente` local)
- Test: `fsm/backend/src/monitoreo/cajas-smartolt.spec.ts` (nuevo)

**Interfaces:**
- Consumes: `EstadoOnt`, `esInactiva` de `reglas-alerta.ts`.
- Produces:

```ts
export function claveEstrictaNombre(nombre: string | null): string | null;
export function porFrecuencia(valores: (string | null)[]): string[];
export function masFrecuente(valores: (string | null)[]): string | null;
export function cabeceraDeCaja(clave: string, miembros: EstadoOnt[]): CabeceraCaja;
export function capacidadEstimada(maxPuerto: number): number;
export function resolverCapacidad(grafias: string[], catalogo: EntradaCatalogo[]): number | null;
export function armarGrilla(onts: EstadoOnt[], catalogo: EntradaCatalogo[], ahora: Date): GrillaDeCaja;
export interface CabeceraCaja { clave: string; nombre: string; olt_externo: string | null; board: number | null; puerto_pon: number | null; zona: string | null }
export interface EntradaCatalogo { nombre: string; capacidad: number | null }
export interface OntDePuerto { numero_serie: string; nombre_cliente: string | null; estado_conexion: string | null; potencia_dbm: number | null; posible_baja: boolean }
export interface PuertoDeCaja { numero: number; estado: 'OCUPADO' | 'SIN_REGISTRO'; conflicto: boolean; onts: OntDePuerto[] }
export interface GrillaDeCaja { capacidad: number; capacidad_estimada: boolean; ocupados: number; puertos: PuertoDeCaja[]; fuera_de_rango: (OntDePuerto & { odb_puerto: number })[]; sin_puerto: OntDePuerto[] }
```

- [ ] **Step 1: Escribir las pruebas**

`fsm/backend/src/monitoreo/cajas-smartolt.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';
import type { EstadoOnt } from './reglas-alerta.js';
import { armarGrilla, cabeceraDeCaja, capacidadEstimada, masFrecuente } from './cajas-smartolt.js';

const AHORA = new Date('2026-11-13T12:00:00Z');
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);

const ont = (sn: string, odb: string, odb_puerto: number | null, extra: Partial<EstadoOnt> = {}): EstadoOnt => ({
  id_registro_ont: 1,
  numero_serie: sn,
  id_cliente: null,
  id_caja_nap: null,
  olt_externo: '2',
  board: 1,
  puerto_pon: 7,
  caja_normalizada: 'NAP 53',
  estado_conexion: 'ONLINE',
  potencia_dbm: -21,
  sin_senal_desde: null,
  odb,
  odb_puerto,
  zona: 'ZONA 6',
  nombre_cliente: `Cliente ${sn}`,
  ...extra,
});

describe('grilla de puertos de una caja SmartOLT', () => {
  it('usa la capacidad del catalogo y pone cada ONT en su puerto', () => {
    const g = armarGrilla(
      [ont('A', 'NAP53', 1), ont('B', 'NAP53', 3)],
      [{ nombre: 'NAP53', capacidad: 16 }],
      AHORA,
    );

    expect(g).toMatchObject({ capacidad: 16, capacidad_estimada: false, ocupados: 2 });
    expect(g.puertos).toHaveLength(16);
    expect(g.puertos[2]).toMatchObject({ numero: 3, estado: 'OCUPADO', conflicto: false });
    expect(g.puertos[2].onts[0]).toEqual({
      numero_serie: 'B', nombre_cliente: 'Cliente B', estado_conexion: 'ONLINE', potencia_dbm: -21, posible_baja: false,
    });
    expect(g.puertos[1]).toMatchObject({ numero: 2, estado: 'SIN_REGISTRO', onts: [] });
  });

  it('busca en el catalogo primero la grafia mas usada', () => {
    const g = armarGrilla(
      [ont('A', 'NAP 53', 1), ont('B', 'NAP 53', 2), ont('C', 'NAP53', 3)],
      [{ nombre: 'NAP 53', capacidad: 8 }, { nombre: 'NAP53', capacidad: 16 }],
      AHORA,
    );

    expect(g.capacidad).toBe(8);
  });

  it('si la grafia mas usada no esta en el catalogo, prueba las demas', () => {
    const g = armarGrilla(
      [ont('A', 'NAP 53', 1), ont('B', 'NAP 53', 2), ont('C', 'NAP53', 3)],
      [{ nombre: 'nap53 ', capacidad: 16 }],
      AHORA,
    );

    expect(g).toMatchObject({ capacidad: 16, capacidad_estimada: false });
  });

  it('sin catalogo estima 8 o 16 segun el puerto mas alto ocupado', () => {
    expect(armarGrilla([ont('A', 'NAP53', 5)], [], AHORA)).toMatchObject({ capacidad: 8, capacidad_estimada: true });
    expect(armarGrilla([ont('A', 'NAP53', 11)], [], AHORA)).toMatchObject({ capacidad: 16, capacidad_estimada: true });
    expect(armarGrilla([ont('A', 'NAP53', null)], [], AHORA)).toMatchObject({ capacidad: 8, capacidad_estimada: true });
    expect(capacidadEstimada(20)).toBe(20);
  });

  it('homonimas del catalogo con capacidades distintas: no adivina, estima', () => {
    const g = armarGrilla(
      [ont('A', 'NAP53', 2)],
      [{ nombre: 'NAP53', capacidad: 8 }, { nombre: 'NAP53', capacidad: 16 }],
      AHORA,
    );

    expect(g).toMatchObject({ capacidad: 8, capacidad_estimada: true });
  });

  it('dos ONT en el mismo puerto: ocupado, con conflicto, y cuenta una vez', () => {
    const g = armarGrilla([ont('A', 'NAP53', 2), ont('B', 'NAP53', 2)], [{ nombre: 'NAP53', capacidad: 8 }], AHORA);

    expect(g.puertos[1]).toMatchObject({ estado: 'OCUPADO', conflicto: true });
    expect(g.puertos[1].onts.map((o) => o.numero_serie)).toEqual(['A', 'B']);
    expect(g.ocupados).toBe(1);
  });

  it('una ONT en un puerto mayor a la capacidad va a fuera de rango', () => {
    const g = armarGrilla([ont('A', 'NAP53', 12)], [{ nombre: 'NAP53', capacidad: 8 }], AHORA);

    expect(g.puertos).toHaveLength(8);
    expect(g.ocupados).toBe(0);
    expect(g.fuera_de_rango).toEqual([expect.objectContaining({ numero_serie: 'A', odb_puerto: 12 })]);
  });

  it('las ONT sin puerto (null o 0) se listan aparte', () => {
    const g = armarGrilla([ont('A', 'NAP53', null), ont('B', 'NAP53', 0), ont('C', 'NAP53', 1)], [], AHORA);

    expect(g.sin_puerto.map((o) => o.numero_serie)).toEqual(['A', 'B']);
    expect(g.ocupados).toBe(1);
  });

  it('un equipo dado de baja sigue ocupando su puerto, marcado como posible baja', () => {
    const g = armarGrilla(
      [ont('A', 'NAP53', 4, { estado_conexion: 'OFFLINE', sin_senal_desde: hace(200), potencia_dbm: null })],
      [],
      AHORA,
    );

    expect(g.puertos[3]).toMatchObject({ estado: 'OCUPADO' });
    expect(g.puertos[3].onts[0].posible_baja).toBe(true);
  });
});

describe('cabecera de una caja SmartOLT', () => {
  it('muestra la grafia y la zona mas usadas, y el puerto PON', () => {
    const c = cabeceraDeCaja('2/1/7|NAP 53', [
      ont('A', 'NAP53', 1, { zona: 'ZONA 6' }),
      ont('B', 'NAP53', 2, { zona: 'ZONA  6' }),
      ont('C', 'NAP 53', 3, { zona: 'ZONA 5' }),
    ]);

    expect(c).toEqual({
      clave: '2/1/7|NAP 53', nombre: 'NAP53', olt_externo: '2', board: 1, puerto_pon: 7, zona: 'ZONA 6',
    });
  });

  it('a igual cantidad gana la que aparecio primero', () => {
    expect(masFrecuente(['B', 'A', 'A', 'B', null])).toBe('B');
    expect(masFrecuente([null, null])).toBeNull();
  });
});
```

- [ ] **Step 2: Correrlas y ver que fallan**

Run: `npm test -- src/monitoreo/cajas-smartolt.spec.ts`
Expected: FAIL — no existe `./cajas-smartolt.js` (y `odb_puerto` no está en `EstadoOnt`).

- [ ] **Step 3: Agregar `odb_puerto` a `EstadoOnt`**

En `reglas-alerta.ts`, dentro del bloque de campos opcionales de `EstadoOnt` (debajo de `odb?: string | null;`):

```ts
  /** Puerto de la ONT en su caja (SmartOLT `odb_port`). */
  odb_puerto?: number | null;
```

- [ ] **Step 4: Crear `cajas-smartolt.ts`**

```ts
import { esInactiva, type EstadoOnt } from './reglas-alerta.js';

/**
 * Cajas NAP segun SmartOLT: la identidad es la misma clave que usa el motor de
 * alertas (`claveDeCaja`: puerto PON + nombre normalizado), no la caja del KML
 * de Tomodat. Aca vive lo que se puede calcular sin base: la cabecera de una
 * caja y su grilla de puertos.
 */

/**
 * Trim, mayusculas y espacios colapsados. Nada mas, y es a proposito.
 *
 * NO se usa `normalizarNombreCaja`, que es el del ligado. Aquel es tolerante
 * por diseño --parte letra/digito y quita ceros a la izquierda-- porque cruza
 * dos sistemas distintos: nombres que escribieron los instaladores en SmartOLT
 * contra los del KML de Tomodat. Aca los dos lados son cadenas del MISMO
 * sistema, el `odb` del censo contra el `name` del catalogo, asi que no hay
 * nada que tolerar.
 *
 * Y tolerar de mas haria daño: `NAP 7`, `NAP-07` y `NAP07` colapsan a la misma
 * clave con aquel normalizador, y en SmartOLT son TRES cajas distintas, en tres
 * zonas y tres puertos PON distintos. Darles la capacidad de la equivocada crea
 * puertos que no existen.
 */
export function claveEstrictaNombre(nombre: string | null): string | null {
  const s = (nombre ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

/** Valores no nulos, del mas usado al menos usado; a igual cantidad, el que aparecio primero. */
export function porFrecuencia(valores: (string | null)[]): string[] {
  const cuenta = new Map<string, number>();
  for (const v of valores) if (v != null) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  // Array.prototype.sort es estable: a igual cantidad conserva el orden de insercion.
  return [...cuenta].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

/** El valor no nulo que mas se repite. Null si no hay ninguno. */
export function masFrecuente(valores: (string | null)[]): string | null {
  return porFrecuencia(valores)[0] ?? null;
}

export interface CabeceraCaja {
  /** `olt/placa/puerto|NOMBRE NORMALIZADO`. */
  clave: string;
  /** Nombre tal como lo escribieron los instaladores en SmartOLT. */
  nombre: string;
  olt_externo: string | null;
  board: number | null;
  puerto_pon: number | null;
  /** Zona de SmartOLT, la mas frecuente entre las ONT de la caja. */
  zona: string | null;
}

/**
 * Como se presenta una caja. Las grafias de una misma caja conviven ("NAP53" y
 * "NAP 53" en el mismo splitter): se muestra la mas usada, que es la que el
 * tecnico va a buscar en SmartOLT.
 */
export function cabeceraDeCaja(clave: string, miembros: EstadoOnt[]): CabeceraCaja {
  const primera = miembros[0];
  return {
    clave,
    nombre: masFrecuente(miembros.map((o) => o.odb?.trim() || null)) ?? primera.caja_normalizada ?? clave,
    olt_externo: primera.olt_externo,
    board: primera.board,
    puerto_pon: primera.puerto_pon,
    zona: masFrecuente(miembros.map((o) => o.zona?.replace(/\s+/g, ' ').trim() || null)),
  };
}

export interface EntradaCatalogo {
  nombre: string;
  capacidad: number | null;
}

export interface OntDePuerto {
  numero_serie: string;
  nombre_cliente: string | null;
  estado_conexion: string | null;
  potencia_dbm: number | null;
  /** Caida hace mas de DIAS_MAX_INCIDENTE: probablemente un cliente dado de baja. */
  posible_baja: boolean;
}

export interface PuertoDeCaja {
  numero: number;
  /** Sin registro NO es libre: la caja es del poste y la comparten operadores. */
  estado: 'OCUPADO' | 'SIN_REGISTRO';
  /** Dos o mas ONT dicen estar en este puerto. */
  conflicto: boolean;
  onts: OntDePuerto[];
}

export interface GrillaDeCaja {
  capacidad: number;
  /** True si la capacidad no salio del catalogo y se estimo por los puertos usados. */
  capacidad_estimada: boolean;
  /** Puertos con al menos una ONT. */
  ocupados: number;
  puertos: PuertoDeCaja[];
  /** ONT cuyo puerto es mayor que la capacidad de la caja. */
  fuera_de_rango: (OntDePuerto & { odb_puerto: number })[];
  /** ONT de la caja sin puerto en SmartOLT. */
  sin_puerto: OntDePuerto[];
}

/** Los divisores de FiNet son de 8 o de 16; mas alla, lo que diga el puerto. */
export function capacidadEstimada(maxPuerto: number): number {
  if (maxPuerto <= 8) return 8;
  if (maxPuerto <= 16) return 16;
  return maxPuerto;
}

/**
 * Capacidad de la caja segun el catalogo. Prueba las grafias en el orden dado
 * (la mas usada primero) y se queda con la primera que calce. Si calzan varias
 * entradas homonimas con capacidades distintas no adivina: devuelve null.
 */
export function resolverCapacidad(grafias: string[], catalogo: EntradaCatalogo[]): number | null {
  for (const g of grafias) {
    const k = claveEstrictaNombre(g);
    if (!k) continue;
    const calzan = catalogo.filter((c) => claveEstrictaNombre(c.nombre) === k);
    if (calzan.length === 0) continue;
    const capacidades = new Set(calzan.map((c) => c.capacidad));
    if (capacidades.size !== 1) return null;
    const [cap] = capacidades;
    return cap != null && cap > 0 ? cap : null;
  }
  return null;
}

const tienePuerto = (o: EstadoOnt): o is EstadoOnt & { odb_puerto: number } =>
  o.odb_puerto != null && o.odb_puerto > 0;

/** Grilla de puertos de una caja a partir de sus ONT y del catalogo. */
export function armarGrilla(onts: EstadoOnt[], catalogo: EntradaCatalogo[], ahora: Date): GrillaDeCaja {
  const aPuerto = (o: EstadoOnt): OntDePuerto => ({
    numero_serie: o.numero_serie,
    nombre_cliente: o.nombre_cliente ?? null,
    estado_conexion: o.estado_conexion,
    potencia_dbm: o.potencia_dbm,
    posible_baja: esInactiva(o, ahora),
  });

  const conPuerto = onts.filter(tienePuerto);
  const maxPuerto = conPuerto.reduce((m, o) => Math.max(m, o.odb_puerto), 0);
  const delCatalogo = resolverCapacidad(porFrecuencia(onts.map((o) => o.odb?.trim() || null)), catalogo);
  const capacidad = delCatalogo ?? capacidadEstimada(maxPuerto);

  const porNumero = new Map<number, OntDePuerto[]>();
  const fuera_de_rango: (OntDePuerto & { odb_puerto: number })[] = [];
  for (const o of conPuerto) {
    if (o.odb_puerto > capacidad) {
      fuera_de_rango.push({ ...aPuerto(o), odb_puerto: o.odb_puerto });
      continue;
    }
    const lista = porNumero.get(o.odb_puerto);
    if (lista) lista.push(aPuerto(o));
    else porNumero.set(o.odb_puerto, [aPuerto(o)]);
  }

  const puertos: PuertoDeCaja[] = Array.from({ length: capacidad }, (_, i) => {
    const lista = porNumero.get(i + 1) ?? [];
    return {
      numero: i + 1,
      estado: lista.length > 0 ? 'OCUPADO' : 'SIN_REGISTRO',
      conflicto: lista.length > 1,
      onts: lista,
    };
  });

  return {
    capacidad,
    capacidad_estimada: delCatalogo == null,
    ocupados: puertos.filter((p) => p.estado === 'OCUPADO').length,
    puertos,
    fuera_de_rango,
    sin_puerto: onts.filter((o) => !tienePuerto(o)).map(aPuerto),
  };
}
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `npm test -- src/monitoreo/cajas-smartolt.spec.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Reusar desde `capacidad-cajas` y `alertas`**

En `capacidad-cajas.service.ts`: borrar la función local `clave` y su comentario (el comentario se mudó a `claveEstrictaNombre`), agregar `import { claveEstrictaNombre as clave } from './cajas-smartolt.js';`.

En `alertas.service.ts`:
- Agregar `import { cabeceraDeCaja } from './cajas-smartolt.js';`.
- Borrar la función `masFrecuente` del final del archivo.
- En `criticosPorCaja`, dentro del `.map(([clave, miembros]) => { ... })`, reemplazar las líneas de `nombre`, `olt_externo`, `board`, `puerto_pon` y `zona` (y el comentario de la grafía) por `...cabeceraDeCaja(clave, miembros),` y borrar la línea `clave,` y `const primera = miembros[0];` que quedan sin uso.

- [ ] **Step 7: Correr el módulo completo**

Run: `npx tsc --noEmit -p tsconfig.json && npm test -- src/monitoreo`
Expected: sin errores; `criticos-por-caja.spec.ts` y `capacidad-cajas.service.spec.ts` siguen pasando.

- [ ] **Step 8: Commit**

```bash
git add fsm/backend/src/monitoreo/cajas-smartolt.ts fsm/backend/src/monitoreo/cajas-smartolt.spec.ts fsm/backend/src/monitoreo/reglas-alerta.ts fsm/backend/src/monitoreo/capacidad-cajas.service.ts fsm/backend/src/monitoreo/alertas.service.ts
git commit -m "feat(monitoreo): grilla de puertos de una caja SmartOLT"
```

---

### Task 6: `CajasSmartoltService` — lista y detalle por empresa

**Files:**
- Create: `fsm/backend/src/monitoreo/cajas-smartolt.service.ts`
- Modify: `fsm/backend/src/monitoreo/alertas.service.ts` (`cargarEstado` público y con `odb_puerto`)
- Test: `fsm/backend/src/monitoreo/cajas-smartolt.service.spec.ts` (nuevo)

**Interfaces:**
- Consumes: `armarGrilla`, `cabeceraDeCaja`, `GrillaDeCaja`, `CabeceraCaja` (Task 5); `claveDeCaja` de `reglas-alerta.ts`; `prisma.odb_smartolt` (Task 1).
- Produces:

```ts
AlertasService.cargarEstado(id_empresa: number): Promise<EstadoOnt[]>   // ahora público
export interface ResumenCajaSmartolt extends CabeceraCaja { capacidad: number; capacidad_estimada: boolean; ocupados: number; ont_total: number; sin_puerto: number }
export type DetalleCajaSmartolt = CabeceraCaja & GrillaDeCaja;
CajasSmartoltService.listar(id_empresa: number, zona?: string): Promise<ResumenCajaSmartolt[]>
CajasSmartoltService.detalle(id_empresa: number, clave: string): Promise<DetalleCajaSmartolt>  // NotFoundException si no existe
```

- [ ] **Step 1: Escribir las pruebas**

`fsm/backend/src/monitoreo/cajas-smartolt.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertasService } from './alertas.service.js';
import { CajasSmartoltService } from './cajas-smartolt.service.js';
import type { EstadoOnt } from './reglas-alerta.js';

describe('cajas SmartOLT · lista y detalle', () => {
  let service: CajasSmartoltService;
  let onts: EstadoOnt[];
  let catalogo: { nombre: string; capacidad: number | null }[];
  const cargarEstado = jest.fn(async (_id: number) => onts);
  const findMany = jest.fn(async (_a: unknown) => catalogo);

  const ont = (sn: string, odb: string | null, puerto: number | null, extra: Partial<EstadoOnt> = {}): EstadoOnt => ({
    id_registro_ont: 1,
    numero_serie: sn,
    id_cliente: null,
    id_caja_nap: null,
    olt_externo: '2',
    board: 1,
    puerto_pon: 7,
    caja_normalizada: odb ? odb.toUpperCase().replace(/([A-Z])(\d)/g, '$1 $2') : null,
    estado_conexion: 'ONLINE',
    potencia_dbm: -21,
    sin_senal_desde: null,
    odb,
    odb_puerto: puerto,
    zona: 'ZONA 6',
    nombre_cliente: null,
    ...extra,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    onts = [];
    catalogo = [];
    const mod = await Test.createTestingModule({
      providers: [
        CajasSmartoltService,
        { provide: AlertasService, useValue: { cargarEstado } },
        { provide: PrismaService, useValue: { odb_smartolt: { findMany } } },
      ],
    }).compile();
    service = mod.get(CajasSmartoltService);
  });

  it('lee las ONT y el catalogo SOLO de la empresa pedida', async () => {
    await service.listar(5);

    expect(cargarEstado).toHaveBeenCalledWith(5);
    expect((findMany.mock.calls[0][0] as any).where).toEqual({ id_empresa: 5 });
  });

  it('una fila por caja, con su ocupacion', async () => {
    onts = [ont('A', 'NAP53', 1), ont('B', 'NAP53', 3), ont('C', 'NAP53', null), ont('D', 'NAP61', 2)];
    catalogo = [{ nombre: 'NAP53', capacidad: 16 }];

    const r = await service.listar(1);

    expect(r).toEqual([
      expect.objectContaining({
        clave: '2/1/7|NAP 53', nombre: 'NAP53', capacidad: 16, capacidad_estimada: false,
        ocupados: 2, ont_total: 3, sin_puerto: 1,
      }),
      expect.objectContaining({ nombre: 'NAP61', capacidad: 8, capacidad_estimada: true, ocupados: 1 }),
    ]);
  });

  it('las ONT sin nombre de caja no forman caja', async () => {
    onts = [ont('A', null, 1)];

    expect(await service.listar(1)).toEqual([]);
  });

  it('filtra por zona y ordena por zona y nombre (NAP 9 antes que NAP 10)', async () => {
    onts = [
      ont('A', 'NAP10', 1, { puerto_pon: 1 }),
      ont('B', 'NAP9', 1, { puerto_pon: 2 }),
      ont('C', 'NAP1', 1, { puerto_pon: 3, zona: 'ZONA 3' }),
    ];

    expect((await service.listar(1)).map((c) => c.nombre)).toEqual(['NAP1', 'NAP9', 'NAP10']);
    expect((await service.listar(1, 'zona 6')).map((c) => c.nombre)).toEqual(['NAP9', 'NAP10']);
  });

  it('el detalle encuentra la caja por su clave literal, con espacios, barras y pipe', async () => {
    onts = [ont('A', 'NAP53', 3)];

    const d = await service.detalle(1, '2/1/7|NAP 53');

    expect(d).toMatchObject({ clave: '2/1/7|NAP 53', nombre: 'NAP53', ocupados: 1 });
    expect(d.puertos[2].onts[0].numero_serie).toBe('A');
  });

  it('una clave que no existe en la empresa es 404', async () => {
    onts = [ont('A', 'NAP53', 3)];

    await expect(service.detalle(1, '2/1/7|NAP 99')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Correrlas y ver que fallan**

Run: `npm test -- src/monitoreo/cajas-smartolt.service.spec.ts`
Expected: FAIL — no existe `./cajas-smartolt.service.js`.

- [ ] **Step 3: `cargarEstado` público y con `odb_puerto`**

En `alertas.service.ts`:
- Cambiar `private async cargarEstado(` por `async cargarEstado(` y sumarle un comentario de una línea: `/** Estado de cada ONT de la empresa con su ultima lectura. Lo usan el motor, el panel y las cajas SmartOLT. */`.
- En el tipo genérico de `$queryRaw`, debajo de `odb: string | null;`: `odb_puerto: number | null;`.
- En el `SELECT`, cambiar `r.odb, r.zona,` por `r.odb, r.odb_puerto, r.zona,`.
- En el `map` final, debajo de `odb: f.odb,`: `odb_puerto: f.odb_puerto,`.

- [ ] **Step 4: Crear el servicio**

`fsm/backend/src/monitoreo/cajas-smartolt.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertasService } from './alertas.service.js';
import { claveDeCaja, type EstadoOnt } from './reglas-alerta.js';
import {
  armarGrilla,
  cabeceraDeCaja,
  type CabeceraCaja,
  type EntradaCatalogo,
  type GrillaDeCaja,
} from './cajas-smartolt.js';

export interface ResumenCajaSmartolt extends CabeceraCaja {
  capacidad: number;
  capacidad_estimada: boolean;
  ocupados: number;
  /** ONT de la caja, con y sin puerto. */
  ont_total: number;
  /** ONT de la caja sin puerto en SmartOLT. */
  sin_puerto: number;
}

export type DetalleCajaSmartolt = CabeceraCaja & GrillaDeCaja;

/**
 * Cajas NAP tal como las conoce SmartOLT, con la ocupacion de sus puertos.
 *
 * Usa `cargarEstado`, el mismo lector del motor de alertas y del panel de
 * criticos, y la misma clave de caja: las tres vistas hablan de las mismas
 * cajas. A diferencia del panel, NO saca las bajas: un equipo dado de baja
 * sigue enchufado a su puerto hasta que alguien lo retira.
 */
@Injectable()
export class CajasSmartoltService {
  constructor(
    private prisma: PrismaService,
    private alertas: AlertasService,
  ) {}

  private async cargar(id_empresa: number) {
    const [onts, catalogo] = await Promise.all([
      this.alertas.cargarEstado(id_empresa),
      this.prisma.odb_smartolt.findMany({
        where: { id_empresa },
        select: { nombre: true, capacidad: true },
      }) as Promise<EntradaCatalogo[]>,
    ]);
    const grupos = new Map<string, EstadoOnt[]>();
    for (const o of onts) {
      const k = claveDeCaja(o);
      if (!k) continue;
      const lista = grupos.get(k);
      if (lista) lista.push(o);
      else grupos.set(k, [o]);
    }
    return { grupos, catalogo };
  }

  async listar(id_empresa: number, zona?: string): Promise<ResumenCajaSmartolt[]> {
    const ahora = new Date();
    const { grupos, catalogo } = await this.cargar(id_empresa);
    const z = zona?.trim().toLowerCase();
    return [...grupos]
      .map(([clave, miembros]) => {
        const g = armarGrilla(miembros, catalogo, ahora);
        return {
          ...cabeceraDeCaja(clave, miembros),
          capacidad: g.capacidad,
          capacidad_estimada: g.capacidad_estimada,
          ocupados: g.ocupados,
          ont_total: miembros.length,
          sin_puerto: g.sin_puerto.length,
        };
      })
      .filter((c) => !z || (c.zona ?? '').toLowerCase().includes(z))
      // `numeric` para que "NAP 9" vaya antes que "NAP 10".
      .sort(
        (a, b) =>
          (a.zona ?? '~').localeCompare(b.zona ?? '~', 'es', { numeric: true }) ||
          a.nombre.localeCompare(b.nombre, 'es', { numeric: true }),
      );
  }

  async detalle(id_empresa: number, clave: string): Promise<DetalleCajaSmartolt> {
    const { grupos, catalogo } = await this.cargar(id_empresa);
    const miembros = grupos.get(clave);
    if (!miembros) throw new NotFoundException(`Caja ${clave} no encontrada`);
    return { ...cabeceraDeCaja(clave, miembros), ...armarGrilla(miembros, catalogo, new Date()) };
  }
}
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `npm test -- src/monitoreo/cajas-smartolt.service.spec.ts`
Expected: PASS (6 tests). Si el orden de "ZONA 3" vs "ZONA 6" sale invertido, revisar que la comparación de zona vaya antes que la de nombre.

- [ ] **Step 6: Commit**

```bash
git add fsm/backend/src/monitoreo/cajas-smartolt.service.ts fsm/backend/src/monitoreo/cajas-smartolt.service.spec.ts fsm/backend/src/monitoreo/alertas.service.ts
git commit -m "feat(monitoreo): lista y detalle de cajas SmartOLT por empresa"
```

---

### Task 7: Endpoints

**Files:**
- Modify: `fsm/backend/src/monitoreo/monitoreo.controller.ts`
- Modify: `fsm/backend/src/monitoreo/monitoreo.module.ts`

**Interfaces:**
- Consumes: `CajasSmartoltService.listar/detalle` (Task 6), `CatalogoOdbService.refrescar` (Task 4).
- Produces: `GET /api/monitoreo/cajas-smartolt?zona=&empresa=`, `GET /api/monitoreo/cajas-smartolt/detalle?clave=&empresa=`, `POST /api/monitoreo/catalogo-odb`.

- [ ] **Step 1: Agregar los endpoints**

En `monitoreo.controller.ts`: importar `BadRequestException` desde `@nestjs/common`, `CajasSmartoltService` y `CatalogoOdbService`; agregar `private cajas: CajasSmartoltService,` y `private catalogo: CatalogoOdbService,` al constructor. Después del endpoint `criticos-por-caja`:

```ts
  /**
   * Todas las cajas NAP de SmartOLT con la ocupacion de sus puertos.
   * La caja es la misma del panel de criticos (puerto PON + nombre).
   */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('cajas-smartolt')
  cajasSmartolt(
    @CurrentUser() user: UserPayload,
    @Query('zona') zona?: string,
    @Query('empresa') empresa?: string,
  ) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.cajas.listar(id, zona);
  }

  /**
   * Grilla de puertos de una caja. La clave va en la query y no en la ruta:
   * lleva espacios, "/" y "|" ("2/1/7|NAP 53"), que no sobreviven como
   * segmento de URL.
   */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('cajas-smartolt/detalle')
  cajaSmartolt(
    @CurrentUser() user: UserPayload,
    @Query('clave') clave?: string,
    @Query('empresa') empresa?: string,
  ) {
    if (!clave) throw new BadRequestException('Falta la clave de la caja');
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.cajas.detalle(id, clave);
  }
```

Y junto a `capacidad-cajas`:

```ts
  /**
   * Refresca ya la copia del catalogo de cajas de SmartOLT (el sondeo lo hace
   * solo una vez al dia). Se guarda bajo la empresa duena de la fuente.
   */
  @Roles('ADMIN')
  @Post('catalogo-odb')
  catalogoOdb() {
    return this.catalogo.refrescar();
  }
```

En `monitoreo.module.ts`: importar `CajasSmartoltService` y agregarlo a `providers` (después de `CatalogoOdbService`).

- [ ] **Step 2: Compilar y correr todo el backend**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: sin errores; todas las suites PASS.

- [ ] **Step 3: Commit**

```bash
git add fsm/backend/src/monitoreo/monitoreo.controller.ts fsm/backend/src/monitoreo/monitoreo.module.ts
git commit -m "feat(monitoreo): endpoints de cajas SmartOLT y del catálogo"
```

---

### Task 8: Frontend — API y pestaña "Puertos por caja"

**Files:**
- Modify: `fsm/frontend/src/lib/api/monitoreo.api.ts`
- Modify: `fsm/frontend/src/routes/admin/monitoreo/+page.svelte`

**Interfaces:**
- Consumes: endpoints de Task 7.
- Produces (en `monitoreo.api.ts`): tipos `ResumenCajaSmartolt`, `OntDePuerto`, `PuertoDeCaja`, `DetalleCajaSmartolt`; funciones `listarCajasSmartolt(token)`, `detalleCajaSmartolt(token, clave)`, `urlCajaSmartolt(clave): string`.

- [ ] **Step 1: Tipos y funciones de API**

Al final de `monitoreo.api.ts`:

```ts
// --- Cajas SmartOLT y sus puertos -------------------------------------------

export interface ResumenCajaSmartolt {
  /** `olt/placa/puerto|NOMBRE NORMALIZADO`. */
  clave: string;
  nombre: string;
  olt_externo: string | null;
  board: number | null;
  puerto_pon: number | null;
  zona: string | null;
  capacidad: number;
  /** La capacidad no salio del catalogo de SmartOLT: se estimo. */
  capacidad_estimada: boolean;
  ocupados: number;
  ont_total: number;
  sin_puerto: number;
}

export interface OntDePuerto {
  numero_serie: string;
  nombre_cliente: string | null;
  estado_conexion: string | null;
  potencia_dbm: number | null;
  posible_baja: boolean;
}

export interface PuertoDeCaja {
  numero: number;
  estado: 'OCUPADO' | 'SIN_REGISTRO';
  conflicto: boolean;
  onts: OntDePuerto[];
}

export interface DetalleCajaSmartolt
  extends Omit<ResumenCajaSmartolt, 'ont_total' | 'sin_puerto'> {
  puertos: PuertoDeCaja[];
  fuera_de_rango: (OntDePuerto & { odb_puerto: number })[];
  sin_puerto: OntDePuerto[];
}

export function listarCajasSmartolt(token: string) {
  return pedir<ResumenCajaSmartolt[]>(token, `${API_URL}/api/monitoreo/cajas-smartolt`);
}

/** La clave va en la query: lleva espacios, "/" y "|". */
export function detalleCajaSmartolt(token: string, clave: string) {
  const qs = new URLSearchParams({ clave });
  return pedir<DetalleCajaSmartolt>(token, `${API_URL}/api/monitoreo/cajas-smartolt/detalle?${qs}`);
}

/** Ruta de la pagina de una caja. */
export function urlCajaSmartolt(clave: string) {
  return `/admin/monitoreo/caja?${new URLSearchParams({ clave })}`;
}
```

- [ ] **Step 2: Estado y carga en la página**

En `+page.svelte`:

1. Sumar a los imports de `$lib/api/monitoreo.api`: `listarCajasSmartolt, urlCajaSmartolt, type ResumenCajaSmartolt`.
2. Cambiar `let vista = $state<'cajas' | 'onts'>('cajas');` por `let vista = $state<'cajas' | 'puertos' | 'onts'>('cajas');`.
3. Debajo de `let soloConProblema = $state(false);`:

```ts
  // Vista "Puertos por caja": se carga recien al abrirla. Arma todas las cajas
  // con la misma consulta pesada que el panel, y no hace falta en cada visita.
  let cajasSmartolt = $state<ResumenCajaSmartolt[] | null>(null);
  let busquedaCaja = $state('');

  async function cargarCajasSmartolt() {
    try {
      const c = await listarCajasSmartolt(token());
      if (!destruido) cajasSmartolt = c;
    } catch (e) {
      if (!destruido) error = e instanceof Error ? e.message : 'No se pudieron cargar las cajas';
    }
  }

  function verPuertos() {
    vista = 'puertos';
    if (!cajasSmartolt) cargarCajasSmartolt();
  }
```

4. En el handler `socket.on('monitoreo_update', ...)`, después de `cargar();`:

```ts
      if (vista === 'puertos') cargarCajasSmartolt();
```

5. Reemplazar el derivado `zonas` para que también tome las zonas de las cajas SmartOLT:

```ts
  const zonas = $derived(
    [
      ...new Set(
        [...(porCaja?.cajas ?? []), ...(cajasSmartolt ?? [])]
          .map((c) => c.zona)
          .filter((z): z is string => !!z),
      ),
    ].sort(),
  );
```

6. Debajo de `cajasVisibles`:

```ts
  const cajasSmartoltVisibles = $derived.by(() => {
    const q = busquedaCaja.trim().toLowerCase();
    return (cajasSmartolt ?? [])
      .filter((c) => !filtroZona || c.zona === filtroZona)
      .filter((c) => !q || c.nombre.toLowerCase().includes(q));
  });
```

- [ ] **Step 3: Pestaña, buscador y tabla**

Entre el botón "Por caja NAP" y "Todas las ONT":

```svelte
      <button
        type="button"
        role="tab"
        aria-selected={vista === 'puertos'}
        onclick={verPuertos}
        class="btn-pestana {vista === 'puertos' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}"
      >Puertos por caja</button>
```

Junto al bloque `{#if vista === 'onts'}` de los filtros, agregar antes:

```svelte
    {#if vista === 'puertos'}
      <div class="flex flex-col flex-1 min-w-52">
        <label for="busca-caja" class="text-xs font-semibold text-slate-600 mb-0.5">Buscar caja</label>
        <input
          id="busca-caja"
          type="search"
          bind:value={busquedaCaja}
          placeholder="Nombre de la caja, p. ej. NAP53"
          class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
      </div>
    {/if}
```

Entre el bloque `{:else if vista === 'cajas'} ... ` y `<!-- CU-12 / RF-10 ... -->{:else}`, agregar:

```svelte
  <!-- Puertos por caja: todas las cajas de SmartOLT, con o sin criticos -->
  {:else if vista === 'puertos'}
    {#if !cajasSmartolt}
      <div class="space-y-2">
        {#each Array(5) as _}
          <div class="h-12 bg-slate-100 rounded-lg motion-safe:animate-pulse"></div>
        {/each}
      </div>
    {:else if cajasSmartoltVisibles.length === 0}
      <div class="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-xl px-4 py-8 text-center">
        Ninguna caja{busquedaCaja ? ` que coincida con «${busquedaCaja}»` : ''}{filtroZona ? ` en ${filtroZona}` : ''}.
      </div>
    {:else}
      <p class="text-sm text-slate-700">
        <strong class="text-slate-900">{cajasSmartoltVisibles.length}</strong> cajas de SmartOLT.
        <span class="text-slate-600">«~» marca capacidad estimada: la caja no está en el catálogo de SmartOLT.</span>
      </p>
      <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table class="w-full text-sm">
          <caption class="sr-only">Cajas NAP de SmartOLT y la ocupación de sus puertos</caption>
          <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
            <tr>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Caja</th>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Zona</th>
              <th scope="col" class="px-3 py-2 text-right font-semibold">Ocupados</th>
              <th scope="col" class="px-3 py-2 text-right font-semibold">ONT sin puerto</th>
              <th scope="col" class="px-3 py-2 text-right font-semibold">Ver</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each cajasSmartoltVisibles as c (c.clave)}
              <tr class="hover:bg-slate-50 transition-colors duration-200">
                <td class="px-3 py-2">
                  <span class="font-medium text-slate-900">{c.nombre}</span>
                  <span class="block text-xs text-slate-500 tabular-nums">
                    OLT {c.olt_externo ?? '?'} · {c.board ?? '?'}/{c.puerto_pon ?? '?'}
                  </span>
                </td>
                <td class="px-3 py-2 text-slate-700">{c.zona ?? '--'}</td>
                <td class="px-3 py-2 text-right tabular-nums text-slate-900">
                  {c.ocupados} / {c.capacidad_estimada ? '~' : ''}{c.capacidad}
                </td>
                <td class="px-3 py-2 text-right tabular-nums {c.sin_puerto ? 'text-amber-700' : 'text-slate-500'}">
                  {c.sin_puerto}
                </td>
                <td class="px-3 py-2 text-right">
                  <a href={urlCajaSmartolt(c.clave)} class="btn-texto">Puertos</a>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
```

- [ ] **Step 4: Enlace "Puertos" en el panel de críticos**

En la tabla del panel (`{#each cajasVisibles as c (c.clave)}`), en la celda del botón Ver/Ocultar, antes del `<button>`:

```svelte
                  <a href={urlCajaSmartolt(c.clave)} class="btn-texto mr-3">Puertos</a>
```

- [ ] **Step 5: Verificar**

Run: `cd fsm/frontend && npx svelte-check --threshold error`
Expected: `0 ERRORS`.

- [ ] **Step 6: Commit**

```bash
git add fsm/frontend/src/lib/api/monitoreo.api.ts "fsm/frontend/src/routes/admin/monitoreo/+page.svelte"
git commit -m "feat(monitoreo): pestaña Puertos por caja"
```

---

### Task 9: Frontend — página de la caja con su grilla

**Files:**
- Create: `fsm/frontend/src/routes/admin/monitoreo/caja/+page.svelte`

**Interfaces:**
- Consumes: `detalleCajaSmartolt`, `DetalleCajaSmartolt`, `PuertoDeCaja`, `OntDePuerto` (Task 8). La página de una ONT ya existe en `/admin/monitoreo/ont/[sn]`.

- [ ] **Step 1: Crear la página**

`fsm/frontend/src/routes/admin/monitoreo/caja/+page.svelte`:

```svelte
<script lang="ts">
  import Alert from '$lib/components/Alert.svelte';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { authStore } from '$lib/stores/auth.store';
  import {
    detalleCajaSmartolt,
    type DetalleCajaSmartolt,
    type OntDePuerto,
    type PuertoDeCaja,
  } from '$lib/api/monitoreo.api';

  // Puertos de una caja SmartOLT. La clave viaja en la query ("2/1/7|NAP 53"):
  // lleva barras y espacios, que no sobreviven como segmento de ruta.
  const clave = $derived($page.url.searchParams.get('clave') ?? '');

  let detalle = $state<DetalleCajaSmartolt | null>(null);
  let cargando = $state(true);
  let error = $state('');
  /** Puerto cuyo detalle esta abierto. null = ninguno. */
  let abierto = $state<number | null>(null);

  onMount(async () => {
    if (!clave) {
      error = 'Falta la caja en la dirección.';
      cargando = false;
      return;
    }
    try {
      detalle = await detalleCajaSmartolt(get(authStore).token ?? '', clave);
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo cargar la caja';
    } finally {
      cargando = false;
    }
  });

  const puertoAbierto = $derived(detalle?.puertos.find((p) => p.numero === abierto) ?? null);

  function colorPuerto(p: PuertoDeCaja): string {
    // Ambar para el conflicto: dos ONT en un puerto es un dato malo de
    // SmartOLT, no una falla del cliente.
    if (p.conflicto) return 'bg-amber-100 text-amber-900 border-amber-300';
    if (p.estado === 'OCUPADO') return 'bg-red-100 text-red-800 border-red-200';
    // Gris, no verde: verde se lee como "disponible" y no lo sabemos.
    return 'bg-slate-50 text-slate-600 border-slate-200';
  }

  function etiquetaPuerto(p: PuertoDeCaja): string {
    if (p.conflicto) return `${p.onts.length} ONT`;
    return p.estado === 'OCUPADO' ? 'ocupado' : 'sin registro';
  }

  const estadoClase: Record<string, string> = {
    ONLINE: 'bg-green-100 text-green-800 border-green-200',
    OFFLINE: 'bg-red-100 text-red-800 border-red-200',
    LOS: 'bg-red-100 text-red-800 border-red-200',
    POWER_FAIL: 'bg-orange-100 text-orange-800 border-orange-200',
    DESCONOCIDO: 'bg-gray-100 text-gray-700 border-gray-200',
  };
</script>

<svelte:head><title>{detalle?.nombre ?? 'Caja'} · Puertos</title></svelte:head>

{#snippet filaOnt(o: OntDePuerto, extra?: string)}
  <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
    <a href="/admin/monitoreo/ont/{encodeURIComponent(o.numero_serie)}" class="font-mono text-sm text-blue-700 hover:underline">
      {o.numero_serie}
    </a>
    <span class="text-sm text-slate-700">{o.nombre_cliente ?? 'Sin nombre'}</span>
    <span class="text-xs px-1.5 py-0.5 rounded border {estadoClase[o.estado_conexion ?? 'DESCONOCIDO'] ?? estadoClase.DESCONOCIDO}">
      {o.estado_conexion ?? 'DESCONOCIDO'}
    </span>
    <span class="text-xs tabular-nums text-slate-600">{o.potencia_dbm == null ? '--' : `${o.potencia_dbm} dBm`}</span>
    {#if o.posible_baja}
      <span class="text-xs px-1.5 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-300"
        title="Sin señal hace más de 7 días (DIAS_MAX_INCIDENTE): probablemente un cliente dado de baja que sigue en SmartOLT.">posible baja</span>
    {/if}
    {#if extra}<span class="text-xs text-amber-800">{extra}</span>{/if}
  </li>
{/snippet}

<a href="/admin/monitoreo" class="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-4">
  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
  </svg>
  Volver a monitoreo
</a>

{#if cargando}
  <p class="text-center py-10 text-slate-500">Cargando...</p>
{:else if error}
  <Alert class="rounded-lg text-sm">{error}</Alert>
{:else if detalle}
  <div class="bg-white rounded-xl border border-slate-200 p-5 mb-5">
    <h1 class="text-2xl font-bold text-slate-900">{detalle.nombre}</h1>
    <p class="text-sm text-slate-500 mt-0.5">
      {detalle.zona ?? 'Sin zona'} · OLT {detalle.olt_externo ?? '?'} · {detalle.board ?? '?'}/{detalle.puerto_pon ?? '?'}
    </p>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-slate-100">
      <div>
        <p class="text-xs uppercase tracking-wide text-slate-500">Capacidad</p>
        <p class="text-xl font-semibold tabular-nums text-slate-900">
          {detalle.capacidad_estimada ? '~' : ''}{detalle.capacidad}
        </p>
        {#if detalle.capacidad_estimada}
          <p class="text-xs text-slate-500">Estimada: la caja no está en el catálogo de SmartOLT.</p>
        {/if}
      </div>
      <div>
        <p class="text-xs uppercase tracking-wide text-slate-500">Ocupados</p>
        <p class="text-xl font-semibold tabular-nums text-red-700">{detalle.ocupados}</p>
      </div>
      <div>
        <p class="text-xs uppercase tracking-wide text-slate-500">Sin registro</p>
        <p class="text-xl font-semibold tabular-nums text-slate-600">{detalle.capacidad - detalle.ocupados}</p>
      </div>
      <div>
        <p class="text-xs uppercase tracking-wide text-slate-500">ONT sin puerto</p>
        <p class="text-xl font-semibold tabular-nums text-amber-700">{detalle.sin_puerto.length}</p>
      </div>
    </div>
  </div>

  <div class="bg-white rounded-xl border border-slate-200 p-5 mb-5">
    <h2 class="text-lg font-semibold text-slate-900 mb-1">Puertos</h2>
    <p class="text-sm text-slate-500 mb-3">Según SmartOLT. Haz clic en un puerto para ver qué ONT tiene.</p>

    <div class="mb-4 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
      <strong>«Sin registro» no es lo mismo que «libre».</strong> Las cajas están en
      postes y las comparten varios operadores, así que la ocupación real solo se
      confirma en terreno. Lo único seguro es lo marcado como ocupado.
    </div>

    <div class="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
      {#each detalle.puertos as p (p.numero)}
        <button
          type="button"
          onclick={() => (abierto = abierto === p.numero ? null : p.numero)}
          disabled={p.onts.length === 0}
          aria-expanded={abierto === p.numero}
          aria-label="Puerto {p.numero}, {etiquetaPuerto(p)}"
          class="w-full border rounded-lg px-2 py-3 text-center transition-colors
                 enabled:cursor-pointer enabled:hover:brightness-95 disabled:cursor-default
                 {colorPuerto(p)} {abierto === p.numero ? 'ring-2 ring-blue-500' : ''}"
        >
          <span class="block text-sm font-semibold tabular-nums">{p.numero}</span>
          <span class="block text-[10px] uppercase tracking-wide mt-0.5">{etiquetaPuerto(p)}</span>
        </button>
      {/each}
    </div>

    {#if puertoAbierto}
      <div class="mt-4 border-t border-slate-100 pt-3">
        <h3 class="text-sm font-semibold text-slate-900">
          Puerto {puertoAbierto.numero}
          {#if puertoAbierto.conflicto}
            <span class="font-normal text-amber-800">· SmartOLT pone {puertoAbierto.onts.length} ONT en este puerto; hay que verificarlo en terreno.</span>
          {/if}
        </h3>
        <ul class="divide-y divide-slate-100">
          {#each puertoAbierto.onts as o (o.numero_serie)}{@render filaOnt(o)}{/each}
        </ul>
      </div>
    {/if}
  </div>

  {#if detalle.fuera_de_rango.length > 0}
    <div class="bg-white rounded-xl border border-amber-200 p-5 mb-5">
      <h2 class="text-lg font-semibold text-slate-900 mb-1">Puerto mayor que la capacidad</h2>
      <p class="text-sm text-slate-500 mb-2">SmartOLT las pone en un puerto que esta caja no tiene.</p>
      <ul class="divide-y divide-slate-100">
        {#each detalle.fuera_de_rango as o (o.numero_serie)}{@render filaOnt(o, `puerto ${o.odb_puerto}`)}{/each}
      </ul>
    </div>
  {/if}

  {#if detalle.sin_puerto.length > 0}
    <div class="bg-white rounded-xl border border-slate-200 p-5">
      <h2 class="text-lg font-semibold text-slate-900 mb-1">ONT sin puerto en SmartOLT</h2>
      <p class="text-sm text-slate-500 mb-2">Están en esta caja, pero el instalador no cargó el puerto.</p>
      <ul class="divide-y divide-slate-100">
        {#each detalle.sin_puerto as o (o.numero_serie)}{@render filaOnt(o)}{/each}
      </ul>
    </div>
  {/if}
{/if}
```

- [ ] **Step 2: Verificar**

```bash
cd fsm/frontend
npx svelte-check --threshold error
PUBLIC_API_URL=http://localhost:3000 npm run build
```

Expected: `0 ERRORS` y `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add "fsm/frontend/src/routes/admin/monitoreo/caja/+page.svelte"
git commit -m "feat(monitoreo): página de puertos de una caja SmartOLT"
```

---

### Task 10: Verificación final, PR y despliegue

**Files:**
- Ninguno de código. Actualiza el mensaje al admin de la VPS con el SQL final.

- [ ] **Step 1: Suite completa**

```bash
cd fsm/backend && npx tsc --noEmit -p tsconfig.json && npm test
cd ../frontend && npx svelte-check --threshold error && PUBLIC_API_URL=http://localhost:3000 npm run build
```

Expected: todo verde. Pegar los totales (`Tests: N passed`) en el PR.

- [ ] **Step 2: SQL para el admin de la VPS**

Releer `migration.sql` de Task 1 y armar el mensaje con ese SQL tal cual, más:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON odb_smartolt TO g3_app;
GRANT USAGE, SELECT ON SEQUENCE odb_smartolt_id_odb_smartolt_seq TO g3_app;
```

Entregárselo al usuario; no se envía desde aca.

- [ ] **Step 3: Push y PR**

```bash
git push -u origin feat/puertos-caja-smartolt
gh pr view 138 --json state -q .state
```

Si #138 ya está `MERGED`: `gh pr create --base main`. Si no: `gh pr create --base feat/panel-cajas-smartolt` y decir en el cuerpo que depende de #138. El cuerpo explica: qué cambia, la migración (aditiva; Railway la aplica sola al arrancar; la VPS la aplica el admin), los endpoints nuevos y que Railway y Vercel deben salir juntos.

- [ ] **Step 4: Después del despliegue (lo hace el usuario o se pide permiso)**

En Railway, con un usuario ADMIN, en este orden:
1. `POST /api/monitoreo/catalogo-odb` → llena la capacidad (si no, hasta 24 h después del primer sondeo).
2. Si el sondeo de Railway está apagado (`MONITOREO_POLL_ENABLED` distinto de `true`), `POST /api/monitoreo/ingestar` → llena `odb_puerto`. Cada llamada gasta 1 de las 15 por hora de SmartOLT.
3. Abrir `/admin/monitoreo` → "Puertos por caja" → NAP203 y confirmar que la ONT `GPON6B7459FE` aparece en el puerto 3.

No correr `prisma migrate deploy` ni estos POST contra Railway desde una máquina local sin preguntarle antes al usuario: es la base real.
