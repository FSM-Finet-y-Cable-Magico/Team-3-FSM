<script lang="ts">
  import Alert from '$lib/components/Alert.svelte';
  import EstadoBadge from '$lib/components/EstadoBadge.svelte';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { authStore } from '$lib/stores/auth.store';
  import * as topologiaApi from '$lib/api/topologia.api';
  import type { DetallePuertos, DetalleSaludCaja, PuertoNap } from '$lib/api/topologia.api';
  import { ESTADO_CAJA } from '$lib/utils/estado-caja';
  import { POTENCIA_MAXIMA_DBM, POTENCIA_MINIMA_DBM, potenciaDegradandose } from '$lib/utils/potencia';

  let token = $state('');
  /** Lo que importa al jefe tecnico: ONT, alertas, OT y vecinas. */
  let salud = $state<DetalleSaludCaja | null>(null);
  /** Registro en terreno de puertos (CU-20) y datos editables de la caja. */
  let detalle = $state<DetallePuertos | null>(null);
  let cargando = $state(true);
  let error = $state('');
  let aviso = $state('');

  let editando = $state(false);
  let guardando = $state(false);
  let errorForm = $state('');

  let eIdentificador = $state('');
  let eZona = $state('');
  let ePoste = $state('');
  let eCapacidad = $state(16);

  /** Puerto cuyo menú de estado está abierto. null = ninguno. */
  let puertoAbierto = $state<number | null>(null);
  let cambiando = $state(false);

  const idCaja = $derived(Number($page.params.id));

  const ESTADOS = ['LIBRE', 'RESERVADO', 'OCUPADO', 'EN_MANTENCION'] as const;

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

  // Al saltar a una caja cercana cambia el parametro pero no se vuelve a montar
  // la pagina: hay que recargar a mano.
  let cargadaPara = 0;
  $effect(() => {
    const id = idCaja;
    if (token && cargadaPara && id !== cargadaPara) cargar();
  });

  async function cargar() {
    cargando = true;
    error = '';
    cargadaPara = idCaja;
    try {
      [salud, detalle] = await Promise.all([
        topologiaApi.saludCaja(token, idCaja),
        topologiaApi.puertosDeCaja(token, idCaja),
      ]);
      eIdentificador = detalle.identificador_unico ?? '';
      eZona = detalle.zona ?? '';
      ePoste = '';
      eCapacidad = detalle.capacidad_puertos || 16;
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo cargar la caja';
    } finally {
      cargando = false;
    }
  }

  async function guardar(e: Event) {
    e.preventDefault();
    guardando = true;
    errorForm = '';
    try {
      // Solo se manda lo que cambió: el backend rechaza un PATCH sin cambios,
      // y así el log de auditoría no guarda ediciones que no ocurrieron.
      const dto: Record<string, unknown> = {};
      if (eIdentificador.trim() !== (detalle?.identificador_unico ?? '')) {
        dto.identificador_unico = eIdentificador.trim();
      }
      if (eZona.trim() !== (detalle?.zona ?? '')) dto.zona = eZona.trim();
      if (ePoste.trim()) dto.numero_poste = ePoste.trim();
      if (eCapacidad !== detalle?.capacidad_puertos) dto.capacidad_puertos = eCapacidad;

      if (Object.keys(dto).length === 0) {
        errorForm = 'No cambiaste ningún dato';
        return;
      }

      await topologiaApi.editarCaja(token, idCaja, dto);
      editando = false;
      aviso = 'Caja actualizada';
      await cargar();
    } catch (err) {
      errorForm = err instanceof Error ? err.message : 'No se pudo guardar';
    } finally {
      guardando = false;
    }
  }

  async function cambiarEstado(p: PuertoNap, estado: string) {
    puertoAbierto = null;
    if (estado === p.estado) return;
    cambiando = true;
    error = '';
    try {
      // Al liberar hay que soltar también el cliente: el backend rechaza un
      // puerto no ocupado que siga apuntando a alguien (ocupación fantasma).
      await topologiaApi.editarPuerto(token, p.id_puerto, {
        estado,
        ...(estado !== 'OCUPADO' ? { id_cliente_asociado: null } : {}),
      });
      aviso = `Puerto ${p.numero_puerto} → ${estado}`;
      await cargar();
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo cambiar el puerto';
    } finally {
      cambiando = false;
    }
  }

  function colorPuerto(estado: string | null): string {
    if (estado === 'OCUPADO') return 'bg-red-100 text-red-800 border-red-200';
    if (estado === 'RESERVADO') return 'bg-amber-100 text-amber-800 border-amber-200';
    // Azul y no rojo: en mantencion no es una falla del cliente, es la caja.
    if (estado === 'EN_MANTENCION') return 'bg-blue-100 text-blue-800 border-blue-200';
    // Gris, no verde: verde se lee como "disponible" y no lo sabemos.
    return 'bg-slate-50 text-slate-600 border-slate-200';
  }

  /** Lo que se muestra en el chip del puerto. */
  function etiquetaPuerto(estado: string | null): string {
    if (estado === 'LIBRE' || estado == null) return 'sin registro';
    return estado.toLowerCase().replace('_', ' ');
  }

  function clasePotencia(dbm: number | null) {
    if (dbm == null) return 'text-slate-400';
    if (dbm < POTENCIA_MINIMA_DBM || dbm > POTENCIA_MAXIMA_DBM) return 'text-red-700 font-semibold';
    if (potenciaDegradandose(dbm)) return 'text-amber-700 font-semibold';
    return 'text-green-700';
  }

  function claseConexion(estado: string | null) {
    if (estado === 'ONLINE') return 'text-green-700';
    if (estado == null) return 'text-slate-400';
    return 'text-red-700 font-semibold';
  }

  function fecha(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  }

  /** "hace 3 h", "hace 2 d": cuánto lleva sin señal. */
  function hace(iso: string | null): string {
    if (!iso) return '';
    const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
    if (h < 1) return `hace ${Math.max(1, Math.round(h * 60))} min`;
    if (h < 48) return `hace ${Math.round(h)} h`;
    return `hace ${Math.round(h / 24)} d`;
  }

  function distancia(m: number): string {
    return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
  }

  const OT_CERRADA = ['COMPLETADA', 'CANCELADA'];
</script>

<svelte:head><title>{salud?.caja.identificador_unico ?? 'Caja'} · Topología</title></svelte:head>

<a href="/admin/topologia" class="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-4">
  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
  </svg>
  Volver al mapa
</a>

{#if aviso}
  <div role="status" class="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center justify-between">
    <span>{aviso}</span>
    <button onclick={() => (aviso = '')} class="text-emerald-600 hover:text-emerald-800 cursor-pointer" aria-label="Cerrar aviso">✕</button>
  </div>
{/if}

{#if cargando && !salud}
  <p class="text-center py-10 text-slate-500">Cargando...</p>
{:else if error && !salud}
  <Alert class="rounded-lg text-sm">{error}</Alert>
{:else if salud && detalle}
  {@const c = salud.caja}
  {@const meta = ESTADO_CAJA[c.estado]}
  {#if error}
    <Alert class="rounded-lg text-sm mb-4">{error}</Alert>
  {/if}

  <!-- Cabecera: qué caja es, dónde está y cómo está. -->
  <div class="bg-white rounded-xl border border-slate-200 p-5 mb-5">
    {#if !editando}
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-2xl font-bold text-slate-900">{c.identificador_unico ?? `#${c.id_caja_nap}`}</h1>
            <span class="text-xs font-medium px-2 py-0.5 rounded border {meta.badge}">{meta.etiqueta}</span>
          </div>
          <p class="text-sm text-slate-500 mt-0.5">
            {c.zona ?? 'Sin zona'}
            {#if c.numero_poste} · Poste {c.numero_poste}{/if}
            {#if c.mufa} · Mufa {c.mufa}{/if}
          </p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          {#if c.latitud != null && c.longitud != null}
            <a
              href={`https://www.google.com/maps?q=${c.latitud},${c.longitud}`}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-secundario"
            >
              Abrir en Google Maps
            </a>
          {/if}
          {#if salud.claves_smartolt.length}
            <a href={`/admin/monitoreo/caja?clave=${encodeURIComponent(salud.claves_smartolt[0])}`} class="btn btn-secundario">
              Ver puertos en SmartOLT
            </a>
          {/if}
          <button onclick={() => { editando = true; errorForm = ''; }} class="btn btn-secundario">
            Editar datos
          </button>
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-5 pt-5 border-t border-slate-100">
        {#each [
          { l: 'ONT activas', v: c.onts.total, cl: 'text-slate-900' },
          { l: 'En línea', v: c.onts.en_linea, cl: 'text-green-700' },
          { l: 'Sin servicio', v: c.onts.caidas, cl: c.onts.caidas ? 'text-red-700' : 'text-slate-900' },
          { l: 'Potencia fuera de rango', v: c.onts.potencia_fuera, cl: c.onts.potencia_fuera ? 'text-amber-700' : 'text-slate-900' },
          { l: 'Potencia promedio', v: c.onts.potencia_promedio == null ? '—' : `${c.onts.potencia_promedio} dBm`, cl: clasePotencia(c.onts.potencia_promedio) },
        ] as t}
          <div>
            <p class="text-xs uppercase tracking-wide text-slate-500">{t.l}</p>
            <p class="text-xl font-semibold {t.cl} mt-0.5 tabular-nums">{t.v}</p>
          </div>
        {/each}
      </div>
      {#if salud.claves_smartolt.length > 1}
        <p class="text-xs text-amber-700 mt-3">
          Las ONT de esta caja aparecen en SmartOLT bajo {salud.claves_smartolt.length} cajas distintas:
          {#each salud.claves_smartolt as k, i}
            <a href={`/admin/monitoreo/caja?clave=${encodeURIComponent(k)}`} class="underline hover:text-amber-900">{k}</a>{i < salud.claves_smartolt.length - 1 ? ', ' : ''}
          {/each}.
          Puede que el ligado haya juntado ONT de cajas vecinas.
        </p>
      {/if}
    {:else}
      <form onsubmit={guardar}>
        <h2 class="text-lg font-semibold text-slate-900 mb-4">Editar caja</h2>

        {#if errorForm}
          <Alert class="rounded-lg text-sm mb-4">
            {errorForm}
          </Alert>
        {/if}

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="e-id" class="block text-sm font-medium text-slate-700 mb-1">Identificador</label>
            <input id="e-id" bind:value={eIdentificador}
              class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label for="e-zona" class="block text-sm font-medium text-slate-700 mb-1">Zona</label>
            <input id="e-zona" bind:value={eZona}
              class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label for="e-poste" class="block text-sm font-medium text-slate-700 mb-1">N.º de poste</label>
            <input id="e-poste" bind:value={ePoste} placeholder={c.numero_poste ?? ''}
              class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label for="e-cap" class="block text-sm font-medium text-slate-700 mb-1">Capacidad</label>
            <select id="e-cap" bind:value={eCapacidad}
              class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer">
              {#each [8, 16, 24, 32] as n}<option value={n}>{n} puertos</option>{/each}
            </select>
            <p class="text-xs text-slate-500 mt-1">
              No puede bajar de los {detalle.ocupados} puertos ocupados.
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-5">
          <button type="button" onclick={() => (editando = false)}
            class="btn btn-secundario border-transparent shadow-none">
            Cancelar
          </button>
          <button type="submit" disabled={guardando}
            class="btn btn-primario">
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    {/if}
  </div>

  {#if salud.alertas.length}
    <div class="bg-white rounded-xl border border-red-200 p-5 mb-5">
      <div class="flex items-center justify-between gap-3 mb-3">
        <h2 class="text-lg font-semibold text-slate-900">Alertas abiertas</h2>
        <a href="/admin/alertas" class="btn-texto">Ir al panel de alertas</a>
      </div>
      <ul class="divide-y divide-slate-100">
        {#each salud.alertas as a (a.id_alerta)}
          <li class="py-2.5 flex items-start justify-between gap-4 text-sm">
            <div class="min-w-0">
              <p class="font-medium text-slate-900">
                {a.tipo.replaceAll('_', ' ').toLowerCase()}
                {#if a.afectados > 1}<span class="text-slate-500 font-normal"> · {a.afectados} clientes</span>{/if}
              </p>
              {#if a.mensaje}<p class="text-slate-600">{a.mensaje}</p>{/if}
            </div>
            <div class="text-right shrink-0">
              <p class="text-xs text-slate-500">{fecha(a.creada_en)}</p>
              {#if a.id_ot_generada}
                <a href="/admin/ot/{a.id_ot_generada}" class="btn-texto text-xs">OT #{a.id_ot_generada}</a>
              {:else}
                <p class="text-xs text-amber-700">Sin OT</p>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- ONT de la caja: es el corazón de la página. -->
  <div class="bg-white rounded-xl border border-slate-200 mb-5 overflow-hidden">
    <div class="px-5 pt-5 pb-3">
      <h2 class="text-lg font-semibold text-slate-900">ONT de esta caja</h2>
      <p class="text-sm text-slate-500">Estado y potencia de la última lectura de SmartOLT. El puerto es el que informa SmartOLT.</p>
    </div>
    {#if salud.onts.length === 0}
      <p class="px-5 pb-5 text-sm text-slate-500">
        Ninguna ONT quedó ligada a esta caja. Puede ser de otro operador que comparte el poste,
        o una caja cuyo nombre no calzó con ninguna de SmartOLT.
      </p>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 border-y border-slate-200">
            <tr class="text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="px-4 py-2.5 font-medium text-right">Puerto</th>
              <th class="px-4 py-2.5 font-medium">ONT</th>
              <th class="px-4 py-2.5 font-medium">Cliente</th>
              <th class="px-4 py-2.5 font-medium">Estado</th>
              <th class="px-4 py-2.5 font-medium text-right">Potencia</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each salud.onts as o (o.numero_serie)}
              <tr class={o.posible_baja || o.suspendido ? 'opacity-60' : ''}>
                <td class="px-4 py-2.5 text-right tabular-nums text-slate-700">{o.odb_puerto ?? '—'}</td>
                <td class="px-4 py-2.5">
                  <a href={`/admin/monitoreo/ont/${encodeURIComponent(o.numero_serie)}`} class="btn-texto font-mono text-xs">{o.numero_serie}</a>
                  <span class="block text-xs text-slate-500">OLT {o.olt_externo ?? '?'} · {o.board ?? '?'}/{o.puerto_pon ?? '?'}{o.odb ? ` · ${o.odb}` : ''}</span>
                </td>
                <td class="px-4 py-2.5 text-slate-700 max-w-64">
                  {#if o.id_cliente}
                    <a href="/admin/clientes/{o.id_cliente}" class="btn-texto">{o.nombre_cliente ?? `Cliente #${o.id_cliente}`}</a>
                  {:else}
                    <span class="truncate block" title={o.nombre_cliente ?? ''}>{o.nombre_cliente ?? '—'}</span>
                  {/if}
                </td>
                <td class="px-4 py-2.5">
                  <span class={claseConexion(o.estado_conexion)}>{o.estado_conexion ?? 'Sin lectura'}</span>
                  {#if o.estado_conexion && o.estado_conexion !== 'ONLINE' && o.sin_senal_desde}
                    <span class="block text-xs text-slate-500">{hace(o.sin_senal_desde)}</span>
                  {/if}
                  {#if o.suspendido}
                    <span class="block text-xs text-amber-700">Suspendido por deuda: no cuenta en el estado</span>
                  {:else if o.posible_baja}
                    <span class="block text-xs text-slate-500">Posible baja: no cuenta en el estado</span>
                  {/if}
                </td>
                <td class="px-4 py-2.5 text-right tabular-nums {clasePotencia(o.potencia_dbm)}">
                  {o.potencia_dbm == null ? '—' : `${o.potencia_dbm} dBm`}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <div class="grid gap-5 lg:grid-cols-2 mb-5">
    <div class="bg-white rounded-xl border border-slate-200 p-5">
      <h2 class="text-lg font-semibold text-slate-900 mb-1">Órdenes de trabajo</h2>
      <p class="text-sm text-slate-500 mb-3">Las 10 más recientes sobre esta caja. Si se repiten, es un punto que falla seguido.</p>
      {#if salud.ots.length === 0}
        <p class="text-sm text-slate-500">Ninguna OT registrada sobre esta caja.</p>
      {:else}
        <ul class="divide-y divide-slate-100">
          {#each salud.ots as ot (ot.id_ot)}
            <li class="py-2.5 flex items-center justify-between gap-3 text-sm">
              <div class="min-w-0">
                <a href="/admin/ot/{ot.id_ot}" class="btn-texto">OT #{ot.id_ot}</a>
                <span class="text-slate-500"> · {ot.tipo_ot.toLowerCase()}</span>
                <p class="text-xs text-slate-500">
                  {fecha(ot.fecha_creacion)}{ot.tecnico ? ` · ${ot.tecnico.nombre_completo}` : ' · Sin técnico'}
                </p>
              </div>
              <div class="flex items-center gap-1.5 shrink-0 {OT_CERRADA.includes(ot.estado) ? 'opacity-70' : ''}">
                <EstadoBadge estado={ot.prioridad} size="sm" />
                <EstadoBadge estado={ot.estado} size="sm" />
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="bg-white rounded-xl border border-slate-200 p-5">
      <h2 class="text-lg font-semibold text-slate-900 mb-1">Cajas cercanas</h2>
      <p class="text-sm text-slate-500 mb-3">Para ver si la falla es de esta caja o del tramo: si las vecinas también están mal, el problema está más arriba.</p>
      {#if c.latitud == null || c.longitud == null}
        <p class="text-sm text-amber-700">Esta caja no tiene ubicación, así que no se pueden buscar vecinas.</p>
      {:else if salud.cercanas.length === 0}
        <p class="text-sm text-slate-500">No hay otras cajas con ubicación.</p>
      {:else}
        <ul class="divide-y divide-slate-100">
          {#each salud.cercanas as v (v.id_caja_nap)}
            {@const mv = ESTADO_CAJA[v.estado]}
            <li class="py-2.5 flex items-center justify-between gap-3 text-sm">
              <div class="min-w-0 flex items-center gap-2">
                <span class="inline-block w-2.5 h-2.5 rounded-full shrink-0" style="background: {mv.color}" aria-hidden="true"></span>
                <a href="/admin/topologia/{v.id_caja_nap}" class="btn-texto truncate">{v.identificador_unico ?? `#${v.id_caja_nap}`}</a>
                <span class="text-xs text-slate-500 whitespace-nowrap">{mv.etiqueta}</span>
              </div>
              <span class="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                {v.onts.total ? `${v.onts.en_linea}/${v.onts.total} en línea · ` : ''}{distancia(v.distancia_m)}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>

  <!-- CU-20. Queda abajo y plegado: es la herramienta del que vuelve de
       terreno, no lo primero que necesita el jefe técnico al abrir la caja. -->
  <details class="bg-white rounded-xl border border-slate-200 p-5 group">
    <summary class="cursor-pointer list-none flex items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-slate-900 inline">Registro en terreno de puertos</h2>
        <p class="text-sm text-slate-500">
          {detalle.puertos.length
            ? `${detalle.ocupados} ocupados, ${detalle.reservados} reservados, ${detalle.en_mantencion} en mantención, ${detalle.sin_registro} sin registro`
            : 'Esta caja no tiene puertos registrados'}
        </p>
      </div>
      <svg class="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </summary>

    <div class="mt-4">
      <p class="text-sm text-slate-500 mb-3">Haz clic en un puerto para registrar lo que se encontró en terreno.</p>

      <!-- El aviso no es decorativo: sin el, la grilla se lee como una promesa de
           cupo, y la caja es del poste, no de FiNet. -->
      <div class="mb-4 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
        <strong>«Sin registro» no es lo mismo que «libre».</strong> Las cajas están en
        postes y las comparten varios operadores, así que la ocupación real solo se
        confirma en terreno. Lo único seguro es lo marcado como ocupado.
      </div>

      <div class="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
        {#each detalle.puertos as p (p.id_puerto)}
          <div class="relative">
            <button
              onclick={() => (puertoAbierto = puertoAbierto === p.id_puerto ? null : p.id_puerto)}
              disabled={cambiando}
              aria-label="Puerto {p.numero_puerto}, {p.estado}"
              class="w-full border rounded-lg px-2 py-3 text-center transition-colors cursor-pointer hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed {colorPuerto(p.estado)}"
            >
              <span class="block text-sm font-semibold tabular-nums">{p.numero_puerto}</span>
              <span class="block text-[10px] uppercase tracking-wide mt-0.5">{etiquetaPuerto(p.estado)}</span>
            </button>

            {#if puertoAbierto === p.id_puerto}
              <div class="absolute z-20 mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                {#each ESTADOS as e}
                  <button
                    onclick={() => cambiarEstado(p, e)}
                    disabled={e === 'OCUPADO' && p.id_cliente_asociado == null}
                    title={e === 'OCUPADO' && p.id_cliente_asociado == null
                      ? 'Un puerto ocupado necesita un cliente asociado'
                      : ''}
                    class="w-full px-3 py-2 text-left text-xs hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer {e === p.estado ? 'font-semibold text-blue-600' : 'text-slate-700'}"
                  >
                    {e}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>

      {#if detalle.puertos.length === 0}
        <p class="text-sm text-slate-500">
          Sin puertos registrados. Se crean al darle capacidad con «Editar datos», o con «Reconciliar puertos».
        </p>
      {/if}
    </div>
  </details>
{/if}
