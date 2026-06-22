import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3-force'
import './TopologyGraph.css'

const DEVICE_STYLES = {
  gateway: {
    color: '#00e5ff',
    glow: 'rgba(0, 229, 255, 0.6)',
    size: 44,
    label: '网关',
    icon: '🌐',
    ringCount: 3
  },
  camera: {
    color: '#10b981',
    glow: 'rgba(16, 185, 129, 0.6)',
    size: 32,
    label: '摄像头',
    icon: '📷',
    ringCount: 1
  },
  forwarder: {
    color: '#8b5cf6',
    glow: 'rgba(139, 92, 246, 0.6)',
    size: 40,
    label: '转发服务器',
    icon: '🖥',
    ringCount: 2
  },
  device: {
    color: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.6)',
    size: 28,
    label: '设备',
    icon: '📦',
    ringCount: 1
  }
}

function hashIp(ip) {
  let hash = 0
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

function pickStableParent(childIp, parentList) {
  if (!parentList || parentList.length === 0) return null
  const idx = hashIp(childIp) % parentList.length
  return parentList[idx]
}

function buildStableLinks(nodes) {
  const links = []
  const linkSet = new Set()

  const gateways = nodes.filter(n => n.type === 'gateway').sort((a, b) => a.ip.localeCompare(b.ip))
  const forwarders = nodes.filter(n => n.type === 'forwarder').sort((a, b) => a.ip.localeCompare(b.ip))
  const cameras = nodes.filter(n => n.type === 'camera').sort((a, b) => a.ip.localeCompare(b.ip))
  const others = nodes.filter(n => !['gateway', 'forwarder', 'camera'].includes(n.type))

  function addLink(sourceId, targetId, type, strength) {
    if (sourceId === targetId) return
    const key = [sourceId, targetId].sort().join('|')
    if (linkSet.has(key)) return
    linkSet.add(key)
    links.push({ source: sourceId, target: targetId, type, strength })
  }

  for (let i = 0; i < gateways.length; i++) {
    for (let j = i + 1; j < gateways.length; j++) {
      addLink(gateways[i].id, gateways[j].id, 'gw-gw', 0.7)
    }
  }

  for (let i = 0; i < forwarders.length; i++) {
    for (let j = i + 1; j < forwarders.length; j++) {
      addLink(forwarders[i].id, forwarders[j].id, 'fw-fw', 0.25)
    }
  }

  for (const fw of forwarders) {
    const parent = pickStableParent(fw.id, gateways)
    if (parent) {
      addLink(parent.id, fw.id, 'gw-fw', 0.5)
    }
  }

  for (const cam of cameras) {
    if (forwarders.length > 0) {
      const parent = pickStableParent(cam.id, forwarders)
      if (parent) {
        addLink(parent.id, cam.id, 'fw-cam', 0.35)
      }
    } else if (gateways.length > 0) {
      const parent = pickStableParent(cam.id, gateways)
      if (parent) {
        addLink(parent.id, cam.id, 'gw-cam', 0.4)
      }
    }
  }

  const centerNode = gateways[0] || forwarders[0] || cameras[0]
  if (centerNode) {
    for (const o of others) {
      addLink(centerNode.id, o.id, 'misc', 0.25)
    }
  }

  return links
}

export default function TopologyGraph({ devices, onSelectDevice, selectedDevice }) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [, forceUpdate] = useState(0)
  const simulationRef = useRef(null)
  const nodesRef = useRef([])
  const linksRef = useRef([])
  const [dragging, setDragging] = useState(null)
  const [hovered, setHovered] = useState(null)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setDimensions({ width, height })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0) return

    if (!initializedRef.current) {
      initSimulation(devices, dimensions)
      initializedRef.current = true
    } else {
      updateSimulation(devices, dimensions)
    }
  }, [devices, dimensions])

  const initSimulation = (devs, dims) => {
    const width = dims.width
    const height = dims.height

    const simNodes = devs.map(d => ({
      id: d.ip,
      ...d,
      style: DEVICE_STYLES[d.type] || DEVICE_STYLES.device,
      x: width / 2 + (Math.random() - 0.5) * 300,
      y: height / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null
    }))

    const simLinks = buildStableLinks(simNodes)

    nodesRef.current = simNodes
    linksRef.current = simLinks

    const simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink(simLinks).id(d => d.id).distance(d => {
        if (d.type === 'gw-gw') return 220
        if (d.type === 'gw-fw') return 170
        if (d.type === 'fw-fw') return 150
        if (d.type === 'fw-cam' || d.type === 'gw-cam') return 140
        return 160
      }).strength(d => d.strength || 0.5))
      .force('charge', d3.forceManyBody().strength(d => {
        if (d.type === 'gateway') return -450
        if (d.type === 'forwarder') return -350
        if (d.type === 'camera') return -220
        return -160
      }))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.04))
      .force('collision', d3.forceCollide().radius(d => d.style.size + 24))
      .force('x', d3.forceX(width / 2).strength(0.02))
      .force('y', d3.forceY(height / 2).strength(0.02))
      .alphaDecay(0.025)
      .on('tick', () => {
        forceUpdate(t => t + 1)
      })

    simulationRef.current = simulation
    simulation.alpha(1).restart()
  }

  const updateSimulation = (devs, dims) => {
    const simulation = simulationRef.current
    if (!simulation) return

    const width = dims.width
    const height = dims.height
    const oldNodes = nodesRef.current
    const oldNodeMap = new Map(oldNodes.map(n => [n.id, n]))

    const newNodes = devs.map(d => {
      const old = oldNodeMap.get(d.ip)
      if (old) {
        return {
          ...old,
          ...d,
          style: DEVICE_STYLES[d.type] || DEVICE_STYLES.device,
          id: d.ip
        }
      } else {
        return {
          id: d.ip,
          ...d,
          style: DEVICE_STYLES[d.type] || DEVICE_STYLES.device,
          x: width / 2 + (Math.random() - 0.5) * 100,
          y: height / 2 + (Math.random() - 0.5) * 100,
          vx: 0,
          vy: 0,
          fx: null,
          fy: null
        }
      }
    })

    const newLinks = buildStableLinks(newNodes)

    nodesRef.current = newNodes
    linksRef.current = newLinks

    simulation.nodes(newNodes)
    simulation.force('link').links(newLinks)

    simulation.force('center', d3.forceCenter(width / 2, height / 2).strength(0.04))
    simulation.force('x', d3.forceX(width / 2).strength(0.02))
    simulation.force('y', d3.forceY(height / 2).strength(0.02))

    simulation.alpha(0.6).restart()
  }

  const handleMouseDown = useCallback((e, node) => {
    e.stopPropagation()
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    dragOffsetRef.current = {
      x: e.clientX - rect.left - node.x,
      y: e.clientY - rect.top - node.y
    }
    node.fx = node.x
    node.fy = node.y
    setDragging(node.id)
    if (simulationRef.current) {
      simulationRef.current.alphaTarget(0.3).restart()
    }
  }, [])

  const handleMouseMove = useCallback((e) => {
    if (!dragging) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const node = nodesRef.current.find(n => n.id === dragging)
    if (node) {
      node.fx = e.clientX - rect.left - dragOffsetRef.current.x
      node.fy = e.clientY - rect.top - dragOffsetRef.current.y
    }
  }, [dragging])

  const handleMouseUp = useCallback(() => {
    if (dragging) {
      const node = nodesRef.current.find(n => n.id === dragging)
      if (node) {
        node.fx = null
        node.fy = null
      }
      if (simulationRef.current) {
        simulationRef.current.alphaTarget(0)
      }
      setDragging(null)
    }
  }, [dragging])

  const getLinkPath = (link) => {
    const source = typeof link.source === 'object' ? link.source : nodesRef.current.find(n => n.id === link.source)
    const target = typeof link.target === 'object' ? link.target : nodesRef.current.find(n => n.id === link.target)
    if (!source || !target) return ''
    const dx = target.x - source.x
    const dy = target.y - source.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    const offset = dist * 0.08
    const mx = (source.x + target.x) / 2 - (dy / dist) * offset
    const my = (source.y + target.y) / 2 + (dx / dist) * offset
    return `M ${source.x} ${source.y} Q ${mx} ${my} ${target.x} ${target.y}`
  }

  const isLinkHighlighted = (link) => {
    if (!selectedDevice && !hovered) return false
    const targetId = selectedDevice?.ip || hovered
    if (!targetId) return false
    const srcId = typeof link.source === 'object' ? link.source.id : link.source
    const tgtId = typeof link.target === 'object' ? link.target.id : link.target
    return srcId === targetId || tgtId === targetId
  }

  const isNodeHighlighted = (node) => {
    if (!selectedDevice && !hovered) return false
    const targetId = selectedDevice?.ip || hovered
    if (!targetId) return false
    if (node.id === targetId) return true
    return linksRef.current.some(l => {
      const srcId = typeof l.source === 'object' ? l.source.id : l.source
      const tgtId = typeof l.target === 'object' ? l.target.id : l.target
      return (srcId === targetId && tgtId === node.id) || (tgtId === targetId && srcId === node.id)
    })
  }

  const getLinkKey = (link) => {
    const srcId = typeof link.source === 'object' ? link.source.id : link.source
    const tgtId = typeof link.target === 'object' ? link.target.id : link.target
    return [srcId, tgtId].sort().join('|')
  }

  return (
    <div
      ref={containerRef}
      className="topology-container"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="topology-svg"
      >
        <defs>
          <radialGradient id="bgGradient" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="#111827" />
            <stop offset="100%" stopColor="#0a0e1a" />
          </radialGradient>

          {Object.entries(DEVICE_STYLES).map(([key, style]) => (
            <radialGradient key={`glow-${key}`} id={`glow-${key}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={style.color} stopOpacity="0.6" />
              <stop offset="50%" stopColor={style.color} stopOpacity="0.2" />
              <stop offset="100%" stopColor={style.color} stopOpacity="0" />
            </radialGradient>
          ))}

          <filter id="blur-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width="100%" height="100%" fill="url(#bgGradient)" />

        <GridBackground width={dimensions.width} height={dimensions.height} />

        <g className="links-layer">
          {linksRef.current.map((link) => {
            const highlighted = isLinkHighlighted(link)
            const source = typeof link.source === 'object' ? link.source : nodesRef.current.find(n => n.id === link.source)
            const color = source?.style?.color || '#3b82f6'
            const linkKey = getLinkKey(link)
            return (
              <g key={linkKey}>
                <path
                  d={getLinkPath(link)}
                  fill="none"
                  stroke={color}
                  strokeWidth={highlighted ? 2.5 : 1.2}
                  strokeOpacity={highlighted ? 0.8 : 0.3}
                  strokeDasharray={highlighted ? 'none' : '4 4'}
                  style={{
                    filter: highlighted ? `drop-shadow(0 0 6px ${color})` : 'none',
                    transition: 'all 0.3s ease'
                  }}
                />
                {highlighted && (
                  <path
                    d={getLinkPath(link)}
                    fill="none"
                    stroke={color}
                    strokeWidth="3"
                    strokeOpacity="0.2"
                  >
                    <animate
                      attributeName="stroke-dasharray"
                      from="0 1000"
                      to="1000 0"
                      dur="1s"
                      repeatCount="indefinite"
                    />
                  </path>
                )}
              </g>
            )
          })}
        </g>

        <g className="nodes-layer">
          {nodesRef.current.map(node => {
            const selected = selectedDevice?.ip === node.id
            const isHovered = hovered === node.id
            const highlighted = isNodeHighlighted(node)
            const dim = (selectedDevice || hovered) && !highlighted
            const style = node.style
            const isNew = node.status === 'new'

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                className={`node-group ${selected ? 'selected' : ''} ${isNew ? 'is-new' : ''}`}
                style={{
                  cursor: dragging === node.id ? 'grabbing' : 'grab',
                  opacity: dim ? 0.25 : 1,
                  transition: 'opacity 0.3s ease'
                }}
                onMouseDown={(e) => handleMouseDown(e, node)}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelectDevice && onSelectDevice({ ...node })
                }}
              >
                <circle
                  r={style.size * 1.8}
                  fill={`url(#glow-${node.type})`}
                  opacity={selected || isHovered ? 0.8 : 0.4}
                  style={{ transition: 'all 0.3s ease' }}
                />

                {Array.from({ length: style.ringCount }).map((_, ringIdx) => (
                  <circle
                    key={`ring-${ringIdx}`}
                    r={style.size + 6 + ringIdx * 8}
                    fill="none"
                    stroke={style.color}
                    strokeWidth="1"
                    strokeOpacity={(selected || isHovered) ? 0.5 - ringIdx * 0.15 : 0.2 - ringIdx * 0.05}
                  >
                    <animate
                      attributeName="r"
                      values={`${style.size + 4 + ringIdx * 8};${style.size + 14 + ringIdx * 8};${style.size + 4 + ringIdx * 8}`}
                      dur={`${2 + ringIdx * 0.5}s`}
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="stroke-opacity"
                      values={`${0.5 - ringIdx * 0.1};${0.1 - ringIdx * 0.02};${0.5 - ringIdx * 0.1}`}
                      dur={`${2 + ringIdx * 0.5}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                ))}

                <circle
                  r={style.size}
                  fill={`${style.color}15`}
                  stroke={style.color}
                  strokeWidth={selected ? 3 : 2}
                  style={{
                    filter: `drop-shadow(0 0 ${selected ? 12 : 6}px ${style.glow})`,
                    transition: 'all 0.3s ease'
                  }}
                />

                <text
                  y="1"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={style.size * 0.55}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {style.icon}
                </text>

                <g transform={`translate(0, ${style.size + 18})`}>
                  <rect
                    x={-60}
                    y={-10}
                    width={120}
                    height={22}
                    rx={4}
                    fill="rgba(10, 14, 26, 0.85)"
                    stroke={selected ? style.color : 'rgba(0, 229, 255, 0.15)'}
                    strokeWidth={selected ? 1.5 : 0.5}
                    style={{
                      filter: selected ? `drop-shadow(0 0 4px ${style.glow})` : 'none',
                      transition: 'all 0.3s ease'
                    }}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    y={1}
                    fontSize="11"
                    fill={selected ? style.color : 'var(--text-primary)'}
                    fontWeight="500"
                    style={{ pointerEvents: 'none', userSelect: 'none', fontFamily: 'monospace' }}
                  >
                    {node.ip}
                  </text>
                </g>

                {(selected || isHovered) && node.name && (
                  <g transform={`translate(0, ${-style.size - 18})`}>
                    <rect
                      x={-70}
                      y={-10}
                      width={140}
                      height={22}
                      rx={11}
                      fill={style.color}
                      opacity="0.9"
                      style={{ filter: `drop-shadow(0 0 6px ${style.glow})` }}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      y={1}
                      fontSize="11"
                      fill="#0a0e1a"
                      fontWeight="700"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {node.name}
                    </text>
                  </g>
                )}

                {isNew && (
                  <g transform={`translate(${style.size - 6}, ${-style.size + 6})`}>
                    <circle r="10" fill="#ef4444" />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      y={1}
                      fontSize="9"
                      fill="white"
                      fontWeight="700"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      新
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        </g>

        {nodesRef.current.length === 0 && (
          <EmptyState width={dimensions.width} height={dimensions.height} />
        )}
      </svg>
    </div>
  )
}

function GridBackground({ width, height }) {
  const spacing = 50
  const lines = []
  for (let x = 0; x <= width; x += spacing) {
    lines.push(
      <line
        key={`v-${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={height}
        stroke="rgba(0, 229, 255, 0.04)"
        strokeWidth="1"
      />
    )
  }
  for (let y = 0; y <= height; y += spacing) {
    lines.push(
      <line
        key={`h-${y}`}
        x1={0}
        y1={y}
        x2={width}
        y2={y}
        stroke="rgba(0, 229, 255, 0.04)"
        strokeWidth="1"
      />
    )
  }
  return <g className="grid-bg">{lines}</g>
}

function EmptyState({ width, height }) {
  return (
    <g transform={`translate(${width / 2}, ${height / 2})`}>
      <circle r="80" fill="none" stroke="rgba(0, 229, 255, 0.15)" strokeWidth="1" strokeDasharray="4 4">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0"
          to="360"
          dur="40s"
          repeatCount="indefinite"
        />
      </circle>
      <circle r="120" fill="none" stroke="rgba(59, 130, 246, 0.1)" strokeWidth="1" strokeDasharray="2 6">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="360"
          to="0"
          dur="60s"
          repeatCount="indefinite"
        />
      </circle>
      <text y="-20" textAnchor="middle" fontSize="16" fill="var(--text-secondary)" fontWeight="500">
        暂无发现设备
      </text>
      <text y="10" textAnchor="middle" fontSize="13" fill="var(--text-muted)">
        点击左侧「开始扫描」按钮发现局域网设备
      </text>
    </g>
  )
}
