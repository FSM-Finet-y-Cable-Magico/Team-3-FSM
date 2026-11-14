<script lang="ts">
  import Alert from '$lib/components/Alert.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { authStore } from '$lib/stores/auth.store';
  import * as ordenesApi from '$lib/api/ordenes.api';
  import * as terrenoApi from '$lib/api/terreno.api';

  let destruido = false;
  const subidas = new Map<string, AbortController>();

  let token = '';
  let userId = $state(0);

  const idOT = $derived(Number($page.params.id ?? 0));

  let paso = $state(1);
  let ot = $state<ordenesApi.OT | null>(null);
  let materiales = $state<terrenoApi.MaterialDisponible[]>([]);
  let categoriasFalla = $state<ordenesApi.CategoriaFalla[]>([]);
  let loadingInit = $state(true);
  let errorInit = $state('');

  // Paso 1 - Fotos
  interface FotoLocal {
    url: string;
    formato: string;
    tamano_kb: number;
    /**
     * Object URL del archivo local (M12 / RNF-09). La miniatura se pinta desde
     * el archivo que el tecnico acaba de elegir, sin volver a descargar la foto
     * de Cloudinary: ahorra un round trip de 2-4 MB sobre red celular y la
     * vista previa aparece de inmediato, sin esperar a que termine la subida.
     */
    preview: string;
    cargando?: boolean;
  }

  function liberarPreview(foto: FotoLocal) {
    if (foto.preview.startsWith('blob:')) URL.revokeObjectURL(foto.preview);
  }
  let fotos = $state<FotoLocal[]>([]);
  const subiendoFoto = $derived(fotos.some(f => f.cargando));
  const fotosListas = $derived(fotos.filter(f => !f.cargando));

  // Paso 2 - Materiales
  let cantidades = $state<Record<number, number>>({});

  // Paso 3 - Equipos individualizables (acuerdo con G1)
  let opcionesEquipo = $state<terrenoApi.OpcionesEquipo | null>(null);
  // Lo que el tecnico lleva encima, para sugerirlo al escribir la serie. Solo
  // sugiere: un equipo que se retira de la casa del cliente no esta aca.
  let misEquipos = $state<terrenoApi.EquipoAsignado[]>([]);
  let equipos = $state<terrenoApi.EquipoOt[]>([]);

  // Paso 3 - Cierre
  let potencia = $state<string>('');
  // CU-31: la llamada de cortesia NO se registra aca. La hace siempre el jefe
  // tecnico, con la OT completada, desde su panel de llamadas.
  // CU-56: modalidad de resolucion. PRESENCIAL exige fotos; REMOTA no, pero
  // si hay fotos pide confirmar que no hubo visita (excepcion 1 del CU).
  let resueltoRemotamente = $state(false);
  let confirmaRemota = $state(false);
  const pasoFotosListo = $derived(
    resueltoRemotamente ? fotosListas.length === 0 || confirmaRemota : fotosListas.length > 0,
  );
  let idCategoriaFalla = $state('');
  let categoriaFallaOtro = $state('');

  // Los tres datos que G1 exige para registrar el cierre de una REPARACION.
  // Debe coincidir con LARGO_MIN_TEXTO_REPARACION del backend: si no, el
  // boton deja cerrar y el servidor responde un 400 que el tecnico no espera.
  const LARGO_MIN_REPARACION = 5;
  const LARGO_MAX_REPARACION = 300;
  let fallaReportada = $state('');
  let solucionAplicada = $state('');
  let resultadoReparacion = $state<terrenoApi.ResultadoReparacion | ''>('');

  /** La etiqueta es nuestra; el valor lo compara G1 y va exacto. */
  const RESULTADOS_REPARACION: { valor: terrenoApi.ResultadoReparacion; etiqueta: string }[] = [
    { valor: 'RESUELTO', etiqueta: 'Resuelto — el problema quedó corregido' },
    { valor: 'PARCIAL', etiqueta: 'Parcial — hay servicio, con una limitación' },
    { valor: 'SIN_SOLUCION', etiqueta: 'Sin solución — no se pudo arreglar en esta visita' },
  ];
  // Comentario libre para el jefe que aprueba. Mismo maximo que el backend
  // (LARGO_MAX_COMENTARIO_CIERRE).
  const LARGO_MAX_COMENTARIO = 500;
  let comentario = $state('');

  let alertaReparaciones = $state<{
    activa: boolean;
    total_reparaciones_30_dias: number;
  } | null>(null);

  let cerrando = $state(false);
  let errorCierre = $state('');
  let mostrarModalPotencia = $state(false);

  const potenciaNum = $derived(potencia !== '' ? parseFloat(potencia) : null);
  const advertenciaPotencia = $derived(
    potenciaNum !== null && !isNaN(potenciaNum) && (potenciaNum < -24 || potenciaNum > -19),
  );

  const materialesSeleccionados = $derived(
    materiales.filter((m) => (cantidades[m.id_tipo_equipo] ?? 0) > 0),
  );
  const categoriaSeleccionada = $derived(
    categoriasFalla.find((c) => c.id_categoria === Number(idCategoriaFalla)),
  );
  // La categoria de falla y los tres datos de reparacion aplican al mismo
  // caso, asi que salen de la misma condicion y no de dos copias.
  const esReparacion = $derived(ot?.tipo_ot === 'REPARACION');
  const requiereCategoriaFalla = $derived(esReparacion);

  const esRetiro = (accion: string) =>
    opcionesEquipo?.acciones.find((a) => a.accion === accion)?.es_retiro ?? false;

  const etiquetaAccion = (accion: string) =>
    accion.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

  function agregarEquipo() {
    equipos.push({ numero_serie: '', accion: 'RETIRADO_PARA_DIAGNOSTICO' });
  }

  function quitarEquipo(i: number) {
    equipos.splice(i, 1);
  }

  // El backend acepta A-Z, 0-9 y guion. Se normaliza al tipear en vez de
  // rechazar despues: el tecnico esta en la calle y no va a adivinar el formato
  // a partir de un 400.
  function normalizarSerie(i: number, valor: string) {
    equipos[i].numero_serie = valor.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 30);
  }

  /**
   * Que le falta al formulario para poder cerrar.
   *
   * Antes el boton simplemente quedaba gris y no decia nada: el tecnico veia un
   * boton que no responde sin ninguna pista. Ademas la validacion de categoria
   * dentro de `cerrarOT` era inalcanzable, porque el boton ya estaba bloqueado
   * justo en ese caso.
   */
  const faltante = $derived.by(() => {
    const falta: string[] = [];
    // CU-56: sin visita no hay que fotografiar.
    if (!resueltoRemotamente && fotosListas.length === 0) falta.push('al menos una foto');
    if (potencia === '' || isNaN(parseFloat(potencia))) falta.push('la potencia optica');
    if (requiereCategoriaFalla && !idCategoriaFalla) falta.push('la categoría de falla');
    if (
      categoriaSeleccionada?.nombre.toLowerCase() === 'otro' &&
      !categoriaFallaOtro.trim()
    ) {
      falta.push('la descripción de la falla');
    }
    // Los tres de G1. Se distingue "no lo escribió" de "lo escribió corto":
    // con un solo mensaje el tecnico no sabe si le falta el campo o le falta
    // texto, y lo reintenta a ciegas.
    if (esReparacion) {
      const falla = fallaReportada.trim();
      const solucion = solucionAplicada.trim();
      if (!falla) falta.push('qué falla encontró');
      else if (falla.length < LARGO_MIN_REPARACION) falta.push(`describir la falla con al menos ${LARGO_MIN_REPARACION} caracteres`);
      if (!solucion) falta.push('qué hizo para resolverla');
      else if (solucion.length < LARGO_MIN_REPARACION) falta.push(`describir la solución con al menos ${LARGO_MIN_REPARACION} caracteres`);
      if (!resultadoReparacion) falta.push('cómo quedó la reparación');
    }
    equipos.forEach((e, i) => {
      const n = i + 1;
      if (!e.numero_serie.trim()) falta.push(`el numero de serie del equipo ${n}`);
      // El diagnostico es opcional en el contrato --G1 asume "Causa
      // desconocida" si no viene-- pero obligatorio aca: es el unico momento en
      // que alguien tiene el equipo en la mano y puede decir que le pasa.
      if (esRetiro(e.accion) && !e.diagnostico) falta.push(`el diagnostico del equipo ${n}`);
    });
    return falta;
  });

  onMount(async () => {
    authStore.checkAuth();
    const state = get(authStore);

    if (!state.isAuthenticated || state.usuario?.rol !== 'TECNICO') {
      goto('/login');
      return;
    }

    token = state.token ?? '';
    userId = state.usuario?.userId ?? 0;

    try {
      const [otData, matsData, catsData, opcEquipo, asignados] = await Promise.all([
        ordenesApi.obtenerOT(token, idOT),
        terrenoApi.obtenerMateriales(token),
        ordenesApi.listarCategoriasFalla(token),
        // Este NO tumba la pantalla si falla. Declarar equipos es secundario
        // frente a cerrar la OT: dejar al tecnico sin poder cerrar --parado en
        // el domicilio, con el cliente esperando-- porque no se pudo leer una
        // lista de opciones es peor que cerrar sin esa seccion. Es el mismo
        // criterio con el que el contrato con G1 no exige el diagnostico.
        terrenoApi.obtenerOpcionesEquipo(token).catch(() => null),
        // Tampoco este: sin sugerencias se escribe la serie a mano, como antes.
        terrenoApi.obtenerMisEquipos(token).catch(() => [] as terrenoApi.EquipoAsignado[]),
      ]);
      if (destruido) return;
      if (otData.id_tecnico !== userId) {
        errorInit = 'Esta OT está asignada a otro técnico.';
        return;
      }
      if (otData.estado !== 'EN_CURSO') {
        errorInit = 'Esta OT no está en estado EN_CURSO.';
        return;
      }
      ot = otData;
      materiales = matsData;
      categoriasFalla = catsData;
      opcionesEquipo = opcEquipo;
      misEquipos = asignados;
    } catch (err) {
      errorInit = err instanceof Error ? err.message : 'Error al cargar datos';
    } finally {
      loadingInit = false;
    }
  });

  async function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    const archivos = Array.from(input.files);
    input.value = '';
    errorCierre = '';

    const idSubida = idOT;
    for (const file of archivos) {
      if (destruido) return;
      const preview = URL.createObjectURL(file);
      const controller = new AbortController();
      subidas.set(preview, controller);
      fotos = [...fotos, { url: '', formato: '', tamano_kb: 0, preview, cargando: true }];
      try {
        const result = await terrenoApi.subirFoto(token, idSubida, file, controller.signal);
        if (destruido) return;
        if (controller.signal.aborted) {
          URL.revokeObjectURL(preview);
          fotos = fotos.filter(f => f.preview !== preview);
          continue;
        }
        fotos = fotos.map(f => f.preview === preview
          ? { ...f, url: result.url_cloudinary, formato: result.formato, tamano_kb: result.tamano_kb, cargando: false }
          : f);
      } catch (err) {
        URL.revokeObjectURL(preview);
        if (destruido) return;
        fotos = fotos.filter(f => f.preview !== preview);
        if (!controller.signal.aborted) errorCierre = err instanceof Error ? err.message : 'Error al subir foto';
      } finally {
        subidas.delete(preview);
      }
    }
  }

  function eliminarFoto(i: number) {
    const foto = fotos[i];
    if (!foto) return;
    subidas.get(foto.preview)?.abort();
    subidas.delete(foto.preview);
    liberarPreview(foto);
    fotos = fotos.filter(f => f.preview !== foto.preview);
  }

  onDestroy(() => {
    destruido = true;
    subidas.forEach(controller => controller.abort());
    subidas.clear();
    fotos.forEach(liberarPreview);
  });

  function buildDto(): terrenoApi.CerrarOTDto {
    return {
      fotos: fotosListas.map((f) => ({ url_cloudinary: f.url, formato: f.formato, tamano_kb: f.tamano_kb })),
      materiales: materialesSeleccionados.map((m) => ({
        id_tipo_equipo: m.id_tipo_equipo,
        cantidad: cantidades[m.id_tipo_equipo],
      })),
      potencia_optica_dbm: parseFloat(potencia),
      resuelto_remotamente: resueltoRemotamente,
      id_categoria_falla: idCategoriaFalla ? Number(idCategoriaFalla) : undefined,
      categoria_falla_otro: categoriaFallaOtro.trim() || undefined,
      // Solo en reparaciones: en los demas tipos viajan ausentes y G1 los
      // recibe en null, que es lo que dice el contrato.
      ...(esReparacion && {
        falla_reportada: fallaReportada.trim(),
        solucion_aplicada: solucionAplicada.trim(),
        resultado_reparacion: resultadoReparacion || undefined,
      }),
      // Se separan por accion porque G1 las procesa distinto: las instaladas
      // van al cliente, las retiradas siguen la transicion de su accion.
      equipos_instalados: limpiarEquipos(equipos.filter((e) => !esRetiro(e.accion))),
      equipos_retirados: limpiarEquipos(equipos.filter((e) => esRetiro(e.accion))),
      comentario_tecnico: comentario.trim() || undefined,
    };
  }

  /** Deja las listas en `undefined` si van vacias, para no mandar arrays sueltos. */
  function limpiarEquipos(lista: terrenoApi.EquipoOt[]) {
    const utiles = lista
      .filter((e) => e.numero_serie.trim())
      .map((e) => ({
        numero_serie: e.numero_serie.trim(),
        accion: e.accion,
        diagnostico: esRetiro(e.accion) ? e.diagnostico || undefined : undefined,
        observacion_estado_fisico: e.observacion_estado_fisico?.trim() || undefined,
      }));
    return utiles.length ? utiles : undefined;
  }

  async function cerrarOT(dto?: terrenoApi.CerrarOTDto) {
    // Las fotos que faltan las reporta `faltante`, que sabe de la modalidad (CU-56).
    if (subiendoFoto) return;
    const payload = dto ?? buildDto();
    if (faltante.length > 0) {
      errorCierre = `Falta ${faltante.join(', ')}.`;
      return;
    }

    cerrando = true;
    errorCierre = '';
    try {
      const resp = await terrenoApi.cerrarOT(token, idOT, payload);
      alertaReparaciones = (resp.alerta_reparaciones_30_dias as typeof alertaReparaciones) ?? null;
      if (resp.advertencia_potencia) {
        mostrarModalPotencia = true;
        cerrando = false;
        return;
      }
      goto('/terreno');
    } catch (err) {
      errorCierre = err instanceof Error ? err.message : 'Error al cerrar OT';
    } finally {
      cerrando = false;
    }
  }

  async function confirmarCierrePotencia() {
    mostrarModalPotencia = false;
    goto('/terreno');
  }
</script>

{#if loadingInit}
  <div class="min-h-screen bg-gray-50 flex items-center justify-center">
    <Spinner class="h-8 w-8 text-blue-500" />
  </div>
{:else if errorInit}
  <div class="min-h-screen bg-gray-50 p-4">
    <Alert class="rounded-xl text-sm">{errorInit}</Alert>
    <button onclick={() => goto('/terreno')} class="btn-texto mt-4">Volver</button>
  </div>
{:else}
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <!-- Header -->
    <header class="bg-slate-900 text-white px-4 py-3 sticky top-0 z-10 shadow-lg">
      <div class="flex items-center gap-3">
        <button aria-label="Volver a terreno" onclick={() => goto('/terreno')} class="btn-texto justify-center min-h-11 min-w-11 text-slate-300 hover:text-white focus-visible:ring-slate-400">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <p class="font-semibold text-sm">Cerrar OT #{idOT}</p>
          <p class="text-xs text-slate-400">{ot?.cliente?.nombre_completo ?? ''}</p>
        </div>
      </div>
    </header>

    <!-- Stepper -->
    <div class="bg-white border-b border-slate-100 px-4 py-3">
      <div class="flex items-center gap-2">
        {#each [1, 2, 3] as p}
          <div
            class="flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold transition-colors
              {paso >= p ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}"
          >{p}</div>
          {#if p < 3}
            <div class="flex-1 h-px {paso > p ? 'bg-blue-600' : 'bg-slate-200'}"></div>
          {/if}
        {/each}
      </div>
      <div class="flex justify-between mt-1">
        <span class="text-xs {paso === 1 ? 'text-blue-600 font-medium' : 'text-slate-400'}">Fotos</span>
        <span class="text-xs {paso === 2 ? 'text-blue-600 font-medium' : 'text-slate-400'}">Materiales</span>
        <span class="text-xs {paso === 3 ? 'text-blue-600 font-medium' : 'text-slate-400'}">Cierre</span>
      </div>
    </div>

    <main class="flex-1 px-4 py-5 space-y-4">

      <!-- PASO 1: Fotografias -->
      {#if paso === 1}
        <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <h2 class="font-semibold text-slate-800 mb-2">¿Cómo se resolvió?</h2>
          <div class="grid grid-cols-2 gap-3 mb-4">
            <button
              onclick={() => { resueltoRemotamente = false; confirmaRemota = false; }}
              aria-pressed={!resueltoRemotamente}
              class="cursor-pointer py-3 rounded-xl border-2 text-sm font-semibold transition-colors
                {!resueltoRemotamente ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}"
            >
              Presencial
            </button>
            <button
              onclick={() => (resueltoRemotamente = true)}
              aria-pressed={resueltoRemotamente}
              class="cursor-pointer py-3 rounded-xl border-2 text-sm font-semibold transition-colors
                {resueltoRemotamente ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}"
            >
              A distancia
            </button>
          </div>

          <h2 class="font-semibold text-slate-800 mb-1">Fotografías de evidencia</h2>
          <p class="text-xs text-slate-400 mb-4">
            {resueltoRemotamente ? 'Opcionales: no hubo visita' : 'Mínimo 1 foto requerida'} · {fotosListas.length} cargada{fotosListas.length !== 1 ? 's' : ''}
          </p>

          <label class="block w-full">
            <div class="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center gap-2 active:bg-slate-50 transition-colors cursor-pointer">
              {#if subiendoFoto}
                <Spinner class="h-8 w-8 text-blue-400" />
                <span class="text-sm text-slate-500">Subiendo...</span>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                  <circle cx="12" cy="13" r="3"/>
                </svg>
                <span class="text-sm font-medium text-slate-600">Tomar foto / Seleccionar archivo</span>
                <span class="text-xs text-slate-400">JPG, PNG, HEIC</span>
              {/if}
            </div>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onchange={handleFileChange}
              disabled={subiendoFoto}
              class="hidden"
            />
          </label>

          {#if fotos.length > 0}
            <div class="grid grid-cols-3 gap-2 mt-4">
              {#each fotos as foto, i (foto.preview)}
                <div class="relative aspect-square rounded-lg overflow-hidden bg-slate-100">
                  <img src={foto.preview} alt="evidencia {i + 1}" class="w-full h-full object-cover" />
                  {#if foto.cargando}
                    <div class="absolute inset-0 flex items-center justify-center bg-white/50">
                      <Spinner class="h-6 w-6 text-blue-400" />
                    </div>
                  {/if}
                    <button aria-label="Eliminar evidencia {i + 1}"
                      onclick={() => eliminarFoto(i)}
                      class="absolute top-1 right-1 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-black/60 cursor-pointer"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        {#if resueltoRemotamente && fotosListas.length > 0}
          <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-2">
            <p>Esta OT tiene fotografías adjuntas, lo que sugiere que hubo visita presencial. ¿Confirmas que la resolución fue remota?</p>
            <label class="flex items-center gap-2 min-h-11">
              <input type="checkbox" bind:checked={confirmaRemota} class="h-5 w-5" />
              Confirmo que la resolución fue remota
            </label>
          </div>
        {/if}

        {#if errorCierre}
          <Alert class="rounded-xl text-sm">
            {errorCierre}
          </Alert>
        {/if}

        <button
          onclick={() => (paso = 2)}
          disabled={!pasoFotosListo || subiendoFoto}
          class="btn btn-primario btn-bloque btn-grande"
        >
          Siguiente
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      {/if}

      <!-- PASO 2: Materiales -->
      {#if paso === 2}
        <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <h2 class="font-semibold text-slate-800 mb-1">Materiales utilizados</h2>
          <p class="text-xs text-slate-400 mb-4">
            Solo consumibles; deje en 0 los que no usó. Los equipos con número de serie
            (router, ONU) se declaran en el paso siguiente.
          </p>

          {#if materiales.length === 0}
            <p class="text-sm text-slate-400 text-center py-4">No hay materiales registrados en el sistema</p>
          {:else}
            <div class="space-y-3">
              {#each materiales as mat}
                {@const cantidad = cantidades[mat.id_tipo_equipo] ?? 0}
                {@const stockDisp = mat.stock?.cantidad_disponible ?? 0}
                <div class="border border-slate-100 rounded-xl p-3 {stockDisp === 0 && cantidad === 0 ? 'opacity-50' : ''}">
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <p class="font-medium text-slate-800 text-sm">{mat.nombre}</p>
                      {#if mat.categoria}
                        <p class="text-xs text-slate-400">{mat.categoria}</p>
                      {/if}
                      <p class="text-xs {stockDisp <= 0 ? 'text-red-500 font-medium' : 'text-slate-400'} mt-0.5">
                        Stock: {stockDisp}
                      </p>
                    </div>
                    <div class="flex items-center gap-2">
                      <button
                        onclick={() => cantidades[mat.id_tipo_equipo] = Math.max(0, (cantidades[mat.id_tipo_equipo] ?? 0) - 1)}
                        class="w-11 h-11 rounded-lg bg-slate-100 text-slate-600 font-bold text-lg flex items-center justify-center active:bg-slate-200 cursor-pointer"
                      >-</button>
                      <span class="w-8 text-center font-semibold text-slate-800">{cantidad}</span>
                      <button
                        onclick={() => cantidades[mat.id_tipo_equipo] = Math.min(stockDisp, (cantidades[mat.id_tipo_equipo] ?? 0) + 1)}
                        disabled={cantidad >= stockDisp}
                        class="w-11 h-11 rounded-lg bg-blue-100 text-blue-600 font-bold text-lg flex items-center justify-center active:bg-blue-200 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                      >+</button>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="flex gap-3">
          <button
            onclick={() => (paso = 1)}
            class="btn btn-secundario btn-grande flex-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Anterior
          </button>
          <button
            onclick={() => (paso = 3)}
            class="btn btn-primario btn-grande flex-1"
          >
            Siguiente
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      {/if}

      <!-- PASO 3: Datos de cierre -->
      {#if paso === 3}
        <!-- Equipos individualizables (acuerdo con G1). Va ANTES de los datos de
             cierre porque es lo que el tecnico tiene en la mano en ese momento;
             la potencia viene despues.
             Si no se pudieron leer las opciones, la seccion no se dibuja y el
             cierre sigue disponible: se avisa, no se bloquea. -->
        {#if !opcionesEquipo}
          <div class="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3 mb-4">
            No se pudieron cargar las opciones de equipos. Puede cerrar la OT igual,
            pero avise por radio si retiró o instaló un equipo con número de serie.
          </div>
        {:else}
        <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4 space-y-3 mb-4">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h2 class="font-semibold text-slate-800">Equipos con número de serie</h2>
              <p class="text-xs text-slate-500 mt-0.5">
                ONT, router o cualquier equipo que instale o retire. Si no tocó
                ninguno, deje esto vacío.
              </p>
            </div>
            <button
              type="button"
              onclick={agregarEquipo}
              class="btn btn-secundario btn-chico min-h-11 shrink-0 border-blue-200 bg-blue-50 text-blue-700
                     hover:bg-blue-100 focus-visible:ring-blue-500"
            >+ Agregar</button>
          </div>

          <!-- Una sola lista para todos los campos de serie (atributo `list`). -->
          <datalist id="mis-equipos">
            {#each misEquipos as e (e.numero_serie)}
              <option value={e.numero_serie}>{[e.tipo, e.modelo].filter(Boolean).join(' · ')}</option>
            {/each}
          </datalist>

          {#each equipos as equipo, i (i)}
            <div class="border border-slate-200 rounded-xl p-3 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Equipo {i + 1}
                </span>
                <button
                  type="button"
                  onclick={() => quitarEquipo(i)}
                  class="btn-texto-peligro"
                >Quitar</button>
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1" for="serie-{i}">
                  Número de serie *
                </label>
                <input
                  id="serie-{i}"
                  type="text"
                  autocapitalize="characters"
                  list="mis-equipos"
                  value={equipo.numero_serie}
                  oninput={(e) => normalizarSerie(i, e.currentTarget.value)}
                  placeholder="Ej: ALTX1234ABCD"
                  class="w-full border border-slate-200 rounded-xl px-4 py-3 text-base font-mono
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {#if misEquipos.length > 0}
                  <p class="text-xs text-slate-500 mt-1">
                    Al escribir le sugerimos los {misEquipos.length} equipos que lleva asignados.
                  </p>
                {/if}
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1" for="accion-{i}">
                  Qué se hizo con el equipo *
                </label>
                <select
                  id="accion-{i}"
                  bind:value={equipo.accion}
                  class="w-full border border-slate-200 rounded-xl px-4 py-3 text-base
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {#each opcionesEquipo?.acciones ?? [] as a}
                    <option value={a.accion}>{etiquetaAccion(a.accion)}</option>
                  {/each}
                </select>
                <!-- Se muestra a donde lo mueve inventario: "baja en terreno"
                     suena reversible y no lo es. -->
                {#if opcionesEquipo}
                  <p class="text-xs text-slate-500 mt-1">
                    Inventario lo deja en:
                    <span class="font-medium text-slate-700">
                      {opcionesEquipo.acciones.find((a) => a.accion === equipo.accion)?.estado_g1 ?? '--'}
                    </span>
                  </p>
                {/if}
              </div>

              {#if esRetiro(equipo.accion)}
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1" for="diag-{i}">
                    Qué le pasa al equipo *
                  </label>
                  <select
                    id="diag-{i}"
                    bind:value={equipo.diagnostico}
                    class="w-full border border-slate-200 rounded-xl px-4 py-3 text-base
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={undefined}>Seleccione diagnóstico</option>
                    {#each opcionesEquipo?.diagnosticos ?? [] as d}
                      <option value={d}>{d}</option>
                    {/each}
                  </select>
                  <p class="text-xs text-slate-500 mt-1">
                    Es el único que tiene el equipo en la mano: si no lo completa,
                    inventario lo recibe como
                    "{opcionesEquipo?.diagnostico_por_defecto ?? 'Causa desconocida'}".
                  </p>
                </div>

                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1" for="obs-{i}">
                    Estado físico <span class="font-normal text-slate-400">(opcional)</span>
                  </label>
                  <input
                    id="obs-{i}"
                    type="text"
                    maxlength="200"
                    bind:value={equipo.observacion_estado_fisico}
                    placeholder="Golpes, humedad, cable cortado..."
                    class="w-full border border-slate-200 rounded-xl px-4 py-3 text-base
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              {/if}
            </div>
          {/each}
        </div>
        {/if}

        <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4 space-y-4">
          <h2 class="font-semibold text-slate-800">Datos de cierre</h2>

          {#if requiereCategoriaFalla}
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">
                Categoría de falla *
              </label>
              <select
                bind:value={idCategoriaFalla}
                class="w-full border border-slate-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Seleccione categoría</option>
                {#each categoriasFalla as cat}
                  <option value={cat.id_categoria}>{cat.nombre}{cat.sla_horas ? ` · SLA ${cat.sla_horas}h` : ''}</option>
                {/each}
              </select>

              {#if categoriaSeleccionada?.nombre.toLowerCase() === 'otro'}
                <input
                  type="text"
                  bind:value={categoriaFallaOtro}
                  maxlength="120"
                  placeholder="Describa la falla"
                  class="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              {/if}
            </div>
          {/if}

          <!-- Los tres datos que G1 exige para registrar el cierre de una
               reparacion. Van juntos y pegados a la categoria de falla porque
               son el mismo momento mental: que pasaba, que hice, como quedo.
               En los demas tipos de OT esta seccion no existe. -->
          {#if esReparacion}
            <div class="space-y-4 border-t border-slate-100 pt-4">
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1" for="falla-reportada">
                  ¿Qué falla encontró? *
                </label>
                <textarea
                  id="falla-reportada"
                  bind:value={fallaReportada}
                  rows="3"
                  maxlength={LARGO_MAX_REPARACION}
                  placeholder="Ej: fibra cortada en el poste frente al domicilio"
                  class="w-full border border-slate-200 rounded-xl px-4 py-3 text-base
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
                ></textarea>
                <p class="text-xs text-slate-400 mt-1 text-right">
                  {fallaReportada.trim().length}/{LARGO_MAX_REPARACION}
                </p>
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1" for="solucion-aplicada">
                  ¿Qué hizo para resolverla? *
                </label>
                <textarea
                  id="solucion-aplicada"
                  bind:value={solucionAplicada}
                  rows="3"
                  maxlength={LARGO_MAX_REPARACION}
                  placeholder="Ej: se empalmó la fibra y se midió potencia en la ONT"
                  class="w-full border border-slate-200 rounded-xl px-4 py-3 text-base
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
                ></textarea>
                <p class="text-xs text-slate-400 mt-1 text-right">
                  {solucionAplicada.trim().length}/{LARGO_MAX_REPARACION}
                </p>
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1" for="resultado-reparacion">
                  ¿Cómo quedó? *
                </label>
                <select
                  id="resultado-reparacion"
                  bind:value={resultadoReparacion}
                  class="w-full border border-slate-200 rounded-xl px-4 py-3 text-base
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Seleccione el resultado</option>
                  {#each RESULTADOS_REPARACION as r}
                    <option value={r.valor}>{r.etiqueta}</option>
                  {/each}
                </select>
              </div>
            </div>
          {/if}

          <!-- Potencia óptica -->
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">
              Potencia óptica (dBm) *
            </label>
            <input
              type="number"
              step="0.1"
              bind:value={potencia}
              placeholder="-21.5"
              class="w-full border border-slate-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {#if advertenciaPotencia}
              <div class="flex items-start gap-2 mt-2 bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p class="text-sm">Potencia fuera del rango normal (-19 a -24 dBm)</p>
              </div>
            {/if}
          </div>

          <!-- Lo que el tecnico quiera dejarle dicho al jefe que aprueba. -->
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1" for="comentario-cierre">
              Comentarios del cierre (opcional)
            </label>
            <textarea
              id="comentario-cierre"
              bind:value={comentario}
              rows="3"
              maxlength={LARGO_MAX_COMENTARIO}
              placeholder="Ej: el cliente pidió dejar el router en el living"
              class="w-full border border-slate-200 rounded-xl px-4 py-3 text-base
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
            ></textarea>
            <p class="text-xs text-slate-400 mt-1 text-right">
              {comentario.trim().length}/{LARGO_MAX_COMENTARIO}
            </p>
          </div>


          <!-- La modalidad (CU-56) se elige en el paso 1: de ella depende si las
               fotos son obligatorias. -->
        </div>

        {#if errorCierre}
          <Alert class="rounded-xl text-sm">
            {errorCierre}
          </Alert>
        {/if}

        <!-- Sin esto el boton queda gris y el tecnico no tiene como saber por
             que: no puede hacer clic para provocar el mensaje de error. -->
        {#if faltante.length > 0}
          <div class="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3 mb-3">
            Para cerrar falta {faltante.join(', ')}.
          </div>
        {/if}

        <div class="flex gap-3">
          <button
            onclick={() => (paso = 2)}
            class="btn btn-secundario btn-grande flex-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Anterior
          </button>
          <button
            onclick={() => cerrarOT()}
            disabled={cerrando || faltante.length > 0}
            class="btn btn-exito btn-grande flex-1"
          >
            {#if cerrando}
              <Spinner class="h-5 w-5" />
              Cerrando...
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Cerrar OT
            {/if}
          </button>
        </div>
      {/if}
    </main>
  </div>

  <!-- Modal advertencia potencia -->
  {#if mostrarModalPotencia}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
      <div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <div class="flex items-center gap-3 mb-3">
          <div class="bg-amber-100 rounded-full p-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 class="font-semibold text-slate-800">Potencia fuera de rango</h3>
        </div>
        <p class="text-sm text-slate-600 mb-5">
          La potencia ingresada ({potencia} dBm) esta fuera del rango normal (-19 a -24 dBm).
          El cierre se registro correctamente.
          {#if alertaReparaciones?.activa}
            Este cliente acumula {alertaReparaciones.total_reparaciones_30_dias} reparaciones en 30 dias.
          {/if}
        </p>
        <div class="flex gap-3">
          <button
            onclick={() => goto('/terreno')}
            class="btn btn-secundario btn-grande flex-1"
          >
            Volver
          </button>
          <button
            onclick={confirmarCierrePotencia}
            class="btn btn-grande flex-1 bg-amber-500 text-white shadow-sm hover:bg-amber-600 focus-visible:ring-amber-500"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}
