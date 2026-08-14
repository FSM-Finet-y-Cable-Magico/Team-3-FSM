import { PUBLIC_API_URL } from '$env/static/public';

// Se usa `$env/static/public` (no `dynamic`) a propósito: el valor queda
// incrustado en el bundle al compilar, así que cada ambiente necesita su
// propio build. Es lo que corresponde acá porque no hay código de servidor
// (ni `+page.server.ts` ni hooks) y el despliegue de la Vista es un build
// por ambiente en Vercel. Si en algún momento hace falta apuntar un mismo
// artefacto a distintos backends, cambiar a `$env/dynamic/public`.

// Se le saca la barra final para que `${API_URL}/api/...` no quede con doble
// barra: el backend monta todo bajo el prefijo `api` y el gateway del
// dashboard bajo el namespace `/dashboard`, y ninguno de los dos matchea con
// `//`.
export const API_URL = PUBLIC_API_URL.replace(/\/+$/, '');
