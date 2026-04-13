import { samples, SampleScenario } from "./data/samples";
import { simulatePing } from "./sim/simulator";
import { Device, DeviceKind, Link, PingOptions, Topology } from "./sim/types";
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
        </div>
        <svg class="topology" viewBox="0 0 900 360" role="img" aria-label="Network topology">
          ${renderLinks(topology.links)}
          ${topology.devices.map(renderDevice).join("")}
        </svg>
        <p class="hint">${linkStart ? `Choose another device port to link from ${linkStart.deviceId}.${linkStart.portId}.` : selectedSample.description}</p>
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
            ${result.traversals.map((item) => `<li><span>${item.reason}</span><small>${item.from.deviceId}.${item.from.portId} -> ${item.to.deviceId}.${item.to.portId}</small></li>`).join("")}
          </ol>
        </div>
        <div>
          <h2>Ordered log</h2>
          <ol class="log-list">
            ${result.log.map((entry) => `<li class="${entry.level}"><small>t=${entry.time}</small> ${entry.message}</li>`).join("")}
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

function renderLinks(links: Link[]): string {
  return links.map((link) => {
    const a = topology.devices.find((device) => device.id === link.a.deviceId);
    const b = topology.devices.find((device) => device.id === link.b.deviceId);
    if (!a || !b) return "";
    return `<line class="link" x1="${a.position.x}" y1="${a.position.y}" x2="${b.position.x}" y2="${b.position.y}" />`;
  }).join("");
}

function renderDevice(device: Device): string {
  const selected = device.id === selectedDeviceId ? " selected" : "";
  const portLabel = device.kind === "host" ? "eth0" : device.ports.map((port) => port.id).join(" ");
  return `
    <g class="device ${device.kind}${selected}" data-device="${device.id}" tabindex="0">
      <rect x="${device.position.x - 48}" y="${device.position.y - 30}" width="96" height="60" rx="8"></rect>
      <text x="${device.position.x}" y="${device.position.y - 4}" text-anchor="middle">${device.name}</text>
      <text x="${device.position.x}" y="${device.position.y + 16}" text-anchor="middle" class="ports">${portLabel}</text>
    </g>
  `;
}

function renderDeviceConfig(device: Device): string {
  const base = `
    <label>Name <input data-field="name" value="${device.name}" /></label>
    <label>X <input data-field="x" type="number" value="${device.position.x}" /></label>
    <label>Y <input data-field="y" type="number" value="${device.position.y}" /></label>
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
    node.addEventListener("click", () => {
      const deviceId = node.dataset.device ?? "";
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
  if (field === "x") device.position.x = Number(value);
  if (field === "y") device.position.y = Number(value);
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
  return device.ports.find((port) => !topology.links.some((link) => (link.a.deviceId === deviceId && link.a.portId === port.id) || (link.b.deviceId === deviceId && link.b.portId === port.id)))
    ? { deviceId, portId: device.ports.find((port) => !topology.links.some((link) => (link.a.deviceId === deviceId && link.a.portId === port.id) || (link.b.deviceId === deviceId && link.b.portId === port.id)))!.id }
    : undefined;
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
