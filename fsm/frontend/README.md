# Frontend FSM

SvelteKit, Tailwind y TypeScript. Configurar PUBLIC_API_URL con el backend local, según [README general](../../README.md).

~~~sh
npm install
npm run check
npm run build
~~~

## Pruebas de navegador

~~~sh
npx playwright install chromium
npm run test:e2e
~~~

Para usar una instalación local de Edge en PowerShell:

~~~powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e
~~~

Playwright inicia su propio Vite en 127.0.0.1:5173; el puerto debe estar libre. Las peticiones HTTP de la API y las imágenes de Cloudinary se interceptan con datos de prueba, y el login usa una sesión sintética creada desde la pantalla. No se usan secretos, sesiones existentes ni bases compartidas.

Las pruebas verifican paginación, acceso a Clientes, miniaturas, liberación de object URLs al eliminar/fallar/salir y navegación con subidas pendientes. Los screenshots se guardan en test-results. Los tests de backend verifican por separado los guards, servicios y persistencia simulada; los tests del navegador verifican el comportamiento de la interfaz.
