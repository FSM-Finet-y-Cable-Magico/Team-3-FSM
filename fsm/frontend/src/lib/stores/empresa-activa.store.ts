import { get, writable } from 'svelte/store';

/**
 * CU-33: la empresa con la que trabaja el ADMIN (FiNet o Cable Mágico).
 *
 * `null` es "la de mi token", que es el caso de todos los demas roles y el del
 * ADMIN que no eligio otra. Se guarda en sessionStorage, igual que el token
 * (ADR-001): dura lo que la pestaña y no se comparte entre sesiones.
 *
 * La Vista no filtra nada con esto: `http.ts` lo manda como header en toda
 * peticion y el Controlador lo resuelve en un solo lugar (la estrategia JWT),
 * asi que ninguna pantalla tiene que acordarse de pasarlo.
 */
const CLAVE = 'fsm_empresa_activa';

function leer(): number | null {
  if (typeof sessionStorage === 'undefined') return null;
  const n = Number(sessionStorage.getItem(CLAVE));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const empresaActiva = writable<number | null>(leer());

export function elegirEmpresa(id: number | null) {
  if (typeof sessionStorage !== 'undefined') {
    if (id === null) sessionStorage.removeItem(CLAVE);
    else sessionStorage.setItem(CLAVE, String(id));
  }
  empresaActiva.set(id);
}

/** El header que espera el Controlador, o nada si se trabaja con la propia. */
export function cabeceraEmpresaActiva(): Record<string, string> {
  const id = get(empresaActiva);
  return id === null ? {} : { 'X-Empresa-Activa': String(id) };
}
