<script lang="ts">
  // CU-30: panel de tickets del jefe tecnico, espejo del listado de OT. CU-29:
  // el jefe tecnico registra aca lo que el cliente reporta por telefono, en
  // persona o por correo; los canales digitales entran por integracion.
  import Paginacion from '$lib/components/Paginacion.svelte';
  import Alert from '$lib/components/Alert.svelte';
  import Cargando from '$lib/components/Cargando.svelte';
  import EstadoBadge from '$lib/components/EstadoBadge.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as api from '$lib/api/tickets.api';
  import { listarCategoriasFalla, type CategoriaFalla } from '$lib/api/ordenes.api';

  let token = '';
  let tickets = $state<api.Ticket[]>([]);
  let total = $state(0);
  let page = $state(1);
  const limit = 20;
  let loading = $state(true);
  let errorMsg = $state('');
  let aviso = $state('');
  let filtroEstado = $state('');

  let categorias = $state<CategoriaFalla[]>([]);
  let mostrarNuevo = $state(false);
  let rut = $state('');
  let idCategoria = $state('');
  let origen = $state('TELEFONO');
  let descripcion = $state('');
  let creando = $state(false);
  let errorNuevo = $state('');

  onMount(() => {
    authStore.checkAuth();
    const s = get(authStore);
    if (!s.isAuthenticated || !['ADMIN', 'JEFE_TECNICO'].includes(s.usuario?.rol ?? '')) {
      goto('/admin/dashboard');
      return;
    }
    token = s.token ?? '';
    cargar();
    listarCategoriasFalla(token).then((c) => (categorias = c)).catch(() => {});
  });

  async function cargar() {
    loading = true;
    errorMsg = '';
    try {
      const r = await api.listarTickets(token, { estado: filtroEstado || undefined, page, limit });
      tickets = r.data;
      total = r.total;
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Error al cargar tickets';
    } finally {
      loading = false;
    }
  }

  function cambiarPagina(p: number) {
    page = p;
    cargar();
  }

  async function crear() {
    if (!rut.trim() || !idCategoria) {
      errorNuevo = 'Ingresa el RUT y el problema';
      return;
    }
    creando = true;
    errorNuevo = '';
    try {
      const t = await api.crearTicket(token, {
        rut_cliente: rut.trim(),
        id_categoria: Number(idCategoria),
        origen,
        ...(descripcion.trim() && { descripcion: descripcion.trim() }),
      });
      aviso = `Ticket ${t.codigo_seguimiento} creado. Díselo al cliente para que pueda seguirlo.`;
      mostrarNuevo = false;
      rut = '';
      idCategoria = '';
      descripcion = '';
      cargar();
    } catch (e) {
      errorNuevo = e instanceof Error ? e.message : 'Error al crear el ticket';
    } finally {
      creando = false;
    }
  }

  const sla = (c: CategoriaFalla) => (c.sla_horas == null ? 'sin SLA' : `SLA ${c.sla_horas} h`);
  const fecha = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '-';
</script>

<div class="space-y-6">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-slate-800">Tickets de soporte</h1>
      <p class="text-sm text-slate-600">Reportes de los clientes: resolver a distancia o derivar a una OT.</p>
    </div>
    <button onclick={() => (mostrarNuevo = true)} class="btn btn-primario">Nuevo ticket</button>
  </div>

  {#if aviso}
    <div role="status" class="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{aviso}</div>
  {/if}

  <div class="flex flex-col gap-1 w-48">
    <label for="filtro-estado-ticket" class="text-xs font-medium text-slate-600">Estado</label>
    <select
      id="filtro-estado-ticket"
      bind:value={filtroEstado}
      onchange={() => cambiarPagina(1)}
      class="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white"
    >
      <option value="">Todos</option>
      <option>ABIERTO</option>
      <option>EN_PROGRESO</option>
      <option>DERIVADO_OT</option>
      <option>RESUELTO</option>
    </select>
  </div>

  {#if errorMsg}<Alert>{errorMsg}</Alert>{/if}

  {#if loading}
    <Cargando mensaje="Cargando tickets..." class="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center" spinnerClass="h-8 w-8 text-blue-500 mx-auto mb-3" mensajeClass="text-slate-400 text-sm" />
  {:else if tickets.length === 0}
    <p class="rounded-xl border bg-white p-6 text-center text-slate-600">No hay tickets con ese filtro.</p>
  {:else}
    <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table class="w-full text-sm">
        <caption class="sr-only">Tickets de soporte</caption>
        <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
          <tr>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Ticket</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Cliente</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Problema</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Prioridad</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Estado</th>
            <th scope="col" class="px-3 py-2 text-left font-semibold">SLA</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each tickets as t (t.id_ticket)}
            <tr class={t.sla_vencido ? 'bg-red-50' : 'hover:bg-slate-50'}>
              <td class="px-3 py-2">
                <a href={`/admin/tickets/${t.id_ticket}`} class="btn-texto font-mono">{t.codigo_seguimiento}</a>
              </td>
              <td class="px-3 py-2 text-slate-900">
                {t.cliente?.nombre_completo ?? '-'}
                <span class="block text-xs text-slate-500 font-mono">{t.cliente?.rut ?? ''}</span>
              </td>
              <td class="px-3 py-2 text-slate-700">{t.categoria.nombre}</td>
              <td class="px-3 py-2"><EstadoBadge estado={t.prioridad} /></td>
              <td class="px-3 py-2"><EstadoBadge estado={t.estado} /></td>
              <td class="px-3 py-2 text-xs">
                {#if t.sla_vencido}
                  <span class="font-semibold text-red-700">SLA vencido</span>
                {:else}
                  <span class="text-slate-600">vence {fecha(t.vence_en)}</span>
                {/if}
                <span class="block text-slate-500">hace {t.horas_transcurridas} h</span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Paginacion {page} {limit} {total} entidad="tickets" onchange={cambiarPagina} />
  {/if}
</div>

{#if mostrarNuevo}
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby="titulo-nuevo-ticket">
    <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-3">
      <h3 id="titulo-nuevo-ticket" class="font-semibold text-slate-800">Nuevo ticket</h3>
      <label class="block text-xs font-medium text-slate-600">RUT del cliente
        <input bind:value={rut} placeholder="12345678-5" class="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
      </label>
      <label class="block text-xs font-medium text-slate-600">Problema
        <select bind:value={idCategoria} class="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
          <option value="">Elige el tipo de problema</option>
          {#each categorias as c (c.id_categoria)}
            <option value={String(c.id_categoria)}>{c.nombre} ({sla(c)})</option>
          {/each}
        </select>
      </label>
      <label class="block text-xs font-medium text-slate-600">Canal
        <select bind:value={origen} class="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
          {#each api.ORIGENES_INTERNOS as o (o.valor)}
            <option value={o.valor}>{o.etiqueta}</option>
          {/each}
        </select>
      </label>
      <label class="block text-xs font-medium text-slate-600">Descripción
        <textarea bind:value={descripcion} rows={3} maxlength={1000} class="mt-1 w-full border rounded-lg px-3 py-2 text-sm resize-none"></textarea>
      </label>
      {#if errorNuevo}<p class="text-red-600 text-sm">{errorNuevo}</p>{/if}
      <div class="flex gap-3">
        <button onclick={() => { mostrarNuevo = false; errorNuevo = ''; }} class="flex-1 btn btn-secundario text-sm">Volver</button>
        <button onclick={crear} disabled={creando} class="flex-1 btn btn-primario text-sm">{creando ? 'Creando...' : 'Crear ticket'}</button>
      </div>
    </div>
  </div>
{/if}
