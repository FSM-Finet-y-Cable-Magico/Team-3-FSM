<script lang="ts">
  // Panel de alertas de red para el JEFE_TECNICO.
  // CU-13 (potencia), CU-52/53 (sin señal), CU-17 (caja caída), CU-15 (críticos
  // por NAP), CU-16 (candidatas a preventiva).
  //
  // La vista separa INCIDENTES (una causa que afecta a muchos clientes) de las
  // alertas por cliente, porque la acción es distinta: el incidente se despacha
  // una vez y resuelve a todos; la individual es una visita por cliente.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import {
    listarAlertas, obtenerResumenAlertas, revisarAlerta, evaluarAlertas, obtenerFacetas,
    type Alerta, type ResumenAlertas, type Facetas,
  } from '$lib/api/alertas.api';

  let resumen = $state<ResumenAlertas | null>(null);
  let facetas = $state<Facetas | null>(null);
  let alertas = $state<Alerta[]>([]);
  let cargando = $state(true);
  let evaluando = $state(false);
  let error = $state('');
  let filtroTipo = $state('');
  let filtroZona = $state('');
  let filtroCaja = $state('');
  let verResueltas = $state(false);
  let expandida = $state<number | null>(null);

  // Selección para revisar en lote: con 143 alertas de potencia, marcarlas de a
  // una es inviable.
  let seleccion = $state<Set<number>>(new Set());

  // Modal de revisión (reemplaza al prompt() del navegador).
  let modalAbierto = $state(false);
  let modalTexto = $state('');
  let modalObjetivo = $state<Alerta[]>([]);
  let inputModal = $state<HTMLTextAreaElement | null>(null);

  const token = () => get(authStore).token ?? '';

  const TIPOS: Record<string, { etiqueta: string; agregada: boolean }> = {
    FALLA_OLT:             { etiqueta: 'OLT caída',            agregada: true },
    FALLA_PLACA_OLT:       { etiqueta: 'Placa caída',          agregada: true },
    FALLA_CAJA_NAP:        { etiqueta: 'Caja caída',           agregada: true },
    POTENCIA_DEGRADANDOSE: { etiqueta: 'Preventiva sugerida',  agregada: true },
    SIN_SENAL:             { etiqueta: 'Sin señal',            agregada: false },
    POTENCIA_BAJA:         { etiqueta: 'Señal débil',          agregada: false },
    POTENCIA_ALTA:         { etiqueta: 'Señal excesiva',       agregada: false },
  };

  const SEV: Record<string, { clase: string; punto: string; orden: number }> = {
    CRITICA: { clase: 'bg-red-50 text-red-800 border-red-200',       punto: 'bg-red-500',    orden: 1 },
    ALTA:    { clase: 'bg-orange-50 text-orange-800 border-orange-200', punto: 'bg-orange-500', orden: 2 },
    MEDIA:   { clase: 'bg-amber-50 text-amber-800 border-amber-200',  punto: 'bg-amber-500',  orden: 3 },
    BAJA:    { clase: 'bg-slate-50 text-slate-700 border-slate-200',  punto: 'bg-slate-400',  orden: 4 },
  };
  const sev = (s: string | null) => SEV[s ?? ''] ?? SEV.BAJA;

  async function cargar() {
    cargando = true;
    error = '';
    seleccion = new Set();
    try {
      [resumen, facetas, alertas] = await Promise.all([
        obtenerResumenAlertas(token()),
        obtenerFacetas(token()),
        listarAlertas(token(), {
          tipo: filtroTipo || undefined,
          zona: filtroZona || undefined,
          caja: filtroCaja || undefined,
          resueltas: verResueltas,
          limit: 200,
        }),
      ]);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al cargar alertas';
    } finally {
      cargando = false;
    }
  }

  async function reevaluar() {
    evaluando = true;
    try { await evaluarAlertas(token()); await cargar(); }
    catch (e) { error = e instanceof Error ? e.message : 'Error al evaluar'; }
    finally { evaluando = false; }
  }

  function abrirModal(objetivo: Alerta[]) {
    modalObjetivo = objetivo;
    modalTexto = '';
    modalAbierto = true;
    // El foco al textarea para poder escribir sin tocar el mouse.
    setTimeout(() => inputModal?.focus(), 0);
  }

  async function confirmarRevision() {
    const obs = modalTexto.trim() || undefined;
    modalAbierto = false;
    try {
      for (const a of modalObjetivo) await revisarAlerta(token(), a.id_alerta, obs);
      await cargar();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al marcar revisada';
    }
  }

  function alTeclado(e: KeyboardEvent) {
    if (e.key === 'Escape' && modalAbierto) modalAbierto = false;
  }

  function alternar(id: number) {
    const s = new Set(seleccion);
    if (s.has(id)) s.delete(id); else s.add(id);
    seleccion = s;
  }

  function hace(iso: string): string {
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 60) return `hace ${min} min`;
    if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
    return `hace ${Math.floor(min / 1440)} d`;
  }

  const ordenadas = $derived(
    [...alertas].sort((a, b) => sev(a.severidad).orden - sev(b.severidad).orden)
  );
  const incidentes = $derived(ordenadas.filter((a) => TIPOS[a.tipo]?.agregada));
  const porCliente = $derived(ordenadas.filter((a) => !TIPOS[a.tipo]?.agregada));
  const clientesCubiertos = $derived(incidentes.reduce((s, a) => s + (a.afectados ?? 1), 0));
  const seleccionadas = $derived(porCliente.filter((a) => seleccion.has(a.id_alerta)));

  const porSeveridad = $derived(
    ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'].map((s) => ({
      sev: s,
      n: alertas.filter((a) => a.severidad === s).length,
    }))
  );

  onMount(cargar);
</script>

<svelte:window onkeydown={alTeclado} />

<div class="space-y-5">
  <!-- Cabecera -->
  <div class="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Alertas de red</h1>
      <p class="text-sm text-gray-500 mt-0.5">
        Detección automática sobre las lecturas de SmartOLT.
        {#if resumen}<span class="font-medium text-gray-700">{resumen.total_abiertas} abiertas.</span>{/if}
      </p>
    </div>
    <button
      onclick={reevaluar} disabled={evaluando}
      class="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm
             font-medium hover:bg-gray-700 disabled:opacity-50 cursor-pointer transition-colors duration-200
             focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900"
    >
      <svg class="h-4 w-4 {evaluando ? 'animate-spin' : ''}" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
      </svg>
      {evaluando ? 'Evaluando…' : 'Re-evaluar ahora'}
    </button>
  </div>

  <!-- Resumen por severidad: lo que importa es la urgencia, no el tipo -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
    {#each porSeveridad as s}
      <div class="bg-white rounded-xl border p-4">
        <div class="flex items-center gap-2">
          <span class="h-2.5 w-2.5 rounded-full {sev(s.sev).punto}"></span>
          <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">{s.sev}</p>
        </div>
        <p class="text-2xl font-bold text-gray-900 mt-1">{s.n}</p>
      </div>
    {/each}
  </div>

  <!-- Filtros -->
  <div class="bg-white rounded-xl border p-3 flex flex-wrap items-end gap-3">
    <div>
      <label for="f-tipo" class="block text-xs font-medium text-gray-500 mb-1">Tipo</label>
      <select id="f-tipo" bind:value={filtroTipo} onchange={cargar}
        class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-w-44 cursor-pointer
               focus:outline-none focus:ring-2 focus:ring-gray-900">
        <option value="">Todos</option>
        {#each Object.entries(TIPOS) as [valor, t]}
          <option value={valor}>{t.etiqueta}</option>
        {/each}
      </select>
    </div>
    <div>
      <label for="f-zona" class="block text-xs font-medium text-gray-500 mb-1">Zona</label>
      <select id="f-zona" bind:value={filtroZona} onchange={cargar}
        class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-w-44 cursor-pointer
               focus:outline-none focus:ring-2 focus:ring-gray-900">
        <option value="">Todas</option>
        {#each facetas?.zonas ?? [] as z}<option value={z.valor}>{z.valor} ({z.n})</option>{/each}
      </select>
    </div>
    <div>
      <label for="f-caja" class="block text-xs font-medium text-gray-500 mb-1">Caja NAP</label>
      <select id="f-caja" bind:value={filtroCaja} onchange={cargar}
        class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-w-44 cursor-pointer
               focus:outline-none focus:ring-2 focus:ring-gray-900">
        <option value="">Todas</option>
        {#each facetas?.cajas ?? [] as c}<option value={c.valor}>{c.valor} ({c.n})</option>{/each}
      </select>
    </div>
    <label class="inline-flex items-center gap-2 text-sm text-gray-600 pb-1.5 cursor-pointer">
      <input type="checkbox" bind:checked={verResueltas} onchange={cargar}
             class="rounded border-gray-300 cursor-pointer focus:ring-gray-900" />
      Ver resueltas
    </label>
    {#if filtroTipo || filtroZona || filtroCaja}
      <button onclick={() => { filtroTipo = ''; filtroZona = ''; filtroCaja = ''; cargar(); }}
        class="pb-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer
               transition-colors duration-200">Limpiar filtros</button>
    {/if}
  </div>

  {#if error}
    <div role="alert" class="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3">{error}</div>
  {/if}

  {#if cargando}
    <div class="space-y-2" aria-busy="true">
      {#each Array(3) as _}<div class="h-20 bg-gray-100 rounded-xl animate-pulse"></div>{/each}
    </div>
  {:else if ordenadas.length === 0}
    <div class="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl px-4 py-8 text-center">
      Sin alertas {verResueltas ? 'resueltas' : 'pendientes'} con estos filtros.
    </div>
  {:else}

    <!-- INCIDENTES: una causa, muchos clientes -->
    {#if incidentes.length > 0}
      <section>
        <h2 class="text-sm font-semibold text-gray-900 mb-2">
          Incidentes
          <span class="font-normal text-gray-500">
            — {incidentes.length} {incidentes.length === 1 ? 'causa' : 'causas'} que afectan a {clientesCubiertos} clientes
          </span>
        </h2>
        <div class="space-y-2">
          {#each incidentes as a (a.id_alerta)}
            <article class="bg-white rounded-xl border shadow-sm overflow-hidden">
              <div class="border-l-4 {sev(a.severidad).punto.replace('bg-', 'border-')} p-4">
                <div class="flex items-start justify-between gap-4 flex-wrap">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="px-2 py-0.5 rounded-md text-xs font-semibold border {sev(a.severidad).clase}">
                        {TIPOS[a.tipo]?.etiqueta ?? a.tipo}
                      </span>
                      <span class="px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700">
                        {a.afectados ?? 1} clientes
                      </span>
                      <span class="text-xs text-gray-400">{hace(a.creada_en)}</span>
                    </div>
                    <p class="mt-2 font-semibold text-gray-900">{a.mensaje}</p>

                    {#if a.caja?.latitud}
                      <a class="inline-flex items-center gap-1.5 mt-2 text-sm text-blue-600 hover:text-blue-800
                                hover:underline cursor-pointer transition-colors duration-200"
                         href={`https://www.google.com/maps?q=${a.caja.latitud},${a.caja.longitud}`}
                         target="_blank" rel="noopener">
                        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="2" aria-hidden="true">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                          <path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                        </svg>
                        Ver {a.caja.identificador_unico} en el mapa
                      </a>
                    {:else if a.tipo === 'FALLA_CAJA_NAP' || a.tipo === 'POTENCIA_DEGRADANDOSE'}
                      <p class="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
                        Sin ubicación: la caja no está ligada a la topología de Tomodat
                      </p>
                    {/if}
                  </div>
                  {#if !a.resuelta}
                    <button onclick={() => abrirModal([a])}
                      class="shrink-0 px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium
                             hover:bg-gray-50 cursor-pointer transition-colors duration-200
                             focus:outline-none focus:ring-2 focus:ring-gray-900">Revisar</button>
                  {/if}
                </div>
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/if}

    <!-- POR CLIENTE -->
    {#if porCliente.length > 0}
      <section>
        <div class="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <h2 class="text-sm font-semibold text-gray-900">
            Por cliente <span class="font-normal text-gray-500">— {porCliente.length}</span>
          </h2>
          {#if seleccionadas.length > 0}
            <button onclick={() => abrirModal(seleccionadas)}
              class="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700
                     cursor-pointer transition-colors duration-200 focus:outline-none focus:ring-2
                     focus:ring-offset-2 focus:ring-gray-900">
              Revisar {seleccionadas.length} seleccionadas
            </button>
          {/if}
        </div>

        <div class="bg-white rounded-xl border overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th scope="col" class="px-3 py-2.5 w-10">
                  <span class="sr-only">Seleccionar</span>
                </th>
                <th scope="col" class="px-3 py-2.5 text-left font-semibold">Alerta</th>
                <th scope="col" class="px-3 py-2.5 text-left font-semibold">Cliente y dirección</th>
                <th scope="col" class="px-3 py-2.5 text-left font-semibold">Ubicación de red</th>
                <th scope="col" class="px-3 py-2.5 text-left font-semibold">Detectada</th>
                <th scope="col" class="px-3 py-2.5"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {#each porCliente as a (a.id_alerta)}
                <tr class="hover:bg-gray-50 transition-colors duration-150 align-top">
                  <td class="px-3 py-3">
                    <input type="checkbox" checked={seleccion.has(a.id_alerta)}
                      onchange={() => alternar(a.id_alerta)}
                      aria-label={`Seleccionar alerta de ${a.registro?.numero_serie ?? a.id_alerta}`}
                      class="rounded border-gray-300 cursor-pointer focus:ring-gray-900" />
                  </td>
                  <td class="px-3 py-3 whitespace-nowrap">
                    <span class="inline-flex items-center gap-1.5">
                      <span class="h-2 w-2 rounded-full {sev(a.severidad).punto}" aria-hidden="true"></span>
                      <span class="font-medium text-gray-900">{TIPOS[a.tipo]?.etiqueta ?? a.tipo}</span>
                    </span>
                    <p class="text-xs text-gray-500 mt-0.5">{a.mensaje}</p>
                  </td>

                  <!-- El dato que más se usa: sin truncar, con expansión si es largo -->
                  <td class="px-3 py-3 max-w-md">
                    <p class="font-medium text-gray-900 {expandida === a.id_alerta ? '' : 'line-clamp-2'}">
                      {a.cliente?.nombre_completo ?? a.registro?.nombre_cliente_ext ?? 'Cliente sin identificar'}
                    </p>
                    {#if a.registro?.direccion_cliente_ext}
                      <p class="text-gray-600 {expandida === a.id_alerta ? '' : 'line-clamp-2'}">
                        {a.registro.direccion_cliente_ext}
                      </p>
                    {/if}
                    {#if (a.registro?.direccion_cliente_ext?.length ?? 0) > 60}
                      <button onclick={() => expandida = expandida === a.id_alerta ? null : a.id_alerta}
                        class="text-xs text-blue-600 hover:underline cursor-pointer mt-0.5">
                        {expandida === a.id_alerta ? 'Ver menos' : 'Ver todo'}
                      </button>
                    {/if}
                  </td>

                  <td class="px-3 py-3 whitespace-nowrap text-gray-600">
                    <p>{a.registro?.zona?.replace(/\s+/g, ' ') ?? '—'}</p>
                    <p class="text-xs text-gray-400 font-mono">{a.registro?.numero_serie ?? ''}</p>
                  </td>
                  <td class="px-3 py-3 whitespace-nowrap text-gray-500 text-xs">{hace(a.creada_en)}</td>
                  <td class="px-3 py-3 text-right whitespace-nowrap">
                    {#if !a.resuelta}
                      <button onclick={() => abrirModal([a])}
                        class="px-2.5 py-1 rounded-md border border-gray-300 text-xs font-medium
                               hover:bg-gray-100 cursor-pointer transition-colors duration-200
                               focus:outline-none focus:ring-2 focus:ring-gray-900">Revisar</button>
                    {:else}
                      <span class="text-xs text-gray-400">Resuelta</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  {/if}
</div>

<!-- Modal de revisión -->
{#if modalAbierto}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button class="absolute inset-0 bg-gray-900/50 cursor-default" aria-label="Cerrar"
            onclick={() => modalAbierto = false}></button>
    <div role="dialog" aria-modal="true" aria-labelledby="titulo-modal"
         class="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-5">
      <h3 id="titulo-modal" class="text-lg font-semibold text-gray-900">
        Marcar {modalObjetivo.length === 1 ? 'la alerta' : `${modalObjetivo.length} alertas`} como revisada{modalObjetivo.length === 1 ? '' : 's'}
      </h3>
      <p class="text-sm text-gray-500 mt-1">
        Queda registrado con tu usuario y la fecha. No vuelve a levantarse por 24 horas aunque el
        problema siga.
      </p>

      <label for="obs" class="block text-sm font-medium text-gray-700 mt-4 mb-1">
        ¿Qué se encontró? <span class="font-normal text-gray-400">(opcional)</span>
      </label>
      <textarea id="obs" bind:this={inputModal} bind:value={modalTexto} rows="3"
        placeholder="Ej: conector sucio, se limpió en terreno"
        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
               focus:outline-none focus:ring-2 focus:ring-gray-900"></textarea>

      <div class="flex justify-end gap-2 mt-4">
        <button onclick={() => modalAbierto = false}
          class="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50
                 cursor-pointer transition-colors duration-200">Cancelar</button>
        <button onclick={confirmarRevision}
          class="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700
                 cursor-pointer transition-colors duration-200">Confirmar</button>
      </div>
    </div>
  </div>
{/if}
