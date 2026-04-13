# RouteLab

RouteLab is a TypeScript MVP for a deterministic educational network simulator. It models a small Ethernet/IP lab without random latency, packet loss, or background protocols, so repeated runs produce the same ordered traversal and log.

## Features

- Topology editor with hosts, switches, routers, and point-to-point links
- Device config panel for host addressing, router interfaces, and static routes
- Event-driven simulation for Ethernet, ARP, IPv4, static routing, and ICMP ping
- Switch source MAC learning, broadcast flooding, and unknown unicast flooding
- ARP request broadcast and ARP reply unicast
- Host local-vs-remote subnet decision and default gateway usage
- Router longest-prefix match, TTL decrement, and drop handling
- Traversal timeline, ordered simulation log, switch MAC tables, ARP tables, and router routing tables
- Built-in same-subnet, routed, and broken gateway scenarios

Out of scope for this MVP: VLANs, DHCP, NAT, ACLs, TCP, STP, and dynamic routing.

## Run Locally

```bash
npm install
npm run dev
```

Open the local Vite URL shown by the command.

## Test

```bash
npm test
```

The test file covers:

- Same-subnet ARP and ICMP echo flow
- Routed ICMP echo flow through a router
- Broken default gateway ARP failure
- TTL expiration drop

## Build

```bash
npm run build
```

## Project Layout

- `src/sim`: deterministic simulation core
- `src/data/samples.ts`: sample topologies and default ping commands
- `src/main.ts`: minimal TypeScript UI
- `src/styles.css`: app styling
- `tests/simulator.test.ts`: core simulator tests

## Static Route Format

In the router config panel, enter one route per line:

```text
192.168.3.0/24 192.168.2.2 g0/1
0.0.0.0/0 192.168.1.254 g0/0
10.0.5.0/24 direct g0/1
```

`direct` means the router ARPs for the destination IP on the chosen outgoing port. Any other next-hop value is used as the ARP target.
