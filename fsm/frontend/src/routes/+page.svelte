<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';

  onMount(() => {
    authStore.checkAuth();
    const { isAuthenticated, usuario } = get(authStore);
    if (!isAuthenticated) {
      goto('/login');
    } else if (usuario?.rol === 'TECNICO') {
      goto('/terreno');
    } else {
      goto('/admin/dashboard');
    }
  });
</script>
