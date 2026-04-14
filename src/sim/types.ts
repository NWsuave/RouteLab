export type DeviceKind = "host" | "switch" | "router";

export type DeviceId = string;
export type PortId = string;
export type LinkId = string;

export interface ScenarioFile {
  id: string;
  name: string;
  description: string;
  topology: Topology;
  ping: PingOptions;
}

export function isScenarioFile(obj: any): obj is ScenarioFile {
  return (
    obj &&
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.description === "string" &&
    obj.topology &&
    Array.isArray(obj.topology.devices) &&
    Array.isArray(obj.topology.links)
  );
}

export interface Position {
  x: number;
  y: number;
}

export interface PortRef {
  deviceId: DeviceId;
  portId: PortId;
}

export interface HostConfig {
  ip: string;
  mask: number;
  mac: string;
  gateway?: string;
}

export interface RouterInterfaceConfig {
  ip: string;
  mask: number;
  mac: string;
}

export interface StaticRoute {
  prefix: string;
  mask: number;
  nextHop?: string;
  outPortId?: PortId;
}

export interface BaseDevice {
  id: DeviceId;
  name: string;
  kind: DeviceKind;
  position: Position;
}

export interface HostDevice extends BaseDevice {
  kind: "host";
  ports: [{ id: "eth0"; config: HostConfig }];
}

export interface SwitchDevice extends BaseDevice {
  kind: "switch";
  ports: Array<{ id: PortId }>;
}

export interface RouterDevice extends BaseDevice {
  kind: "router";
  ports: Array<{ id: PortId; config: RouterInterfaceConfig }>;
  routes: StaticRoute[];
}

export type Device = HostDevice | SwitchDevice | RouterDevice;

export interface Link {
  id: LinkId;
  a: PortRef;
  b: PortRef;
}

export interface Topology {
  devices: Device[];
  links: Link[];
}

export type EtherType = "ARP" | "IPv4";

export interface EthernetFrame {
  srcMac: string;
  dstMac: string;
  etherType: EtherType;
  payload: ArpPacket | IPv4Packet;
}

export interface ArpPacket {
  kind: "request" | "reply";
  senderIp: string;
  senderMac: string;
  targetIp: string;
  targetMac?: string;
}

export interface IPv4Packet {
  srcIp: string;
  dstIp: string;
  ttl: number;
  protocol: "ICMP";
  payload: IcmpPacket;
}

export interface IcmpPacket {
  kind: "echo-request" | "echo-reply";
  id: number;
}

export interface Traversal {
  id: number;
  frame: EthernetFrame;
  from: PortRef;
  to: PortRef;
  reason: string;
}

export interface SimulationLogEntry {
  id: number;
  time: number;
  deviceId?: DeviceId;
  level: "info" | "drop" | "success";
  message: string;
}

export interface TableSnapshot {
  switchMacTables: Record<DeviceId, Array<{ mac: string; portId: PortId }>>;
  arpTables: Record<DeviceId, Array<{ ip: string; mac: string }>>;
  routerRoutingTables: Record<DeviceId, StaticRoute[]>;
}

export interface SimulationResult {
  log: SimulationLogEntry[];
  traversals: Traversal[];
  tables: TableSnapshot;
}

export interface PingOptions {
  fromHostId: DeviceId;
  toIp: string;
  ttl?: number;
}
