<script lang="ts">
  let { page, limit, total, entidad, onchange }: {
    page: number; limit: number; total: number; entidad: string; onchange: (page: number) => void;
  } = $props();
  const boton = 'btn btn-secundario btn-chico';
</script>

{#if total > limit}
  <div class="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
    <span class="text-sm text-slate-500">
      Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, total)} de <strong>{total}</strong> {entidad}
    </span>
    <div class="flex items-center gap-2">
      <button onclick={() => onchange(Math.max(1, page - 1))} disabled={page <= 1} class={boton}>← Anterior</button>
      <span class="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg">{page}</span>
      <button onclick={() => onchange(page + 1)} disabled={page * limit >= total} class={boton}>Siguiente →</button>
    </div>
  </div>
{/if}
