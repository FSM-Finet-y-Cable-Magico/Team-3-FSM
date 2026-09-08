<script lang="ts">
  // Notificaciones (RF-43 plantillas, RF-45 OT detenidas).
  //
  // RF-42 --avisar a los clientes de una falla-- no vive acá sino en el panel de
  // alertas, que es donde el jefe técnico está cuando decide avisar. Traerlo a
  // esta pantalla lo obligaría a salir de la alerta, buscar su número, y volver.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import * as api from '$lib/api/notificaciones.api';
  import type { OpcionesNotificacion, Plantilla, OtDetenida } from '$lib/api/notificaciones.api';

  let vista = $state<'plantillas' | 'detenidas'>('plantillas');
  let opciones = $state<OpcionesNotificacion | null>(null);
  let plantillas = $state<Plantilla[]>([]);
  let detenidas = $state<OtDetenida[]>([]);
  let cargando = $state(true);
  let error = $state('');
  let aviso = $state('');

  // Edición / alta.
  let editando = $state<number | null>(null);
  let creando = $state(false);
  let guardando = $state(false);
  let fTipo = $state('');
  let fCanal = $state('SMS');
  let fTexto = $state('');
  let fTiempo = $state('');

  const token = () => get(authStore).token ?? '';

  onMount(cargar);

  async function cargar() {
    cargando = true;
    error = '';
    try {
      const [o, p, d] = await Promise.all([
        api.obtenerOpciones(token()),
        api.listarPlantillas(token()),
        api.otDetenidas(token()),
      ]);
      opciones = o;
      plantillas = p;
      detenidas = d;
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudieron cargar las notificaciones';
    } finally {
      cargando = false;
    }
  }

  function empezarAlta() {
    creando = true;
    editando = null;
    fTipo = opciones?.tipos_evento[0] ?? '';
    fCanal = opciones?.canales.find((c) => c === 'SMS') ?? opciones?.canales[0] ?? 'SMS';
    fTexto = '';
    fTiempo = '';
  }

  function empezarEdicion(p: Plantilla) {
    creando = false;
    editando = p.id_plantilla;
    fTipo = p.tipo_evento ?? '';
    fCanal = p.canal;
    fTexto = p.contenido_texto ?? '';
    fTiempo = p.tiempo_estimado_reparacion ?? '';
  }

  /** Duplicar una base: es la forma de partir de una del sistema sin tocarla. */
  function duplicar(p: Plantilla) {
    creando = true;
    editando = null;
    fTipo = p.tipo_evento ?? '';
    fCanal = p.canal;
    fTexto = p.contenido_texto ?? '';
    fTiempo = p.tiempo_estimado_reparacion ?? '';
  }

  function cancelar() {
    creando = false;
    editando = null;
    fTexto = '';
    fTiempo = '';
  }

  async function guardar() {
    guardando = true;
    error = '';
    aviso = '';
    try {
      if (creando) {
        await api.crearPlantilla(token(), {
          tipo_evento: fTipo,
          canal: fCanal,
          contenido_texto: fTexto,
          tiempo_estimado_reparacion: fTiempo.trim() || undefined,
        });
        aviso = 'Plantilla creada.';
      } else if (editando != null) {
        await api.editarPlantilla(token(), editando, {
          tipo_evento: fTipo,
          canal: fCanal,
          contenido_texto: fTexto,
          tiempo_estimado_reparacion: fTiempo.trim() || undefined,
        });
        aviso = 'Plantilla actualizada.';
      }
      cancelar();
      plantillas = await api.listarPlantillas(token());
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo guardar';
    } finally {
      guardando = false;
    }
  }

  async function desactivar(p: Plantilla) {
    error = '';
    try {
      await api.desactivarPlantilla(token(), p.id_plantilla);
      plantillas = await api.listarPlantillas(token());
      // "Desactivada", no "eliminada": los envíos viejos siguen apuntando a
      // ella, y decir que se borró sería mentir sobre lo que pasó.
      aviso = 'Plantilla desactivada. Los envíos anteriores la conservan.';
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo desactivar';
    }
  }

  /** Las variables que el texto usa y no existen: el backend las rechaza. */
  const variablesEscritas = $derived(
    [...new Set([...fTexto.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))],
  );
  // Si no se pudieron leer las opciones no se marca NADA como invalido: sin la
  // lista no hay con que comparar, y dar por malas todas las variables dejaria
  // el formulario bloqueado sin poder guardar ni una plantilla. El backend
  // valida igual, asi que una variable mal escrita se rechaza al guardar.
  const variablesMalas = $derived(
    opciones ? variablesEscritas.filter((v) => !opciones!.variables.includes(v)) : [],
  );

  /** Vista previa con valores de ejemplo, para ver qué le llega al cliente. */
  const EJEMPLO: Record<string, string> = {
    cliente: 'Juan Pérez',
    zona: 'ZONA 3',
    caja: 'NAP 6',
    fecha: new Date().toLocaleDateString('es-CL'),
    hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
    empresa: 'FiNet',
  };

  const vistaPrevia = $derived(
    fTexto.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) =>
      // El tiempo sale del campo, no del ejemplo: es lo que de verdad se
      // enviaria con esta plantilla.
      k === 'tiempo_estimado' ? fTiempo || '(sin definir)' : (EJEMPLO[k] ?? ''),
    ),
  );

  const puedeGuardar = $derived(fTexto.trim().length > 0 && variablesMalas.length === 0 && !guardando);
  const etiqueta = (s: string | null) => (s ?? '').replaceAll('_', ' ').toLowerCase();
</script>

<svelte:head><title>Notificaciones</title></svelte:head>

<div class="space-y-5">

  <div>
    <h1 class="text-2xl font-bold text-slate-900">Notificaciones</h1>
    <p class="text-sm text-slate-600 mt-0.5">
      Plantillas de aviso a clientes y órdenes de trabajo detenidas.
    </p>
  </div>

  <!-- Que el envío no esté conectado tiene que decirse arriba y siempre: si no,
       el jefe técnico cree que al cliente le llegó el mensaje. -->
  {#if opciones && !opciones.envio_real_disponible}
    <div role="status" class="bg-amber-50 border border-amber-300 text-amber-900 text-sm rounded-lg px-4 py-3">
      <strong>El envío todavía no está conectado.</strong>
      No hay proveedor de SMS ni correo configurado, así que los avisos quedan
      <strong>registrados como simulados</strong> y no le llega nada al cliente.
      Las plantillas y los destinatarios sí quedan guardados.
    </div>
  {/if}

  {#if error}
    <div role="alert" class="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3">{error}</div>
  {/if}
  {#if aviso}
    <div role="status" class="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-4 py-3">{aviso}</div>
  {/if}

  <div class="bg-white rounded-xl border p-3 flex flex-wrap items-center gap-3">
    <div class="inline-flex rounded-lg border border-slate-300 overflow-hidden" role="tablist" aria-label="Vista">
      {#each [['plantillas', 'Plantillas'], ['detenidas', `OT detenidas (${detenidas.length})`]] as [v, t] (v)}
        <button
          type="button" role="tab" aria-selected={vista === v}
          onclick={() => (vista = v as typeof vista)}
          class="btn-pestana {vista === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}"
        >{t}</button>
      {/each}
    </div>

    {#if vista === 'plantillas' && !creando && editando == null}
      <button
        type="button"
        onclick={empezarAlta}
        class="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium cursor-pointer
               transition-colors duration-200 hover:bg-blue-700
               focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >Nueva plantilla</button>
    {/if}
  </div>

  {#if cargando}
    <div class="space-y-2">
      {#each Array(4) as _}<div class="h-20 bg-slate-100 rounded-xl motion-safe:animate-pulse"></div>{/each}
    </div>

  <!-- RF-43 -->
  {:else if vista === 'plantillas'}
    {#if creando || editando != null}
      <div class="bg-white rounded-xl border p-4 space-y-4">
        <h2 class="font-semibold text-slate-800">{creando ? 'Nueva plantilla' : 'Editar plantilla'}</h2>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="tipo" class="block text-sm font-medium text-slate-700 mb-1">Tipo de evento</label>
            <select id="tipo" bind:value={fTipo}
              class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm cursor-pointer
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              {#each opciones?.tipos_evento ?? [] as t}<option value={t}>{etiqueta(t)}</option>{/each}
            </select>
          </div>
          <div>
            <label for="canal" class="block text-sm font-medium text-slate-700 mb-1">Canal</label>
            <select id="canal" bind:value={fCanal}
              class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm cursor-pointer
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              {#each opciones?.canales ?? [] as c}<option value={c}>{etiqueta(c)}</option>{/each}
            </select>
          </div>
        </div>

        <div>
          <label for="tiempo" class="block text-sm font-medium text-slate-700 mb-1">
            Tiempo estimado de reparación
          </label>
          <input id="tiempo" type="text" bind:value={fTiempo} maxlength="60"
            placeholder="Ej: 4 a 6 horas"
            class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
          <p class="text-xs text-slate-600 mt-1">
            Es el valor por defecto. Al enviar un aviso concreto se puede reemplazar,
            porque dos cortes de la misma caja no duran lo mismo. Se escribe en el
            mensaje con <code class="px-1 py-0.5 rounded bg-slate-100">{'{{tiempo_estimado}}'}</code>.
          </p>
        </div>

        <div>
          <label for="texto" class="block text-sm font-medium text-slate-700 mb-1">Mensaje</label>
          <textarea id="texto" bind:value={fTexto} rows="3" maxlength="500"
            placeholder="Hola {'{{cliente}}'}: detectamos una falla en {'{{zona}}'}."
            class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"></textarea>

          <p class="text-xs text-slate-600 mt-1">
            Variables disponibles:
            {#each opciones?.variables ?? [] as v}
              <code class="mx-0.5 px-1 py-0.5 rounded bg-slate-100 text-slate-800">{`{{${v}}}`}</code>
            {/each}
          </p>
          <!-- El backend rechaza una variable inventada; avisarlo acá evita que
               el usuario escriba el mensaje entero para recibir un error. -->
          {#if variablesMalas.length}
            <p class="text-xs text-red-700 mt-1">
              No existe: {variablesMalas.map((v) => `{{${v}}}`).join(', ')}
            </p>
          {/if}
          <p class="text-xs text-slate-500 mt-1">
            {fTexto.length}/500 · un SMS se corta y se cobra cada 160 caracteres.
          </p>
        </div>

        {#if fTexto.trim()}
          <div>
            <p class="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Así lo recibe el cliente</p>
            <p class="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800">
              {vistaPrevia}
            </p>
          </div>
        {/if}

        <div class="flex gap-2">
          <button type="button" onclick={guardar} disabled={!puedeGuardar}
            class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium cursor-pointer
                   transition-colors duration-200 hover:bg-blue-700 disabled:opacity-50
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >{guardando ? 'Guardando…' : 'Guardar'}</button>
          <button type="button" onclick={cancelar}
            class="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700
                   cursor-pointer transition-colors duration-200 hover:bg-slate-50
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >Cancelar</button>
        </div>
      </div>
    {/if}

    <div class="grid gap-3 lg:grid-cols-2">
      {#each plantillas as p (p.id_plantilla)}
        <article class="bg-white rounded-xl border p-4 {p.activa ? '' : 'opacity-60'}">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="font-semibold text-slate-900">{etiqueta(p.tipo_evento) || 'Sin tipo'}</p>
              <p class="text-xs text-slate-600 mt-0.5">
                {etiqueta(p.canal)}
                {#if p.es_base}
                  · <span class="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-700">del sistema</span>
                {/if}
                {#if !p.activa} · <span class="text-red-700">desactivada</span>{/if}
              </p>
            </div>
            <div class="flex gap-2 shrink-0">
              {#if p.editable}
                <button type="button" onclick={() => empezarEdicion(p)}
                  class="btn-texto"
                >Editar</button>
                {#if p.activa}
                  <button type="button" onclick={() => desactivar(p)}
                    class="btn-texto-peligro"
                  >Desactivar</button>
                {/if}
              {:else}
                <!-- Las base son compartidas por las dos empresas: editarlas
                     cambiaría también las de la otra. Se duplican. -->
                <button type="button" onclick={() => duplicar(p)}
                  class="btn-texto"
                >Duplicar</button>
              {/if}
            </div>
          </div>
          <p class="text-sm text-slate-800 mt-2">{p.contenido_texto}</p>
          {#if p.tiempo_estimado_reparacion}
            <p class="text-xs text-slate-600 mt-1">
              Tiempo estimado: <strong class="text-slate-800">{p.tiempo_estimado_reparacion}</strong>
            </p>
          {/if}
        </article>
      {/each}
    </div>

  <!-- RF-45 -->
  {:else}
    {#if detenidas.length === 0}
      <div class="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl px-4 py-8 text-center">
        Ninguna OT lleva más de {opciones?.horas_ot_inactiva ?? 24} horas sin movimiento.
      </div>
    {:else}
      <p class="text-sm text-slate-700">
        <strong class="text-slate-900">{detenidas.length}</strong> OT sin movimiento hace más de
        {opciones?.horas_ot_inactiva ?? 24} horas, la más parada primero.
      </p>
      <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table class="w-full text-sm">
          <caption class="sr-only">Órdenes de trabajo detenidas</caption>
          <thead class="bg-slate-100 text-slate-600 uppercase tracking-wide text-xs">
            <tr>
              <th scope="col" class="px-3 py-2 text-left font-semibold">OT</th>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Estado</th>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Cliente</th>
              <th scope="col" class="px-3 py-2 text-left font-semibold">Técnico</th>
              <th scope="col" class="px-3 py-2 text-right font-semibold">Detenida</th>
              <th scope="col" class="px-3 py-2 text-right font-semibold">Ver</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each detenidas as o (o.id_ot)}
              <tr class="hover:bg-slate-50 transition-colors duration-200">
                <td class="px-3 py-2 font-medium text-slate-900">
                  #{o.id_ot}
                  <span class="text-xs text-slate-500">{etiqueta(o.tipo_ot)}</span>
                </td>
                <td class="px-3 py-2 text-slate-700">{etiqueta(o.estado)}</td>
                <td class="px-3 py-2 text-slate-700">{o.cliente ?? '--'}</td>
                <td class="px-3 py-2">
                  {#if o.sin_tecnico}
                    <!-- Una OT parada Y sin técnico es peor: nadie la va a mover sola. -->
                    <span class="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                      sin técnico
                    </span>
                  {:else}
                    <span class="text-slate-700">{o.tecnico}</span>
                  {/if}
                </td>
                <td class="px-3 py-2 text-right tabular-nums font-semibold
                           {o.horas_detenida >= 72 ? 'text-red-700' : 'text-amber-700'}">
                  {o.horas_detenida} h
                </td>
                <td class="px-3 py-2 text-right">
                  <a href="/admin/ot/{o.id_ot}"
                     class="btn-texto"
                  >Abrir</a>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>
