<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { authStore } from '$lib/stores/auth.store';
  import * as ordenesApi from '$lib/api/ordenes.api';
  import * as terrenoApi from '$lib/api/terreno.api';

  let token = '';
  let userId = $state(0);

  const idOT = $derived(+$page.params.id);

  let paso = $state(1);
  let ot = $state<ordenesApi.OT | null>(null);
  let materiales = $state<terrenoApi.MaterialDisponible[]>([]);
  let loadingInit = $state(true);
  let errorInit = $state('');

  // Paso 1 - Fotos
  interface FotoLocal {
    url: string;
    formato: string;
    tamano_kb: number;
    preview: string;
    cargando?: boolean;
  }
  let fotos = $state<FotoLocal[]>([]);
  const subiendoFoto = $derived(fotos.some(f => f.cargando));
  const fotosListas = $derived(fotos.filter(f => !f.cargando));

  // Paso 2 - Materiales
  let cantidades = $state<Record<number, number>>({});
  let series = $state<Record<number, string>>({});

  // Paso 3 - Cierre
  let potencia = $state<string>('');
  let resultadoLlamada = $state<'CONFORME' | 'NO_CONFORME'>('CONFORME');
  let obsLlamada = $state('');
  let resueltoRemotamente = $state(false);

  let cerrando = $state(false);
  let errorCierre = $state('');
  let mostrarModalPotencia = $state(false);
  let dtoParaConfirmar: terrenoApi.CerrarOTDto | null = null;

  const potenciaNum = $derived(potencia !== '' ? parseFloat(potencia) : null);
  const advertenciaPotencia = $derived(
    potenciaNum !== null && !isNaN(potenciaNum) && (potenciaNum < -24 || potenciaNum > -19),
  );

  const materialesSeleccionados = $derived(
    materiales.filter((m) => (cantidades[m.id_tipo_equipo] ?? 0) > 0),
  );

  onMount(async () => {
    authStore.checkAuth();
    const state = get(authStore);

    if (!state.isAuthenticated || state.usuario?.rol !== 'TECNICO') {
      goto('/login');
      return;
    }

    token = state.token ?? '';
    userId = state.usuario?.userId ?? 0;

    try {
      const [otData, matsData] = await Promise.all([
        ordenesApi.obtenerOT(token, idOT),
        terrenoApi.obtenerMateriales(token),
      ]);
      ot = otData;
      materiales = matsData;
    } catch (err) {
      errorInit = err instanceof Error ? err.message : 'Error al cargar datos';
    } finally {
      loadingInit = false;
    }
  });

  async function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    const archivos = Array.from(input.files);
    input.value = '';
    errorCierre = '';

    for (const file of archivos) {
      const placeholderIdx = fotos.length;
      fotos = [...fotos, { url: '', formato: '', tamano_kb: 0, preview: '', cargando: true }];
      try {
        const result = await terrenoApi.subirFoto(token, idOT, file);
        fotos = fotos.map((f, i) =>
          i === placeholderIdx
            ? { url: result.url_cloudinary, formato: result.formato, tamano_kb: result.tamano_kb, preview: result.url_cloudinary, cargando: false }
            : f,
        );
      } catch (err) {
        fotos = fotos.filter((_, i) => i !== placeholderIdx);
        errorCierre = err instanceof Error ? err.message : 'Error al subir foto';
      }
    }
  }

  function eliminarFoto(i: number) {
    fotos = fotos.filter((_, idx) => idx !== i);
  }

  function buildDto(): terrenoApi.CerrarOTDto {
    return {
      fotos: fotos.map((f) => ({ url_cloudinary: f.url, formato: f.formato, tamano_kb: f.tamano_kb })),
      materiales: materialesSeleccionados.map((m) => ({
        id_tipo_equipo: m.id_tipo_equipo,
        cantidad: cantidades[m.id_tipo_equipo],
        numero_serie: series[m.id_tipo_equipo] || undefined,
      })),
      potencia_optica_dbm: parseFloat(potencia),
      resultado_llamada: resultadoLlamada,
      obs_llamada: obsLlamada || undefined,
      resuelto_remotamente: resueltoRemotamente,
    };
  }

  async function cerrarOT(dto?: terrenoApi.CerrarOTDto) {
    const payload = dto ?? buildDto();
    cerrando = true;
    errorCierre = '';
    try {
      const resp = await terrenoApi.cerrarOT(token, idOT, payload);
      if (resp.advertencia_potencia) {
        dtoParaConfirmar = payload;
        mostrarModalPotencia = true;
        cerrando = false;
        return;
      }
      goto('/terreno');
    } catch (err) {
      errorCierre = err instanceof Error ? err.message : 'Error al cerrar OT';
    } finally {
      cerrando = false;
    }
  }

  async function confirmarCierrePotencia() {
    if (!dtoParaConfirmar) return;
    mostrarModalPotencia = false;
    await cerrarOT(dtoParaConfirmar);
  }
</script>

{#if loadingInit}
  <div class="min-h-screen bg-gray-50 flex items-center justify-center">
    <svg class="animate-spin h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
    </svg>
  </div>
{:else if errorInit}
  <div class="min-h-screen bg-gray-50 p-4">
    <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{errorInit}</div>
    <button onclick={() => goto('/terreno')} class="mt-4 text-blue-600 text-sm">Volver</button>
  </div>
{:else}
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <!-- Header -->
    <header class="bg-slate-900 text-white px-4 py-3 sticky top-0 z-10 shadow-lg">
      <div class="flex items-center gap-3">
        <button onclick={() => goto('/terreno')} class="text-slate-300 p-1">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <p class="font-semibold text-sm">Cerrar OT #{idOT}</p>
          <p class="text-xs text-slate-400">{ot?.cliente?.nombre_completo ?? ''}</p>
        </div>
      </div>
    </header>

    <!-- Stepper -->
    <div class="bg-white border-b border-slate-100 px-4 py-3">
      <div class="flex items-center gap-2">
        {#each [1, 2, 3] as p}
          <div
            class="flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold transition-colors
              {paso >= p ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}"
          >{p}</div>
          {#if p < 3}
            <div class="flex-1 h-px {paso > p ? 'bg-blue-600' : 'bg-slate-200'}"></div>
          {/if}
        {/each}
      </div>
      <div class="flex justify-between mt-1">
        <span class="text-xs {paso === 1 ? 'text-blue-600 font-medium' : 'text-slate-400'}">Fotos</span>
        <span class="text-xs {paso === 2 ? 'text-blue-600 font-medium' : 'text-slate-400'}">Materiales</span>
        <span class="text-xs {paso === 3 ? 'text-blue-600 font-medium' : 'text-slate-400'}">Cierre</span>
      </div>
    </div>

    <main class="flex-1 px-4 py-5 space-y-4">

      <!-- PASO 1: Fotografias -->
      {#if paso === 1}
        <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <h2 class="font-semibold text-slate-800 mb-1">Fotografias de evidencia</h2>
          <p class="text-xs text-slate-400 mb-4">Minimo 1 foto requerida · {fotosListas.length} cargada{fotosListas.length !== 1 ? 's' : ''}</p>

          <label class="block w-full">
            <div class="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center gap-2 active:bg-slate-50 transition-colors cursor-pointer">
              {#if subiendoFoto}
                <svg class="animate-spin h-8 w-8 text-blue-400" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                <span class="text-sm text-slate-500">Subiendo...</span>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                  <circle cx="12" cy="13" r="3"/>
                </svg>
                <span class="text-sm font-medium text-slate-600">Tomar foto / Seleccionar archivo</span>
                <span class="text-xs text-slate-400">JPG, PNG, HEIC</span>
              {/if}
            </div>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onchange={handleFileChange}
              disabled={subiendoFoto}
              class="hidden"
            />
          </label>

          {#if fotos.length > 0}
            <div class="grid grid-cols-3 gap-2 mt-4">
              {#each fotos as foto, i}
                <div class="relative aspect-square rounded-lg overflow-hidden bg-slate-100">
                  {#if foto.cargando}
                    <div class="w-full h-full flex items-center justify-center">
                      <svg class="animate-spin h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                    </div>
                  {:else}
                    <img src={foto.preview} alt="evidencia {i + 1}" class="w-full h-full object-cover" />
                    <button
                      onclick={() => eliminarFoto(i)}
                      class="absolute top-1 right-1 bg-black/60 rounded-full p-0.5"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>

        {#if errorCierre}
          <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            {errorCierre}
          </div>
        {/if}

        <button
          onclick={() => (paso = 2)}
          disabled={fotosListas.length === 0 || subiendoFoto}
          class="w-full bg-blue-600 active:bg-blue-800 text-white font-semibold py-4 rounded-xl text-base disabled:opacity-40 flex items-center justify-center gap-2"
        >
          Siguiente
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      {/if}

      <!-- PASO 2: Materiales -->
      {#if paso === 2}
        <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <h2 class="font-semibold text-slate-800 mb-1">Materiales utilizados</h2>
          <p class="text-xs text-slate-400 mb-4">Deje en 0 los materiales no utilizados</p>

          {#if materiales.length === 0}
            <p class="text-sm text-slate-400 text-center py-4">No hay materiales registrados en el sistema</p>
          {:else}
            <div class="space-y-3">
              {#each materiales as mat}
                {@const cantidad = cantidades[mat.id_tipo_equipo] ?? 0}
                {@const stockDisp = mat.stock?.cantidad_disponible ?? 0}
                <div class="border border-slate-100 rounded-xl p-3 {stockDisp === 0 && cantidad === 0 ? 'opacity-50' : ''}">
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <p class="font-medium text-slate-800 text-sm">{mat.nombre}</p>
                      {#if mat.categoria}
                        <p class="text-xs text-slate-400">{mat.categoria}</p>
                      {/if}
                      <p class="text-xs {stockDisp <= 0 ? 'text-red-500 font-medium' : 'text-slate-400'} mt-0.5">
                        Stock: {stockDisp}
                      </p>
                    </div>
                    <div class="flex items-center gap-2">
                      <button
                        onclick={() => cantidades[mat.id_tipo_equipo] = Math.max(0, (cantidades[mat.id_tipo_equipo] ?? 0) - 1)}
                        class="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 font-bold text-lg flex items-center justify-center active:bg-slate-200"
                      >-</button>
                      <span class="w-8 text-center font-semibold text-slate-800">{cantidad}</span>
                      <button
                        onclick={() => cantidades[mat.id_tipo_equipo] = Math.min(stockDisp, (cantidades[mat.id_tipo_equipo] ?? 0) + 1)}
                        disabled={cantidad >= stockDisp}
                        class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 font-bold text-lg flex items-center justify-center active:bg-blue-200 disabled:opacity-30"
                      >+</button>
                    </div>
                  </div>
                  {#if mat.requiere_serie_individual && cantidad > 0}
                    <input
                      type="text"
                      bind:value={series[mat.id_tipo_equipo]}
                      placeholder="Numero de serie"
                      class="mt-2 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="flex gap-3">
          <button
            onclick={() => (paso = 1)}
            class="flex-1 border border-slate-300 text-slate-700 font-semibold py-4 rounded-xl text-base flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Anterior
          </button>
          <button
            onclick={() => (paso = 3)}
            class="flex-1 bg-blue-600 active:bg-blue-800 text-white font-semibold py-4 rounded-xl text-base flex items-center justify-center gap-2"
          >
            Siguiente
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      {/if}

      <!-- PASO 3: Datos de cierre -->
      {#if paso === 3}
        <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4 space-y-4">
          <h2 class="font-semibold text-slate-800">Datos de cierre</h2>

          <!-- Potencia optica -->
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">
              Potencia optica (dBm) *
            </label>
            <input
              type="number"
              step="0.1"
              bind:value={potencia}
              placeholder="-21.5"
              class="w-full border border-slate-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {#if advertenciaPotencia}
              <div class="flex items-start gap-2 mt-2 bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p class="text-sm">Potencia fuera del rango normal (-19 a -24 dBm)</p>
              </div>
            {/if}
          </div>

          <!-- Resultado llamada -->
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-2">Resultado llamada de cortesia *</label>
            <div class="grid grid-cols-2 gap-3">
              <button
                onclick={() => (resultadoLlamada = 'CONFORME')}
                class="py-3 rounded-xl border-2 text-sm font-semibold transition-colors
                  {resultadoLlamada === 'CONFORME' ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'}"
              >
                Conforme
              </button>
              <button
                onclick={() => (resultadoLlamada = 'NO_CONFORME')}
                class="py-3 rounded-xl border-2 text-sm font-semibold transition-colors
                  {resultadoLlamada === 'NO_CONFORME' ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-200 text-slate-500'}"
              >
                No conforme
              </button>
            </div>
          </div>

          <!-- Observaciones llamada -->
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">
              Observaciones de llamada <span class="text-slate-400 text-xs">(opcional)</span>
            </label>
            <textarea
              bind:value={obsLlamada}
              rows={3}
              maxlength={500}
              placeholder="Comentarios del cliente..."
              class="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            ></textarea>
          </div>

          <!-- Resuelto remotamente -->
          <div class="flex items-center justify-between py-2">
            <span class="text-sm font-medium text-slate-700">Resuelto remotamente</span>
            <button
              onclick={() => (resueltoRemotamente = !resueltoRemotamente)}
              class="relative inline-flex h-7 w-12 items-center rounded-full transition-colors
                {resueltoRemotamente ? 'bg-blue-600' : 'bg-slate-200'}"
            >
              <span
                class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform
                  {resueltoRemotamente ? 'translate-x-6' : 'translate-x-1'}"
              ></span>
            </button>
          </div>
        </div>

        {#if errorCierre}
          <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            {errorCierre}
          </div>
        {/if}

        <div class="flex gap-3">
          <button
            onclick={() => (paso = 2)}
            class="flex-1 border border-slate-300 text-slate-700 font-semibold py-4 rounded-xl text-base flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Anterior
          </button>
          <button
            onclick={() => cerrarOT()}
            disabled={cerrando || potencia === '' || isNaN(parseFloat(potencia))}
            class="flex-1 bg-green-600 active:bg-green-800 text-white font-semibold py-4 rounded-xl text-base disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {#if cerrando}
              <svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Cerrando...
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Cerrar OT
            {/if}
          </button>
        </div>
      {/if}
    </main>
  </div>

  <!-- Modal advertencia potencia -->
  {#if mostrarModalPotencia}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
      <div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <div class="flex items-center gap-3 mb-3">
          <div class="bg-amber-100 rounded-full p-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 class="font-semibold text-slate-800">Potencia fuera de rango</h3>
        </div>
        <p class="text-sm text-slate-600 mb-5">
          La potencia ingresada ({potencia} dBm) esta fuera del rango normal (-19 a -24 dBm).
          El cierre se registro correctamente. Confirmar de todas formas?
        </p>
        <div class="flex gap-3">
          <button
            onclick={() => (mostrarModalPotencia = false)}
            class="flex-1 border border-slate-300 text-slate-700 font-medium py-3 rounded-xl text-sm"
          >
            Revisar
          </button>
          <button
            onclick={confirmarCierrePotencia}
            class="flex-1 bg-amber-500 text-white font-semibold py-3 rounded-xl text-sm"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}
