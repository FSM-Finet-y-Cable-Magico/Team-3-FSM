<script lang="ts">
  import Alert from '$lib/components/Alert.svelte';
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
    listarCajasSmartolt, urlCajaSmartolt,
    type ResumenMonitoreo, type LecturaOnt, type CriticosPorCaja, type ActualizacionMonitoreo,
    type ResumenCajaSmartolt,
  } from '$lib/api/monitoreo.api';

  // Los umbrales salen de `lib/utils/potencia`, que ya los tenia para la ficha
  // de OT y el historial. Repetirlos aca era una tercera copia del mismo
  // numero: si FiNet confirma otro rango, con tocar ese archivo alcanza.
  import {
    POTENCIA_MINIMA_DBM,
    POTENCIA_MAXIMA_DBM,
    potenciaDegradandose,
  } from '$lib/utils/potencia';

  let resumen = $state<ResumenMonitoreo | null>(null);
  let lecturas = $state<LecturaOnt[]>([]);
  let porCaja = $state<CriticosPorCaja | null>(null);

  let cargando = $state(true);
  let error = $state('');
  let vista = $state<'cajas' | 'puertos' | 'onts'>('cajas');
  let filtroZona = $state('');
  let busqueda = $state('');
  let soloConProblema = $state(false);
  // Las posibles bajas (caidas hace mas de 7 dias) son ~200 equipos de clientes
  // que se fueron: mostradas por defecto tapaban las caidas reales.
  let mostrarBajas = $state(false);
  // Cajas desplegadas en la vista por caja, por su `clave`. Sobrevive a las
  // recargas en vivo: la clave de SmartOLT no cambia entre sondeos.
  let abiertas = $state<Set<string>>(new Set());

  function alternar(clave: string) {
    const s = new Set(abiertas);
    if (s.has(clave)) s.delete(clave);
    else s.add(clave);
    abiertas = s;
  }

  // Vista "Puertos por caja": se carga recien al abrirla. Arma todas las cajas
  // con la misma consulta pesada que el panel, y no hace falta en cada visita.
  let cajasSmartolt = $state<ResumenCajaSmartolt[] | null>(null);
  let busquedaCaja = $state('');
  // Error propio de esta vista. Con el `error` compartido, la proxima recarga
  // del panel lo borraba y la pestaña quedaba cargando para siempre.
  let errorCajas = $state('');

  async function cargarCajasSmartolt() {
    errorCajas = '';
    try {
      const c = await listarCajasSmartolt(token());
      if (!destruido) cajasSmartolt = c;
    } catch (e) {
      if (!destruido) errorCajas = e instanceof Error ? e.message : 'No se pudieron cargar las cajas';
    }
  }

  function verPuertos() {
    vista = 'puertos';
    if (!cajasSmartolt) cargarCajasSmartolt();
  }

  /** Id HTML para la fila desplegada: la clave trae espacios, `/` y `|`. */
  const idFila = (clave: string) => `onts-${clave.replace(/[^A-Za-z0-9_-]/g, "_")}`;

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
      if (vista === 'puertos') cargarCajasSmartolt();
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
    [
      ...new Set(
        [...(porCaja?.cajas ?? []), ...(cajasSmartolt ?? [])]
          .map((c) => c.zona)
          .filter((z): z is string => !!z),
      ),
    ].sort(),
  );

  const cajasVisibles = $derived(
    (porCaja?.cajas ?? []).filter((c) => !filtroZona || c.zona === filtroZona),
  );

  const cajasSmartoltVisibles = $derived.by(() => {
    const q = busquedaCaja.trim().toLowerCase();
    return (cajasSmartolt ?? [])
      .filter((c) => !filtroZona || c.zona === filtroZona)
      .filter((c) => !q || c.nombre.toLowerCase().includes(q));
  });

  function conProblema(o: LecturaOnt) {
    return (o.estado_conexion ?? 'ONLINE') !== 'ONLINE' || o.potencia_fuera_de_rango;
  }

  function prioridad(o: LecturaOnt) {
    // Una baja vieja no es lo primero que hay que mirar, aunque este caida.
    if (o.posible_baja || o.suspendido) return 4;
    if ((o.estado_conexion ?? 'ONLINE') !== 'ONLINE') return 0;
    if (o.potencia_fuera_de_rango) return 1;
    if (potenciaDegradandose(o.potencia_actual_dbm)) return 2;
    return 3;
  }

  const ontsFiltradas = $derived.by(() => {
    const q = busqueda.trim().toLowerCase();
    return lecturas
      .filter((o) => mostrarBajas || !(o.posible_baja || o.suspendido))
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
    if (dbm < POTENCIA_MINIMA_DBM || dbm > POTENCIA_MAXIMA_DBM) return 'text-red-700 font-semibold';
    if (potenciaDegradandose(dbm)) return 'text-amber-700 font-semibold';
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

<div class="space-y-5">

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
    <Alert class="rounded-lg text-sm">
      {error}
    </Alert>
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
        {#if resumen.posibles_bajas > 0 || (resumen.suspendidos ?? 0) > 0}
          <!-- Se dicen aparte para que el total cierre: ni una baja vieja ni un
               cliente cortado por deuda son un incidente. -->
          <p class="text-xs text-slate-500 mt-0.5">
            No incluye {resumen.posibles_bajas} posibles bajas (caídas hace más de 7 días){#if (resumen.suspendidos ?? 0) > 0}
              ni {resumen.suspendidos} clientes suspendidos por deuda{/if}
          </p>
        {/if}
      </div>
      <div class="bg-white rounded-xl border p-4">
        <p class="text-xs uppercase tracking-wide text-slate-600 font-semibold">Potencia fuera de rango</p>
        <p class="text-3xl font-bold text-amber-700 mt-1 tabular-nums">{resumen.potencia_fuera_de_rango}</p>
        <p class="text-xs text-slate-600 mt-0.5">Operativo: {POTENCIA_MINIMA_DBM} a {POTENCIA_MAXIMA_DBM} dBm</p>
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
        class="btn-pestana {vista === 'cajas' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}"
      >Por caja NAP</button>
      <button
        type="button"
        role="tab"
        aria-selected={vista === 'puertos'}
        onclick={verPuertos}
        class="btn-pestana {vista === 'puertos' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}"
      >Puertos por caja</button>
      <button
        type="button"
        role="tab"
        aria-selected={vista === 'onts'}
        onclick={() => (vista = 'onts')}
        class="btn-pestana {vista === 'onts' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}"
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
      <label class="flex items-center gap-2 text-sm text-slate-700 cursor-pointer py-1.5">
        <input type="checkbox" bind:checked={mostrarBajas} class="cursor-pointer h-4 w-4" />
        Mostrar posibles bajas{resumen?.posibles_bajas ? ` (${resumen.posibles_bajas})` : ''}
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
          · <span class="text-slate-600">{porCaja.totales.criticos_sin_caja} críticos sin caja en SmartOLT</span>
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
            {#each cajasVisibles as c (c.clave)}
              {@const abierta = abiertas.has(c.clave)}
              <tr class="hover:bg-slate-50 transition-colors duration-200">
                <!-- Nombre tal como esta en SmartOLT, para que el tecnico lo
                     encuentre alli. El puerto PON distingue las homonimas. -->
                <td class="px-3 py-2">
                  <span class="font-medium text-slate-900">{c.nombre}</span>
                  <span class="block text-xs text-slate-500 tabular-nums">
                    OLT {c.olt_externo ?? '?'} · {c.board ?? '?'}/{c.puerto_pon ?? '?'}
                  </span>
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
                  </div>
                  <!-- Sin este contexto, "100% (2/2)" se lee como "la caja
                       entera esta caida" cuando son las dos unicas ONT que
                       conocemos de una caja de 16. El denominador son ONT
                       conocidas, no puertos: un puerto vacio no es un cliente. -->
                  <p
                    class="text-xs mt-0.5 {c.padron_chico ? 'text-amber-800' : 'text-slate-500'}"
                    title={c.padron_chico
                      ? 'Con menos de 5 ONT conocidas no se puede decir que falle la caja: el porcentaje habla solo de esas.'
                      : undefined}
                  >
                    {c.criticos} de {c.clientes_en_la_caja} ONT conocidas · caja de
                    {c.capacidad_estimada ? '~' : ''}{c.capacidad} puertos
                  </p>
                </td>
                <td class="px-3 py-2 text-right tabular-nums text-red-700">{c.sin_senal}</td>
                <td class="px-3 py-2 text-right tabular-nums text-amber-700">{c.potencia_fuera_de_rango}</td>
                <td class="px-3 py-2 text-right tabular-nums text-slate-700">{c.clientes_en_la_caja}</td>
                <td class="px-3 py-2 text-right whitespace-nowrap">
                  <a href={urlCajaSmartolt(c.clave)} class="btn-texto mr-3">Puertos</a>
                  <button
                    type="button"
                    class="btn-texto"
                    aria-expanded={abierta}
                    aria-controls={idFila(c.clave)}
                    onclick={() => alternar(c.clave)}
                  >{abierta ? 'Ocultar' : 'Ver'}</button>
                </td>
              </tr>
              {#if abierta}
                <tr id={idFila(c.clave)} class="bg-slate-50">
                  <td colspan="7" class="px-3 py-2">
                    <table class="w-full text-xs">
                      <caption class="sr-only">ONT críticas de {c.nombre}</caption>
                      <thead class="text-slate-500 uppercase tracking-wide">
                        <tr>
                          <th scope="col" class="px-2 py-1 text-left font-semibold">Serie</th>
                          <th scope="col" class="px-2 py-1 text-left font-semibold">Cliente</th>
                          <th scope="col" class="px-2 py-1 text-left font-semibold">Estado</th>
                          <th scope="col" class="px-2 py-1 text-right font-semibold">Potencia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each c.onts_criticas as o (o.numero_serie)}
                          <tr>
                            <td class="px-2 py-1 font-mono text-slate-800">{o.numero_serie}</td>
                            <td class="px-2 py-1 text-slate-700">{o.nombre_cliente ?? '--'}</td>
                            <td class="px-2 py-1">
                              <span class="px-1.5 py-0.5 rounded border {estadoClase[o.estado_conexion ?? 'DESCONOCIDO'] ?? estadoClase.DESCONOCIDO}">
                                {o.estado_conexion ?? 'DESCONOCIDO'}
                              </span>
                            </td>
                            <td class="px-2 py-1 text-right tabular-nums {clasePotencia(o.potencia_dbm)}">
                              {o.potencia_dbm == null ? '--' : `${o.potencia_dbm} dBm`}
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

  <!-- Puertos por caja: todas las cajas de SmartOLT, con o sin criticos -->
  {:else if vista === 'puertos'}
    {#if errorCajas && !cajasSmartolt}
      <Alert class="rounded-lg text-sm">
        {errorCajas}
        <button type="button" class="btn-texto ml-2" onclick={cargarCajasSmartolt}>Reintentar</button>
      </Alert>
    {:else if !cajasSmartolt}
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
              <td class="px-3 py-2 text-right tabular-nums {clasePotencia(o.potencia_actual_dbm)}">
                {o.potencia_actual_dbm == null ? '--' : `${o.potencia_actual_dbm} dBm`}
              </td>
              <td class="px-3 py-2 font-mono text-xs">
                <!-- CU-14: el historial de interrupciones de esta ONT. -->
                <a href={`/admin/monitoreo/ont/${encodeURIComponent(o.numero_serie)}`} class="btn-texto font-mono text-xs">{o.numero_serie}</a>
              </td>
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
