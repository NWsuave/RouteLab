# RouteLab

RouteLab is a TypeScript MVP for a deterministic educational network simulator. It models a small Ethernet/IP lab without random latency, packet loss, or background protocols, so repeated runs produce the same ordered traversal and log.

## Features

- Topology editor with hosts, switches, routers, and point-to-point links
- Drag devices on the topology canvas to position them
- Scale diagram symbols, text, labels, and subnet group bounds to fit more in frame
- Delete selected devices from the config panel
- Reset the network to clear learned MAC/ARP tables and traversal/log output
- Export and import network configurations as JSON files
- Switches use 12 interfaces by default, named `p1` through `p12`
- Router interfaces use short names, `e0` and `e1`
- Optional device-box labels for host IP/MAC and both upper/lower router interface IPv4/MAC values
- Device config panel for host addressing, host-initiated pings, router interfaces, and static routes
- Event-driven simulation for Ethernet, ARP, IPv4, static routing, and ICMP ping
- Switch source MAC learning, broadcast flooding, and unknown unicast flooding
- ARP request broadcast and ARP reply unicast
- Host local-vs-remote subnet decision and default gateway usage
- Router longest-prefix match, TTL decrement, and drop handling
- Traversal timeline, ordered simulation log, switch forwarding tables, ARP tables, and router routing tables
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
192.168.3.0/24 192.168.2.2
0.0.0.0/0 192.168.1.254
```

The outgoing interface is inferred from the connected subnet that contains the next hop.
