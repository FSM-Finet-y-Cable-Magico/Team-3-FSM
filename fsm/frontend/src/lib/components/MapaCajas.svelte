<script lang="ts">
  import 'leaflet/dist/leaflet.css';
  import { onMount, onDestroy } from 'svelte';
  import type { CircleMarker, LayerGroup, Map as MapaLeaflet } from 'leaflet';
  import type { EstadoCaja, SaludCaja } from '$lib/api/topologia.api';
  import { ESTADO_CAJA } from '$lib/utils/estado-caja';

  interface Props {
    cajas: SaludCaja[];
    /** Caja a centrar y abrir. Cambia cuando se elige una en la lista. */
    seleccionada?: number | null;
    onseleccionar?: (id: number) => void;
    alto?: string;
  }

  let { cajas, seleccionada = null, onseleccionar, alto = 'h-140' }: Props = $props();

  let contenedor: HTMLDivElement;
  // Leaflet toca `window` al importarse: se carga recien en el navegador, en
  // onMount, y no en el import de arriba, para que el SSR de SvelteKit no lo
  // ejecute.
  let L = $state<typeof import('leaflet') | null>(null);
  let mapa: MapaLeaflet | null = null;
  let capa: LayerGroup | null = null;
  const marcadores = new Map<number, CircleMarker>();

  /** Se dibujan de la mas sana a la mas grave, para que la roja quede encima. */
  const ORDEN_DIBUJO: Record<EstadoCaja, number> = { SIN_ONT: 0, OK: 1, DEGRADADA: 2, CAIDA: 3 };
  const RADIO: Record<EstadoCaja, number> = { SIN_ONT: 4, OK: 6, DEGRADADA: 8, CAIDA: 10 };

  onMount(async () => {
    const mod = await import('leaflet');
    const leaflet = (mod as unknown as { default?: typeof import('leaflet') }).default ?? mod;
    // Canvas y no SVG: son ~900 cajas, y con un nodo SVG por caja el mapa se
    // arrastra en un notebook de terreno.
    mapa = leaflet.map(contenedor, { preferCanvas: true }).setView([-33.55, -71.6], 12);
    leaflet
      .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      })
      .addTo(mapa);
    capa = leaflet.layerGroup().addTo(mapa);
    L = leaflet;
  });

  onDestroy(() => {
    mapa?.remove();
    mapa = null;
  });

  $effect(() => {
    if (L && mapa && capa) pintar(L, cajas);
  });

  $effect(() => {
    const id = seleccionada;
    if (L && mapa && id != null) enfocar(id);
  });

  function pintar(leaflet: typeof import('leaflet'), lista: SaludCaja[]) {
    capa!.clearLayers();
    marcadores.clear();
    const ubicadas = lista
      .filter((c) => c.latitud != null && c.longitud != null)
      .sort((a, b) => ORDEN_DIBUJO[a.estado] - ORDEN_DIBUJO[b.estado]);

    for (const c of ubicadas) {
      const meta = ESTADO_CAJA[c.estado];
      const m = leaflet.circleMarker([c.latitud!, c.longitud!], {
        radius: RADIO[c.estado],
        color: '#ffffff',
        weight: 1,
        fillColor: meta.color,
        fillOpacity: c.estado === 'SIN_ONT' ? 0.55 : 0.9,
      });
      m.bindTooltip(c.identificador_unico ?? `#${c.id_caja_nap}`);
      m.bindPopup(() => globo(c));
      m.on('click', () => onseleccionar?.(c.id_caja_nap));
      m.addTo(capa!);
      marcadores.set(c.id_caja_nap, m);
    }

    // Se encuadra en lo que quedo despues del filtro: al elegir una zona, el
    // mapa va a esa zona.
    if (ubicadas.length > 0) {
      const [s, n] = rangoCentral(ubicadas.map((c) => c.latitud!));
      const [o, e] = rangoCentral(ubicadas.map((c) => c.longitud!));
      mapa!.fitBounds([[s, o], [n, e]], { padding: [24, 24], maxZoom: 16 });
    }
  }

  /**
   * Del 2 % al 98 % de los valores. Con el minimo y el maximo, una sola caja
   * mal geolocalizada --o las de demo en la costa-- aleja el mapa hasta mostrar
   * media region y la red real queda en un punto.
   */
  function rangoCentral(valores: number[]): [number, number] {
    const v = [...valores].sort((a, b) => a - b);
    const corte = v.length >= 50 ? Math.floor(v.length * 0.02) : 0;
    return [v[corte], v[v.length - 1 - corte]];
  }

  function enfocar(id: number) {
    const m = marcadores.get(id);
    if (!m) return;
    mapa!.setView(m.getLatLng(), Math.max(mapa!.getZoom(), 16));
    m.openPopup();
  }

  /**
   * Contenido del globo, armado con nodos y textContent y NO con un string de
   * HTML: el nombre de la caja viene del KML de Tomodat, y un nombre con `<`
   * se interpretaria como marcado.
   */
  function globo(c: SaludCaja): HTMLElement {
    const div = document.createElement('div');
    div.className = 'text-sm space-y-1 min-w-44';

    const titulo = document.createElement('p');
    titulo.className = 'font-semibold text-slate-900';
    titulo.textContent = c.identificador_unico ?? `#${c.id_caja_nap}`;

    const estado = document.createElement('p');
    estado.style.color = ESTADO_CAJA[c.estado].color;
    estado.className = 'font-medium';
    estado.textContent = ESTADO_CAJA[c.estado].etiqueta + (c.zona ? ` · ${c.zona}` : '');

    div.append(titulo, estado);

    const lineas: string[] = [];
    if (c.onts.total > 0) {
      lineas.push(`${c.onts.en_linea} de ${c.onts.total} ONT en línea`);
      if (c.onts.caidas) lineas.push(`${c.onts.caidas} sin servicio`);
      if (c.onts.potencia_fuera) lineas.push(`${c.onts.potencia_fuera} con potencia fuera de rango`);
    } else {
      lineas.push('Ninguna ONT ligada a esta caja');
    }
    if (c.alertas_abiertas) lineas.push(`${c.alertas_abiertas} alerta(s) abierta(s)`);
    if (c.ots_abiertas) lineas.push(`${c.ots_abiertas} OT abierta(s)`);
    for (const l of lineas) {
      const p = document.createElement('p');
      p.className = 'text-slate-600';
      p.textContent = l;
      div.append(p);
    }

    const enlace = document.createElement('a');
    enlace.href = `/admin/topologia/${c.id_caja_nap}`;
    enlace.className = 'inline-block pt-1 font-medium text-blue-700 hover:text-blue-900';
    enlace.textContent = 'Ver caja →';
    div.append(enlace);
    return div;
  }
</script>

<div class="relative">
  <div
    bind:this={contenedor}
    class="w-full {alto} rounded-xl border border-slate-200 bg-slate-100 z-0"
    role="region"
    aria-label="Mapa de cajas NAP coloreadas según el estado de sus ONT. La misma información está en la lista."
  ></div>
  {#if !L}
    <p class="absolute inset-0 flex items-center justify-center text-sm text-slate-500">Cargando mapa...</p>
  {/if}
</div>

<ul class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-600" aria-label="Leyenda del mapa">
  {#each Object.entries(ESTADO_CAJA) as [, meta]}
    <li class="flex items-center gap-1.5">
      <span class="inline-block w-3 h-3 rounded-full border border-white shadow-sm" style="background: {meta.color}"></span>
      {meta.etiqueta}
    </li>
  {/each}
</ul>
