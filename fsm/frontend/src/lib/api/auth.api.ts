import { API_URL } from './config.js';
import { pedirJson, pedirCrudo } from './http.js';

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
  // `pedirCrudo` y no `pedirJson`: este endpoint responde sin cuerpo, y
  // parsearlo como JSON fallaria en el caso exitoso.
  await pedirCrudo(
    token,
    `${API_URL}/api/auth/cambiar-password`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nueva_password, confirmar_password }),
    },
    'Error al cambiar contraseña',
  );
}

export async function crearUsuario(token: string, dto: CrearUsuarioDto): Promise<void> {
  await pedirCrudo(
    token,
    `${API_URL}/api/auth/usuarios`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto),
    },
    'Error al crear usuario',
  );
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
  return pedirJson(token, `${API_URL}/api/auth/usuarios`, undefined, 'Error al listar usuarios');
}
