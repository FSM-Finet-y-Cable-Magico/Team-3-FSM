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
  const registro = { cierres: [] as unknown[], clientes: 0, fotos: 0, imagenesRemotas: 0, pendientes: [] as Route[], modo: 'ok' };
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
    if (ruta === '/api/ordenes/materiales' || ruta === '/api/ordenes/categorias-falla' || ruta === '/api/ordenes/tecnicos' || ruta === '/api/auth/usuarios') return responder([]);
    if (ruta === '/api/ordenes') return responder({ data: [ot], page: 1, limit: 20, total: 1 });
    if (/\/ordenes\/\d+\/foto$/.test(ruta)) {
      registro.fotos++;
      if (registro.modo === 'pendiente') { registro.pendientes.push(route); return; }
      if (registro.modo === 'error') return responder({ message: 'Cloudinary no está configurado. No se puede subir evidencia.' }, 503);
      return responder({ url_cloudinary: remota, formato: 'png', tamano_kb: 1 }, 201);
    }
    if (/\/ordenes\/\d+\/cerrar$/.test(ruta)) { registro.cierres.push(req.postDataJSON()); return responder({ ...ot, estado: 'COMPLETADA' },201); }
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
