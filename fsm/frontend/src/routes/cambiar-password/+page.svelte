<script lang="ts">
  import { crearTemporizador } from '$lib/utils/temporizador';
  const programar = crearTemporizador();
  import Alert from '$lib/components/Alert.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as authApi from '$lib/api/auth.api';
  import InputField from '$lib/components/InputField.svelte';

  let nueva_password = $state('');
  let confirmar_password = $state('');
  let errorMsg = $state('');
  let isLoading = $state(false);
  let successMsg = $state('');

  let auth: { token: string | null; usuario: { rol: string } | null; isAuthenticated: boolean } = $state({
    token: null,
    usuario: null,
    isAuthenticated: false,
  });

  onMount(() => {
    authStore.checkAuth();
    const currentState = get(authStore);

    if (!currentState.isAuthenticated) {
      goto('/login');
      return;
    }

    auth = {
      token: currentState.token,
      usuario: currentState.usuario,
      isAuthenticated: currentState.isAuthenticated,
    };
  });

  function getPasswordStrength(pw: string): { label: string; color: string } {
    if (pw.length < 8) return { label: 'débil', color: 'text-red-500' };
    const hasUpper = /[A-Z]/.test(pw);
    const hasNumber = /\d/.test(pw);
    if (!hasUpper || !hasNumber) return { label: 'media', color: 'text-yellow-500' };
    return { label: 'fuerte', color: 'text-green-500' };
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    errorMsg = '';
    successMsg = '';

    if (nueva_password !== confirmar_password) {
      errorMsg = 'Las contraseñas no coinciden';
      return;
    }

    if (nueva_password.length < 8) {
      errorMsg = 'La contraseña debe tener al menos 8 caracteres';
      return;
    }

    if (!/[A-Z]/.test(nueva_password) || !/\d/.test(nueva_password)) {
      errorMsg = 'La contraseña debe tener al menos 1 mayúscula y 1 número';
      return;
    }

    if (!auth.token) return;

    isLoading = true;
    try {
      await authApi.cambiarPassword(auth.token, nueva_password, confirmar_password);
      successMsg = 'Contraseña cambiada correctamente';

      if (auth.usuario?.rol === 'TECNICO') {
        programar(() => goto('/terreno'), 500);
      } else {
        programar(() => goto('/admin/dashboard'), 500);
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al cambiar contraseña';
    } finally {
      isLoading = false;
    }
  }

  const strength = $derived(getPasswordStrength(nueva_password));
</script>

<div class="min-h-screen bg-gray-100 flex items-center justify-center">
  <div class="bg-white rounded-xl shadow-lg p-8 max-w-md w-full mx-4">
    <h1 class="text-2xl font-bold text-gray-800 mb-4">Cambiar contraseña</h1>

    <div class="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg mb-6 text-sm">
      Por seguridad debes cambiar tu contraseña antes de continuar
    </div>

    <form onsubmit={handleSubmit}>
      <InputField
        label="Nueva contraseña"
        name="nueva_password"
        type="password"
        bind:value={nueva_password}
        required={true}
      />

      {#if nueva_password}
        <p class="text-xs -mt-3 mb-3 {strength.color}">
          Fortaleza: {strength.label}
        </p>
      {/if}

      <InputField
        label="Confirmar contraseña"
        name="confirmar_password"
        type="password"
        bind:value={confirmar_password}
        required={true}
      />

      {#if errorMsg}
        <Alert class="rounded-lg mb-4 text-sm">
          {errorMsg}
        </Alert>
      {/if}

      {#if successMsg}
        <div class="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm">
          {successMsg}
        </div>
      {/if}

      <button
        type="submit"
        disabled={isLoading}
        class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
      >
        {#if isLoading}
          <Spinner class="-ml-1 mr-2 h-4 w-4 text-white" />
        {/if}
        {isLoading ? 'Guardando...' : 'Guardar contraseña'}
      </button>
    </form>
  </div>
</div>
