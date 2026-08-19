<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as ordenesApi from '$lib/api/ordenes.api';
  import EstadoBadge from '$lib/components/EstadoBadge.svelte';
  import HistorialFallasPanel from '$lib/components/HistorialFallasPanel.svelte';

  let token = '';
  let nombreTecnico = $state('');
  let userId = $state(0);
  let historialClienteId = $state<number | null>(null);

  let ots = $state<ordenesApi.OT[]>([]);
  let loading = $state(true);
  let errorMsg = $state('');
  let iniciando = $state<number | null>(null);
  let marcandoAusente = $state<number | null>(null);
  let reintentando = $state<number | null>(null);

  const hoy = new Date().toLocaleDateString('en-CA');

  // El filtro de "mi dia" (activas + completadas hoy) ya lo aplica el
  // backend via ?fecha_dia= (M11): el servidor solo devuelve lo que esta
  // vista necesita, en vez de traer hasta 100 OT y descartar la mayoria
  // aca, que es justo el costo mas caro sobre red celular.
  const resumen = $derived({
    total: ots.length,
    completadas: ots.filter((o) => o.estado === 'COMPLETADA').length,
    pendientes: ots.filter((o) => o.estado !== 'COMPLETADA').length,
  });

  const fechaFormateada = $derived(
    new Date().toLocaleDateString('es-CL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  );

  onMount(() => {
    authStore.checkAuth();
    const state = get(authStore);

    if (!state.isAuthenticated) {
      goto('/login');
      return;
    }
    if (state.usuario?.rol !== 'TECNICO') {
      goto('/dashboard');
      return;
    }

    token = state.token ?? '';
    nombreTecnico = state.usuario?.nombre_usuario ?? '';
    userId = state.usuario?.userId ?? 0;
    cargarOTs();
  });

  async function cargarOTs() {
    loading = true;
    errorMsg = '';
    try {
      const result = await ordenesApi.listarOT(token, { fecha_dia: hoy, limit: 30 });
      ots = result.data;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al cargar órdenes';
    } finally {
      loading = false;
    }
  }

  async function iniciarTrabajo(idOT: number) {
    iniciando = idOT;
    errorMsg = '';
    try {
      await ordenesApi.actualizarEstado(token, idOT, 'EN_CURSO');
      await cargarOTs();
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al iniciar trabajo';
    } finally {
      iniciando = null;
    }
  }

  async function marcarClienteAusente(idOT: number) {
    const obs = window.prompt('Observación de cliente ausente');
    if (!obs || obs.trim().length < 10) {
      errorMsg = 'La observación debe tener al menos 10 caracteres';
      return;
    }

    marcandoAusente = idOT;
    errorMsg = '';
    try {
      await ordenesApi.actualizarEstado(
        token,
        idOT,
        'PENDIENTE_CLIENTE_AUSENTE',
        undefined,
        obs.trim(),
      );
      await cargarOTs();
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al marcar cliente ausente';
    } finally {
      marcandoAusente = null;
    }
  }

  async function reintentarVisita(idOT: number) {
    reintentando = idOT;
    errorMsg = '';
    try {
      await ordenesApi.actualizarEstado(token, idOT, 'ASIGNADA');
      await cargarOTs();
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al reintentar la visita';
    } finally {
      reintentando = null;
    }
  }

  function cerrarSesion() {
    authStore.logout();
  }
</script>

<div class="min-h-screen bg-gray-50 flex flex-col">
  <!-- Header fijo -->
  <header class="bg-slate-900 text-white px-4 py-3 sticky top-0 z-10 shadow-lg">
    <div class="flex items-center justify-between">
      <div>
        <div class="flex items-center gap-2 mb-0.5">
          <div class="bg-white rounded px-1.5 py-0.5">
            <img src="/logo_finet.png" alt="FiNet" class="h-5 w-auto" />
          </div>
          <span class="text-sm font-semibold text-slate-100">{nombreTecnico}</span>
        </div>
        <p class="text-xs text-slate-400 capitalize">{fechaFormateada}</p>
      </div>
      <button
        onclick={cerrarSesion}
        class="flex items-center gap-1.5 text-xs text-slate-300 hover:text-red-400 border border-slate-700 hover:border-red-500 px-3 py-1.5 rounded-lg transition-colors"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Salir
      </button>
    </div>
  </header>

  <main class="flex-1 px-4 py-5 space-y-4">
    {#if errorMsg}
      <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
        {errorMsg}
      </div>
    {/if}

    <!-- Resumen del día -->
    <div class="grid grid-cols-3 gap-3">
      <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-3 text-center">
        <p class="text-2xl font-bold text-slate-800">{resumen.total}</p>
        <p class="text-xs text-slate-500 mt-0.5">Total</p>
      </div>
      <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-3 text-center">
        <p class="text-2xl font-bold text-green-600">{resumen.completadas}</p>
        <p class="text-xs text-slate-500 mt-0.5">Completadas</p>
      </div>
      <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-3 text-center">
        <p class="text-2xl font-bold text-blue-600">{resumen.pendientes}</p>
        <p class="text-xs text-slate-500 mt-0.5">Pendientes</p>
      </div>
    </div>

    <!-- Lista de OT -->
    {#if loading}
      <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-8 text-center">
        <svg class="animate-spin h-8 w-8 text-blue-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <p class="text-slate-400 text-sm">Cargando órdenes...</p>
      </div>
    {:else if ots.length === 0}
      <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-8 text-center">
        <svg class="w-12 h-12 text-slate-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p class="text-slate-400 text-sm">No tienes ordenes asignadas para hoy</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each ots as ot}
          <div class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div class="p-4">
              <!-- Badges -->
              <div class="flex items-center gap-2 flex-wrap mb-2">
                <span class="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                  {ot.tipo_ot}
                </span>
                <EstadoBadge estado={ot.prioridad} />
                <EstadoBadge estado={ot.estado} />
                {#if ot.cliente?.es_conflictivo}
                  <span class="text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                    CONFLICTIVO
                  </span>
                {/if}
              </div>

              <!-- Cliente y dirección -->
              <p class="font-semibold text-slate-800 text-base">{ot.cliente?.nombre_completo ?? '-'}</p>
              <p class="text-sm text-slate-500 mt-0.5">
                {ot.direccion?.direccion_completa ?? '-'}, {ot.direccion?.comuna ?? ''}
              </p>

              <!-- Bloque horario -->
              {#if ot.fecha_programada}
                <p class="text-xs text-slate-400 mt-1">
                  Programada: {new Date(ot.fecha_programada).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              {/if}

              {#if ot.tipo_ot === 'REPARACION' && ot.cliente?.id_cliente}
                <button
                  onclick={() => historialClienteId = ot.cliente?.id_cliente ?? null}
                  class="mt-2 flex items-center gap-1.5 text-xs text-orange-600 hover:text-orange-800 font-medium"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Ver historial fallas
                </button>
              {/if}
            </div>

            <!-- Acciones -->
            {#if ot.estado === 'ASIGNADA'}
              <div class="px-4 pb-4 space-y-2">
                <button
                  onclick={() => iniciarTrabajo(ot.id_ot)}
                  disabled={iniciando === ot.id_ot}
                  class="w-full bg-blue-600 active:bg-blue-800 text-white font-semibold py-4 rounded-xl text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {#if iniciando === ot.id_ot}
                    <svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Iniciando...
                  {:else}
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Iniciar trabajo
                  {/if}
                </button>
                <button
                  onclick={() => marcarClienteAusente(ot.id_ot)}
                  disabled={marcandoAusente === ot.id_ot}
                  class="w-full bg-amber-100 active:bg-amber-200 text-amber-800 font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50"
                >
                  {marcandoAusente === ot.id_ot ? 'Marcando...' : 'Cliente ausente'}
                </button>
              </div>
            {:else if ot.estado === 'EN_CURSO'}
              <div class="px-4 pb-4 space-y-2">
                <button
                  onclick={() => goto(`/terreno/cerrar/${ot.id_ot}`)}
                  class="w-full bg-green-600 active:bg-green-800 text-white font-semibold py-4 rounded-xl text-base transition-colors flex items-center justify-center gap-2"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Cerrar OT
                </button>
                <button
                  onclick={() => marcarClienteAusente(ot.id_ot)}
                  disabled={marcandoAusente === ot.id_ot}
                  class="w-full bg-amber-100 active:bg-amber-200 text-amber-800 font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50"
                >
                  {marcandoAusente === ot.id_ot ? 'Marcando...' : 'Cliente ausente'}
                </button>
              </div>
            {:else if ot.estado === 'PENDIENTE_CLIENTE_AUSENTE'}
              <div class="px-4 pb-4 space-y-2">
                <div class="w-full bg-amber-50 text-amber-700 font-semibold py-3 rounded-xl text-sm text-center border border-amber-200">
                  Cliente ausente
                </div>
                <button
                  onclick={() => reintentarVisita(ot.id_ot)}
                  disabled={reintentando === ot.id_ot}
                  class="w-full bg-indigo-600 active:bg-indigo-800 text-white font-semibold py-4 rounded-xl text-base transition-colors disabled:opacity-50"
                >
                  {reintentando === ot.id_ot ? 'Reintentando...' : 'Reintentar visita'}
                </button>
              </div>
            {:else if ot.estado === 'COMPLETADA'}
              <div class="px-4 pb-4">
                <div class="w-full bg-green-50 text-green-700 font-semibold py-3 rounded-xl text-sm text-center border border-green-200">
                  Completada
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>

<!-- Bottom sheet: historial de fallas -->
{#if historialClienteId !== null}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50" onclick={() => historialClienteId = null}>
    <div class="absolute inset-0 bg-black/50" aria-hidden="true"></div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[85vh] flex flex-col"
      onclick={(e: MouseEvent) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
    >
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <h3 class="font-semibold text-slate-800">Historial de Fallas</h3>
        <button
          onclick={() => historialClienteId = null}
          class="text-slate-400 hover:text-slate-600 p-1"
          aria-label="Cerrar"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="overflow-y-auto flex-1 p-4">
        <HistorialFallasPanel id_cliente={historialClienteId} compact={true} />
      </div>
    </div>
  </div>
{/if}
