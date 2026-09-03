import { Module } from '@nestjs/common';
import { PlantaExternaController } from './planta-externa.controller.js';
import { PlantaExternaService } from './planta-externa.service.js';

@Module({
  // PrismaModule es @Global: no hace falta importarlo.
  controllers: [PlantaExternaController],
  providers: [PlantaExternaService],
  exports: [PlantaExternaService],
})
export class PlantaExternaModule {}
