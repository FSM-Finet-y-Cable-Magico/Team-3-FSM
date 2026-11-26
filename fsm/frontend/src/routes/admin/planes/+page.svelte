<script lang="ts">
  // Catalogo de planes de la empresa activa, en solo lectura (acta con FiNet).
  //
  // DE DONDE SALEN LOS PLANES. No son nuestros: contra la base compartida
  // `finet_global_validacion` el catalogo lo carga el CRM de G8, y `g3_app`
  // solo tiene SELECT sobre `plan` (ver prisma/seed-global.ts y
  // common/utils/estado-activo.util.ts). El portal web de G2 muestra el mismo
  // catalogo a los clientes, pero tampoco es el dueno. El alta y la edicion
  // quedan pendientes de B-01: de quien son `plan` y `contrato`.
  import Alert from '$lib/components/Alert.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth.store';
  import { listarPlanes, type PlanResumen } from '$lib/api/clientes.api';

  let planes = $state<PlanResumen[]>([]);
  let cargando = $state(true);
  let error = $state('');

  onMount(async () => {
    authStore.checkAuth();
    const s = get(authStore);
    if (!s.isAuthenticated || !['ADMIN', 'JEFE_TECNICO'].includes(s.usuario?.rol ?? '')) {
      goto('/admin/dashboard');
      return;
    }
    try {
      planes = await listarPlanes(s.token ?? '');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al cargar los planes';
    } finally {
      cargando = false;
    }
  });

  const precio = (n: number) =>
    n.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

  /** El FSM guarda 'INTERNET' y el CRM de G8 'Internet': se muestra igual. */
  const titulo = (t?: string | null) => {
    const v = (t ?? '').trim();
    return v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : '';
  };

  // El backend ya ordena por tipo y despues por precio: agrupar en ese orden
  // conserva el mas barato arriba dentro de cada tipo.
  const grupos = $derived.by(() => {
    const m = new Map<string, PlanResumen[]>();
    for (const p of planes) {
      const clave = titulo(p.tipo_plan) || 'Sin tipo';
      const lista = m.get(clave);
      if (lista) lista.push(p);
      else m.set(clave, [p]);
    }
    return [...m.entries()];
  });

  const contratosTotal = $derived(planes.reduce((a, p) => a + p.contratos_activos, 0));
  const precios = $derived(planes.map((p) => p.precio_mensual));
  const rango = $derived(
    precios.length === 0
      ? '-'
      : Math.min(...precios) === Math.max(...precios)
        ? precio(precios[0])
        : `${precio(Math.min(...precios))} a ${precio(Math.max(...precios))}`,
  );
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-slate-800">Planes</h1>
    <p class="text-sm text-slate-600">
      Catálogo vigente de la empresa activa, en solo lectura. Los planes los administra el CRM
      comercial; el FSM los consulta para la ficha del cliente y no los crea ni los edita.
    </p>
  </div>

  {#if error}<Alert>{error}</Alert>{/if}

  {#if cargando}
    <p role="status" class="text-slate-500">Cargando...</p>
  {:else if planes.length === 0}
    <div class="rounded-xl border border-slate-200 bg-white p-8 text-center">
      <p class="text-base font-medium text-slate-800">No hay planes activos para esta empresa.</p>
      <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
        El catálogo no se carga desde el FSM: lo administra el CRM comercial sobre la base
        compartida, y aquí solo se lee. Si la lista está vacía, todavía no se han dado de alta
        planes para esta empresa o están marcados como inactivos.
      </p>
    </div>
  {:else}
    <dl class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-xl border border-slate-200 bg-white p-4">
        <dt class="text-xs uppercase tracking-wide text-slate-500">Planes activos</dt>
        <dd class="mt-1 text-2xl font-bold tabular-nums text-slate-900">{planes.length}</dd>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-4">
        <dt class="text-xs uppercase tracking-wide text-slate-500">Contratos vigentes</dt>
        <dd class="mt-1 text-2xl font-bold tabular-nums text-slate-900">{contratosTotal}</dd>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-4">
        <dt class="text-xs uppercase tracking-wide text-slate-500">Rango de precios</dt>
        <dd class="mt-1 text-base font-semibold tabular-nums text-slate-900">{rango}</dd>
      </div>
    </dl>

    {#each grupos as [tipo, delTipo] (tipo)}
      <section class="space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {tipo}
          <span class="font-normal normal-case text-slate-400">
            ({delTipo.length} {delTipo.length === 1 ? 'plan' : 'planes'})
          </span>
        </h2>

        <ul class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {#each delTipo as p (p.id_plan)}
            <li class="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div class="flex items-start justify-between gap-3">
                <h3 class="text-base font-semibold text-slate-900">{p.nombre_comercial}</h3>
                {#if p.tipo_cliente}
                  <span class="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    {titulo(p.tipo_cliente)}
                  </span>
                {/if}
              </div>

              <p class="mt-3 text-2xl font-bold tabular-nums text-slate-900">
                {precio(p.precio_mensual)}
                <span class="text-sm font-normal text-slate-500">/ mes</span>
              </p>

              {#if p.velocidad_mbps}
                <p class="mt-1 text-sm font-medium text-slate-700">{p.velocidad_mbps} Mbps</p>
              {/if}

              {#if p.descripcion}
                <p class="mt-3 text-sm leading-relaxed text-slate-600">{p.descripcion}</p>
              {/if}

              <div class="mt-auto flex items-center justify-between gap-3 pt-4 text-xs text-slate-500">
                <span>
                  <span class="font-semibold tabular-nums text-slate-700">{p.contratos_activos}</span>
                  {p.contratos_activos === 1 ? 'contrato vigente' : 'contratos vigentes'}
                </span>
                <span class="tabular-nums">Plan #{p.id_plan}</span>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>
