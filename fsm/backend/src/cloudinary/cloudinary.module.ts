import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { CLOUDINARY_CLIENT, CloudinaryService } from './cloudinary.service.js';

@Module({
  imports: [ConfigModule],
  providers: [{ provide: CLOUDINARY_CLIENT, useValue: cloudinary }, CloudinaryService],
  exports: [CloudinaryService],
})
export class CloudinaryModule {}
