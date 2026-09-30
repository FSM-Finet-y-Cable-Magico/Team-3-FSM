<script lang="ts">
  // CU-23: resumen diario de materiales. Que se uso en terreno un dia, por
  // material y por tecnico. Incluye los cierres que esperan aprobacion: el
  // material ya se gasto aunque el jefe tecnico todavia no apruebe.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.store';
  import Alert from '$lib/components/Alert.svelte';
  import * as api from '$lib/api/reportes.api';

  let token = '';
  let fecha = $state('');
  let resumen = $state<api.ResumenMateriales | null>(null);
  let cargando = $state(true);
  let error = $state('');

  async function cargar() {
    cargando = true;
    error = '';
    try {
      resumen = await api.resumenMateriales(token, fecha || undefined);
      fecha = resumen.fecha;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al cargar el resumen';
      resumen = null;
    } finally {
      cargando = false;
    }
  }

  onMount(() => {
    authStore.checkAuth();
    const estado = get(authStore);
    if (!estado.isAuthenticated) {
      goto('/login');
      return;
    }
    token = estado.token ?? '';
    cargar();
  });

  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
</script>

<div class="space-y-6">
  <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
    <div>
      <a href="/admin/reportes" class="btn-texto text-sm">← Volver a Reportes</a>
      <h1 class="text-2xl font-bold text-slate-800 mt-2">Resumen diario de materiales</h1>
      <p class="text-sm text-slate-600">Lo que se usó en terreno, por material y por técnico.</p>
    </div>
    <label class="text-xs font-medium text-slate-600">
      Día
      <input
        type="date"
        bind:value={fecha}
        onchange={cargar}
        class="block border rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </label>
  </div>

  {#if error}
    <Alert>{error}</Alert>
  {/if}

  {#if cargando}
    <p role="status" class="text-slate-500">Cargando resumen...</p>
  {:else if resumen}
    <p class="text-sm text-slate-700">
      {plural(resumen.total_ot, 'OT cerrada', 'OT cerradas')} el {resumen.fecha}.
      {#if resumen.pendientes_aprobacion > 0}
        <span class="text-amber-700">
          Incluye {plural(resumen.pendientes_aprobacion, 'cierre que espera aprobación', 'cierres que esperan aprobación')}.
        </span>
      {/if}
    </p>

    {#if resumen.materiales.length === 0}
      <p class="rounded-xl border bg-white p-6 text-center text-slate-600">No se registraron materiales ese día.</p>
    {:else}
      <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table class="w-full text-sm">
          <caption class="sr-only">Materiales usados el {resumen.fecha}</caption>
          <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
            <tr>
              <th scope="col" class="px-4 py-2 text-left font-semibold">Material</th>
              <th scope="col" class="px-4 py-2 text-right font-semibold">Cantidad</th>
              <th scope="col" class="px-4 py-2 text-left font-semibold">Por técnico</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each resumen.materiales as m (m.material)}
              <tr>
                <td class="px-4 py-2 text-slate-900">{m.material}</td>
                <td class="px-4 py-2 text-right tabular-nums font-semibold">{m.cantidad}</td>
                <td class="px-4 py-2 text-slate-700">
                  {#each m.por_tecnico as t (t.tecnico)}
                    <span class="inline-block mr-3">{t.tecnico}: {t.cantidad}</span>
                  {/each}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>
