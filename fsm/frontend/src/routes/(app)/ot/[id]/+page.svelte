<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { authStore } from '$lib/stores/auth.store';
  import * as ordenesApi from '$lib/api/ordenes.api';
  import EstadoBadge from '$lib/components/EstadoBadge.svelte';

  let token = '';
  let rol = $state('');
  let userId = $state(0);

  let ot = $state<ordenesApi.OT | null>(null);
  let tecnicos = $state<ordenesApi.Tecnico[]>([]);
  let loading = $state(true);
  let errorMsg = $state('');

  let idTecnicoAsignar = $state('');
  let bloqueHorarioAsignarFecha = $state('');
  let bloqueHorarioAsignarHora = $state('');

  const bloqueHorarioAsignar = $derived(
    bloqueHorarioAsignarFecha && bloqueHorarioAsignarHora
      ? (() => {
          const d = new Date(`${bloqueHorarioAsignarFecha}T${bloqueHorarioAsignarHora}:00`);
          return isNaN(d.getTime()) ? '' : d.toISOString();
        })()
      : '',
  );
  let asignando = $state(false);
  let asignarError = $state('');

  let mostrarModalCancelar = $state(false);
  let obsCancelacion = $state('');
  let cancelando = $state(false);
  let cancelarError = $state('');

  let cambiandoEstado = $state(false);

  const idOT = $derived(+$page.params.id);

  onMount(() => {
    authStore.checkAuth();
    const state = get(authStore);

    if (!state.isAuthenticated) {
      goto('/login');
      return;
    }
    if (!['ADMIN', 'JEFE_TECNICO', 'TECNICO'].includes(state.usuario?.rol ?? '')) {
      goto('/dashboard');
      return;
    }

    token = state.token ?? '';
    rol = state.usuario?.rol ?? '';
    userId = state.usuario?.userId ?? 0;
    cargarDatos();
  });

  async function cargarDatos() {
    loading = true;
    errorMsg = '';
    try {
      ot = await ordenesApi.obtenerOT(token, idOT);
      if (rol !== 'TECNICO') {
        tecnicos = await ordenesApi.listarTecnicos(token);
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al cargar OT';
    } finally {
      loading = false;
    }
  }

  async function asignarTecnico() {
    if (!idTecnicoAsignar) {
      asignarError = 'Seleccione un técnico';
      return;
    }
    asignando = true;
    asignarError = '';
    try {
      ot = await ordenesApi.asignarTecnico(token, idOT, {
        id_tecnico: +idTecnicoAsignar,
        bloque_horario: bloqueHorarioAsignar || undefined,
      });
    } catch (err) {
      asignarError = err instanceof Error ? err.message : 'Error al asignar';
    } finally {
      asignando = false;
    }
  }

  async function cambiarEstado(nuevoEstado: string) {
    cambiandoEstado = true;
    try {
      ot = await ordenesApi.actualizarEstado(token, idOT, nuevoEstado);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al actualizar estado';
    } finally {
      cambiandoEstado = false;
    }
  }

  async function confirmarCancelacion() {
    if (obsCancelacion.trim().length < 10) {
      cancelarError = 'El motivo debe tener al menos 10 caracteres';
      return;
    }
    cancelando = true;
    cancelarError = '';
    try {
      ot = await ordenesApi.actualizarEstado(token, idOT, 'CANCELADA', obsCancelacion);
      mostrarModalCancelar = false;
      obsCancelacion = '';
    } catch (err) {
      cancelarError = err instanceof Error ? err.message : 'Error al cancelar';
    } finally {
      cancelando = false;
    }
  }

  function formatFecha(fecha?: string): string {
    if (!fecha) return '-';
    return new Date(fecha).toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const esMiOT = $derived(ot?.id_tecnico === userId);
</script>

{#if loading}
  <div class="text-center py-12 text-gray-500">Cargando orden de trabajo...</div>
{:else if errorMsg}
  <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{errorMsg}</div>
{:else if ot}
  <div class="max-w-3xl mx-auto space-y-5">
    <div class="flex items-center gap-3">
      <button onclick={() => goto('/ot')} class="text-gray-400 hover:text-gray-600 text-lg">&larr;</button>
      <h2 class="text-xl font-bold text-gray-800">Orden de Trabajo #{ot.id_ot}</h2>
    </div>

    <div class="bg-white rounded-xl shadow p-6">
      <div class="flex items-start justify-between mb-4">
        <div class="flex items-center gap-3 flex-wrap">
          <span class="font-medium text-gray-600 text-sm">{ot.tipo_ot}</span>
          <EstadoBadge estado={ot.prioridad} />
          <EstadoBadge estado={ot.estado} />
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <p class="text-gray-500 text-xs font-medium uppercase mb-0.5">Cliente</p>
          <p class="text-gray-900 font-medium">{ot.cliente?.nombre_completo ?? '-'}</p>
          <p class="text-gray-500 font-mono text-xs">{ot.cliente?.rut ?? ''}</p>
        </div>
        <div>
          <p class="text-gray-500 text-xs font-medium uppercase mb-0.5">Dirección</p>
          <p class="text-gray-900">
            {ot.direccion?.direccion_completa ?? ot.cliente?.direcciones?.[0]?.direccion_completa ?? '-'}
          </p>
          <p class="text-gray-500 text-xs">
            {ot.direccion?.comuna ?? ot.cliente?.direcciones?.[0]?.comuna ?? ''}
          </p>
        </div>
        <div>
          <p class="text-gray-500 text-xs font-medium uppercase mb-0.5">Técnico asignado</p>
          <p class="text-gray-900">{ot.tecnico?.nombre_completo ?? 'Sin asignar'}</p>
        </div>
        <div>
          <p class="text-gray-500 text-xs font-medium uppercase mb-0.5">Fechas</p>
          <p class="text-gray-700">Creación: {formatFecha(ot.fecha_creacion)}</p>
          {#if ot.fecha_programada}
            <p class="text-gray-700">Programada: {formatFecha(ot.fecha_programada)}</p>
          {/if}
          {#if ot.fecha_completada}
            <p class="text-gray-700">Completada: {formatFecha(ot.fecha_completada)}</p>
          {/if}
        </div>
        {#if ot.observaciones}
          <div class="sm:col-span-2">
            <p class="text-gray-500 text-xs font-medium uppercase mb-0.5">Observaciones</p>
            <p class="text-gray-700">{ot.observaciones}</p>
          </div>
        {/if}
        {#if ot.estado === 'CANCELADA' && ot.observaciones}
          <div class="sm:col-span-2">
            <p class="text-gray-500 text-xs font-medium uppercase mb-0.5">Motivo de cancelación</p>
            <p class="text-red-700">{ot.observaciones}</p>
          </div>
        {/if}
      </div>
    </div>

    <!-- Panel de acciones -->
    {#if ot.estado !== 'COMPLETADA' && ot.estado !== 'CANCELADA'}
      <div class="bg-white rounded-xl shadow p-6">
        <h3 class="font-semibold text-gray-700 mb-4">Acciones</h3>

        {#if ot.estado === 'PENDIENTE' && (rol === 'ADMIN' || rol === 'JEFE_TECNICO')}
          <div class="space-y-3">
            <p class="text-sm text-gray-600">Asignar técnico a esta OT:</p>
            <select
              bind:value={idTecnicoAsignar}
              class="w-full border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Seleccione técnico</option>
              {#each tecnicos as t}
                <option value={t.id_usuario}>
                  {t.nombre_completo} ({t.ot_activas_hoy} OT activas)
                </option>
              {/each}
            </select>
            <div class="grid grid-cols-2 gap-2">
              <input
                type="date"
                bind:value={bloqueHorarioAsignarFecha}
                class="w-full border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="time"
                bind:value={bloqueHorarioAsignarHora}
                class="w-full border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <p class="text-xs text-gray-400">Bloque horario opcional — formato 24h</p>
            {#if asignarError}
              <p class="text-red-500 text-sm">{asignarError}</p>
            {/if}
            <button
              onclick={asignarTecnico}
              disabled={asignando}
              class="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-5 rounded-lg transition-colors disabled:opacity-50 text-sm"
            >
              {asignando ? 'Asignando...' : 'Asignar técnico'}
            </button>
          </div>

        {:else if ot.estado === 'ASIGNADA' && (rol === 'ADMIN' || rol === 'JEFE_TECNICO')}
          <div class="flex gap-3 flex-wrap">
            <button
              onclick={() => cambiarEstado('EN_CURSO')}
              disabled={cambiandoEstado}
              class="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-5 rounded-lg transition-colors disabled:opacity-50 text-sm"
            >
              Marcar OT en curso
            </button>
            <button
              onclick={() => (mostrarModalCancelar = true)}
              class="bg-red-100 hover:bg-red-200 text-red-700 font-medium py-2 px-5 rounded-lg transition-colors text-sm"
            >
              Cancelar OT
            </button>
          </div>

        {:else if ot.estado === 'ASIGNADA' && rol === 'TECNICO'}
          <button
            onclick={() => cambiarEstado('EN_CURSO')}
            disabled={cambiandoEstado}
            class="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-5 rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            Iniciar trabajo
          </button>

        {:else if ot.estado === 'EN_CURSO' && rol === 'TECNICO'}
          <button
            onclick={() => goto(`/ot/${ot!.id_ot}/cerrar`)}
            class="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-5 rounded-lg transition-colors text-sm"
          >
            Ir a cerrar OT
          </button>

        {:else if ot.estado === 'EN_CURSO' && (rol === 'ADMIN' || rol === 'JEFE_TECNICO')}
          <button
            onclick={() => (mostrarModalCancelar = true)}
            class="bg-red-100 hover:bg-red-200 text-red-700 font-medium py-2 px-5 rounded-lg transition-colors text-sm"
          >
            Cancelar OT
          </button>
        {/if}
      </div>
    {:else}
      <div class="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 text-sm text-gray-500">
        Esta OT se encuentra en estado final: <strong>{ot.estado}</strong>. No hay acciones disponibles.
      </div>
    {/if}

    <!-- Historial -->
    {#if ot.historial && ot.historial.length > 0}
      <div class="bg-white rounded-xl shadow p-6">
        <h3 class="font-semibold text-gray-700 mb-4">Historial de estados</h3>
        <div class="space-y-3">
          {#each ot.historial as h}
            <div class="flex gap-3">
              <div class="flex flex-col items-center">
                <div class="w-2.5 h-2.5 rounded-full bg-blue-400 mt-1 flex-shrink-0"></div>
                <div class="w-px flex-1 bg-gray-200 mt-1"></div>
              </div>
              <div class="pb-3">
                <div class="flex items-center gap-2 flex-wrap">
                  {#if h.estado_anterior}
                    <EstadoBadge estado={h.estado_anterior} size="sm" />
                    <span class="text-gray-400 text-xs">&rarr;</span>
                  {/if}
                  {#if h.estado_nuevo}
                  <EstadoBadge estado={h.estado_nuevo} size="sm" />
                  {/if}
                  <span class="text-gray-400 text-xs">{formatFecha(h.fecha_hora)}</span>
                </div>
                {#if h.observaciones}
                  <p class="text-xs text-gray-500 mt-1">{h.observaciones}</p>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<!-- Modal cancelar -->
{#if mostrarModalCancelar}
  <div
    class="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
    role="dialog"
    aria-modal="true"
  >
    <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
      <h3 class="font-semibold text-gray-800 mb-3">Cancelar OT #{ot?.id_ot}</h3>
      <p class="text-sm text-gray-600 mb-4">Indique el motivo de cancelación (mínimo 10 caracteres):</p>
      <textarea
        bind:value={obsCancelacion}
        rows={4}
        maxlength={500}
        class="w-full border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
        placeholder="Motivo de cancelación..."
      ></textarea>
      {#if cancelarError}
        <p class="text-red-500 text-sm mt-2">{cancelarError}</p>
      {/if}
      <div class="flex gap-3 mt-4">
        <button
          onclick={() => { mostrarModalCancelar = false; cancelarError = ''; }}
          class="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors text-sm"
        >
          Volver
        </button>
        <button
          onclick={confirmarCancelacion}
          disabled={cancelando}
          class="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 text-sm"
        >
          {cancelando ? 'Cancelando...' : 'Confirmar cancelación'}
        </button>
      </div>
    </div>
  </div>
{/if}
