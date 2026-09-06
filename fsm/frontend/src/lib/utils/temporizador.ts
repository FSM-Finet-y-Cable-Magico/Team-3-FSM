import { onDestroy } from 'svelte';

/** Un callback diferido por pantalla, incluso si una petición termina tras salir. */
export function crearTemporizador() {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  let destruido = false;
  onDestroy(() => {
    destruido = true;
    clearTimeout(temporizador);
  });
  return (callback: () => void, demora: number) => {
    if (destruido) return;
    clearTimeout(temporizador);
    temporizador = setTimeout(callback, demora);
  };
}
