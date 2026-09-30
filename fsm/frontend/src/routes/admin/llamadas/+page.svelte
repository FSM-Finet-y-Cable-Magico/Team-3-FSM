<script lang="ts">
  // CU-31: llamadas de cortesia post-OT. El jefe tecnico llama fuera del
  // sistema y anota el resultado. NO_CONFORME genera una reparacion ALTA;
  // SIN_RESPUESTA agenda otro intento a las 2 horas, hasta tres.
  import Alert from '$lib/components/Alert.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as api from '$lib/api/ordenes.api';

  let token = '';
  let pendientes = $state<api.LlamadaPendiente[]>([]);
  let cargando = $state(true);
  let error = $state('');
  let aviso = $state<{ texto: string; id_ot_reparacion: number | null } | null>(null);
  let ocupada = $state<number | null>(null);

  let noConforme = $state<api.LlamadaPendiente | null>(null);
  let reclamo = $state('');
  let reclamoError = $state('');

  onMount(() => {
    authStore.checkAuth();
    const s = get(authStore);
    if (!s.isAuthenticated || !['ADMIN', 'JEFE_TECNICO'].includes(s.usuario?.rol ?? '')) {
      goto('/admin/dashboard');
      return;
    }
    token = s.token ?? '';
    cargar();
  });

  async function cargar() {
    cargando = true;
    try {
      pendientes = await api.llamadasPendientes(token);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al cargar las llamadas';
    } finally {
      cargando = false;
    }
  }

  async function registrar(p: api.LlamadaPendiente, resultado: 'CONFORME' | 'NO_CONFORME' | 'SIN_RESPUESTA', obs?: string) {
    ocupada = p.id_ot;
    error = '';
    try {
      const r = await api.registrarLlamada(token, p.id_ot, resultado, obs);
      const textos: Record<string, string> = {
        CONFORME: `OT #${p.id_ot}: cliente conforme.`,
        NO_CONFORME: `OT #${p.id_ot}: cliente no conforme. Se creó la reparación`,
        SIN_RESPUESTA: `OT #${p.id_ot}: sin respuesta. Se vuelve a llamar en 2 horas.`,
        SIN_CONTACTO: `OT #${p.id_ot}: tercer intento sin respuesta. Conformidad no confirmada por falta de contacto.`,
      };
      aviso = { texto: textos[r.resultado] ?? r.resultado, id_ot_reparacion: r.id_ot_reparacion };
      noConforme = null;
      reclamo = '';
      await cargar();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al registrar la llamada';
    } finally {
      ocupada = null;
    }
  }

  function confirmarNoConforme() {
    if (!noConforme) return;
    if (!reclamo.trim()) {
      reclamoError = 'Describe el problema que reporta el cliente';
      return;
    }
    registrar(noConforme, 'NO_CONFORME', reclamo.trim());
  }

  const fecha = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '-';
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-slate-800">Llamadas de cortesía</h1>
    <p class="text-sm text-slate-600">OT completadas que esperan que se confirme la conformidad del cliente.</p>
  </div>

  {#if aviso}
    <div role="status" class="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
      {aviso.texto}
      {#if aviso.id_ot_reparacion}
        <a href={`/admin/ot/${aviso.id_ot_reparacion}`} class="btn-texto">OT #{aviso.id_ot_reparacion}</a>
      {/if}
    </div>
  {/if}
  {#if error}<Alert>{error}</Alert>{/if}

  {#if cargando}
    <p role="status" class="text-slate-500">Cargando...</p>
  {:else if pendientes.length === 0}
    <p class="rounded-xl border bg-white p-6 text-center text-slate-600">No hay llamadas pendientes.</p>
  {:else}
    <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table class="w-full text-sm">
        <caption class="sr-only">Llamadas de cortesía pendientes</caption>
        <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
          <tr>
            <th scope="col" class="px-3 py-2 text-left font-semibold">OT</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">A quién llamar</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Completada</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Intentos</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Resultado</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each pendientes as p (p.id_ot)}
            <tr class={p.toca_llamar ? '' : 'bg-slate-50'}>
              <td class="px-3 py-2">
                <a href={`/admin/ot/${p.id_ot}`} class="btn-texto">#{p.id_ot}</a>
                <span class="block text-xs text-slate-500">{p.tipo_ot}</span>
              </td>
              <td class="px-3 py-2">
                <span class="text-slate-900">{p.contacto?.nombre ?? '-'}</span>
                {#if p.contacto?.telefono}
                  <a href={`tel:${p.contacto.telefono}`} class="btn-texto block font-mono text-xs">{p.contacto.telefono}</a>
                {/if}
              </td>
              <td class="px-3 py-2 text-slate-700">
                {fecha(p.fecha_completada)}
                <span class="block text-xs text-slate-500">{p.tecnico ?? 'Sin técnico'}</span>
              </td>
              <td class="px-3 py-2 text-slate-700">
                {p.intentos} de 3
                {#if p.proximo_intento && !p.toca_llamar}
                  <span class="block text-xs text-slate-500">Próximo intento {fecha(p.proximo_intento)}</span>
                {/if}
              </td>
              <td class="px-3 py-2">
                <div class="flex flex-wrap gap-2">
                  <button onclick={() => registrar(p, 'CONFORME')} disabled={ocupada === p.id_ot} class="btn btn-exito btn-chico">Conforme</button>
                  <button onclick={() => { noConforme = p; reclamoError = ''; }} disabled={ocupada === p.id_ot} class="btn btn-peligro btn-chico">No conforme</button>
                  <button onclick={() => registrar(p, 'SIN_RESPUESTA')} disabled={ocupada === p.id_ot} class="btn btn-secundario btn-chico">Sin respuesta</button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if noConforme}
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby="titulo-no-conforme">
    <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-3">
      <h3 id="titulo-no-conforme" class="font-semibold text-slate-800">Cliente no conforme · OT #{noConforme.id_ot}</h3>
      <p class="text-sm text-slate-600">Se crea una OT de reparación con prioridad ALTA para el mismo cliente.</p>
      <label for="reclamo" class="block text-xs font-medium text-slate-600">Qué reporta el cliente</label>
      <textarea id="reclamo" bind:value={reclamo} rows={3} maxlength={500} class="w-full border rounded-lg px-3 py-2 text-sm resize-none"></textarea>
      {#if reclamoError}<p class="text-red-600 text-sm">{reclamoError}</p>{/if}
      <div class="flex gap-3">
        <button onclick={() => (noConforme = null)} class="flex-1 btn btn-secundario text-sm">Volver</button>
        <button onclick={confirmarNoConforme} disabled={ocupada !== null} class="flex-1 btn btn-peligro text-sm">Registrar y crear reparación</button>
      </div>
    </div>
  </div>
{/if}
