import { useState, useCallback, useEffect, useRef } from 'react'
import TopologyGraph from './components/TopologyGraph.jsx'
import ControlPanel from './components/ControlPanel.jsx'
import ConnectConfirmModal from './components/ConnectConfirmModal.jsx'
import './App.css'

const MOCK_DEVICES = [
  { ip: '192.168.1.10', ports: [554], type: 'gateway', name: '主网关-01' },
  { ip: '192.168.1.11', ports: [554], type: 'gateway', name: '主网关-02' },
  { ip: '192.168.1.101', ports: [554], type: 'camera', name: '摄像头-01' },
  { ip: '192.168.1.102', ports: [554], type: 'camera', name: '摄像头-02' },
  { ip: '192.168.1.103', ports: [554], type: 'camera', name: '摄像头-03' },
  { ip: '192.168.1.104', ports: [554], type: 'camera', name: '摄像头-04' },
  { ip: '192.168.1.105', ports: [554], type: 'camera', name: '摄像头-05' },
  { ip: '192.168.1.106', ports: [554], type: 'camera', name: '摄像头-06' },
  { ip: '192.168.1.200', ports: [8554, 8000], type: 'forwarder', name: '转发服务器-01' },
  { ip: '192.168.1.201', ports: [8554, 8000], type: 'forwarder', name: '转发服务器-02' },
]

function App() {
  const [devices, setDevices] = useState(MOCK_DEVICES)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [selectedDevice, setSelectedDevice] = useState(null)
  const deviceCounterRef = useRef({ gateway: 10, camera: 10, forwarder: 10, device: 10 })

  const [connectModal, setConnectModal] = useState({ visible: false, source: null, target: null })
  const [isWriting, setIsWriting] = useState(false)
  const [writeResult, setWriteResult] = useState(null)

  useEffect(() => {
    if (window.streamAPI && window.streamAPI.onScanProgress) {
      const off = window.streamAPI.onScanProgress((payload) => {
        setScanProgress(payload.progress || 0)
      })
      return () => off && off()
    }
  }, [])

  useEffect(() => {
    const hasNew = devices.some(d => d.status === 'new')
    if (hasNew) {
      const timer = setTimeout(() => {
        setDevices(prev => prev.map(d =>
          d.status === 'new' ? { ...d, status: 'online' } : d
        ))
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [devices])

  const handleStartScan = useCallback(async () => {
    setScanning(true)
    setScanProgress(0)
    try {
      let result
      if (window.streamAPI && window.streamAPI.startScan) {
        result = await window.streamAPI.startScan({
          ports: [554, 8554, 8000, 8080],
          timeout: 1000,
          concurrency: 80
        })
      } else {
        result = { success: true, data: MOCK_DEVICES }
      }
      if (result && result.success && result.data) {
        setDevices(prevDevices => mergeDevices(prevDevices, result.data, deviceCounterRef.current))
      }
    } catch (err) {
      console.error('Scan failed:', err)
    } finally {
      setScanning(false)
      setScanProgress(100)
    }
  }, [])

  const handleClear = useCallback(() => {
    setDevices([])
    setSelectedDevice(null)
  }, [])

  const handleSelectDevice = useCallback((device) => {
    setSelectedDevice(device)
  }, [])

  const handleRequestConnect = useCallback(({ source, target }) => {
    setWriteResult(null)
    setConnectModal({ visible: true, source, target })
  }, [])

  const handleCancelConnect = useCallback(() => {
    setConnectModal({ visible: false, source: null, target: null })
    setWriteResult(null)
  }, [])

  const handleConfirmWrite = useCallback(async (hclConfig) => {
    setIsWriting(true)
    setWriteResult(null)
    try {
      let result
      if (window.streamAPI && window.streamAPI.writeConfig) {
        result = await window.streamAPI.writeConfig({
          content: hclConfig,
          filePath: '/etc/gateway/config.hcl'
        })
      } else {
        await new Promise(r => setTimeout(r, 800))
        result = { success: true, data: { path: '/etc/gateway/config.hcl', size: hclConfig.length } }
      }
      if (result?.success) {
        setWriteResult({ success: true })
      } else {
        setWriteResult({ success: false, error: result?.error || '写入失败' })
      }
    } catch (err) {
      setWriteResult({ success: false, error: err.message || '未知错误' })
    } finally {
      setIsWriting(false)
    }
  }, [])

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <div className="logo">
            <svg viewBox="0 0 40 40" width="36" height="36">
              <defs>
                <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00e5ff" />
                  <stop offset="100%" stopColor="#3b82f6" />
                </linearGradient>
              </defs>
              <circle cx="20" cy="20" r="18" fill="none" stroke="url(#logoGrad)" strokeWidth="2" />
              <circle cx="20" cy="20" r="6" fill="url(#logoGrad)" />
              <line x1="20" y1="2" x2="20" y2="10" stroke="url(#logoGrad)" strokeWidth="2" />
              <line x1="20" y1="30" x2="20" y2="38" stroke="url(#logoGrad)" strokeWidth="2" />
              <line x1="2" y1="20" x2="10" y2="20" stroke="url(#logoGrad)" strokeWidth="2" />
              <line x1="30" y1="20" x2="38" y2="20" stroke="url(#logoGrad)" strokeWidth="2" />
            </svg>
          </div>
          <div className="header-title">
            <h1>流媒体拓扑管控工作台</h1>
            <p className="subtitle">Industrial Streaming Topology Management Console</p>
          </div>
        </div>
        <div className="header-right">
          <div className="status-indicator">
            <span className={`status-dot ${scanning ? 'scanning' : 'online'}`}></span>
            <span className="status-text">
              {scanning ? `扫描中 ${scanProgress}%` : `在线设备 ${devices.length}`}
            </span>
          </div>
        </div>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <ControlPanel
            scanning={scanning}
            deviceCount={devices.length}
            onStartScan={handleStartScan}
            onClear={handleClear}
            selectedDevice={selectedDevice}
          />
        </aside>
        <section className="topology-area">
          <TopologyGraph
            devices={devices}
            onSelectDevice={handleSelectDevice}
            selectedDevice={selectedDevice}
            onRequestConnect={handleRequestConnect}
          />
        </section>
      </main>

      <ConnectConfirmModal
        source={connectModal.source}
        target={connectModal.target}
        onConfirm={handleConfirmWrite}
        onCancel={handleCancelConnect}
        isWriting={isWriting}
        writeResult={writeResult}
      />
    </div>
  )
}

function generateDeviceName(type, counter) {
  const prefix = {
    gateway: '主网关',
    camera: '摄像头',
    forwarder: '转发服务器',
    device: '设备'
  }
  return `${prefix[type] || '设备'}-${String(counter).padStart(2, '0')}`
}

function mergeDevices(prevDevices, newScanData, counter) {
  const deviceMap = new Map()

  for (const d of prevDevices) {
    deviceMap.set(d.ip, { ...d })
  }

  for (const scanned of newScanData) {
    if (deviceMap.has(scanned.ip)) {
      const existing = deviceMap.get(scanned.ip)
      deviceMap.set(scanned.ip, {
        ...existing,
        ...scanned,
        name: existing.name,
        type: scanned.type || existing.type,
        ports: scanned.ports || existing.ports,
        lastSeen: Date.now(),
        status: 'online'
      })
    } else {
      const type = scanned.type || 'device'
      counter[type] = (counter[type] || 0) + 1
      deviceMap.set(scanned.ip, {
        ...scanned,
        name: generateDeviceName(type, counter[type]),
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        status: 'new'
      })
    }
  }

  return Array.from(deviceMap.values())
}

export default App
