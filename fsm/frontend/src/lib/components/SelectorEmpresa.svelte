<script lang="ts">
  import { onMount } from 'svelte';
  import { listarEmpresas, type Empresa } from '$lib/api/dashboard.api';
  import { empresaActiva, elegirEmpresa } from '$lib/stores/empresa-activa.store';

  /**
   * CU-33: selector de la empresa activa. Solo lo monta el layout para el
   * ADMIN, que es el unico rol que el Controlador deja cambiar de empresa.
   */
  let { token, idEmpresaPropia }: { token: string; idEmpresaPropia: number } = $props();

  let empresas = $state<Empresa[]>([]);
  const valor = $derived($empresaActiva ?? idEmpresaPropia);

  onMount(async () => {
    try {
      empresas = await listarEmpresas(token);
    } catch {
      // Sin la lista no hay que elegir: se sigue trabajando con la propia.
    }
  });

  function cambiar(evento: Event) {
    const id = Number((evento.currentTarget as HTMLSelectElement).value);
    // La propia no se manda: `null` deja al Controlador usar la del token.
    elegirEmpresa(id === idEmpresaPropia ? null : id);
    // Cada pantalla carga sus datos al montarse. Recargar es la forma segura
    // de que ninguna quede mostrando datos de la empresa anterior.
    location.reload();
  }
</script>

{#if empresas.length > 1}
  <div class="px-1 pb-3">
    <label for="empresa-activa" class="block text-xs font-medium text-slate-400 mb-1">Empresa activa</label>
    <select
      id="empresa-activa"
      value={String(valor)}
      onchange={cambiar}
      class="w-full rounded-lg bg-slate-800 border border-slate-600 text-white text-sm px-2 py-1.5
             focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {#each empresas as emp (emp.id_empresa)}
        <option value={String(emp.id_empresa)}>{emp.nombre}</option>
      {/each}
    </select>
  </div>
{/if}
