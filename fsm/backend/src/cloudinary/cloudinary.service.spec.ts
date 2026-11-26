import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { CLOUDINARY_CLIENT, CloudinaryService } from './cloudinary.service.js';

const file: Express.Multer.File = {
  fieldname: 'file', originalname: 'foto.png', encoding: '7bit', mimetype: 'image/png',
  size: 4, buffer: Buffer.from('foto'), stream: Readable.from([]), destination: '', filename: '', path: '',
};

describe('Cloudinary sin configuración completa', () => {
  afterEach(() => { jest.restoreAllMocks(); });
  it.each([
    { CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '' },
    { CLOUDINARY_CLOUD_NAME: 'cuenta-privada', CLOUDINARY_API_KEY: 'clave-privada', CLOUDINARY_API_SECRET: '   ' },
  ])('avisa al arrancar, sin secretos, y mantiene la subida en 503', async config => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const upload_stream = jest.fn();
    const moduleRef = await Test.createTestingModule({ providers: [
      CloudinaryService, { provide: ConfigService, useValue: new ConfigService(config) },
      { provide: CLOUDINARY_CLIENT, useValue: { uploader: { upload_stream } } },
    ] }).compile();
    await moduleRef.init();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('subida de evidencias devolverá 503'));
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/cuenta-privada|clave-privada/);
    await expect(moduleRef.get(CloudinaryService).subirEvidencia(file)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(upload_stream).not.toHaveBeenCalled();
    await moduleRef.close();
  });
});

describe('Cloudinary guarda la evidencia reducida', () => {
  // La foto llega tal como sale de la camara del celular (3-8 MB). Con una
  // transformacion de entrada, Cloudinary guarda la version reducida y no el
  // original: la cuota de almacenamiento se gasta en ~300 KB por foto.
  it('pide a Cloudinary acotar el ancho y la calidad al subir', async () => {
    const upload_stream = jest.fn((_o: unknown, cb: (e: unknown, r: unknown) => void) => ({
      end: () => cb(null, { secure_url: 'https://res.cloudinary.com/c/image/upload/v1/f/x.jpg', format: 'jpg', bytes: 300 * 1024 }),
    }));
    const moduleRef = await Test.createTestingModule({ providers: [
      CloudinaryService,
      { provide: ConfigService, useValue: new ConfigService({ CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' }) },
      { provide: CLOUDINARY_CLIENT, useValue: { uploader: { upload_stream } } },
    ] }).compile();

    await moduleRef.get(CloudinaryService).subirEvidencia(file);

    expect(upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({
        transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto' }],
      }),
      expect.any(Function),
    );
    await moduleRef.close();
  });
});
