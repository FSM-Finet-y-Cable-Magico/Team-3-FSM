<script lang="ts">
  import type { IconoStatCard } from './iconos-statcard';

  interface Props {
    titulo: string;
    valor: number | string;
    subtitulo?: string;
    color: 'blue' | 'green' | 'yellow' | 'red' | 'gray' | 'orange';
    // Se pinta con {@html}: solo iconos propios, nunca un string cualquiera.
    icono: IconoStatCard;
    clickable?: boolean;
    href?: string;
  }

  let { titulo, valor, subtitulo, color, icono, clickable = false, href }: Props = $props();

  const colorMap: Record<string, { text: string; bg: string; border: string }> = {
    blue:   { text: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-100' },
    green:  { text: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-100' },
    yellow: { text: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-100' },
    red:    { text: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-100' },
    gray:   { text: 'text-gray-600',   bg: 'bg-gray-50',   border: 'border-gray-100' },
    orange: { text: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-100' },
  };

  const c = $derived(colorMap[color] ?? colorMap.gray);
</script>

{#if clickable && href}
  <a {href} class="block bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow cursor-pointer {c.border}">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm text-gray-500">{titulo}</p>
        <p class="text-3xl font-bold mt-1 {c.text}">{valor}</p>
        {#if subtitulo}
          <p class="text-xs text-gray-400 mt-1">{subtitulo}</p>
        {/if}
      </div>
      <div class="p-3 rounded-lg {c.bg} {c.text}">
        {@html icono}
      </div>
    </div>
  </a>
{:else}
  <div class="bg-white rounded-xl shadow-sm border p-6 {c.border}">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm text-gray-500">{titulo}</p>
        <p class="text-3xl font-bold mt-1 {c.text}">{valor}</p>
        {#if subtitulo}
          <p class="text-xs text-gray-400 mt-1">{subtitulo}</p>
        {/if}
      </div>
      <div class="p-3 rounded-lg {c.bg} {c.text}">
        {@html icono}
      </div>
    </div>
  </div>
{/if}
