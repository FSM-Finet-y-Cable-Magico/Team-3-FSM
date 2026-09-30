<script lang="ts">
  // CU-20: el jefe tecnico elige la caja y un puerto LIBRE para la instalacion.
  // El puerto queda RESERVADO al crear la OT y OCUPADO cuando el tecnico cierra.
  // LIBRE aca es "sin ocupacion registrada" (ver topologia.api): las cajas se
  // comparten con otros operadores y solo el tecnico confirma en terreno.
  import { onMount } from 'svelte';
  import * as topologiaApi from '$lib/api/topologia.api';

  let { token, onelegir }: { token: string; onelegir: (id_puerto: number | null) => void } = $props();

  let cajas = $state<topologiaApi.CajaDisponible[]>([]);
  let idCaja = $state('');
  let detalle = $state<topologiaApi.DetallePuertos | null>(null);
  let cercanas = $state<topologiaApi.CajaCercana[]>([]);
  let elegido = $state<number | null>(null);
  let error = $state('');

  const libres = $derived(detalle?.puertos.filter((p) => (p.estado ?? '').toUpperCase() === 'LIBRE') ?? []);

  onMount(async () => {
    try {
      cajas = await topologiaApi.cajasDisponibles(token);
    } catch {
      error = 'No se pudieron cargar las cajas NAP';
    }
  });

  async function elegirCaja() {
    elegido = null;
    onelegir(null);
    detalle = null;
    cercanas = [];
    if (!idCaja) return;
    try {
      detalle = await topologiaApi.puertosDeCaja(token, Number(idCaja));
      if (libres.length === 0) cercanas = await topologiaApi.cajasCercanas(token, Number(idCaja)).catch(() => []);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al cargar los puertos';
    }
  }

  function elegir(id: number) {
    elegido = elegido === id ? null : id;
    onelegir(elegido);
  }

  const color: Record<string, string> = {
    LIBRE: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    RESERVADO: 'border-amber-300 bg-amber-50 text-amber-800',
    OCUPADO: 'border-slate-300 bg-slate-100 text-slate-500',
    EN_MANTENCION: 'border-red-200 bg-red-50 text-red-700',
  };
</script>

<div class="space-y-3">
  <label for="caja-nap" class="block text-sm font-medium text-gray-700">Caja NAP</label>
  <select id="caja-nap" bind:value={idCaja} onchange={elegirCaja} class="w-full border rounded-lg px-3 py-2 text-sm bg-white">
    <option value="">Sin reservar puerto</option>
    {#each cajas as c (c.id_caja_nap)}
      <option value={String(c.id_caja_nap)}>{c.identificador_unico ?? c.id_caja_nap} · {c.zona ?? 'sin zona'} ({c.libres} sin registro)</option>
    {/each}
  </select>
  {#if error}<p class="text-sm text-red-600">{error}</p>{/if}

  {#if detalle}
    {#if libres.length === 0}
      <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <p>Esta caja NAP no tiene puertos disponibles.</p>
        {#if cercanas.length}
          <p class="mt-2 font-medium">Cajas cercanas con puertos:</p>
          <ul class="list-disc ml-5">
            {#each cercanas as c (c.id_caja_nap)}
              <li>{c.identificador_unico ?? c.id_caja_nap} · {c.distancia_m} m · {c.libres} sin registro</li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
    <div class="grid grid-cols-4 sm:grid-cols-8 gap-2">
      {#each detalle.puertos as p (p.id_puerto)}
        {@const estado = (p.estado ?? 'LIBRE').toUpperCase()}
        <button
          type="button"
          onclick={() => elegir(p.id_puerto)}
          disabled={estado !== 'LIBRE'}
          aria-pressed={elegido === p.id_puerto}
          aria-label={`Puerto ${p.numero_puerto ?? p.id_puerto} · ${estado}`}
          class="rounded-lg border-2 py-2 text-xs font-semibold disabled:cursor-not-allowed
            {elegido === p.id_puerto ? 'border-blue-600 bg-blue-600 text-white' : color[estado] ?? color.LIBRE}"
        >
          {p.numero_puerto ?? '?'}
        </button>
      {/each}
    </div>
    <p class="text-xs text-gray-500">El puerto queda reservado al crear la OT y ocupado cuando el técnico confirma la instalación.</p>
  {/if}
</div>
