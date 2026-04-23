/// <reference types="vite/client" />

interface AppConfig {
  camera: {
    position: [number, number, number]
    lookAt: [number, number, number]
    fov: number
  }
  webcam?: {
    deviceLabel?: string | null
    deviceId?: string | null
  }
  model: {
    path: string
    scale: number
    rotation: [number, number, number]
    mirror: boolean
  }
  tracking: {
    blendshapeAmplify: Record<string, number>
    blendshapeFilter: { minCutoff: number; beta: number }
    blendshapeFilterOverrides: Record<string, { minCutoff: number; beta: number }>
    headFilter: { minCutoff: number; beta: number }
  }
}

interface Window {
  electron: {
    loadVrm(filename: string): Promise<ArrayBuffer>
    loadConfig(): Promise<AppConfig | null>
  }
}
