import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
	},
	renderer: {
		build: {
			rollupOptions: {
				input: {
					index: resolve(__dirname, "src/renderer/index.html"),
					debug: resolve(__dirname, "src/renderer/debug.html"),
				},
			},
		},
		server: {
			headers: {
				// Allow loading MediaPipe WASM from CDN and webcam access
				"Content-Security-Policy":
					"default-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob: data:",
			},
		},
	},
});
