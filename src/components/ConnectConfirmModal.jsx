import { useEffect, useState } from 'react'
import './ConnectConfirmModal.css'

const DEVICE_STYLES = {
  gateway: {
    color: '#00e5ff',
    label: '流媒体网关',
    icon: '🌐'
  },
  camera: {
    color: '#10b981',
    label: '摄像头',
    icon: '📷'
  },
  forwarder: {
    color: '#8b5cf6',
    label: '转发服务器',
    icon: '🖥'
  },
  device: {
    color: '#f59e0b',
    label: '设备',
    icon: '📦'
  }
}

export function generateHclConfig(source, target) {
  const streamId = `cam_${source.ip.replace(/\./g, '_')}`
  const streamName = source.name || source.ip
  const gatewayIp = target.ip
  const rtspPort = source.ports?.[0] || 554

  const config = `# 流媒体网关配置
# 生成时间: ${new Date().toISOString()}
# 源设备: ${streamName} (${source.ip})
# 目标网关: ${target.name || target.ip} (${gatewayIp})

stream "${streamId}" {
  name        = "${streamName}"
  description = "RTSP stream from ${source.ip}"
  enabled     = true

  input {
    type   = "rtsp"
    source = "rtsp://${source.ip}:${rtspPort}/stream"
    transport = "tcp"

    reconnect {
      enabled         = true
      max_attempts    = 0
      initial_delay   = "2s"
      max_delay       = "30s"
      backoff_factor  = 2.0
    }
  }

  output {
    type   = "rtsp"
    listen = "0.0.0.0:${8554}"
    path   = "/${streamId}"

    codec {
      video = "h264"
      audio = "aac"
    }
  }

  quality {
    resolution = "1920x1080"
    bitrate    = 4096
    fps        = 30
    gop        = 60
  }
}

gateway "${gatewayIp.replace(/\./g, '_')}" {
  address = "${gatewayIp}:8554"
  name    = "${target.name || 'Gateway'}"

  security {
    mode = "permissive"
  }

  buffer {
    size    = "200ms"
    latency = "500ms"
  }
}
`
  return config
}

export default function ConnectConfirmModal({ source, target, onConfirm, onCancel, isWriting, writeResult }) {
  const [hclConfig, setHclConfig] = useState('')
  const [showConfig, setShowConfig] = useState(false)

  useEffect(() => {
    if (source && target) {
      const config = generateHclConfig(source, target)
      setHclConfig(config)
    }
  }, [source, target])

  if (!source || !target) return null

  const sourceStyle = DEVICE_STYLES[source.type] || DEVICE_STYLES.device
  const targetStyle = DEVICE_STYLES[target.type] || DEVICE_STYLES.device

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-container" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-icon">🔗</span>
            <h2>确认连接配置</h2>
          </div>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="modal-body">
          <div className="connect-flow">
            <div className="flow-node" style={{ borderColor: sourceStyle.color }}>
              <div className="flow-icon" style={{ background: `${sourceStyle.color}20`, color: sourceStyle.color }}>
                {sourceStyle.icon}
              </div>
              <div className="flow-info">
                <div className="flow-name">{source.name || source.ip}</div>
                <div className="flow-type" style={{ color: sourceStyle.color }}>{sourceStyle.label}</div>
                <div className="flow-ip">{source.ip}</div>
              </div>
            </div>

            <div className="flow-arrow">
              <div className="arrow-line" style={{ background: `linear-gradient(90deg, ${sourceStyle.color}, ${targetStyle.color})` }}></div>
              <div className="arrow-icon" style={{ color: targetStyle.color }}>→</div>
            </div>

            <div className="flow-node" style={{ borderColor: targetStyle.color }}>
              <div className="flow-icon" style={{ background: `${targetStyle.color}20`, color: targetStyle.color }}>
                {targetStyle.icon}
              </div>
              <div className="flow-info">
                <div className="flow-name">{target.name || target.ip}</div>
                <div className="flow-type" style={{ color: targetStyle.color }}>{targetStyle.label}</div>
                <div className="flow-ip">{target.ip}</div>
              </div>
            </div>
          </div>

          <div className="config-info">
            <div className="info-row">
              <span className="info-label">配置文件路径</span>
              <span className="info-value mono">/etc/gateway/config.hcl</span>
            </div>
            <div className="info-row">
              <span className="info-label">流标识</span>
              <span className="info-value mono">cam_{source.ip.replace(/\./g, '_')}</span>
            </div>
          </div>

          <div className="config-toggle" onClick={() => setShowConfig(!showConfig)}>
            <span>{showConfig ? '▼' : '▶'} 查看 HCL 配置预览</span>
          </div>

          {showConfig && (
            <div className="config-preview">
              <pre className="hcl-code">{hclConfig}</pre>
            </div>
          )}

          {writeResult && (
            <div className={`write-result ${writeResult.success ? 'success' : 'error'}`}>
              <span className="result-icon">{writeResult.success ? '✓' : '✕'}</span>
              <span className="result-text">
                {writeResult.success
                  ? '配置文件写入成功！'
                  : `写入失败: ${writeResult.error || '未知错误'}`
                }
              </span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={isWriting}
          >
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm(hclConfig)}
            disabled={isWriting}
          >
            {isWriting ? (
              <>
                <span className="spinner-small"></span>
                写入中...
              </>
            ) : (
              <>✎ 确认并写入配置</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
