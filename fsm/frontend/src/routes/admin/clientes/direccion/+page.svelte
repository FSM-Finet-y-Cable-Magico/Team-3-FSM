<script lang="ts">
  import { formatearRut } from '$lib/utils/rut';
  // CU-07: historial de cliente por direccion. Se buscan los clientes actuales
  // y anteriores de una direccion y se abre la ficha del elegido (CU-06).
  import Alert from '$lib/components/Alert.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as api from '$lib/api/clientes.api';

  let token = '';
  let calle = $state('');
  let numero = $state('');
  let comuna = $state('');
  let resultados = $state<api.ClienteEnDireccion[] | null>(null);
  let buscando = $state(false);
  let error = $state('');

  // Excepcion 1 del CU: con los campos vacios no se busca.
  const completo = $derived(Boolean(calle.trim() && numero.trim() && comuna.trim()));

  onMount(() => {
    authStore.checkAuth();
    const s = get(authStore);
    if (!s.isAuthenticated || !['ADMIN', 'JEFE_TECNICO'].includes(s.usuario?.rol ?? '')) {
      goto('/admin/dashboard');
      return;
    }
    token = s.token ?? '';
  });

  async function buscar() {
    if (!completo) return;
    buscando = true;
    error = '';
    try {
      resultados = await api.buscarPorDireccion(token, { calle: calle.trim(), numero: numero.trim(), comuna: comuna.trim() });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al buscar';
    } finally {
      buscando = false;
    }
  }
</script>

<div class="space-y-6">
  <div>
    <a href="/admin/clientes" class="btn-texto text-sm">← Volver a clientes</a>
    <h1 class="text-2xl font-bold text-slate-800 mt-2">Buscar por dirección</h1>
    <p class="text-sm text-slate-600">Clientes actuales y anteriores de una dirección.</p>
  </div>

  <form
    onsubmit={(e) => { e.preventDefault(); buscar(); }}
    class="bg-white rounded-xl border p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
  >
    <label class="text-xs font-medium text-slate-600 sm:col-span-2">Calle
      <input bind:value={calle} placeholder="Av. Ejemplo" class="mt-1 block w-full border rounded-lg px-3 py-2 text-sm" />
    </label>
    <label class="text-xs font-medium text-slate-600">Número
      <input bind:value={numero} placeholder="1234" class="mt-1 block w-full border rounded-lg px-3 py-2 text-sm" />
    </label>
    <label class="text-xs font-medium text-slate-600">Comuna
      <input bind:value={comuna} placeholder="La Pintana" class="mt-1 block w-full border rounded-lg px-3 py-2 text-sm" />
    </label>
    <button type="submit" disabled={!completo || buscando} class="btn btn-primario sm:col-span-4 sm:w-40">
      {buscando ? 'Buscando...' : 'Buscar'}
    </button>
  </form>

  {#if error}<Alert>{error}</Alert>{/if}

  {#if resultados}
    {#if resultados.length === 0}
      <p class="rounded-xl border bg-white p-6 text-center text-slate-600">
        No se encontraron clientes en esa dirección. Verifique la información ingresada.
      </p>
    {:else}
      <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table class="w-full text-sm">
          <caption class="sr-only">Clientes de la dirección</caption>
          <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
            <tr>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Cliente</th>
              <th scope="col" class="px-3 py-2 text-left font-semibold">RUT</th>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Servicio</th>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Dirección</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each resultados as c (c.id_cliente + c.direccion)}
              <tr>
                <td class="px-3 py-2">
                  {#if c.rut}
                    <a href={`/admin/clientes/${c.rut}`} class="btn-texto">{c.nombre_completo}</a>
                  {:else}
                    {c.nombre_completo}
                  {/if}
                </td>
                <td class="px-3 py-2 font-mono text-xs">{formatearRut(c.rut) || '-'}</td>
                <td class="px-3 py-2">{c.estado}</td>
                <td class="px-3 py-2 text-slate-700">
                  {c.direccion}
                  <span class="ml-1 text-xs {c.actual ? 'text-green-700' : 'text-slate-500'}">{c.actual ? 'Actual' : 'Anterior'}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>
