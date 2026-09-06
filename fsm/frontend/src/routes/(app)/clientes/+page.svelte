<script lang="ts">
  import Paginacion from '$lib/components/Paginacion.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Cargando from '$lib/components/Cargando.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as clientesApi from '$lib/api/clientes.api';
  import RutInput from '$lib/components/RutInput.svelte';

  interface ClienteListItem {
    id_cliente: number;
    rut: string;
    nombre_completo: string;
    estado: string;
    es_conflictivo: boolean;
    fecha_creacion: string;
    direccion_principal?: { direccion_completa: string; comuna: string; ciudad?: string };
  }

  let token = '';
  let rol = $state('');
  let clientes = $state<ClienteListItem[]>([]);
  let total = $state(0);
  let page = $state(1);
  let limit = 20;
  let loading = $state(true);
  let errorMsg = $state('');

  let rutBusqueda = $state('');
  let rutValido = $state(false);
  let buscando = $state(false);
  let busquedaError = $state('');

  let clienteEncontrado: clientesApi.ClienteConHistorial | null = $state(null);
  let showFicha = $state(false);

  onMount(() => {
    authStore.checkAuth();
    const state = get(authStore);

    if (!state.isAuthenticated) {
      goto('/login');
      return;
    }
    if (!['ADMIN', 'JEFE_TECNICO'].includes(state.usuario?.rol ?? '')) {
      goto(state.usuario?.rol === 'TECNICO' ? '/terreno' : '/dashboard');
      return;
    }

    token = state.token ?? '';
    rol = state.usuario?.rol ?? '';
    cargarClientes();
  });

  async function cargarClientes() {
    loading = true;
    errorMsg = '';
    try {
      const result = await clientesApi.listarClientes(token, page, limit);
      clientes = result.data;
      total = result.total;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al cargar clientes';
    } finally {
      loading = false;
    }
  }

  function handleRutChange({ rut, valido }: { rut: string; valido: boolean }) {
    rutBusqueda = rut;
    rutValido = valido;
  }

  async function buscarPorRut() {
    if (!rutValido || !rutBusqueda) {
      busquedaError = 'Ingrese un RUT válido';
      return;
    }
    buscando = true;
    busquedaError = '';
    clienteEncontrado = null;
    try {
      clienteEncontrado = await clientesApi.buscarPorRut(token, rutBusqueda);
      showFicha = true;
    } catch (err) {
      busquedaError = err instanceof Error ? err.message : 'Error al buscar';
    } finally {
      buscando = false;
    }
  }

  function cerrarFicha() {
    showFicha = false;
    clienteEncontrado = null;
    rutBusqueda = '';
    rutValido = false;
    busquedaError = '';
  }

  const estadoConfig: Record<string, { bg: string; text: string }> = {
    ACTIVO:     { bg: 'bg-green-100',  text: 'text-green-800' },
    SUSPENDIDO: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
    CORTADO:    { bg: 'bg-red-100',    text: 'text-red-800' },
    BAJA:       { bg: 'bg-gray-100',   text: 'text-gray-600' },
    PENDIENTE:  { bg: 'bg-blue-100',   text: 'text-blue-800' },
  };

  function estadoClase(estado: string) {
    const c = estadoConfig[estado] ?? { bg: 'bg-gray-100', text: 'text-gray-600' };
    return `${c.bg} ${c.text}`;
  }
</script>

<!-- Encabezado -->
<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
  <div>
    <h2 class="text-2xl font-bold text-slate-800">Clientes</h2>
    <p class="text-slate-500 text-sm mt-0.5">Gestión de clientes y fichas</p>
  </div>
  {#if rol !== 'TECNICO'}
    <a
      href="/clientes/nuevo"
      class="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-5 rounded-xl shadow-sm transition-all duration-150 text-sm"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
      </svg>
      Nuevo Cliente
    </a>
  {/if}
</div>

<!-- Búsqueda por RUT -->
<div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6">
  <p class="text-sm font-medium text-slate-700 mb-3">Búsqueda rápida por RUT</p>
  <div class="flex items-end gap-3">
    <div class="flex-1">
      <RutInput onchange={handleRutChange} />
    </div>
    <button
      onclick={buscarPorRut}
      disabled={buscando}
      class="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white font-medium py-2.5 px-5 rounded-xl transition-all disabled:opacity-50 text-sm"
    >
      {#if buscando}
        <Spinner class="h-4 w-4" />
      {:else}
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      {/if}
      {buscando ? 'Buscando...' : 'Buscar'}
    </button>
  </div>
  {#if busquedaError}
    <p class="text-red-500 text-sm mt-2">{busquedaError}</p>
  {/if}
</div>

<!-- Ficha del cliente encontrado -->
{#if showFicha && clienteEncontrado}
  <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6">
    <div class="flex items-start justify-between">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <h3 class="font-semibold text-slate-800">{clienteEncontrado.cliente.nombre_completo}</h3>
          {#if clienteEncontrado.cliente.es_conflictivo}
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
              CONFLICTIVO
            </span>
          {/if}
        </div>
        <p class="text-slate-500 font-mono text-sm">{clienteEncontrado.cliente.rut}</p>
        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-2 {estadoClase(clienteEncontrado.cliente.estado)}">
          {clienteEncontrado.cliente.estado}
        </span>
      </div>
      <button onclick={cerrarFicha} class="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div class="mt-4 pt-4 border-t border-slate-100 flex gap-3">
      <button
        onclick={() => goto(`/clientes/${clienteEncontrado!.cliente.rut}`)}
        class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-xl transition-colors"
      >
        Ver ficha completa
      </button>
    </div>
  </div>
{/if}

{#if errorMsg}
  <Alert class="rounded-xl mb-5 text-sm">{errorMsg}</Alert>
{/if}

<!-- Tabla de clientes -->
{#if loading}
  <Cargando mensaje="Cargando clientes..." class="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center" spinnerClass="h-8 w-8 text-blue-500 mx-auto mb-3" mensajeClass="text-slate-400 text-sm" />
{:else}
  <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
    <table class="min-w-full divide-y divide-slate-100">
      <thead>
        <tr class="bg-slate-50">
          <th class="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">RUT</th>
          <th class="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Nombre</th>
          <th class="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Estado</th>
          <th class="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Comuna</th>
          <th class="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Conflictivo</th>
          <th class="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Acción</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        {#each clientes as c}
          <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 text-sm font-mono text-slate-700">{c.rut}</td>
            <td class="px-6 py-4">
              <p class="text-sm font-medium text-slate-800">{c.nombre_completo}</p>
            </td>
            <td class="px-6 py-4">
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {estadoClase(c.estado)}">
                {c.estado}
              </span>
            </td>
            <td class="px-6 py-4 text-sm text-slate-500">{c.direccion_principal?.comuna ?? '—'}</td>
            <td class="px-6 py-4">
              {#if c.es_conflictivo}
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">Sí</span>
              {:else}
                <span class="text-slate-300 text-sm">—</span>
              {/if}
            </td>
            <td class="px-6 py-4">
              <button
                onclick={() => goto(`/clientes/${c.rut}`)}
                class="text-blue-600 hover:text-blue-800 text-sm font-semibold hover:underline transition-colors"
              >
                Ver ficha →
              </button>
            </td>
          </tr>
        {/each}
        {#if clientes.length === 0}
          <tr>
            <td colspan="6" class="px-6 py-12 text-center text-slate-400 text-sm">
              No hay clientes registrados
            </td>
          </tr>
        {/if}
      </tbody>
    </table>

    <Paginacion {page} {limit} {total} entidad="clientes" onchange={(nuevaPagina) => { page = nuevaPagina; cargarClientes(); }} />
  </div>
{/if}
