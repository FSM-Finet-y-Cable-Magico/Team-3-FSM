<script lang="ts">
  import { page } from '$app/stores';
  let { children } = $props();
</script>

<!-- Cada OT tiene su propio ciclo de vida, también al navegar entre dos cierres. -->
{#key $page.params.id}
  {@render children()}
{/key}
