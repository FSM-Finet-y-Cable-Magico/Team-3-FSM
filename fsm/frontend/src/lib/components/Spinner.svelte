<script lang="ts">
  let { class: className = 'h-8 w-8 text-blue-500' }: { class?: string } = $props();
</script>

<svg aria-hidden="true" class="animate-spin {className}" fill="none" viewBox="0 0 24 24">
  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
</svg>
