import { parsearKml } from './kml-parser.js';

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Test</name>
    <Folder>
      <name>OLTs</name>
      <Placemark>
        <name>OLT-A</name>
        <ExtendedData><Data name="ip"><value>10.0.0.1</value></Data></ExtendedData>
        <Point><coordinates>-71.60,-33.54,0</coordinates></Point>
      </Placemark>
    </Folder>
    <Folder>
      <name>Cajas NAP</name>
      <Placemark>
        <name>NAP-1</name>
        <ExtendedData>
          <Data name="tipo"><value>caja NAP</value></Data>
          <Data name="capacidad"><value>8</value></Data>
          <Data name="zona"><value>Centro</value></Data>
          <Data name="padre"><value>MUF-1</value></Data>
        </ExtendedData>
        <Point><coordinates>-71.601,-33.541,0</coordinates></Point>
      </Placemark>
    </Folder>
    <Placemark>
      <name>Algo raro</name>
      <Point><coordinates>0,0,0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;

describe('parsearKml', () => {
  it('clasifica OLT y caja NAP, extrae coords y ExtendedData', () => {
    const { nodos, descartados } = parsearKml(KML);

    const olt = nodos.find((n) => n.tipo === 'OLT');
    expect(olt).toMatchObject({ nombre: 'OLT-A', latitud: -33.54, longitud: -71.6 });
    expect(olt?.atributos['ip']).toBe('10.0.0.1');

    const caja = nodos.find((n) => n.tipo === 'CAJA_NAP');
    expect(caja).toMatchObject({
      nombre: 'NAP-1',
      identificador: 'NAP-1',
      capacidad: 8,
      zona: 'Centro',
      padre: 'MUF-1',
      latitud: -33.541,
    });

    // El placemark sin tipo ni carpeta reconocible se descarta.
    expect(descartados).toBe(1);
  });

  it('rechaza XML inválido', () => {
    expect(() => parsearKml('no soy kml <')).toThrow();
  });
});
