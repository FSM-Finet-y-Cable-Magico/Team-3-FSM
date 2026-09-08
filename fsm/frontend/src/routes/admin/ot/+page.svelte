<script lang="ts">
  import Paginacion from '$lib/components/Paginacion.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Cargando from '$lib/components/Cargando.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as ordenesApi from '$lib/api/ordenes.api';
  import EstadoBadge from '$lib/components/EstadoBadge.svelte';

  let token = '';
  let rol = $state('');

  let ots = $state<ordenesApi.OT[]>([]);
  let total = $state(0);
  let page = $state(1);
  const limit = 20;
  let loading = $state(true);
  let errorMsg = $state('');

  let filtroEstado = $state('');
  let filtroTipo = $state('');
  let filtroPrioridad = $state('');

  onMount(() => {
    authStore.checkAuth();
    const state = get(authStore);

    if (!state.isAuthenticated) {
      goto('/login');
      return;
    }
    if (!['ADMIN', 'JEFE_TECNICO', 'TECNICO'].includes(state.usuario?.rol ?? '')) {
      goto('/admin/dashboard');
      return;
    }

    token = state.token ?? '';
    rol = state.usuario?.rol ?? '';
    cargarOTs();
  });

  async function cargarOTs() {
    loading = true;
    errorMsg = '';
    try {
      const result = await ordenesApi.listarOT(token, {
        estado: filtroEstado || undefined,
        tipo_ot: filtroTipo || undefined,
        prioridad: filtroPrioridad || undefined,
        page,
        limit,
      });
      ots = result.data;
      total = result.total;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al cargar órdenes';
    } finally {
      loading = false;
    }
  }

  function aplicarFiltros() {
    page = 1;
    cargarOTs();
  }

  function formatFecha(fecha?: string): string {
    if (!fecha) return '—';
    return new Date(fecha).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  const esJefeOAdmin = $derived(rol === 'ADMIN' || rol === 'JEFE_TECNICO');
</script>

<!-- Encabezado -->
<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
  <div>
    <h2 class="text-2xl font-bold text-slate-800">Órdenes de Trabajo</h2>
    <p class="text-slate-500 text-sm mt-0.5">Gestión y seguimiento de órdenes</p>
  </div>
  {#if esJefeOAdmin}
    <a
      href="/admin/ot/nueva"
      class="btn btn-primario"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
      </svg>
      Nueva OT
    </a>
  {/if}
</div>

<!-- Filtros (solo JT/ADMIN) -->
{#if esJefeOAdmin}
  <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6">
    <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Filtros</p>
    <div class="flex flex-wrap gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-slate-600">Estado</label>
        <select
          bind:value={filtroEstado}
          onchange={aplicarFiltros}
          class="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">Todos</option>
          <option>PENDIENTE</option>
          <option>PENDIENTE_CLIENTE_AUSENTE</option>
          <option>ASIGNADA</option>
          <option>EN_CURSO</option>
          <option>COMPLETADA</option>
          <option>CANCELADA</option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-slate-600">Tipo</label>
        <select
          bind:value={filtroTipo}
          onchange={aplicarFiltros}
          class="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">Todos</option>
          <option>INSTALACION</option>
          <option>REPARACION</option>
          <option>REEMPLAZO</option>
          <option>PREVENTIVO</option>
          <option>BAJA</option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-slate-600">Prioridad</label>
        <select
          bind:value={filtroPrioridad}
          onchange={aplicarFiltros}
          class="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">Todas</option>
          <option>CRITICA</option>
          <option>ALTA</option>
          <option>MEDIA</option>
          <option>BAJA</option>
        </select>
      </div>
      {#if filtroEstado || filtroTipo || filtroPrioridad}
        <div class="flex items-end">
          <button
            onclick={() => { filtroEstado = ''; filtroTipo = ''; filtroPrioridad = ''; aplicarFiltros(); }}
            class="btn btn-secundario btn-chico"
          >
            Limpiar
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if errorMsg}
  <Alert class="rounded-xl mb-5 text-sm">{errorMsg}</Alert>
{/if}

<!-- Tabla -->
{#if loading}
  <Cargando mensaje="Cargando órdenes..." class="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center" spinnerClass="h-8 w-8 text-blue-500 mx-auto mb-3" mensajeClass="text-slate-400 text-sm" />
{:else}
  <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
    <table class="min-w-full divide-y divide-slate-100">
      <thead>
        <tr class="bg-slate-50">
          <th class="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">ID</th>
          <th class="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Cliente</th>
          <th class="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Tipo</th>
          <th class="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Prioridad</th>
          <th class="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Estado</th>
          <th class="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Técnico</th>
          <th class="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Creación</th>
          <th class="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        {#each ots as ot}
          <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-5 py-4 text-sm font-mono font-semibold text-slate-500">#{ot.id_ot}</td>
            <td class="px-5 py-4">
              <p class="text-sm font-medium text-slate-800">{ot.cliente?.nombre_completo ?? '—'}</p>
              <p class="text-xs font-mono text-slate-400">{ot.cliente?.rut ?? ''}</p>
            </td>
            <td class="px-5 py-4 text-sm text-slate-600 font-medium">{ot.tipo_ot}</td>
            <td class="px-5 py-4"><EstadoBadge estado={ot.prioridad} size="sm" /></td>
            <td class="px-5 py-4"><EstadoBadge estado={ot.estado} size="sm" /></td>
            <td class="px-5 py-4 text-sm text-slate-500">{ot.tecnico?.nombre_completo ?? '—'}</td>
            <td class="px-5 py-4 text-sm text-slate-400">{formatFecha(ot.fecha_creacion)}</td>
            <td class="px-5 py-4">
              {#if ot.estado === 'PENDIENTE_CLIENTE_AUSENTE'}
                <p class="text-xs text-amber-700 font-medium mb-1">{ot.antiguedad_dias ?? 0} dias pendiente</p>
              {/if}
              <button
                onclick={() => goto(`/ot/${ot.id_ot}`)}
                class="btn-texto hover:underline whitespace-nowrap"
              >
                Ver →
              </button>
            </td>
          </tr>
        {/each}
        {#if ots.length === 0}
          <tr>
            <td colspan="8" class="px-5 py-12 text-center text-slate-400 text-sm">
              No hay órdenes de trabajo
            </td>
          </tr>
        {/if}
      </tbody>
    </table>

    <Paginacion {page} {limit} {total} entidad="OT" onchange={(nuevaPagina) => { page = nuevaPagina; cargarOTs(); }} />
  </div>
{/if}
