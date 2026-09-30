<script lang="ts">
  // Catalogo de planes de la empresa activa, en solo lectura (acta con FiNet).
  // El alta y la edicion quedan pendientes de B-01: de quien son plan y
  // contrato, que tienen facturas y pagos del dominio comercial colgando.
  import Alert from '$lib/components/Alert.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import { listarPlanes, type PlanResumen } from '$lib/api/clientes.api';

  let planes = $state<PlanResumen[]>([]);
  let cargando = $state(true);
  let error = $state('');

  onMount(async () => {
    authStore.checkAuth();
    const s = get(authStore);
    if (!s.isAuthenticated || !['ADMIN', 'JEFE_TECNICO'].includes(s.usuario?.rol ?? '')) {
      goto('/admin/dashboard');
      return;
    }
    try {
      planes = await listarPlanes(s.token ?? '');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al cargar los planes';
    } finally {
      cargando = false;
    }
  });

  const precio = (n: number) => n.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-slate-800">Planes</h1>
    <p class="text-sm text-slate-600">
      Catálogo vigente, en solo lectura. El alta y la edición de planes quedan pendientes de definir quién es dueño de los planes y contratos.
    </p>
  </div>

  {#if error}<Alert>{error}</Alert>{/if}

  {#if cargando}
    <p role="status" class="text-slate-500">Cargando...</p>
  {:else if planes.length === 0}
    <p class="rounded-xl border bg-white p-6 text-center text-slate-600">No hay planes activos.</p>
  {:else}
    <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table class="w-full text-sm">
        <caption class="sr-only">Planes activos</caption>
        <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
          <tr>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Plan</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Tipo</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Cliente</th>
            <th scope="col" class="px-3 py-2 text-right font-semibold">Velocidad</th>
            <th scope="col" class="px-3 py-2 text-right font-semibold">Precio mensual</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each planes as p (p.id_plan)}
            <tr>
              <td class="px-3 py-2">
                <span class="font-medium text-slate-900">{p.nombre_comercial}</span>
                {#if p.descripcion}<span class="block text-xs text-slate-500">{p.descripcion}</span>{/if}
              </td>
              <td class="px-3 py-2">{p.tipo_plan ?? '-'}</td>
              <td class="px-3 py-2">{p.tipo_cliente ?? '-'}</td>
              <td class="px-3 py-2 text-right tabular-nums">{p.velocidad_mbps ? `${p.velocidad_mbps} Mbps` : '-'}</td>
              <td class="px-3 py-2 text-right tabular-nums">{precio(p.precio_mensual)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
