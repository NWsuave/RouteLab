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
          ${renderLinkLabels(topology.links)}
          ${topology.devices.map(renderDevice).join("")}
        </svg>
        <p class="hint">${linkStart ? `Choose another device port to link from ${linkStart.deviceId}.${linkStart.portId}.` : `${selectedSample.description} Drag devices to reposition them.`}</p>
      </section>

      <aside class="config-pane">
        <h2>Device config</h2>
        ${selectedDevice ? renderDeviceConfig(selectedDevice) : "<p>Select a device to edit it.</p>"}
        ${selectedDevice ? `<button id="delete-device" class="danger-button">Delete ${selectedDevice.name}</button>` : ""}
      </aside>

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

function renderLinkLabels(links: Link[]): string {
  return links.map((link) => {
    const a = topology.devices.find((device) => device.id === link.a.deviceId);
    const b = topology.devices.find((device) => device.id === link.b.deviceId);
    if (!a || !b) return "";
    const aPoint = portLabelPoint(a, b);
    const bPoint = portLabelPoint(b, a);
    return `
      <g class="link-label" data-label-link="${link.id}" data-label-device="${link.a.deviceId}" transform="translate(${aPoint.x} ${aPoint.y})">
        <rect x="-22" y="-10" width="44" height="20" rx="6"></rect>
        <text text-anchor="middle" dominant-baseline="central">${link.a.portId}</text>
      </g>
      <g class="link-label" data-label-link="${link.id}" data-label-device="${link.b.deviceId}" transform="translate(${bPoint.x} ${bPoint.y})">
        <rect x="-22" y="-10" width="44" height="20" rx="6"></rect>
        <text text-anchor="middle" dominant-baseline="central">${link.b.portId}</text>
      </g>
    `;
  }).join("");
}

function renderDevice(device: Device): string {
  const selected = device.id === selectedDeviceId ? " selected" : "";
  const box = deviceBox(device);
  const detailLines = showInterfaceLabels ? interfaceLines(device) : [];
  return `
    <g class="device ${device.kind}${selected}" data-device="${device.id}" transform="translate(${device.position.x} ${device.position.y})" tabindex="0">
      ${renderDeviceSymbol(device)}
      <text y="${box.labelY}" text-anchor="middle" class="device-name">${device.name}</text>
      ${detailLines.map((line, index) => `<text y="${box.labelY + 15 + index * 13}" text-anchor="middle" class="address">${line}</text>`).join("")}
    </g>
  `;
}

function renderDeviceSymbol(device: Device): string {
  if (device.kind === "router") return renderRouterSymbol();
  if (device.kind === "switch") return renderSwitchSymbol();
  return renderHostSymbol();
}

function renderRouterSymbol(): string {
  return `
    <g class="router-symbol">
      <circle class="router-disc" cx="0" cy="0" r="45"></circle>
      ${routerArrow(0, -23, "up")}
      ${routerArrow(0, 23, "down")}
      ${routerArrow(-23, 0, "left")}
      ${routerArrow(23, 0, "right")}
    </g>
  `;
}

function renderSwitchSymbol(): string {
  return `
    <g class="switch-symbol">
      <rect class="switch-body" x="-50" y="-42" width="100" height="84" rx="10"></rect>
      ${switchArrow(-20, -18, "left")}
      ${switchArrow(20, -18, "right")}
      ${switchArrow(-20, 18, "left")}
      ${switchArrow(20, 18, "right")}
    </g>
  `;
}

function renderHostSymbol(): string {
  return `
    <g class="host-symbol">
      <rect class="host-monitor" x="-38" y="-34" width="76" height="50" rx="3"></rect>
      <rect class="host-screen" x="-30" y="-27" width="60" height="34" rx="2"></rect>
      <rect class="host-stand" x="-9" y="16" width="18" height="14"></rect>
      <path class="host-base" d="M -27 33 H 27 L 34 42 H -34 Z"></path>
      <line class="host-highlight" x1="-30" y1="-20" x2="30" y2="-20"></line>
    </g>
  `;
}

function routerArrow(x: number, y: number, direction: "up" | "down" | "left" | "right"): string {
  const rotation = { right: 0, down: 90, left: 180, up: 270 }[direction];
  return `
    <g class="symbol-arrow" transform="translate(${x} ${y}) rotate(${rotation})">
      <line x1="-10" y1="0" x2="7" y2="0"></line>
      <path d="M 3 -5 L 10 0 L 3 5 Z"></path>
    </g>
  `;
}

function switchArrow(x: number, y: number, direction: "up" | "down" | "left" | "right"): string {
  const rotation = { right: 0, down: 90, left: 180, up: 270 }[direction];
  return `
    <g class="symbol-arrow switch-arrow" transform="translate(${x} ${y}) rotate(${rotation})">
      <line x1="-9" y1="0" x2="6" y2="0"></line>
      <path d="M 2 -4 L 9 0 L 2 4 Z"></path>
    </g>
  `;
}

function renderDeviceConfig(device: Device): string {
  const base = `
    <label>Name <input data-field="name" value="${device.name}" /></label>
  `;

  if (device.kind === "host") {
    const config = device.ports[0].config;
    const destinationIp = ping.fromHostId === device.id ? ping.toIp : defaultPingTargetIp(device.id);
    return `${base}
      <label>IP <input data-field="host-ip" value="${config.ip}" /></label>
      <label>Mask <input data-field="host-mask" type="number" value="${config.mask}" /></label>
      <label>MAC <input data-field="host-mac" value="${config.mac}" /></label>
      <label>Gateway <input data-field="host-gateway" value="${config.gateway ?? ""}" /></label>
      <div class="host-ping-panel">
        <h3>Send ping</h3>
        <label>Destination device
          <select id="host-ping-target">
            <option value="">Custom IP</option>
            ${pingDestinationOptions(device.id, destinationIp)}
          </select>
        </label>
        <label>Destination IP <input id="host-ping-ip" value="${destinationIp}" /></label>
        <label>TTL <input id="host-ping-ttl" type="number" min="1" max="64" value="${ping.fromHostId === device.id ? ping.ttl ?? 8 : 8}" /></label>
        <button id="host-ping-run">Ping from ${device.name}</button>
      </div>
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

function pingDestinationOptions(sourceHostId: string, selectedIp: string): string {
  return pingDestinations(sourceHostId).map((destination) => `
    <option value="${destination.ip}" ${destination.ip === selectedIp ? "selected" : ""}>${destination.label}</option>
  `).join("");
}

function defaultPingTargetIp(sourceHostId: string): string {
  return pingDestinations(sourceHostId)[0]?.ip ?? ping.toIp;
}

function pingDestinations(sourceHostId: string): Array<{ label: string; ip: string }> {
  return topology.devices.flatMap((device) => {
    if (device.kind === "host") {
      if (device.id === sourceHostId) return [];
      return [{ label: `${device.name} (${device.ports[0].config.ip})`, ip: device.ports[0].config.ip }];
    }
    if (device.kind === "router") {
      return device.ports.map((port) => ({
        label: `${device.name} ${port.id} (${port.config.ip})`,
        ip: port.config.ip,
      }));
    }
    return [];
  });
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

  document.querySelector<HTMLButtonElement>("#delete-device")?.addEventListener("click", () => {
    deleteSelectedDevice();
    render();
  });

  document.querySelectorAll<HTMLInputElement>("[data-field]").forEach((input) => {
    input.addEventListener("change", () => updateSelectedDevice(input.dataset.field ?? "", input.value));
  });

  document.querySelectorAll<HTMLInputElement>("[data-router-port]").forEach((input) => {
    input.addEventListener("change", () => updateRouterPort(input.dataset.routerPort ?? "", input.dataset.routerField ?? "", input.value));
  });

  document.querySelector<HTMLTextAreaElement>("#routes")?.addEventListener("change", (event) => updateRoutes((event.target as HTMLTextAreaElement).value));

  document.querySelector<HTMLSelectElement>("#host-ping-target")?.addEventListener("change", (event) => {
    const selectedIp = (event.target as HTMLSelectElement).value;
    if (selectedIp) {
      const input = document.querySelector<HTMLInputElement>("#host-ping-ip");
      if (input) input.value = selectedIp;
    }
  });

  document.querySelector<HTMLButtonElement>("#host-ping-run")?.addEventListener("click", () => {
    const host = topology.devices.find((device): device is Extract<Device, { kind: "host" }> => device.id === selectedDeviceId && device.kind === "host");
    if (!host) return;
    ping = {
      fromHostId: host.id,
      toIp: document.querySelector<HTMLInputElement>("#host-ping-ip")?.value ?? ping.toIp,
      ttl: Number(document.querySelector<HTMLInputElement>("#host-ping-ttl")?.value ?? 8),
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
    topology.devices.push({ id, name: `Switch ${id.toUpperCase()}`, kind, position, ports: switchPorts() });
  }
  if (kind === "router") {
    topology.devices.push({
      id,
      name: `Router ${id.toUpperCase()}`,
      kind,
      position,
      ports: [
        { id: "e0", config: { ip: "192.168.1.1", mask: 24, mac: `02:00:00:00:01:${topology.devices.length.toString(16).padStart(2, "0")}` } },
        { id: "e1", config: { ip: "192.168.2.1", mask: 24, mac: `02:00:00:00:02:${topology.devices.length.toString(16).padStart(2, "0")}` } },
      ],
      routes: [],
    });
  }
  selectedDeviceId = id;
}

function deleteSelectedDevice(): void {
  const deletedId = selectedDeviceId;
  topology.devices = topology.devices.filter((device) => device.id !== deletedId);
  topology.links = topology.links.filter((link) => link.a.deviceId !== deletedId && link.b.deviceId !== deletedId);
  if (linkStart?.deviceId === deletedId) {
    linkStart = undefined;
  }
  const firstHost = topology.devices.find((device) => device.kind === "host");
  if (ping.fromHostId === deletedId || !topology.devices.some((device) => device.id === ping.fromHostId)) {
    ping = { ...ping, fromHostId: firstHost?.id ?? "" };
  }
  selectedDeviceId = topology.devices[0]?.id ?? "";
  result = simulatePing(topology, ping);
}

function switchPorts(): Array<{ id: string }> {
  return Array.from({ length: 12 }, (_, index) => ({ id: `p${index + 1}` }));
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

interface SubnetBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function subnetGroups(): Array<{ label: string; x: number; y: number; width: number; height: number }> {
  const memberships = new Map<string, SubnetBox[]>();
  for (const device of topology.devices) {
    if (device.kind === "host") {
      const config = device.ports[0].config;
      const subnet = subnetLabel(config.ip, config.mask);
      const boxes = memberships.get(subnet) ?? [];
      boxes.push(deviceBounds(device));
      boxes.push(...linkedSwitches(device.id, "eth0").map(deviceBounds));
      memberships.set(subnet, boxes);
    }

    if (device.kind === "router") {
      for (const port of device.ports) {
        const subnet = subnetLabel(port.config.ip, port.config.mask);
        const boxes = memberships.get(subnet) ?? [];
        boxes.push(routerInterfaceBounds(device, port.id));
        boxes.push(...linkedSwitches(device.id, port.id).map(deviceBounds));
        memberships.set(subnet, boxes);
      }
    }
  }

  return [...memberships.entries()].filter(([, boxes]) => boxes.length > 0).map(([label, boxes]) => {
    const padding = 22;
    const left = Math.max(8, Math.min(...boxes.map((box) => box.left)) - padding);
    const top = Math.max(8, Math.min(...boxes.map((box) => box.top)) - padding);
    const right = Math.min(892, Math.max(...boxes.map((box) => box.right)) + padding);
    const bottom = Math.min(352, Math.max(...boxes.map((box) => box.bottom)) + padding);
    return { label, x: left, y: top, width: right - left, height: bottom - top };
  });
}

function deviceBounds(device: Device): SubnetBox {
  const box = deviceBox(device);
  return {
    left: device.position.x - box.width / 2,
    right: device.position.x + box.width / 2,
    top: device.position.y - box.height / 2,
    bottom: device.position.y + box.height / 2,
  };
}

function routerInterfaceBounds(router: Extract<Device, { kind: "router" }>, portId: string): SubnetBox {
  const link = topology.links.find((item) => (item.a.deviceId === router.id && item.a.portId === portId) || (item.b.deviceId === router.id && item.b.portId === portId));
  const peerId = link?.a.deviceId === router.id ? link.b.deviceId : link?.b.deviceId === router.id ? link.a.deviceId : undefined;
  const peer = peerId ? topology.devices.find((device) => device.id === peerId) : undefined;
  const point = peer ? routerInterfacePoint(router, peer) : { x: router.position.x, y: router.position.y };
  return {
    left: point.x - 10,
    right: point.x + 10,
    top: point.y - 10,
    bottom: point.y + 10,
  };
}

function linkedSwitches(deviceId: string, portId: string): Device[] {
  return topology.links.flatMap((link) => {
    const peer = link.a.deviceId === deviceId && link.a.portId === portId
      ? link.b.deviceId
      : link.b.deviceId === deviceId && link.b.portId === portId
        ? link.a.deviceId
        : undefined;
    const peerDevice = peer ? topology.devices.find((device) => device.id === peer) : undefined;
    return peerDevice?.kind === "switch" ? [peerDevice] : [];
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

function deviceBox(device: Device): { width: number; height: number; labelY: number } {
  if (device.kind === "router") {
    return showInterfaceLabels
      ? { width: 196, height: 144, labelY: 62 }
      : { width: 100, height: 122, labelY: 62 };
  }
  if (device.kind === "switch") {
    return showInterfaceLabels
      ? { width: 136, height: 132, labelY: 58 }
      : { width: 112, height: 118, labelY: 58 };
  }
  return showInterfaceLabels
    ? { width: 178, height: 112, labelY: 58 }
    : { width: 86, height: 96, labelY: 58 };
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
  updateLinkLabelPreview(deviceId, x, y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function updateLinkLabelPreview(deviceId: string, x: number, y: number): void {
  for (const link of topology.links.filter((item) => item.a.deviceId === deviceId || item.b.deviceId === deviceId)) {
    const movingDevice = topology.devices.find((device) => device.id === deviceId);
    const peerId = link.a.deviceId === deviceId ? link.b.deviceId : link.a.deviceId;
    const peerDevice = topology.devices.find((device) => device.id === peerId);
    if (!movingDevice || !peerDevice) continue;
    const movingPreview = { ...movingDevice, position: { x, y } } as Device;
    const movingPoint = portLabelPoint(movingPreview, peerDevice);
    const peerPoint = portLabelPoint(peerDevice, movingPreview);
    document.querySelector<SVGGElement>(`[data-label-link="${link.id}"][data-label-device="${deviceId}"]`)
      ?.setAttribute("transform", `translate(${Math.round(movingPoint.x)} ${Math.round(movingPoint.y)})`);
    document.querySelector<SVGGElement>(`[data-label-link="${link.id}"][data-label-device="${peerId}"]`)
      ?.setAttribute("transform", `translate(${Math.round(peerPoint.x)} ${Math.round(peerPoint.y)})`);
  }
}

function portLabelPoint(device: Device, peer: Device): { x: number; y: number } {
  const dx = peer.position.x - device.position.x;
  const dy = peer.position.y - device.position.y;
  const length = Math.hypot(dx, dy) || 1;
  const box = deviceBox(device);
  const edgeDistance = Math.min(box.width / 2 + 22, box.height / 2 + 22);
  return {
    x: device.position.x + (dx / length) * edgeDistance,
    y: device.position.y + (dy / length) * edgeDistance,
  };
}

function routerInterfacePoint(router: Extract<Device, { kind: "router" }>, peer: Device): { x: number; y: number } {
  const dx = peer.position.x - router.position.x;
  const dy = peer.position.y - router.position.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: router.position.x + (dx / length) * 48,
    y: router.position.y + (dy / length) * 48,
  };
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
