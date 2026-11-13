import type { EstadoCaja } from '$lib/api/topologia.api';

/**
 * Cómo se muestra cada estado de caja, en el mapa y en las listas.
 *
 * El color nunca va solo: siempre lo acompaña la etiqueta, para quien no
 * distingue rojo de verde.
 */
export const ESTADO_CAJA: Record<EstadoCaja, { etiqueta: string; color: string; badge: string }> = {
  CAIDA: { etiqueta: 'Caída', color: '#dc2626', badge: 'bg-red-100 text-red-800 border-red-200' },
  DEGRADADA: { etiqueta: 'Degradada', color: '#d97706', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  OK: { etiqueta: 'Sin problemas', color: '#16a34a', badge: 'bg-green-100 text-green-800 border-green-200' },
  SIN_ONT: { etiqueta: 'Sin ONT ligada', color: '#94a3b8', badge: 'bg-slate-100 text-slate-600 border-slate-200' },
};
