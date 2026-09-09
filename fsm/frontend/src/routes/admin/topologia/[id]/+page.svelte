<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { authStore } from '$lib/stores/auth.store';
  import * as topologiaApi from '$lib/api/topologia.api';
  import type { DetallePuertos, PuertoNap } from '$lib/api/topologia.api';

  let token = $state('');
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

  async function cargar() {
    cargando = true;
    error = '';
    try {
      detalle = await topologiaApi.puertosDeCaja(token, idCaja);
      eIdentificador = detalle.identificador_unico ?? '';
      eZona = detalle.zona ?? '';
      eCapacidad = detalle.capacidad_puertos;
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
</script>

<svelte:head><title>{detalle?.identificador_unico ?? 'Caja'} · Topología</title></svelte:head>

<a href="/admin/topologia" class="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-4">
  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
  </svg>
  Volver a topología
</a>

{#if aviso}
  <div role="status" class="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center justify-between">
    <span>{aviso}</span>
    <button onclick={() => (aviso = '')} class="text-emerald-600 hover:text-emerald-800 cursor-pointer" aria-label="Cerrar aviso">✕</button>
  </div>
{/if}

{#if cargando}
  <p class="text-center py-10 text-slate-500">Cargando...</p>
{:else if error && !detalle}
  <div role="alert" class="px-4 py-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">{error}</div>
{:else if detalle}
  {#if error}
    <div role="alert" class="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">{error}</div>
  {/if}

  <div class="bg-white rounded-xl border border-slate-200 p-5 mb-5">
    {#if !editando}
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">{detalle.identificador_unico ?? `#${detalle.id_caja_nap}`}</h1>
          <p class="text-sm text-slate-500 mt-0.5">{detalle.zona ?? 'Sin zona'}</p>
        </div>
        <button
          onclick={() => { editando = true; errorForm = ''; }}
          class="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
        >
          Editar datos
        </button>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-5 pt-5 border-t border-slate-100">
        {#each [
          { l: 'Capacidad', v: detalle.capacidad_puertos, c: 'text-slate-900' },
          { l: 'Sin registro', v: detalle.sin_registro, c: 'text-slate-600' },
          { l: 'Reservados', v: detalle.reservados, c: 'text-amber-700' },
          { l: 'Ocupados', v: detalle.ocupados, c: 'text-red-700' },
          { l: 'En mantención', v: detalle.en_mantencion, c: 'text-blue-700' },
        ] as t}
          <div>
            <p class="text-xs uppercase tracking-wide text-slate-500">{t.l}</p>
            <p class="text-xl font-semibold {t.c} mt-0.5">{t.v}</p>
          </div>
        {/each}
      </div>
    {:else}
      <form onsubmit={guardar}>
        <h2 class="text-lg font-semibold text-slate-900 mb-4">Editar caja</h2>

        {#if errorForm}
          <div role="alert" class="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
            {errorForm}
          </div>
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
            <input id="e-poste" bind:value={ePoste}
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

  <div class="bg-white rounded-xl border border-slate-200 p-5">
    <h2 class="text-lg font-semibold text-slate-900 mb-1">Puertos</h2>
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
      <p class="text-sm text-slate-500">Esta caja no tiene puertos registrados.</p>
    {/if}
  </div>
{/if}
