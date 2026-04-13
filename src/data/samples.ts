import { Topology } from "../sim/types";

export interface SampleScenario {
  id: string;
  name: string;
  description: string;
  topology: Topology;
  ping: {
    fromHostId: string;
    toIp: string;
    ttl?: number;
  };
}

export const sameSubnetSample: SampleScenario = {
  id: "same-subnet",
  name: "Same-subnet ping",
  description: "Two hosts on one switch resolve ARP directly, then exchange ICMP echo traffic.",
  ping: { fromHostId: "h1", toIp: "10.0.0.20" },
  topology: {
    devices: [
      {
        id: "h1",
        name: "Host A",
        kind: "host",
        position: { x: 80, y: 120 },
        ports: [{ id: "eth0", config: { ip: "10.0.0.10", mask: 24, mac: "00:00:00:00:00:0a" } }],
      },
      {
        id: "s1",
        name: "Switch 1",
        kind: "switch",
        position: { x: 310, y: 120 },
        ports: [{ id: "p1" }, { id: "p2" }],
      },
      {
        id: "h2",
        name: "Host B",
        kind: "host",
        position: { x: 540, y: 120 },
        ports: [{ id: "eth0", config: { ip: "10.0.0.20", mask: 24, mac: "00:00:00:00:00:14" } }],
      },
    ],
    links: [
      { id: "l1", a: { deviceId: "h1", portId: "eth0" }, b: { deviceId: "s1", portId: "p1" } },
      { id: "l2", a: { deviceId: "s1", portId: "p2" }, b: { deviceId: "h2", portId: "eth0" } },
    ],
  },
};

export const routedSample: SampleScenario = {
  id: "routed",
  name: "Routed ping",
  description: "Hosts on different subnets ARP for their default gateways and route through R1.",
  ping: { fromHostId: "h1", toIp: "10.0.2.20" },
  topology: {
    devices: [
      {
        id: "h1",
        name: "Host A",
        kind: "host",
        position: { x: 60, y: 100 },
        ports: [{ id: "eth0", config: { ip: "10.0.1.10", mask: 24, mac: "00:00:00:00:01:0a", gateway: "10.0.1.1" } }],
      },
      {
        id: "s1",
        name: "Switch 1",
        kind: "switch",
        position: { x: 240, y: 100 },
        ports: [{ id: "p1" }, { id: "p2" }],
      },
      {
        id: "r1",
        name: "Router 1",
        kind: "router",
        position: { x: 420, y: 100 },
        ports: [
          { id: "g0/0", config: { ip: "10.0.1.1", mask: 24, mac: "00:00:00:00:01:01" } },
          { id: "g0/1", config: { ip: "10.0.2.1", mask: 24, mac: "00:00:00:00:02:01" } },
        ],
        routes: [],
      },
      {
        id: "s2",
        name: "Switch 2",
        kind: "switch",
        position: { x: 600, y: 100 },
        ports: [{ id: "p1" }, { id: "p2" }],
      },
      {
        id: "h2",
        name: "Host B",
        kind: "host",
        position: { x: 780, y: 100 },
        ports: [{ id: "eth0", config: { ip: "10.0.2.20", mask: 24, mac: "00:00:00:00:02:14", gateway: "10.0.2.1" } }],
      },
    ],
    links: [
      { id: "l1", a: { deviceId: "h1", portId: "eth0" }, b: { deviceId: "s1", portId: "p1" } },
      { id: "l2", a: { deviceId: "s1", portId: "p2" }, b: { deviceId: "r1", portId: "g0/0" } },
      { id: "l3", a: { deviceId: "r1", portId: "g0/1" }, b: { deviceId: "s2", portId: "p1" } },
      { id: "l4", a: { deviceId: "s2", portId: "p2" }, b: { deviceId: "h2", portId: "eth0" } },
    ],
  },
};

export const brokenConfigSample: SampleScenario = {
  id: "broken",
  name: "Broken gateway",
  description: "Host A points at a gateway IP that no device owns, so ARP never resolves and ping cannot start.",
  ping: { fromHostId: "h1", toIp: "10.0.2.20" },
  topology: {
    ...routedSample.topology,
    devices: routedSample.topology.devices.map((device) => {
      if (device.id !== "h1" || device.kind !== "host") return device;
      return {
        ...device,
        ports: [{ id: "eth0", config: { ...device.ports[0].config, gateway: "10.0.1.254" } }],
      };
    }),
  },
};

export const samples: SampleScenario[] = [sameSubnetSample, routedSample, brokenConfigSample];
