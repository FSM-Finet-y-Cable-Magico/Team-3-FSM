import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Todo endpoint tiene que declarar su `@Roles(...)` o su `@Public()`.
 *
 * `RolesGuard` es global y falla cerrado: un handler sin `@Roles` responde 403
 * a TODO el mundo, incluido el ADMIN. Eso lo vuelve un error silencioso --el
 * codigo compila, las pruebas del servicio pasan, y el endpoint queda muerto--
 * y asi se fue a produccion `GET /monitoreo/alertas/resumen`: al insertar otro
 * endpoint encima, su `@Roles` quedo pegado al handler nuevo y el viejo se
 * quedo sin ninguno.
 *
 * Se revisa el TEXTO de los controladores en vez de la metadata porque el
 * error es de ubicacion del decorador, y para verlo hay que mirar el orden en
 * que estan escritos.
 */
describe('todos los endpoints declaran sus roles', () => {
  const RAIZ = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

  const controladores = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) return controladores(ruta);
      return e.isFile() && e.name.endsWith('.controller.ts') ? [ruta] : [];
    });

  it('ningun handler queda sin @Roles ni @Public', () => {
    const sinDeclarar: string[] = [];

    for (const archivo of controladores(RAIZ)) {
      const texto = readFileSync(archivo, 'utf-8');
      // Un `@Public()` sobre la clase cubre a todos sus handlers: es el caso de
      // los endpoints de integracion, que se protegen con la API key.
      const claseAbierta = /@Public\(\)[\s\S]{0,200}?@Controller\(/.test(texto);
      if (claseAbierta) continue;

      const lineas = texto.split('\n');
      lineas.forEach((linea, i) => {
        if (!/^\s*@(Get|Post|Patch|Put|Delete)\(/.test(linea)) return;

        // Se mira hacia arriba saltando comentarios y otros decoradores, hasta
        // encontrar `@Roles`/`@Public` o algo que corte la cadena.
        for (let j = i - 1; j >= 0; j--) {
          const s = lineas[j].trim();
          if (s.startsWith('@Roles') || s.startsWith('@Public')) return;
          if (s === '' || s.startsWith('//') || s.startsWith('*') || s.startsWith('/*') || s.startsWith('@')) {
            continue;
          }
          break;
        }
        sinDeclarar.push(`${archivo.split(/[\\/]/).slice(-2).join('/')}:${i + 1} ${linea.trim()}`);
      });
    }

    expect(sinDeclarar).toEqual([]);
  });

  it('no hay dos @Roles seguidos, que es como se pierde uno', () => {
    // El sintoma exacto del error: al insertar un endpoint entre el decorador y
    // su handler, quedan dos `@Roles` juntos y el de mas arriba no protege nada.
    const duplicados: string[] = [];
    for (const archivo of controladores(RAIZ)) {
      const texto = readFileSync(archivo, 'utf-8');
      if (/@Roles\([^)]*\)\s*(?:\/\*\*[\s\S]*?\*\/\s*)?@Roles\(/.test(texto)) {
        duplicados.push(archivo.split(/[\\/]/).slice(-2).join('/'));
      }
    }
    expect(duplicados).toEqual([]);
  });
});
