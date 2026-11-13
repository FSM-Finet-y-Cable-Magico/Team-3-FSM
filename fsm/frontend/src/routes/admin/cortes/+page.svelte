<script lang="ts">
  import Alert from '$lib/components/Alert.svelte';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.store';
  import { listarCortes, registrarCorte, type FilaCorte, type PanelCortes } from '$lib/api/cortes.api';

  let token = $state('');
  let panel = $state<PanelCortes | null>(null);
  let cargando = $state(true);
  let error = $state('');
  let aviso = $state('');

  /** Fila cuyo dialogo de confirmacion esta abierto. */
  let pendiente = $state<{ fila: FilaCorte; accion: 'CORTE' | 'REACTIVACION' } | null>(null);
  let observacion = $state('');
  let guardando = $state(false);
  let errorDialogo = $state('');

  onMount(() => {
    authStore.checkAuth();
    const state = get(authStore);
    if (!state.isAuthenticated) {
      goto('/login');
      return;
    }
    if (!['ADMIN', 'JEFE_TECNICO'].includes(state.usuario?.rol ?? '')) {
      goto(state.usuario?.rol === 'TECNICO' ? '/terreno' : '/admin/dashboard');
      return;
    }
    token = state.token ?? '';
    cargar();
  });

  async function cargar() {
    cargando = true;
    error = '';
    try {
      panel = await listarCortes(token);
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo cargar el panel de cortes';
    } finally {
      cargando = false;
    }
  }

  function abrir(fila: FilaCorte, accion: 'CORTE' | 'REACTIVACION') {
    pendiente = { fila, accion };
    observacion = '';
    errorDialogo = '';
  }

  async function confirmar() {
    if (!pendiente) return;
    guardando = true;
    errorDialogo = '';
    try {
      await registrarCorte(token, pendiente.fila.id_contrato, pendiente.accion, observacion);
      aviso = `${pendiente.accion === 'CORTE' ? 'Corte' : 'Reactivación'} de ${pendiente.fila.cliente?.nombre_completo ?? `contrato #${pendiente.fila.id_contrato}`} registrado`;
      pendiente = null;
      await cargar();
    } catch (e) {
      // Aca aterriza el 409: otra persona ya lo registro.
      errorDialogo = e instanceof Error ? e.message : 'No se pudo registrar';
    } finally {
      guardando = false;
    }
  }

  function fecha(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  }
</script>

<svelte:head><title>Cortes y reactivaciones</title></svelte:head>

<div class="mb-6">
  <h1 class="text-2xl font-bold text-slate-900">Cortes y reactivaciones</h1>
  <p class="text-sm text-slate-500 mt-0.5">Clientes que G8 suspendió o reactivó por deuda</p>
</div>

<div class="mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
  <strong>El corte y la reactivación se hacen en SmartOLT.</strong> Este panel solo registra que se hicieron.
</div>

{#if aviso}
  <div role="status" class="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center justify-between">
    <span>{aviso}</span>
    <button onclick={() => (aviso = '')} class="text-emerald-600 hover:text-emerald-800 cursor-pointer" aria-label="Cerrar aviso">✕</button>
  </div>
{/if}

{#if cargando && !panel}
  <p class="text-center py-10 text-slate-500">Cargando...</p>
{:else if error}
  <Alert class="rounded-lg text-sm">{error}</Alert>
{:else if panel}
  {#each [
    { titulo: 'Por cortar', filas: panel.por_cortar, accion: 'CORTE' as const, vacio: 'No hay contratos por cortar.' },
    { titulo: 'Por reactivar', filas: panel.por_reactivar, accion: 'REACTIVACION' as const, vacio: 'No hay contratos por reactivar.' },
  ] as bloque (bloque.accion)}
    <section class="bg-white rounded-xl border border-slate-200 mb-5 overflow-hidden">
      <h2 class="px-5 py-3 text-lg font-semibold text-slate-900 border-b border-slate-200">
        {bloque.titulo} <span class="text-slate-500 font-normal">({bloque.filas.length})</span>
      </h2>
      {#if bloque.filas.length === 0}
        <p class="px-5 py-4 text-sm text-slate-500">{bloque.vacio}</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 text-left">
              <tr>
                <th class="px-4 py-2.5 font-medium">Cliente</th>
                <th class="px-4 py-2.5 font-medium">Dirección</th>
                <th class="px-4 py-2.5 font-medium">Plan</th>
                <th class="px-4 py-2.5 font-medium">{bloque.accion === 'CORTE' ? 'Suspendido desde' : 'Cortado el'}</th>
                <th class="px-4 py-2.5 font-medium">Equipo</th>
                <th class="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              {#each bloque.filas as f (f.id_contrato)}
                <tr>
                  <td class="px-4 py-2.5">
                    {#if f.cliente}
                      <a href="/admin/clientes/{f.cliente.id_cliente}" class="btn-texto">{f.cliente.nombre_completo}</a>
                      <span class="block text-xs text-slate-500">{f.cliente.rut ?? ''}{f.cliente.telefono ? ` · ${f.cliente.telefono}` : ''}</span>
                    {:else}
                      <span class="text-slate-500">Cliente no registrado (contrato #{f.id_contrato})</span>
                    {/if}
                  </td>
                  <td class="px-4 py-2.5 text-slate-700">{f.direccion ? `${f.direccion.direccion_completa}, ${f.direccion.comuna}` : '—'}</td>
                  <td class="px-4 py-2.5 text-slate-700">{f.plan ?? '—'}</td>
                  <td class="px-4 py-2.5 text-slate-700 tabular-nums">
                    {bloque.accion === 'CORTE' ? (f.fecha_suspension ?? '—') : fecha(f.ultimo_registro?.fecha_hora ?? null)}
                  </td>
                  <td class="px-4 py-2.5">
                    {#if f.onts.length}
                      {#each f.onts as o (o.numero_serie)}
                        <a href={`/admin/monitoreo/ont/${encodeURIComponent(o.numero_serie)}`} class="btn-texto font-mono text-xs">{o.numero_serie}</a>
                        <span class="block text-xs text-slate-500">
                          {o.odb ?? 'Sin caja'}{o.odb_puerto ? ` · puerto ${o.odb_puerto}` : ''} · {o.estado_conexion ?? 'sin lectura'}
                        </span>
                      {/each}
                    {:else}
                      <span class="text-xs text-slate-500">Buscar en SmartOLT por nombre o RUT</span>
                    {/if}
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button onclick={() => abrir(f, bloque.accion)} class="btn btn-secundario whitespace-nowrap">Hecho en SmartOLT</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/each}

  <details class="bg-white rounded-xl border border-slate-200 p-5">
    <summary class="cursor-pointer text-lg font-semibold text-slate-900">Historial</summary>
    {#if panel.historial.length === 0}
      <p class="mt-3 text-sm text-slate-500">Todavía no se registra ningún corte ni reactivación.</p>
    {:else}
      <ul class="mt-3 divide-y divide-slate-100 text-sm">
        {#each panel.historial as h (h.id_log)}
          <li class="py-2.5 flex items-start justify-between gap-4">
            <div>
              <p class="font-medium text-slate-900">
                {h.accion === 'CORTE_SMARTOLT' ? 'Corte' : 'Reactivación'} · {h.cliente ?? `contrato #${h.id_contrato}`}
              </p>
              {#if h.observacion}<p class="text-slate-600">{h.observacion}</p>{/if}
            </div>
            <p class="text-xs text-slate-500 text-right shrink-0">{fecha(h.fecha_hora)}<br />{h.usuario ?? '—'}</p>
          </li>
        {/each}
      </ul>
    {/if}
  </details>
{/if}

{#if pendiente}
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-1000" role="dialog" aria-modal="true" aria-labelledby="titulo-corte">
    <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-3 text-sm">
      <h2 id="titulo-corte" class="text-lg font-semibold text-slate-900">
        {pendiente.accion === 'CORTE' ? 'Registrar corte' : 'Registrar reactivación'}
      </h2>
      <p class="text-slate-600">
        Confirma que {pendiente.accion === 'CORTE' ? 'cortaste' : 'reactivaste'} en SmartOLT el servicio de
        <strong>{pendiente.fila.cliente?.nombre_completo ?? `contrato #${pendiente.fila.id_contrato}`}</strong>.
      </p>
      <div>
        <label for="obs-corte" class="block text-sm font-medium text-slate-700 mb-1">Observación (opcional)</label>
        <textarea id="obs-corte" bind:value={observacion} maxlength="300" rows="2"
          class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"></textarea>
      </div>
      {#if errorDialogo}<p class="text-red-600">{errorDialogo}</p>{/if}
      <div class="flex gap-3">
        <button onclick={() => (pendiente = null)} class="flex-1 btn btn-secundario">Cancelar</button>
        <button onclick={confirmar} disabled={guardando} class="flex-1 btn btn-primario">
          {guardando ? 'Registrando...' : pendiente.accion === 'CORTE' ? 'Registrar corte' : 'Registrar reactivación'}
        </button>
      </div>
    </div>
  </div>
{/if}
