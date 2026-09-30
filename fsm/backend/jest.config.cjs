module.exports = {
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: '<rootDir>/tsconfig.json' }] },
  setupFiles: ['<rootDir>/test/env.cjs'],
  // Con los 57 suites del Incremento 3 --antes eran 27-- el numero de workers
  // por defecto satura la maquina en Windows: 2 de cada 3 corridas locales
  // fallaban con suites que NO CARGAN, nunca con una asercion. Cambiaban de
  // suite cada vez, que es la firma de la contencion y no de un defecto.
  //
  // Medido: con maxWorkers en 2 o con --runInBand pasa 57 de 57, consistente.
  // Se fija en 50% en vez de un numero: en CI (2 nucleos) da 1 y en un PC de
  // desarrollo da la mitad de los nucleos, sin quedar atado a ninguna maquina.
  maxWorkers: '50%',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts'],
  coverageDirectory: 'coverage',
};
