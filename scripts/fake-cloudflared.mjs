#!/usr/bin/env node
// Test stand-in for cloudflared: prints a quick-tunnel banner on stderr and stays alive.
console.error('2026-10-31T00:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...');
console.error('|  https://fake-night-table.trycloudflare.com                                 |');
setInterval(() => {}, 1e6);
