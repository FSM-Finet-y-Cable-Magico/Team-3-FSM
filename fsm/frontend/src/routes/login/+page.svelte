<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';

  let nombre_usuario = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let errorMsg = $state('');
  let isLoading = $state(false);

  onMount(() => {
    authStore.checkAuth();
    const state = get(authStore);
    if (state.isAuthenticated) {
      goto('/dashboard');
    }
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    errorMsg = '';

    if (!nombre_usuario.trim()) {
      errorMsg = 'El nombre de usuario es obligatorio';
      return;
    }
    if (!password.trim()) {
      errorMsg = 'La contraseña es obligatoria';
      return;
    }

    isLoading = true;
    try {
      const ruta = await authStore.login(nombre_usuario, password);
      goto(ruta);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al iniciar sesión';
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-4">

  <div class="w-full max-w-sm">

    <!-- Header con logo real -->
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center bg-white border border-slate-200 rounded-2xl px-7 py-3.5 shadow-sm mb-5">
        <img
          src="/logo_finet.png"
          alt="FiNet Limitada"
          class="h-20 w-auto"
        />
      </div>
      <div class="border-t border-slate-700 pt-4">
        <p class="text-slate-300 text-sm font-medium tracking-widest uppercase">
          Sistema de Gestión de Campo
        </p>
        <p class="text-slate-500 text-xs mt-1.5 tracking-wide">
          Acceso restringido · Solo personal autorizado
        </p>
      </div>
    </div>

    <!-- Tarjeta del formulario -->
    <div class="bg-white rounded-xl shadow-xl border border-slate-200 p-8">

      <div class="mb-6">
        <h1 class="text-slate-900 font-semibold text-lg">Iniciar sesión</h1>
        <p class="text-slate-500 text-sm mt-0.5">Ingrese sus credenciales para continuar</p>
      </div>

      <form onsubmit={handleSubmit} class="space-y-5">

        <div>
          <label for="nombre_usuario" class="block text-sm font-medium text-slate-700 mb-1.5">
            Usuario
          </label>
          <input
            id="nombre_usuario"
            type="text"
            name="nombre_usuario"
            bind:value={nombre_usuario}
            placeholder="nombre.usuario"
            autocomplete="username"
            required
            class="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400
                   focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500
                   transition-shadow duration-150 text-sm bg-white"
          />
        </div>

        <div>
          <label for="password" class="block text-sm font-medium text-slate-700 mb-1.5">
            Contraseña
          </label>
          <div class="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              name="password"
              bind:value={password}
              placeholder="••••••••"
              autocomplete="current-password"
              required
              class="w-full px-4 py-2.5 pr-11 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400
                     focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500
                     transition-shadow duration-150 text-sm bg-white"
            />
            <button
              type="button"
              onclick={() => (showPassword = !showPassword)}
              class="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400
                     hover:text-slate-600 transition-colors duration-150 cursor-pointer"
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {#if showPassword}
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              {:else}
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              {/if}
            </button>
          </div>
        </div>

        {#if errorMsg}
          <div class="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            <svg class="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clip-rule="evenodd" />
            </svg>
            {errorMsg}
          </div>
        {/if}

        <button
          type="submit"
          disabled={isLoading}
          class="w-full bg-slate-800 hover:bg-slate-900 active:bg-black text-white font-medium py-2.5 px-4
                 rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed
                 flex items-center justify-center gap-2 cursor-pointer mt-1 text-sm"
        >
          {#if isLoading}
            <svg class="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Ingresando...
          {:else}
            Ingresar al Sistema
          {/if}
        </button>

      </form>
    </div>

    <!-- Footer -->
    <div class="text-center mt-6 space-y-1">
      <p class="text-slate-500 text-xs">
        © {new Date().getFullYear()} FiNet Limitada · Cable Mágico. Todos los derechos reservados.
      </p>
    </div>

  </div>
</div>
