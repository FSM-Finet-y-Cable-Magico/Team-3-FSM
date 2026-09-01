import adapter from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';

// Vercel (producción actual) sigue resuelto por adapter-auto. El Dockerfile
// setea BUILD_ADAPTER=node para que el build dentro del contenedor genere un
// server Node standalone en vez de funciones serverless de Vercel.
const useNodeAdapter = process.env.BUILD_ADAPTER === 'node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: useNodeAdapter ? adapterNode() : adapter()
	}
};

export default config;
