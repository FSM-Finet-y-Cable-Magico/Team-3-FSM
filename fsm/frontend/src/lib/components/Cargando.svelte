<script lang="ts">
  import Spinner from './Spinner.svelte';
  let { mensaje, class: className, spinnerClass, mensajeClass }: {
    mensaje: string; class: string; spinnerClass: string; mensajeClass: string;
  } = $props();
</script>

<div role="status" class={className}>
  <Spinner class={spinnerClass} />
  <p class={mensajeClass}>{mensaje}</p>
</div>
