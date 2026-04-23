import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'

let debugWin: BrowserWindow | null = null

function createDebugWindow(): void {
  debugWin = new BrowserWindow({
    width: 480,
    height: 900,
    title: 'OttTuber Debug',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    debugWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/debug.html`)
  } else {
    debugWin.loadFile(join(__dirname, '../renderer/debug.html'))
  }

  debugWin.on('closed', () => { debugWin = null })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 800,
    height: 900,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Needed so the renderer can fetch MediaPipe WASM from CDN and open file:// VRM paths
      webSecurity: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Grant webcam access without prompting
  win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.handle('load-vrm', (_event, relativePath: string) => {
    const vrmPath = join(app.getAppPath(), relativePath)
    return readFileSync(vrmPath).buffer
  })

  ipcMain.handle('load-config', () => {
    const configPath = join(app.getAppPath(), 'config.json')
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch {
      return null
    }
  })

  // Forward debug data from the renderer to the debug window
  ipcMain.on('debug-data', (_event, data) => {
    debugWin?.webContents.send('debug-data', data)
  })

  createWindow()
  createDebugWindow()

  // Ctrl+Shift+D toggles the debug window
  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (debugWin) {
      debugWin.close()
    } else {
      createDebugWindow()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
