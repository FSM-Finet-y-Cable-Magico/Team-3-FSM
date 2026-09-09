<script lang="ts">
  // RF-46: el umbral de desconexión, configurable por el administrador.
  //
  // El motor de alertas ya leía este valor, pero no había forma de escribirlo:
  // sin endpoint ni pantalla, el único camino era SQL directo.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.store';
  import Alert from '$lib/components/Alert.svelte';
  import Cargando from '$lib/components/Cargando.svelte';
  import * as api from '$lib/api/configuracion.api';

  let config = $state<api.Configuracion | null>(null);
  let valor = $state<number | ''>('');
  let cargando = $state(true);
  let guardando = $state(false);
  let error = $state('');
  let aviso = $state('');

  const token = () => get(authStore).token ?? '';

  // El rango lo dicta el Controlador; la Vista no lo vuelve a escribir a mano.
  const fueraDeRango = $derived(
    config != null &&
      valor !== '' &&
      (Number(valor) < config.umbral_min || Number(valor) > config.umbral_max),
  );
  const sinCambios = $derived(
    config != null && (valor === '' ? config.umbral_desconexion_min === null : Number(valor) === config.umbral_desconexion_min),
  );

  onMount(async () => {
    authStore.checkAuth();
    if (get(authStore).usuario?.rol !== 'ADMIN') {
      goto('/admin/dashboard');
      return;
    }
    await cargar();
  });

  async function cargar() {
    cargando = true;
    error = '';
    try {
      config = await api.obtenerConfiguracion(token());
      valor = config.umbral_desconexion_min ?? '';
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo leer la configuración';
    } finally {
      cargando = false;
    }
  }

  async function guardar() {
    if (fueraDeRango || sinCambios) return;
    guardando = true;
    error = '';
    aviso = '';
    try {
      // Vacío significa "usar el del sistema", no cero.
      config = await api.actualizarConfiguracion(token(), valor === '' ? null : Number(valor));
      valor = config.umbral_desconexion_min ?? '';
      aviso = `Guardado. Las alertas de sin señal se levantan a los ${config.umbral_vigente} minutos.`;
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo guardar';
    } finally {
      guardando = false;
    }
  }
</script>

<svelte:head><title>Configuración · FiNet</title></svelte:head>

<div class="mb-6">
  <h1 class="text-2xl font-bold text-slate-900">Configuración</h1>
  <p class="text-sm text-slate-500">Parámetros de operación de {config?.nombre ?? 'la empresa'}</p>
</div>

{#if error}
  <Alert class="rounded-xl mb-5 text-sm">{error}</Alert>
{/if}
{#if aviso}
  <div role="status" class="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
    {aviso}
  </div>
{/if}

{#if cargando}
  <Cargando mensaje="Cargando configuración..." class="rounded-2xl border border-slate-200 bg-white p-12 text-center" spinnerClass="h-8 w-8 text-blue-500 mx-auto mb-3" mensajeClass="text-slate-400 text-sm" />
{:else if config}
  <div class="max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <h2 class="font-semibold text-slate-900">Alerta por falta de señal</h2>
    <p class="mt-1 text-sm text-slate-600">
      Minutos que una ONT puede estar sin señal antes de que el sistema levante
      la alerta. Se aplica a toda la empresa.
    </p>

    <label for="umbral" class="mt-5 block text-sm font-medium text-slate-700">
      Minutos sin señal
    </label>
    <div class="mt-1 flex items-center gap-3">
      <input
        id="umbral"
        type="number"
        bind:value={valor}
        min={config.umbral_min}
        max={config.umbral_max}
        step="1"
        placeholder={String(config.umbral_por_defecto)}
        aria-describedby="ayuda-umbral"
        class="w-32 rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
      <span class="text-sm text-slate-500">
        entre {config.umbral_min} y {config.umbral_max}
      </span>
    </div>

    <p id="ayuda-umbral" aria-live="polite" class="mt-2 text-sm {fueraDeRango ? 'text-red-700' : 'text-slate-500'}">
      {#if fueraDeRango}
        Tiene que estar entre {config.umbral_min} y {config.umbral_max} minutos.
      {:else if valor === ''}
        Vacío usa el valor del sistema: {config.umbral_por_defecto} minutos.
      {:else}
        Hoy se aplican {config.umbral_vigente} minutos.
      {/if}
    </p>

    <div class="mt-5 flex items-center gap-2">
      <button class="btn btn-primario" onclick={guardar} disabled={guardando || fueraDeRango || sinCambios}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
      {#if config.umbral_desconexion_min !== null}
        <button class="btn btn-secundario" onclick={() => (valor = '')} disabled={guardando}>
          Volver al del sistema
        </button>
      {/if}
    </div>
  </div>
{/if}
