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

  // MOD RF-34: /admin es el area de oficina. Un TECNICO que llegue aca --por
  // un enlace viejo, un favorito o escribiendo la URL-- se va a /terreno.
  // Antes esto cubria solo /clientes; ahora el area entera, que es el punto
  // de separar por segmento de ruta.
  const areaDenegada = $derived.by(() => usuario?.rol === 'TECNICO');
  $effect(() => { if (areaDenegada) goto('/terreno'); });

  function cerrarSesion() {
    authStore.logout();
  }

  const ICON_HOME = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`;
  const ICON_USERS = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`;
  const ICON_CLIP = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>`;
  const ICON_GROUP = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>`;
  const ICON_ALERTA = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0l-7.1 12.25A2 2 0 005 19z"/></svg>`;
  // Pulso: es el icono del panel en vivo (CU-12), no de una alerta.
  const ICON_SENAL = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12h4l2.5 7 5-14 2.5 7h4"/></svg>`;
  const ICON_RED = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m-6-8h6M5 5a2 2 0 012-2h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5z"/></svg>`;
  // Grafico de barras: es un reporte, no un documento suelto.
  const ICON_REPORTE = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 20h18M7 20V10m5 10V4m5 16v-7"/></svg>`;
  // Campana: es un aviso, no una alerta de red (esa ya tiene su triangulo).
  const ICON_CAMPANA = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9"/></svg>`;

  // TECNICO ya no figura en ninguno, y no es un descuido: /admin es el area de
  // oficina y el tecnico trabaja en /terreno. Antes aparecia en Dashboard y en
  // Ordenes de Trabajo, pero el backend responde 403 a un TECNICO en
  // GET /dashboard, asi que el enlace lo llevaba a una pantalla rota.
  //
  // Las etiquetas vuelven a ser las largas. Cuando el menu estaba arriba, con
  // nueve enlaces "Ordenes de Trabajo" y "Alertas de Red" se partian en dos
  // lineas y hubo que abreviarlas; en vertical hay espacio de sobra.
  const ICON_AJUSTES = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`;

  const navLinks = $derived([
    { href: '/admin/dashboard', label: 'Dashboard', icon: ICON_HOME, roles: ['ADMIN', 'JEFE_TECNICO'] },
    { href: '/admin/clientes', label: 'Clientes', icon: ICON_USERS, roles: ['ADMIN', 'JEFE_TECNICO'] },
    { href: '/admin/ot', label: 'Órdenes de Trabajo', icon: ICON_CLIP, roles: ['ADMIN', 'JEFE_TECNICO'] },
    { href: '/admin/alertas', label: 'Alertas de Red', icon: ICON_ALERTA, roles: ['ADMIN', 'JEFE_TECNICO'] },
    { href: '/admin/monitoreo', label: 'Monitoreo', icon: ICON_SENAL, roles: ['ADMIN', 'JEFE_TECNICO'] },
    { href: '/admin/topologia', label: 'Topología', icon: ICON_RED, roles: ['ADMIN', 'JEFE_TECNICO'] },
    { href: '/admin/reportes', label: 'Reportes', icon: ICON_REPORTE, roles: ['ADMIN', 'JEFE_TECNICO'] },
    { href: '/admin/notificaciones', label: 'Notificaciones', icon: ICON_CAMPANA, roles: ['ADMIN', 'JEFE_TECNICO'] },
    { href: '/admin/usuarios', label: 'Usuarios', icon: ICON_GROUP, roles: ['ADMIN'] },
    { href: '/admin/configuracion', label: 'Configuración', icon: ICON_AJUSTES, roles: ['ADMIN'] },
  ]);

  const linksVisibles = $derived(
    navLinks.filter((l) => usuario && l.roles.includes(usuario.rol))
  );

  /**
   * Cual es el enlace activo.
   *
   * Se compara por prefijo para que el detalle --`/admin/ot/12`-- deje marcado
   * "Órdenes de Trabajo", pero se toma el MAS LARGO de los que coinciden. La
   * version anterior encendia el enlace con `startsWith` a secas y ademas tenia
   * una rama muerta comparando contra `/dashboard`, que no es ninguna de las
   * rutas de esta seccion.
   */
  const activo = $derived.by(() => {
    const ruta = $page.url.pathname;
    return linksVisibles
      .filter((l) => ruta === l.href || ruta.startsWith(l.href + '/'))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
  });

  const rolColor: Record<string, string> = {
    ADMIN: 'bg-purple-100 text-purple-700',
    JEFE_TECNICO: 'bg-blue-100 text-blue-700',
    TECNICO: 'bg-green-100 text-green-700',
  };

  let { children } = $props();
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') menuMovil = false; }} />

{#if isAuthenticated && usuario && !areaDenegada}
  <div class="min-h-screen bg-slate-50">

    <!-- Barra superior, solo en pantallas chicas: en un celular una columna
         lateral fija se comeria la mitad del ancho util. -->
    <header class="md:hidden sticky top-0 z-30 flex items-center gap-3 bg-slate-900 px-4 h-14">
      <button
        onclick={() => (menuMovil = !menuMovil)}
        aria-label={menuMovil ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={menuMovil}
        class="text-slate-300 hover:text-white p-2 -ml-2 rounded-lg cursor-pointer
               transition-colors hover:bg-slate-700
               focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <a href="/admin/dashboard" class="flex items-center">
        <div class="bg-white rounded-lg px-2 py-1">
          <img src="/logo_finet.png" alt="FiNet" class="h-6 w-auto" />
        </div>
      </a>
    </header>

    <!-- Fondo que cierra el menú al tocarlo. Solo existe con el menú abierto. -->
    {#if menuMovil}
      <button
        class="md:hidden fixed inset-0 z-40 bg-slate-900/60 cursor-pointer"
        aria-label="Cerrar menú"
        onclick={() => (menuMovil = false)}
      ></button>
    {/if}

    <!-- Columna lateral. Fija en escritorio; en el celular entra como panel
         sobre el contenido y se va al elegir un enlace, tocar afuera o Escape. -->
    <nav
      aria-label="Navegación principal"
      class="fixed inset-y-0 left-0 z-50 w-60 bg-slate-900 flex flex-col
             transition-transform duration-200 motion-reduce:transition-none
             md:translate-x-0
             {menuMovil ? 'translate-x-0' : '-translate-x-full'}"
    >
      <div class="h-16 flex items-center px-4 shrink-0">
        <a
          href="/admin/dashboard"
          onclick={() => (menuMovil = false)}
          class="flex items-center rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <div class="bg-white rounded-lg px-2.5 py-1">
            <img src="/logo_finet.png" alt="FiNet" class="h-7 w-auto" />
          </div>
        </a>
      </div>

      <!-- `overflow-y-auto` porque con más secciones y una pantalla baja hay
           que poder desplazar los enlaces sin perder el bloque de sesión. -->
      <div class="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {#each linksVisibles as link (link.href)}
          <a
            href={link.href}
            onclick={() => (menuMovil = false)}
            aria-current={activo === link.href ? 'page' : undefined}
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                   transition-colors duration-150 cursor-pointer
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                   {activo === link.href
                     ? 'bg-blue-600 text-white'
                     : 'text-slate-300 hover:text-white hover:bg-slate-700'}"
          >
            {@html link.icon}
            {link.label}
          </a>
        {/each}
      </div>

      <!-- La sesión va abajo del todo: se consulta poco y no compite con el
           menú por la atención. -->
      <div class="shrink-0 border-t border-slate-700 p-3">
        <div class="px-1 pb-2">
          <p class="text-white text-sm font-medium truncate">{usuario.nombre_usuario}</p>
          <span class="inline-flex items-center mt-0.5 px-2 py-0.5 rounded-full text-xs font-semibold
                       {rolColor[usuario.rol] ?? 'bg-gray-100 text-gray-700'}">
            {usuario.rol}
          </span>
        </div>
        <button onclick={cerrarSesion} class="nav-logout w-full justify-center">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Salir
        </button>
      </div>
    </nav>

    <!-- `md:pl-60` deja el hueco de la columna. El ancho máximo se fija UNA
         sola vez acá: antes lo ponía el layout y además tres pantallas por su
         cuenta, así que a esas se les aplicaba dos veces el mismo margen. -->
    <main class="md:pl-60">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {@render children?.()}
      </div>
    </main>
  </div>
{:else if areaDenegada}
  <p role="alert" class="p-8 text-center text-slate-600">No tienes acceso a esta sección.</p>
{:else}
  <p role="status" class="p-8 text-center text-slate-600">Verificando sesión...</p>
{/if}
