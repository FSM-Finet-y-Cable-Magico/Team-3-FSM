<script lang="ts">
  // Panel de monitoreo de red en vivo para el JEFE_TECNICO.
  //
  // CU-12 / RF-10: la potencia de cada ONT se actualiza sola. El navegador NO
  // sondea al backend: escucha el WebSocket `/monitoreo`, y quien consulta a
  // SmartOLT es el ingestor, una vez para todos. La razon es dura: SmartOLT
  // permite 15 llamadas por HORA y el cupo lo comparte toda la cuenta, asi que
  // tres paneles abiertos sondeando lo agotarian en minutos.
  //
  // CU-15 / RF-13: la vista por caja NAP responde "a donde mando la cuadrilla".
  // Va primero porque una lista de 300 clientes caidos no dice donde ir; "la
  // NAP 32 tiene 4 de 4" si.
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { io, type Socket } from 'socket.io-client';
  import { API_URL } from '$lib/api/config.js';
  import { authStore } from '$lib/stores/auth.store';
  import {
    obtenerResumenMonitoreo, listarLecturas, criticosPorCaja, TOPE_PADRON,
    type ResumenMonitoreo, type LecturaOnt, type CriticosPorCaja, type ActualizacionMonitoreo,
  } from '$lib/api/monitoreo.api';

  // Mismos umbrales que el backend (monitoreo.constants.ts). Estan duplicados
  // porque la Vista no comparte codigo con el backend; si FiNet confirma otro
  // rango hay que tocar los dos lados.
  const RANGO = { min: -24, max: -19 };
  const PREVENTIVA_DESDE = -22;

  let resumen = $state<ResumenMonitoreo | null>(null);
  let lecturas = $state<LecturaOnt[]>([]);
  let porCaja = $state<CriticosPorCaja | null>(null);

  let cargando = $state(true);
  let error = $state('');
  let vista = $state<'cajas' | 'onts'>('cajas');
  let filtroZona = $state('');
  let busqueda = $state('');
  let soloConProblema = $state(false);

  // Estado del canal en vivo. Se muestra en pantalla: un panel que dice
  // "en vivo" cuando en realidad se quedo mudo es peor que uno que no lo dice.
  let enVivo = $state(false);
  let ultimoEvento = $state<ActualizacionMonitoreo | null>(null);
  let ultimaCarga = $state<Date | null>(null);

  let socket: Socket | null = null;
  // Misma bandera que el dashboard: `inicializar` tiene awaits antes de crear
  // el socket, y si el usuario se va en el medio, `onDestroy` corre con
  // `socket` todavia en null y despues quedaria una conexion huerfana.
  let destruido = false;

  const token = () => get(authStore).token ?? '';

  onMount(() => {
    inicializar();
  });

  onDestroy(() => {
    destruido = true;
    socket?.disconnect();
    socket = null;
  });

  async function inicializar() {
    await cargar();
    if (destruido) return;

    socket?.disconnect();
    socket = io(`${API_URL}/monitoreo`, { auth: { token: token() } });
    // La empresa sale del token; no se manda ningun id. Si el cliente pudiera
    // elegir su sala, escucharia la red de la otra empresa.
    socket.emit('join_empresa');
    socket.on('connect', () => (enVivo = true));
    socket.on('monitoreo_update', (e: ActualizacionMonitoreo) => {
      ultimoEvento = e;
      cargar();
    });
    socket.on('disconnect', () => (enVivo = false));
  }

  async function cargar() {
    try {
      const t = token();
      const [r, l, c] = await Promise.all([
        obtenerResumenMonitoreo(t),
        listarLecturas(t),
        criticosPorCaja(t),
      ]);
      if (destruido) return;
      resumen = r;
      lecturas = l;
      porCaja = c;
      ultimaCarga = new Date();
      error = '';
    } catch (e) {
      if (!destruido) error = e instanceof Error ? e.message : 'No se pudo cargar el monitoreo';
    } finally {
      if (!destruido) cargando = false;
    }
  }

  // --- Derivados -------------------------------------------------------------

  const zonas = $derived(
    [...new Set((porCaja?.cajas ?? []).map((c) => c.zona).filter((z): z is string => !!z))].sort(),
  );

  const cajasVisibles = $derived(
    (porCaja?.cajas ?? []).filter((c) => !filtroZona || c.zona === filtroZona),
  );

  function conProblema(o: LecturaOnt) {
    return (o.estado_conexion ?? 'ONLINE') !== 'ONLINE' || o.potencia_fuera_de_rango;
  }

  function prioridad(o: LecturaOnt) {
    if ((o.estado_conexion ?? 'ONLINE') !== 'ONLINE') return 0;
    if (o.potencia_fuera_de_rango) return 1;
    if (o.potencia_actual_dbm != null && o.potencia_actual_dbm <= PREVENTIVA_DESDE) return 2;
    return 3;
  }

  const ontsFiltradas = $derived.by(() => {
    const q = busqueda.trim().toLowerCase();
    return lecturas
      .filter((o) => !soloConProblema || conProblema(o))
      .filter((o) => !filtroZona || o.zona === filtroZona)
      .filter(
        (o) =>
          !q ||
          o.numero_serie.toLowerCase().includes(q) ||
          (o.nombre_cliente_ext ?? '').toLowerCase().includes(q) ||
          (o.zona ?? '').toLowerCase().includes(q),
      )
      // Primero lo que hay que mirar: caidas, despues fuera de rango, despues
      // el resto. Ordenar por serie dejaria los problemas repartidos al azar.
      .sort((a, b) => prioridad(a) - prioridad(b) || a.numero_serie.localeCompare(b.numero_serie));
  });

  // El navegador no dibuja 940 filas gratis y nadie recorre mas de 300. El
  // total real se sigue mostrando arriba para que el corte sea evidente.
  const TOPE_FILAS = 300;
  const ontsVisibles = $derived(ontsFiltradas.slice(0, TOPE_FILAS));

  // Todo lo que no esta ONLINE. `DESCONOCIDO` queda aparte a proposito: es
  // "no hay lectura", no "esta caida", y el backend tampoco la cuenta como
  // critica. Se muestra en el detalle para que los numeros cierren contra el
  // total de ONT.
  const fueraDeLinea = $derived(
    !resumen
      ? 0
      : Object.entries(resumen.por_estado)
          .filter(([e]) => e !== 'ONLINE' && e !== 'DESCONOCIDO')
          .reduce((n, [, v]) => n + v, 0),
  );

  const estadoClase: Record<string, string> = {
    ONLINE: 'bg-green-100 text-green-800 border-green-200',
    OFFLINE: 'bg-red-100 text-red-800 border-red-200',
    LOS: 'bg-red-100 text-red-800 border-red-200',
    POWER_FAIL: 'bg-orange-100 text-orange-800 border-orange-200',
    DESCONOCIDO: 'bg-gray-100 text-gray-700 border-gray-200',
  };

  /** Color de la potencia: fuera de rango, degradandose, o sana. */
  function clasePotencia(dbm: number | null) {
    if (dbm == null) return 'text-slate-400';
    if (dbm < RANGO.min || dbm > RANGO.max) return 'text-red-700 font-semibold';
    if (dbm <= PREVENTIVA_DESDE) return 'text-amber-700 font-semibold';
    return 'text-green-700';
  }

  /** Barra de afectacion. El color no es el unico indicador: al lado va el %. */
  function claseBarra(pct: number) {
    if (pct >= 70) return 'bg-red-600';
    if (pct >= 40) return 'bg-orange-500';
    return 'bg-amber-400';
  }

  const hora = (d: string | Date | null) =>
    d ? new Date(d).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '--';
</script>

<svelte:head><title>Monitoreo de red</title></svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">

  <!-- Cabecera -->
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">Monitoreo de red</h1>
      <p class="text-sm text-slate-600 mt-0.5">
        Potencia y estado de cada ONT, y qué cajas NAP están comprometidas.
      </p>
    </div>

    <!-- Estado del canal en vivo. `aria-live` porque el cambio no lo provoca
         el usuario: si el canal se cae, un lector de pantalla debe enterarse. -->
    <div
      role="status"
      aria-live="polite"
      class="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm
             {enVivo
               ? 'bg-green-50 border-green-200 text-green-800'
               : 'bg-slate-100 border-slate-300 text-slate-700'}"
    >
      <span
        class="h-2.5 w-2.5 rounded-full shrink-0
               {enVivo ? 'bg-green-600 motion-safe:animate-pulse' : 'bg-slate-500'}"
      ></span>
      <span class="font-medium">{enVivo ? 'En vivo' : 'Sin conexión en vivo'}</span>
      <span class="text-xs">· actualizado {hora(ultimaCarga)}</span>
    </div>
  </div>

  {#if error}
    <div role="alert" class="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3">
      {error}
    </div>
  {/if}

  <!-- Si el padron supera lo que el backend entrega de una, el listado por ONT
       queda recortado por numero de serie --no por gravedad-- y hay que decirlo
       en vez de mostrar en silencio un recorte arbitrario. -->
  {#if lecturas.length >= TOPE_PADRON}
    <div role="alert" class="bg-amber-50 border border-amber-300 text-amber-900 text-sm rounded-lg px-4 py-3">
      El padrón superó las {TOPE_PADRON} ONT que el backend entrega de una vez: el listado por ONT
      está recortado por número de serie y puede dejar afuera equipos con problema.
      La vista por caja NAP y los indicadores de arriba siguen siendo completos.
    </div>
  {/if}

  <!-- Indicadores -->
  {#if cargando}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {#each Array(4) as _}
        <div class="h-24 bg-slate-100 rounded-xl motion-safe:animate-pulse"></div>
      {/each}
    </div>
  {:else if resumen}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div class="bg-white rounded-xl border p-4">
        <p class="text-xs uppercase tracking-wide text-slate-600 font-semibold">ONT monitoreadas</p>
        <p class="text-3xl font-bold text-slate-900 mt-1 tabular-nums">{resumen.total_ont}</p>
      </div>
      <div class="bg-white rounded-xl border p-4">
        <p class="text-xs uppercase tracking-wide text-slate-600 font-semibold">En línea</p>
        <p class="text-3xl font-bold text-green-700 mt-1 tabular-nums">{resumen.por_estado.ONLINE ?? 0}</p>
      </div>
      <!-- Cuenta TODO lo que no esta ONLINE. Sumar solo LOS y OFFLINE dejaba
           afuera POWER_FAIL --13 ONT sin energia sobre los datos de FiNet--,
           que si cuentan como criticas en la vista por caja: los indicadores
           decian 930 de 943 y los 13 que faltaban no aparecian en ningun lado. -->
      <div class="bg-white rounded-xl border p-4">
        <p class="text-xs uppercase tracking-wide text-slate-600 font-semibold">Fuera de línea</p>
        <p class="text-3xl font-bold text-red-700 mt-1 tabular-nums">{fueraDeLinea}</p>
        <p class="text-xs text-slate-600 mt-0.5">
          LOS {resumen.por_estado.LOS ?? 0} · offline {resumen.por_estado.OFFLINE ?? 0}
          · sin energía {resumen.por_estado.POWER_FAIL ?? 0}
          {#if (resumen.por_estado.DESCONOCIDO ?? 0) > 0}
            · {resumen.por_estado.DESCONOCIDO} sin lectura
          {/if}
        </p>
      </div>
      <div class="bg-white rounded-xl border p-4">
        <p class="text-xs uppercase tracking-wide text-slate-600 font-semibold">Potencia fuera de rango</p>
        <p class="text-3xl font-bold text-amber-700 mt-1 tabular-nums">{resumen.potencia_fuera_de_rango}</p>
        <p class="text-xs text-slate-600 mt-0.5">Operativo: {RANGO.min} a {RANGO.max} dBm</p>
      </div>
    </div>
  {/if}

  <!-- Selector de vista + filtros -->
  <div class="bg-white rounded-xl border p-3 flex flex-wrap items-end gap-3">
    <div
      class="inline-flex rounded-lg border border-slate-300 overflow-hidden"
      role="tablist"
      aria-label="Vista del monitoreo"
    >
      <button
        type="button"
        role="tab"
        aria-selected={vista === 'cajas'}
        onclick={() => (vista = 'cajas')}
        class="px-4 py-1.5 text-sm font-medium cursor-pointer transition-colors duration-200
               focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
               {vista === 'cajas' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}"
      >Por caja NAP</button>
      <button
        type="button"
        role="tab"
        aria-selected={vista === 'onts'}
        onclick={() => (vista = 'onts')}
        class="px-4 py-1.5 text-sm font-medium cursor-pointer transition-colors duration-200
               focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
               {vista === 'onts' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}"
      >Todas las ONT</button>
    </div>

    <div class="flex flex-col">
      <label for="zona" class="text-xs font-semibold text-slate-600 mb-0.5">Zona</label>
      <select
        id="zona"
        bind:value={filtroZona}
        class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm min-w-44 cursor-pointer
               focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <option value="">Todas</option>
        {#each zonas as z}<option value={z}>{z}</option>{/each}
      </select>
    </div>

    {#if vista === 'onts'}
      <div class="flex flex-col flex-1 min-w-52">
        <label for="busca" class="text-xs font-semibold text-slate-600 mb-0.5">Buscar</label>
        <input
          id="busca"
          type="search"
          bind:value={busqueda}
          placeholder="Serie, cliente o zona"
          class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
      </div>
      <label class="flex items-center gap-2 text-sm text-slate-700 cursor-pointer py-1.5">
        <input type="checkbox" bind:checked={soloConProblema} class="cursor-pointer h-4 w-4" />
        Solo con problema
      </label>
    {/if}
  </div>

  {#if cargando}
    <div class="space-y-2">
      {#each Array(5) as _}
        <div class="h-12 bg-slate-100 rounded-lg motion-safe:animate-pulse"></div>
      {/each}
    </div>

  <!-- CU-15 / RF-13: clientes críticos por caja NAP -->
  {:else if vista === 'cajas'}
    {#if porCaja}
      <p class="text-sm text-slate-700">
        <strong class="text-slate-900">{porCaja.totales.cajas_afectadas}</strong> cajas con clientes críticos ·
        <strong class="text-slate-900">{porCaja.totales.clientes_criticos}</strong> clientes afectados
        {#if porCaja.totales.criticos_sin_caja > 0}
          · <span class="text-slate-600">{porCaja.totales.criticos_sin_caja} críticos sin caja asignada</span>
        {/if}
      </p>
    {/if}

    {#if cajasVisibles.length === 0}
      <div class="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl px-4 py-8 text-center">
        Ninguna caja con clientes críticos{filtroZona ? ` en ${filtroZona}` : ''}.
      </div>
    {:else}
      <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table class="w-full text-sm">
          <caption class="sr-only">Cajas NAP ordenadas por porcentaje de clientes afectados</caption>
          <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
            <tr>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Caja</th>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Zona</th>
              <th scope="col" class="px-3 py-2 text-left font-semibold w-80">Afectación</th>
              <th scope="col" class="px-3 py-2 text-right font-semibold">Sin señal</th>
              <th scope="col" class="px-3 py-2 text-right font-semibold">Potencia</th>
              <th scope="col" class="px-3 py-2 text-right font-semibold">Registradas</th>
              <th scope="col" class="px-3 py-2 text-right font-semibold">Ver</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each cajasVisibles as c (c.id_caja_nap)}
              <tr class="hover:bg-slate-50 transition-colors duration-200">
                <td class="px-3 py-2 font-medium text-slate-900">
                  {c.identificador_unico ?? `Caja #${c.id_caja_nap}`}
                </td>
                <td class="px-3 py-2 text-slate-700">{c.zona ?? '--'}</td>
                <td class="px-3 py-2">
                  <div class="flex items-center gap-2">
                    <div class="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden min-w-16">
                      <div class="h-full {claseBarra(c.pct_afectado)}" style="width: {c.pct_afectado}%"></div>
                    </div>
                    <span class="tabular-nums font-semibold text-slate-900 w-24 text-right">
                      {c.pct_afectado}% ({c.criticos}/{c.clientes_en_la_caja})
                    </span>
                    <!-- Sin esta marca, "100% (2/2)" se lee como "la caja
                         entera esta caida" cuando en realidad son las dos
                         unicas ONT que tenemos registradas de una caja de 16. -->
                    {#if c.padron_chico}
                      <span
                        class="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium
                               bg-slate-100 text-slate-700 border border-slate-300"
                        title="Sólo {c.clientes_en_la_caja} ONT registradas{c.capacidad_puertos
                          ? ` de ${c.capacidad_puertos} puertos`
                          : ''}: el porcentaje habla de esas, no de la caja entera."
                      >padrón parcial</span>
                    {/if}
                  </div>
                </td>
                <td class="px-3 py-2 text-right tabular-nums text-red-700">{c.sin_senal}</td>
                <td class="px-3 py-2 text-right tabular-nums text-amber-700">{c.potencia_fuera_de_rango}</td>
                <td class="px-3 py-2 text-right tabular-nums text-slate-700">
                  {c.clientes_en_la_caja}{c.capacidad_puertos ? ` / ${c.capacidad_puertos}` : ''}
                </td>
                <td class="px-3 py-2 text-right">
                  <a
                    href="/admin/topologia/{c.id_caja_nap}"
                    class="text-blue-700 hover:text-blue-900 font-medium cursor-pointer rounded
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >Caja</a>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

  <!-- CU-12 / RF-10: potencia por ONT, en vivo -->
  {:else}
    <p class="text-sm text-slate-700">
      Mostrando <strong class="text-slate-900">{ontsVisibles.length}</strong>
      de {ontsFiltradas.length} ONT, las de peor estado primero.
      {#if ontsFiltradas.length > TOPE_FILAS}
        <span class="text-slate-600">Usá la búsqueda o los filtros para acotar.</span>
      {/if}
    </p>
    <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table class="w-full text-sm">
        <caption class="sr-only">Última lectura de cada ONT</caption>
        <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
          <tr>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Estado</th>
            <th scope="col" class="px-3 py-2 text-right font-semibold">Potencia</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Serie</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Cliente</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Zona</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">OLT</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Medido</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each ontsVisibles as o (o.numero_serie)}
            <tr class="hover:bg-slate-50 transition-colors duration-200">
              <td class="px-3 py-2">
                <span
                  class="px-2 py-0.5 rounded-md text-xs font-semibold border
                         {estadoClase[o.estado_conexion ?? 'DESCONOCIDO'] ?? estadoClase.DESCONOCIDO}"
                >
                  {o.estado_conexion ?? 'DESCONOCIDO'}
                </span>
              </td>
              <td class="px-3 py-2 text-right tabular-nums {clasePotencia(o.potencia_actual_dbm)}">
                {o.potencia_actual_dbm == null ? '--' : `${o.potencia_actual_dbm} dBm`}
              </td>
              <td class="px-3 py-2 font-mono text-xs text-slate-700">{o.numero_serie}</td>
              <td class="px-3 py-2 text-slate-900">{o.nombre_cliente_ext ?? '--'}</td>
              <td class="px-3 py-2 text-slate-700">{o.zona ?? '--'}</td>
              <td class="px-3 py-2 text-slate-700">{o.olt_externo ?? '--'}</td>
              <td class="px-3 py-2 text-slate-600 tabular-nums">{hora(o.medido_en)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if ultimoEvento}
    <p class="text-xs text-slate-600">
      Última ingesta: {ultimoEvento.leidas ?? 0} ONT leídas,
      {ultimoEvento.cambios_estado ?? 0} cambios de estado, a las {hora(ultimoEvento.medido_en)}.
    </p>
  {/if}
</div>
