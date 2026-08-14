<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as ordenesApi from '$lib/api/ordenes.api';
  import * as clientesApi from '$lib/api/clientes.api';
  import RutInput from '$lib/components/RutInput.svelte';

  let token = '';

  let paso = $state(1);

  let rutCliente = $state('');
  let rutValido = $state(false);
  let buscando = $state(false);
  let busquedaError = $state('');
  let clienteEncontrado: clientesApi.ClienteConHistorial | null = $state(null);

  let tecnicos = $state<ordenesApi.Tecnico[]>([]);
  let tipoOT = $state('');
  let prioridad = $state('MEDIA');
  let idTecnico = $state('');
  let bloqueDia = $state('');
  let bloqueMes = $state('');
  let bloqueAnio = $state('');
  let bloqueHora = $state('');
  let observaciones = $state('');

  function buildBloqueHorario(): string | undefined {
    if (!bloqueDia || !bloqueMes || !bloqueAnio || !bloqueHora) return undefined;
    const dd = String(bloqueDia).padStart(2, '0');
    const mm = String(bloqueMes).padStart(2, '0');
    const yyyy = String(bloqueAnio);
    const off = new Date().getTimezoneOffset();
    const sign = off <= 0 ? '+' : '-';
    const oh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
    const om = String(Math.abs(off) % 60).padStart(2, '0');
    const iso = `${yyyy}-${mm}-${dd}T${bloqueHora}:00${sign}${oh}:${om}`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  let creando = $state(false);
  let crearError = $state('');

  onMount(() => {
    authStore.checkAuth();
    const state = get(authStore);

    if (!state.isAuthenticated) {
      goto('/login');
      return;
    }
    if (!['ADMIN', 'JEFE_TECNICO'].includes(state.usuario?.rol ?? '')) {
      goto('/dashboard');
      return;
    }

    token = state.token ?? '';
    cargarTecnicos();
  });

  async function cargarTecnicos() {
    try {
      tecnicos = await ordenesApi.listarTecnicos(token);
    } catch {
      // no critical
    }
  }

  function handleRutChange({ rut, valido }: { rut: string; valido: boolean }) {
    rutCliente = rut;
    rutValido = valido;
  }

  async function buscarCliente() {
    if (!rutValido || !rutCliente) {
      busquedaError = 'Ingrese un RUT válido';
      return;
    }
    buscando = true;
    busquedaError = '';
    clienteEncontrado = null;
    try {
      clienteEncontrado = await clientesApi.buscarPorRut(token, rutCliente);
      paso = 2;
    } catch (err) {
      busquedaError = err instanceof Error ? err.message : 'Cliente no encontrado';
    } finally {
      buscando = false;
    }
  }

  function volverPaso1() {
    paso = 1;
    clienteEncontrado = null;
    rutCliente = '';
    rutValido = false;
    crearError = '';
  }

  const bloqueadoPorConflictivo = $derived.by(() => {
    return Boolean(clienteEncontrado?.cliente.es_conflictivo && tipoOT === 'INSTALACION');
  });

  async function crearOT() {
    if (!clienteEncontrado || !tipoOT) {
      crearError = 'Seleccione tipo de OT';
      return;
    }
    if (bloqueadoPorConflictivo) return;

    creando = true;
    crearError = '';
    try {
      const nueva = await ordenesApi.crearOT(token, {
        rut_cliente: rutCliente,
        tipo_ot: tipoOT,
        prioridad,
        id_tecnico: idTecnico ? +idTecnico : undefined,
        bloque_horario: buildBloqueHorario(),
        observaciones: observaciones || undefined,
      });
      goto(`/ot/${nueva.id_ot}`);
    } catch (err) {
      crearError = err instanceof Error ? err.message : 'Error al crear OT';
    } finally {
      creando = false;
    }
  }
</script>

<div class="max-w-2xl mx-auto">
  <div class="flex items-center gap-3 mb-6">
    <button onclick={() => goto('/ot')} class="text-gray-400 hover:text-gray-600 text-lg">&larr;</button>
    <h2 class="text-2xl font-bold text-gray-800">Nueva Orden de Trabajo</h2>
  </div>

  <div class="flex items-center gap-2 mb-6">
    <div class="flex items-center gap-2">
      <span
        class="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold
        {paso >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}"
      >1</span>
      <span class="text-sm {paso === 1 ? 'font-medium text-blue-700' : 'text-gray-500'}">Buscar cliente</span>
    </div>
    <div class="flex-1 h-px bg-gray-200 mx-2"></div>
    <div class="flex items-center gap-2">
      <span
        class="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold
        {paso >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}"
      >2</span>
      <span class="text-sm {paso === 2 ? 'font-medium text-blue-700' : 'text-gray-500'}">Datos de la OT</span>
    </div>
  </div>

  {#if paso === 1}
    <div class="bg-white rounded-xl shadow p-6">
      <h3 class="font-semibold text-gray-700 mb-4">Buscar cliente por RUT</h3>
      <div class="flex items-end gap-4">
        <div class="flex-1">
          <RutInput onchange={handleRutChange} />
        </div>
        <button
          onclick={buscarCliente}
          disabled={buscando}
          class="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
        >
          {buscando ? 'Buscando...' : 'Buscar'}
        </button>
      </div>
      {#if busquedaError}
        <p class="text-red-500 text-sm mt-3">{busquedaError}</p>
      {/if}
    </div>
  {/if}

  {#if paso === 2 && clienteEncontrado}
    <div class="space-y-4">
      <div class="bg-white rounded-xl shadow p-5">
        <div class="flex items-start justify-between">
          <div>
            <h3 class="font-semibold text-gray-800">{clienteEncontrado.cliente.nombre_completo}</h3>
            <p class="text-sm font-mono text-gray-500">{clienteEncontrado.cliente.rut}</p>
            <p class="text-sm text-gray-500 mt-1">
              {clienteEncontrado.cliente.direccion_principal?.direccion_completa ?? 'Sin dirección'},
              {clienteEncontrado.cliente.direccion_principal?.comuna ?? ''}
            </p>
            <span class="inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              {clienteEncontrado.cliente.estado}
            </span>
          </div>
          {#if clienteEncontrado.cliente.es_conflictivo}
            <span class="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">CONFLICTIVO</span>
          {/if}
        </div>

        {#if clienteEncontrado.cliente.es_conflictivo}
          <div class="mt-3 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
            Este cliente está marcado como conflictivo.
            {#if tipoOT === 'INSTALACION'}
              No se pueden crear OT de instalación para clientes conflictivos.
            {/if}
          </div>
        {/if}
      </div>

      <div class="bg-white rounded-xl shadow p-6">
        <h3 class="font-semibold text-gray-700 mb-5">Datos de la OT</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Tipo de OT *</label>
            <select
              bind:value={tipoOT}
              class="w-full border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Seleccione tipo</option>
              <option>INSTALACION</option>
              <option>REPARACION</option>
              <option>REEMPLAZO</option>
              <option>PREVENTIVO</option>
              <option>BAJA</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Prioridad</label>
            <select
              bind:value={prioridad}
              class="w-full border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option>CRITICA</option>
              <option>ALTA</option>
              <option>MEDIA</option>
              <option>BAJA</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Técnico asignado <span class="text-gray-400 text-xs">(opcional — si no se asigna queda PENDIENTE)</span>
            </label>
            <select
              bind:value={idTecnico}
              class="w-full border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Sin asignar</option>
              {#each tecnicos as t}
                <option value={t.id_usuario}>
                  {t.nombre_completo} ({t.ot_activas_hoy} OT activas hoy)
                </option>
              {/each}
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Bloque horario <span class="text-gray-400 text-xs">(opcional)</span>
            </label>
            <div class="flex items-center gap-1 flex-wrap">
              <input
                type="number" min="1" max="31"
                bind:value={bloqueDia}
                placeholder="DD"
                class="w-14 border rounded-lg px-2 py-2 text-sm text-center text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span class="text-gray-400 font-medium">/</span>
              <input
                type="number" min="1" max="12"
                bind:value={bloqueMes}
                placeholder="MM"
                class="w-14 border rounded-lg px-2 py-2 text-sm text-center text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span class="text-gray-400 font-medium">/</span>
              <input
                type="number" min="2024" max="2099"
                bind:value={bloqueAnio}
                placeholder="AAAA"
                class="w-20 border rounded-lg px-2 py-2 text-sm text-center text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span class="text-gray-400 text-xs ml-1">a las</span>
              <input
                type="time"
                bind:value={bloqueHora}
                class="border rounded-lg px-2 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Observaciones <span class="text-gray-400 text-xs">(opcional, máx. 1000 chars)</span>
            </label>
            <textarea
              bind:value={observaciones}
              maxlength={1000}
              rows={3}
              class="w-full border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            ></textarea>
          </div>
        </div>

        {#if crearError}
          <div class="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {crearError}
          </div>
        {/if}

        <div class="flex gap-3 mt-6">
          <button
            onclick={volverPaso1}
            class="border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors text-sm"
          >
            Volver
          </button>
          <button
            onclick={crearOT}
            disabled={creando || !tipoOT || bloqueadoPorConflictivo}
            class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            {creando ? 'Creando...' : 'Crear OT'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
