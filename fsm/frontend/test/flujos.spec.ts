import { readFileSync } from 'node:fs';
import { test, expect, type Page, type Route } from '@playwright/test';
import { urlMiniaturaEvidencia } from '../src/lib/utils/cloudinary';

const imagen = readFileSync(new URL('../static/logo_finet.png', import.meta.url));
const archivo = { name: 'evidencia.png', mimeType: 'image/png', buffer: imagen };
const remota = 'https://res.cloudinary.com/demo/image/upload/v1/evidencia.png';
const cliente = { id_cliente: 1, rut: '12345678-5', nombre_completo: 'Cliente de prueba', estado: 'ACTIVO', es_conflictivo: false,
  telefono: '912345678', email: 'prueba@example.com', fecha_creacion: '2026-01-01T12:00:00Z', direccion_principal: { direccion_completa: 'Calle de prueba 100', comuna: 'El Quisco' } };
const ot = { id_ot: 1, id_tecnico: 7, id_empresa: 1, id_cliente: 1, tipo_ot: 'INSTALACION', estado: 'EN_CURSO', prioridad: 'ALTA',
  fecha_creacion: '2026-01-01T12:00:00Z', cliente, tecnico: { nombre_completo: 'Técnico de prueba' }, historial: [] };

async function preparar(page: Page) {
  page.on('pageerror', error => console.error('Error de navegador:', error.message));
  const registro = { cierres: [] as unknown[], estados: [] as Record<string, unknown>[], clientes: 0, fotos: 0, imagenesRemotas: 0, pendientes: [] as Route[], modo: 'ok', equiposCaidos: false, tokenVencido: false, estadoFalla: false, tecnicos: [] as any[], detenidas: [] as any[], descartadas: [] as number[], reasignaciones: [] as any[], prioridades: [] as any[], alertas: [] as any[], destinatarios: null as any, avisos: [] as any[], configuracion: { umbral: null as number | null, guardados: [] as (number | null)[] }, plantillas: [{ id_plantilla: 5, id_empresa: 1, tipo_evento: 'FALLA', canal: 'SMS', contenido_texto: 'Hola', tiempo_estimado_reparacion: '1 hora', activa: true, es_base: false, editable: true, variables_usadas: [] }] as any[] };
  await page.addInitScript(() => {
    const urls = { creadas: [] as string[], liberadas: [] as string[] };
    Object.assign(window, { urlsDePrueba: urls });
    const crear = URL.createObjectURL.bind(URL), liberar = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = crear(blob); urls.creadas.push(url); return url; };
    URL.revokeObjectURL = url => { urls.liberadas.push(url); liberar(url); };
  });
  await page.route('https://res.cloudinary.com/**', async route => {
    registro.imagenesRemotas++;
    await route.fulfill({ contentType: 'image/png', body: imagen });
  });
  await page.route('http://127.0.0.1:3000/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), ruta = url.pathname;
    const responder = (json: unknown, status = 200) => route.fulfill({ json, status });
    // Cualquier ruta autenticada pasa a responder 401 cuando se simula el
    // vencimiento. El login se deja fuera: su 401 es "clave incorrecta".
    if (registro.tokenVencido && ruta !== '/api/auth/login') {
      return responder({ message: 'Unauthorized', statusCode: 401 }, 401);
    }
    if (ruta === '/api/auth/login') {
      const rol = req.postDataJSON().nombre_usuario.startsWith('tecnico') ? 'TECNICO' : 'ADMIN';
      const payload = { rol, id_empresa: 1, userId: 7, nombre_usuario: 'prueba.usuario', exp: Math.floor(Date.now()/1000) + 3600 };
      const token = ['e30', Buffer.from(JSON.stringify(payload)).toString('base64'), 'prueba'].join('.');
      return responder({ token, rol, id_empresa: 1, cambiar_password: false });
    }
    if (ruta === '/api/clientes' || ruta.startsWith('/api/clientes/')) registro.clientes++;
    if (ruta === '/api/clientes') {
      const pageNumber = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20);
      const todos = Array.from({ length: 21 }, (_, i) => ({ ...cliente, id_cliente: i + 1, nombre_completo: 'Cliente ' + (i + 1) }));
      return responder({ data: todos.slice((pageNumber-1)*limit,pageNumber*limit), total: 21, page: pageNumber, limit });
    }
    if (ruta.startsWith('/api/clientes/rut/')) return responder({ cliente, historial_ot: [] });
    if (ruta.includes('/historial-fallas/')) return responder({
      historial: [{ ...ot, tipo_ot: 'REPARACION', estado: 'COMPLETADA', fotos: [{ url_cloudinary: remota, formato: 'png' }], materiales: [], resuelto_remotamente: false }],
      categoria_frecuente: null, estadisticas: { total_reparaciones: 1, reparaciones_completadas: 1, tiempo_promedio_dias: 1, potencia_promedio_dbm: -21 },
    });
    if (ruta === '/api/ordenes/acciones-equipo') {
      // Se sirven los literales tal cual los manda el backend, con tildes: si
      // la Vista los deformara al mostrarlos, G1 rechazaria el cierre.
      if (registro.equiposCaidos) return responder({ message: 'no disponible' }, 503);
      return responder({
        acciones: [
          { accion: 'INSTALADO_EN_CLIENTE', es_retiro: false, estado_g1: 'Instalado en cliente' },
          { accion: 'RETIRADO_A_BODEGA', es_retiro: true, estado_g1: 'En bodega' },
          { accion: 'RETIRADO_PARA_DIAGNOSTICO', es_retiro: true, estado_g1: 'En revisión' },
          { accion: 'BAJA_EN_TERRENO', es_retiro: true, estado_g1: 'Dado de baja' },
        ],
        diagnosticos: ['No enciende', 'Sin señal óptica', 'Daño físico visible', 'Causa desconocida', 'Otro'],
        diagnostico_por_defecto: 'Causa desconocida',
      });
    }
    // Con al menos un material la vista dibuja los contadores - / +, que es
    // lo que mide la prueba de tamano tactil.
    if (ruta === '/api/ordenes/materiales') return responder([
      { id_tipo_equipo: 3, nombre: 'Conector SC/APC', categoria: 'Fibra', requiere_serie_individual: false, stock: { cantidad_disponible: 12 } },
    ]);
    if (ruta === '/api/ordenes/categorias-falla' || ruta === '/api/auth/usuarios') return responder([]);
    if (ruta === '/api/ordenes/tecnicos') return responder(registro.tecnicos);
    // --- RF-45: panel de OT detenidas ---
    // --- RF-46: umbral de desconexion configurable ---
    if (ruta === '/api/configuracion') {
      if (req.method() === 'PATCH') {
        const v = req.postDataJSON().umbral_desconexion_min;
        registro.configuracion.guardados.push(v);
        registro.configuracion.umbral = v;
      }
      const u = registro.configuracion.umbral;
      return responder({
        id_empresa: 1, nombre: 'FiNet', umbral_desconexion_min: u,
        umbral_vigente: u ?? 30, umbral_por_defecto: 30, umbral_min: 10, umbral_max: 120,
      });
    }
    if (ruta === '/api/notificaciones/opciones') return responder({
      canales: ['SMS'], tipos_evento: ['FALLA'], variables: ['zona'],
      horas_ot_inactiva: 24, envio_real_disponible: false,
    });
    if (ruta === '/api/notificaciones/plantillas') return responder(registro.plantillas);
    // --- RF-42: aviso a clientes afectados ---
    if (ruta === '/api/monitoreo/alertas/resumen') return responder({ total_abiertas: registro.alertas.length, por_tipo: {} });
    if (ruta === '/api/monitoreo/alertas/facetas') return responder({ zonas: [], cajas: [] });
    if (ruta === '/api/monitoreo/alertas') return responder(registro.alertas);
    if (/alertas\/\d+\/destinatarios$/.test(ruta)) return responder(registro.destinatarios);
    if (/alertas\/\d+\/notificar$/.test(ruta)) {
      const cuerpo = req.postDataJSON();
      registro.avisos.push({ id_alerta: Number(ruta.split('/').at(-2)), ...cuerpo });
      const ds = registro.destinatarios?.destinatarios ?? [];
      return responder({
        id_alerta: Number(ruta.split('/').at(-2)),
        destinatarios: ds.length,
        enviadas: ds.filter((d: any) => d.contactable && !d.ya_avisado).length,
        sin_contacto: ds.filter((d: any) => !d.contactable).length,
        ya_avisados: ds.filter((d: any) => d.ya_avisado).length,
        canal: 'SMS', simulado: true, tiempo_estimado: cuerpo.tiempo_estimado ?? null,
      });
    }
    if (ruta === '/api/notificaciones/ot-detenidas') return responder(registro.detenidas);
    if (/\/notificaciones\/ot-detenidas\/\d+\/descartar$/.test(ruta)) {
      const id = Number(ruta.split('/').at(-2));
      registro.descartadas.push(id);
      registro.detenidas = registro.detenidas.filter((o) => o.id_ot !== id);
      return responder({ id_ot: id, descartada_en: new Date().toISOString(), reaparece_en: new Date().toISOString(), horas_silencio: 48 });
    }
    if (/\/ordenes\/\d+\/reasignar$/.test(ruta)) {
      registro.reasignaciones.push({ id_ot: Number(ruta.split('/').at(-2)), ...req.postDataJSON() });
      registro.detenidas = [];
      return responder(ot);
    }
    if (/\/ordenes\/\d+\/prioridad$/.test(ruta)) {
      const id = Number(ruta.split('/').at(-2));
      registro.prioridades.push({ id_ot: id, ...req.postDataJSON() });
      registro.detenidas = registro.detenidas.map((o) => (o.id_ot === id ? { ...o, prioridad: 'CRITICA' } : o));
      return responder(ot);
    }
    if (ruta === '/api/ordenes') return responder({ data: [ot], page: 1, limit: 20, total: 1 });
    if (/\/ordenes\/\d+\/foto$/.test(ruta)) {
      registro.fotos++;
      if (registro.modo === 'pendiente') { registro.pendientes.push(route); return; }
      if (registro.modo === 'error') return responder({ message: 'Cloudinary no está configurado. No se puede subir evidencia.' }, 503);
      return responder({ url_cloudinary: remota, formato: 'png', tamano_kb: 1 }, 201);
    }
    if (/\/ordenes\/\d+\/cerrar$/.test(ruta)) { registro.cierres.push(req.postDataJSON()); return responder({ ...ot, estado: 'COMPLETADA' },201); }
    if (/\/ordenes\/\d+\/estado$/.test(ruta)) {
      registro.estados.push(req.postDataJSON());
      if (registro.estadoFalla) return responder({ message: 'Sin conexión con el servidor' }, 503);
      return responder({ ...ot, estado: req.postDataJSON().estado });
    }
    if (/\/ordenes\/\d+$/.test(ruta)) return responder({ ...ot, id_ot: Number(ruta.split('/').pop()) });
    // Dashboard no participa en estas pruebas. No se hace ninguna petición real al backend.
    return responder({ message: 'Sin datos de prueba para esta vista' }, 400);
  });
  return registro;
}
async function login(page: Page, rol = 'tecnico') {
  await page.goto('/login');
  // El HTML llega antes de que Svelte hidrate el formulario. Esperar una
  // interacción real evita que el navegador haga un submit nativo prematuro.
  await expect(async () => {
    await page.getByRole('button', { name: 'Mostrar contraseña' }).click();
    await expect(page.getByRole('button', { name: 'Ocultar contraseña' })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10000 });
  await page.getByLabel('Usuario', { exact: true }).fill(rol + '.prueba');
  await page.getByLabel('Contraseña', { exact: true }).fill('PruebaLocal123!');
  await page.getByRole('button', { name: 'Ingresar al Sistema' }).click();
  await expect(page).toHaveURL(rol === 'tecnico' ? /\/terreno$/ : /\/dashboard$/);
}
async function urls(page: Page) {
  return page.evaluate(() => (window as unknown as { urlsDePrueba: { creadas: string[]; liberadas: string[] } }).urlsDePrueba);
}

test('miniaturas conservan URLs históricas o no transformables', () => {
  expect(urlMiniaturaEvidencia(remota)).toContain('/image/upload/f_auto,q_auto,w_128,h_128,c_fill/v1/');
  for (const original of ['data:image/png;base64,YWJj', 'https://example.com/image/upload/foto.jpg', 'https://res.cloudinary.com/demo/image/upload/s--firma--/v1/foto.jpg', '/foto.jpg']) {
    expect(urlMiniaturaEvidencia(original)).toBe(original);
  }
});
test('paginación de clientes conserva mensajes y permite ir y volver', async ({ page }, info) => {
  await preparar(page); await login(page, 'admin'); await page.goto('/admin/clientes');
  await expect(page.getByText('Cliente 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '← Anterior' })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('clientes-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Siguiente →' }).click();
  await expect(page.getByText('Cliente 21', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Siguiente →' })).toBeDisabled();
  await page.getByRole('button', { name: '← Anterior' }).click();
  await expect(page.getByText('Cliente 1', { exact: true })).toBeVisible();
});
test('TECNICO no consulta Clientes mediante navegación directa', async ({ page }) => {
  const registro = await preparar(page); await login(page);
  for (const ruta of ['/admin/clientes', '/admin/clientes/12345678-5', '/admin/clientes/nuevo']) {
    await page.goto(ruta); await expect(page).toHaveURL(/\/terreno$/);
  }
  expect(registro.clientes).toBe(0);
  await page.goto('/admin/ot');
  await expect(page.getByRole('link', { name: 'Clientes', exact: true })).toHaveCount(0);
});
test('historial usa miniaturas diferidas con formato y calidad automáticos', async ({ page }, info) => {
  await preparar(page); await login(page, 'admin'); await page.goto('/admin/clientes/12345678-5');
  await page.getByRole('row').filter({ hasText: 'COMPLETADA' }).click();
  const foto = page.getByAltText('evidencia', { exact: true });
  await expect(foto).toHaveAttribute('src', /f_auto,q_auto,w_128,h_128,c_fill/);
  await expect(foto).toHaveAttribute('loading', 'lazy');
  await foto.scrollIntoViewIfNeeded();
  await expect(foto).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('historial-desktop.png'), fullPage: true });
});
test('eliminar una foto anterior durante otra subida conserva la respuesta correcta', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const registro = await preparar(page); await login(page); await page.goto('/terreno/cerrar/1');
  const input = page.locator('input[type=file]');
  await input.setInputFiles(archivo);
  await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toBeEnabled();
  registro.modo = 'pendiente'; await input.setInputFiles({ ...archivo, name: 'segunda.png' });
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(2);
  await expect.poll(() => registro.pendientes.length).toBe(1);
  await page.getByRole('button', { name: 'Eliminar evidencia 1' }).click();
  await registro.pendientes[0].fulfill({ json: { url_cloudinary: remota, formato: 'png', tamano_kb: 1 } });
  await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toBeEnabled();
  const estado = await urls(page);
  await expect(page.locator('img[src^="blob:"]')).toHaveAttribute('src', estado.creadas[1]);
  expect(estado.liberadas).toContain(estado.creadas[0]); expect(registro.imagenesRemotas).toBe(0);
  await page.screenshot({ path: info.outputPath('evidencia-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Volver a terreno' }).click();
  await expect(page).toHaveURL(/\/terreno$/);
  expect((await urls(page)).liberadas).toContain(estado.creadas[1]);
});
test('una subida fallida libera la previsualización y muestra el error', async ({ page }, info) => {
  const registro = await preparar(page); registro.modo = 'error'; await login(page); await page.goto('/terreno/cerrar/1');
  await page.locator('input[type=file]').setInputFiles(archivo);
  await expect(page.getByRole('alert')).toContainText('Cloudinary no está configurado');
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
  const estado = await urls(page); expect(estado.liberadas).toContain(estado.creadas[0]);
  await page.screenshot({ path: info.outputPath('subida-error.png'), fullPage: true });
});
test('salir durante una subida cancela el lote y libera sus object URLs', async ({ page }) => {
  const registro = await preparar(page); registro.modo = 'pendiente'; await login(page); await page.goto('/terreno/cerrar/1');
  await page.locator('input[type=file]').setInputFiles([archivo, { ...archivo, name: 'segunda.png' }]);
  await expect.poll(() => registro.pendientes.length).toBe(1);
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Volver a terreno' }).click();
  await expect(page).toHaveURL(/\/terreno$/);
  const estado = await urls(page); expect(estado.creadas).toHaveLength(1); expect(estado.liberadas).toContain(estado.creadas[0]);
  await registro.pendientes[0].fulfill({ json: { url_cloudinary: remota, formato: 'png', tamano_kb: 1 } }).catch(() => undefined);
  expect(registro.fotos).toBe(1);
});

test('el cierre envía la URL remota y libera la previsualización al terminar', async ({ page }) => {
  const registro = await preparar(page); await login(page); await page.goto('/terreno/cerrar/1');
  await page.locator('input[type=file]').setInputFiles(archivo);
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.locator('input[type=number]').fill('-21');
  await page.getByRole('button', { name: 'Cerrar OT', exact: true }).click();
  await expect(page).toHaveURL(/\/terreno$/);
  expect(registro.cierres).toHaveLength(1);
  expect(registro.cierres[0]).toMatchObject({ fotos: [{ url_cloudinary: remota, formato: 'png', tamano_kb: 1 }] });
  const estado = await urls(page); expect(estado.liberadas).toContain(estado.creadas[0]);
});
test('el retiro de un equipo viaja con su diagnostico y separado de lo instalado', async ({ page }) => {
  // El acuerdo con G1: los equipos van por numero de serie, y el retiro lleva
  // que le pasa al equipo. Se separan instalados de retirados porque G1 les
  // aplica transiciones distintas.
  const registro = await preparar(page); await login(page); await page.goto('/terreno/cerrar/1');
  await page.locator('input[type=file]').setInputFiles(archivo);
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();

  await page.getByRole('button', { name: '+ Agregar' }).click();
  // Minusculas y simbolos: el formulario normaliza al formato que exige G1.
  await page.locator('#serie-0').fill('altx retirada/01');
  await expect(page.locator('#serie-0')).toHaveValue('ALTXRETIRADA01');
  await page.locator('#accion-0').selectOption('RETIRADO_PARA_DIAGNOSTICO');
  await page.locator('#diag-0').selectOption('Sin señal óptica');

  await page.getByRole('button', { name: '+ Agregar' }).click();
  await page.locator('#serie-1').fill('ONT-NUEVA-02');
  await page.locator('#accion-1').selectOption('INSTALADO_EN_CLIENTE');
  // La instalacion no pregunta diagnostico: no hay nada que diagnosticar.
  await expect(page.locator('#diag-1')).toHaveCount(0);

  await page.locator('input[type=number]').fill('-21');
  await page.getByRole('button', { name: 'Cerrar OT', exact: true }).click();
  await expect(page).toHaveURL(/\/terreno$/);

  expect(registro.cierres[0]).toMatchObject({
    equipos_retirados: [{
      numero_serie: 'ALTXRETIRADA01',
      accion: 'RETIRADO_PARA_DIAGNOSTICO',
      diagnostico: 'Sin señal óptica',
    }],
    equipos_instalados: [{ numero_serie: 'ONT-NUEVA-02', accion: 'INSTALADO_EN_CLIENTE' }],
  });
});

test('un retiro sin diagnostico no deja cerrar, y el boton dice que falta', async ({ page }) => {
  // El contrato con G1 acepta el retiro sin diagnostico --asume "Causa
  // desconocida"-- pero el formulario lo exige: el tecnico es el unico que
  // tiene el equipo en la mano. Y el boton no puede quedar gris y mudo.
  await preparar(page); await login(page); await page.goto('/terreno/cerrar/1');
  await page.locator('input[type=file]').setInputFiles(archivo);
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.locator('input[type=number]').fill('-21');

  await page.getByRole('button', { name: '+ Agregar' }).click();
  await page.locator('#serie-0').fill('ALTX-SIN-DIAG');
  await page.locator('#accion-0').selectOption('BAJA_EN_TERRENO');

  await expect(page.getByRole('button', { name: 'Cerrar OT', exact: true })).toBeDisabled();
  await expect(page.getByText(/Para cerrar falta.*diagnostico del equipo 1/)).toBeVisible();

  await page.locator('#diag-0').selectOption('Daño físico visible');
  await expect(page.getByRole('button', { name: 'Cerrar OT', exact: true })).toBeEnabled();
});

test('si no se pueden leer las opciones de equipo, el cierre sigue disponible', async ({ page }) => {
  // Declarar equipos es secundario frente a cerrar la OT. Antes esta llamada
  // estaba dentro del Promise.all de carga y su fallo tumbaba la pantalla
  // entera: el tecnico quedaba sin poder cerrar nada, parado en el domicilio.
  const registro = await preparar(page); registro.equiposCaidos = true;
  await login(page); await page.goto('/terreno/cerrar/1');
  await page.locator('input[type=file]').setInputFiles(archivo);
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();

  await expect(page.getByText(/No se pudieron cargar las opciones de equipos/)).toBeVisible();
  await page.locator('input[type=number]').fill('-21');
  await page.getByRole('button', { name: 'Cerrar OT', exact: true }).click();
  await expect(page).toHaveURL(/\/terreno$/);
  expect(registro.cierres).toHaveLength(1);
});

test('navegar entre dos cierres desmonta el anterior aunque comparta la ruta', async ({ page }) => {
  const registro = await preparar(page); registro.modo = 'pendiente'; await login(page); await page.goto('/terreno/cerrar/1');
  await page.locator('input[type=file]').setInputFiles(archivo);
  await expect.poll(() => registro.pendientes.length).toBe(1);
  // Enlace de prueba para ejercer navegación SPA entre dos IDs de la misma ruta.
  await page.evaluate(() => { const a = document.createElement('a'); a.href='/terreno/cerrar/2'; a.textContent='Otra OT de prueba'; document.body.append(a); });
  await page.getByRole('link', { name: 'Otra OT de prueba' }).click();
  await expect(page.getByText('Cerrar OT #2', { exact: true })).toBeVisible();
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
  const estado = await urls(page); expect(estado.creadas).toHaveLength(1); expect(estado.liberadas).toContain(estado.creadas[0]);
  await registro.pendientes[0].fulfill({ json: { url_cloudinary: remota, formato: 'png', tamano_kb: 1 } }).catch(() => undefined);
});

test('un token vencido devuelve al login en vez de dejar la pantalla con un error', async ({ page }) => {
  // El token dura ocho horas: vencerse en media jornada no es raro. Antes cada
  // cliente de API trataba el 401 como un error cualquiera, la pantalla mostraba
  // "Error en la solicitud" y el usuario quedaba mirando una vista vacia sin
  // entender por que. `authStore.checkAuth()` no ayudaba: corre al montar la
  // aplicacion, no despues.
  const registro = await preparar(page);
  await login(page, 'admin');
  await page.goto('/admin/clientes');
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();

  // A partir de aca el Controlador responde 401, como si el token hubiera vencido.
  registro.tokenVencido = true;
  await page.goto('/admin/clientes');

  await expect(page).toHaveURL(/\/login$/);
});

test('sin sesión no se montan las vistas de Clientes antes de redirigir', async ({ page }) => {
  const registro = await preparar(page);
  for (const ruta of ['/admin/clientes', '/admin/clientes/12345678-5', '/admin/clientes/nuevo']) {
    await page.goto(ruta);
    await expect(page).toHaveURL(/\/login$/);
  }
  expect(registro.clientes).toBe(0);
});

for (const respuestaRecibida of [false, true]) {
  test(`cancelar la segunda foto continúa el lote (${respuestaRecibida ? 'respuesta ya recibida' : 'petición pendiente'})`, async ({ page }) => {
    const registro = await preparar(page);
    await login(page);
    await page.goto('/terreno/cerrar/1');
    if (respuestaRecibida) {
      await page.evaluate(() => {
        const original = window.fetch;
        let subidas = 0;
        window.fetch = async (...args) => {
          const res = await original(...args);
          if (!String(args[0]).endsWith('/foto') || ++subidas !== 2) return res;
          const leerJson = res.json.bind(res);
          res.json = async () => {
            const datos = await leerJson();
            // Retiene el JSON ya leído: abortar ahora no rechaza fetch,
            // aunque la foto todavía aparece en subida en la interfaz.
            await new Promise<void>(resolve => {
              Object.assign(window, { entregarFotoDePrueba: resolve });
            });
            return datos;
          };
          return res;
        };
      });
    } else {
      await page.route('**/api/ordenes/1/foto', async route => {
        if (registro.fotos === 1) registro.modo = 'pendiente';
        await route.fallback();
      });
    }
    await page.locator('input[type=file]').setInputFiles([
      archivo,
      { ...archivo, name: 'segunda.png' },
      { ...archivo, name: 'tercera.png' },
      { ...archivo, name: 'cuarta.png' },
    ]);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(2);
    if (respuestaRecibida) {
      await expect.poll(() => page.evaluate(() => typeof (window as unknown as { entregarFotoDePrueba?: () => void }).entregarFotoDePrueba)).toBe('function');
    } else {
      await expect.poll(() => registro.pendientes.length).toBe(1);
      registro.modo = 'ok';
    }
    await page.getByRole('button', { name: 'Eliminar evidencia 2' }).click();
    if (respuestaRecibida) {
      await page.evaluate(() => (window as unknown as { entregarFotoDePrueba: () => void }).entregarFotoDePrueba());
    }
    await expect.poll(() => registro.fotos).toBe(4);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const estado = await urls(page);
    expect(estado.creadas).toHaveLength(4);
    expect(estado.liberadas).toContain(estado.creadas[1]);
    const visibles = await page.locator('img[src^="blob:"]').evaluateAll(imgs => imgs.map(img => img.getAttribute('src')));
    expect(visibles).toEqual([estado.creadas[0], estado.creadas[2], estado.creadas[3]]);
    await page.getByRole('button', { name: 'Volver a terreno' }).click();
    await expect(page).toHaveURL(/\/terreno$/);
    expect((await urls(page)).liberadas).toEqual(expect.arrayContaining(estado.creadas));
    if (!respuestaRecibida) await registro.pendientes[0].abort().catch(() => undefined);
  });
}

test('cliente ausente pide la observacion en la vista y no en un dialogo del navegador', async ({ page }) => {
  // Antes esto era un window.prompt: el dialogo nativo no dice cuanto texto
  // exige el Controlador, asi que el tecnico escribia de menos, perdia lo
  // escrito y solo veia un error en rojo. Si alguien vuelve a poner un
  // prompt, el manejador de abajo lo delata haciendo fallar la prueba.
  const registro = await preparar(page);
  let hubieraSidoUnDialogoNativo = false;
  page.on('dialog', async (d) => { hubieraSidoUnDialogoNativo = true; await d.dismiss(); });

  await login(page);
  await page.getByRole('button', { name: 'Cliente ausente' }).click();

  const registrar = page.getByRole('button', { name: 'Registrar cliente ausente' });
  await expect(registrar).toBeDisabled();
  await expect(page.getByText('Faltan 10 caracteres')).toBeVisible();

  // Con menos del minimo sigue bloqueado, y dice exactamente cuanto falta.
  await page.locator('#obs-ausente').fill('no estaba');
  await expect(page.getByText('Falta 1 carácter')).toBeVisible();
  await expect(registrar).toBeDisabled();

  await page.locator('#obs-ausente').fill('Se toco el timbre tres veces y no hubo respuesta');
  await expect(registrar).toBeEnabled();
  await registrar.click();

  await expect(page.getByRole('dialog')).toBeHidden();
  expect(registro.estados[0]).toMatchObject({
    estado: 'PENDIENTE_CLIENTE_AUSENTE',
    obs_cliente_ausente: 'Se toco el timbre tres veces y no hubo respuesta',
  });
  expect(hubieraSidoUnDialogoNativo).toBe(false);
});

test('si falla el envio de cliente ausente, la observacion escrita no se pierde', async ({ page }) => {
  // El caso real: el tecnico esta en terreno, con mala senal. Volver a
  // escribir la observacion de cero es justo lo que no puede pasar.
  const registro = await preparar(page);
  registro.estadoFalla = true;
  await login(page);

  await page.getByRole('button', { name: 'Cliente ausente' }).click();
  await page.locator('#obs-ausente').fill('Porton cerrado, nadie responde el citofono');
  await page.getByRole('button', { name: 'Registrar cliente ausente' }).click();

  await expect(page.getByText('Sin conexión con el servidor')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#obs-ausente')).toHaveValue('Porton cerrado, nadie responde el citofono');
});

async function controlesChicos(page: Page) {
  return page.evaluate(() => {
    const fuera: string[] = [];
    for (const e of document.querySelectorAll('button')) {
      const r = e.getBoundingClientRect();
      if (r.width === 0) continue;
      // El area de toque puede venir de un pseudo-elemento que agranda el
      // control sin deformarlo, asi que se mide tambien esa caja.
      const despues = getComputedStyle(e, '::after');
      const extra = despues.content !== 'none' ? Math.abs(parseFloat(despues.top || '0')) * 2 : 0;
      if (r.height + extra < 44) fuera.push((e.textContent || e.getAttribute('aria-label') || '?').trim().slice(0, 24) + ' -> ' + Math.round(r.height + extra) + 'px');
    }
    return fuera;
  });
}

test('los controles de terreno alcanzan el tamano minimo para tocarlos', async ({ page }) => {
  // 44px es el minimo recomendado para un objetivo tactil. Estas pantallas
  // se usan de pie, en la calle y a veces con guantes.
  await preparar(page); await login(page);
  await page.setViewportSize({ width: 390, height: 780 });
  expect(await controlesChicos(page), 'lista del dia').toEqual([]);

  // La hoja de cliente ausente trae sus propios controles.
  await page.getByRole('button', { name: 'Cliente ausente' }).click();
  expect(await controlesChicos(page), 'hoja de cliente ausente').toEqual([]);
  await page.keyboard.press('Escape');

  // Cierre de OT: los contadores de material y el borrar foto eran los mas
  // chicos de todos, con 32 y 24 px.
  await page.goto('/terreno/cerrar/1');
  await page.locator('input[type=file]').setInputFiles(archivo);
  expect(await controlesChicos(page), 'cierre paso 1, con evidencia').toEqual([]);
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  expect(await controlesChicos(page), 'cierre paso 2').toEqual([]);
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  expect(await controlesChicos(page), 'cierre paso 3').toEqual([]);
});

test('RF-09: el listado avisa de las OT con mas de 30 dias sin reagendar', async ({ page }) => {
  // Antes la antiguedad se mostraba y nada mas: una OT de 40 dias se veia
  // igual que una de 3, solo con otro numero. El RF pide alertar.
  //
  // El umbral lo decide el Controlador y viaja en `alerta_sin_reagendar`; la
  // Vista no lo recalcula, para que el listado y el dashboard no discrepen.
  await preparar(page);
  await page.route('http://127.0.0.1:3000/api/ordenes?*', async (route) =>
    route.fulfill({
      json: {
        data: [
          { ...ot, id_ot: 41, estado: 'PENDIENTE_CLIENTE_AUSENTE', dias_sin_reagendar: 40, alerta_sin_reagendar: true },
          { ...ot, id_ot: 42, estado: 'PENDIENTE_CLIENTE_AUSENTE', dias_sin_reagendar: 3, alerta_sin_reagendar: false },
        ],
        page: 1, limit: 20, total: 2,
      },
    }),
  );

  await login(page, 'admin');
  await page.goto('/admin/ot');

  await expect(page.getByText('mas de 30 dias sin reagendarse')).toBeVisible();
  await expect(page.getByText('40 dias sin reagendar')).toBeVisible();
  // La que no llega al umbral se sigue viendo, pero sin alarma.
  await expect(page.getByText('3 dias sin reagendar')).toBeVisible();

  const avisos = page.locator('span.border-red-200', { hasText: 'sin reagendar' });
  await expect(avisos).toHaveCount(1);
});

test('RF-45: el panel deja reasignar, marcar CRITICA y descartar la alerta', async ({ page }) => {
  // Antes la pantalla solo ofrecia "Abrir". Las dos acciones que el RF nombra
  // no existian, y una alerta ya vista seguia apareciendo igual en cada carga.
  const registro = await preparar(page);
  registro.tecnicos = [
    { id_usuario: 8, nombre_completo: 'Ana Soto' },
    { id_usuario: 9, nombre_completo: 'Luis Vera' },
  ];
  registro.detenidas = [
    { id_ot: 31, tipo_ot: 'REPARACION', estado: 'ASIGNADA', prioridad: 'MEDIA', cliente: 'Cliente A', tecnico: 'Ana Soto', sin_movimiento_desde: new Date().toISOString(), horas_detenida: 30, sin_tecnico: false },
    { id_ot: 32, tipo_ot: 'INSTALACION', estado: 'EN_CURSO', prioridad: 'ALTA', cliente: 'Cliente B', tecnico: null, sin_movimiento_desde: new Date().toISOString(), horas_detenida: 80, sin_tecnico: true },
  ];

  await login(page, 'admin');
  await page.goto('/admin/notificaciones');
  await page.getByRole('tab', { name: /OT detenidas/ }).click();

  // Marcar CRITICA: la accion mas directa del RF.
  await page.getByRole('row', { name: /#31/ }).getByRole('button', { name: 'Marcar CRÍTICA' }).click();
  await expect.poll(() => registro.prioridades).toEqual([{ id_ot: 31, prioridad: 'CRITICA' }]);
  // Ya marcada, el boton no se vuelve a ofrecer para esa fila.
  await expect(page.getByRole('row', { name: /#31/ }).getByRole('button', { name: 'Marcar CRÍTICA' })).toHaveCount(0);

  // Descartar: la fila se va de la lista.
  await page.getByRole('row', { name: /#32/ }).getByRole('button', { name: 'Descartar' }).click();
  await expect.poll(() => registro.descartadas).toEqual([32]);
  await expect(page.getByText('vuelve en 48 horas')).toBeVisible();

  // Reasignar: se pregunta a quien antes de hacerlo.
  await page.getByRole('row', { name: /#31/ }).getByRole('button', { name: 'Reasignar' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole('button', { name: 'Reasignar' })).toBeDisabled();
  await dialogo.getByLabel('Nuevo técnico').selectOption('9');
  await dialogo.getByRole('button', { name: 'Reasignar' }).click();

  await expect.poll(() => registro.reasignaciones).toEqual([{ id_ot: 31, id_tecnico: 9 }]);
});

test('RF-45: sin lista de tecnicos el panel sigue sirviendo, solo sin reasignar', async ({ page }) => {
  // Degradar en vez de romper: las otras dos acciones no dependen de esa lista.
  const registro = await preparar(page);
  registro.tecnicos = [];
  registro.detenidas = [
    { id_ot: 40, tipo_ot: 'REPARACION', estado: 'ASIGNADA', prioridad: 'MEDIA', cliente: 'Cliente C', tecnico: 'Ana Soto', sin_movimiento_desde: new Date().toISOString(), horas_detenida: 26, sin_tecnico: false },
  ];

  await login(page, 'admin');
  await page.goto('/admin/notificaciones');
  await page.getByRole('tab', { name: /OT detenidas/ }).click();

  await expect(page.getByRole('button', { name: 'Reasignar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Marcar CRÍTICA' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descartar' })).toBeVisible();
});

test('RF-42: el aviso muestra a quienes alcanza antes de dejar enviarlo', async ({ page }) => {
  // El Controlador estaba completo y faltaba el boton. Y no alcanza con un
  // boton: avisarle a decenas de personas de una vez no se deshace, asi que la
  // lista de destinatarios se mira ANTES, que es para lo que existe ese GET.
  const registro = await preparar(page);
  registro.alertas = [
    { id_alerta: 77, tipo: 'FALLA_CAJA_NAP', clave_caja: 'OLT1|CTO-15', zona: 'ZONA 3',
      creada_en: new Date().toISOString(), resuelta: false, afectados: 3, ot_generada: null },
  ];
  registro.destinatarios = {
    alerta: { id_alerta: 77, tipo: 'FALLA_CAJA_NAP', clave_caja: 'OLT1|CTO-15' },
    es_agregada: true,
    destinatarios: [
      { numero_serie: 'A1', zona: 'ZONA 3', caja: 'CTO-15', id_cliente: 1, nombre: 'Ana Rojas', telefono: '911111111', email: null, contactable: true, ya_avisado: false },
      { numero_serie: 'A2', zona: 'ZONA 3', caja: 'CTO-15', id_cliente: 2, nombre: 'Beto Diaz', telefono: null, email: null, contactable: false, ya_avisado: false },
      { numero_serie: 'A3', zona: 'ZONA 3', caja: 'CTO-15', id_cliente: 3, nombre: 'Cami Luna', telefono: '933333333', email: null, contactable: true, ya_avisado: true },
    ],
  };

  await login(page, 'admin');
  await page.goto('/admin/alertas');
  await page.getByRole('button', { name: 'Avisar a clientes' }).first().click();

  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();

  // Los tres estados se distinguen: a quien se le avisa, quien no tiene
  // contacto y a quien ya se le aviso antes.
  await expect(dialogo.getByText('Ana Rojas')).toBeVisible();
  await expect(dialogo.getByRole('cell', { name: 'sin contacto' })).toBeVisible();
  await expect(dialogo.getByRole('cell', { name: 'ya avisado' })).toBeVisible();

  // Mientras no haya plantilla elegida no se puede mandar nada.
  const enviar = dialogo.getByRole('button', { name: /Avisar a 1 cliente/ });
  await expect(enviar).toBeDisabled();
  expect(registro.avisos).toEqual([]);

  // Se advierte que el envio es simulado.
  await expect(dialogo.getByText(/no le llega nada/)).toBeVisible();

  await dialogo.getByLabel('Plantilla').selectOption('5');
  await dialogo.getByLabel(/Demora estimada/).fill('2 a 4 horas');
  await expect(enviar).toBeEnabled();
  await enviar.click();

  // El tiempo de ESTE incidente viaja y manda sobre el de la plantilla.
  await expect.poll(() => registro.avisos).toEqual([
    { id_alerta: 77, id_plantilla: 5, tiempo_estimado: '2 a 4 horas' },
  ]);

  // Y se dice que paso, no solo "listo".
  await expect(dialogo.getByText('1 aviso registrado')).toBeVisible();
  await expect(dialogo.getByText(/Ya avisados antes/)).toBeVisible();
  await expect(dialogo.getByText(/Sin teléfono ni correo/)).toBeVisible();
});

test('RF-42: sin nadie a quien avisar, el boton lo dice en vez de quedar mudo', async ({ page }) => {
  // Todos los alcanzados ya fueron avisados o no tienen contacto.
  const registro = await preparar(page);
  registro.alertas = [
    { id_alerta: 78, tipo: 'FALLA_CAJA_NAP', clave_caja: 'OLT1|CTO-20', zona: 'ZONA 1',
      creada_en: new Date().toISOString(), resuelta: false, afectados: 1, ot_generada: null },
  ];
  registro.destinatarios = {
    alerta: { id_alerta: 78, tipo: 'FALLA_CAJA_NAP', clave_caja: 'OLT1|CTO-20' },
    es_agregada: true,
    destinatarios: [
      { numero_serie: 'B1', zona: 'ZONA 1', caja: 'CTO-20', id_cliente: 4, nombre: 'Dani Paz', telefono: null, email: null, contactable: false, ya_avisado: false },
    ],
  };

  await login(page, 'admin');
  await page.goto('/admin/alertas');
  await page.getByRole('button', { name: 'Avisar a clientes' }).first().click();

  const dialogo = page.getByRole('dialog');
  await expect(dialogo.getByRole('button', { name: 'No hay a quién avisar' })).toBeDisabled();
  expect(registro.avisos).toEqual([]);
});

test('RF-42: se advierte cuando la alerta no es una falla de caja', async ({ page }) => {
  // POTENCIA_DEGRADANDOSE se agrupa en el panel, asi que el boton aparece,
  // pero son clientes que TODAVIA tienen servicio: el Controlador no la marca
  // como agregada y la Vista lo dice antes de dejar avisar. Avisarle a alguien
  // de una falla que no esta sufriendo es el aviso que no hay como desdecir.
  const registro = await preparar(page);
  registro.alertas = [
    { id_alerta: 79, tipo: 'POTENCIA_DEGRADANDOSE', clave_caja: 'OLT1|CTO-30', zona: 'ZONA 2',
      creada_en: new Date().toISOString(), resuelta: false, afectados: 2, ot_generada: null },
  ];
  registro.destinatarios = {
    alerta: { id_alerta: 79, tipo: 'POTENCIA_DEGRADANDOSE', clave_caja: 'OLT1|CTO-30' },
    es_agregada: false,
    destinatarios: [
      { numero_serie: 'C1', zona: 'ZONA 2', caja: 'CTO-30', id_cliente: 5, nombre: 'Eva Mora', telefono: '955555555', email: null, contactable: true, ya_avisado: false },
    ],
  };

  await login(page, 'admin');
  await page.goto('/admin/alertas');
  await page.getByRole('button', { name: 'Avisar a clientes' }).first().click();

  const dialogo = page.getByRole('dialog');
  await expect(dialogo.getByText(/todavía tengan servicio/)).toBeVisible();

  // Se advierte, pero no se bloquea: la decision sigue siendo del jefe tecnico.
  await dialogo.getByLabel('Plantilla').selectOption('5');
  await dialogo.getByRole('button', { name: /Avisar a 1 cliente/ }).click();

  await expect.poll(() => registro.avisos.map((a) => a.id_alerta)).toEqual([79]);
});

test('RF-46: el administrador puede configurar el umbral, dentro del rango del RF', async ({ page }) => {
  // El motor ya leia este valor y caia al default si estaba en null, pero no
  // habia forma de escribirlo: sin endpoint ni pantalla, el unico camino era
  // SQL directo. O sea que el RF no estaba cumplido.
  const registro = await preparar(page);

  await login(page, 'admin');
  await page.goto('/admin/configuracion');

  // Con null se dice cual rige de verdad, no se deja el campo mudo.
  await expect(page.getByText(/Vacío usa el valor del sistema: 30 minutos/)).toBeVisible();

  const guardar = page.getByRole('button', { name: 'Guardar' });
  // Sin cambios no hay nada que guardar.
  await expect(guardar).toBeDisabled();

  // Fuera del rango que fija el RF: se dice cual es y no se deja guardar.
  await page.getByLabel('Minutos sin señal').fill('9');
  await expect(page.getByText(/entre 10 y 120 minutos/)).toBeVisible();
  await expect(guardar).toBeDisabled();

  await page.getByLabel('Minutos sin señal').fill('121');
  await expect(guardar).toBeDisabled();
  expect(registro.configuracion.guardados).toEqual([]);

  await page.getByLabel('Minutos sin señal').fill('45');
  await expect(guardar).toBeEnabled();
  await guardar.click();

  await expect.poll(() => registro.configuracion.guardados).toEqual([45]);
  await expect(page.getByText(/se levantan a los 45 minutos/)).toBeVisible();
});

test('RF-46: se puede volver al valor del sistema', async ({ page }) => {
  // Vacio significa "usar el del sistema", no cero. Sin ese camino de vuelta,
  // una empresa que configuro un valor no podria deshacerlo desde la pantalla.
  const registro = await preparar(page);
  registro.configuracion.umbral = 45;

  await login(page, 'admin');
  await page.goto('/admin/configuracion');

  await expect(page.getByText(/Hoy se aplican 45 minutos/)).toBeVisible();
  await page.getByRole('button', { name: 'Volver al del sistema' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect.poll(() => registro.configuracion.guardados).toEqual([null]);
});

test('RF-46: la pantalla es solo de ADMIN', async ({ page }) => {
  // Escribir el umbral es de ADMIN, que es lo que dice el RF. Un TECNICO que
  // llega por la URL directa no debe ver el formulario.
  await preparar(page);
  await login(page, 'tecnico');
  await page.goto('/admin/configuracion');

  await expect(page).toHaveURL(/\/(terreno|dashboard)/);
  await expect(page.getByLabel('Minutos sin señal')).toHaveCount(0);
});

test('ninguna navegacion interna apunta fuera de su area', async () => {
  // MOD RF-34 movio las pantallas a /admin y /terreno. Cinco navegaciones se
  // quedaron con la ruta vieja: "Ver ficha", "Ver" de una OT, las que van
  // despues de crear un cliente o una OT, y el rebote por rol de /admin/clientes.
  // Todas llevaban a un 404.
  //
  // Es un fallo silencioso: no hay error en consola ni prueba que lo note,
  // solo un 404 cuando alguien hace clic. Por eso se revisa el codigo entero.
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  const archivos: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (e.endsWith('.svelte')) archivos.push(p);
    }
  };
  recorrer('src/routes');

  // Las rutas de primer nivel que existen de verdad.
  const areas = ['/admin', '/terreno', '/login', '/cambiar-password'];
  const malas: string[] = [];

  for (const archivo of archivos) {
    const texto = readFileSync(archivo, 'utf-8');
    // Se toma el argumento completo de goto(...) y se revisan TODAS las rutas
    // literales que aparezcan adentro. Mirar solo la que va pegada al parentesis
    // dejaba pasar los ternarios --goto(rol === 'TECNICO' ? '/terreno' : '/dashboard')--,
    // que es como se escribe el rebote por rol en cinco pantallas.
    for (const llamada of texto.matchAll(/goto\(([^)]*)\)/g)) {
      for (const m of llamada[1].matchAll(/[`'"](\/[^`'"$]*)/g)) {
        const destino = m[1];
        if (!areas.some((a) => destino === a || destino.startsWith(a + '/'))) {
          malas.push(`${archivo.replace(/\\/g, '/')} -> goto('${destino}…')`);
        }
      }
    }
    for (const m of texto.matchAll(/href="(\/[^"{}#]*)"/g)) {
      const destino = m[1];
      if (destino.includes('.')) continue;           // /logo_finet.png y similares
      if (!areas.some((a) => destino === a || destino.startsWith(a + '/'))) {
        malas.push(`${archivo.replace(/\\/g, '/')} -> href="${destino}"`);
      }
    }
  }

  expect(malas, 'navegaciones que no caen en un area valida').toEqual([]);
});
