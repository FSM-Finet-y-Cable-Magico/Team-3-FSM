<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as historialApi from '$lib/api/historial.api';
  import EstadoBadge from './EstadoBadge.svelte';

  interface Props {
    id_cliente: number;
    compact?: boolean;
  }

  let { id_cliente, compact = false }: Props = $props();

  let data = $state<historialApi.HistorialFallasResponse | null>(null);
  let loading = $state(true);
  let error = $state('');
  let expandido = $state<Set<number>>(new Set());

  onMount(async () => {
    const token = get(authStore).token ?? '';
    try {
      data = await historialApi.obtenerHistorialFallas(token, id_cliente);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Error al cargar historial';
    } finally {
      loading = false;
    }
  });

  function toggleFila(id: number) {
    const next = new Set(expandido);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandido = next;
  }

  function formatFecha(f: string) {
    return new Date(f).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  const potenciaEnRango = (p: number | null | undefined) =>
    p !== null && p !== undefined && p >= -24 && p <= -19;
</script>

{#if loading}
  <div class="flex items-center gap-2 py-4 text-slate-400 text-sm">
    <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
    </svg>
    Cargando historial...
  </div>
{:else if error}
  <p class="text-red-500 text-sm py-2">{error}</p>
{:else if data}

  {#if compact}
    <!-- ===== MODO COMPACT (terreno móvil) ===== -->

    {#if data.categoria_frecuente}
      <div class="flex items-center gap-2 bg-orange-50 border border-orange-200 text-orange-800 px-3 py-2 rounded-xl mb-3">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <p class="text-xs font-semibold">Falla frecuente: {data.categoria_frecuente.nombre}</p>
          {#if data.categoria_frecuente.sla_horas}
            <p class="text-xs opacity-75">SLA: {data.categoria_frecuente.sla_horas}h</p>
          {/if}
        </div>
      </div>
    {/if}

    <div class="grid grid-cols-2 gap-2 mb-3">
      <div class="bg-slate-50 rounded-xl p-3 text-center">
        <p class="text-xl font-bold text-slate-800">{data.estadisticas.total_reparaciones}</p>
        <p class="text-xs text-slate-500">Reparaciones</p>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 text-center">
        <p class="text-xl font-bold text-green-600">{data.estadisticas.reparaciones_completadas}</p>
        <p class="text-xs text-slate-500">Completadas</p>
      </div>
    </div>

    {#if data.historial.length === 0}
      <p class="text-sm text-slate-400 text-center py-4">Sin historial de reparaciones</p>
    {:else}
      <div class="space-y-2">
        {#each data.historial as ot}
          <div class="bg-slate-50 rounded-xl p-3 flex items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="text-xs text-slate-500">{formatFecha(ot.fecha_creacion)}</p>
              {#if ot.potencia_optica_dbm !== null && ot.potencia_optica_dbm !== undefined}
                <p class="text-xs {potenciaEnRango(ot.potencia_optica_dbm) ? 'text-green-600' : 'text-red-500'} font-medium">
                  {ot.potencia_optica_dbm} dBm
                </p>
              {/if}
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              {#if ot.fotos.length > 0}
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                  <circle cx="12" cy="13" r="3"/>
                </svg>
              {/if}
              <EstadoBadge estado={ot.estado} size="sm" />
            </div>
          </div>
        {/each}
      </div>
    {/if}

  {:else}
    <!-- ===== MODO COMPLETO (ficha escritorio) ===== -->

    <!-- Estadísticas -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
      <div class="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
        <div class="bg-orange-100 rounded-lg p-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-orange-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-slate-800">{data.estadisticas.total_reparaciones}</p>
          <p class="text-xs text-slate-500">Total reparaciones</p>
        </div>
      </div>

      <div class="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
        <div class="bg-green-100 rounded-lg p-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-slate-800">{data.estadisticas.reparaciones_completadas}</p>
          <p class="text-xs text-slate-500">Completadas</p>
        </div>
      </div>

      <div class="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
        <div class="bg-blue-100 rounded-lg p-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2"/>
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-slate-800">
            {data.estadisticas.tiempo_promedio_dias !== null ? data.estadisticas.tiempo_promedio_dias + 'd' : '—'}
          </p>
          <p class="text-xs text-slate-500">Tiempo promedio</p>
        </div>
      </div>

      <div class="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3
        {data.estadisticas.potencia_promedio_dbm !== null
          ? potenciaEnRango(data.estadisticas.potencia_promedio_dbm) ? 'ring-1 ring-green-300' : 'ring-1 ring-red-300'
          : ''}">
        <div class="{data.estadisticas.potencia_promedio_dbm !== null
          ? potenciaEnRango(data.estadisticas.potencia_promedio_dbm) ? 'bg-green-100' : 'bg-red-100'
          : 'bg-slate-100'} rounded-lg p-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 {data.estadisticas.potencia_promedio_dbm !== null
            ? potenciaEnRango(data.estadisticas.potencia_promedio_dbm) ? 'text-green-600' : 'text-red-600'
            : 'text-slate-400'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-slate-800">
            {data.estadisticas.potencia_promedio_dbm !== null ? data.estadisticas.potencia_promedio_dbm + ' dBm' : '—'}
          </p>
          <p class="text-xs text-slate-500">Potencia promedio</p>
        </div>
      </div>
    </div>

    <!-- Categoría frecuente -->
    {#if data.categoria_frecuente}
      <div class="flex items-center gap-3 bg-orange-50 border border-orange-200 text-orange-800 px-4 py-3 rounded-xl mb-5">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <p class="font-semibold text-sm">Falla mas frecuente: {data.categoria_frecuente.nombre}</p>
          {#if data.categoria_frecuente.sla_horas}
            <p class="text-xs opacity-75">SLA: {data.categoria_frecuente.sla_horas} horas</p>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Tabla -->
    {#if data.historial.length === 0}
      <div class="flex flex-col items-center gap-3 py-10 text-slate-400">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <p class="text-sm">Sin historial de reparaciones para este cliente</p>
      </div>
    {:else}
      <div class="overflow-x-auto rounded-xl border border-slate-200">
        <table class="min-w-full divide-y divide-slate-100 text-sm">
          <thead class="bg-slate-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Fecha</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Estado</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Potencia</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Remoto</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Fotos</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Materiales</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white">
            {#each data.historial as ot}
              <tr
                class="hover:bg-slate-50 transition-colors cursor-pointer"
                onclick={() => toggleFila(ot.id_ot)}
              >
                <td class="px-4 py-3 text-slate-700 whitespace-nowrap">{formatFecha(ot.fecha_creacion)}</td>
                <td class="px-4 py-3"><EstadoBadge estado={ot.estado} /></td>
                <td class="px-4 py-3 font-mono {ot.potencia_optica_dbm !== null && ot.potencia_optica_dbm !== undefined
                    ? potenciaEnRango(ot.potencia_optica_dbm) ? 'text-green-600' : 'text-red-500'
                    : 'text-slate-400'}">
                  {ot.potencia_optica_dbm !== null && ot.potencia_optica_dbm !== undefined ? ot.potencia_optica_dbm + ' dBm' : '—'}
                </td>
                <td class="px-4 py-3 text-slate-500">{ot.resuelto_remotamente ? 'Si' : 'No'}</td>
                <td class="px-4 py-3 text-slate-500">{ot.fotos.length > 0 ? ot.fotos.length : '—'}</td>
                <td class="px-4 py-3 text-slate-500">{ot.materiales.length > 0 ? ot.materiales.length : '—'}</td>
              </tr>
              {#if expandido.has(ot.id_ot)}
                <tr class="bg-slate-50">
                  <td colspan="6" class="px-4 py-4">
                    <div class="grid sm:grid-cols-3 gap-4 text-sm">
                      {#if ot.observaciones}
                        <div>
                          <p class="text-xs font-semibold text-slate-500 uppercase mb-1">Observaciones</p>
                          <p class="text-slate-700">{ot.observaciones}</p>
                        </div>
                      {/if}

                      {#if ot.materiales.length > 0}
                        <div>
                          <p class="text-xs font-semibold text-slate-500 uppercase mb-1">Materiales</p>
                          <ul class="space-y-0.5">
                            {#each ot.materiales as m}
                              <li class="text-slate-700">
                                {m.tipo_equipo?.nombre ?? 'Desconocido'} &times; {m.cantidad}
                              </li>
                            {/each}
                          </ul>
                        </div>
                      {/if}

                      {#if ot.categoria_falla}
                        <div>
                          <p class="text-xs font-semibold text-slate-500 uppercase mb-1">Categoria falla</p>
                          <p class="text-slate-700">{ot.categoria_falla.nombre}</p>
                          {#if ot.categoria_falla_otro}
                            <p class="text-slate-500 text-xs mt-0.5">{ot.categoria_falla_otro}</p>
                          {/if}
                        </div>
                      {/if}

                      {#if ot.llamada}
                        <div>
                          <p class="text-xs font-semibold text-slate-500 uppercase mb-1">Llamada cortesia</p>
                          <p class="font-medium {ot.llamada.resultado === 'CONFORME' ? 'text-green-600' : 'text-red-500'}">
                            {ot.llamada.resultado}
                          </p>
                          {#if ot.llamada.observaciones}
                            <p class="text-slate-500 text-xs mt-0.5">{ot.llamada.observaciones}</p>
                          {/if}
                        </div>
                      {/if}

                      {#if ot.fotos.length > 0}
                        <div class="sm:col-span-3">
                          <p class="text-xs font-semibold text-slate-500 uppercase mb-2">Fotos ({ot.fotos.length})</p>
                          <div class="flex gap-2 flex-wrap">
                            {#each ot.fotos.slice(0, 3) as foto}
                              <img
                                src={foto.url_cloudinary}
                                alt="evidencia"
                                class="h-16 w-16 object-cover rounded-lg border border-slate-200"
                              />
                            {/each}
                            {#if ot.fotos.length > 3}
                              <div class="h-16 w-16 rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center text-xs text-slate-500 font-medium">
                                +{ot.fotos.length - 3}
                              </div>
                            {/if}
                          </div>
                        </div>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

  {/if}
{/if}
