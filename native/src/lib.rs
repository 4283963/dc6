use neon::prelude::*;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::sync::Semaphore;

const DEFAULT_PORTS: [u16; 4] = [554, 8554, 8000, 8080];
const DEFAULT_TIMEOUT_MS: u64 = 1500;
const DEFAULT_CONCURRENCY: usize = 100;

const DEFAULT_NETWORKS: [(Ipv4Addr, Ipv4Addr); 3] = [
    (Ipv4Addr::new(192, 168, 1, 0), Ipv4Addr::new(255, 255, 255, 0)),
    (Ipv4Addr::new(192, 168, 0, 0), Ipv4Addr::new(255, 255, 255, 0)),
    (Ipv4Addr::new(10, 0, 0, 0), Ipv4Addr::new(255, 255, 255, 0)),
];

fn infer_device_type(port: u16) -> &'static str {
    match port {
        554 => "camera",
        8554 => "gateway",
        8000 | 8080 => "forwarder",
        _ => "device",
    }
}

fn ip_to_long(ip: Ipv4Addr) -> u32 {
    u32::from(ip)
}

fn long_to_ip(long: u32) -> Ipv4Addr {
    Ipv4Addr::from(long)
}

fn parse_network(s: &str) -> Option<(Ipv4Addr, Ipv4Addr)> {
    let parts: Vec<&str> = s.split('/').collect();
    if parts.len() == 2 {
        let ip: Ipv4Addr = parts[0].parse().ok()?;
        let prefix: u32 = parts[1].parse().ok()?;
        if prefix <= 32 {
            let mask = if prefix == 0 {
                0u32
            } else {
                u32::MAX << (32 - prefix)
            };
            return Some((ip, long_to_ip(mask)));
        }
    }
    None
}

fn enumerate_targets(networks: &[(Ipv4Addr, Ipv4Addr)], ports: &[u16]) -> Vec<(Ipv4Addr, u16)> {
    let mut targets = Vec::new();
    for (ip, mask) in networks {
        let ip_long = ip_to_long(*ip);
        let mask_long = ip_to_long(*mask);
        let network = ip_long & mask_long;
        let broadcast = network | !mask_long;
        for host_long in (network + 1)..broadcast {
            let host_ip = long_to_ip(host_long);
            for &port in ports {
                targets.push((host_ip, port));
            }
        }
    }
    targets
}

async fn check_port(ip: Ipv4Addr, port: u16, timeout_ms: u64) -> bool {
    let addr = SocketAddr::new(IpAddr::V4(ip), port);
    let fut = TcpStream::connect(addr);
    match tokio::time::timeout(Duration::from_millis(timeout_ms), fut).await {
        Ok(Ok(mut stream)) => {
            let _ = stream.shutdown().await;
            true
        }
        _ => false,
    }
}

async fn scan_network_inner(
    networks: Vec<(Ipv4Addr, Ipv4Addr)>,
    ports: Vec<u16>,
    timeout_ms: u64,
    concurrency: usize,
) -> Vec<(String, Vec<u16>, String, f64)> {
    let nets = if networks.is_empty() {
        DEFAULT_NETWORKS.to_vec()
    } else {
        networks
    };

    let targets = enumerate_targets(&nets, &ports);
    let sem = Arc::new(Semaphore::new(concurrency));

    let mut handles = Vec::new();
    for (ip, port) in targets {
        let permit = sem.clone().acquire_owned().await.unwrap();
        handles.push(tokio::spawn(async move {
            let alive = check_port(ip, port, timeout_ms).await;
            drop(permit);
            if alive { Some((ip, port)) } else { None }
        }));
    }

    let mut alive_map: HashMap<Ipv4Addr, Vec<u16>> = HashMap::new();
    for h in handles {
        if let Ok(Some((ip, port))) = h.await {
            alive_map.entry(ip).or_default().push(port);
        }
    }

    let mut devices = Vec::new();
    for (ip, ports_found) in alive_map {
        let mut type_ = "device";
        for &p in &ports_found {
            let t = infer_device_type(p);
            if t == "camera" {
                type_ = "camera";
                break;
            }
            if t == "gateway" && type_ != "camera" {
                type_ = "gateway";
            }
        }

        let ip_str = ip.to_string();
        let type_str = type_.to_string();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);

        devices.push((ip_str, ports_found, type_str, timestamp));
    }

    devices
}

fn scan_rtsp_ports(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let ports_arg = cx.argument_opt(0);
    let mut ports: Vec<u16> = DEFAULT_PORTS.to_vec();
    let mut timeout_ms = DEFAULT_TIMEOUT_MS;
    let mut concurrency = DEFAULT_CONCURRENCY;
    let mut networks: Vec<(Ipv4Addr, Ipv4Addr)> = Vec::new();

    if let Some(arg) = ports_arg {
        if arg.is_a::<JsObject, _>(&mut cx) {
            let obj = arg.downcast_or_throw::<JsObject, _>(&mut cx)?;

            if let Ok(arr) = obj.get(&mut cx, "ports") {
                if arr.is_a::<JsArray, _>(&mut cx) {
                    let arr = arr.downcast_or_throw::<JsArray, _>(&mut cx)?;
                    let mut p = Vec::new();
                    for i in 0..arr.len(&mut cx) {
                        if let Ok(n) = arr.get(&mut cx, i) {
                            if let Ok(num) = n.downcast::<JsNumber, _>(&mut cx) {
                                p.push(num.value(&mut cx) as u16);
                            }
                        }
                    }
                    if !p.is_empty() {
                        ports = p;
                    }
                }
            }

            if let Ok(t) = obj.get(&mut cx, "timeout") {
                if let Ok(num) = t.downcast::<JsNumber, _>(&mut cx) {
                    timeout_ms = num.value(&mut cx) as u64;
                }
            }

            if let Ok(c) = obj.get(&mut cx, "concurrency") {
                if let Ok(num) = c.downcast::<JsNumber, _>(&mut cx) {
                    concurrency = num.value(&mut cx) as usize;
                }
            }

            if let Ok(networks_val) = obj.get(&mut cx, "networks") {
                if networks_val.is_a::<JsArray, _>(&mut cx) {
                    let arr = networks_val.downcast_or_throw::<JsArray, _>(&mut cx)?;
                    for i in 0..arr.len(&mut cx) {
                        if let Ok(n) = arr.get(&mut cx, i) {
                            if let Ok(s) = n.downcast::<JsString, _>(&mut cx) {
                                let s_val = s.value(&mut cx);
                                if let Some(net) = parse_network(&s_val) {
                                    networks.push(net);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");

    std::thread::spawn(move || {
        let devices = rt.block_on(scan_network_inner(networks, ports, timeout_ms, concurrency));
        deferred.settle_with(&channel, move |mut cx| {
            let arr = JsArray::new(&mut cx, devices.len() as u32);
            for (i, (ip_str, ports_found, type_str, timestamp)) in devices.iter().enumerate() {
                let obj = JsObject::new(&mut cx);
                let ip = cx.string(ip_str);
                let type_s = cx.string(type_str);
                let ts = cx.number(*timestamp);

                let ports_arr = JsArray::new(&mut cx, ports_found.len() as u32);
                for (j, p) in ports_found.iter().enumerate() {
                    let p_num = cx.number(*p as f64);
                    ports_arr.set(&mut cx, j as u32, p_num)?;
                }

                obj.set(&mut cx, "ip", ip)?;
                obj.set(&mut cx, "ports", ports_arr)?;
                obj.set(&mut cx, "type", type_s)?;
                obj.set(&mut cx, "timestamp", ts)?;
                arr.set(&mut cx, i as u32, obj)?;
            }
            Ok(arr.upcast())
        });
    });

    Ok(promise)
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("scanRtspPorts", scan_rtsp_ports)?;
    Ok(())
}
