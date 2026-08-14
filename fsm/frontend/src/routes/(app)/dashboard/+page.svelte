<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { io, type Socket } from 'socket.io-client';
  import { authStore } from '$lib/stores/auth.store';
  import { dashboardStore } from '$lib/stores/dashboard.store';
  import { listarEmpresas } from '$lib/api/dashboard.api';
  import type { Empresa, IndicadoresDashboard } from '$lib/api/dashboard.api';
  import StatCard from '$lib/components/StatCard.svelte';
  import TecnicoCard from '$lib/components/TecnicoCard.svelte';

  const ICONO_CLOCK = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  const ICONO_LIGHTNING = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>`;
  const ICONO_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  const ICONO_EXCLAM = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`;
  const ICONO_USERS = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`;
  const ICONO_DESKTOP = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>`;
  const ICONO_REFRESH = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>`;

  let token = '';
  let rol = $state('');
  let id_empresa = $state(0);
  let empresas = $state<Empresa[]>([]);
  let empresaSeleccionada = $state<number>(0);
  let actualizando = $state(false);
  let indicadores = $state<IndicadoresDashboard | null>(null);
  let isLoading = $state(true);
  let ultimaActualizacion = $state<Date | null>(null);
  let socket: Socket | null = null;
  let intervalo: ReturnType<typeof setInterval> | null = null;
  let unsubDashboard: (() => void) | null = null;

  const tiempoDesdeActualizacion = $derived(() => {
    if (!ultimaActualizacion) return 'nunca';
    const diff = Math.floor((Date.now() - ultimaActualizacion.getTime()) / 1000);
    if (diff < 60) return 'hace un momento';
    return `hace ${Math.floor(diff / 60)} min`;
  });

  const fechaFormateada = $derived(
    new Date().toLocaleDateString('es-CL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  );

  onMount(() => {
    inicializarDashboard();

    return () => {
      unsubDashboard?.();
    };
  });

  async function inicializarDashboard() {
    authStore.checkAuth();
    const state = get(authStore);

    if (!state.isAuthenticated) {
      goto('/login');
      return;
    }
    if (state.usuario?.rol === 'TECNICO') {
      goto('/terreno');
      return;
    }

    token = state.token ?? '';
    rol = state.usuario?.rol ?? '';
    id_empresa = (state.usuario as unknown as { id_empresa?: number })?.id_empresa ?? 0;
    empresaSeleccionada = id_empresa;

    unsubDashboard = dashboardStore.subscribe((s) => {
      indicadores = s.indicadores;
      isLoading = s.isLoading;
      ultimaActualizacion = s.ultimaActualizacion;
    });

    await cargar();

    if (rol === 'ADMIN') {
      try {
        empresas = await listarEmpresas(token);
      } catch {}
    }

    socket = io('http://localhost:3000/dashboard', { auth: { token } });
    socket.emit('join_empresa', id_empresa);
    socket.on('dashboard_update', () => cargar());

    intervalo = setInterval(() => cargar(), 60000);
  }

  onDestroy(() => {
    socket?.disconnect();
    if (intervalo) clearInterval(intervalo);
  });

  async function cargar() {
    actualizando = true;
    await dashboardStore.cargarIndicadores(token, empresaSeleccionada || undefined);
    actualizando = false;
  }

  function horaCompletada(fecha: string) {
    return new Date(fecha).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-gray-800">Dashboard</h1>
      <p class="text-sm text-gray-500 capitalize mt-0.5">{fechaFormateada}</p>
    </div>
    <div class="flex items-center gap-3">
      {#if rol === 'ADMIN' && empresas.length > 1}
        <select
          bind:value={empresaSeleccionada}
          onchange={cargar}
          class="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {#each empresas as emp}
            <option value={emp.id_empresa}>{emp.nombre}</option>
          {/each}
        </select>
      {/if}
      <button
        onclick={cargar}
        disabled={actualizando}
        class="flex items-center gap-1.5 text-sm text-gray-600 hover:text-blue-600 border border-gray-300 hover:border-blue-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
      >
        <span class:animate-spin={actualizando}>{@html ICONO_REFRESH}</span>
        Actualizar
      </button>
    </div>
  </div>

  {#if isLoading && !indicadores}
    <!-- Skeleton loaders -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {#each [1, 2, 3, 4] as _}
        <div class="bg-white rounded-xl border p-6 animate-pulse">
          <div class="h-4 bg-gray-200 rounded w-2/3 mb-3"></div>
          <div class="h-8 bg-gray-200 rounded w-1/3 mb-2"></div>
          <div class="h-3 bg-gray-200 rounded w-1/2"></div>
        </div>
      {/each}
    </div>
    <div class="grid grid-cols-2 gap-4">
      {#each [1, 2] as _}
        <div class="bg-white rounded-xl border p-6 animate-pulse">
          <div class="h-4 bg-gray-200 rounded w-2/3 mb-3"></div>
          <div class="h-8 bg-gray-200 rounded w-1/3"></div>
        </div>
      {/each}
    </div>
  {:else if indicadores}
    <!-- Fila 1: 4 cards principales -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        titulo="OT Pendientes"
        valor={indicadores.ot_por_estado.PENDIENTE}
        color="yellow"
        icono={ICONO_CLOCK}
        clickable={true}
        href="/ot?estado=PENDIENTE"
      />
      <StatCard
        titulo="OT En Curso"
        valor={indicadores.ot_por_estado.EN_CURSO}
        color="blue"
        icono={ICONO_LIGHTNING}
        clickable={true}
        href="/ot?estado=EN_CURSO"
      />
      <StatCard
        titulo="Completadas Hoy"
        valor={indicadores.ot_por_estado.COMPLETADA}
        color="green"
        icono={ICONO_CHECK}
        clickable={true}
        href="/ot?estado=COMPLETADA"
      />
      <StatCard
        titulo="OT Criticas"
        valor={indicadores.ot_criticas_activas}
        color="red"
        icono={ICONO_EXCLAM}
        clickable={true}
        href="/ot?prioridad=CRITICA"
      />
    </div>

    <!-- Fila 2: 2 cards secundarias -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatCard
        titulo="Clientes Activos"
        valor={indicadores.total_clientes_activos}
        color="gray"
        icono={ICONO_USERS}
        clickable={true}
        href="/clientes"
      />
      <StatCard
        titulo="Resueltas Remotamente"
        valor={indicadores.resueltas_remotamente_hoy}
        subtitulo="hoy"
        color="orange"
        icono={ICONO_DESKTOP}
      />
      <StatCard
        titulo="Reparacion Recurrente"
        valor={indicadores.clientes_reparacion_recurrente}
        subtitulo="3+ en 30 dias"
        color="red"
        icono={ICONO_EXCLAM}
        clickable={true}
        href="/ot?tipo_ot=REPARACION"
      />
    </div>

    <!-- Fila 3: Técnicos + Últimas completadas -->
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div class="lg:col-span-3 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 class="text-base font-semibold text-gray-800 mb-4">Tecnicos del dia</h3>
        {#if indicadores.tecnicos.length === 0}
          <div class="flex flex-col items-center py-8 text-gray-400">
            <svg class="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <p class="text-sm">Sin tecnicos activos hoy</p>
          </div>
        {:else}
          <div class="space-y-2">
            {#each indicadores.tecnicos as tec}
              <TecnicoCard tecnico={tec} />
            {/each}
          </div>
        {/if}
      </div>

      <div class="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-gray-800">Ultimas completadas</h3>
          <a href="/ot?estado=COMPLETADA" class="text-xs text-blue-600 hover:text-blue-800 font-medium">
            Ver todas
          </a>
        </div>
        {#if indicadores.ultimas_completadas.length === 0}
          <p class="text-sm text-gray-400 py-4 text-center">Sin OT completadas hoy</p>
        {:else}
          <div class="space-y-3">
            {#each indicadores.ultimas_completadas as ot}
              <div class="flex items-start justify-between gap-2 pb-3 border-b border-gray-50 last:border-0 last:pb-0">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-gray-800 truncate">
                    {ot.cliente?.nombre_completo ?? '-'}
                  </p>
                  <p class="text-xs text-gray-500 truncate">
                    {ot.tecnico?.nombre_completo ?? '-'}
                  </p>
                </div>
                <div class="text-right flex-shrink-0">
                  <span class="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                    {ot.tipo_ot}
                  </span>
                  <p class="text-xs text-gray-400 mt-0.5">{horaCompletada(ot.fecha_completada)}</p>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Barra de estado -->
  <div class="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-gray-100">
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block"></span>
      Conectado en tiempo real
    </div>
    <span>Ultima actualizacion: {tiempoDesdeActualizacion()}</span>
  </div>
</div>
