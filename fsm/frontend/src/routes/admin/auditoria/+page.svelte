<script lang="ts">
  // CU-41: consulta del log de auditoria. Solo el ADMIN. Lo que hicieron los
  // usuarios de la empresa activa, del mas reciente al mas antiguo.
  import Alert from '$lib/components/Alert.svelte';
  import Paginacion from '$lib/components/Paginacion.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as api from '$lib/api/auditoria.api';
  import { listarUsuarios } from '$lib/api/auth.api';

  let token = '';
  let eventos = $state<api.EventoAuditoria[]>([]);
  let total = $state(0);
  let page = $state(1);
  let limit = $state(50);
  let cargando = $state(true);
  let exportando = $state(false);
  let error = $state('');

  let usuarios = $state<{ id_usuario: number; nombre_completo: string }[]>([]);
  let acciones = $state<string[]>([]);
  let fUsuario = $state('');
  let fTipo = $state('');
  let fAccion = $state('');
  let fEntidad = $state('');
  let fDesde = $state('');
  let fHasta = $state('');

  const ENTIDADES = [
    { valor: 'orden_trabajo', etiqueta: 'OT' },
    { valor: 'cliente', etiqueta: 'Cliente' },
    { valor: 'ticket', etiqueta: 'Ticket' },
    { valor: 'usuario', etiqueta: 'Usuario' },
  ];

  const filtros = (): api.FiltrosAuditoria => ({
    id_usuario: fUsuario, tipo: fTipo, accion: fAccion, entidad: fEntidad, desde: fDesde, hasta: fHasta, page,
  });

  onMount(() => {
    authStore.checkAuth();
    const s = get(authStore);
    if (!s.isAuthenticated || s.usuario?.rol !== 'ADMIN') {
      goto('/admin/dashboard');
      return;
    }
    token = s.token ?? '';
    buscar();
    listarUsuarios(token).then((u) => (usuarios = u)).catch(() => {});
    api.accionesAuditoria(token).then((a) => (acciones = a)).catch(() => {});
  });

  async function buscar() {
    cargando = true;
    error = '';
    try {
      const r = await api.buscarAuditoria(token, filtros());
      eventos = r.data;
      total = r.total;
      limit = r.limit;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al consultar la auditoría';
    } finally {
      cargando = false;
    }
  }

  async function exportar() {
    exportando = true;
    error = '';
    try {
      await api.exportarAuditoria(token, filtros());
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo exportar';
    } finally {
      exportando = false;
    }
  }

  const fecha = (iso: string) => new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'medium' });
  const json = (v: unknown) => (v == null ? '-' : JSON.stringify(v));
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-slate-800">Auditoría</h1>
    <p class="text-sm text-slate-600">Qué hizo cada usuario, con el valor anterior y el nuevo.</p>
  </div>

  <div class="bg-white rounded-xl border p-4 grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">
    <label class="text-xs font-medium text-slate-600">Usuario
      <select bind:value={fUsuario} class="mt-1 block w-full border rounded-lg px-2 py-1.5 text-sm bg-white">
        <option value="">Todos</option>
        {#each usuarios as u (u.id_usuario)}<option value={String(u.id_usuario)}>{u.nombre_completo}</option>{/each}
      </select>
    </label>
    <label class="text-xs font-medium text-slate-600">Tipo de acción
      <select bind:value={fTipo} class="mt-1 block w-full border rounded-lg px-2 py-1.5 text-sm bg-white">
        <option value="">Todas</option>
        <option value="CREACION">Creación</option>
        <option value="MODIFICACION">Modificación</option>
        <option value="ELIMINACION">Eliminación</option>
      </select>
    </label>
    <label class="text-xs font-medium text-slate-600">Acción
      <select bind:value={fAccion} class="mt-1 block w-full border rounded-lg px-2 py-1.5 text-sm bg-white">
        <option value="">Todas</option>
        {#each acciones as a (a)}<option value={a}>{a}</option>{/each}
      </select>
    </label>
    <label class="text-xs font-medium text-slate-600">Entidad
      <select bind:value={fEntidad} class="mt-1 block w-full border rounded-lg px-2 py-1.5 text-sm bg-white">
        <option value="">Todas</option>
        {#each ENTIDADES as e (e.valor)}<option value={e.valor}>{e.etiqueta}</option>{/each}
      </select>
    </label>
    <label class="text-xs font-medium text-slate-600">Desde
      <input type="date" bind:value={fDesde} class="mt-1 block w-full border rounded-lg px-2 py-1.5 text-sm" />
    </label>
    <label class="text-xs font-medium text-slate-600">Hasta
      <input type="date" bind:value={fHasta} class="mt-1 block w-full border rounded-lg px-2 py-1.5 text-sm" />
    </label>
    <div class="col-span-2 lg:col-span-6 flex gap-3">
      <button onclick={() => { page = 1; buscar(); }} class="btn btn-primario">Buscar</button>
      <button onclick={exportar} disabled={exportando} class="btn btn-secundario">
        {exportando ? 'Exportando...' : 'Exportar a Excel'}
      </button>
    </div>
  </div>

  {#if error}<Alert>{error}</Alert>{/if}

  {#if cargando}
    <p role="status" class="text-slate-500">Buscando...</p>
  {:else if eventos.length === 0}
    <p class="rounded-xl border bg-white p-6 text-center text-slate-600">No se encontraron eventos con los filtros seleccionados.</p>
  {:else}
    <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table class="w-full text-sm">
        <caption class="sr-only">Eventos de auditoría</caption>
        <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
          <tr>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Fecha y hora</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Usuario</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Acción</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Entidad</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Valor anterior</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Valor nuevo</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each eventos as e (e.id_log)}
            <tr class="align-top">
              <td class="px-3 py-2 tabular-nums whitespace-nowrap">{fecha(e.fecha_hora)}</td>
              <td class="px-3 py-2">{e.usuario ?? '-'}</td>
              <td class="px-3 py-2 font-mono text-xs">{e.accion}</td>
              <td class="px-3 py-2 text-slate-700">{e.entidad_afectada ?? '-'} {e.id_entidad_afectada ? `#${e.id_entidad_afectada}` : ''}</td>
              <td class="px-3 py-2 font-mono text-xs text-slate-600 break-all">{json(e.valor_anterior)}</td>
              <td class="px-3 py-2 font-mono text-xs text-slate-600 break-all">{json(e.valor_nuevo)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Paginacion {page} {limit} {total} entidad="eventos" onchange={(p) => { page = p; buscar(); }} />
  {/if}
</div>
