<script lang="ts">
  import { crearTemporizador } from '$lib/utils/temporizador';
  const programar = crearTemporizador();
  import Alert from '$lib/components/Alert.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as clientesApi from '$lib/api/clientes.api';
  import InputField from '$lib/components/InputField.svelte';
  import RutInput from '$lib/components/RutInput.svelte';

  let token = '';
  let id_empresa: number | null = null;

  let rut = $state('');
  let rutValido = $state(false);
  let nombre_completo = $state('');
  let email = $state('');
  let telefono = $state('');
  let direccion_completa = $state('');
  let comuna = $state('');
  let ciudad = $state('');
  let estado = $state('PENDIENTE');
  let id_plan = $state<number | undefined>(undefined);

  let planes = $state<clientesApi.PlanResumen[]>([]);
  let loading = $state(false);
  let errorMsg = $state('');
  let successMsg = $state('');

  onMount(() => {
    authStore.checkAuth();
    const state = get(authStore);

    if (!state.isAuthenticated || !['ADMIN', 'JEFE_TECNICO'].includes(state.usuario?.rol ?? '')) {
      goto('/dashboard');
      return;
    }

    token = state.token ?? '';
    id_empresa = state.usuario?.id_empresa ?? null;
    cargarPlanes();
  });

  async function cargarPlanes() {
    try {
      planes = await clientesApi.listarPlanes(token);
    } catch {
      // no mostrar error si falla carga de planes
    }
  }

  function handleRutChange({ rut: r, valido }: { rut: string; valido: boolean }) {
    rut = r;
    rutValido = valido;
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    errorMsg = '';
    successMsg = '';

    if (!rutValido) {
      errorMsg = 'RUT inválido. Verifique el número';
      return;
    }
    if (!nombre_completo.trim()) {
      errorMsg = 'El nombre completo es obligatorio';
      return;
    }
    if (!direccion_completa.trim()) {
      errorMsg = 'La dirección es obligatoria';
      return;
    }
    if (!comuna.trim()) {
      errorMsg = 'La comuna es obligatoria';
      return;
    }

    loading = true;
    try {
      const dto: Record<string, unknown> = {
        rut,
        nombre_completo,
        email: email || undefined,
        telefono: telefono || undefined,
        direccion_completa,
        comuna,
        ciudad: ciudad || undefined,
        estado,
        id_plan: id_plan || undefined,
      };

      const cliente = await clientesApi.registrarCliente(token, dto);
      successMsg = 'Cliente registrado correctamente';
      programar(() => goto(`/clientes/${cliente.rut}`), 500);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al registrar';
    } finally {
      loading = false;
    }
  }
</script>
    <div class="bg-white rounded-xl shadow p-8">
      <h2 class="text-2xl font-bold text-gray-800 mb-6">Registrar nuevo cliente</h2>

      <form onsubmit={handleSubmit}>
        <RutInput onchange={handleRutChange} required={true} />

        <InputField label="Nombre completo" bind:value={nombre_completo} required={true} />
        <InputField label="Email" type="email" bind:value={email} />
        <InputField label="Teléfono" bind:value={telefono} />
        <InputField label="Dirección completa" bind:value={direccion_completa} required={true} />
        <InputField label="Comuna" bind:value={comuna} required={true} />
        <InputField label="Ciudad" bind:value={ciudad} />

        <div class="mb-4">
          <label for="estado" class="block text-sm font-medium text-gray-700 mb-1">Estado</label>
          <select id="estado" bind:value={estado} class="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            <option value="PENDIENTE">PENDIENTE</option>
            <option value="ACTIVO">ACTIVO</option>
            <option value="SUSPENDIDO">SUSPENDIDO</option>
          </select>
        </div>

        <div class="mb-4">
          <label for="plan" class="block text-sm font-medium text-gray-700 mb-1">Plan (opcional)</label>
          <select
            id="plan"
            onchange={(e) => id_plan = Number((e.target as HTMLSelectElement).value) || undefined}
            class="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Sin plan</option>
            {#each planes as p}
              <option value={p.id_plan}>{p.nombre_comercial} - {p.velocidad_mbps} Mbps (${p.precio_mensual})</option>
            {/each}
          </select>
        </div>

        {#if errorMsg}
          <Alert class="rounded-lg mb-4 text-sm">{errorMsg}</Alert>
        {/if}
        {#if successMsg}
          <div class="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm">{successMsg}</div>
        {/if}

        <div class="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center"
          >
            {#if loading}
              <Spinner class="-ml-1 mr-2 h-4 w-4 text-white" />
            {/if}
            {loading ? 'Registrando...' : 'Registrar cliente'}
          </button>
          <a
            href="/clientes"
            class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors text-center"
          >
            Cancelar
          </a>
        </div>
      </form>
    </div>
