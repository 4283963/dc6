const net = require('net')
const os = require('os')

const DEFAULT_RTSP_PORTS = [554, 8554, 8000, 8080]
const DEFAULT_TIMEOUT = 800

function getLocalNetworks() {
  const nets = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        nets.push(iface)
      }
    }
  }
  return nets
}

function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10) >>> 0
}

function longToIp(long) {
  return [
    (long >>> 24) & 255,
    (long >>> 16) & 255,
    (long >>> 8) & 255,
    long & 255
  ].join('.')
}

function getCidrRange(ip, netmask) {
  const ipLong = ipToLong(ip)
  const maskLong = ipToLong(netmask)
  const network = ipLong & maskLong
  const broadcast = network | (~maskLong >>> 0)
  return { network, broadcast }
}

function checkPort(ip, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(timeout)
    let connected = false
    socket.on('connect', () => {
      connected = true
      socket.destroy()
      resolve({ ip, port, alive: true })
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve({ ip, port, alive: false })
    })
    socket.on('error', () => {
      resolve({ ip, port, alive: false })
    })
    socket.connect(port, ip)
  })
}

async function scanRtspPorts(options = {}) {
  const ports = options.ports || DEFAULT_RTSP_PORTS
  const timeout = options.timeout || DEFAULT_TIMEOUT
  const concurrency = options.concurrency || 50

  const networks = getLocalNetworks()
  const targets = []

  for (const net of networks) {
    const { network, broadcast } = getCidrRange(net.address, net.netmask)
    for (let ipLong = network + 1; ipLong < broadcast; ipLong++) {
      const ip = longToIp(ipLong)
      for (const port of ports) {
        targets.push({ ip, port })
      }
    }
  }

  const alive = []
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(t => checkPort(t.ip, t.port, timeout))
    )
    for (const r of results) {
      if (r.alive) {
        alive.push({
          ip: r.ip,
          port: r.port,
          type: inferDeviceType(r.port),
          timestamp: Date.now()
        })
      }
    }
  }

  const devices = mergeByIp(alive)
  return devices
}

function inferDeviceType(port) {
  if (port === 554) return 'camera'
  if (port === 8554) return 'gateway'
  if (port === 8000 || port === 8080) return 'forwarder'
  return 'device'
}

function mergeByIp(aliveList) {
  const map = new Map()
  for (const item of aliveList) {
    if (!map.has(item.ip)) {
      map.set(item.ip, {
        ip: item.ip,
        ports: [],
        type: item.type,
        timestamp: item.timestamp
      })
    }
    const dev = map.get(item.ip)
    dev.ports.push(item.port)
    if (item.type === 'camera') dev.type = 'camera'
    else if (dev.type !== 'camera' && item.type === 'gateway') dev.type = 'gateway'
  }
  return Array.from(map.values())
}

module.exports = { scanRtspPorts }
