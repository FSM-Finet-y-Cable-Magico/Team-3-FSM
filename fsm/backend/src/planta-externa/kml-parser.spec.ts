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

    // El placemark suelto se descarta. `descartados` dejo de ser un numero
    // cuando el parser empezo a rendir cuentas de POR QUE descarta cada cosa:
    // sin el motivo, un import que perdia 161 cajas por un bug de regex se veia
    // igual que uno que descartaba basura de verdad.
    expect(descartados.total).toBe(1);
    // "Algo raro" esta en 0,0 — el Golfo de Guinea, no Chile. Que caiga en
    // COORDENADA_INVALIDA y no en SIN_PALABRA_CLAVE es la parte que importa:
    // es el balde de lo accionable, lo que habria entrado como infraestructura.
    expect(descartados.por_motivo.COORDENADA_INVALIDA).toBe(1);
  });

  it('clasifica aunque la carpeta venga en plural', () => {
    // `pistaTipo` prefiere el nombre de la carpeta sobre el del marcador, y una
    // carpeta se llama "OLTs" con la misma naturalidad que "OLT".
    const { nodos } = parsearKml(KML);
    expect(nodos.filter((n) => n.tipo === 'OLT')).toHaveLength(1);
  });

  it('no confunde "nodo" a secas con una OLT', () => {
    // Un marcador llamado solo "nodo" no dice de que es nodo: se descarta como
    // ambiguo en vez de inventar una OLT.
    const solo = KML.replace('<name>OLT-A</name>', '<name>nodo</name>')
      .replace('<name>OLTs</name>', '<name>nodo</name>');
    const { descartados } = parsearKml(solo);
    expect(descartados.por_motivo.NODO_AMBIGUO).toBe(1);
  });

  it('rechaza XML inválido', () => {
    expect(() => parsearKml('no soy kml <')).toThrow();
  });
});
