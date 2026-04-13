import assert from "assert";
import { brokenConfigSample, routedSample, sameSubnetSample } from "../src/data/samples";
import { resetNetwork, simulatePing } from "../src/sim/simulator";

function messages(result: ReturnType<typeof simulatePing>): string {
  return result.log.map((entry) => entry.message).join("\n");
}

function testSameSubnetPing(): void {
  const result = simulatePing(sameSubnetSample.topology, sameSubnetSample.ping);
  assert(messages(result).includes("Host B received ICMP echo request"));
  assert(messages(result).includes("Host A received ICMP echo reply"));
  assert(result.tables.switchMacTables.s1.some((row) => row.mac === "00:00:00:00:00:0a"));
  assert(result.tables.arpTables.h1.some((row) => row.ip === "10.0.0.20"));
  assert(messages(result).includes("Dropped 10 frames on unlinked interfaces"));
  assert(!messages(result).includes("s1.p3 is not linked"));
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
  assert(messages(result).includes("h1 ARPs for 10.0.1.254"));
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

testSameSubnetPing();
testRoutedPing();
testBrokenGateway();
testTtlExpiration();
testResetNetwork();

console.log("simulator tests passed");
