<script lang="ts">
  // Panel de alertas de red para el JEFE_TECNICO.
  // CU-13 (potencia), CU-52/53 (sin señal), CU-17 (caja caída), CU-15 (críticos
  // agrupados por NAP). El orden de la vista sigue la prioridad operativa: una
  // caja caída primero, porque resuelve muchos clientes de una sola visita.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import {
    listarAlertas, obtenerResumenAlertas, revisarAlerta, evaluarAlertas, obtenerFacetas,
    type Alerta, type ResumenAlertas, type Facetas,
  } from '$lib/api/alertas.api';

  let resumen = $state<ResumenAlertas | null>(null);
  let facetas = $state<Facetas | null>(null);
  let alertas = $state<Alerta[]>([]);
  let cargando = $state(true);
  let evaluando = $state(false);
  let error = $state('');
  let filtro = $state<string>('');
  let filtroZona = $state<string>('');
  let filtroCaja = $state<string>('');
  let verResueltas = $state(false);

  const token = () => get(authStore).token ?? '';

  const ETIQUETA: Record<string, string> = {
    FALLA_CAJA_NAP: 'Caja caída',
    SIN_SENAL: 'Sin señal',
    POTENCIA_FUERA_RANGO: 'Potencia fuera de rango',
  };
  const COLOR_SEV: Record<string, string> = {
    CRITICA: 'bg-red-100 text-red-800 border-red-200',
    ALTA: 'bg-orange-100 text-orange-800 border-orange-200',
    MEDIA: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  };

  async function cargar() {
    cargando = true;
    error = '';
    try {
      [resumen, facetas, alertas] = await Promise.all([
        obtenerResumenAlertas(token()),
        obtenerFacetas(token()),
        listarAlertas(token(), {
          tipo: filtro || undefined,
          zona: filtroZona || undefined,
          caja: filtroCaja || undefined,
          resueltas: verResueltas,
          limit: 200,
        }),
      ]);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al cargar alertas';
    } finally {
      cargando = false;
    }
  }

  async function reevaluar() {
    evaluando = true;
    try {
      await evaluarAlertas(token());
      await cargar();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al evaluar';
    } finally {
      evaluando = false;
    }
  }

  async function marcarRevisada(a: Alerta) {
    const obs = prompt(`Revisar "${ETIQUETA[a.tipo] ?? a.tipo}".\n¿Qué se encontró? (opcional)`);
    if (obs === null) return; // canceló
    try {
      await revisarAlerta(token(), a.id_alerta, obs || undefined);
      await cargar();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al marcar revisada';
    }
  }

  function hace(iso: string): string {
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 60) return `hace ${min} min`;
    if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
    return `hace ${Math.floor(min / 1440)} d`;
  }

  // Las de caja arriba: una sola visita resuelve a todos sus clientes.
  const ordenadas = $derived(
    [...alertas].sort((a, b) => (a.tipo === 'FALLA_CAJA_NAP' ? -1 : 0) - (b.tipo === 'FALLA_CAJA_NAP' ? -1 : 0))
  );
  const cajasCaidas = $derived(ordenadas.filter((a) => a.tipo === 'FALLA_CAJA_NAP'));
  const individuales = $derived(ordenadas.filter((a) => a.tipo !== 'FALLA_CAJA_NAP'));

  onMount(cargar);
</script>

<div class="space-y-6">
  <div class="flex items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-gray-800">Alertas de red</h1>
      <p class="text-sm text-gray-500 mt-0.5">
        Detección automática sobre las lecturas de SmartOLT.
      </p>
    </div>
    <button
      onclick={reevaluar}
      disabled={evaluando}
      class="shrink-0 px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
    >
      {evaluando ? 'Evaluando…' : 'Re-evaluar ahora'}
    </button>
  </div>

  {#if resumen}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <button
        onclick={() => { filtro = ''; cargar(); }}
        class="text-left bg-white rounded-xl border p-4 hover:border-gray-400 {filtro === '' ? 'ring-2 ring-gray-800' : ''}"
      >
        <p class="text-xs text-gray-500">Total abiertas</p>
        <p class="text-2xl font-bold text-gray-800">{resumen.total_abiertas}</p>
      </button>
      {#each ['FALLA_CAJA_NAP', 'SIN_SENAL', 'POTENCIA_FUERA_RANGO'] as tipo}
        <button
          onclick={() => { filtro = tipo; cargar(); }}
          class="text-left bg-white rounded-xl border p-4 hover:border-gray-400 {filtro === tipo ? 'ring-2 ring-gray-800' : ''}"
        >
          <p class="text-xs text-gray-500">{ETIQUETA[tipo]}</p>
          <p class="text-2xl font-bold {tipo === 'FALLA_CAJA_NAP' ? 'text-red-600' : 'text-gray-800'}">
            {resumen.por_tipo[tipo] ?? 0}
          </p>
        </button>
      {/each}
    </div>
  {/if}

  <div class="bg-white rounded-xl border p-3 flex flex-wrap items-end gap-3">
    <div>
      <label for="f-zona" class="block text-xs text-gray-500 mb-1">Zona</label>
      <select id="f-zona" bind:value={filtroZona} onchange={cargar}
        class="border rounded-lg px-3 py-1.5 text-sm min-w-44">
        <option value="">Todas</option>
        {#each facetas?.zonas ?? [] as z}
          <option value={z.valor}>{z.valor} ({z.n})</option>
        {/each}
      </select>
    </div>

    <div>
      <label for="f-caja" class="block text-xs text-gray-500 mb-1">Caja NAP</label>
      <select id="f-caja" bind:value={filtroCaja} onchange={cargar}
        class="border rounded-lg px-3 py-1.5 text-sm min-w-44">
        <option value="">Todas</option>
        {#each facetas?.cajas ?? [] as c}
          <option value={c.valor}>{c.valor} ({c.n})</option>
        {/each}
      </select>
    </div>

    <label class="inline-flex items-center gap-2 text-sm text-gray-600 pb-1.5">
      <input type="checkbox" bind:checked={verResueltas} onchange={cargar} class="rounded" />
      Ver resueltas
    </label>

    {#if filtro || filtroZona || filtroCaja}
      <button
        onclick={() => { filtro = ''; filtroZona = ''; filtroCaja = ''; cargar(); }}
        class="pb-1.5 text-sm text-blue-600 hover:underline">Limpiar filtros</button>
    {/if}
  </div>

  {#if error}
    <div class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
  {/if}

  {#if cargando}
    <p class="text-sm text-gray-400">Cargando…</p>
  {:else if ordenadas.length === 0}
    <div class="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-4 py-6 text-center">
      Sin alertas {verResueltas ? 'resueltas' : 'pendientes'}.
    </div>
  {:else}
    {#if cajasCaidas.length > 0}
      <section class="space-y-3">
        <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Cajas caídas — atender primero
        </h2>
        {#each cajasCaidas as a (a.id_alerta)}
          <div class="bg-white rounded-xl border-l-4 border-red-500 border shadow-sm p-4">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="px-2 py-0.5 rounded-full text-xs font-semibold border {COLOR_SEV[a.severidad ?? ''] ?? 'bg-gray-100 text-gray-700'}">
                    {a.severidad}
                  </span>
                  <span class="text-xs text-gray-400">{hace(a.creada_en)}</span>
                </div>
                <p class="mt-1.5 font-semibold text-gray-800">{a.mensaje}</p>

                {#if a.caja?.latitud}
                  <a
                    class="inline-block mt-2 text-sm text-blue-600 hover:underline"
                    href={`https://www.google.com/maps?q=${a.caja.latitud},${a.caja.longitud}`}
                    target="_blank" rel="noopener"
                  >
                    📍 Ir a la caja {a.caja.identificador_unico} en el mapa
                  </a>
                {:else}
                  <p class="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
                    Sin ubicación: esta caja no está ligada a la topología de Tomodat
                  </p>
                {/if}
              </div>
              {#if !a.resuelta}
                <button onclick={() => marcarRevisada(a)}
                  class="shrink-0 px-3 py-1.5 rounded-lg border text-sm hover:bg-gray-50">Revisar</button>
              {/if}
            </div>
          </div>
        {/each}
      </section>
    {/if}

    {#if individuales.length > 0}
      <section class="space-y-2">
        <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Alertas por cliente ({individuales.length})
        </h2>
        <div class="bg-white rounded-xl border overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th class="px-4 py-2 text-left">Tipo</th>
                <th class="px-4 py-2 text-left">ONT</th>
                <th class="px-4 py-2 text-left">Cliente / dirección</th>
                <th class="px-4 py-2 text-left">Zona</th>
                <th class="px-4 py-2 text-left">Detectada</th>
                <th class="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {#each individuales as a (a.id_alerta)}
                <tr class="hover:bg-gray-50">
                  <td class="px-4 py-2">
                    <span class="px-2 py-0.5 rounded-full text-xs font-medium border {COLOR_SEV[a.severidad ?? ''] ?? 'bg-gray-100'}">
                      {ETIQUETA[a.tipo] ?? a.tipo}
                    </span>
                  </td>
                  <td class="px-4 py-2 font-mono text-xs">{a.registro?.numero_serie ?? '-'}</td>
                  <td class="px-4 py-2 max-w-xs truncate text-gray-600">
                    {a.cliente?.nombre_completo ?? a.registro?.nombre_cliente_ext ?? '-'}
                    <span class="text-gray-400">· {a.registro?.direccion_cliente_ext ?? ''}</span>
                  </td>
                  <td class="px-4 py-2 text-gray-500">{a.registro?.zona ?? '-'}</td>
                  <td class="px-4 py-2 text-gray-400 text-xs">{hace(a.creada_en)}</td>
                  <td class="px-4 py-2 text-right">
                    {#if !a.resuelta}
                      <button onclick={() => marcarRevisada(a)}
                        class="px-2 py-1 rounded border text-xs hover:bg-gray-100">Revisar</button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  {/if}
</div>
