import { contextBridge, ipcRenderer } from "electron";

/**
 * Exposes a safe, typed subset of Electron APIs to the renderer via `window.electron`.
 * contextIsolation keeps the renderer sandboxed — only these four methods are accessible.
 */
contextBridge.exposeInMainWorld("electron", {
	/** Reads a VRM file from disk via the main process and returns its ArrayBuffer. */
	loadVrm: (filename: string): Promise<ArrayBuffer> =>
		ipcRenderer.invoke("load-vrm", filename),

	/** Reads config.json from the app root. Returns null if the file is missing. */
	loadConfig: (): Promise<unknown> => ipcRenderer.invoke("load-config"),

	/** Sends a debug data snapshot from the renderer to the debug window. */
	sendDebugData: (data: unknown): void =>
		ipcRenderer.send("debug-data", data),

	/** Registers a callback to receive debug data relayed from the renderer. */
	onDebugData: (callback: (data: unknown) => void): void => {
		ipcRenderer.on("debug-data", (_event, data) => callback(data));
	},
});
