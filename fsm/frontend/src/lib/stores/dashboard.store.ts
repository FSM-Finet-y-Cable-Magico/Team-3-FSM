import { writable } from 'svelte/store';
import { obtenerIndicadores } from '$lib/api/dashboard.api.js';
import type { IndicadoresDashboard } from '$lib/api/dashboard.api.js';

interface DashboardState {
  indicadores: IndicadoresDashboard | null;
  isLoading: boolean;
  ultimaActualizacion: Date | null;
}

function createDashboardStore() {
  const { subscribe, update } = writable<DashboardState>({
    indicadores: null,
    isLoading: false,
    ultimaActualizacion: null,
  });

  async function cargarIndicadores(token: string, id_empresa?: number) {
    update((s) => ({ ...s, isLoading: true }));
    try {
      const indicadores = await obtenerIndicadores(token, id_empresa);
      update(() => ({
        indicadores,
        isLoading: false,
        ultimaActualizacion: new Date(),
      }));
    } catch {
      update((s) => ({ ...s, isLoading: false }));
    }
  }

  return { subscribe, cargarIndicadores };
}

export const dashboardStore = createDashboardStore();
