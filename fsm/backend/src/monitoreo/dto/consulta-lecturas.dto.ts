import { IsInt, IsOptional, IsPositive, Max } from 'class-validator';
import { Type } from 'class-transformer';

/** Query params de `GET /api/monitoreo/ont`. */
export class ConsultaLecturasDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page?: number = 1;

  /**
   * El tope alto es para el panel de monitoreo (CU-12): ordena y filtra por
   * gravedad en el navegador, asi que necesita el padron completo en un viaje
   * --hoy 943 ONT en FiNet-- y no una pagina.
   *
   * Paginar aca no serviria: `lecturasRecientes` ordena por numero de serie, y
   * el corte de una pagina es alfabetico, no por gravedad. Pedir 200 devolveria
   * las 200 primeras por serie, dejando fuera justo las ONT con problema. Si el
   * padron llegara a pasar este tope, la pantalla lo avisa en vez de mostrar en
   * silencio un recorte arbitrario.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(2000)
  limit?: number = 50;
}
