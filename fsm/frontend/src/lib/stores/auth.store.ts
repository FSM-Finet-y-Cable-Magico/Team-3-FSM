import { writable, get } from 'svelte/store';
import { goto } from '$app/navigation';
import * as authApi from '$lib/api/auth.api';

interface UsuarioPayload {
  userId: number;
  nombre_usuario: string;
  rol: string;
  id_empresa: number;
}

interface AuthState {
  token: string | null;
  usuario: UsuarioPayload | null;
  isAuthenticated: boolean;
}

function createAuthStore() {
  const { subscribe, set, update } = writable<AuthState>({
    token: null,
    usuario: null,
    isAuthenticated: false,
  });

  function decodeJwt(token: string): UsuarioPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1]));
      return {
        userId: payload.userId,
        nombre_usuario: payload.nombre_usuario,
        rol: payload.rol,
        id_empresa: payload.id_empresa,
      };
    } catch {
      return null;
    }
  }

  async function login(nombre_usuario: string, password: string): Promise<string> {
    const response = await authApi.login(nombre_usuario, password);
    const { token, rol, id_empresa, cambiar_password } = response;

    sessionStorage.setItem('fsm_token', token);
    const usuario = decodeJwt(token);

    set({
      token,
      usuario,
      isAuthenticated: true,
    });

    if (cambiar_password) {
      return '/cambiar-password';
    }
    // Un area por rol (MOD RF-34): el tecnico trabaja en /terreno y el resto
    // en /admin. Esta funcion es el UNICO lugar que decide eso tras el login;
    // la raiz y el layout de /admin lo repiten para el caso de volver con la
    // sesion ya abierta.
    if (rol === 'TECNICO') {
      return '/terreno';
    }
    return '/admin/dashboard';
  }

  function logout() {
    sessionStorage.removeItem('fsm_token');
    set({ token: null, usuario: null, isAuthenticated: false });
    goto('/login');
  }

  function checkAuth() {
    const token = sessionStorage.getItem('fsm_token');
    if (!token) return;

    const usuario = decodeJwt(token);
    if (!usuario) {
      sessionStorage.removeItem('fsm_token');
      return;
    }

    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        if (payload.exp) {
          const exp = payload.exp * 1000;
          if (Date.now() >= exp) {
            sessionStorage.removeItem('fsm_token');
            return;
          }
        }
      }
    } catch {
      sessionStorage.removeItem('fsm_token');
      return;
    }

    set({ token, usuario, isAuthenticated: true });
  }

  return {
    subscribe,
    login,
    logout,
    checkAuth,
  };
}

export const authStore = createAuthStore();
