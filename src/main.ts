import { samples, SampleScenario } from "./data/samples";
import { simulatePing } from "./sim/simulator";
import { Device, DeviceKind, EthernetFrame, Link, PingOptions, Topology } from "./sim/types";
import "./styles.css";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("Missing #app");
const root = appRoot;

let selectedSample = samples[0];
let topology = cloneTopology(selectedSample.topology);
let selectedDeviceId = topology.devices[0]?.id ?? "";
let linkStart: { deviceId: string; portId: string } | undefined;
let ping: PingOptions = { ...selectedSample.ping };
let result = simulatePing(topology, ping);
let showInterfaceLabels = false;

interface DragState {
  deviceId: string;
  startX: number;
  startY: number;
  pointerStartX: number;
  pointerStartY: number;
  moved: boolean;
}

let dragState: DragState | undefined;

function render(): void {
  const selectedDevice = topology.devices.find((device) => device.id === selectedDeviceId);
  root.innerHTML = `
    <header class="app-header">
      <div>
        <p class="eyebrow">Deterministic network simulator</p>
        <h1>RouteLab</h1>
      </div>
      <div class="scenario-picker">
        <label for="sample">Scenario</label>
        <select id="sample">
          ${samples.map((sample) => `<option value="${sample.id}" ${sample.id === selectedSample.id ? "selected" : ""}>${sample.name}</option>`).join("")}
        </select>
      </div>
    </header>

    <main class="workspace">
      <section class="topology-pane">
        <div class="toolbar">
          <button data-add="host">Add host</button>
          <button data-add="switch">Add switch</button>
          <button data-add="router">Add router</button>
          <button id="clear-link">${linkStart ? "Cancel link" : "Link mode"}</button>
          <label class="toggle"><input id="show-addresses" type="checkbox" ${showInterfaceLabels ? "checked" : ""} /> Show IP/MAC labels</label>
        </div>
        <svg id="topology-svg" class="topology" viewBox="0 0 900 360" role="img" aria-label="Network topology">
          ${renderSubnetGroups()}
          ${renderLinks(topology.links)}
          ${topology.devices.map(renderDevice).join("")}
        </svg>
        <p class="hint">${linkStart ? `Choose another device port to link from ${linkStart.deviceId}.${linkStart.portId}.` : `${selectedSample.description} Drag devices to reposition them.`}</p>
      </section>

      <aside class="config-pane">
        <h2>Device config</h2>
        ${selectedDevice ? renderDeviceConfig(selectedDevice) : "<p>Select a device to edit it.</p>"}
      </aside>

      <section class="run-pane">
        <h2>Ping</h2>
        <div class="form-grid">
          <label>From host <select id="ping-from">${topology.devices.filter((device) => device.kind === "host").map((device) => `<option value="${device.id}" ${device.id === ping.fromHostId ? "selected" : ""}>${device.name}</option>`).join("")}</select></label>
          <label>To IP <input id="ping-to" value="${ping.toIp}" /></label>
          <label>TTL <input id="ping-ttl" type="number" min="1" max="64" value="${ping.ttl ?? 8}" /></label>
        </div>
        <button id="run">Run deterministic simulation</button>
      </section>

      <section class="results">
        <div>
          <h2>Traversal</h2>
          <ol class="traversal-list">
            ${result.traversals.map((item) => `
              <li>
                <span class="step-index">${item.id}</span>
                <div class="step-body">
                  <div class="step-title">
                    <span>${item.reason}</span>
                    <span class="protocol-badge">${frameBadge(item.frame)}</span>
                  </div>
                  <div class="step-meta">${item.from.deviceId}.${item.from.portId} <span>to</span> ${item.to.deviceId}.${item.to.portId}</div>
                  <div class="step-detail">${frameDetail(item.frame)}</div>
                </div>
              </li>
            `).join("")}
          </ol>
        </div>
        <div>
          <h2>Ordered log</h2>
          <ol class="log-list">
            ${result.log.map((entry) => `
              <li class="${entry.level}">
                <span class="log-time">t=${entry.time}</span>
                <span class="log-level">${entry.level}</span>
                <span class="log-message">${entry.message}</span>
              </li>
            `).join("")}
          </ol>
        </div>
      </section>

      <section class="tables">
        <h2>Tables</h2>
        ${renderTables()}
      </section>
    </main>
  `;

  bindEvents();
}

function renderSubnetGroups(): string {
  return subnetGroups().map((group, index) => {
    const palette = (index % 4) + 1;
    return `
      <g class="subnet-group palette-${palette}">
        <rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="8"></rect>
        <text x="${group.x + 12}" y="${group.y + 20}">${group.label}</text>
      </g>
    `;
  }).join("");
}

function renderLinks(links: Link[]): string {
  return links.map((link) => {
    const a = topology.devices.find((device) => device.id === link.a.deviceId);
    const b = topology.devices.find((device) => device.id === link.b.deviceId);
    if (!a || !b) return "";
    return `<line class="link" data-link="${link.id}" data-a-device="${link.a.deviceId}" data-b-device="${link.b.deviceId}" x1="${a.position.x}" y1="${a.position.y}" x2="${b.position.x}" y2="${b.position.y}" />`;
  }).join("");
}

function renderDevice(device: Device): string {
  const selected = device.id === selectedDeviceId ? " selected" : "";
  const box = deviceBox(device);
  const portLabel = device.kind === "host" ? "eth0" : device.ports.map((port) => port.id).join(" ");
  const detailLines = showInterfaceLabels ? interfaceLines(device) : [];
  return `
    <g class="device ${device.kind}${selected}" data-device="${device.id}" transform="translate(${device.position.x} ${device.position.y})" tabindex="0">
      <rect x="${-box.width / 2}" y="${-box.height / 2}" width="${box.width}" height="${box.height}" rx="8"></rect>
      <text y="${detailLines.length ? -box.height / 2 + 20 : -4}" text-anchor="middle">${device.name}</text>
      ${detailLines.length
        ? detailLines.map((line, index) => `<text y="${-box.height / 2 + 40 + index * 14}" text-anchor="middle" class="address">${line}</text>`).join("")
        : `<text y="16" text-anchor="middle" class="ports">${portLabel}</text>`}
    </g>
  `;
}

function renderDeviceConfig(device: Device): string {
  const base = `
    <label>Name <input data-field="name" value="${device.name}" /></label>
  `;

  if (device.kind === "host") {
    const config = device.ports[0].config;
    return `${base}
      <label>IP <input data-field="host-ip" value="${config.ip}" /></label>
      <label>Mask <input data-field="host-mask" type="number" value="${config.mask}" /></label>
      <label>MAC <input data-field="host-mac" value="${config.mac}" /></label>
      <label>Gateway <input data-field="host-gateway" value="${config.gateway ?? ""}" /></label>
    `;
  }

  if (device.kind === "router") {
    return `${base}
      <div class="port-editor">
        ${device.ports.map((port) => `
          <fieldset>
            <legend>${port.id}</legend>
            <label>IP <input data-router-port="${port.id}" data-router-field="ip" value="${port.config.ip}" /></label>
            <label>Mask <input data-router-port="${port.id}" data-router-field="mask" type="number" value="${port.config.mask}" /></label>
            <label>MAC <input data-router-port="${port.id}" data-router-field="mac" value="${port.config.mac}" /></label>
          </fieldset>
        `).join("")}
      </div>
      <label>Static routes
        <textarea id="routes">${device.routes.map((route) => `${route.prefix}/${route.mask} ${route.nextHop ?? "direct"} ${route.outPortId}`).join("\n")}</textarea>
      </label>
      <small>Format: prefix/mask nextHop-or-direct outPort</small>
    `;
  }

  return `${base}<p>Switch ports: ${device.ports.map((port) => port.id).join(", ")}</p>`;
}

function renderTables(): string {
  const switchTables = Object.entries(result.tables.switchMacTables).map(([deviceId, rows]) => tableBlock(
    `${deviceName(deviceId)} MAC table`,
    ["MAC", "Port"],
    rows.map((row) => [row.mac, row.portId]),
  )).join("");

  const arpTables = Object.entries(result.tables.arpTables).map(([deviceId, rows]) => tableBlock(
    `${deviceName(deviceId)} ARP table`,
    ["IP", "MAC"],
    rows.map((row) => [row.ip, row.mac]),
  )).join("");

  const routeTables = Object.entries(result.tables.routerRoutingTables).map(([deviceId, rows]) => tableBlock(
    `${deviceName(deviceId)} routing table`,
    ["Prefix", "Next hop", "Port"],
    rows.map((row) => [`${row.prefix}/${row.mask}`, row.nextHop ?? "direct", row.outPortId]),
  )).join("");

  return `<div class="table-grid">${switchTables}${arpTables}${routeTables}</div>`;
}

function tableBlock(title: string, headers: string[], rows: string[][]): string {
  return `
    <div class="table-block">
      <h3>${title}</h3>
      <table>
        <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
        <tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">Empty</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function frameBadge(frame: EthernetFrame): string {
  return frame.etherType;
}

function frameDetail(frame: EthernetFrame): string {
  if (frame.etherType === "ARP") {
    const arp = frame.payload as { kind: string; senderIp: string; targetIp: string };
    return arp.kind === "request"
      ? `Request from ${arp.senderIp} for ${arp.targetIp}`
      : `Reply from ${arp.senderIp} to ${arp.targetIp}`;
  }
  const ip = frame.payload as { srcIp: string; dstIp: string; ttl: number; payload: { kind: string } };
  return `${ip.payload.kind} ${ip.srcIp} -> ${ip.dstIp}, TTL ${ip.ttl}, ${frame.srcMac} -> ${frame.dstMac}`;
}

function bindEvents(): void {
  document.querySelector<HTMLSelectElement>("#sample")?.addEventListener("change", (event) => {
    const id = (event.target as HTMLSelectElement).value;
    selectedSample = samples.find((sample) => sample.id === id) as SampleScenario;
    topology = cloneTopology(selectedSample.topology);
    selectedDeviceId = topology.devices[0]?.id ?? "";
    ping = { ...selectedSample.ping };
    result = simulatePing(topology, ping);
    linkStart = undefined;
    render();
  });

  document.querySelectorAll<SVGGElement>("[data-device]").forEach((node) => {
    node.addEventListener("pointerdown", (event) => {
      const svgPoint = eventToSvgPoint(event);
      const device = topology.devices.find((item) => item.id === node.dataset.device);
      if (!device || !svgPoint) return;
      dragState = {
        deviceId: device.id,
        startX: device.position.x,
        startY: device.position.y,
        pointerStartX: svgPoint.x,
        pointerStartY: svgPoint.y,
        moved: false,
      };
      node.setPointerCapture(event.pointerId);
    });

    node.addEventListener("pointermove", (event) => {
      if (!dragState || dragState.deviceId !== node.dataset.device) return;
      const svgPoint = eventToSvgPoint(event);
      if (!svgPoint) return;
      const nextX = clamp(dragState.startX + svgPoint.x - dragState.pointerStartX, 55, 845);
      const nextY = clamp(dragState.startY + svgPoint.y - dragState.pointerStartY, 45, 315);
      const movedDistance = Math.abs(nextX - dragState.startX) + Math.abs(nextY - dragState.startY);
      dragState.moved = dragState.moved || movedDistance > 3;
      moveDevicePreview(dragState.deviceId, nextX, nextY);
    });

    node.addEventListener("pointerup", () => {
      const deviceId = node.dataset.device ?? "";
      const wasDrag = dragState?.deviceId === deviceId && dragState.moved;
      if (wasDrag) {
        const device = topology.devices.find((item) => item.id === deviceId);
        const transform = node.getAttribute("transform") ?? "";
        const match = transform.match(/translate\(([-\d.]+)\s+([-\d.]+)\)/);
        if (device && match) {
          device.position.x = Number(match[1]);
          device.position.y = Number(match[2]);
        }
        dragState = undefined;
        render();
        return;
      }
      dragState = undefined;
      if (linkStart && linkStart.deviceId !== deviceId) {
        const target = firstFreePort(deviceId);
        if (target) {
          topology.links.push({ id: nextId("l"), a: linkStart, b: target });
          result = simulatePing(topology, ping);
        }
        linkStart = undefined;
      } else {
        selectedDeviceId = deviceId;
      }
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      addDevice(button.dataset.add as DeviceKind);
      result = simulatePing(topology, ping);
      render();
    });
  });

  document.querySelector<HTMLButtonElement>("#clear-link")?.addEventListener("click", () => {
    const selected = topology.devices.find((device) => device.id === selectedDeviceId);
    linkStart = selected ? firstFreePort(selected.id) : undefined;
    render();
  });

  document.querySelector<HTMLInputElement>("#show-addresses")?.addEventListener("change", (event) => {
    showInterfaceLabels = (event.target as HTMLInputElement).checked;
    render();
  });

  document.querySelectorAll<HTMLInputElement>("[data-field]").forEach((input) => {
    input.addEventListener("change", () => updateSelectedDevice(input.dataset.field ?? "", input.value));
  });

  document.querySelectorAll<HTMLInputElement>("[data-router-port]").forEach((input) => {
    input.addEventListener("change", () => updateRouterPort(input.dataset.routerPort ?? "", input.dataset.routerField ?? "", input.value));
  });

  document.querySelector<HTMLTextAreaElement>("#routes")?.addEventListener("change", (event) => updateRoutes((event.target as HTMLTextAreaElement).value));

  document.querySelector<HTMLButtonElement>("#run")?.addEventListener("click", () => {
    ping = {
      fromHostId: document.querySelector<HTMLSelectElement>("#ping-from")?.value ?? ping.fromHostId,
      toIp: document.querySelector<HTMLInputElement>("#ping-to")?.value ?? ping.toIp,
      ttl: Number(document.querySelector<HTMLInputElement>("#ping-ttl")?.value ?? 8),
    };
    result = simulatePing(topology, ping);
    render();
  });
}

function addDevice(kind: DeviceKind): void {
  const id = nextId(kind[0]);
  const position = { x: 110 + topology.devices.length * 80, y: 260 };
  if (kind === "host") {
    topology.devices.push({
      id,
      name: `Host ${id.toUpperCase()}`,
      kind,
      position,
      ports: [{ id: "eth0", config: { ip: "192.168.1.10", mask: 24, mac: `02:00:00:00:00:${topology.devices.length.toString(16).padStart(2, "0")}`, gateway: "192.168.1.1" } }],
    });
  }
  if (kind === "switch") {
    topology.devices.push({ id, name: `Switch ${id.toUpperCase()}`, kind, position, ports: [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }] });
  }
  if (kind === "router") {
    topology.devices.push({
      id,
      name: `Router ${id.toUpperCase()}`,
      kind,
      position,
      ports: [
        { id: "g0/0", config: { ip: "192.168.1.1", mask: 24, mac: `02:00:00:00:01:${topology.devices.length.toString(16).padStart(2, "0")}` } },
        { id: "g0/1", config: { ip: "192.168.2.1", mask: 24, mac: `02:00:00:00:02:${topology.devices.length.toString(16).padStart(2, "0")}` } },
      ],
      routes: [],
    });
  }
  selectedDeviceId = id;
}

function updateSelectedDevice(field: string, value: string): void {
  const device = topology.devices.find((item) => item.id === selectedDeviceId);
  if (!device) return;
  if (field === "name") device.name = value;
  if (device.kind === "host") {
    const config = device.ports[0].config;
    if (field === "host-ip") config.ip = value;
    if (field === "host-mask") config.mask = Number(value);
    if (field === "host-mac") config.mac = value;
    if (field === "host-gateway") config.gateway = value || undefined;
  }
  result = simulatePing(topology, ping);
  render();
}

function updateRouterPort(portId: string, field: string, value: string): void {
  const device = topology.devices.find((item): item is Extract<Device, { kind: "router" }> => item.id === selectedDeviceId && item.kind === "router");
  const port = device?.ports.find((item) => item.id === portId);
  if (!port) return;
  if (field === "ip") port.config.ip = value;
  if (field === "mask") port.config.mask = Number(value);
  if (field === "mac") port.config.mac = value;
  result = simulatePing(topology, ping);
  render();
}

function updateRoutes(text: string): void {
  const device = topology.devices.find((item): item is Extract<Device, { kind: "router" }> => item.id === selectedDeviceId && item.kind === "router");
  if (!device) return;
  device.routes = text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [prefixMask, nextHop, outPortId] = line.split(/\s+/);
    const [prefix, mask] = prefixMask.split("/");
    return { prefix, mask: Number(mask), nextHop: nextHop === "direct" ? undefined : nextHop, outPortId };
  });
  result = simulatePing(topology, ping);
  render();
}

function firstFreePort(deviceId: string): { deviceId: string; portId: string } | undefined {
  const device = topology.devices.find((item) => item.id === deviceId);
  if (!device) return undefined;
  const port = device.ports.find((item) => !topology.links.some((link) => (link.a.deviceId === deviceId && link.a.portId === item.id) || (link.b.deviceId === deviceId && link.b.portId === item.id)));
  return port ? { deviceId, portId: port.id } : undefined;
}

function subnetGroups(): Array<{ label: string; x: number; y: number; width: number; height: number }> {
  const memberships = new Map<string, Set<string>>();
  for (const device of topology.devices) {
    for (const subnet of deviceSubnets(device)) {
      const members = memberships.get(subnet) ?? new Set<string>();
      members.add(device.id);
      for (const neighborId of linkedSwitches(device.id)) {
        members.add(neighborId);
      }
      memberships.set(subnet, members);
    }
  }

  return [...memberships.entries()].map(([label, deviceIds]) => {
    const boxes = [...deviceIds].map((deviceId) => {
      const device = topology.devices.find((item) => item.id === deviceId);
      if (!device) return undefined;
      const box = deviceBox(device);
      return {
        left: device.position.x - box.width / 2,
        right: device.position.x + box.width / 2,
        top: device.position.y - box.height / 2,
        bottom: device.position.y + box.height / 2,
      };
    }).filter((box): box is { left: number; right: number; top: number; bottom: number } => Boolean(box));
    const padding = 22;
    const left = Math.max(8, Math.min(...boxes.map((box) => box.left)) - padding);
    const top = Math.max(8, Math.min(...boxes.map((box) => box.top)) - padding);
    const right = Math.min(892, Math.max(...boxes.map((box) => box.right)) + padding);
    const bottom = Math.min(352, Math.max(...boxes.map((box) => box.bottom)) + padding);
    return { label, x: left, y: top, width: right - left, height: bottom - top };
  });
}

function deviceSubnets(device: Device): string[] {
  if (device.kind === "host") {
    const config = device.ports[0].config;
    return [subnetLabel(config.ip, config.mask)];
  }
  if (device.kind === "router") {
    return device.ports.map((port) => subnetLabel(port.config.ip, port.config.mask));
  }
  return [];
}

function linkedSwitches(deviceId: string): string[] {
  return topology.links.flatMap((link) => {
    const peer = link.a.deviceId === deviceId ? link.b.deviceId : link.b.deviceId === deviceId ? link.a.deviceId : undefined;
    const peerDevice = peer ? topology.devices.find((device) => device.id === peer) : undefined;
    return peerDevice?.kind === "switch" ? [peerDevice.id] : [];
  });
}

function subnetLabel(ip: string, mask: number): string {
  return `${intToIp(ipToIntLocal(ip) & maskToIntLocal(mask))}/${mask}`;
}

function ipToIntLocal(ip: string): number {
  return ip.split(".").map(Number).reduce((value, part) => ((value << 8) | part) >>> 0, 0);
}

function maskToIntLocal(mask: number): number {
  return mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
}

function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

function deviceBox(device: Device): { width: number; height: number } {
  if (!showInterfaceLabels) return { width: 96, height: 60 };
  if (device.kind === "router") return { width: 190, height: 104 };
  if (device.kind === "host") return { width: 170, height: 78 };
  return { width: 126, height: 64 };
}

function interfaceLines(device: Device): string[] {
  if (device.kind === "host") {
    const config = device.ports[0].config;
    return [`IP ${config.ip}/${config.mask}`, `MAC ${config.mac}`];
  }
  if (device.kind === "router") {
    return device.ports.flatMap((port, index) => [
      `${index === 0 ? "Upper" : "Lower"} ${port.id} IP ${port.config.ip}/${port.config.mask}`,
      `${port.id} MAC ${port.config.mac}`,
    ]);
  }
  return [`Ports ${device.ports.map((port) => port.id).join(", ")}`];
}

function eventToSvgPoint(event: PointerEvent): DOMPoint | undefined {
  const svg = document.querySelector<SVGSVGElement>("#topology-svg");
  if (!svg) return undefined;
  const matrix = svg.getScreenCTM();
  if (!matrix) return undefined;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(matrix.inverse());
}

function moveDevicePreview(deviceId: string, x: number, y: number): void {
  const node = document.querySelector<SVGGElement>(`[data-device="${deviceId}"]`);
  if (!node) return;
  node.setAttribute("transform", `translate(${Math.round(x)} ${Math.round(y)})`);
  document.querySelectorAll<SVGLineElement>(`[data-a-device="${deviceId}"]`).forEach((line) => {
    line.setAttribute("x1", String(Math.round(x)));
    line.setAttribute("y1", String(Math.round(y)));
  });
  document.querySelectorAll<SVGLineElement>(`[data-b-device="${deviceId}"]`).forEach((line) => {
    line.setAttribute("x2", String(Math.round(x)));
    line.setAttribute("y2", String(Math.round(y)));
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nextId(prefix: string): string {
  let index = topology.devices.length + topology.links.length + 1;
  while (topology.devices.some((device) => device.id === `${prefix}${index}`) || topology.links.some((link) => link.id === `${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

function deviceName(deviceId: string): string {
  return topology.devices.find((device) => device.id === deviceId)?.name ?? deviceId;
}

function cloneTopology(source: Topology): Topology {
  return JSON.parse(JSON.stringify(source)) as Topology;
}

render();
