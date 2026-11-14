<script lang="ts">
  import { formatearRut } from '$lib/utils/rut';
  import SemaforoRiesgo from '$lib/components/SemaforoRiesgo.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { authStore } from '$lib/stores/auth.store';
  import * as clientesApi from '$lib/api/clientes.api';
  import HistorialFallasPanel from '$lib/components/HistorialFallasPanel.svelte';

  let token = '';
  let loading = $state(true);
  let errorMsg = $state('');

  let cliente: clientesApi.ClienteFicha | null = $state(null);
  let historialOT: clientesApi.HistorialOT[] = $state([]);
  let alertaReparaciones: clientesApi.ClienteConHistorial['alerta_reparaciones_30_dias'] = $state(undefined);

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

  function formatearFechaISO(fecha: string): string {
    // Llega como YYYY-MM-DD. Se arma en hora local porque new Date(iso) lo
    // interpretaria como UTC y en Chile mostraria el dia anterior.
    const [anio, mes, dia] = fecha.split('-').map(Number);
    if (!anio || !mes || !dia) return fecha;
    return new Date(anio, mes - 1, dia).toLocaleDateString('es-CL');
  }

  function formatearPrecio(valor: number | null | undefined): string {
    if (valor === null || valor === undefined || Number.isNaN(valor)) return 'N/A';
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(valor);
  }

</script>
    {#if loading}
      <div class="text-center py-8 text-gray-500">Cargando...</div>
    {:else if errorMsg}
      <Alert class="rounded-lg">{errorMsg}</Alert>
      <a href="/admin/clientes" class="btn-texto mt-4">&larr; Volver a clientes</a>
    {:else if cliente}
      <a href="/admin/clientes" class="btn-texto mb-4">&larr; Volver a clientes</a>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-2">
        <!-- Columna izquierda: Datos del cliente -->
        <div class="lg:col-span-2">
          <div class="bg-white rounded-xl shadow p-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-xl font-bold text-gray-800">{cliente.nombre_completo}</h2>
            </div>

              <div class="space-y-3">
                <div>
                  <span class="text-xs text-gray-500 uppercase">RUT</span>
                  <p class="text-sm font-mono">{formatearRut(cliente.rut)}</p>
                </div>
                <div>
                  <span class="text-xs text-gray-500 uppercase">Zona</span>
                  {#if cliente.zona}
                    <p class="text-sm">
                      {cliente.zona.nombre}
                      <span class="text-xs text-gray-500">({cliente.zona.origen === 'MONITOREO' ? 'según el monitoreo' : 'según la caja NAP'})</span>
                    </p>
                  {:else}
                    <p class="text-sm text-gray-500">Sin zona registrada</p>
                  {/if}
                </div>
                <div>
                  <span class="text-xs text-gray-500 uppercase">Estado</span>
                  <span class="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {estadoColor(cliente.estado)}">
                    {cliente.estado}
                  </span>
                </div>
                <div>
                  <SemaforoRiesgo nivel={cliente.nivel_riesgo ?? (cliente.es_conflictivo ? 'ROJO' : 'VERDE')} />
                  {#if cliente.obs_conflictivo}
                    <p class="text-sm text-slate-600 mt-1">{cliente.obs_conflictivo}</p>
                  {/if}
                </div>
                {#if alertaReparaciones?.activa}
                  <div class="bg-orange-50 border border-orange-200 text-orange-800 px-4 py-3 rounded-lg">
                    <p class="text-sm font-semibold">Alerta por reparaciones recurrentes</p>
                    <p class="text-sm mt-0.5">
                      {alertaReparaciones.total_reparaciones_30_dias}
                      reparaciones completadas en los ultimos 30 dias.
                    </p>
                    <!-- RF-08 pide "la lista de OT asociadas". Antes solo se veia
                         el numero: el jefe tecnico leia "5 reparaciones" y no
                         tenia como saber cuales eran ni de que fueron. -->
                    {#if alertaReparaciones.ots?.length}
                      <ul class="mt-2 space-y-1">
                        {#each alertaReparaciones.ots as ot (ot.id_ot)}
                          <li class="text-sm">
                            <a
                              href="/admin/ot/{ot.id_ot}"
                              class="font-medium underline cursor-pointer rounded
                                     hover:text-orange-950 focus:outline-none
                                     focus-visible:ring-2 focus-visible:ring-orange-500"
                            >OT #{ot.id_ot}</a>
                            {#if ot.fecha_completada}
                              · {new Date(ot.fecha_completada).toLocaleDateString('es-CL')}
                            {/if}
                            {#if ot.categoria_falla}
                              · {ot.categoria_falla}
                            {/if}
                          </li>
                        {/each}
                      </ul>
                    {/if}
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
                {#if cliente.contratos_activos && cliente.contratos_activos.length > 0}
                  <details class="mt-4">
                    <summary class="cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-800">
                      Servicios activos ({cliente.contratos_activos.length})
                    </summary>
                    <div class="mt-2 space-y-3">
                      {#each cliente.contratos_activos as servicio (servicio.id_contrato)}
                        <div class="border border-gray-200 rounded-lg p-4 bg-gray-50">
                          {#if servicio.plan}
                            <span class="text-sm font-semibold text-gray-800">{servicio.plan.nombre_comercial}</span>
                            <div class="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-600">
                              <span>
                                {servicio.plan.velocidad_mbps !== null
                                  ? servicio.plan.velocidad_mbps + ' Mbps'
                                  : 'Velocidad no definida'}
                              </span>
                              <span class="text-right font-medium">{formatearPrecio(servicio.plan.precio_mensual)}</span>
                            </div>
                          {:else}
                            <span class="text-sm font-semibold text-gray-500 italic">Plan no asignado</span>
                          {/if}
                          <p class="text-xs text-gray-400 mt-1">
                            Inicio: {formatearFechaISO(servicio.fecha_inicio)}
                          </p>
                        </div>
                      {/each}
                    </div>
                  </details>
                {:else}
                  <div class="mt-4">
                    <p class="text-sm text-gray-500">Sin servicios activos</p>
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
                {#each historialOT as ot (ot.id_ot)}
                  <a
                    href="/admin/ot/{ot.id_ot}"
                    class="block border-b border-gray-100 pb-3 last:border-0 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                  >
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
                  </a>
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
