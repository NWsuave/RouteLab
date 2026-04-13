import assert from "assert";
import { brokenConfigSample, routedSample, sameSubnetSample } from "../src/data/samples";
import { resetNetwork, simulatePing } from "../src/sim/simulator";
import { Topology } from "../src/sim/types";

function messages(result: ReturnType<typeof simulatePing>): string {
  return result.log.map((entry) => entry.message).join("\n");
}

function testSameSubnetPing(): void {
  const result = simulatePing(sameSubnetSample.topology, sameSubnetSample.ping);
  assert(messages(result).includes("Host B received ICMP echo request"));
  assert(messages(result).includes("Host A received ICMP echo reply"));
  assert(result.tables.switchMacTables.s1.some((row) => row.mac === "00:00:00:00:00:0a"));
  assert(result.tables.arpTables.h1.some((row) => row.ip === "10.0.0.20"));
  assert(result.traversals.some((item) => item.reason === "known unicast"));
  assert(!messages(result).includes("unlinked interface"));
}

function testRoutedPing(): void {
  const result = simulatePing(routedSample.topology, routedSample.ping);
  assert(messages(result).includes("Router 1 forwards 10.0.2.20 via e1; TTL 8 -> 7"));
  assert(messages(result).includes("Router 1 forwards 10.0.1.10 via e0; TTL 8 -> 7"));
  assert(messages(result).includes("Host A received ICMP echo reply"));
  assert(result.tables.routerRoutingTables.r1.some((row) => row.prefix === "10.0.2.1"));
}

function testBrokenGateway(): void {
  const result = simulatePing(brokenConfigSample.topology, brokenConfigSample.ping);
  assert(messages(result).includes("Host A ARPs for 10.0.1.254"));
  assert(!messages(result).includes("Host A received ICMP echo reply"));
}

function testTtlExpiration(): void {
  const result = simulatePing(routedSample.topology, { ...routedSample.ping, ttl: 1 });
  assert(messages(result).includes("Router 1 dropped packet to 10.0.2.20: TTL expired"));
}

function testResetNetwork(): void {
  const result = resetNetwork(routedSample.topology);
  assert.equal(result.log.length, 0);
  assert.equal(result.traversals.length, 0);
  assert.equal(result.tables.switchMacTables.s1.length, 0);
  assert.equal(result.tables.arpTables.h1.length, 0);
  assert(result.tables.routerRoutingTables.r1.some((row) => row.outPortId === "e0"));
}

function testStaticRouteInfersOutPortFromNextHop(): void {
  const topology: Topology = {
    devices: [
      {
        id: "h1",
        name: "Host A",
        kind: "host",
        position: { x: 0, y: 0 },
        ports: [{ id: "eth0", config: { ip: "10.0.1.10", mask: 24, mac: "00:00:00:00:01:0a", gateway: "10.0.1.1" } }],
      },
      { id: "s1", name: "Switch 1", kind: "switch", position: { x: 0, y: 0 }, ports: [{ id: "p1" }, { id: "p2" }] },
      {
        id: "r1",
        name: "Router 1",
        kind: "router",
        position: { x: 0, y: 0 },
        ports: [
          { id: "e0", config: { ip: "10.0.1.1", mask: 24, mac: "00:00:00:00:01:01" } },
          { id: "e1", config: { ip: "10.0.12.1", mask: 24, mac: "00:00:00:00:12:01" } },
        ],
        routes: [{ prefix: "10.0.2.0", mask: 24, nextHop: "10.0.12.2" }],
      },
      {
        id: "r2",
        name: "Router 2",
        kind: "router",
        position: { x: 0, y: 0 },
        ports: [
          { id: "e0", config: { ip: "10.0.12.2", mask: 24, mac: "00:00:00:00:12:02" } },
          { id: "e1", config: { ip: "10.0.2.1", mask: 24, mac: "00:00:00:00:02:01" } },
        ],
        routes: [{ prefix: "10.0.1.0", mask: 24, nextHop: "10.0.12.1" }],
      },
      { id: "s2", name: "Switch 2", kind: "switch", position: { x: 0, y: 0 }, ports: [{ id: "p1" }, { id: "p2" }] },
      {
        id: "h2",
        name: "Host B",
        kind: "host",
        position: { x: 0, y: 0 },
        ports: [{ id: "eth0", config: { ip: "10.0.2.20", mask: 24, mac: "00:00:00:00:02:14", gateway: "10.0.2.1" } }],
      },
    ],
    links: [
      { id: "l1", a: { deviceId: "h1", portId: "eth0" }, b: { deviceId: "s1", portId: "p1" } },
      { id: "l2", a: { deviceId: "s1", portId: "p2" }, b: { deviceId: "r1", portId: "e0" } },
      { id: "l3", a: { deviceId: "r1", portId: "e1" }, b: { deviceId: "r2", portId: "e0" } },
      { id: "l4", a: { deviceId: "r2", portId: "e1" }, b: { deviceId: "s2", portId: "p1" } },
      { id: "l5", a: { deviceId: "s2", portId: "p2" }, b: { deviceId: "h2", portId: "eth0" } },
    ],
  };
  const result = simulatePing(topology, { fromHostId: "h1", toIp: "10.0.2.20" });
  assert(messages(result).includes("Router 1 forwards 10.0.2.20 via e1; TTL 8 -> 7"));
  assert(messages(result).includes("Host A received ICMP echo reply"));
}

function testUnlinkedDropsAreSummarized(): void {
  const topology: Topology = {
    devices: [
      {
        id: "h1",
        name: "Host A",
        kind: "host",
        position: { x: 0, y: 0 },
        ports: [{ id: "eth0", config: { ip: "10.0.0.10", mask: 24, mac: "00:00:00:00:00:0a" } }],
      },
    ],
    links: [],
  };
  const result = simulatePing(topology, { fromHostId: "h1", toIp: "10.0.0.20" });
  assert(messages(result).includes("Dropped 1 frame on unlinked interface: Host A.eth0"));
  assert(!messages(result).includes("Host A.eth0 is not linked"));
}

testSameSubnetPing();
testRoutedPing();
testBrokenGateway();
testTtlExpiration();
testResetNetwork();
testStaticRouteInfersOutPortFromNextHop();
testUnlinkedDropsAreSummarized();

console.log("simulator tests passed");
