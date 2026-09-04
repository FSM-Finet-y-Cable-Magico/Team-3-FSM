<script lang="ts">
  // VISTA DE PRUEBA — no corresponde a ningún CU del catálogo oficial
  // (revisado: los 96 CU son de inventario/equipos, ninguno pide monitoreo
  // de red). Se hizo solo para ver cómo se vería con datos reales del CSV de
  // SmartOLT. Se borra junto con lib/api/monitoreo.api.ts una vez corroborada.
  // No tiene link en el menú: se accede escribiendo /monitoreo-prueba.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import { obtenerResumenMonitoreo, listarOnt } from '$lib/api/monitoreo.api';
  import type { ResumenMonitoreo, OntVista } from '$lib/api/monitoreo.api';

  let resumen = $state<ResumenMonitoreo | null>(null);
  let filas = $state<OntVista[]>([]);
  let cargando = $state(true);
  let error = $state('');

  const colorEstado: Record<string, string> = {
    ONLINE: 'bg-green-100 text-green-700',
    OFFLINE: 'bg-gray-200 text-gray-700',
    POWER_FAIL: 'bg-orange-100 text-orange-700',
    LOS: 'bg-red-100 text-red-700',
    DESCONOCIDO: 'bg-yellow-100 text-yellow-700',
  };

  onMount(async () => {
    const state = get(authStore);
    const token = state.token ?? '';
    try {
      [resumen, filas] = await Promise.all([
        obtenerResumenMonitoreo(token),
        listarOnt(token, 1, 100),
      ]);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al cargar monitoreo';
    } finally {
      cargando = false;
    }
  });
</script>

<div class="space-y-6">
  <div class="bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-lg px-4 py-2">
    <strong>Vista de prueba</strong> — no es un CU oficial, es solo para ver cómo se vería.
    Se borra después de corroborarla.
  </div>

  <div>
    <h1 class="text-2xl font-bold text-gray-800">Monitoreo de red (prueba)</h1>
    <p class="text-sm text-gray-500 mt-0.5">Datos del export CSV de SmartOLT, cargados en el módulo de monitoreo.</p>
  </div>

  {#if cargando}
    <p class="text-sm text-gray-400">Cargando...</p>
  {:else if error}
    <div class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
  {:else}
    {#if resumen}
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div class="bg-white rounded-xl border p-4">
          <p class="text-xs text-gray-500">Total ONT</p>
          <p class="text-2xl font-bold text-gray-800">{resumen.total_ont}</p>
        </div>
        {#each Object.entries(resumen.por_estado) as [estado, cantidad]}
          <div class="bg-white rounded-xl border p-4">
            <p class="text-xs text-gray-500">{estado}</p>
            <p class="text-2xl font-bold text-gray-800">{cantidad}</p>
          </div>
        {/each}
        <div class="bg-white rounded-xl border p-4">
          <p class="text-xs text-gray-500">Potencia fuera de rango</p>
          <p class="text-2xl font-bold text-red-600">{resumen.potencia_fuera_de_rango}</p>
        </div>
      </div>
      <p class="text-xs text-gray-400">Actualizado: {new Date(resumen.fecha_actualizacion).toLocaleString('es-CL')}</p>
    {/if}

    <div class="bg-white rounded-xl border overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 text-gray-500 text-xs uppercase">
          <tr>
            <th class="px-4 py-2 text-left">SN</th>
            <th class="px-4 py-2 text-left">OLT</th>
            <th class="px-4 py-2 text-left">Zona</th>
            <th class="px-4 py-2 text-left">Estado</th>
            <th class="px-4 py-2 text-left">Potencia (dBm)</th>
            <th class="px-4 py-2 text-left">Cliente (referencia export)</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          {#each filas as f}
            <tr>
              <td class="px-4 py-2 font-mono text-xs">{f.numero_serie}</td>
              <td class="px-4 py-2">{f.olt_externo ?? '-'}</td>
              <td class="px-4 py-2">{f.zona ?? '-'}</td>
              <td class="px-4 py-2">
                <span class="px-2 py-0.5 rounded-full text-xs font-medium {colorEstado[f.estado_conexion ?? 'DESCONOCIDO']}">
                  {f.estado_conexion ?? 'DESCONOCIDO'}
                </span>
              </td>
              <td class="px-4 py-2 {f.potencia_fuera_de_rango ? 'text-red-600 font-semibold' : ''}">
                {f.potencia_actual_dbm ?? '-'}
              </td>
              <td class="px-4 py-2 text-xs text-gray-500 truncate max-w-xs">{f.nombre_cliente_ext ?? '-'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="text-xs text-gray-400 px-4 py-2 border-t">Mostrando las primeras 100 de {resumen?.total_ont ?? '?'}.</p>
    </div>
  {/if}
</div>
