import { useState } from 'react'
import './ControlPanel.css'

const DEVICE_TYPE_LABELS = {
  gateway: { label: '流媒体网关', color: '#00e5ff', icon: 'gateway' },
  camera: { label: '摄像头', color: '#10b981', icon: 'camera' },
  forwarder: { label: '转发服务器', color: '#8b5cf6', icon: 'server' },
  device: { label: '未知设备', color: '#f59e0b', icon: 'device' }
}

export default function ControlPanel({ scanning, deviceCount, onStartScan, onClear, selectedDevice }) {
  const [config, setConfig] = useState({
    ports: [554, 8554, 8000, 8080],
    timeout: 1000,
    concurrency: 80,
    networks: []
  })
  const [newPort, setNewPort] = useState('')
  const [newNetwork, setNewNetwork] = useState('')

  const addPort = () => {
    const p = parseInt(newPort, 10)
    if (p >= 1 && p <= 65535 && !config.ports.includes(p)) {
      setConfig({ ...config, ports: [...config.ports, p] })
      setNewPort('')
    }
  }

  const removePort = (port) => {
    setConfig({ ...config, ports: config.ports.filter(p => p !== port) })
  }

  const addNetwork = () => {
    if (newNetwork && /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(newNetwork)) {
      setConfig({ ...config, networks: [...config.networks, newNetwork] })
      setNewNetwork('')
    }
  }

  const removeNetwork = (net) => {
    setConfig({ ...config, networks: config.networks.filter(n => n !== net) })
  }

  const stats = countByType(selectedDevice ? [selectedDevice] : [])

  return (
    <div className="control-panel">
      <div className="panel-section">
        <h3 className="section-title">
          <span className="title-icon">⚡</span>
          设备扫描
        </h3>
        <div className="scan-controls">
          <button
            className={`scan-btn primary ${scanning ? 'disabled' : ''}`}
            onClick={onStartScan}
            disabled={scanning}
          >
            {scanning ? (
              <>
                <span className="spinner"></span>
                扫描中...
              </>
            ) : (
              <>
                <span className="btn-icon">🔍</span>
                开始扫描
              </>
            )}
          </button>
          <button
            className="scan-btn secondary"
            onClick={onClear}
            disabled={scanning}
          >
            <span className="btn-icon">🗑</span>
            清空拓扑
          </button>
        </div>
        <div className="scan-stats">
          <div className="stat-item">
            <span className="stat-value">{deviceCount}</span>
            <span className="stat-label">已发现设备</span>
          </div>
        </div>
      </div>

      <div className="panel-section">
        <h3 className="section-title">
          <span className="title-icon">⚙</span>
          扫描配置
        </h3>

        <div className="config-group">
          <label className="config-label">RTSP 端口</label>
          <div className="tag-list">
            {config.ports.map(port => (
              <span key={port} className="tag port-tag" onClick={() => removePort(port)}>
                {port} <span className="tag-close">×</span>
              </span>
            ))}
          </div>
          <div className="config-input-row">
            <input
              type="number"
              className="config-input"
              placeholder="添加端口"
              value={newPort}
              onChange={e => setNewPort(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addPort()}
            />
            <button className="add-btn" onClick={addPort}>+</button>
          </div>
        </div>

        <div className="config-group">
          <label className="config-label">超时时间 (ms)</label>
          <input
            type="range"
            min="200"
            max="5000"
            step="100"
            value={config.timeout}
            onChange={e => setConfig({ ...config, timeout: parseInt(e.target.value, 10) })}
            className="range-slider"
          />
          <span className="range-value">{config.timeout}ms</span>
        </div>

        <div className="config-group">
          <label className="config-label">并发数</label>
          <input
            type="range"
            min="10"
            max="200"
            step="10"
            value={config.concurrency}
            onChange={e => setConfig({ ...config, concurrency: parseInt(e.target.value, 10) })}
            className="range-slider"
          />
          <span className="range-value">{config.concurrency}</span>
        </div>

        <div className="config-group">
          <label className="config-label">目标网段 (CIDR)</label>
          <div className="tag-list">
            {config.networks.map(net => (
              <span key={net} className="tag network-tag" onClick={() => removeNetwork(net)}>
                {net} <span className="tag-close">×</span>
              </span>
            ))}
            {config.networks.length === 0 && (
              <span className="tag-hint">默认扫描 192.168.0.x / 192.168.1.x / 10.0.0.x</span>
            )}
          </div>
          <div className="config-input-row">
            <input
              type="text"
              className="config-input"
              placeholder="如 192.168.2.0/24"
              value={newNetwork}
              onChange={e => setNewNetwork(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addNetwork()}
            />
            <button className="add-btn" onClick={addNetwork}>+</button>
          </div>
        </div>
      </div>

      {selectedDevice && (
        <div className="panel-section">
          <h3 className="section-title">
            <span className="title-icon">📡</span>
            设备详情
          </h3>
          <DeviceDetail device={selectedDevice} />
        </div>
      )}

      <div className="panel-section">
        <h3 className="section-title">
          <span className="title-icon">📊</span>
          图例
        </h3>
        <div className="legend-list">
          {Object.entries(DEVICE_TYPE_LABELS).map(([key, info]) => (
            <div key={key} className="legend-item">
              <div className="legend-dot" style={{ background: info.color, boxShadow: `0 0 10px ${info.color}` }}></div>
              <span className="legend-label">{info.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DeviceDetail({ device }) {
  const info = DEVICE_TYPE_LABELS[device.type] || DEVICE_TYPE_LABELS.device
  return (
    <div className="device-detail">
      <div className="detail-header" style={{ borderColor: info.color }}>
        <div className="detail-icon" style={{ background: `${info.color}20`, color: info.color }}>
          {getIcon(device.type)}
        </div>
        <div className="detail-title">
          <div className="detail-name">{device.name || device.ip}</div>
          <div className="detail-type" style={{ color: info.color }}>{info.label}</div>
        </div>
      </div>
      <div className="detail-body">
        <div className="detail-row">
          <span className="detail-label">IP 地址</span>
          <span className="detail-value mono">{device.ip}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">开放端口</span>
          <div className="port-list">
            {(device.ports || []).map(p => (
              <span key={p} className="port-badge">{p}</span>
            ))}
          </div>
        </div>
        <div className="detail-row">
          <span className="detail-label">发现时间</span>
          <span className="detail-value">
            {device.timestamp ? new Date(device.timestamp).toLocaleTimeString() : '-'}
          </span>
        </div>
      </div>
    </div>
  )
}

function getIcon(type) {
  switch (type) {
    case 'gateway': return '🌐'
    case 'camera': return '📷'
    case 'forwarder': return '🖥'
    default: return '📦'
  }
}

function countByType(devices) {
  return devices.reduce((acc, d) => {
    acc[d.type] = (acc[d.type] || 0) + 1
    return acc
  }, {})
}
