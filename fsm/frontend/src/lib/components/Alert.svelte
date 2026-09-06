<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children, class: className = 'rounded-lg' }: { children: Snippet; class?: string } = $props();
</script>

<div role="alert" class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 {className}">
  {@render children()}
</div>
