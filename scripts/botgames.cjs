const { createRequire } = require('node:module');
const WebSocket = createRequire(__dirname + '/../apps/server/package.json')('ws');
const U = process.env.SERVER ?? 'localhost:8787';
const SIZES = (process.env.SIZES ?? '4,12').split(',').map(Number);
async function game(n) {
  const { code } = await (await fetch(`http://${U}/api/rooms`, { method: 'POST' })).json();
  const ws = new WebSocket(`ws://${U}/ws`);
  const t0 = Date.now();
  const phases = [];
  let result,
    added = false,
    started = false;
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error(`timeout n=${n} phase=${phases.at(-1)}`)), 280000);
    ws.on('open', () =>
      ws.send(JSON.stringify({ t: 'hello', room: code, kind: 'player', name: 'Human' })),
    );
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'error') return rej(new Error(m.message));
      if (m.t !== 'state') return;
      const k = m.view.phase.kind;
      if (phases.at(-1) !== k) phases.push(k);
      if (k === 'lobby' && !added) {
        added = true;
        ws.send(JSON.stringify({ t: 'host', command: { cmd: 'addBots', count: n - 1 } }));
      } else if (k === 'lobby' && !started && m.view.players.length === n) {
        started = true;
        ws.send(JSON.stringify({ t: 'act', action: { type: 'start' } }));
      }
      if (k === 'finalReveal') {
        clearTimeout(to);
        result = m;
        res();
      }
    });
  });
  const v = result.view;
  console.log(
    `n=${n} room=${code} finished in ${((Date.now() - t0) / 1000).toFixed(1)}s pot=${v.pot} players=${v.players.length}`,
  );
  console.log('  phases seen:', [...new Set(phases)].join(','));
  console.log(
    '  fates:',
    v.players.map((p) => `${p.name}:${p.fate}${p.role ? '/' + p.role : ''}`).join(' '),
  );
  ws.close();
}
(async () => {
  for (const n of SIZES) await game(n);
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
