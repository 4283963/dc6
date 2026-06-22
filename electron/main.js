const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const DEFAULT_CONFIG_PATH = '/etc/gateway/config.hcl'

let mainWindow = null

function ensureDir(filePath) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
  }
}

function safeWriteFile(filePath, content) {
  return new Promise((resolve, reject) => {
    try {
      ensureDir(filePath)
      const tempPath = filePath + '.tmp'
      fs.writeFile(tempPath, content, { mode: 0o644 }, (err) => {
        if (err) {
          try { fs.unlinkSync(tempPath) } catch (_) {}
          return reject(err)
        }
        fs.rename(tempPath, filePath, (renameErr) => {
          if (renameErr) return reject(renameErr)
          resolve({ success: true, path: filePath, size: content.length })
        })
      })
    } catch (err) {
      reject(err)
    }
  })
}

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

ipcMain.handle('config:write', async (event, payload) => {
  try {
    const { content, filePath } = payload || {}
    const targetPath = filePath || DEFAULT_CONFIG_PATH

    if (!content || typeof content !== 'string') {
      return { success: false, error: '无效的配置内容' }
    }

    let nativeModule
    try {
      nativeModule = require('../native')
    } catch (err) {
      console.warn('Rust native module not loaded, using Node.js fallback for write:', err.message)
      nativeModule = null
    }

    if (nativeModule && typeof nativeModule.writeConfigFile === 'function') {
      const result = await nativeModule.writeConfigFile(targetPath, content)
      return { success: true, data: result }
    } else {
      const result = await safeWriteFile(targetPath, content)
      return { success: true, data: result }
    }
  } catch (error) {
    return { success: false, error: error.message || '写入失败' }
  }
})
