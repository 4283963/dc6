const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('streamAPI', {
  startScan: (options) => ipcRenderer.invoke('scan:start', options),
  onScanProgress: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },
  writeConfig: (payload) => ipcRenderer.invoke('config:write', payload)
})
