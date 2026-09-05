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
