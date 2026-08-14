<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { authStore } from '$lib/stores/auth.store';
  import * as clientesApi from '$lib/api/clientes.api';
  import InputField from '$lib/components/InputField.svelte';
  import HistorialFallasPanel from '$lib/components/HistorialFallasPanel.svelte';

  let token = '';
  let rol = $state('');
  let loading = $state(true);
  let errorMsg = $state('');

  let cliente: clientesApi.ClienteFicha | null = $state(null);
  let historialOT: clientesApi.HistorialOT[] = $state([]);
  let alertaReparaciones: clientesApi.ClienteConHistorial['alerta_reparaciones_30_dias'] = $state(undefined);

  let editMode = $state(false);
  let editNombre = $state('');
  let editEmail = $state('');
  let editTelefono = $state('');
  let editEstado = $state('');
  let editDireccion = $state('');
  let editComuna = $state('');
  let editCiudad = $state('');
  let editLoading = $state(false);
  let editError = $state('');

  let showConflictivoModal = $state(false);
  let motivoConflictivo = $state('');
  let conflictivoLoading = $state(false);
  let conflictivoError = $state('');

  onMount(() => {
    authStore.checkAuth();
    const state = get(authStore);

    if (!state.isAuthenticated || !['ADMIN', 'JEFE_TECNICO', 'TECNICO'].includes(state.usuario?.rol ?? '')) {
      goto('/dashboard');
      return;
    }

    token = state.token ?? '';
    rol = state.usuario?.rol ?? '';

    const rut = $page.params.id;
    if (rut) {
      cargarCliente(rut);
    }
  });

  async function cargarCliente(rut: string) {
    loading = true;
    errorMsg = '';
    try {
      const result = await clientesApi.buscarPorRut(token, rut);
      cliente = result.cliente;
      historialOT = result.historial_ot;
      alertaReparaciones = result.alerta_reparaciones_30_dias;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al cargar cliente';
    } finally {
      loading = false;
    }
  }

  function iniciarEdicion() {
    if (!cliente) return;
    editNombre = cliente.nombre_completo;
    editEmail = cliente.email ?? '';
    editTelefono = cliente.telefono ?? '';
    editEstado = cliente.estado;
    editDireccion = cliente.direccion_principal?.direccion_completa ?? '';
    editComuna = cliente.direccion_principal?.comuna ?? '';
    editCiudad = cliente.direccion_principal?.ciudad ?? '';
    editError = '';
    editMode = true;
  }

  function cancelarEdicion() {
    editMode = false;
  }

  async function guardarEdicion() {
    if (!cliente) return;
    editLoading = true;
    editError = '';
    try {
      await clientesApi.editarCliente(token, cliente.id_cliente, {
        nombre_completo: editNombre,
        email: editEmail || undefined,
        telefono: editTelefono || undefined,
        estado: editEstado,
        direccion_completa: editDireccion,
        comuna: editComuna,
        ciudad: editCiudad || undefined,
      });
      editMode = false;
      await cargarCliente(cliente.rut);
    } catch (err) {
      editError = err instanceof Error ? err.message : 'Error al guardar';
    } finally {
      editLoading = false;
    }
  }

  async function confirmarConflictivo() {
    if (!cliente || motivoConflictivo.length < 10) return;
    conflictivoLoading = true;
    conflictivoError = '';
    try {
      await clientesApi.marcarConflictivo(token, cliente.id_cliente, motivoConflictivo);
      showConflictivoModal = false;
      motivoConflictivo = '';
      await cargarCliente(cliente.rut);
    } catch (err) {
      conflictivoError = err instanceof Error ? err.message : 'Error al marcar';
    } finally {
      conflictivoLoading = false;
    }
  }

  function estadoColor(estado: string): string {
    const map: Record<string, string> = {
      ACTIVO: 'bg-green-100 text-green-800',
      SUSPENDIDO: 'bg-yellow-100 text-yellow-800',
      CORTADO: 'bg-red-100 text-red-800',
      BAJA: 'bg-gray-100 text-gray-800',
      PENDIENTE: 'bg-blue-100 text-blue-800',
    };
    return map[estado] ?? 'bg-gray-100 text-gray-800';
  }

</script>
    {#if loading}
      <div class="text-center py-8 text-gray-500">Cargando...</div>
    {:else if errorMsg}
      <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{errorMsg}</div>
      <a href="/clientes" class="text-blue-600 hover:text-blue-800 text-sm mt-4 inline-block">&larr; Volver a clientes</a>
    {:else if cliente}
      <a href="/clientes" class="text-blue-600 hover:text-blue-800 text-sm mb-4 inline-block">&larr; Volver a clientes</a>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-2">
        <!-- Columna izquierda: Datos del cliente -->
        <div class="lg:col-span-2">
          <div class="bg-white rounded-xl shadow p-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-xl font-bold text-gray-800">{cliente.nombre_completo}</h2>
              <div class="flex gap-2">
                {#if rol !== 'TECNICO' && !editMode}
                  <button onclick={iniciarEdicion} class="text-sm text-blue-600 hover:text-blue-800 font-medium">Editar ficha</button>
                  {#if !cliente.es_conflictivo}
                    <button onclick={() => showConflictivoModal = true} class="text-sm text-red-600 hover:text-red-800 font-medium">
                      Marcar conflictivo
                    </button>
                  {/if}
                {/if}
              </div>
            </div>

            {#if !editMode}
              <div class="space-y-3">
                <div>
                  <span class="text-xs text-gray-500 uppercase">RUT</span>
                  <p class="text-sm font-mono">{cliente.rut}</p>
                </div>
                <div>
                  <span class="text-xs text-gray-500 uppercase">Estado</span>
                  <span class="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {estadoColor(cliente.estado)}">
                    {cliente.estado}
                  </span>
                </div>
              {#if cliente.es_conflictivo}
                <div>
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">CONFLICTIVO</span>
                    {#if cliente.obs_conflictivo}
                      <p class="text-sm text-red-600 mt-1">{cliente.obs_conflictivo}</p>
                    {/if}
                  </div>
                {/if}
                {#if alertaReparaciones?.activa}
                  <div class="bg-orange-50 border border-orange-200 text-orange-800 px-4 py-3 rounded-lg">
                    <p class="text-sm font-semibold">Alerta por reparaciones recurrentes</p>
                    <p class="text-sm mt-0.5">
                      {alertaReparaciones.total_reparaciones_30_dias}
                      reparaciones registradas en los ultimos 30 dias.
                    </p>
                  </div>
                {/if}
                {#if cliente.email}
                  <div>
                    <span class="text-xs text-gray-500 uppercase">Email</span>
                    <p class="text-sm">{cliente.email}</p>
                  </div>
                {/if}
                {#if cliente.telefono}
                  <div>
                    <span class="text-xs text-gray-500 uppercase">Teléfono</span>
                    <p class="text-sm">{cliente.telefono}</p>
                  </div>
                {/if}
                {#if cliente.direccion_principal}
                  <div>
                    <span class="text-xs text-gray-500 uppercase">Dirección</span>
                    <p class="text-sm">{cliente.direccion_principal.direccion_completa}</p>
                    <p class="text-sm text-gray-500">{cliente.direccion_principal.comuna}{cliente.direccion_principal.ciudad ? ', ' + cliente.direccion_principal.ciudad : ''}</p>
                  </div>
                {/if}
                {#if cliente.contrato_activo}
                  <div>
                    <span class="text-xs text-gray-500 uppercase">Plan contratado</span>
                    <p class="text-sm">{cliente.contrato_activo.plan.nombre_comercial} ({cliente.contrato_activo.plan.velocidad_mbps} Mbps)</p>
                  </div>
                {/if}
                {#if cliente.unidad_instalada}
                  <div>
                    <span class="text-xs text-gray-500 uppercase">Equipo instalado</span>
                    <p class="text-sm">{cliente.unidad_instalada.modelo} - S/N: {cliente.unidad_instalada.numero_serie}</p>
                  </div>
                {/if}
                <div>
                  <span class="text-xs text-gray-500 uppercase">Fecha registro</span>
                  <p class="text-sm">{new Date(cliente.fecha_creacion).toLocaleDateString('es-CL')}</p>
                </div>
              </div>
            {:else}
              <!-- Modo edición -->
              <div class="space-y-4">
                <InputField label="Nombre completo" bind:value={editNombre} />
                <InputField label="Email" bind:value={editEmail} />
                <InputField label="Teléfono" bind:value={editTelefono} />
                <div class="mb-4">
                  <label for="edit-estado" class="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                  <select id="edit-estado" bind:value={editEstado} class="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    <option value="ACTIVO">ACTIVO</option>
                    <option value="SUSPENDIDO">SUSPENDIDO</option>
                    <option value="CORTADO">CORTADO</option>
                    <option value="BAJA">BAJA</option>
                    <option value="PENDIENTE">PENDIENTE</option>
                  </select>
                </div>
                <InputField label="Dirección" bind:value={editDireccion} />
                <InputField label="Comuna" bind:value={editComuna} />
                <InputField label="Ciudad" bind:value={editCiudad} />

                {#if editError}
                  <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{editError}</div>
                {/if}

                <div class="flex gap-3">
                  <button
                    onclick={guardarEdicion}
                    disabled={editLoading}
                    class="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {editLoading ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                  <button
                    onclick={cancelarEdicion}
                    class="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            {/if}
          </div>
        </div>

        <!-- Columna derecha: Historial OT -->
        <div class="lg:col-span-1">
          <div class="bg-white rounded-xl shadow p-6">
            <h3 class="text-lg font-semibold text-gray-800 mb-4">Historial de OT</h3>
            {#if historialOT.length === 0}
              <p class="text-sm text-gray-500">Sin órdenes de trabajo registradas</p>
            {:else}
              <div class="space-y-3">
                {#each historialOT as ot}
                  <div class="border-b border-gray-100 pb-3 last:border-0">
                    <div class="flex items-center justify-between">
                      <span class="text-sm font-medium">{ot.tipo_ot}</span>
                      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium {estadoColor(ot.estado)}">
                        {ot.estado}
                      </span>
                    </div>
                    <p class="text-xs text-gray-500 mt-1">
                      Prioridad: {ot.prioridad}
                    </p>
                    <p class="text-xs text-gray-400">
                      {new Date(ot.fecha_creacion).toLocaleDateString('es-CL')}
                      {#if ot.fecha_completada}
                        &rarr; {new Date(ot.fecha_completada).toLocaleDateString('es-CL')}
                      {/if}
                    </p>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Historial de Fallas -->
      <div class="mt-6 bg-white rounded-xl shadow p-6">
        <div class="flex items-center gap-2 mb-4">
          <svg class="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <h3 class="text-lg font-semibold text-gray-800">Historial de Fallas</h3>
        </div>
        <HistorialFallasPanel id_cliente={cliente.id_cliente} compact={false} />
      </div>
    {/if}

<!-- Modal Marcar conflictivo -->
{#if showConflictivoModal}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e: MouseEvent) => { if (e.target === e.currentTarget) showConflictivoModal = false; }}
    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') showConflictivoModal = false; }}
  >
    <div class="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
      <h3 class="text-lg font-semibold text-gray-800 mb-4">Marcar como conflictivo</h3>
      <div class="mb-4">
        <label for="motivo" class="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
        <textarea
          id="motivo"
          bind:value={motivoConflictivo}
          rows="4"
          maxlength="500"
          class="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Describa el motivo (mín. 10 caracteres)"
        ></textarea>
        <p class="text-xs text-gray-400 mt-1">{motivoConflictivo.length}/500</p>
      </div>

      {#if conflictivoError}
        <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{conflictivoError}</div>
      {/if}

      <div class="flex gap-3">
        <button
          onclick={confirmarConflictivo}
          disabled={conflictivoLoading || motivoConflictivo.length < 10}
          class="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
        >
          {conflictivoLoading ? 'Confirmando...' : 'Confirmar'}
        </button>
        <button
          onclick={() => showConflictivoModal = false}
          class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  </div>
{/if}
