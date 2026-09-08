<script lang="ts">
  let { label = '', name = '', type = 'text', value = $bindable(''), error = '', required = false } = $props();
  let showPassword = $state(false);

  const inputType = $derived(type === 'password' && showPassword ? 'text' : type);
</script>

<div class="mb-4">
  <label class="block text-sm font-medium text-gray-700 mb-1">
    {label}
    {#if required}
      <span class="text-red-500">*</span>
    {/if}
  </label>
  <div class="relative">
    <input
      {name}
      type={inputType}
      bind:value
      {required}
      class="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 {error ? 'border-red-500' : 'border-gray-300'}"
    />
    {#if type === 'password'}
      <button
        type="button"
        class="absolute inset-y-0 right-0 pr-3 flex items-center cursor-pointer text-gray-400 hover:text-gray-600"
        onclick={() => showPassword = !showPassword}
      >
        {showPassword ? '🙈' : '👁'}
      </button>
    {/if}
  </div>
  {#if error}
    <p class="text-red-500 text-xs mt-1">{error}</p>
  {/if}
</div>
