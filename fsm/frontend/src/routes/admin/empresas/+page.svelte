<script lang="ts">
  // CU-34: datos consolidados de las empresas. El ADMIN administra FiNet y
  // Cable Magico y las compara aca, lado a lado, con los mismos indicadores.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.store';
  import Alert from '$lib/components/Alert.svelte';
  import { obtenerConsolidado, type FilaConsolidado } from '$lib/api/dashboard.api';

  let filas = $state<FilaConsolidado[]>([]);
  let totales = $state<Omit<FilaConsolidado, 'id_empresa' | 'nombre'> | null>(null);
  let cargando = $state(true);
  let error = $state('');

  onMount(async () => {
    authStore.checkAuth();
    const estado = get(authStore);
    if (!estado.isAuthenticated || estado.usuario?.rol !== 'ADMIN') {
      goto('/admin/dashboard');
      return;
    }
    try {
      const r = await obtenerConsolidado(estado.token ?? '');
      filas = r.empresas;
      totales = r.totales;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al cargar el consolidado';
    } finally {
      cargando = false;
    }
  });

  const COLUMNAS: { clave: keyof Omit<FilaConsolidado, 'id_empresa' | 'nombre'>; etiqueta: string }[] = [
    { clave: 'clientes_activos', etiqueta: 'Clientes activos' },
    { clave: 'ot_activas', etiqueta: 'OT activas' },
    { clave: 'ot_por_aprobar', etiqueta: 'Cierres por aprobar' },
    { clave: 'ot_completadas_30_dias', etiqueta: 'Completadas (30 días)' },
  ];
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-slate-800">Empresas</h1>
    <p class="text-sm text-slate-600">Datos consolidados de las empresas que administras.</p>
  </div>

  {#if error}
    <Alert>{error}</Alert>
  {/if}

  {#if cargando}
    <p role="status" class="text-slate-500">Cargando...</p>
  {:else if totales}
    <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table class="w-full text-sm">
        <caption class="sr-only">Indicadores por empresa</caption>
        <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
          <tr>
            <th scope="col" class="px-4 py-2 text-left font-semibold">Empresa</th>
            {#each COLUMNAS as c (c.clave)}
              <th scope="col" class="px-4 py-2 text-right font-semibold">{c.etiqueta}</th>
            {/each}
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each filas as f (f.id_empresa)}
            <tr>
              <th scope="row" class="px-4 py-2 text-left font-medium text-slate-900">{f.nombre}</th>
              {#each COLUMNAS as c (c.clave)}
                <td class="px-4 py-2 text-right tabular-nums">{f[c.clave]}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
        <tfoot class="bg-slate-50 font-semibold">
          <tr>
            <th scope="row" class="px-4 py-2 text-left">Total</th>
            {#each COLUMNAS as c (c.clave)}
              <td class="px-4 py-2 text-right tabular-nums">{totales[c.clave]}</td>
            {/each}
          </tr>
        </tfoot>
      </table>
    </div>
  {/if}
</div>
