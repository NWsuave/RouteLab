import { resetNetwork, simulatePing } from "./sim/simulator";
import { Device, DeviceKind, EthernetFrame, Link, PingOptions, Topology, ScenarioFile, isScenarioFile } from "./sim/types";
import "./styles.css";
import scenarioData from "./data/default-topology.json";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("Missing #app");
const root = appRoot;

const topologyData = scenarioData as Topology;
console.log(scenarioData);
console.log(scenarioData.topology);

let topology = cloneTopology(topologyData);
let selectedDeviceId = topology.devices[0]?.id ?? "";
let linkStart: { deviceId: string; portId: string } | undefined;
let ping: PingOptions = { ...topologyData.ping };
let result = resetNetwork(topology);
let showInterfaceLabels = false;
let topologyDescription = topologyData.description;
let diagramScale = 1;

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
    </header>

    <main class="workspace">
      <section class="topology-pane">
        <div class="toolbar">
          <div class="tool-group">
            <button data-add="host">Host</button>
            <button data-add="switch">Switch</button>
            <button data-add="router">Router</button>
          </div>
          <div class="tool-group">
            <button id="clear-link">${linkStart ? "Cancel link" : "Link"}</button>
            <button id="reset-network">Reset</button>
          </div>
          <div class="scale-control" aria-label="Diagram scale">
            <span>Scale ${Math.round(diagramScale * 100)}%</span>
            <button id="scale-down" aria-label="Shrink diagram">-</button>
            <button id="scale-up" aria-label="Enlarge diagram">+</button>
          </div>
          <div class="tool-group secondary-tools">
            <button id="export-network">Export</button>
            <label class="import-button">Import<input id="import-network" type="file" accept="application/json,.json" /></label>
          </div>
          <label class="toggle"><input id="show-addresses" type="checkbox" ${showInterfaceLabels ? "checked" : ""} /> IP/MAC labels</label>
        </div>
        <svg id="topology-svg" class="topology" viewBox="0 0 900 360" role="img" aria-label="Network topology">
          ${renderSubnetGroups()}
          ${renderLinks(topology.links)}
          ${renderLinkLabels(topology.links)}
          ${topology.devices.map(renderDevice).join("")}
        </svg>
        <p class="hint">${linkStart ? `Choose another device port to link from ${formatPortRef(linkStart)}.` : `${topologyDescription} Drag devices to reposition them.`}</p>
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
                    <span>${traversalReason(item.reason)}</span>
                    <span class="protocol-badge">${frameBadge(item.frame)}</span>
                  </div>
                  <div class="step-meta">${formatPortRef(item.from)} <span>to</span> ${formatPortRef(item.to)}</div>
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
  const labelWidth = 44 * diagramScale;
  const labelHeight = 20 * diagramScale;
  return links.map((link) => {
    const a = topology.devices.find((device) => device.id === link.a.deviceId);
    const b = topology.devices.find((device) => device.id === link.b.deviceId);
    if (!a || !b) return "";
    const aPoint = portLabelPoint(a, b);
    const bPoint = portLabelPoint(b, a);
    return `
      <g class="link-label" data-label-link="${link.id}" data-label-device="${link.a.deviceId}" transform="translate(${aPoint.x} ${aPoint.y})">
        <rect x="${-labelWidth / 2}" y="${-labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" rx="${6 * diagramScale}"></rect>
        <text text-anchor="middle" dominant-baseline="central" style="font-size: ${10 * diagramScale}px">${link.a.portId}</text>
      </g>
      <g class="link-label" data-label-link="${link.id}" data-label-device="${link.b.deviceId}" transform="translate(${bPoint.x} ${bPoint.y})">
        <rect x="${-labelWidth / 2}" y="${-labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" rx="${6 * diagramScale}"></rect>
        <text text-anchor="middle" dominant-baseline="central" style="font-size: ${10 * diagramScale}px">${link.b.portId}</text>
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
      <text y="${box.labelY}" text-anchor="middle" class="device-name" style="font-size: ${12 * diagramScale}px">${device.name}</text>
      ${detailLines.map((line, index) => `<text y="${box.labelY + 15 * diagramScale + index * 13 * diagramScale}" text-anchor="middle" class="address" style="font-size: ${9 * diagramScale}px">${line}</text>`).join("")}
    </g>
  `;
}

function renderDeviceSymbol(device: Device): string {
  if (device.kind === "router") return renderRouterSymbol();
  if (device.kind === "switch") return renderSwitchSymbol();
  return renderHostSymbol();
}

function renderRouterSymbol(): string {
  const radius = 25 * diagramScale;
  const arrowOffset = 12 * diagramScale;
  return `
    <g class="router-symbol" opacity="0.7">
      <circle class="router-disc" cx="0" cy="0" r="${radius}"></circle>
      ${routerArrow(0, -arrowOffset, "up")}
      ${routerArrow(0, arrowOffset, "down")}
      ${routerArrow(-arrowOffset, 0, "left")}
      ${routerArrow(arrowOffset, 0, "right")}
    </g>
  `;
}

function renderSwitchSymbol(): string {
  const width = 60 * diagramScale;
  const height = 44 * diagramScale;
  const arrowX = 14 * diagramScale;
  const arrowY = 11 * diagramScale;
  return `
    <g class="switch-symbol" opacity="0.7">
      <rect class="switch-body" x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" rx="${10 * diagramScale}"></rect>
      ${switchArrow(-arrowX, -arrowY, "left")}
      ${switchArrow(arrowX, -arrowY + 7, "right")}
      ${switchArrow(-arrowX, arrowY - 7, "left")}
      ${switchArrow(arrowX, arrowY, "right")}
    </g>
  `;
}

function renderHostSymbol(): string {
  const s = diagramScale;
  return `
    <g class="host-symbol">
      <rect class="host-monitor" x="${-38 * s}" y="${-34 * s}" width="${76 * s}" height="${50 * s}" rx="${3 * s}"></rect>
      <rect class="host-screen" x="${-30 * s}" y="${-27 * s}" width="${60 * s}" height="${34 * s}" rx="${2 * s}"></rect>
      <rect class="host-stand" x="${-9 * s}" y="${16 * s}" width="${18 * s}" height="${14 * s}"></rect>
      <path class="host-base" d="M ${-27 * s} ${33 * s} H ${27 * s} L ${34 * s} ${42 * s} H ${-34 * s} Z"></path>
      <line class="host-highlight" x1="${-30 * s}" y1="${-20 * s}" x2="${30 * s}" y2="${-20 * s}"></line>
    </g>
  `;
}

function routerArrow(x: number, y: number, direction: "up" | "down" | "left" | "right"): string {
  const rotation = { right: 180, down: 90, left: 0, up: 270 }[direction];
  const s = diagramScale;
  return `
    <g class="symbol-arrow" transform="translate(${x} ${y}) rotate(${rotation})">
      <line x1="${-10 * s}" y1="0" x2="${7 * s}" y2="0" style="stroke-width: ${3 * s}px"></line>
      <path d="M ${3 * s} ${-5 * s} L ${10 * s} 0 L ${3 * s} ${5 * s} Z"></path>
    </g>
  `;
}

function switchArrow(x: number, y: number, direction: "up" | "down" | "left" | "right"): string {
  const rotation = { right: 0, down: 90, left: 180, up: 270 }[direction];
  const s = diagramScale;
  return `
    <g class="symbol-arrow switch-arrow" transform="translate(${x} ${y}) rotate(${rotation})">
      <line x1="${-9 * s}" y1="0" x2="${6 * s}" y2="0" style="stroke-width: ${3 * s}px"></line>
      <path d="M ${2 * s} ${-4 * s} L ${9 * s} 0 L ${2 * s} ${4 * s} Z"></path>
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
        <textarea id="routes">${device.routes.map((route) => `${route.prefix}/${route.mask} ${route.nextHop ?? "direct"}`).join("\n")}</textarea>
      </label>
      <small>Format: prefix/mask nextHop-or-direct</small>
    `;
  }

  return `${base}<p>Switch ports: ${device.ports.map((port) => port.id).join(", ")}</p>`;
}

function renderTables(): string {
  const switchTables = Object.entries(result.tables.switchMacTables).map(([deviceId, rows]) => tableBlock(
    `${deviceName(deviceId)} forwarding table`,
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
    rows.map((row) => [`${row.prefix}/${row.mask}`, row.nextHop ?? "direct", routePortLabel(deviceId, row)]),
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

function routePortLabel(deviceId: string, route: { nextHop?: string; outPortId?: string }): string {
  if (route.outPortId) return route.outPortId;
  const router = topology.devices.find((device): device is Extract<Device, { kind: "router" }> => device.id === deviceId && device.kind === "router");
  const nextHop = route.nextHop;
  if (!router || !nextHop) return "inferred";
  return router.ports.find((port) => sameSubnetLocal(port.config.ip, nextHop, port.config.mask))?.id ?? "unreachable";
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

function traversalReason(reason: string): string {
  if (reason === "known unicast") return "Known unicast";
  if (reason === "flood") return "Flood";
  return reason;
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
      result = resetNetwork(topology);
      render();
    });
  });

  document.querySelector<HTMLButtonElement>("#reset-network")?.addEventListener("click", () => {
    result = resetNetwork(topology);
    render();
  });

  document.querySelector<HTMLButtonElement>("#export-network")?.addEventListener("click", () => {
    exportNetworkConfig();
  });

  document.querySelector<HTMLInputElement>("#import-network")?.addEventListener("change", (event) => {
    importNetworkConfig(event.target as HTMLInputElement);
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

  document.querySelector<HTMLButtonElement>("#scale-down")?.addEventListener("click", () => {
    diagramScale = Math.max(0.1, Math.round((diagramScale - 0.1) * 10) / 10);
    render();
  });

  document.querySelector<HTMLButtonElement>("#scale-up")?.addEventListener("click", () => {
    diagramScale = Math.round((diagramScale + 0.1) * 10) / 10;
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

function exportNetworkConfig(): void {
  const config = {
    version: 1,
    description: topologyDescription,
    topology,
    ping,
  };
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "routelab-network.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importNetworkConfig(input: HTMLInputElement): void {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(String(reader.result)) as Partial<{ description: string; topology: Topology; ping: PingOptions }>;
      if (!parsed.topology || !Array.isArray(parsed.topology.devices) || !Array.isArray(parsed.topology.links)) {
        throw new Error("Missing topology.devices or topology.links");
      }
      topology = cloneTopology(parsed.topology);
      selectedDeviceId = topology.devices[0]?.id ?? "";
      const firstHost = topology.devices.find((device): device is Extract<Device, { kind: "host" }> => device.kind === "host");
      ping = parsed.ping && topology.devices.some((device) => device.id === parsed.ping?.fromHostId)
        ? { ...parsed.ping }
        : { fromHostId: firstHost?.id ?? "", toIp: firstHost?.ports[0].config.ip ?? "0.0.0.0", ttl: 8 };
      topologyDescription = parsed.description || "Imported network configuration.";
      linkStart = undefined;
      result = resetNetwork(topology);
      render();
    } catch (error) {
      window.alert(`Could not import network JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  reader.readAsText(file);
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
    const [prefixMask, nextHop] = line.split(/\s+/);
    const [prefix, mask] = prefixMask.split("/");
    return { prefix, mask: Number(mask), nextHop: nextHop === "direct" ? undefined : nextHop };
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
    const padding = 22 * diagramScale;
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
  const radius = 10 * diagramScale;
  return {
    left: point.x - radius,
    right: point.x + radius,
    top: point.y - radius,
    bottom: point.y + radius,
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

function sameSubnetLocal(a: string, b: string, mask: number): boolean {
  const maskInt = maskToIntLocal(mask);
  return (ipToIntLocal(a) & maskInt) === (ipToIntLocal(b) & maskInt);
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
  const scaled = (width: number, height: number, labelY: number) => ({
    width: width * diagramScale,
    height: height * diagramScale,
    labelY: labelY * diagramScale,
  });
  if (device.kind === "router") {
    return showInterfaceLabels
      ? scaled(196, 144, 62)
      : scaled(100, 122, 62);
  }
  if (device.kind === "switch") {
    return showInterfaceLabels
      ? scaled(136, 132, 58)
      : scaled(112, 118, 58);
  }
  return showInterfaceLabels
    ? scaled(178, 112, 58)
    : scaled(86, 96, 58);
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
  return [];
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
  const edgeDistance = Math.min(box.width / 2 + 22 * diagramScale, box.height / 2 + 22 * diagramScale);
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
    x: router.position.x + (dx / length) * 48 * diagramScale,
    y: router.position.y + (dy / length) * 48 * diagramScale,
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

function formatPortRef(port: { deviceId: string; portId: string }): string {
  return `${deviceName(port.deviceId)}.${port.portId}`;
}

function cloneTopology(source: Topology): Topology {
  return JSON.parse(JSON.stringify(source)) as Topology;
}

render();
