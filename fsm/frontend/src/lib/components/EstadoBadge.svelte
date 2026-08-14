<script lang="ts">
  interface Props {
    estado: string;
    size?: 'sm' | 'md';
  }

  const { estado, size = 'md' }: Props = $props();

  const colorMap: Record<string, string> = {
    PENDIENTE: 'bg-yellow-100 text-yellow-800',
    PENDIENTE_CLIENTE_AUSENTE: 'bg-amber-100 text-amber-800',
    ASIGNADA: 'bg-blue-100 text-blue-800',
    EN_CURSO: 'bg-indigo-100 text-indigo-800',
    COMPLETADA: 'bg-green-100 text-green-800',
    CANCELADA: 'bg-red-100 text-red-800',
    CRITICA: 'bg-red-500 text-white',
    ALTA: 'bg-orange-400 text-white',
    MEDIA: 'bg-yellow-300 text-gray-800',
    BAJA: 'bg-gray-200 text-gray-600',
  };

  const color = $derived(colorMap[estado] ?? 'bg-gray-100 text-gray-800');
  const sizeClass = $derived(size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-0.5 text-xs');
</script>

<span class="inline-flex items-center rounded-full font-medium {sizeClass} {color}">
  {estado}
</span>
