<script lang="ts">
  // CU-14 / RF-12: historial de conexiones y desconexiones de una ONT, con las
  // interrupciones armadas y los indicadores de patron del CU. El calculo lo
  // hace el Controlador; aca solo se elige el periodo y se muestra.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.store';
  import Alert from '$lib/components/Alert.svelte';
  import * as api from '$lib/api/monitoreo.api';

  type Periodo = 'dia' | 'semana' | 'mes' | 'personalizado';

  const sn = $derived($page.params.sn ?? '');
  let token = '';
  let periodo = $state<Periodo>('mes');
  let desdePersonalizado = $state('');
  let hastaPersonalizado = $state('');
  let datos = $state<api.HistorialInterrupciones | null>(null);
  let cargando = $state(true);
  let error = $state('');

  const PERIODOS: { valor: Periodo; etiqueta: string }[] = [
    { valor: 'dia', etiqueta: 'Último día' },
    { valor: 'semana', etiqueta: 'Última semana' },
    { valor: 'mes', etiqueta: 'Últimos 30 días' },
    { valor: 'personalizado', etiqueta: 'Personalizado' },
  ];

  /** Dia de operacion (Chile), no el del navegador: es el mismo que usa el Controlador. */
  function diaChile(instante: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(instante);
  }

  function rango(): { desde: string; hasta: string } | undefined {
    const hoy = new Date();
    if (periodo === 'dia') return { desde: diaChile(hoy), hasta: diaChile(hoy) };
    if (periodo === 'semana') return { desde: diaChile(new Date(hoy.getTime() - 6 * 86_400_000)), hasta: diaChile(hoy) };
    if (periodo === 'personalizado') return { desde: desdePersonalizado, hasta: hastaPersonalizado };
    return undefined; // 30 dias: el valor por defecto del Controlador.
  }

  async function cargar() {
    const r = rango();
    if (periodo === 'personalizado' && (!r?.desde || !r?.hasta)) {
      error = 'Elige el día de inicio y el de término';
      return;
    }
    cargando = true;
    error = '';
    try {
      datos = await api.historialInterrupciones(token, sn, r);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al cargar el historial';
      datos = null;
    } finally {
      cargando = false;
    }
  }

  function elegir(p: Periodo) {
    periodo = p;
    if (p !== 'personalizado') cargar();
  }

  onMount(() => {
    authStore.checkAuth();
    const estado = get(authStore);
    if (!estado.isAuthenticated) {
      goto('/login');
      return;
    }
    token = estado.token ?? '';
    cargar();
  });

  const fechaHora = (iso: string) =>
    new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' });

  function duracion(minutos: number): string {
    if (minutos < 60) return `${minutos} min`;
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  const hora = (h: number) => `${String(h).padStart(2, '0')}:00`;
</script>

<div class="space-y-6">
  <div>
    <a href="/admin/monitoreo" class="btn-texto text-sm">← Volver al monitoreo</a>
    <h1 class="text-2xl font-bold text-slate-800 mt-2">
      Historial de interrupciones · <span class="font-mono">{sn}</span>
    </h1>
    {#if datos?.nombre_cliente_ext}
      <p class="text-sm text-slate-600">{datos.nombre_cliente_ext}</p>
    {/if}
  </div>

  <div class="flex flex-wrap items-end gap-2">
    {#each PERIODOS as p (p.valor)}
      <button
        onclick={() => elegir(p.valor)}
        aria-pressed={periodo === p.valor}
        class="btn-pestana rounded-lg border {periodo === p.valor ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300'}"
      >
        {p.etiqueta}
      </button>
    {/each}
    {#if periodo === 'personalizado'}
      <label class="text-xs text-slate-600">Desde
        <input type="date" bind:value={desdePersonalizado} class="block border rounded-lg px-2 py-1.5 text-sm" />
      </label>
      <label class="text-xs text-slate-600">Hasta
        <input type="date" bind:value={hastaPersonalizado} class="block border rounded-lg px-2 py-1.5 text-sm" />
      </label>
      <button onclick={cargar} class="btn btn-primario btn-chico">Aplicar</button>
    {/if}
  </div>

  {#if error}
    <Alert>{error}</Alert>
  {/if}

  {#if cargando}
    <p role="status" class="text-slate-500">Cargando historial...</p>
  {:else if datos}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-white rounded-xl border p-4">
        <p class="text-xs text-slate-500">Interrupciones</p>
        <p class="text-2xl font-bold text-slate-800">{datos.indicadores.total}</p>
      </div>
      <div class="bg-white rounded-xl border p-4">
        <p class="text-xs text-slate-500">Cortas (30 min o menos)</p>
        <p class="text-2xl font-bold text-slate-800">{datos.indicadores.cortas}</p>
      </div>
      <div class="bg-white rounded-xl border p-4">
        <p class="text-xs text-slate-500">De más de 4 horas</p>
        <p class="text-2xl font-bold {datos.indicadores.largas ? 'text-red-600' : 'text-slate-800'}">{datos.indicadores.largas}</p>
      </div>
      <div class="bg-white rounded-xl border p-4">
        <p class="text-xs text-slate-500">Tiempo sin servicio</p>
        <p class="text-2xl font-bold text-slate-800">{duracion(datos.indicadores.minutos_totales)}</p>
      </div>
    </div>

    {#if datos.indicadores.horario_recurrente.length || datos.indicadores.dias_con_varias_cortas.length}
      <div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1">
        <p class="font-semibold">Patrones que conviene revisar</p>
        {#each datos.indicadores.horario_recurrente as r (r.hora)}
          <p>Cortes diarios cerca de las {hora(r.hora)} ({r.dias} días)</p>
        {/each}
        {#each datos.indicadores.dias_con_varias_cortas as d (d.dia)}
          <p>{d.cortas} cortes cortos el {d.dia}</p>
        {/each}
        <p class="text-xs text-amber-800">Los umbrales son provisionales hasta que FiNet los confirme.</p>
      </div>
    {/if}

    {#if datos.interrupciones.length === 0}
      <p class="rounded-xl border bg-white p-6 text-center text-slate-600">Sin interrupciones registradas en este período.</p>
    {:else}
      <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table class="w-full text-sm">
          <caption class="sr-only">Interrupciones de la ONT {sn}</caption>
          <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
            <tr>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Inicio</th>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Fin</th>
              <th scope="col" class="px-3 py-2 text-right font-semibold">Duración</th>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Estado</th>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Posible causa (indicio)</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each [...datos.interrupciones].reverse() as i (i.desde)}
              <tr>
                <td class="px-3 py-2 tabular-nums">
                  {fechaHora(i.desde)}{#if i.empezo_antes}<span class="text-xs text-slate-500"> (venía de antes)</span>{/if}
                </td>
                <td class="px-3 py-2 tabular-nums">
                  {#if i.hasta}{fechaHora(i.hasta)}{:else}<span class="font-semibold text-red-600">Sigue caída</span>{/if}
                </td>
                <td class="px-3 py-2 text-right tabular-nums">{duracion(i.minutos)}</td>
                <td class="px-3 py-2 font-mono text-xs">{i.estado}</td>
                <td class="px-3 py-2 text-slate-700">{i.indicio}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>
