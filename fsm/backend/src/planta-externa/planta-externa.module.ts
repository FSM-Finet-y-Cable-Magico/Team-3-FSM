import { Module } from '@nestjs/common';
import { PlantaExternaController } from './planta-externa.controller.js';
import { PlantaExternaService } from './planta-externa.service.js';
import { TopologiaService } from './topologia.service.js';
import { SaludCajasService } from './salud-cajas.service.js';
import { MonitoreoModule } from '../monitoreo/monitoreo.module.js';

@Module({
  // PrismaModule es @Global: no hace falta importarlo. MonitoreoModule aporta
  // AlertasService, de donde sale el estado de las ONT del mapa de salud.
  imports: [MonitoreoModule],
  controllers: [PlantaExternaController],
  providers: [PlantaExternaService, TopologiaService, SaludCajasService],
  exports: [PlantaExternaService, TopologiaService],
})
export class PlantaExternaModule {}
