// PR FX's tools for an agent (Edie in Creative Assist, or any MCP client):
// a stdio MCP server, newline-delimited JSON-RPC, no dependencies.
//
// It runs commands exactly as a shortcut or the palette would: through the
// listener's bridge, onto the clips selected in Premiere. Every PR FX command
// verifies before it mutates and rolls back whole on failure, and Premiere's
// own undo still works after it.
import readline from 'node:readline';
import {
  health, statusLine, readSettings, readCatalog, findCommands, commandByName, runPayload, runAndWait, readJournal, startListener,
} from './core.mjs';
import { detect } from './connectors.mjs';

const missingLines = report => report.connectors.filter(c => !c.ok && !c.optional).map(c => `- ${c.label}: ${c.detail}`);

const VERSION = '0.4.0';

const TOOLS = [
  {
    name: 'premiere_status',
    description: 'Whether PR FX can run commands in Premiere Pro right now: the listener, whether Premiere is in front, whether the Timeline is detected and shortcuts are armed. Call this first if a run fails.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'premiere_find_commands',
    description: 'Search the PR FX command catalog (375+ Premiere Pro editing commands: move/stagger/close gaps, transitions, effect presets, Lumetri looks, bulk replace, export, adjustment layers…). Every word of the query must appear in the name. Returns exact names to pass to premiere_run.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words from the command name, e.g. "stagger", "cross dissolve", "move up".' },
        type: { type: 'string', description: 'Optional: only this kind — custom (PR FX functions), transition, effect, preset, lumetri.' },
        limit: { type: 'number', description: 'At most this many (default 15, max 50).' },
      },
      required: ['query'], additionalProperties: false,
    },
  },
  {
    name: 'premiere_run',
    description: 'Run one PR FX command on the clips currently selected in Premiere Pro\'s Timeline and wait for its result (up to 20 s). Use the exact name from premiere_find_commands. It edits the user\'s project: run only what the user asked for, one command at a time, and report the result message.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The command\'s exact name.' },
        transitionFrames: { type: 'number', description: 'Transitions only: length in frames (default from settings).' },
        placement: { type: 'string', enum: ['center', 'start', 'end'], description: 'Transitions only: where on the cut (default center).' },
      },
      required: ['name'], additionalProperties: false,
    },
  },
  {
    name: 'premiere_recent',
    description: 'The latest PR FX results (shortcuts, palette and agent runs): what ran, whether it succeeded, and its message.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Default 10, max 50.' } }, additionalProperties: false },
  },
];

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

async function call(name, args) {
  if (name === 'premiere_status') {
    let h = null;
    try { h = await health(); } catch (_) {}
    if (!h) {
      const started = await startListener();
      try { h = await health(); } catch (_) {}
      if (!h) {
        const report = await detect({ health: null });
        return text(['The PR FX listener is not running' + (started.ok ? ' and did not answer after starting.' : ': ' + started.message),
          `On ${report.label}, what is missing:`, ...missingLines(report)].join('\n'), true);
      }
    }
    const s = statusLine(h);
    const g = h.geometry || {};
    return text([
      `Status: ${s.label}`,
      `Premiere in front: ${g.premiereFrontmost ? 'yes' : 'no'}`,
      `Timeline detected: ${g.live ? 'yes' : g.saved ? 'remembered position only' : 'no'}`,
      `Export/Import mode: ${g.panelsHidden ? 'yes (plain-key shortcuts paused)' : 'no'}`,
      `Commands available: ${readCatalog().length}`,
      ...await detect({ health: h }).then(r => r.ready ? [`${r.label}: every connector in place`] : [`${r.label}, not in place:`, ...missingLines(r)]),
      'Agent runs work whatever the shortcut scope is; they act on the clips selected in the Timeline.',
    ].join('\n'));
  }
  if (name === 'premiere_find_commands') {
    const limit = Math.max(1, Math.min(50, Number(args.limit) || 15));
    const found = findCommands(String(args.query || ''), { type: String(args.type || ''), limit, includeSystem: /system/i.test(String(args.query || '')) });
    if (!found.length) return text(`No command matches "${args.query}". Try fewer or different words.`);
    return text(found.map(c => `- ${c.name}  [${c.type}]`).join('\n'));
  }
  if (name === 'premiere_run') {
    const c = commandByName(String(args.name || ''));
    if (!c) {
      const near = findCommands(String(args.name || ''), { limit: 5 });
      return text(`No command is called "${args.name}".` + (near.length ? ' Did you mean:\n' + near.map(x => '- ' + x.name).join('\n') : ''), true);
    }
    if (c.id === 'stretch-speed-to-playhead') return text('Stretch Speed to Playhead is parked and cannot run.', true);
    const settings = readSettings();
    const payload = runPayload(c, settings, args.placement || 'center');
    if (Number(args.transitionFrames) > 0) payload.transitionFrames = Math.round(Number(args.transitionFrames));
    try {
      const r = await runAndWait(payload);
      const head = r.outcome === 'ok' ? 'Done' : r.outcome === 'failed' ? 'Failed' : r.outcome === 'expired' ? 'Expired (Premiere did not pick it up within 5 s)' : 'No result yet';
      return text(`${head}: ${c.name}${r.ms != null ? ` (${r.ms} ms)` : ''}\n${r.message || ''}`.trim(), r.outcome !== 'ok');
    } catch (error) {
      return text(`Could not send ${c.name}: ${error.message}`, true);
    }
  }
  if (name === 'premiere_recent') {
    const limit = Math.max(1, Math.min(50, Number(args.limit) || 10));
    const lines = readJournal(400).filter(l => /^(ok|failed|expired)$/.test(l.event)).slice(-limit).reverse();
    if (!lines.length) return text('Nothing has run yet.');
    return text(lines.map(l => `${l.time}  ${l.event.toUpperCase()}  ${l.command} — ${l.detail.replace(/^\d+ms\s*/, '')}`).join('\n'));
  }
  return text('Unknown tool: ' + name, true);
}

function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
  let msg;
  try { msg = JSON.parse(line); } catch (_) { return; }
  const { id, method, params } = msg || {};
  if (id === undefined) return; // notifications (initialized, cancelled)
  try {
    if (method === 'initialize') {
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'prfx', version: VERSION },
        instructions: 'PR FX runs editing commands in Adobe Premiere Pro on the clips selected in the Timeline. Find the exact command name with premiere_find_commands, then premiere_run it. Check premiere_status if something fails.',
      });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: TOOLS });
    if (method === 'tools/call') return reply(id, await call(params && params.name, (params && params.arguments) || {}));
    if (method === 'resources/list') return reply(id, { resources: [] });
    if (method === 'prompts/list') return reply(id, { prompts: [] });
    fail(id, -32601, 'Method not found: ' + method);
  } catch (error) {
    fail(id, -32603, error.message);
  }
});
