/**
 * Comentario libre del tecnico al cerrar una OT.
 *
 * Es para el jefe tecnico que aprueba el cierre: lo que el tecnico quiere
 * dejar dicho y no cabe en ningun otro campo ("el cliente pidio el router en
 * el living", "volver a revisar en una semana"). Opcional y en todo tipo de OT.
 *
 * Se guarda dentro de `orden_trabajo.cierre_equipos` (ver `CierreGuardado`),
 * por la misma razon que los datos de reparacion: contra la base compartida no
 * podemos crear columnas.
 *
 * NO viaja en el aviso de cierre a G1/G8: no esta en el contrato, y G8 rechaza
 * con 400 cualquier propiedad que no conozca.
 *
 * 500, igual que `obs_cliente_ausente`: alcanza para un parrafo escrito desde
 * el celular sin volverse un informe.
 */
export const LARGO_MAX_COMENTARIO_CIERRE = 500;
