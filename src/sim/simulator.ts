import { containsIp, sameSubnet } from "./ip";
import {
  ArpPacket,
  Device,
  DeviceId,
  EthernetFrame,
  HostDevice,
  IPv4Packet,
  Link,
  PingOptions,
  PortId,
  PortRef,
  RouterDevice,
  SimulationLogEntry,
  SimulationResult,
  StaticRoute,
  SwitchDevice,
  Topology,
  Traversal,
} from "./types";

const BROADCAST = "ff:ff:ff:ff:ff:ff";

interface PendingPacket {
  frame: IPv4Packet;
  outPortId: PortId;
  nextHopIp: string;
  sourceMac: string;
}

interface RuntimeState {
  devices: Map<DeviceId, Device>;
  links: Link[];
  log: SimulationLogEntry[];
  traversals: Traversal[];
  switchMacTables: Map<DeviceId, Map<string, PortId>>;
  arpTables: Map<DeviceId, Map<string, string>>;
  pendingPackets: Map<DeviceId, PendingPacket[]>;
  events: Array<() => void>;
  nextLogId: number;
  nextTraversalId: number;
  time: number;
}

export function simulatePing(topology: Topology, options: PingOptions): SimulationResult {
  const state = createRuntime(topology);
  const source = getDevice(state, options.fromHostId);
  if (!source || source.kind !== "host") {
    addLog(state, "drop", `Ping source ${options.fromHostId} is not a host`, options.fromHostId);
    return finish(state);
  }

  enqueue(state, () => startHostPing(state, source, options.toIp, options.ttl ?? 8));
  runEvents(state);
  return finish(state);
}

function createRuntime(topology: Topology): RuntimeState {
  const devices = new Map<DeviceId, Device>();
  for (const device of topology.devices) {
    devices.set(device.id, device);
  }

  const state: RuntimeState = {
    devices,
    links: topology.links,
    log: [],
    traversals: [],
    switchMacTables: new Map(),
    arpTables: new Map(),
    pendingPackets: new Map(),
    events: [],
    nextLogId: 1,
    nextTraversalId: 1,
    time: 0,
  };

  for (const device of topology.devices) {
    if (device.kind === "switch") state.switchMacTables.set(device.id, new Map());
    if (device.kind === "host" || device.kind === "router") state.arpTables.set(device.id, new Map());
  }

  return state;
}

function runEvents(state: RuntimeState): void {
  while (state.events.length > 0) {
    const event = state.events.shift();
    if (!event) break;
    state.time += 1;
    event();
  }
}

function enqueue(state: RuntimeState, event: () => void): void {
  state.events.push(event);
}

function finish(state: RuntimeState): SimulationResult {
  return {
    log: state.log,
    traversals: state.traversals,
    tables: {
      switchMacTables: Object.fromEntries(
        [...state.switchMacTables.entries()].map(([deviceId, table]) => [
          deviceId,
          [...table.entries()].map(([mac, portId]) => ({ mac, portId })),
        ]),
      ),
      arpTables: Object.fromEntries(
        [...state.arpTables.entries()].map(([deviceId, table]) => [
          deviceId,
          [...table.entries()].map(([ip, mac]) => ({ ip, mac })),
        ]),
      ),
      routerRoutingTables: Object.fromEntries(
        [...state.devices.values()]
          .filter((device): device is RouterDevice => device.kind === "router")
          .map((router) => [router.id, connectedRoutes(router).concat(router.routes)]),
      ),
    },
  };
}

function startHostPing(state: RuntimeState, host: HostDevice, toIp: string, ttl: number): void {
  const hostPort = host.ports[0];
  const nextHopIp = sameSubnet(hostPort.config.ip, toIp, hostPort.config.mask) ? toIp : hostPort.config.gateway;
  if (!nextHopIp) {
    addLog(state, "drop", `${host.name} has no default gateway for remote destination ${toIp}`, host.id);
    return;
  }

  const packet: IPv4Packet = {
    srcIp: hostPort.config.ip,
    dstIp: toIp,
    ttl,
    protocol: "ICMP",
    payload: { kind: "echo-request", id: 1 },
  };
  sendIpFromDevice(state, host.id, "eth0", hostPort.config.mac, nextHopIp, packet);
}

function sendIpFromDevice(
  state: RuntimeState,
  deviceId: DeviceId,
  outPortId: PortId,
  sourceMac: string,
  nextHopIp: string,
  packet: IPv4Packet,
): void {
  const arpTable = mustArpTable(state, deviceId);
  const knownMac = arpTable.get(nextHopIp);
  if (knownMac) {
    sendFrame(state, { deviceId, portId: outPortId }, {
      srcMac: sourceMac,
      dstMac: knownMac,
      etherType: "IPv4",
      payload: packet,
    }, `IPv4 ${packet.srcIp} -> ${packet.dstIp}`);
    return;
  }

  const pending = state.pendingPackets.get(deviceId) ?? [];
  pending.push({ frame: packet, outPortId, nextHopIp, sourceMac });
  state.pendingPackets.set(deviceId, pending);

  const ownerIp = findPortIp(state, deviceId, outPortId);
  if (!ownerIp) {
    addLog(state, "drop", `${deviceId}.${outPortId} has no IPv4 address for ARP`, deviceId);
    return;
  }

  addLog(state, "info", `${deviceId} ARPs for ${nextHopIp}`, deviceId);
  const arp: ArpPacket = {
    kind: "request",
    senderIp: ownerIp,
    senderMac: sourceMac,
    targetIp: nextHopIp,
  };
  sendFrame(state, { deviceId, portId: outPortId }, {
    srcMac: sourceMac,
    dstMac: BROADCAST,
    etherType: "ARP",
    payload: arp,
  }, `ARP request for ${nextHopIp}`);
}

function sendFrame(state: RuntimeState, from: PortRef, frame: EthernetFrame, reason: string): void {
  const link = findLink(state.links, from);
  if (!link) {
    addLog(state, "drop", `${from.deviceId}.${from.portId} is not linked`, from.deviceId);
    return;
  }
  const to = samePort(link.a, from) ? link.b : link.a;
  state.traversals.push({ id: state.nextTraversalId++, frame: cloneFrame(frame), from, to, reason });
  enqueue(state, () => receiveFrame(state, to, frame));
}

function receiveFrame(state: RuntimeState, port: PortRef, frame: EthernetFrame): void {
  const device = getDevice(state, port.deviceId);
  if (!device) return;
  if (device.kind === "switch") receiveAtSwitch(state, device, port.portId, frame);
  if (device.kind === "host") receiveAtHost(state, device, frame);
  if (device.kind === "router") receiveAtRouter(state, device, port.portId, frame);
}

function receiveAtSwitch(state: RuntimeState, sw: SwitchDevice, inPortId: PortId, frame: EthernetFrame): void {
  const table = mustSwitchTable(state, sw.id);
  table.set(frame.srcMac, inPortId);
  addLog(state, "info", `${sw.name} learned ${frame.srcMac} on ${inPortId}`, sw.id);

  const flood = frame.dstMac === BROADCAST || !table.has(frame.dstMac);
  const outPorts = flood
    ? sw.ports.filter((port) => port.id !== inPortId).map((port) => port.id)
    : [table.get(frame.dstMac)].filter((portId): portId is PortId => Boolean(portId) && portId !== inPortId);

  if (outPorts.length === 0) {
    addLog(state, "drop", `${sw.name} has no output port for ${frame.dstMac}`, sw.id);
    return;
  }

  for (const outPortId of outPorts) {
    sendFrame(state, { deviceId: sw.id, portId: outPortId }, frame, flood ? "flood" : "known unicast");
  }
}

function receiveAtHost(state: RuntimeState, host: HostDevice, frame: EthernetFrame): void {
  const config = host.ports[0].config;
  if (frame.dstMac !== BROADCAST && frame.dstMac !== config.mac) return;
  learnArpFromFrame(state, host.id, frame);

  if (frame.etherType === "ARP") {
    const arp = frame.payload as ArpPacket;
    if (arp.kind === "request" && arp.targetIp === config.ip) {
      addLog(state, "info", `${host.name} replies to ARP from ${arp.senderIp}`, host.id);
      sendFrame(state, { deviceId: host.id, portId: "eth0" }, {
        srcMac: config.mac,
        dstMac: arp.senderMac,
        etherType: "ARP",
        payload: {
          kind: "reply",
          senderIp: config.ip,
          senderMac: config.mac,
          targetIp: arp.senderIp,
          targetMac: arp.senderMac,
        },
      }, `ARP reply ${config.ip} is ${config.mac}`);
    }
    if (arp.kind === "reply") {
      addLog(state, "info", `${host.name} learned ARP ${arp.senderIp} is ${arp.senderMac}`, host.id);
      flushPending(state, host.id, arp.senderIp, arp.senderMac);
    }
    return;
  }

  const packet = frame.payload as IPv4Packet;
  if (packet.dstIp !== config.ip) {
    addLog(state, "drop", `${host.name} dropped IPv4 packet for ${packet.dstIp}`, host.id);
    return;
  }

  if (packet.payload.kind === "echo-request") {
    addLog(state, "info", `${host.name} received ICMP echo request from ${packet.srcIp}`, host.id);
    const reply: IPv4Packet = {
      srcIp: config.ip,
      dstIp: packet.srcIp,
      ttl: 8,
      protocol: "ICMP",
      payload: { kind: "echo-reply", id: packet.payload.id },
    };
    const nextHopIp = sameSubnet(config.ip, reply.dstIp, config.mask) ? reply.dstIp : config.gateway;
    if (!nextHopIp) {
      addLog(state, "drop", `${host.name} has no gateway for ICMP reply to ${reply.dstIp}`, host.id);
      return;
    }
    sendIpFromDevice(state, host.id, "eth0", config.mac, nextHopIp, reply);
  } else {
    addLog(state, "success", `${host.name} received ICMP echo reply from ${packet.srcIp}`, host.id);
  }
}

function receiveAtRouter(state: RuntimeState, router: RouterDevice, inPortId: PortId, frame: EthernetFrame): void {
  const inPort = router.ports.find((port) => port.id === inPortId);
  if (!inPort) return;
  if (frame.dstMac !== BROADCAST && frame.dstMac !== inPort.config.mac) return;
  learnArpFromFrame(state, router.id, frame);

  if (frame.etherType === "ARP") {
    const arp = frame.payload as ArpPacket;
    const targetPort = router.ports.find((port) => port.config.ip === arp.targetIp);
    if (arp.kind === "request" && targetPort) {
      addLog(state, "info", `${router.name} replies to ARP for ${arp.targetIp}`, router.id);
      sendFrame(state, { deviceId: router.id, portId: targetPort.id }, {
        srcMac: targetPort.config.mac,
        dstMac: arp.senderMac,
        etherType: "ARP",
        payload: {
          kind: "reply",
          senderIp: targetPort.config.ip,
          senderMac: targetPort.config.mac,
          targetIp: arp.senderIp,
          targetMac: arp.senderMac,
        },
      }, `ARP reply ${targetPort.config.ip} is ${targetPort.config.mac}`);
    }
    if (arp.kind === "reply") {
      addLog(state, "info", `${router.name} learned ARP ${arp.senderIp} is ${arp.senderMac}`, router.id);
      flushPending(state, router.id, arp.senderIp, arp.senderMac);
    }
    return;
  }

  const packet = frame.payload as IPv4Packet;
  if (router.ports.some((port) => port.config.ip === packet.dstIp)) {
    addLog(state, "info", `${router.name} received IPv4 packet addressed to router ${packet.dstIp}`, router.id);
    return;
  }

  if (packet.ttl <= 1) {
    addLog(state, "drop", `${router.name} dropped packet to ${packet.dstIp}: TTL expired`, router.id);
    return;
  }

  const route = bestRoute(router, packet.dstIp);
  if (!route) {
    addLog(state, "drop", `${router.name} dropped packet to ${packet.dstIp}: no route`, router.id);
    return;
  }

  const outPort = router.ports.find((port) => port.id === route.outPortId);
  if (!outPort) {
    addLog(state, "drop", `${router.name} route to ${packet.dstIp} uses missing port ${route.outPortId}`, router.id);
    return;
  }

  const forwarded: IPv4Packet = { ...packet, ttl: packet.ttl - 1 };
  const nextHopIp = route.nextHop ?? packet.dstIp;
  addLog(state, "info", `${router.name} forwards ${packet.dstIp} via ${outPort.id}; TTL ${packet.ttl} -> ${forwarded.ttl}`, router.id);
  sendIpFromDevice(state, router.id, outPort.id, outPort.config.mac, nextHopIp, forwarded);
}

function bestRoute(router: RouterDevice, dstIp: string): StaticRoute | undefined {
  return connectedRoutes(router)
    .concat(router.routes)
    .filter((route) => containsIp(route.prefix, route.mask, dstIp))
    .sort((a, b) => b.mask - a.mask)[0];
}

function connectedRoutes(router: RouterDevice): StaticRoute[] {
  return router.ports.map((port) => ({
    prefix: port.config.ip,
    mask: port.config.mask,
    outPortId: port.id,
  }));
}

function flushPending(state: RuntimeState, deviceId: DeviceId, ip: string, mac: string): void {
  const pending = state.pendingPackets.get(deviceId) ?? [];
  const remaining: PendingPacket[] = [];
  for (const item of pending) {
    if (item.nextHopIp === ip) {
      sendFrame(state, { deviceId, portId: item.outPortId }, {
        srcMac: item.sourceMac,
        dstMac: mac,
        etherType: "IPv4",
        payload: item.frame,
      }, `IPv4 ${item.frame.srcIp} -> ${item.frame.dstIp}`);
    } else {
      remaining.push(item);
    }
  }
  state.pendingPackets.set(deviceId, remaining);
}

function learnArpFromFrame(state: RuntimeState, deviceId: DeviceId, frame: EthernetFrame): void {
  if (frame.etherType !== "ARP") return;
  const arp = frame.payload as ArpPacket;
  mustArpTable(state, deviceId).set(arp.senderIp, arp.senderMac);
}

function findPortIp(state: RuntimeState, deviceId: DeviceId, portId: PortId): string | undefined {
  const device = getDevice(state, deviceId);
  if (!device) return undefined;
  if (device.kind === "host") return device.ports[0].config.ip;
  if (device.kind === "router") return device.ports.find((port) => port.id === portId)?.config.ip;
  return undefined;
}

function findLink(links: Link[], port: PortRef): Link | undefined {
  return links.find((link) => samePort(link.a, port) || samePort(link.b, port));
}

function samePort(a: PortRef, b: PortRef): boolean {
  return a.deviceId === b.deviceId && a.portId === b.portId;
}

function getDevice(state: RuntimeState, deviceId: DeviceId): Device | undefined {
  return state.devices.get(deviceId);
}

function mustSwitchTable(state: RuntimeState, deviceId: DeviceId): Map<string, PortId> {
  const table = state.switchMacTables.get(deviceId);
  if (!table) throw new Error(`Missing switch table for ${deviceId}`);
  return table;
}

function mustArpTable(state: RuntimeState, deviceId: DeviceId): Map<string, string> {
  const table = state.arpTables.get(deviceId);
  if (!table) throw new Error(`Missing ARP table for ${deviceId}`);
  return table;
}

function addLog(state: RuntimeState, level: SimulationLogEntry["level"], message: string, deviceId?: DeviceId): void {
  state.log.push({ id: state.nextLogId++, time: state.time, level, message, deviceId });
}

function cloneFrame(frame: EthernetFrame): EthernetFrame {
  return JSON.parse(JSON.stringify(frame)) as EthernetFrame;
}
