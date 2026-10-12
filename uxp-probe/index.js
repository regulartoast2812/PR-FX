/*
 * PR FX UXP capability probe.
 *
 * The question this answers is narrow: could PR FX be rebuilt on UXP at all?
 * Everything in jsx/host.jsx runs on ExtendScript plus the QE DOM, and UXP has
 * neither. So before committing to a rewrite, find out whether the dozen
 * primitives the tool is actually built on have UXP equivalents.
 *
 * It ENUMERATES rather than assumes. Guessing an API surface and writing code
 * against it is what cost days on the CEP side; the same mistake here would be
 * worse because the whole tool would be riding on it.
 */

const out = document.getElementById('out');
let lastReport = 'Not run yet.';

function log(lines) {
  lastReport = lines.join('\n');
  out.textContent = lastReport;
}

// Names are classified, not called. Calling unknown API surface in a host app
// is how you corrupt somebody's project.
function describe(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'function') return 'function';
  if (t === 'object') return Array.isArray(value) ? `array[${value.length}]` : 'object';
  return `${t} ${String(value).slice(0, 40)}`;
}

function members(obj, label) {
  const lines = [`== ${label} ==`];
  if (obj === null || obj === undefined) {
    lines.push('  <not available>');
    return lines;
  }
  const seen = new Set();
  let cursor = obj;
  let depth = 0;
  while (cursor && depth < 4) {
    let names;
    try { names = Object.getOwnPropertyNames(cursor); } catch (e) { break; }
    names.sort().forEach((name) => {
      if (seen.has(name) || name === 'constructor') return;
      seen.add(name);
      let kind = '?';
      // Reading a property can throw on a getter that needs app state.
      try { kind = describe(obj[name]); } catch (e) { kind = 'threw: ' + e.message; }
      lines.push(`  ${name} : ${kind}`);
    });
    cursor = Object.getPrototypeOf(cursor);
    depth += 1;
  }
  if (seen.size === 0) lines.push('  <no enumerable members>');
  return lines;
}

// What PR FX actually needs. Each entry lists the names worth looking for;
// the probe reports which, if any, turned up anywhere in the API surface.
const REQUIREMENTS = [
  ['Active sequence access', ['getActiveSequence', 'activeSequence', 'sequence']],
  ['Enumerate video/audio tracks', ['getVideoTrack', 'getAudioTrack', 'videoTracks', 'audioTracks', 'getTrackItems']],
  ['Move a clip to another track', ['moveToTrack', 'move', 'setTrack']],
  ['Change clip speed', ['setSpeed', 'speed', 'changeSpeed']],
  ['Split / razor at a time', ['razor', 'split', 'addEdit']],
  ['Add a video effect to a clip', ['addVideoEffect', 'addEffect', 'createComponent', 'insertComponent']],
  ['Component + keyframe access', ['getComponentChain', 'components', 'addKeyframe', 'setValueAtKey', 'getKeyframes']],
  ['Undo grouping / transactions', ['createTransaction', 'executeTransaction', 'undoStackIndex', 'beginUndoGroup', 'lockedAccess']],
  ['Replace a clip media (direct swap)', ['setProjectItem', 'replaceMedia', 'changeMedia', 'projectItem']],
  ['Overwrite / insert into a sequence', ['overwriteItem', 'insertItem', 'createOverwriteItemAction', 'createInsertItemAction']],
  ['Project item in/out points', ['setInPoint', 'setOutPoint', 'getInPoint', 'getOutPoint']],
  ['Trim a timeline clip', ['setStartTime', 'setEndTime', 'setInPoint', 'setOutPoint']],
  ['Selection read/write', ['getSelection', 'setSelection', 'createSetSelectionAction']],
  ['Markers', ['getMarkers', 'createMarker', 'markers']]
];

function collectNames(root, label, bag, depth) {
  if (!root || depth > 2) return;
  let names;
  try { names = Object.getOwnPropertyNames(root); } catch (e) { return; }
  names.forEach((name) => {
    if (name === 'constructor') return;
    bag.set(name, (bag.get(name) || []).concat(label));
    let child = null;
    try { child = root[name]; } catch (e) { return; }
    if (child && (typeof child === 'object' || typeof child === 'function')) {
      // Prototypes carry the instance methods that matter.
      try { collectNames(child.prototype || null, `${label}.${name}.prototype`, bag, depth + 1); } catch (e) { /* ignore */ }
    }
  });
  try { collectNames(Object.getPrototypeOf(root), `${label}^proto`, bag, depth + 1); } catch (e) { /* ignore */ }
}

async function runProbe() {
  const lines = [];
  lines.push('PR FX UXP capability probe');
  lines.push(new Date().toString());
  lines.push('');

  let ppro = null;
  try {
    ppro = require('premierepro');
    lines.push('require("premierepro") : OK');
  } catch (e) {
    lines.push('require("premierepro") FAILED: ' + e.message);
  }

  let uxpVersion = '';
  try {
    const uxp = require('uxp');
    uxpVersion = (uxp.versions && JSON.stringify(uxp.versions)) || '';
    lines.push('uxp versions: ' + uxpVersion);
  } catch (e) {
    lines.push('require("uxp") FAILED: ' + e.message);
  }
  lines.push('');

  if (ppro) {
    lines.push(...members(ppro, 'premierepro (top level)'));
    lines.push('');

    // Live objects expose far more than the module does. Read-only calls only.
    let project = null;
    try {
      project = ppro.Project && ppro.Project.getActiveProject ? await ppro.Project.getActiveProject() : null;
      lines.push('Project.getActiveProject() : ' + describe(project));
    } catch (e) {
      lines.push('Project.getActiveProject() threw: ' + e.message);
    }
    if (project) {
      lines.push(...members(project, 'project instance'));
      lines.push('');
      let sequence = null;
      try {
        sequence = project.getActiveSequence ? await project.getActiveSequence() : null;
        lines.push('project.getActiveSequence() : ' + describe(sequence));
      } catch (e) {
        lines.push('getActiveSequence() threw: ' + e.message);
      }
      if (sequence) {
        lines.push(...members(sequence, 'sequence instance'));
        lines.push('');
        try {
          const track = sequence.getVideoTrack ? await sequence.getVideoTrack(0) : null;
          lines.push('sequence.getVideoTrack(0) : ' + describe(track));
          if (track) {
            lines.push(...members(track, 'video track instance'));
            const items = track.getTrackItems ? await track.getTrackItems(1, false) : null;
            lines.push('track.getTrackItems() : ' + describe(items));
            if (items && items.length) {
              lines.push(...members(items[0], 'track item instance'));
            }
          }
        } catch (e) {
          lines.push('track inspection threw: ' + e.message);
        }
      }
    }
    lines.push('');

    // Requirement scorecard, built from every name found anywhere above.
    const bag = new Map();
    collectNames(ppro, 'premierepro', bag, 0);
    lines.push('== PR FX REQUIREMENTS ==');
    REQUIREMENTS.forEach(([need, candidates]) => {
      const hits = candidates.filter((c) => bag.has(c));
      if (hits.length) {
        lines.push(`  FOUND    ${need}`);
        hits.forEach((h) => lines.push(`             ${h}  (${bag.get(h).slice(0, 2).join(', ')})`));
      } else {
        lines.push(`  MISSING  ${need}`);
        lines.push(`             looked for: ${candidates.join(', ')}`);
      }
    });
    lines.push('');
    lines.push(`Total distinct API names discovered: ${bag.size}`);
    lines.push('');
    lines.push('MISSING does not prove absence — the name may simply differ.');
    lines.push('Check the full member listings above before concluding anything,');
    lines.push('exactly as reflection could not prove absence on the CEP side.');
  }

  log(lines);
}

async function saveReport() {
  try {
    const fs = require('uxp').storage.localFileSystem;
    const file = await fs.getFileForSaving('PR FX UXP Probe.txt');
    if (!file) return;
    await file.write(lastReport);
    out.textContent = lastReport + '\n\n(saved)';
  } catch (e) {
    out.textContent = lastReport + '\n\nSave failed: ' + e.message;
  }
}

document.getElementById('run').addEventListener('click', () => {
  runProbe().catch((e) => { out.textContent = 'Probe threw: ' + e.message + '\n' + (e.stack || ''); });
});
document.getElementById('save').addEventListener('click', saveReport);
