const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0a0e1a',
    title: '流媒体拓扑管控工作台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('scan:start', async (event, options) => {
  try {
    let nativeModule
    try {
      nativeModule = require('../native')
    } catch (err) {
      console.warn('Rust native module not loaded, using fallback:', err.message)
      nativeModule = null
    }

    if (nativeModule && typeof nativeModule.scanRtspPorts === 'function') {
      const result = await nativeModule.scanRtspPorts(options || {})
      return { success: true, data: result }
    } else {
      const fallback = require('./fallback-scan')
      const result = await fallback.scanRtspPorts(options || {})
      return { success: true, data: result }
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.on('scan:progress', (event, payload) => {
  if (mainWindow) {
    mainWindow.webContents.send('scan:progress', payload)
  }
})
