<script lang="ts">
  interface Props {
    value?: string;
    error?: string;
    required?: boolean;
    /** Texto de la etiqueta. Queda asociada al campo, para lectores de pantalla. */
    etiqueta?: string;
    onchange?: (detail: { rut: string; valido: boolean }) => void;
  }

  let { value = '', error = '', required = false, etiqueta = 'RUT', onchange }: Props = $props();
  const uid = $props.id();

  let displayValue = $state('');
  let isValid = $state<boolean | null>(null);

  function validarRut(rut: string): boolean {
    const limpio = rut.replace(/[^0-9kK]/g, '');
    if (limpio.length < 2 || limpio.length > 9) return false;
    const cuerpo = limpio.slice(0, -1);
    const dv = limpio.slice(-1).toLowerCase();
    let suma = 0;
    let multiplicador = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
      suma += parseInt(cuerpo[i], 10) * multiplicador;
      multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
    }
    const resto = 11 - (suma % 11);
    const dvEsperado = resto === 11 ? '0' : resto === 10 ? 'k' : String(resto);
    return dv === dvEsperado;
  }

  function formatearRut(rut: string): string {
    const limpio = rut.replace(/[^0-9kK]/g, '');
    if (limpio.length < 2 || limpio.length > 9) return rut;
    const cuerpo = limpio.slice(0, -1);
    const dv = limpio.slice(-1).toUpperCase();
    let formateado = '';
    let contador = 0;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
      formateado = cuerpo[i] + formateado;
      contador++;
      if (contador === 3 && i > 0) {
        formateado = '.' + formateado;
        contador = 0;
      }
    }
    return formateado + '-' + dv;
  }

  $effect(() => {
    displayValue = value ? formatearRut(value) : '';
    if (value && value.length >= 8) {
      isValid = validarRut(value);
    } else {
      isValid = null;
    }
  });

  function handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const raw = input.value.replace(/[^0-9kK]/g, '');
    if (raw.length <= 9) {
      displayValue = formatearRut(raw);
      input.value = displayValue;
    }
    const valido = validarRut(raw);
    isValid = raw.length >= 2 ? valido : null;
    onchange?.({ rut: raw, valido });
  }
</script>

<div class="mb-4">
  <label for={uid} class="block text-sm font-medium text-gray-700 mb-1">
    {etiqueta}
    {#if required}
      <span class="text-red-500">*</span>
    {/if}
  </label>
  <div class="relative">
    <input
      id={uid}
      type="text"
      value={displayValue}
      oninput={handleInput}
      maxlength="12"
      placeholder="12.345.678-5"
      class="w-full px-3 py-2 pr-8 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 {error ? 'border-red-500' : 'border-gray-300'}"
    />
    {#if isValid === true}
      <span class="absolute inset-y-0 right-0 pr-3 flex items-center text-green-500">&#10003;</span>
    {:else if isValid === false}
      <span class="absolute inset-y-0 right-0 pr-3 flex items-center text-red-500">&#10007;</span>
    {/if}
  </div>
  {#if error}
    <p class="text-red-500 text-xs mt-1">{error}</p>
  {/if}
</div>
