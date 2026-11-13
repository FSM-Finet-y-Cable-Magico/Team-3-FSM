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
    {#if o.suspendido}
      <span class="text-xs px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200"
        title="Cliente con el contrato suspendido por G8: su caída es esperada.">Suspendido por deuda</span>
    {:else if o.posible_baja}
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
