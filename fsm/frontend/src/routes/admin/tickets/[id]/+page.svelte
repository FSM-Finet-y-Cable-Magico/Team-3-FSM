<script lang="ts">
  // CU-30 y CU-32: detalle de un ticket. El jefe tecnico lo toma para
  // resolverlo a distancia, lo reclasifica si la categoria no era la correcta,
  // o lo deriva a una OT de terreno.
  import Alert from '$lib/components/Alert.svelte';
  import EstadoBadge from '$lib/components/EstadoBadge.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { authStore } from '$lib/stores/auth.store';
  import * as api from '$lib/api/tickets.api';
  import { listarCategoriasFalla, listarTecnicos, type CategoriaFalla, type Tecnico } from '$lib/api/ordenes.api';

  const id = $derived(Number($page.params.id ?? 0));
  let token = '';
  let ticket = $state<api.DetalleTicket | null>(null);
  let cargando = $state(true);
  let error = $state('');
  let ocupado = $state(false);

  let categorias = $state<CategoriaFalla[]>([]);
  let nuevaCategoria = $state('');
  let observacion = $state('');

  let tecnicos = $state<Tecnico[]>([]);
  let mostrarDerivar = $state(false);
  let tipoOt = $state('REPARACION');
  let idTecnico = $state('');
  let indicaciones = $state('');

  const abierto = $derived(ticket !== null && ticket.estado !== 'RESUELTO');

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
    listarTecnicos(token).then((t) => (tecnicos = t)).catch(() => {});
  });

  async function cargar() {
    cargando = true;
    try {
      ticket = await api.obtenerTicket(token, id);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al cargar el ticket';
    } finally {
      cargando = false;
    }
  }

  /** Toda accion devuelve el ticket actualizado: se reemplaza y listo. */
  async function accion(hacer: () => Promise<api.DetalleTicket>) {
    ocupado = true;
    error = '';
    try {
      ticket = await hacer();
      return true;
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo completar la acción';
      return false;
    } finally {
      ocupado = false;
    }
  }

  async function resolver() {
    if (!observacion.trim()) {
      error = 'Anota qué se hizo para resolverlo';
      return;
    }
    if (await accion(() => api.resolverTicket(token, id, observacion.trim()))) observacion = '';
  }

  async function reclasificar() {
    if (!nuevaCategoria) return;
    if (await accion(() => api.reclasificarTicket(token, id, Number(nuevaCategoria)))) nuevaCategoria = '';
  }

  async function derivar() {
    const ok = await accion(() =>
      api.escalarTicket(token, id, {
        tipo_ot: tipoOt,
        ...(idTecnico && { id_tecnico: Number(idTecnico) }),
        ...(indicaciones.trim() && { observaciones: indicaciones.trim() }),
      }),
    );
    if (ok) mostrarDerivar = false;
  }

  const fecha = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '-';
  const sla = (c: CategoriaFalla) => (c.sla_horas == null ? 'sin SLA' : `SLA ${c.sla_horas} h`);

  const ACCIONES: Record<string, string> = {
    CREAR_TICKET: 'Ticket creado',
    CAMBIAR_ESTADO_TICKET: 'Cambio de estado',
    RECLASIFICAR_TICKET: 'Reclasificado',
    ASIGNAR_TICKET: 'Asignado',
  };
  function detalle(e: api.EntradaHistorial): string {
    const n = e.valor_nuevo ?? {};
    if (e.accion === 'RECLASIFICAR_TICKET') return `${e.valor_anterior?.categoria} → ${n.categoria}`;
    if (e.accion === 'CAMBIAR_ESTADO_TICKET') {
      return [`${e.valor_anterior?.estado} → ${n.estado}`, n.observacion, n.id_ot ? `OT #${n.id_ot}` : null]
        .filter(Boolean)
        .join(' · ');
    }
    return '';
  }
</script>

<div class="space-y-6">
  <a href="/admin/tickets" class="btn-texto text-sm">← Volver a tickets</a>

  {#if error}<Alert>{error}</Alert>{/if}

  {#if cargando}
    <p role="status" class="text-slate-500">Cargando ticket...</p>
  {:else if ticket}
    <div class="bg-white rounded-xl shadow p-6 space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-bold text-slate-800 font-mono">{ticket.codigo_seguimiento}</h1>
        <EstadoBadge estado={ticket.estado} />
        <EstadoBadge estado={ticket.prioridad} />
        {#if ticket.sla_vencido}
          <span class="text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">SLA vencido</span>
        {/if}
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Cliente</p>
          <p class="font-medium text-slate-900">{ticket.cliente?.nombre_completo ?? '-'}</p>
          <p class="font-mono text-xs text-slate-500">{ticket.cliente?.rut ?? ''}</p>
          {#if ticket.cliente?.telefono}
            <a href={`tel:${ticket.cliente.telefono}`} class="btn-texto text-xs font-mono">{ticket.cliente.telefono}</a>
          {/if}
        </div>
        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Problema</p>
          <p class="font-medium text-slate-900">{ticket.categoria.nombre}</p>
          <p class="text-xs text-slate-500">
            {ticket.sla_horas == null ? 'Sin SLA' : `SLA ${ticket.sla_horas} h · vence ${fecha(ticket.vence_en)}`}
          </p>
        </div>
        <div class="sm:col-span-2">
          <p class="text-xs font-medium uppercase text-slate-500">Descripción</p>
          <p class="text-slate-800 whitespace-pre-line">{ticket.descripcion ?? '-'}</p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Abierto</p>
          <p class="text-slate-800">{fecha(ticket.fecha_creacion)} · por {ticket.origen ?? '-'}</p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase text-slate-500">A cargo</p>
          <p class="text-slate-800">{ticket.usuario_asignado?.nombre_completo ?? 'Sin asignar'}</p>
        </div>
        {#if ticket.orden_trabajo}
          <div>
            <p class="text-xs font-medium uppercase text-slate-500">Derivado a</p>
            <a href={`/admin/ot/${ticket.orden_trabajo.id_ot}`} class="btn-texto">OT #{ticket.orden_trabajo.id_ot}</a>
            <span class="text-xs text-slate-500">({ticket.orden_trabajo.estado})</span>
          </div>
        {/if}
        {#if ticket.fecha_cierre}
          <div>
            <p class="text-xs font-medium uppercase text-slate-500">Resuelto</p>
            <p class="text-slate-800">{fecha(ticket.fecha_cierre)} · {ticket.resuelto_remotamente ? 'a distancia' : 'en terreno'}</p>
          </div>
        {/if}
      </div>
    </div>

    {#if abierto}
      <div class="bg-white rounded-xl shadow p-6 space-y-5">
        <h2 class="font-semibold text-slate-700">Acciones</h2>

        {#if ticket.estado === 'ABIERTO' || ticket.estado === 'EN_PROGRESO'}
          <div class="flex flex-wrap gap-3">
            {#if ticket.estado === 'ABIERTO'}
              <button onclick={() => accion(() => api.tomarTicket(token, id))} disabled={ocupado} class="btn btn-primario">
                Tomar para resolver a distancia
              </button>
            {/if}
            <button onclick={() => (mostrarDerivar = true)} disabled={ocupado} class="btn btn-secundario">
              Derivar a OT de terreno
            </button>
          </div>
        {/if}

        {#if ticket.estado === 'EN_PROGRESO'}
          <div class="space-y-2">
            <label for="obs-resolucion" class="block text-xs font-medium text-slate-600">Qué se hizo para resolverlo</label>
            <textarea id="obs-resolucion" bind:value={observacion} rows={2} maxlength={1000} class="w-full border rounded-lg px-3 py-2 text-sm resize-none"></textarea>
            <button onclick={resolver} disabled={ocupado} class="btn btn-exito">Marcar resuelto</button>
          </div>
        {/if}

        <!-- CU-32: la categoria decide el SLA y la prioridad. -->
        <div class="flex flex-wrap items-end gap-2">
          <label class="text-xs font-medium text-slate-600">Nueva categoría
            <select bind:value={nuevaCategoria} class="mt-1 block border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Elige una categoría</option>
              {#each categorias as c (c.id_categoria)}
                <option value={String(c.id_categoria)}>{c.nombre} ({sla(c)})</option>
              {/each}
            </select>
          </label>
          <button onclick={reclasificar} disabled={ocupado || !nuevaCategoria} class="btn btn-secundario">Reclasificar</button>
        </div>
      </div>
    {/if}

    <div class="bg-white rounded-xl shadow p-6">
      <h2 class="font-semibold text-slate-700 mb-3">Historial</h2>
      {#if ticket.historial.length === 0}
        <p class="text-sm text-slate-500">Sin movimientos.</p>
      {:else}
        <ol class="space-y-2 text-sm">
          {#each ticket.historial as e, i (i)}
            <li class="border-l-2 border-slate-200 pl-3">
              <span class="font-medium text-slate-800">{ACCIONES[e.accion] ?? e.accion}</span>
              <span class="text-slate-600">{detalle(e)}</span>
              <span class="block text-xs text-slate-500">{fecha(e.fecha_hora)} · {e.usuario?.nombre_completo ?? 'Sistema'}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {/if}
</div>

{#if mostrarDerivar}
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby="titulo-derivar">
    <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-3">
      <h3 id="titulo-derivar" class="font-semibold text-slate-800">Derivar a una OT de terreno</h3>
      <p class="text-sm text-slate-600">El ticket se resuelve solo cuando la OT se complete.</p>
      <label class="block text-xs font-medium text-slate-600">Tipo de OT
        <select bind:value={tipoOt} class="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
          <option value="REPARACION">Reparación</option>
          <option value="REEMPLAZO">Reemplazo</option>
          <option value="PREVENTIVO">Preventivo</option>
        </select>
      </label>
      <label class="block text-xs font-medium text-slate-600">Técnico (opcional)
        <select bind:value={idTecnico} class="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
          <option value="">Asignar después</option>
          {#each tecnicos as t (t.id_usuario)}
            <option value={String(t.id_usuario)}>{t.nombre_completo} ({t.ot_activas_hoy} OT activas)</option>
          {/each}
        </select>
      </label>
      <label class="block text-xs font-medium text-slate-600">Indicaciones para el técnico
        <textarea bind:value={indicaciones} rows={3} maxlength={500} class="mt-1 w-full border rounded-lg px-3 py-2 text-sm resize-none"></textarea>
      </label>
      <div class="flex gap-3">
        <button onclick={() => (mostrarDerivar = false)} class="flex-1 btn btn-secundario text-sm">Volver</button>
        <button onclick={derivar} disabled={ocupado} class="flex-1 btn btn-primario text-sm">{ocupado ? 'Creando...' : 'Crear OT'}</button>
      </div>
    </div>
  </div>
{/if}
