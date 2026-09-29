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

  interface UsuarioRow {
    id_usuario: number;
    id_empresa: number | null;
    nombre_completo: string;
    nombre_usuario: string;
    email: string | null;
    fecha_creacion: string;
    rol: string;
    activo: boolean;
  }

  let usuarios = $state<UsuarioRow[]>([]);
  let miId = $state(0);

  // CU-43: desactivar pide confirmacion, porque corta el acceso en el acto.
  let porDesactivar = $state<UsuarioRow | null>(null);
  let cambiandoActivo = $state<number | null>(null);
  let avisoActivo = $state('');

  async function cambiarActivo(u: UsuarioRow, activo: boolean) {
    cambiandoActivo = u.id_usuario;
    errorMsg = '';
    avisoActivo = '';
    try {
      const r = await authApi.cambiarActivo(token, u.id_usuario, activo);
      usuarios = usuarios.map((x) => (x.id_usuario === u.id_usuario ? { ...x, activo: r.activo } : x));
      if (!r.activo && r.ot_activas > 0) {
        avisoActivo = `${u.nombre_completo} tiene ${r.ot_activas} OT activas. Reasígnalas desde Órdenes de Trabajo.`;
      }
      porDesactivar = null;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al cambiar el estado de la cuenta';
    } finally {
      cambiandoActivo = null;
    }
  }
  let loading = $state(true);
  let errorMsg = $state('');

  // Modal state
  let showModal = $state(false);
  let formNombreCompleto = $state('');
  let formNombreUsuario = $state('');
  let formPasswordTemporal = $state('');
  let formRol = $state('TECNICO');
  let formIdEmpresa = $state(1);
  let formZona = $state('');
  let formError = $state('');
  let formSuccess = $state('');
  let formLoading = $state(false);

  let token = '';

  onMount(() => {
    authStore.checkAuth();
    const state = get(authStore);

    if (!state.isAuthenticated || state.usuario?.rol !== 'ADMIN') {
      goto('/admin/dashboard');
      return;
    }

    token = state.token || '';
    miId = state.usuario?.userId ?? 0;
    cargarUsuarios();
  });

  async function cargarUsuarios() {
    loading = true;
    errorMsg = '';
    try {
      usuarios = await authApi.listarUsuarios(token);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al cargar usuarios';
    } finally {
      loading = false;
    }
  }

  function validarNombreUsuario(val: string): boolean {
    return /^[a-z]+\.[a-z]+$/.test(val);
  }

  function abrirModal() {
    formNombreCompleto = '';
    formNombreUsuario = '';
    formPasswordTemporal = '';
    formRol = 'TECNICO';
    formIdEmpresa = 1;
    formZona = '';
    formError = '';
    formSuccess = '';
    showModal = true;
  }

  function cerrarModal() {
    showModal = false;
  }

  async function handleCrearUsuario(e: Event) {
    e.preventDefault();
    formError = '';
    formSuccess = '';

    if (!formNombreCompleto.trim()) {
      formError = 'El nombre completo es obligatorio';
      return;
    }
    if (!validarNombreUsuario(formNombreUsuario)) {
      formError = 'El nombre de usuario debe tener formato: nombre.apellido en minúsculas';
      return;
    }
    if (formPasswordTemporal.length < 8) {
      formError = 'La contraseña debe tener al menos 8 caracteres';
      return;
    }

    formLoading = true;
    try {
      const dto: authApi.CrearUsuarioDto = {
        nombre_completo: formNombreCompleto,
        nombre_usuario: formNombreUsuario,
        password_temporal: formPasswordTemporal,
        rol: formRol,
        id_empresa: formIdEmpresa,
      };
      if (formRol === 'TECNICO' && formZona.trim()) {
        dto.zona = formZona;
      }

      await authApi.crearUsuario(token, dto);
      formSuccess = 'Usuario creado correctamente';
      programar(() => {
        cerrarModal();
        cargarUsuarios();
      }, 800);
    } catch (err) {
      formError = err instanceof Error ? err.message : 'Error al crear usuario';
    } finally {
      formLoading = false;
    }
  }
</script>
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-3xl font-bold text-gray-800">Gestión de Usuarios</h1>
      <button
        onclick={abrirModal}
        class="btn btn-primario"
      >
        Nuevo Usuario
      </button>
    </div>

    {#if errorMsg}
      <Alert class="rounded-lg mb-4">
        {errorMsg}
      </Alert>
    {/if}

    {#if avisoActivo}
      <div role="status" class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {avisoActivo}
      </div>
    {/if}

    {#if loading}
      <div class="text-center py-8 text-gray-500">Cargando usuarios...</div>
    {:else}
      <div class="bg-white rounded-xl shadow overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rol</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Empresa</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha creación</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            {#each usuarios as u}
              <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 text-sm text-gray-900">{u.nombre_completo}</td>
                <td class="px-6 py-4 text-sm text-gray-500">{u.nombre_usuario}</td>
                <td class="px-6 py-4">
                  <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {u.rol}
                  </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-500">{u.id_empresa}</td>
                <td class="px-6 py-4 text-sm text-gray-500">{new Date(u.fecha_creacion).toLocaleDateString('es-CL')}</td>
                <td class="px-6 py-4">
                  {#if u.activo}
                    <span class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Activa</span>
                  {:else}
                    <span class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">Desactivada</span>
                  {/if}
                </td>
                <td class="px-6 py-4 text-sm text-gray-500">
                  {#if u.id_usuario === miId}
                    —
                  {:else if u.activo}
                    <button
                      onclick={() => (porDesactivar = u)}
                      disabled={cambiandoActivo === u.id_usuario}
                      class="btn-texto-peligro"
                    >
                      Desactivar
                    </button>
                  {:else}
                    <button
                      onclick={() => cambiarActivo(u, true)}
                      disabled={cambiandoActivo === u.id_usuario}
                      class="btn-texto"
                    >
                      {cambiandoActivo === u.id_usuario ? 'Reactivando...' : 'Reactivar'}
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

<!-- CU-43: confirmacion de desactivar -->
{#if porDesactivar}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="dialog"
    aria-modal="true"
    aria-labelledby="titulo-desactivar"
  >
    <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
      <h3 id="titulo-desactivar" class="font-semibold text-gray-800 mb-3">Desactivar la cuenta de {porDesactivar.nombre_completo}</h3>
      <p class="text-sm text-gray-600 mb-4">
        No podrá iniciar sesión, y si tiene la sesión abierta la pierde en su próxima acción. Su historial y sus OT se conservan. Se puede reactivar después.
      </p>
      <div class="flex gap-3">
        <button onclick={() => (porDesactivar = null)} class="flex-1 btn btn-secundario text-sm">Volver</button>
        <button
          onclick={() => porDesactivar && cambiarActivo(porDesactivar, false)}
          disabled={cambiandoActivo !== null}
          class="btn btn-peligro flex-1 text-sm"
        >
          {cambiandoActivo !== null ? 'Desactivando...' : 'Desactivar cuenta'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal -->
{#if showModal}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e: MouseEvent) => { if (e.target === e.currentTarget) cerrarModal(); }}
    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') cerrarModal(); }}
  >
    <div class="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
      <h2 class="text-xl font-bold text-gray-800 mb-4">Nuevo Usuario</h2>

      <form onsubmit={handleCrearUsuario}>
        <InputField label="Nombre completo" name="nombre_completo" bind:value={formNombreCompleto} required={true} />

        <InputField label="Nombre de usuario" name="nombre_usuario" bind:value={formNombreUsuario} required={true} />
        {#if formNombreUsuario && !validarNombreUsuario(formNombreUsuario)}
          <p class="text-red-500 text-xs -mt-3 mb-3">Formato: nombre.apellido en minúsculas</p>
        {:else if formNombreUsuario && validarNombreUsuario(formNombreUsuario)}
          <p class="text-green-500 text-xs -mt-3 mb-3">Formato válido ✓</p>
        {/if}

        <InputField label="Contraseña temporal" name="password_temporal" type="password" bind:value={formPasswordTemporal} required={true} />

        <div class="mb-4">
          <label for="select-rol" class="block text-sm font-medium text-gray-700 mb-1">Rol <span class="text-red-500">*</span></label>
          <select id="select-rol" bind:value={formRol} class="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            <option value="ADMIN">ADMIN</option>
            <option value="JEFE_TECNICO">JEFE_TECNICO</option>
            <option value="TECNICO">TECNICO</option>
            <option value="COORDINADOR">COORDINADOR</option>
            <option value="COMERCIAL">COMERCIAL</option>
          </select>
        </div>

        <div class="mb-4">
          <label for="select-empresa" class="block text-sm font-medium text-gray-700 mb-1">Empresa <span class="text-red-500">*</span></label>
          <select
            id="select-empresa"
            bind:value={formIdEmpresa}
            class="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            onchange={(e) => formIdEmpresa = Number((e.target as HTMLSelectElement).value)}
          >
            <option value={1}>FiNet Limitada</option>
            <option value={2}>Cable Mágico Litoral</option>
          </select>
        </div>

        {#if formRol === 'TECNICO'}
          <InputField label="Zona" name="zona" bind:value={formZona} />
        {/if}

        {#if formError}
          <Alert class="rounded-lg mb-4 text-sm">{formError}</Alert>
        {/if}
        {#if formSuccess}
          <div class="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm">{formSuccess}</div>
        {/if}

        <div class="flex gap-3 mt-6">
          <button
            type="submit"
            disabled={formLoading}
            class="flex-1 btn btn-primario disabled:cursor-not-allowed flex items-center justify-center"
          >
            {#if formLoading}
              <Spinner class="-ml-1 mr-2 h-4 w-4 text-white" />
            {/if}
            {formLoading ? 'Creando...' : 'Crear usuario'}
          </button>
          <button
            type="button"
            onclick={cerrarModal}
            class="flex-1 btn btn-secundario"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
