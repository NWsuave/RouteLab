import assert from "assert";
import { brokenConfigSample, routedSample, sameSubnetSample } from "../src/data/samples";
import { simulatePing } from "../src/sim/simulator";

function messages(result: ReturnType<typeof simulatePing>): string {
  return result.log.map((entry) => entry.message).join("\n");
}

function testSameSubnetPing(): void {
  const result = simulatePing(sameSubnetSample.topology, sameSubnetSample.ping);
  assert(messages(result).includes("Host B received ICMP echo request"));
  assert(messages(result).includes("Host A received ICMP echo reply"));
  assert(result.tables.switchMacTables.s1.some((row) => row.mac === "00:00:00:00:00:0a"));
  assert(result.tables.arpTables.h1.some((row) => row.ip === "10.0.0.20"));
}

function testRoutedPing(): void {
  const result = simulatePing(routedSample.topology, routedSample.ping);
  assert(messages(result).includes("Router 1 forwards 10.0.2.20 via g0/1; TTL 8 -> 7"));
  assert(messages(result).includes("Router 1 forwards 10.0.1.10 via g0/0; TTL 8 -> 7"));
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

testSameSubnetPing();
testRoutedPing();
testBrokenGateway();
testTtlExpiration();

console.log("simulator tests passed");
