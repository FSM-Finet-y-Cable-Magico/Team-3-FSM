<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { authStore } from '$lib/stores/auth.store';

  let isAuthenticated = $state(false);
  let usuario: { nombre_usuario: string; rol: string } | null = $state(null);
  let menuMovil = $state(false);

  onMount(() => {
    authStore.checkAuth();
    const state = get(authStore);
    if (!state.isAuthenticated) {
      goto('/login');
      return;
    }
    isAuthenticated = state.isAuthenticated;
    usuario = state.usuario;
  });

  function cerrarSesion() {
    authStore.logout();
  }

  const ICON_HOME = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`;
  const ICON_USERS = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`;
  const ICON_CLIP = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>`;
  const ICON_GROUP = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>`;

  const navLinks = $derived([
    { href: '/dashboard', label: 'Dashboard', icon: ICON_HOME, roles: ['ADMIN', 'JEFE_TECNICO', 'TECNICO'] },
    { href: '/clientes', label: 'Clientes', icon: ICON_USERS, roles: ['ADMIN', 'JEFE_TECNICO', 'TECNICO'] },
    { href: '/ot', label: 'Ordenes de Trabajo', icon: ICON_CLIP, roles: ['ADMIN', 'JEFE_TECNICO', 'TECNICO'] },
    { href: '/admin/usuarios', label: 'Usuarios', icon: ICON_GROUP, roles: ['ADMIN'] },
  ]);

  const linksVisibles = $derived(
    navLinks.filter((l) => usuario && l.roles.includes(usuario.rol))
  );

  const rolColor: Record<string, string> = {
    ADMIN: 'bg-purple-100 text-purple-700',
    JEFE_TECNICO: 'bg-blue-100 text-blue-700',
    TECNICO: 'bg-green-100 text-green-700',
  };

  let { children } = $props();
</script>

{#if isAuthenticated && usuario}
  <div class="min-h-screen bg-slate-50">
    <!-- Navbar -->
    <nav class="bg-slate-900 shadow-lg sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">

          <!-- Logo + links desktop -->
          <div class="flex items-center gap-8">
            <a href="/dashboard" class="flex items-center">
              <div class="bg-white rounded-lg px-2.5 py-1">
                <img src="/logo_finet.png" alt="FiNet" class="h-7 w-auto" />
              </div>
            </a>

            <div class="hidden md:flex items-center gap-1">
              {#each linksVisibles as link}
                <a
                  href={link.href}
                  class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150
                    {$page.url.pathname.startsWith(link.href) && link.href !== '/dashboard'
                      ? 'bg-blue-600 text-white'
                      : $page.url.pathname === link.href
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:text-white hover:bg-slate-700'}"
                >
                  {@html link.icon}
                  {link.label}
                </a>
              {/each}
            </div>
          </div>

          <!-- User info + logout desktop -->
          <div class="hidden md:flex items-center gap-3">
            <div class="text-right">
              <p class="text-white text-sm font-medium">{usuario.nombre_usuario}</p>
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold {rolColor[usuario.rol] ?? 'bg-gray-100 text-gray-700'}">
                {usuario.rol}
              </span>
            </div>
            <button
              onclick={cerrarSesion}
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-red-600 transition-all duration-150 border border-slate-700 hover:border-red-600"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Salir
            </button>
          </div>

          <!-- Hamburger mobile -->
          <button
            onclick={() => (menuMovil = !menuMovil)}
            class="md:hidden text-slate-300 hover:text-white p-2 rounded-lg hover:bg-slate-700 transition-colors"
          >
            {#if menuMovil}
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            {:else}
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            {/if}
          </button>
        </div>
      </div>

      <!-- Mobile menu -->
      {#if menuMovil}
        <div class="md:hidden border-t border-slate-700 bg-slate-800 px-4 py-3 space-y-1">
          {#each linksVisibles as link}
            <a
              href={link.href}
              onclick={() => (menuMovil = false)}
              class="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                {$page.url.pathname.startsWith(link.href)
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700'}"
            >
              {@html link.icon}
              {link.label}
            </a>
          {/each}
          <div class="pt-3 mt-3 border-t border-slate-700 flex items-center justify-between">
            <div>
              <p class="text-white text-sm font-medium">{usuario.nombre_usuario}</p>
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold {rolColor[usuario.rol] ?? 'bg-gray-100 text-gray-700'}">
                {usuario.rol}
              </span>
            </div>
            <button onclick={cerrarSesion} class="text-sm text-red-400 hover:text-red-300 font-medium">
              Cerrar sesión
            </button>
          </div>
        </div>
      {/if}
    </nav>

    <!-- Page content -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {@render children?.()}
    </main>
  </div>
{:else}
  {@render children?.()}
{/if}
