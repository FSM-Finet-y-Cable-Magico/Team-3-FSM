<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.store';
  import * as topologiaApi from '$lib/api/topologia.api';
  import type { CajaListada } from '$lib/api/topologia.api';

  let token = $state('');
  let cajas = $state<CajaListada[]>([]);
  let cargando = $state(true);
  let error = $state('');

  let busqueda = $state('');
  let zonaFiltro = $state('');
  let soloConLibres = $state(false);

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
      if (soloConLibres && c.puertos_libres <= 0) return false;
      return true;
    }),
  );

  const totales = $derived({
    cajas: cajas.length,
    puertos: cajas.reduce((a, c) => a + c.capacidad_puertos, 0),
    libres: cajas.reduce((a, c) => a + c.puertos_libres, 0),
    llenas: cajas.filter((c) => c.puertos_libres === 0).length,
  });

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
      cajas = await topologiaApi.listarCajas(token);
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo cargar la topología';
    } finally {
      cargando = false;
    }
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
      // fuera del filtro vigente --lo tipico: se crea sin zona con el filtro
      // puesto en una-- y parece que no se guardo, aunque el contador suba.
      const filtrabaAlgo = !!busqueda || !!zonaFiltro || soloConLibres;
      busqueda = '';
      zonaFiltro = '';
      soloConLibres = false;

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

  function ocupacion(c: CajaListada): number {
    if (!c.capacidad_puertos) return 0;
    return Math.round((c.puertos_ocupados / c.capacidad_puertos) * 100);
  }

  function colorOcupacion(pct: number): string {
    if (pct >= 100) return 'bg-red-500';
    if (pct >= 80) return 'bg-amber-500';
    return 'bg-emerald-500';
  }
</script>

<svelte:head><title>Topología de red</title></svelte:head>

<div class="mb-6">
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">Topología de red</h1>
      <p class="text-sm text-slate-500 mt-0.5">
        Cajas NAP y ocupación registrada de sus puertos
      </p>
    </div>
    <button
      onclick={abrirNueva}
      class="btn btn-primario"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
      </svg>
      Nueva caja
    </button>
  </div>
</div>

{#if aviso}
  <div role="status" class="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center justify-between">
    <span>{aviso}</span>
    <button onclick={() => (aviso = '')} class="text-emerald-600 hover:text-emerald-800 cursor-pointer" aria-label="Cerrar aviso">✕</button>
  </div>
{/if}

{#if !cargando && !error}
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
    {#each [
      { l: 'Cajas', v: totales.cajas },
      { l: 'Puertos totales', v: totales.puertos },
      { l: 'Ocupación registrada', v: totales.puertos - totales.libres },
      { l: 'Cajas sin cupo', v: totales.llenas },
    ] as t}
      <div class="bg-white rounded-xl border border-slate-200 px-4 py-3">
        <p class="text-xs uppercase tracking-wide text-slate-500">{t.l}</p>
        <p class="text-2xl font-semibold text-slate-900 mt-1">{t.v.toLocaleString('es-CL')}</p>
      </div>
    {/each}
  </div>
{/if}

<!-- Sin esto la columna "sin registro" se lee como "libre", y la caja es del
     poste: la comparten varios operadores y nadie garantiza el cupo. -->
<div class="mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
  La ocupación que se muestra es <strong>la registrada por el equipo</strong>. Las
  cajas están en postes compartidos con otros operadores, así que un puerto sin
  registro no está garantizado: se confirma en terreno.
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
        class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
      >
        <option value="">Todas</option>
        {#each zonas as z}<option value={z}>{z}</option>{/each}
      </select>
    </div>
    <div class="flex items-end">
      <label class="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
        <input type="checkbox" bind:checked={soloConLibres} class="rounded border-slate-300 cursor-pointer" />
        Solo con puertos sin ocupar
      </label>
    </div>
    <div class="flex items-end justify-end">
      <p class="text-sm text-slate-500">
        {visibles.length.toLocaleString('es-CL')} de {cajas.length.toLocaleString('es-CL')}
      </p>
    </div>
  </div>
</div>

{#if cargando}
  <p class="text-center py-10 text-slate-500">Cargando topología...</p>
{:else if error}
  <div role="alert" class="px-4 py-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">{error}</div>
{:else if visibles.length === 0}
  <p class="text-center py-10 text-slate-500">Ninguna caja coincide con el filtro.</p>
{:else}
  <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 border-b border-slate-200">
          <tr class="text-left text-xs uppercase tracking-wide text-slate-500">
            <th class="px-4 py-3 font-medium">Caja</th>
            <th class="px-4 py-3 font-medium">Zona</th>
            <th class="px-4 py-3 font-medium">Poste</th>
            <th class="px-4 py-3 font-medium">Ocupación registrada</th>
            <th class="px-4 py-3 font-medium text-right">Sin registro</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each visibles as c (c.id_caja_nap)}
            {@const pct = ocupacion(c)}
            <tr class="hover:bg-slate-50 transition-colors">
              <td class="px-4 py-3">
                <a href="/admin/topologia/{c.id_caja_nap}" class="btn-texto">
                  {c.identificador_unico ?? `#${c.id_caja_nap}`}
                </a>
              </td>
              <td class="px-4 py-3 text-slate-600">{c.zona ?? '—'}</td>
              <td class="px-4 py-3 text-slate-600">{c.numero_poste ?? '—'}</td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div class="h-full {colorOcupacion(pct)}" style="width: {Math.min(100, pct)}%"></div>
                  </div>
                  <span class="text-xs text-slate-500 tabular-nums">
                    {c.puertos_ocupados}/{c.capacidad_puertos}
                  </span>
                </div>
              </td>
              <td class="px-4 py-3 text-right">
                <span class="font-medium tabular-nums {c.puertos_libres === 0 ? 'text-red-600' : 'text-slate-900'}">
                  {c.puertos_libres}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}

{#if mostrarNueva}
  <div
    class="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50"
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
          <div role="alert" class="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
            {errorForm}
          </div>
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
