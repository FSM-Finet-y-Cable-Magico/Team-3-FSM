<script lang="ts">
  import type { NivelRiesgo } from '$lib/utils/riesgo';

  /**
   * MOD RF-32: indicador del semaforo. El acta pidio que fuera "mas discreto"
   * que la etiqueta CONFLICTIVO en rojo: un punto de color y el nivel.
   */
  let { nivel }: { nivel: NivelRiesgo } = $props();

  const color: Record<NivelRiesgo, string> = {
    VERDE: 'bg-green-500',
    AMARILLO: 'bg-amber-400',
    ROJO: 'bg-red-600',
  };
</script>

<span class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
  <span class="h-2.5 w-2.5 rounded-full {color[nivel]}" aria-hidden="true"></span>
  Riesgo {nivel}
</span>
