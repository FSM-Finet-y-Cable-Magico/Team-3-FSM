import { API_URL } from './config.js';

export interface LoginResponse {
  token: string;
  rol: string;
  id_empresa: number;
  cambiar_password: boolean;
}

export interface CrearUsuarioDto {
  nombre_completo: string;
  nombre_usuario: string;
  password_temporal: string;
  rol: string;
  id_empresa: number;
  zona?: string;
  empresa_contratista?: string;
}

export async function login(nombre_usuario: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre_usuario, password }),
  });

  if (res.status >= 400) {
    const data = await res.json();
    throw new Error(data.message || 'Error de autenticación');
  }

  return res.json();
}

export async function cambiarPassword(
  token: string,
  nueva_password: string,
  confirmar_password: string
): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/cambiar-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ nueva_password, confirmar_password }),
  });

  if (res.status >= 400) {
    const data = await res.json();
    throw new Error(data.message || 'Error al cambiar contraseña');
  }
}

export async function crearUsuario(token: string, dto: CrearUsuarioDto): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/usuarios`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(dto),
  });

  if (res.status >= 400) {
    const data = await res.json();
    throw new Error(data.message || 'Error al crear usuario');
  }
}

export async function listarUsuarios(token: string): Promise<
  Array<{
    id_usuario: number;
    id_empresa: number | null;
    nombre_completo: string;
    nombre_usuario: string;
    email: string | null;
    fecha_creacion: string;
    rol: string;
  }>
> {
  const res = await fetch(`${API_URL}/api/auth/usuarios`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status >= 400) {
    const data = await res.json();
    throw new Error(data.message || 'Error al listar usuarios');
  }

  return res.json();
}
