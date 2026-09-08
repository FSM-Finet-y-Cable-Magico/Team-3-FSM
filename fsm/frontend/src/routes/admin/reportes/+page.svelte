<script lang="ts">
  // Reportería (RF-38, RF-39, RF-40, RF-41).
  //
  // Una sola pantalla para los cinco tipos porque comparten la misma forma:
  // se elige un período, se mira, y se exporta. Tenerlas separadas obligaría al
  // jefe técnico a saber de antemano en cuál buscar lo que quiere.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as api from '$lib/api/reportes.api';
  import type { Reporte, ReporteComparativo, TipoReporte, Formato } from '$lib/api/reportes.api';

  let rol = $state('');
  let tipo = $state<TipoReporte>('diario');
  let fecha = $state('');
  let desde = $state('');
  let hasta = $state('');

  let reporte = $state<Reporte | null>(null);
  let comparativo = $state<ReporteComparativo | null>(null);
  let cargando = $state(false);
  let descargando = $state<Formato | null>(null);
  let error = $state('');

  const token = () => get(authStore).token ?? '';
  const esComparativo = $derived(tipo === 'comparativo');
  const usaRango = $derived(tipo === 'on-demand' || tipo === 'comparativo');
  // RF-41 es solo ADMIN, igual que el endpoint. Sin esto el JEFE_TECNICO vería
  // una pestaña que siempre le responde 403.
  const puedeComparar = $derived(rol === 'ADMIN');
  const hayAlgo = $derived(Boolean(reporte || comparativo));

  const TIPOS: { valor: TipoReporte; etiqueta: string }[] = [
    { valor: 'diario', etiqueta: 'Diario' },
    { valor: 'semanal', etiqueta: 'Semanal' },
    { valor: 'mensual', etiqueta: 'Mensual' },
    { valor: 'on-demand', etiqueta: 'Personalizado' },
    { valor: 'comparativo', etiqueta: 'Entre empresas' },
  ];

  onMount(() => {
    rol = get(authStore).usuario?.rol ?? '';
    // Rango por defecto: los últimos 30 días, que es lo que se mira más seguido.
    const hoy = new Date();
    const atras = new Date(hoy);
    atras.setDate(atras.getDate() - 30);
    hasta = iso(hoy);
    desde = iso(atras);
    generar();
  });

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const parametros = $derived({
    fecha: fecha || undefined,
    desde: desde || undefined,
    hasta: hasta || undefined,
  });

  async function generar() {
    cargando = true;
    error = '';
    try {
      if (esComparativo) {
        comparativo = await api.generarComparativo(token(), { desde, hasta });
        reporte = null;
      } else {
        reporte = await api.generar(token(), tipo, parametros);
        comparativo = null;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo generar el reporte';
      reporte = null;
      comparativo = null;
    } finally {
      cargando = false;
    }
  }

  async function exportar(formato: Formato) {
    descargando = formato;
    error = '';
    try {
      await api.descargar(token(), tipo, formato, parametros);
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo generar el archivo';
    } finally {
      descargando = null;
    }
  }

  function cambiarTipo(t: TipoReporte) {
    tipo = t;
    // Los resultados anteriores se limpian: dejar en pantalla el reporte de
    // otro tipo mientras carga el nuevo hace creer que ya está listo.
    reporte = null;
    comparativo = null;
    generar();
  }

  const fmtFecha = (s: string) => new Date(s).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  /** Sin dato no hay promedio: "No aplica", nunca 0. */
  const horas = (h: number | null) => (h == null ? 'No aplica' : `${h} h`);
</script>

<svelte:head><title>Reportes</title></svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">

  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">Reportes</h1>
      <p class="text-sm text-slate-600 mt-0.5">
        Trabajo completado, fallas, materiales y rendimiento por técnico.
      </p>
    </div>

    {#if hayAlgo}
      <div class="flex gap-2">
        {#each [['xlsx', 'Excel'], ['pdf', 'PDF']] as [f, etiqueta] (f)}
          <button
            type="button"
            onclick={() => exportar(f as Formato)}
            disabled={descargando !== null}
            class="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-800
                   cursor-pointer transition-colors duration-200 hover:bg-slate-50 disabled:opacity-50
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {descargando === f ? 'Generando…' : `Exportar ${etiqueta}`}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Selector de tipo y filtros -->
  <div class="bg-white rounded-xl border p-3 flex flex-wrap items-end gap-3">
    <div class="inline-flex rounded-lg border border-slate-300 overflow-hidden" role="tablist" aria-label="Tipo de reporte">
      {#each TIPOS as t (t.valor)}
        {#if t.valor !== 'comparativo' || puedeComparar}
          <button
            type="button"
            role="tab"
            aria-selected={tipo === t.valor}
            onclick={() => cambiarTipo(t.valor)}
            class="px-4 py-1.5 text-sm font-medium cursor-pointer transition-colors duration-200
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                   {tipo === t.valor ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}"
          >{t.etiqueta}</button>
        {/if}
      {/each}
    </div>

    {#if usaRango}
      <div class="flex flex-col">
        <label for="desde" class="text-xs font-semibold text-slate-600 mb-0.5">Desde</label>
        <input id="desde" type="date" bind:value={desde}
          class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm cursor-pointer
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
      </div>
      <div class="flex flex-col">
        <label for="hasta" class="text-xs font-semibold text-slate-600 mb-0.5">Hasta</label>
        <input id="hasta" type="date" bind:value={hasta}
          class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm cursor-pointer
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
      </div>
    {:else}
      <div class="flex flex-col">
        <label for="fecha" class="text-xs font-semibold text-slate-600 mb-0.5">
          {tipo === 'diario' ? 'Día' : 'Un día del período'}
        </label>
        <input id="fecha" type="date" bind:value={fecha}
          class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm cursor-pointer
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
        <span class="text-xs text-slate-500 mt-0.5">
          {tipo === 'diario' ? 'Vacío: ayer' : 'Vacío: el período cerrado anterior'}
        </span>
      </div>
    {/if}

    <button
      type="button"
      onclick={generar}
      disabled={cargando}
      class="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium cursor-pointer
             transition-colors duration-200 hover:bg-blue-700 disabled:opacity-50
             focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >{cargando ? 'Generando…' : 'Generar reporte'}</button>
  </div>

  {#if error}
    <div role="alert" class="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3">{error}</div>
  {/if}

  {#if cargando}
    <div class="space-y-3">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {#each Array(4) as _}<div class="h-24 bg-slate-100 rounded-xl motion-safe:animate-pulse"></div>{/each}
      </div>
      {#each Array(3) as _}<div class="h-28 bg-slate-100 rounded-xl motion-safe:animate-pulse"></div>{/each}
    </div>

  <!-- RF-41: comparativo entre empresas -->
  {:else if comparativo}
    <p class="text-sm text-slate-700">
      Período <strong class="text-slate-900">{comparativo.periodo.etiqueta}</strong>
      · generado el {fmtFecha(comparativo.generado_en)}
    </p>
    <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table class="w-full text-sm">
        <caption class="sr-only">Métricas comparadas entre empresas</caption>
        <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
          <tr>
            <th scope="col" class="px-3 py-2 text-left font-semibold">Métrica</th>
            {#each comparativo.comparacion[0]?.valores ?? [] as v (v.id_empresa)}
              <th scope="col" class="px-3 py-2 text-right font-semibold">{v.empresa ?? `Empresa ${v.id_empresa}`}</th>
            {/each}
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each comparativo.comparacion as m (m.metrica)}
            <tr class="hover:bg-slate-50 transition-colors duration-200">
              <td class="px-3 py-2 font-medium text-slate-900">
                {m.metrica}{m.unidad ? ` (${m.unidad})` : ''}
              </td>
              {#each m.valores as v (v.id_empresa)}
                <td class="px-3 py-2 text-right tabular-nums text-slate-800">
                  {v.valor == null ? 'No aplica' : v.valor}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

  <!-- RF-38 / RF-39 -->
  {:else if reporte}
    <p class="text-sm text-slate-700">
      <strong class="text-slate-900">{reporte.empresa.nombre}</strong>
      · período <strong class="text-slate-900">{reporte.periodo.etiqueta}</strong>
      · generado el {fmtFecha(reporte.generado_en)}
    </p>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {#each [
        ['OT completadas', reporte.totales.ot_completadas, 'text-slate-900'],
        ['Instalaciones', reporte.totales.instalaciones, 'text-blue-700'],
        ['Reparaciones', reporte.totales.reparaciones, 'text-amber-700'],
        ['Canceladas', reporte.totales.canceladas, 'text-red-700'],
      ] as [etiqueta, valor, color] (etiqueta)}
        <div class="bg-white rounded-xl border p-4">
          <p class="text-xs uppercase tracking-wide text-slate-600 font-semibold">{etiqueta}</p>
          <p class="text-3xl font-bold mt-1 tabular-nums {color}">{valor}</p>
        </div>
      {/each}
    </div>

    {#if reporte.totales.ot_completadas === 0}
      <!-- CU-60, Excepción 1: la ausencia de actividad también es información.
           Se dice explícitamente para que no se confunda con un reporte roto. -->
      <div class="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-xl px-4 py-6 text-center">
        Sin actividad registrada en el período.
      </div>
    {/if}

    <div class="grid gap-4 lg:grid-cols-2">
      <!-- Fallas -->
      <section class="bg-white rounded-xl border overflow-hidden">
        <h2 class="px-4 py-3 font-semibold text-slate-800 border-b">Fallas por categoría</h2>
        {#if reporte.fallas_por_categoria.length === 0}
          <p class="px-4 py-6 text-sm text-slate-600 text-center">Sin reparaciones en el período.</p>
        {:else}
          <table class="w-full text-sm">
            <tbody class="divide-y divide-slate-100">
              {#each reporte.fallas_por_categoria as f (f.etiqueta)}
                <tr>
                  <td class="px-4 py-2 text-slate-900">{f.etiqueta}</td>
                  <td class="px-4 py-2 w-40">
                    <div class="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div class="h-full bg-amber-500" style="width: {f.pct ?? 0}%"></div>
                    </div>
                  </td>
                  <td class="px-4 py-2 text-right tabular-nums text-slate-700 w-24">
                    {f.cantidad} ({f.pct ?? 0}%)
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>

      <!-- Técnicos -->
      <section class="bg-white rounded-xl border overflow-hidden">
        <h2 class="px-4 py-3 font-semibold text-slate-800 border-b">Rendimiento por técnico</h2>
        {#if reporte.por_tecnico.length === 0}
          <p class="px-4 py-6 text-sm text-slate-600 text-center">Sin actividad registrada en el período.</p>
        {:else}
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-600 uppercase tracking-wide text-xs">
              <tr>
                <th scope="col" class="px-4 py-2 text-left font-semibold">Técnico</th>
                <th scope="col" class="px-4 py-2 text-right font-semibold">Completadas</th>
                <th scope="col" class="px-4 py-2 text-right font-semibold">Promedio</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              {#each reporte.por_tecnico as t (t.id_tecnico ?? 'sin')}
                <tr>
                  <td class="px-4 py-2 text-slate-900">{t.tecnico}</td>
                  <td class="px-4 py-2 text-right tabular-nums text-slate-800">{t.completadas}</td>
                  <td class="px-4 py-2 text-right tabular-nums {t.tiempo_promedio_horas == null ? 'text-slate-500' : 'text-slate-800'}">
                    {horas(t.tiempo_promedio_horas)}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>

      <!-- Materiales -->
      <section class="bg-white rounded-xl border overflow-hidden">
        <h2 class="px-4 py-3 font-semibold text-slate-800 border-b">Consumo de materiales</h2>
        {#if reporte.materiales.length === 0}
          <p class="px-4 py-6 text-sm text-slate-600 text-center">Sin materiales registrados en el período.</p>
        {:else}
          <table class="w-full text-sm">
            <tbody class="divide-y divide-slate-100">
              {#each reporte.materiales as m (m.material)}
                <tr>
                  <td class="px-4 py-2 align-top">
                    <p class="text-slate-900">{m.material}</p>
                    <p class="text-xs text-slate-500 mt-0.5">
                      {m.por_tecnico.map((t) => `${t.tecnico}: ${t.cantidad}`).join(' · ')}
                    </p>
                  </td>
                  <td class="px-4 py-2 text-right tabular-nums text-slate-800 align-top w-20">{m.cantidad}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>

      <!-- RF-39: solo en los periódicos -->
      {#if reporte.instalaciones_por_plan}
        <section class="bg-white rounded-xl border overflow-hidden">
          <h2 class="px-4 py-3 font-semibold text-slate-800 border-b">Instalaciones por plan</h2>
          {#if reporte.instalaciones_por_plan.length === 0}
            <p class="px-4 py-6 text-sm text-slate-600 text-center">Sin instalaciones en el período.</p>
          {:else}
            <table class="w-full text-sm">
              <tbody class="divide-y divide-slate-100">
                {#each reporte.instalaciones_por_plan as p (p.etiqueta)}
                  <tr>
                    <td class="px-4 py-2 text-slate-900">{p.etiqueta}</td>
                    <td class="px-4 py-2 text-right tabular-nums text-slate-800">{p.cantidad} ({p.pct ?? 0}%)</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </section>
      {/if}

      {#if reporte.clientes_recurrentes}
        <section class="bg-white rounded-xl border overflow-hidden">
          <h2 class="px-4 py-3 font-semibold text-slate-800 border-b">Clientes con fallas recurrentes</h2>
          {#if reporte.clientes_recurrentes.length === 0}
            <p class="px-4 py-6 text-sm text-slate-600 text-center">Ninguno alcanzó el umbral en el período.</p>
          {:else}
            <table class="w-full text-sm">
              <tbody class="divide-y divide-slate-100">
                {#each reporte.clientes_recurrentes as c (c.id_cliente)}
                  <tr>
                    <td class="px-4 py-2">
                      <p class="text-slate-900">{c.cliente}</p>
                      <p class="text-xs text-slate-500 mt-0.5">
                        {#each c.ots as id, i (id)}
                          <a href="/admin/ot/{id}"
                             class="underline cursor-pointer hover:text-slate-800 rounded
                                    focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          >OT #{id}</a>{i < c.ots.length - 1 ? ' · ' : ''}
                        {/each}
                      </p>
                    </td>
                    <td class="px-4 py-2 text-right tabular-nums text-amber-700 font-semibold w-24 align-top">
                      {c.reparaciones}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </section>
      {/if}
    </div>
  {/if}
</div>
