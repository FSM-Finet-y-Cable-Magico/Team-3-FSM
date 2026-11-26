<script lang="ts">
  import Alert from '$lib/components/Alert.svelte';
  import MapaCajas from '$lib/components/MapaCajas.svelte';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.store';
  import * as topologiaApi from '$lib/api/topologia.api';
  import type { EstadoCaja, ResumenSalud, SaludCaja } from '$lib/api/topologia.api';
  import { ESTADO_CAJA } from '$lib/utils/estado-caja';

  /**
   * Mapa de salud de la red.
   *
   * Antes esta pagina mostraba la ocupacion de `puerto_nap`, que casi nadie
   * llena, y no le decia nada al jefe tecnico. Ahora cruza lo unico que la
   * topologia de Tomodat tiene y nadie mas --la ubicacion de cada caja-- con el
   * estado de sus ONT, sus alertas y sus OT: donde esta fallando la red y a
   * donde mandar una cuadrilla.
   */

  let token = $state('');
  let rol = $state('');

  // CU-20: reconciliar los puertos con las ONT ligadas. Primero se muestra lo
  // que haria; se aplica solo si el ADMIN lo confirma.
  let reconciliacion = $state<topologiaApi.ReconciliacionPuertos | null>(null);
  let mostrarReconciliar = $state(false);
  let reconciliando = $state(false);
  let errorReconciliar = $state('');

  async function reconciliar(aplicar: boolean) {
    reconciliando = true;
    errorReconciliar = '';
    mostrarReconciliar = true;
    try {
      reconciliacion = await topologiaApi.reconciliarPuertos(token, aplicar);
      if (aplicar) cargar();
    } catch (e) {
      errorReconciliar = e instanceof Error ? e.message : 'Error al reconciliar';
    } finally {
      reconciliando = false;
    }
  }

  let cajas = $state<SaludCaja[]>([]);
  let resumen = $state<ResumenSalud | null>(null);
  let cargando = $state(true);
  let error = $state('');

  let busqueda = $state('');
  let zonaFiltro = $state('');
  let estadoFiltro = $state<EstadoCaja | 'PROBLEMAS' | ''>('');
  /** Las cajas sin ONT son ~600 puntos grises que tapan los que importan. */
  let ocultarSinOnt = $state(false);
  let seleccionada = $state<number | null>(null);

  let mostrarNueva = $state(false);
  let guardando = $state(false);
  let errorForm = $state('');
  let aviso = $state('');

  // Formulario de alta. `capacidad` arranca en 16 porque es la caja tipica.
  let nIdentificador = $state('');
  let nZona = $state('');
  let nPoste = $state('');
  let nCapacidad = $state(16);
  let nLatitud = $state('');
  let nLongitud = $state('');

  const zonas = $derived(
    [...new Set(cajas.map((c) => c.zona).filter((z): z is string => !!z))].sort(),
  );

  const visibles = $derived(
    cajas.filter((c) => {
      const q = busqueda.trim().toLowerCase();
      if (q && !(c.identificador_unico ?? '').toLowerCase().includes(q)) return false;
      if (zonaFiltro && c.zona !== zonaFiltro) return false;
      // Mismo criterio que el indicador `con_alerta_u_ot` del backend.
      if (estadoFiltro === 'PROBLEMAS' && c.alertas_abiertas === 0 && c.ots_abiertas === 0) return false;
      if (estadoFiltro && estadoFiltro !== 'PROBLEMAS' && c.estado !== estadoFiltro) return false;
      if (ocultarSinOnt && c.estado === 'SIN_ONT' && estadoFiltro !== 'SIN_ONT') return false;
      return true;
    }),
  );

  /** La lista se corta: 900 filas no se leen, y el mapa ya muestra el total. */
  const LIMITE_LISTA = 150;

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
    rol = state.usuario?.rol ?? '';
    cargar();
  });

  async function cargar() {
    cargando = true;
    error = '';
    try {
      const r = await topologiaApi.saludCajas(token);
      cajas = r.cajas;
      resumen = r.resumen;
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo cargar la topología';
    } finally {
      cargando = false;
    }
  }

  let contenedorMapa = $state<HTMLDivElement | undefined>();

  /** En el celular la lista va debajo del mapa: hay que subir hasta él. */
  function verEnMapa(id: number) {
    seleccionada = id;
    contenedorMapa?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function filtrarPorEstado(e: EstadoCaja | 'PROBLEMAS') {
    estadoFiltro = estadoFiltro === e ? '' : e;
    seleccionada = null;
  }

  function abrirNueva() {
    nIdentificador = '';
    nZona = '';
    nPoste = '';
    nCapacidad = 16;
    nLatitud = '';
    nLongitud = '';
    errorForm = '';
    mostrarNueva = true;
  }

  async function crear(e: Event) {
    e.preventDefault();
    if (!nIdentificador.trim()) {
      errorForm = 'El identificador es obligatorio';
      return;
    }
    guardando = true;
    errorForm = '';
    try {
      const creada = await topologiaApi.crearCaja(token, {
        identificador_unico: nIdentificador.trim(),
        zona: nZona.trim() || undefined,
        numero_poste: nPoste.trim() || undefined,
        capacidad_puertos: nCapacidad,
        latitud: nLatitud.trim() ? Number(nLatitud) : undefined,
        longitud: nLongitud.trim() ? Number(nLongitud) : undefined,
      });
      mostrarNueva = false;

      // Limpiar los filtros al crear. Si no, la caja recien creada puede caer
      // fuera del filtro vigente --lo tipico: una caja nueva no tiene ONT y el
      // filtro esconde las SIN_ONT-- y parece que no se guardo.
      const filtrabaAlgo = !!busqueda || !!zonaFiltro || !!estadoFiltro || ocultarSinOnt;
      busqueda = '';
      zonaFiltro = '';
      estadoFiltro = '';
      ocultarSinOnt = false;
      aviso =
        `Caja ${creada.identificador_unico} creada con ${nCapacidad} puertos` +
        (creada.identificador_unico !== nIdentificador.trim()
          ? `. Se le agregó el sufijo porque «${nIdentificador.trim()}» ya estaba en uso`
          : '') +
        (filtrabaAlgo ? '. Se limpiaron los filtros para que puedas verla' : '');
      await cargar();
    } catch (err) {
      // Acá aterriza el 409 de identificador duplicado, que explica por qué dos
      // cajas con el mismo nombre normalizado no pueden convivir. El mensaje del
      // backend es la explicación completa: se muestra tal cual.
      errorForm = err instanceof Error ? err.message : 'No se pudo crear la caja';
    } finally {
      guardando = false;
    }
  }

  function resumenOnts(c: SaludCaja): string {
    if (c.onts.total === 0) return 'Sin ONT ligada';
    return `${c.onts.en_linea}/${c.onts.total} en línea`;
  }
</script>

<svelte:head><title>Topología de red</title></svelte:head>

<div class="mb-6">
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">Topología de red</h1>
      <p class="text-sm text-slate-500 mt-0.5">
        Dónde está fallando la red: cada caja NAP según el estado de sus ONT
      </p>
    </div>
    <div class="flex items-center gap-3">
      {#if rol === 'ADMIN'}
        <button onclick={() => reconciliar(false)} class="btn btn-secundario">Reconciliar puertos</button>
      {/if}
      <button onclick={abrirNueva} class="btn btn-primario">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Nueva caja
      </button>
    </div>
  </div>
</div>

{#if aviso}
  <div role="status" class="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center justify-between">
    <span>{aviso}</span>
    <button onclick={() => (aviso = '')} class="text-emerald-600 hover:text-emerald-800 cursor-pointer" aria-label="Cerrar aviso">✕</button>
  </div>
{/if}

{#if cargando}
  <p class="text-center py-10 text-slate-500">Cargando topología...</p>
{:else if error}
  <Alert class="rounded-lg text-sm">{error}</Alert>
{:else if resumen}
  <!-- Cada indicador filtra el mapa y la lista: es la pregunta que lleva a la
       accion ("muestrame las caidas"), no un numero para mirar. -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
    <button
      onclick={() => filtrarPorEstado('CAIDA')}
      aria-pressed={estadoFiltro === 'CAIDA'}
      class="text-left bg-white rounded-xl border px-4 py-3 cursor-pointer transition-shadow hover:shadow-md {estadoFiltro === 'CAIDA' ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200'}"
    >
      <p class="text-xs uppercase tracking-wide text-slate-500">Cajas caídas</p>
      <p class="text-2xl font-semibold text-red-700 mt-1 tabular-nums">{resumen.por_estado.CAIDA}</p>
      <p class="text-xs text-slate-500 mt-0.5">{resumen.clientes_afectados.toLocaleString('es-CL')} ONT afectadas en toda la red</p>
    </button>
    <button
      onclick={() => filtrarPorEstado('DEGRADADA')}
      aria-pressed={estadoFiltro === 'DEGRADADA'}
      class="text-left bg-white rounded-xl border px-4 py-3 cursor-pointer transition-shadow hover:shadow-md {estadoFiltro === 'DEGRADADA' ? 'border-amber-400 ring-2 ring-amber-200' : 'border-slate-200'}"
    >
      <p class="text-xs uppercase tracking-wide text-slate-500">Cajas degradadas</p>
      <p class="text-2xl font-semibold text-amber-700 mt-1 tabular-nums">{resumen.por_estado.DEGRADADA}</p>
      <p class="text-xs text-slate-500 mt-0.5">Alguna ONT caída o con potencia fuera de rango</p>
    </button>
    <button
      onclick={() => filtrarPorEstado('PROBLEMAS')}
      aria-pressed={estadoFiltro === 'PROBLEMAS'}
      class="text-left bg-white rounded-xl border px-4 py-3 cursor-pointer transition-shadow hover:shadow-md {estadoFiltro === 'PROBLEMAS' ? 'border-blue-400 ring-2 ring-blue-200' : 'border-slate-200'}"
    >
      <p class="text-xs uppercase tracking-wide text-slate-500">Con alerta u OT abierta</p>
      <p class="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">{resumen.con_alerta_u_ot}</p>
      <p class="text-xs text-slate-500 mt-0.5">{resumen.por_estado.OK} cajas sin problemas</p>
    </button>
    <button
      onclick={() => filtrarPorEstado('SIN_ONT')}
      aria-pressed={estadoFiltro === 'SIN_ONT'}
      class="text-left bg-white rounded-xl border px-4 py-3 cursor-pointer transition-shadow hover:shadow-md {estadoFiltro === 'SIN_ONT' ? 'border-slate-400 ring-2 ring-slate-200' : 'border-slate-200'}"
    >
      <p class="text-xs uppercase tracking-wide text-slate-500">Sin ONT ligada</p>
      <p class="text-2xl font-semibold text-slate-600 mt-1 tabular-nums">{resumen.por_estado.SIN_ONT}</p>
      <p class="text-xs text-slate-500 mt-0.5">{resumen.sin_ubicacion} cajas sin ubicación</p>
    </button>
  </div>

  <div class="bg-white rounded-xl border border-slate-200 p-4 mb-5">
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label for="f-busqueda" class="block text-xs font-medium text-slate-600 mb-1">Identificador</label>
        <input
          id="f-busqueda"
          bind:value={busqueda}
          placeholder="NAP 6"
          class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>
      <div>
        <label for="f-zona" class="block text-xs font-medium text-slate-600 mb-1">Zona</label>
        <select
          id="f-zona"
          bind:value={zonaFiltro}
          onchange={() => (seleccionada = null)}
          class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
        >
          <option value="">Todas</option>
          {#each zonas as z}<option value={z}>{z}</option>{/each}
        </select>
      </div>
      <div>
        <label for="f-estado" class="block text-xs font-medium text-slate-600 mb-1">Estado</label>
        <select
          id="f-estado"
          bind:value={estadoFiltro}
          onchange={() => (seleccionada = null)}
          class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
        >
          <option value="">Todos</option>
          <option value="PROBLEMAS">Con alerta u OT abierta</option>
          {#each Object.entries(ESTADO_CAJA) as [valor, meta]}<option value={valor}>{meta.etiqueta}</option>{/each}
        </select>
      </div>
      <div class="flex items-end justify-between gap-3">
        <label class="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" bind:checked={ocultarSinOnt} class="rounded border-slate-300 cursor-pointer" />
          Ocultar cajas sin ONT
        </label>
        <p class="text-sm text-slate-500 tabular-nums whitespace-nowrap">
          {visibles.length.toLocaleString('es-CL')} de {cajas.length.toLocaleString('es-CL')}
        </p>
      </div>
    </div>
  </div>

  <div class="grid gap-5 lg:grid-cols-5">
    <div class="lg:col-span-3 scroll-mt-4" bind:this={contenedorMapa}>
      <MapaCajas
        cajas={visibles}
        {seleccionada}
        onseleccionar={(id) => (seleccionada = id)}
        alto="h-90 lg:h-150"
      />
    </div>

    <div class="lg:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col lg:h-150">
      <div class="px-4 py-3 border-b border-slate-200 bg-slate-50">
        <h2 class="text-sm font-semibold text-slate-900">De la más grave a la más sana</h2>
      </div>
      {#if visibles.length === 0}
        <p class="text-center py-10 text-sm text-slate-500">Ninguna caja coincide con el filtro.</p>
      {:else}
        <ul class="divide-y divide-slate-100 overflow-y-auto max-h-120 lg:max-h-none lg:flex-1">
          {#each visibles.slice(0, LIMITE_LISTA) as c (c.id_caja_nap)}
            {@const meta = ESTADO_CAJA[c.estado]}
            <li class="{seleccionada === c.id_caja_nap ? 'bg-blue-50' : 'hover:bg-slate-50'} transition-colors">
              <div class="flex items-start gap-3 px-4 py-2.5">
                <span class="mt-1.5 inline-block w-2.5 h-2.5 rounded-full shrink-0" style="background: {meta.color}" aria-hidden="true"></span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <a href="/admin/topologia/{c.id_caja_nap}" class="btn-texto truncate">
                      {c.identificador_unico ?? `#${c.id_caja_nap}`}
                    </a>
                    <span class="text-[11px] px-1.5 py-0.5 rounded border {meta.badge} whitespace-nowrap">{meta.etiqueta}</span>
                  </div>
                  <p class="text-xs text-slate-500 mt-0.5">
                    {c.zona ?? 'Sin zona'} · {resumenOnts(c)}
                    {#if c.onts.caidas}<span class="text-red-700"> · {c.onts.caidas} sin servicio</span>{/if}
                    {#if c.onts.potencia_fuera}<span class="text-amber-700"> · {c.onts.potencia_fuera} potencia</span>{/if}
                    {#if c.alertas_abiertas}<span class="text-slate-700"> · {c.alertas_abiertas} alerta(s)</span>{/if}
                    {#if c.ots_abiertas}<span class="text-blue-700"> · {c.ots_abiertas} OT</span>{/if}
                  </p>
                  {#if c.latitud != null && c.longitud != null}
                    <button onclick={() => verEnMapa(c.id_caja_nap)} class="text-xs text-slate-500 hover:text-blue-700 cursor-pointer mt-0.5">
                      Ver en el mapa
                    </button>
                  {:else}
                    <p class="text-xs text-amber-700 mt-0.5">Sin ubicación: no aparece en el mapa</p>
                  {/if}
                </div>
              </div>
            </li>
          {/each}
          {#if visibles.length > LIMITE_LISTA}
            <li class="px-4 py-3 text-xs text-slate-500">
              Se muestran las primeras {LIMITE_LISTA} de {visibles.length.toLocaleString('es-CL')}. Usa los filtros para acotar.
            </li>
          {/if}
        </ul>
      {/if}
    </div>
  </div>

  <p class="text-xs text-slate-500 mt-4">
    Cada ONT cuenta en la caja con la que quedó ligada. Las cajas «sin ONT ligada» pueden ser de
    otros operadores que comparten el poste, o cajas cuyo nombre no calzó con el de SmartOLT.
  </p>
{/if}

{#if mostrarNueva}
  <div
    class="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-1000"
    role="dialog"
    aria-modal="true"
    aria-labelledby="titulo-nueva"
  >
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
      <form onsubmit={crear} class="p-6">
        <h2 id="titulo-nueva" class="text-lg font-semibold text-slate-900 mb-1">Nueva caja NAP</h2>
        <p class="text-sm text-slate-500 mb-5">
          Se crean sus puertos automáticamente, todos libres.
        </p>

        {#if errorForm}
          <Alert class="rounded-lg text-sm mb-4">
            {errorForm}
          </Alert>
        {/if}

        <div class="space-y-4">
          <div>
            <label for="n-id" class="block text-sm font-medium text-slate-700 mb-1">
              Identificador <span class="text-red-500">*</span>
            </label>
            <input
              id="n-id"
              bind:value={nIdentificador}
              placeholder="NAP 42"
              required
              class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p class="text-xs text-slate-500 mt-1">
              El nombre con el que la conocen los instaladores. Se compara ignorando
              espacios y mayúsculas, así que «NAP42» y «nap 42» cuentan como la misma.
            </p>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="n-zona" class="block text-sm font-medium text-slate-700 mb-1">Zona</label>
              <input id="n-zona" bind:value={nZona} list="zonas-existentes"
                class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              <datalist id="zonas-existentes">
                {#each zonas as z}<option value={z}></option>{/each}
              </datalist>
            </div>
            <div>
              <label for="n-poste" class="block text-sm font-medium text-slate-700 mb-1">N.º de poste</label>
              <input id="n-poste" bind:value={nPoste}
                class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
          </div>

          <div>
            <label for="n-cap" class="block text-sm font-medium text-slate-700 mb-1">Puertos</label>
            <select id="n-cap" bind:value={nCapacidad}
              class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer">
              {#each [8, 16, 24, 32] as n}<option value={n}>{n} puertos</option>{/each}
            </select>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="n-lat" class="block text-sm font-medium text-slate-700 mb-1">Latitud</label>
              <input id="n-lat" bind:value={nLatitud} inputmode="decimal" placeholder="-33.592443"
                class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label for="n-lon" class="block text-sm font-medium text-slate-700 mb-1">Longitud</label>
              <input id="n-lon" bind:value={nLongitud} inputmode="decimal" placeholder="-70.622449"
                class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
          </div>
          <p class="text-xs text-slate-500 -mt-2">
            Opcionales, pero sin ellas la caja no sale en el mapa ni se puede despachar
            una cuadrilla hacia ella.
          </p>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onclick={() => (mostrarNueva = false)}
            class="btn btn-secundario border-transparent shadow-none"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            class="btn btn-primario"
          >
            {guardando ? 'Creando...' : 'Crear caja'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

{#if mostrarReconciliar}
  <!-- z-1000: Leaflet pone sus capas hasta z-index 700, y un modal con z-50
       quedaria detras del mapa. -->
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-1000" role="dialog" aria-modal="true" aria-labelledby="titulo-reconciliar">
    <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-3 text-sm">
      <h2 id="titulo-reconciliar" class="text-lg font-semibold text-slate-900">Reconciliar puertos con las ONT</h2>
      <p class="text-slate-600">Marca ocupado el puerto de cada cliente que tiene su ONT en la caja, y crea los puertos de las cajas que no tienen ninguno.</p>
      {#if reconciliando}
        <p role="status" class="text-slate-500">Calculando...</p>
      {:else if errorReconciliar}
        <p class="text-red-600">{errorReconciliar}</p>
      {:else if reconciliacion}
        {#if reconciliacion.aplicado}
          <p class="font-medium text-green-700">Listo: se crearon {reconciliacion.puertos_creados} puertos y se ocuparon {reconciliacion.puertos_ocupados}.</p>
        {:else}
          <p class="font-medium text-slate-800">Se crearían {reconciliacion.puertos_creados} puertos y se ocuparían {reconciliacion.puertos_ocupados}, en {reconciliacion.cajas_revisadas} cajas.</p>
        {/if}
        {#if reconciliacion.clientes_sin_puerto.length}
          <p class="text-amber-700">{reconciliacion.clientes_sin_puerto.length} {reconciliacion.clientes_sin_puerto.length === 1 ? 'cliente sin puerto libre' : 'clientes sin puerto libre'} en su caja.</p>
        {/if}
        {#if reconciliacion.cajas_sin_capacidad.length}
          <p class="text-amber-700">{reconciliacion.cajas_sin_capacidad.length} cajas con clientes pero sin capacidad conocida: no se les crean puertos.</p>
        {/if}
      {/if}
      <div class="flex gap-3">
        <button onclick={() => (mostrarReconciliar = false)} class="flex-1 btn btn-secundario">Cerrar</button>
        {#if reconciliacion && !reconciliacion.aplicado}
          <button onclick={() => reconciliar(true)} disabled={reconciliando} class="flex-1 btn btn-primario">Aplicar</button>
        {/if}
      </div>
    </div>
  </div>
{/if}
