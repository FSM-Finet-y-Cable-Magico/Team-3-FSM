import { Module } from '@nestjs/common';
import { PlantaExternaController } from './planta-externa.controller.js';
import { PlantaExternaService } from './planta-externa.service.js';
import { TopologiaService } from './topologia.service.js';

@Module({
  // PrismaModule es @Global: no hace falta importarlo.
  controllers: [PlantaExternaController],
  providers: [PlantaExternaService, TopologiaService],
  exports: [PlantaExternaService, TopologiaService],
})
export class PlantaExternaModule {}
