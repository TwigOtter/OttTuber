import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin } from "@pixiv/three-vrm";

/**
 * Loads a VRM file via the Electron IPC bridge and returns a parsed VRM object.
 * Uses the preload-exposed `window.electron.loadVrm` to bypass web security for local files.
 */
export async function loadVrm(path: string): Promise<VRM> {
	const buffer = await window.electron.loadVrm(path);
	const loader = new GLTFLoader();
	loader.register((parser) => new VRMLoaderPlugin(parser));
	const gltf = await new Promise<{ userData: { vrm: VRM } }>(
		(resolve, reject) =>
			loader.parse(
				buffer,
				"",
				resolve as (gltf: unknown) => void,
				reject,
			),
	);
	const vrm = gltf.userData.vrm;
	console.log(
		"VRM expressions:",
		vrm.expressionManager?.expressions.map((e) => e.expressionName),
	);
	return vrm;
}

/**
 * Opens the webcam stream and attaches it to a hidden video element.
 * Resolves the device by label first (human-readable name), then by ID, then
 * falls back to any available camera.
 */
export async function openWebcam(
	webcam: AppConfig["webcam"],
): Promise<HTMLVideoElement> {
	const video = document.createElement("video");
	video.style.display = "none";
	document.body.appendChild(video);

	let videoConstraint: MediaTrackConstraints | boolean = true;
	if (webcam?.deviceLabel) {
		const devices = await navigator.mediaDevices.enumerateDevices();
		const match = devices.find(
			(d) => d.kind === "videoinput" && d.label === webcam.deviceLabel,
		);
		if (match) videoConstraint = { deviceId: { exact: match.deviceId } };
	} else if (webcam?.deviceId) {
		videoConstraint = { deviceId: { exact: webcam.deviceId } };
	}

	const stream = await navigator.mediaDevices.getUserMedia({
		video: videoConstraint,
	});
	video.srcObject = stream;
	await video.play();
	return video;
}
