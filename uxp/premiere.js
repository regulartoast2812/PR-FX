/* Edie's Premiere UXP command adapter. No Node, shell, AI, or media work lives
 * here: UXP owns Premiere DOM changes; Creative Assist owns reusable tools.
 *
 * Every command is the UXP twin of the same command in jsx/host.jsx. Where
 * Premiere's UXP API cannot do what ExtendScript/QE did (speed changes, audio
 * transitions, saved presets) the command is simply not registered, so the
 * listener keeps sending it to the CEP engine.
 *
 * Rules shared by every command:
 * - All edits of one step go in one transaction, so Premiere's Undo takes the
 *   whole step back. Some commands need two or three (Premiere applies a
 *   project item's In/Out only when its transaction commits); `steps` counts
 *   them so Edie's own Undo commands press Undo the right number of times.
 * - Nothing is guessed silently. Calls whose exact behaviour Adobe does not
 *   document (moving, cloning, trimming) are checked afterwards; when Premiere
 *   did something else, Edie undoes it and says so.
 * - Linked clips: UXP cannot read links, so a video clip and the audio clips
 *   with the same name and exactly the same start and end are treated as one.
 */
(function (global) {
  'use strict';

  var ppro = null;
  try { ppro = require('premierepro'); }
  catch (error) { console.error('[Edie UXP] Premiere API unavailable', error); }

  var TICKS_PER_SECOND = 254016000000;
  var steps = 0;           // transactions committed by the running command
  var store = null;
  try { store = global.localStorage; } catch (_) { store = null; }

  // MARK: Small helpers

  function asPromise(value) { return value && typeof value.then === 'function' ? value : Promise.resolve(value); }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function plural(count, word, many) { return count + ' ' + (count === 1 ? word : (many || word + 's')); }
  function seconds(time) { return time && Number(time.seconds); }
  function ticksOf(time) {
    if (!time) return NaN;
    var value = Number(time.ticks);
    if (!isNaN(value)) return value;
    value = Number(time.ticksNumber);
    if (!isNaN(value)) return value;
    return Math.round(Number(time.seconds) * TICKS_PER_SECOND);
  }
  function timeAt(ticks) { return ppro.TickTime.createWithTicks(String(Math.max(0, Math.round(ticks)))); }
  // A signed offset. Negative tick strings are not documented, so a negative
  // offset is built by subtraction when Premiere refuses one.
  function offsetTime(ticks) {
    ticks = Math.round(ticks);
    if (ticks >= 0) return ppro.TickTime.createWithTicks(String(ticks));
    try { var direct = ppro.TickTime.createWithTicks(String(ticks)); if (Math.abs(ticksOf(direct) - ticks) <= 1) return direct; } catch (_) {}
    return ppro.TickTime.TIME_ZERO.subtract(ppro.TickTime.createWithTicks(String(-ticks)));
  }
  function framesText(ticks, frameTicks) {
    var frames = Math.round(ticks / frameTicks);
    return plural(frames, 'frame');
  }
  function toArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    var result = [];
    if (typeof value.length === 'number') for (var i = 0; i < value.length; i++) result.push(value[i]);
    else if (typeof value.getCount === 'function' && typeof value.getItemAtIndex === 'function') {
      var count = value.getCount();
      for (var j = 0; j < count; j++) result.push(value.getItemAtIndex(j));
    }
    return result;
  }
  async function tryCall(object, name) {
    if (!object || typeof object[name] !== 'function') return undefined;
    try { return await asPromise(object[name].apply(object, Array.prototype.slice.call(arguments, 2))); }
    catch (_) { return undefined; }
  }
  function remembered(key, fallback) { try { return (store && store.getItem(key)) || fallback; } catch (_) { return fallback; } }
  function remember(key, value) { try { if (store) store.setItem(key, value); } catch (_) {} }
  function mediaType(kind) {
    var types = ppro.Constants && ppro.Constants.MediaType;
    return types ? (kind === 'audio' ? types.AUDIO : types.VIDEO) : undefined;
  }

  async function activeProject() {
    if (!ppro) throw new Error('Premiere’s UXP API is unavailable.');
    var project = await ppro.Project.getActiveProject();
    if (!project) throw new Error('Open a Premiere project first.');
    return project;
  }

  async function context() {
    var project = await activeProject();
    var sequence = await project.getActiveSequence();
    if (!sequence) throw new Error('Open a sequence first.');
    var editor = ppro.SequenceEditor && ppro.SequenceEditor.getEditor ? await asPromise(ppro.SequenceEditor.getEditor(sequence)) : null;
    var frameTicks = Number(await asPromise(sequence.getTimebase()));
    if (!(frameTicks > 0)) frameTicks = TICKS_PER_SECOND / 30;
    return { project: project, sequence: sequence, editor: editor, frameTicks: frameTicks };
  }

  async function playheadTicks(sequence) {
    var at = ticksOf(await asPromise(sequence.getPlayerPosition()));
    if (!(at >= 0)) throw new Error('Premiere could not read the playhead position.');
    return at;
  }

  async function transaction(project, label, addActions) {
    var caught = null, added = 0;
    var result = project.lockedAccess(function () {
      try {
        project.executeTransaction(function (actions) {
          addActions({ addAction: function (action) { if (action) { actions.addAction(action); added++; } } });
        }, label);
      } catch (error) { caught = error; }
    });
    await asPromise(result);
    if (caught) throw caught;
    if (added) steps++;
    return added;
  }

  // Edie's Undo goes through the listener (UXP has no undo call); bridge.js
  // installs it. Used to take back a step that Premiere carried out wrongly.
  async function pressUndo(count) {
    if (!count) return false;
    if (!api.pressUndo) return false;
    try { await api.pressUndo(count, false); } catch (_) { return false; }
    await wait(250 + count * 120);
    steps = Math.max(0, steps - count);
    return true;
  }

  async function failAndUndo(message) {
    var undone = await pressUndo(steps);
    throw new Error(message + (undone ? ' Edie undid it.' : ' Press Undo (⌘Z / Ctrl+Z) ' + plural(steps, 'time') + ' to put it back.'));
  }

  // MARK: Timeline snapshot

  async function trackItems(track) {
    if (!track || typeof track.getTrackItems !== 'function') return [];
    var types = ppro.Constants && ppro.Constants.TrackItemType;
    var clipType = types && types.CLIP !== undefined ? types.CLIP : 1;
    return toArray(await asPromise(track.getTrackItems(clipType, false)));
  }

  async function describe(item, kind, trackIndex) {
    var start = ticksOf(await asPromise(item.getStartTime()));
    var end = ticksOf(await asPromise(item.getEndTime()));
    var name = String((await tryCall(item, 'getName')) || '');
    var selected = await tryCall(item, 'getIsSelected');
    var adjustment = (await tryCall(item, 'isAdjustmentLayer')) === true;
    return { item: item, kind: kind, track: trackIndex, start: start, end: end, name: name, selected: selected === true, selectionKnown: selected !== undefined, adjustment: adjustment };
  }

  // Every clip on the Timeline, by kind and track, with link groups.
  async function snapshot(sequence) {
    var snap = { tracks: { video: [], audio: [] }, all: [], selected: [] };
    var kinds = ['video', 'audio'];
    for (var k = 0; k < kinds.length; k++) {
      var kind = kinds[k];
      var count = Number(await asPromise(kind === 'video' ? sequence.getVideoTrackCount() : sequence.getAudioTrackCount())) || 0;
      for (var t = 0; t < count; t++) {
        var track = await asPromise(kind === 'video' ? sequence.getVideoTrack(t) : sequence.getAudioTrack(t));
        var items = await trackItems(track);
        var details = await Promise.all(items.map(function (item) { return describe(item, kind, t); }));
        details.sort(function (a, b) { return a.start - b.start; });
        snap.tracks[kind].push(details);
        snap.all = snap.all.concat(details);
      }
    }
    await markSelection(sequence, snap);
    linkGroups(snap);
    snap.selected = snap.all.filter(function (d) { return d.selected; });
    snap.selected.forEach(function (d) { d.explicit = true; });
    return snap;
  }

  // getIsSelected when Premiere has it, else the sequence selection matched by
  // track and position.
  async function markSelection(sequence, snap) {
    if (snap.all.length && snap.all.every(function (d) { return d.selectionKnown; })) return;
    var selection = await asPromise(sequence.getSelection());
    var items = selection && typeof selection.getItems === 'function' ? toArray(await asPromise(selection.getItems())) : [];
    var keys = {};
    for (var i = 0; i < items.length; i++) {
      var type = await tryCall(items[i], 'getMediaType');
      var trackIndex = await tryCall(items[i], 'getTrackIndex');
      var start = ticksOf(await asPromise(items[i].getStartTime()));
      var end = ticksOf(await asPromise(items[i].getEndTime()));
      var kind = type !== undefined && type === mediaType('audio') ? 'audio' : type !== undefined && type === mediaType('video') ? 'video' : '*';
      keys[kind + '|' + trackIndex + '|' + start + '|' + end] = true;
      keys['*|' + trackIndex + '|' + start + '|' + end] = true;
    }
    snap.all.forEach(function (d) {
      if (!d.selectionKnown) d.selected = !!(keys[d.kind + '|' + d.track + '|' + d.start + '|' + d.end] || keys['*|' + d.track + '|' + d.start + '|' + d.end]);
    });
  }

  function linkGroups(snap) {
    var byKey = {}, next = 0;
    snap.all.forEach(function (d) {
      var key = d.name + '|' + d.start + '|' + d.end;
      (byKey[key] = byKey[key] || { video: [], audio: [] })[d.kind].push(d);
    });
    Object.keys(byKey).forEach(function (key) {
      var bucket = byKey[key];
      if (bucket.video.length === 1 && bucket.audio.length) {
        var id = 'g' + (next++);
        bucket.video.concat(bucket.audio).forEach(function (d) { d.link = id; });
      }
    });
    snap.all.forEach(function (d) { if (!d.link) d.link = 'g' + (next++); });
  }

  // Selection plus the linked partners of anything selected.
  function withLinked(snap) {
    var groups = {};
    snap.selected.forEach(function (d) { groups[d.link] = true; });
    return snap.all.filter(function (d) {
      if (groups[d.link] && !d.selected) d.explicit = false;
      return groups[d.link];
    });
  }

  function requireSelection(details, message) {
    if (!details.length) throw new Error(message || 'Select one or more Timeline clips first.');
    return details;
  }

  function overlaps(a0, a1, b0, b1) { return a0 < b1 - 1 && b0 < a1 - 1; }

  function trackLabel(kind, index) { return (kind === 'video' ? 'V' : 'A') + (index + 1); }

  // A stable picture of the Timeline, so Edie's Undo can tell whether the
  // editor changed anything since Edie's last step.
  async function fingerprint(sequence) {
    try {
      var snap = await snapshot(sequence);
      return snap.all.map(function (d) { return d.kind + d.track + ':' + d.start + '-' + d.end + ':' + d.name; }).sort().join('|');
    } catch (_) { return ''; }
  }

  // MARK: Moving in time (pull, snap, stagger, close gaps)

  // createMoveAction shifts a clip by an offset, like ExtendScript's
  // TrackItem.move. Adobe does not say so outright; the first run checks it,
  // and Edie remembers if this Premiere treats it as a new start instead.
  async function moveInTime(ctx, snap, moves, label, message) {
    moves = moves.filter(function (m) { return Math.abs(m.delta) >= 1; });
    if (!moves.length) return message.unchanged || 'Nothing needed to move.';
    var moving = {};
    moves.forEach(function (m) { moving[m.d.kind + m.d.track + ':' + m.d.start] = m; });
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], start = m.d.start + m.delta, end = m.d.end + m.delta;
      if (start < 0) throw new Error('That would move “' + m.d.name + '” before the start of the sequence. Nothing was moved.');
      var lane = snap.tracks[m.d.kind][m.d.track] || [];
      for (var j = 0; j < lane.length; j++) {
        var other = lane[j], otherMove = moving[other.kind + other.track + ':' + other.start];
        if (other === m.d) continue;
        var o0 = other.start + (otherMove ? otherMove.delta : 0), o1 = other.end + (otherMove ? otherMove.delta : 0);
        if (overlaps(start, end, o0, o1)) {
          throw new Error('That would put “' + m.d.name + '” on top of “' + other.name + '” on ' + trackLabel(m.d.kind, m.d.track) + '. Nothing was moved.');
        }
      }
    }
    var absolute = remembered('edie.moveSemantics', 'offset') === 'absolute';
    // Clear the way: right-moving clips go latest first, left-moving earliest first.
    moves.sort(function (a, b) {
      if ((a.delta > 0) !== (b.delta > 0)) return a.delta > 0 ? -1 : 1;
      return a.delta > 0 ? b.d.start - a.d.start : a.d.start - b.d.start;
    });
    await transaction(ctx.project, label, function (actions) {
      moves.forEach(function (m) { actions.addAction(m.d.item.createMoveAction(absolute ? timeAt(m.d.start + m.delta) : offsetTime(m.delta))); });
    });
    var probe = moves[0], landed = ticksOf(await asPromise(probe.d.item.getStartTime()));
    if (Math.abs(landed - (probe.d.start + probe.delta)) > 2) {
      remember('edie.moveSemantics', absolute ? 'offset' : 'absolute');
      await failAndUndo('Premiere placed the clips somewhere else than asked. Edie has learned how this Premiere moves clips — run the command again.');
    }
    return message.done;
  }

  async function pullGroup(edge) {
    var ctx = await context(), at = await playheadTicks(ctx.sequence);
    var snap = await snapshot(ctx.sequence), details = requireSelection(withLinked(snap));
    var min = Math.min.apply(null, details.map(function (d) { return d.start; }));
    var max = Math.max.apply(null, details.map(function (d) { return d.end; }));
    var delta = at - (edge === 'in' ? min : max);
    if (min + delta < 0) throw new Error('Pulling the group’s Out to the playhead would move it before the start of the sequence. Nothing was moved.');
    return moveInTime(ctx, snap, details.map(function (d) { return { d: d, delta: delta }; }), edge === 'in' ? 'Edie: Pull Group In' : 'Edie: Pull Group Out', {
      done: 'Moved ' + plural(details.length, 'clip') + ' as one group, ' + (edge === 'in' ? 'In' : 'Out') + ' to the playhead.',
      unchanged: 'The group is already ' + (edge === 'in' ? 'starting' : 'ending') + ' at the playhead.'
    });
  }

  // Tracks joined by a link group snap as one block.
  function trackComponents(details) {
    var parent = {};
    function root(v) { while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v]; } return v; }
    var byLink = {};
    details.forEach(function (d) {
      var key = d.kind + d.track;
      if (parent[key] === undefined) parent[key] = key;
      (byLink[d.link] = byLink[d.link] || []).push(key);
    });
    Object.keys(byLink).forEach(function (link) {
      var keys = byLink[link];
      for (var i = 1; i < keys.length; i++) { var a = root(keys[0]), b = root(keys[i]); if (a !== b) parent[b] = a; }
    });
    var map = {};
    details.forEach(function (d) { map[d.kind + d.track] = root(d.kind + d.track); });
    return map;
  }

  async function snapTracks(useEnd) {
    var ctx = await context(), at = await playheadTicks(ctx.sequence);
    var snap = await snapshot(ctx.sequence), details = requireSelection(withLinked(snap));
    var components = trackComponents(details), anchors = {};
    details.forEach(function (d) {
      var key = components[d.kind + d.track], edge = useEnd ? d.end : d.start;
      anchors[key] = anchors[key] === undefined ? edge : (useEnd ? Math.max(anchors[key], edge) : Math.min(anchors[key], edge));
    });
    var moves = details.map(function (d) { return { d: d, delta: at - anchors[components[d.kind + d.track]] }; });
    for (var i = 0; i < moves.length; i++) {
      if (moves[i].d.start + moves[i].delta < 0) throw new Error('Snap would move a track block before the start of the sequence. Nothing was moved.');
    }
    return moveInTime(ctx, snap, moves, useEnd ? 'Edie: Snap Tracks Out' : 'Edie: Snap Tracks In', {
      done: 'Snapped each track block ' + (useEnd ? 'Out' : 'In') + ' to the playhead.',
      unchanged: 'Every track block already ' + (useEnd ? 'ends' : 'starts') + ' at the playhead.'
    });
  }

  function primaryKind(details) {
    var counts = { video: 0, audio: 0 };
    details.forEach(function (d) { if (d.explicit) counts[d.kind]++; });
    return counts.audio > counts.video ? 'audio' : 'video';
  }

  async function stagger(command, descending) {
    var ctx = await context(), snap = await snapshot(ctx.sequence);
    var details = requireSelection(withLinked(snap), 'Select clips on at least two video tracks or at least two audio tracks first.');
    var frames = Number(command.staggerFrames); frames = isNaN(frames) ? 5 : Math.max(0, Math.round(frames));
    var groupSize = Number(command.staggerGroup); groupSize = isNaN(groupSize) ? 1 : Math.max(1, Math.floor(groupSize));
    var kind = primaryKind(details), tracks = [];
    details.forEach(function (d) { if (d.explicit && d.kind === kind && tracks.indexOf(d.track) < 0) tracks.push(d.track); });
    tracks.sort(function (a, b) { return a - b; });
    if (descending) tracks.reverse();
    if (tracks.length < 2) throw new Error('Select clips on at least two ' + kind + ' tracks to stagger.');
    var ranks = {};
    details.forEach(function (d) { if (d.explicit && d.kind === kind && ranks[d.link] === undefined) ranks[d.link] = tracks.indexOf(d.track); });
    var moves = details.map(function (d) {
      var rank = ranks[d.link], multiplier = rank === undefined ? 0 : (groupSize === 1 ? rank : rank % groupSize);
      return { d: d, delta: multiplier * frames * ctx.frameTicks };
    });
    var label = 'Staggered selected track blocks ' + (descending ? 'Descending' : 'Ascending') + ' by ' + plural(frames, 'frame') + '.';
    return moveInTime(ctx, snap, moves, descending ? 'Edie: Stagger Descending' : 'Edie: Stagger Ascending', { done: label, unchanged: label });
  }

  async function closeGaps() {
    var ctx = await context(), snap = await snapshot(ctx.sequence);
    var details = withLinked(snap);
    if (details.length < 2) throw new Error('Select at least two Timeline clips on the same track to close gaps.');
    var kind = primaryKind(details), byTrack = {}, deltas = {}, compactable = false;
    details.forEach(function (d) { if (d.explicit && d.kind === kind) (byTrack[d.track] = byTrack[d.track] || []).push(d); });
    Object.keys(byTrack).forEach(function (track) {
      var group = byTrack[track];
      if (group.length < 2) return;
      compactable = true;
      group.sort(function (a, b) { return a.start - b.start; });
      deltas[group[0].link] = 0;
      var cursor = group[0].end;
      for (var i = 1; i < group.length; i++) {
        deltas[group[i].link] = cursor - group[i].start;
        cursor += group[i].end - group[i].start;
      }
    });
    if (!compactable) throw new Error('Select at least two ' + kind + ' clips on the same track to close gaps.');
    var moves = details.map(function (d) { return { d: d, delta: deltas[d.link] || 0 }; });
    return moveInTime(ctx, snap, moves, 'Edie: Close Gaps', { done: 'Closed the gaps between the selected clips.', unchanged: 'The selected clips have no gaps between them.' });
  }

  // MARK: Moving across tracks (move up/down, clean up rows, fill down)
  //
  // UXP cannot move a clip to another track, so it is cloned onto the target
  // track (which keeps its effects) and the original removed, in one
  // transaction. Transitions on a moved clip do not come along, and a moved
  // clip is no longer linked to the partner it left behind.

  function cloneTargets(kind, target) { return kind === 'video' ? { v: target, a: 0, align: true } : { v: 0, a: target, align: false }; }

  async function moveAcrossTracks(ctx, snap, moves, label, done) {
    moves = moves.filter(function (m) { return m.target !== m.d.track; });
    if (!moves.length) return done.unchanged;
    if (!ctx.editor || typeof ctx.editor.createCloneTrackItemAction !== 'function' || typeof ctx.editor.createRemoveItemsAction !== 'function') {
      throw new Error('This Premiere cannot move clips between tracks from UXP. Switch Edie’s command runtime to CEP for this.');
    }
    var counts = { video: snap.tracks.video.length, audio: snap.tracks.audio.length };
    var expected = {};
    function key(kind, track) { return kind + track; }
    function count(kind, track) { return expected[key(kind, track)] !== undefined ? expected[key(kind, track)] : (snap.tracks[kind][track] || []).length; }
    moves.forEach(function (m) {
      expected[key(m.d.kind, m.d.track)] = count(m.d.kind, m.d.track) - 1;
      expected[key(m.d.kind, m.target)] = count(m.d.kind, m.target) + 1;
    });
    var selections = { video: null, audio: null };
    ['video', 'audio'].forEach(function (kind) {
      var mine = moves.filter(function (m) { return m.d.kind === kind; });
      if (!mine.length) return;
      ppro.TrackItemSelection.createEmptySelection(function (selection) {
        mine.forEach(function (m) { selection.addItem(m.d.item, false); });
        selections[kind] = selection;
      });
      if (!selections[kind]) throw new Error('Premiere could not hold the clips to move.');
    });
    await transaction(ctx.project, label, function (actions) {
      moves.forEach(function (m) {
        var t = cloneTargets(m.d.kind, m.target);
        actions.addAction(ctx.editor.createCloneTrackItemAction(m.d.item, ppro.TickTime.TIME_ZERO, t.v, t.a, t.align, false));
      });
      ['video', 'audio'].forEach(function (kind) {
        if (selections[kind]) actions.addAction(ctx.editor.createRemoveItemsAction(selections[kind], false, mediaType(kind), false));
      });
    });
    // Check: every moved clip sits on its target track at its old time, and
    // no track gained or lost anything else.
    var after = await snapshot(ctx.sequence);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], lane = after.tracks[m.d.kind][m.target] || [];
      var found = lane.some(function (d) { return Math.abs(d.start - m.d.start) <= 2 && Math.abs(d.end - m.d.end) <= 2; });
      if (!found) await failAndUndo('Premiere did not put “' + m.d.name + '” on ' + trackLabel(m.d.kind, m.target) + '.');
    }
    for (var k in expected) {
      if (!Object.prototype.hasOwnProperty.call(expected, k)) continue;
      var kind = k.indexOf('video') === 0 ? 'video' : 'audio', track = Number(k.slice(kind.length));
      if ((after.tracks[kind][track] || []).length !== expected[k]) await failAndUndo('Premiere changed more clips than Edie moved on ' + trackLabel(kind, track) + '.');
    }
    var created = (after.tracks.video.length - counts.video) + (after.tracks.audio.length - counts.audio);
    return done.done + (created > 0 ? ' Added ' + plural(created, 'track') + '.' : '');
  }

  function fits(snap, kind, track, start, end, reserved, ignore) {
    var lane = snap.tracks[kind][track] || [];
    for (var i = 0; i < lane.length; i++) if (!ignore[lane[i].kind + lane[i].track + ':' + lane[i].start] && overlaps(start, end, lane[i].start, lane[i].end)) return false;
    for (var j = 0; j < reserved.length; j++) if (reserved[j].kind === kind && reserved[j].track === track && overlaps(start, end, reserved[j].start, reserved[j].end)) return false;
    return true;
  }

  // Touching selected clips on one track move together (CEP kept clips joined
  // by a transition together; UXP cannot see transitions, so touching is used).
  function runsOf(details) {
    var byTrack = {}, runs = [];
    details.forEach(function (d) { (byTrack[d.kind + d.track] = byTrack[d.kind + d.track] || []).push(d); });
    Object.keys(byTrack).forEach(function (k) {
      var lane = byTrack[k].sort(function (a, b) { return a.start - b.start; }), run = null;
      lane.forEach(function (d) {
        if (run && Math.abs(run.end - d.start) <= 2) { run.members.push(d); run.end = d.end; }
        else { run = { kind: d.kind, track: d.track, start: d.start, end: d.end, members: [d] }; runs.push(run); }
      });
    });
    return runs;
  }

  async function moveVertical(command, direction) {
    var ctx = await context(), snap = await snapshot(ctx.sequence);
    var details = requireSelection(snap.selected);
    var mode = command.moveMode === 'individual' ? 'individual' : 'group';
    var ignore = {}, moves = [], skipped = 0;
    details.forEach(function (d) { ignore[d.kind + d.track + ':' + d.start] = true; });
    ['video', 'audio'].forEach(function (kind) {
      var step = (kind === 'video' ? 1 : -1) * (direction === 'down' ? -1 : 1);
      var runs = runsOf(details.filter(function (d) { return d.kind === kind; }));
      if (!runs.length) return;
      runs.sort(function (a, b) { return a.track !== b.track ? (step > 0 ? b.track - a.track : a.track - b.track) : a.start - b.start; });
      var laneCount = snap.tracks[kind].length, reserved = [];
      if (mode === 'individual') {
        runs.forEach(function (run) {
          var target = run.track + step;
          while (target >= 0 && target < laneCount && !fits(snap, kind, target, run.start, run.end, reserved, ignore)) target += step;
          if (target < 0) { skipped += run.members.length; return; }
          reserved.push({ kind: kind, track: target, start: run.start, end: run.end });
          run.members.forEach(function (d) { moves.push({ d: d, target: target }); });
        });
        return;
      }
      var maxOffset = step > 0 ? laneCount + 1 : Math.min.apply(null, runs.map(function (r) { return r.track; }));
      for (var offset = 1; offset <= maxOffset; offset++) {
        var trial = [], ok = true;
        for (var r = 0; r < runs.length && ok; r++) {
          var target = runs[r].track + step * offset;
          if (target < 0 || !fits(snap, kind, target, runs[r].start, runs[r].end, trial, ignore)) ok = false;
          else trial.push({ kind: kind, track: target, start: runs[r].start, end: runs[r].end });
        }
        if (ok) {
          runs.forEach(function (run) { run.members.forEach(function (d) { moves.push({ d: d, target: run.track + step * offset }); }); });
          return;
        }
      }
      throw new Error('No free ' + kind + ' track ' + (direction === 'down' ? 'below' : 'above') + ' fits the selected group. Nothing was moved.');
    });
    if (!moves.length) throw new Error('No selected clips have a free track ' + direction + '; nothing was moved.');
    return moveAcrossTracks(ctx, snap, moves, direction === 'down' ? 'Edie: Move Clips Down' : 'Edie: Move Clips Up', {
      done: 'Moved ' + plural(moves.length, 'clip') + ' ' + direction + (mode === 'individual' ? ' one by one' : ' as a group') + '.' + (skipped ? ' ' + plural(skipped, 'clip') + ' had nowhere to go and stayed put.' : ''),
      unchanged: 'Nothing needed to move.'
    });
  }

  async function cleanUpRows(fillDown) {
    var ctx = await context(), snap = await snapshot(ctx.sequence);
    var details = requireSelection(snap.selected, 'Select one or more Timeline clips to clean up.');
    var ignore = {}, moves = [];
    details.forEach(function (d) { ignore[d.kind + d.track + ':' + d.start] = true; });
    ['video', 'audio'].forEach(function (kind) {
      var mine = details.filter(function (d) { return d.kind === kind; });
      if (!mine.length) return;
      var tracks = [];
      mine.forEach(function (d) { if (tracks.indexOf(d.track) < 0) tracks.push(d.track); });
      tracks.sort(function (a, b) { return a - b; });
      var anchor = tracks[0], reserved = [], placed = [];
      tracks.forEach(function (track) {
        mine.filter(function (d) { return d.track === track; }).sort(function (a, b) { return a.start - b.start; }).forEach(function (d) {
          var target = anchor;
          if (fillDown) {
            target = 0;
            placed.forEach(function (p) { if (p.from < d.track && overlaps(d.start, d.end, p.start, p.end) && p.track + 1 > target) target = p.track + 1; });
          }
          while (!fits(snap, kind, target, d.start, d.end, reserved, ignore)) target++;
          reserved.push({ kind: kind, track: target, start: d.start, end: d.end });
          placed.push({ from: d.track, track: target, start: d.start, end: d.end });
          moves.push({ d: d, target: target });
        });
      });
    });
    var unchanged = fillDown ? 'The selected clips have already fallen as far down as free space allows.' : 'The selected clips already sit on the lowest available tracks.';
    return moveAcrossTracks(ctx, snap, moves, fillDown ? 'Edie: Fill Track Rows Down' : 'Edie: Clean Up Track Rows', {
      done: fillDown ? 'Cleaned up the selected clips by timeline.' : 'Cleaned up the selected clips by selection.', unchanged: unchanged
    });
  }

  // MARK: Trims

  // How far an edge may extend before running out of source media, in
  // Timeline ticks. null when it cannot be read: then extending is refused.
  async function mediaHandle(d, edge) {
    var speed = Number(await tryCall(d.item, 'getSpeed')) || 1;
    var itemIn = ticksOf(await tryCall(d.item, 'getInPoint')), itemOut = ticksOf(await tryCall(d.item, 'getOutPoint'));
    var projectItem = await tryCall(d.item, 'getProjectItem');
    var clip = asClip(projectItem);
    if (!clip || isNaN(itemIn) || isNaN(itemOut)) return null;
    var type = mediaType(d.kind);
    var mediaIn = ticksOf((await tryCall(clip, 'getInPoint', type)) || (await tryCall(clip, 'getInPoint')));
    var mediaOut = ticksOf((await tryCall(clip, 'getOutPoint', type)) || (await tryCall(clip, 'getOutPoint')));
    if (isNaN(mediaIn) || isNaN(mediaOut) || !(mediaOut > mediaIn)) return null;
    return edge === 'in' ? Math.max(0, (itemIn - mediaIn) / speed) : Math.max(0, (mediaOut - itemOut) / speed);
  }

  async function trimToPlayhead(edge) {
    var ctx = await context(), at = await playheadTicks(ctx.sequence);
    var snap = await snapshot(ctx.sequence), details = requireSelection(withLinked(snap));
    var groups = {}, order = [], targets = [], skipped = 0, blocked = false, unknown = false;
    details.forEach(function (d) { if (!groups[d.link]) { groups[d.link] = []; order.push(d.link); } groups[d.link].push(d); });
    for (var g = 0; g < order.length; g++) {
      var group = groups[order[g]], target = at, ok = true;
      for (var i = 0; i < group.length && ok; i++) {
        var d = group[i];
        if (edge === 'in' ? !(at < d.end) : !(at > d.start)) { ok = false; break; }
        var extend = edge === 'in' ? at < d.start : at > d.end;
        if (!extend) continue;
        var from = edge === 'in' ? at : d.end, to = edge === 'in' ? d.start : at;
        var lane = snap.tracks[d.kind][d.track] || [];
        if (lane.some(function (o) { return o !== d && overlaps(from, to, o.start, o.end); })) { ok = false; blocked = true; break; }
        var handle = await mediaHandle(d, edge);
        if (handle === null) { ok = false; unknown = true; break; }
        target = edge === 'in' ? Math.max(target, d.start - handle) : Math.min(target, d.end + handle);
      }
      if (ok) group.forEach(function (d) { if (Math.abs((edge === 'in' ? d.start : d.end) - target) > 1) targets.push({ d: d, at: target }); });
      else skipped += group.length;
    }
    if (!targets.length) {
      if (blocked) throw new Error('A neighbouring clip is in the way of extending to the playhead.');
      if (unknown) throw new Error('Premiere did not say how much media is left, so Edie will not extend these clips.');
      throw new Error('Put the playhead where the selected clips can be trimmed: before their Out for Trim In, after their In for Trim Out.');
    }
    await transaction(ctx.project, edge === 'in' ? 'Edie: Trim In to Playhead' : 'Edie: Trim Out to Playhead', function (actions) {
      targets.forEach(function (t) { actions.addAction(edge === 'in' ? t.d.item.createSetStartAction(timeAt(t.at)) : t.d.item.createSetEndAction(timeAt(t.at))); });
    });
    // A trim moves one edge only; anything else means Premiere slid the clip.
    var probe = targets[0];
    var start = ticksOf(await asPromise(probe.d.item.getStartTime())), end = ticksOf(await asPromise(probe.d.item.getEndTime()));
    var good = edge === 'in' ? Math.abs(start - probe.at) <= 2 && Math.abs(end - probe.d.end) <= 2 : Math.abs(end - probe.at) <= 2 && Math.abs(start - probe.d.start) <= 2;
    if (!good) await failAndUndo('Premiere moved “' + probe.d.name + '” instead of trimming it.');
    return 'Trimmed ' + plural(targets.length, 'clip') + ' ' + (edge === 'in' ? 'In' : 'Out') + ' to the playhead.' + (skipped ? ' ' + plural(skipped, 'clip') + ' could not reach the playhead and were left alone.' : '');
  }

  // MARK: Selection

  async function selectBeforePlayhead() {
    var ctx = await context(), at = await playheadTicks(ctx.sequence);
    var snap = await snapshot(ctx.sequence);
    var matches = snap.all.filter(function (d) { return d.start < at; });
    var didSet = false;
    ppro.TrackItemSelection.createEmptySelection(function (selection) {
      for (var k = 0; k < matches.length; k++) selection.addItem(matches[k].item, true);
      didSet = ctx.sequence.setSelection(selection);
    });
    if (didSet === false) throw new Error('Premiere refused to update the Timeline selection.');
    return 'Selected ' + plural(matches.length, 'clip') + ' starting before the playhead.';
  }

  // MARK: Effects

  var factoryCache = { video: null, audio: null };
  async function effectNames(kind) {
    if (factoryCache[kind]) return factoryCache[kind];
    var map = {};
    try {
      if (kind === 'video') {
        var names = toArray(await asPromise(ppro.VideoFilterFactory.getDisplayNames()));
        var matches = toArray(await asPromise(ppro.VideoFilterFactory.getMatchNames()));
        if (names.length === matches.length) for (var i = 0; i < names.length; i++) map[String(names[i])] = String(matches[i]);
      } else if (ppro.AudioFilterFactory && ppro.AudioFilterFactory.createComponentByDisplayName) {
        toArray(await asPromise(ppro.AudioFilterFactory.getDisplayNames())).forEach(function (n) { map[String(n)] = String(n); });
      }
    } catch (_) {}
    factoryCache[kind] = map;
    return map;
  }

  async function chainOf(item) { return await tryCall(item, 'getComponentChain'); }

  async function createComponent(kind, name, d) {
    var map = await effectNames(kind);
    if (kind === 'video') return await asPromise(ppro.VideoFilterFactory.createComponent(map[name] || name));
    return await asPromise(ppro.AudioFilterFactory.createComponentByDisplayName(name, d.item));
  }

  async function applyEffect(command, kind) {
    var ctx = await context(), snap = await snapshot(ctx.sequence);
    var targets = snap.selected.filter(function (d) { return d.kind === kind; });
    if (!targets.length) throw new Error(snap.selected.length ? 'Select ' + kind + ' clips for ' + command.name + '.' : 'Select one or more ' + (kind === 'audio' ? 'audio ' : '') + 'clips first.');
    var map = await effectNames(kind);
    if (!map[command.name]) throw new Error('“' + command.name + '” is not available in this Premiere installation.');
    var plans = [];
    for (var i = 0; i < targets.length; i++) {
      var chain = await chainOf(targets[i].item);
      if (!chain) throw new Error('Premiere could not read the effects on “' + targets[i].name + '”.');
      plans.push({ chain: chain, component: await createComponent(kind, command.name, targets[i]) });
    }
    await transaction(ctx.project, 'Edie: Apply ' + command.name, function (actions) {
      plans.forEach(function (p) { actions.addAction(p.chain.createAppendComponentAction(p.component)); });
    });
    return 'Applied ' + command.name + ' to ' + plural(targets.length, (kind === 'audio' ? 'audio ' : '') + 'clip') + '.';
  }

  // MARK: Transitions

  var TRANSITION_NAMES = {
    'cross dissolve': 'AE.ADBE Cross Dissolve New', 'dip to black': 'AE.ADBE Dip To Black', 'dip to white': 'AE.ADBE Dip To White',
    'additive dissolve': 'ADBE Additive Dissolve', 'film dissolve': 'ADBE Film Dissolve', 'non-additive dissolve': 'AE.ADBE Non-Additive Dissolve', 'morph cut': 'AE.ADBE MorphCut'
  };
  function normalName(value) { return String(value || '').toLowerCase().replace(/^ae\./, '').replace(/^adbe\s+/, '').replace(/\bnew\b/, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  var transitionList = null;
  async function transitionMatchName(name) {
    if (TRANSITION_NAMES[String(name).toLowerCase()]) return TRANSITION_NAMES[String(name).toLowerCase()];
    if (!transitionList) {
      try { transitionList = toArray(await asPromise(ppro.TransitionFactory.getVideoTransitionMatchNames())).map(String); }
      catch (_) { transitionList = []; }
    }
    var wanted = normalName(name);
    for (var i = 0; i < transitionList.length; i++) if (normalName(transitionList[i]) === wanted) return transitionList[i];
    return '';
  }

  function videoClip(item) {
    try { return ppro.VideoClipTrackItem && ppro.VideoClipTrackItem.cast ? ppro.VideoClipTrackItem.cast(item) || item : item; } catch (_) { return item; }
  }

  function boundaries(selected, placement) {
    var edges = [], i, previous, next;
    function same(a, b) { return Math.abs(a - b) <= 2; }
    if (placement === 'in') {
      for (i = 0; i < selected.length; i++) { previous = selected[i - 1]; if (!(previous && previous.track === selected[i].track && same(previous.end, selected[i].start))) edges.push({ d: selected[i], start: true }); }
    } else if (placement === 'out') {
      for (i = 0; i < selected.length; i++) { next = selected[i + 1]; if (!(next && next.track === selected[i].track && same(selected[i].end, next.start))) edges.push({ d: selected[i], start: false }); }
    } else if (placement === 'selected-cuts') {
      for (i = 1; i < selected.length; i++) { previous = selected[i - 1]; if (selected[i].track === previous.track && same(previous.end, selected[i].start)) edges.push({ d: selected[i], start: true, centered: true }); }
    } else if (placement === 'group-ends') {
      var first = 0;
      for (i = 1; i <= selected.length; i++) {
        previous = selected[i - 1]; next = selected[i];
        if (!next || next.track !== previous.track || !same(previous.end, next.start)) { edges.push({ d: selected[first], start: true }); edges.push({ d: previous, start: false }); first = i; }
      }
    } else if (placement === 'centered') {
      for (i = 0; i < selected.length; i++) { edges.push({ d: selected[i], start: true, centered: true }); edges.push({ d: selected[i], start: false, centered: true }); }
    } else {
      for (i = 0; i < selected.length; i++) { edges.push({ d: selected[i], start: true }); edges.push({ d: selected[i], start: false }); }
    }
    return edges;
  }
  var PLACEMENT_LABELS = { both: 'In + Out', 'in': 'In', out: 'Out', 'selected-cuts': 'selected-cut', 'group-ends': 'group-edge', centered: 'centered' };

  async function applyTransition(command) {
    var ctx = await context(), snap = await snapshot(ctx.sequence);
    var selected = snap.selected.filter(function (d) { return d.kind === 'video'; });
    if (!selected.length) throw new Error('Select one or more video clips first.');
    selected.sort(function (a, b) { return a.track - b.track || a.start - b.start; });
    var placement = PLACEMENT_LABELS[command.transitionPlacement] ? command.transitionPlacement : 'both';
    var matchName = await transitionMatchName(command.name);
    if (!matchName) throw new Error('“' + command.name + '” is not available in this Premiere installation.');
    var edges = boundaries(selected, placement);
    if (!edges.length) throw new Error('No eligible clip boundaries were found for ' + PLACEMENT_LABELS[placement] + '.');
    var duration = ppro.TickTime.createWithTicks(String(Math.round((Number(command.transitionFrames) || 30) * ctx.frameTicks)));
    var plans = [];
    for (var i = 0; i < edges.length; i++) {
      var options = new ppro.AddTransitionOptions();
      options.setApplyToStart(edges[i].start);
      options.setDuration(duration);
      if (edges[i].centered && options.setTransitionAlignment) options.setTransitionAlignment(0.5);
      plans.push({ clip: videoClip(edges[i].d.item), transition: await asPromise(ppro.TransitionFactory.createVideoTransition(matchName)), options: options });
    }
    await transaction(ctx.project, 'Edie: ' + command.name, function (actions) {
      plans.forEach(function (p) { actions.addAction(p.clip.createAddVideoTransitionAction(p.transition, p.options)); });
    });
    return 'Applied ' + command.name + ' to ' + plans.length + ' ' + PLACEMENT_LABELS[placement] + ' ' + (plans.length === 1 ? 'boundary' : 'boundaries') + '.';
  }

  async function removeTransitions() {
    var ctx = await context(), snap = await snapshot(ctx.sequence);
    var selected = snap.selected.filter(function (d) { return d.kind === 'video'; });
    if (!selected.length) throw new Error('Select the video clips whose transitions should go.');
    var positions = ppro.Constants && ppro.Constants.TransitionPosition;
    var START = positions ? positions.START : 0, END = positions ? positions.END : 1;
    var removed = 0;
    // Each clip edge separately: an edge with no transition is refused, and
    // one refusal must not cancel the others.
    for (var i = 0; i < selected.length; i++) {
      var clip = videoClip(selected[i].item);
      for (var p = 0; p < 2; p++) {
        try { removed += await transaction(ctx.project, 'Edie: Remove Transitions', function (actions) { actions.addAction(clip.createRemoveVideoTransitionAction(p ? END : START)); }); }
        catch (_) {}
      }
    }
    return 'Removed ' + plural(removed, 'transition') + ' from selected clips.';
  }

  // MARK: Placing project items

  function asFolder(item) {
    try { return item && ppro.FolderItem && ppro.FolderItem.cast ? ppro.FolderItem.cast(item) || null : null; }
    catch (_) { return null; }
  }
  function asClip(item) {
    try { return item && ppro.ClipProjectItem && ppro.ClipProjectItem.cast ? ppro.ClipProjectItem.cast(item) || null : null; }
    catch (_) { return null; }
  }
  function itemName(item) { try { return item && item.name ? String(item.name) : ''; } catch (_) { return ''; } }

  // The marked In/Out of a project item in ticks, and which streams it has.
  async function clipRange(clip) {
    var range = null;
    var kinds = ['video', 'audio'], streams = {};
    for (var k = 0; k < kinds.length; k++) {
      var type = mediaType(kinds[k]);
      var inT = ticksOf(await tryCall(clip, 'getInPoint', type)), outT = ticksOf(await tryCall(clip, 'getOutPoint', type));
      if (outT > inT) { streams[kinds[k]] = true; if (!range) range = { in: inT, out: outT }; }
    }
    if (!range) {
      var inAny = ticksOf(await tryCall(clip, 'getInPoint')), outAny = ticksOf(await tryCall(clip, 'getOutPoint'));
      if (outAny > inAny) range = { in: inAny, out: outAny };
    }
    if (!range) return null;
    // Streams unknown (no per-type In/Out): assume both, as Premiere places both.
    var known = Object.keys(streams).length > 0;
    range.video = known ? !!streams.video : true;
    range.audio = known ? !!streams.audio : true;
    range.length = range.out - range.in;
    return range;
  }

  async function placeable(item) {
    if (!item || asFolder(item)) return null;
    var clip = asClip(item);
    if (!clip) return null;
    if ((await tryCall(clip, 'isSequence')) === true) return null;
    var range = await clipRange(clip);
    return range ? { item: item, clip: clip, name: itemName(item), range: range } : null;
  }

  // Lowest track of a kind free over [start, end); the track count means a
  // new track (Premiere adds one when placing past the top).
  function lowestFree(snap, kind, start, end, from, reserved) {
    for (var t = from || 0; t < snap.tracks[kind].length; t++) if (fits(snap, kind, t, start, end, reserved || [], {})) return t;
    var t2 = Math.max(from || 0, snap.tracks[kind].length);
    while (!fits(snap, kind, t2, start, end, reserved || [], {})) t2++;
    return t2;
  }

  async function overwrite(ctx, plans, label) {
    if (!ctx.editor || typeof ctx.editor.createOverwriteItemAction !== 'function') throw new Error('This Premiere cannot place clips from UXP. Switch Edie’s command runtime to CEP for this.');
    await transaction(ctx.project, label, function (actions) {
      plans.forEach(function (p) { actions.addAction(ctx.editor.createOverwriteItemAction(p.item, timeAt(p.at), p.v, p.a)); });
    });
  }

  async function placeSourceClip() {
    var ctx = await context(), at = await playheadTicks(ctx.sequence);
    var monitor = ppro.SourceMonitor;
    var item = monitor && monitor.getProjectItem ? await asPromise(monitor.getProjectItem()) : null;
    var source = await placeable(item);
    if (!source) throw new Error('Open a clip in the Source monitor first.');
    var snap = await snapshot(ctx.sequence), end = at + source.range.length;
    var v = lowestFree(snap, 'video', at, end), a = lowestFree(snap, 'audio', at, end);
    await overwrite(ctx, [{ item: source.item, at: at, v: v, a: a }], 'Edie: Place Source Clip');
    return 'Placed ' + source.name + ' at the playhead on ' + [source.range.video ? trackLabel('video', v) : '', source.range.audio ? trackLabel('audio', a) : ''].filter(Boolean).join(' and ') + '.';
  }

  async function selectedProjectItems(project) {
    var selection = ppro.ProjectUtils && ppro.ProjectUtils.getSelection ? await asPromise(ppro.ProjectUtils.getSelection(project)) : null;
    var items = selection && selection.getItems ? toArray(await asPromise(selection.getItems())) : [];
    var out = [], skipped = 0;
    for (var i = 0; i < items.length; i++) { var p = await placeable(items[i]); if (p) out.push(p); else skipped++; }
    return { items: out, skipped: skipped };
  }

  async function placeBinClips(column) {
    var ctx = await context(), at = await playheadTicks(ctx.sequence);
    var picked = await selectedProjectItems(ctx.project);
    if (!picked.items.length) throw new Error(picked.skipped ? 'Bins and sequences cannot be placed. Select media clips in the Project panel.' : 'Select clips in the Project panel first.');
    var snap = await snapshot(ctx.sequence), plans = [], reserved = [];
    if (column) {
      picked.items.forEach(function (p) {
        var end = at + p.range.length, v = lowestFree(snap, 'video', at, end, 0, reserved), a = lowestFree(snap, 'audio', at, end, 0, reserved);
        if (p.range.video) reserved.push({ kind: 'video', track: v, start: at, end: end });
        if (p.range.audio) reserved.push({ kind: 'audio', track: a, start: at, end: end });
        plans.push({ item: p.item, at: at, v: v, a: a });
      });
    } else {
      var total = picked.items.reduce(function (sum, p) { return sum + p.range.length; }, 0);
      var v = lowestFree(snap, 'video', at, at + total), a = lowestFree(snap, 'audio', at, at + total), cursor = at;
      picked.items.forEach(function (p) { plans.push({ item: p.item, at: cursor, v: v, a: a }); cursor += p.range.length; });
    }
    await overwrite(ctx, plans, column ? 'Edie: Place Bin Clips as Column' : 'Edie: Place Bin Clips');
    return 'Placed ' + plural(plans.length, 'clip') + (column ? ' stacked at the playhead.' : ' one after another from the playhead.') + (picked.skipped ? ' Skipped ' + plural(picked.skipped, 'bin or sequence', 'bins or sequences') + '.' : '');
  }

  // MARK: Replace from bin

  var INTRINSIC = /^(AE\.ADBE (Motion|Opacity)|AE\.ADBE Time Remapping|ADBE Time Remapping|Internal Volume|Internal Channel Volume|Internal Panner|AE\.ADBE Audio)/i;

  async function componentsOf(item) {
    var chain = await chainOf(item), out = [];
    if (!chain) return out;
    var count = Number(await asPromise(chain.getComponentCount())) || 0;
    for (var i = 0; i < count; i++) {
      var c = await asPromise(chain.getComponentAtIndex(i));
      var entry = { component: c, matchName: String((await tryCall(c, 'getMatchName')) || ''), name: String((await tryCall(c, 'getDisplayName')) || ''), params: [] };
      var n = Number(await tryCall(c, 'getParamCount')) || 0;
      for (var p = 0; p < n; p++) {
        var param = await asPromise(c.getParam(p));
        var keyed = (await tryCall(param, 'isTimeVarying')) === true;
        var value = keyed ? undefined : await tryCall(param, 'getStartValue');
        entry.params.push({ index: p, name: String(param.displayName || ''), keyed: keyed, value: value && value.value !== undefined ? value.value : value });
      }
      out.push(entry);
    }
    return out;
  }

  // Re-applies captured effects and settings to a fresh clip: built-in ones
  // (Motion, Opacity, Volume…) get their values, added ones are re-created.
  async function copyComponents(ctx, kind, captured, target) {
    var chain = await chainOf(target.item);
    if (!chain || !captured.length) return { keyed: 0 };
    var existing = await componentsOf(target.item), keyed = 0, appended = [];
    for (var i = 0; i < captured.length; i++) {
      var from = captured[i];
      var match = INTRINSIC.test(from.matchName) ? existing.filter(function (e) { return e.matchName === from.matchName; })[0] : null;
      if (!match) {
        var created;
        try { created = kind === 'video' ? await asPromise(ppro.VideoFilterFactory.createComponent(from.matchName)) : await asPromise(ppro.AudioFilterFactory.createComponentByDisplayName(from.name, target.item)); }
        catch (_) { created = null; }
        if (created) appended.push({ from: from, component: created });
      }
    }
    if (appended.length) await transaction(ctx.project, 'Edie: Copy effects', function (actions) { appended.forEach(function (a) { actions.addAction(chain.createAppendComponentAction(a.component)); }); });
    var now = await componentsOf(target.item), used = {};
    var writes = [];
    captured.forEach(function (from) {
      var to = null;
      for (var j = 0; j < now.length; j++) if (!used[j] && now[j].matchName === from.matchName) { to = now[j]; used[j] = true; break; }
      if (!to) return;
      from.params.forEach(function (p) {
        if (p.keyed) { keyed++; return; }
        var dest = to.params[p.index];
        if (dest && p.value !== undefined && p.value !== null) writes.push({ component: to.component, index: p.index, value: p.value });
      });
    });
    if (writes.length) {
      var actionsList = [];
      for (var w = 0; w < writes.length; w++) {
        try { var param = await asPromise(writes[w].component.getParam(writes[w].index)); actionsList.push(param.createSetValueAction(param.createKeyframe(writes[w].value), true)); } catch (_) {}
      }
      await transaction(ctx.project, 'Edie: Copy effect settings', function (actions) { actionsList.forEach(function (a) { actions.addAction(a); }); });
    }
    return { keyed: keyed };
  }

  async function replaceFromBin() {
    var ctx = await context();
    var picked = await selectedProjectItems(ctx.project);
    if (!picked.items.length) throw new Error('Select one media clip in the Project panel to replace with.');
    if (picked.items.length + picked.skipped > 1) throw new Error('Select exactly one Project panel clip to replace with — ' + (picked.items.length + picked.skipped) + ' are selected.');
    var source = picked.items[0];
    if (!asClip(source.item).createSetInOutPointsAction) throw new Error('This Premiere cannot set a clip’s In/Out from UXP. Switch Edie’s command runtime to CEP for this.');
    var snap = await snapshot(ctx.sequence);
    var kind = source.range.video ? 'video' : 'audio';
    var targets = snap.selected.filter(function (d) { return d.kind === kind && !d.adjustment; });
    if (!targets.length) throw new Error(kind === 'audio' ? '“' + source.name + '” is audio-only. Select audio Timeline clips to replace.' : 'Select video clips on the Timeline to replace.');
    var original = { in: source.range.in, out: source.range.out }, done = 0, keyed = 0, short = 0;
    for (var i = 0; i < targets.length; i++) {
      var d = targets[i], length = d.end - d.start;
      var speed = Number(await tryCall(d.item, 'getSpeed')) || 1;
      var oldIn = ticksOf(await tryCall(d.item, 'getInPoint'));
      var useIn = isNaN(oldIn) ? original.in : Math.max(original.in, Math.min(oldIn, original.out - length * speed));
      var useOut = Math.min(original.out, useIn + length);
      if (useOut - useIn < length - 2) short++;
      var partners = snap.all.filter(function (o) { return o.link === d.link && o !== d; });
      var captured = await componentsOf(d.item);
      var audioTrack = partners.filter(function (o) { return o.kind === 'audio'; }).map(function (o) { return o.track; })[0];
      if (audioTrack === undefined) audioTrack = lowestFree(snap, 'audio', d.start, d.end);
      await transaction(ctx.project, 'Edie: Replace – set range', function (actions) { actions.addAction(source.clip.createSetInOutPointsAction(timeAt(useIn), timeAt(useOut))); });
      var removals = {};
      // The new media brings its own audio: the old linked audio goes too.
      [d].concat(kind === 'video' && source.range.audio ? partners.filter(function (o) { return o.kind === 'audio'; }) : []).forEach(function (o) { (removals[o.kind] = removals[o.kind] || []).push(o); });
      var selections = {};
      Object.keys(removals).forEach(function (k) {
        ppro.TrackItemSelection.createEmptySelection(function (s) { removals[k].forEach(function (o) { s.addItem(o.item, false); }); selections[k] = s; });
      });
      await transaction(ctx.project, 'Edie: Replace from Bin', function (actions) {
        Object.keys(selections).forEach(function (k) { actions.addAction(ctx.editor.createRemoveItemsAction(selections[k], false, mediaType(k), false)); });
        actions.addAction(ctx.editor.createOverwriteItemAction(source.item, timeAt(d.start), kind === 'video' ? d.track : lowestFree(snap, 'video', d.start, d.end), kind === 'audio' ? d.track : audioTrack));
      });
      var after = await snapshot(ctx.sequence);
      var fresh = (after.tracks[kind][d.track] || []).filter(function (o) { return Math.abs(o.start - d.start) <= 2; })[0];
      if (fresh) { var copied = await copyComponents(ctx, kind, captured, fresh); keyed += copied.keyed; done++; }
    }
    await transaction(ctx.project, 'Edie: Replace – restore range', function (actions) { actions.addAction(source.clip.createSetInOutPointsAction(timeAt(original.in), timeAt(original.out))); });
    return 'Replaced ' + plural(done, 'clip') + ' with “' + source.name + '”.' + (short ? ' ' + plural(short, 'slot') + ' ran longer than the new media.' : '') + (keyed ? ' ' + plural(keyed, 'keyframed setting') + ' could not be copied.' : '');
  }

  // MARK: Perfect Pitch

  var PITCH_MIN = 0.5, PITCH_MAX = 2.0;
  function pitchName(value) { return String(value || '').toLowerCase().replace(/[^a-z]/g, ''); }

  async function pitchShifters(item) {
    return (await componentsOf(item)).filter(function (c) { return /pitch\s*shifter/i.test(c.name) || /pitchshift/i.test(pitchName(c.matchName)); });
  }
  function preferredPitch(found) {
    var speed = found.filter(function (c) { return pitchName(c.name).indexOf('speed') >= 0; });
    return speed[0] || (found.length === 1 ? found[0] : null);
  }
  function ratioParam(component) {
    var fallback = null;
    for (var i = 0; i < component.params.length; i++) {
      var name = pitchName(component.params[i].name);
      if (name === 'transposeratio' || name === 'pitchtransposeratio') return component.params[i];
      if (name === 'ratio') fallback = component.params[i];
    }
    return fallback;
  }

  async function perfectPitch() {
    var ctx = await context(), snap = await snapshot(ctx.sequence);
    var audio = withLinked(snap).filter(function (d) { return d.kind === 'audio'; });
    if (!audio.length) throw new Error('Select audio clips (or video clips with linked audio) first.');
    var plans = [], problems = [], added = 0, reset = 0;
    for (var i = 0; i < audio.length; i++) {
      var d = audio[i], speed = Number(await tryCall(d.item, 'getSpeed'));
      if (!(speed > 0)) { problems.push(d.name + ' has an unreadable speed'); continue; }
      var displayed = 1 / speed, found = await pitchShifters(d.item), component = preferredPitch(found);
      if (Math.abs(speed - 1) < 0.0001) { if (component) plans.push({ d: d, displayed: 1, reset: true }); continue; }
      if (displayed < PITCH_MIN || displayed > PITCH_MAX) { problems.push(d.name + ' needs a ' + displayed.toFixed(2) + ' correction, outside Pitch Shifter’s 0.5–2.0 range'); continue; }
      if (!component && found.length > 1) { problems.push(d.name + ' has more than one Pitch Shifter and none named “speed”'); continue; }
      plans.push({ d: d, displayed: displayed });
    }
    if (problems.length) throw new Error('Perfect Pitch changed nothing: ' + problems.join('; ') + '.');
    if (!plans.length) return 'The selected audio already plays at 100% speed.';
    for (var p = 0; p < plans.length; p++) {
      var plan = plans[p], comp = preferredPitch(await pitchShifters(plan.d.item));
      if (!comp) {
        var chain = await chainOf(plan.d.item), created = await asPromise(ppro.AudioFilterFactory.createComponentByDisplayName('Pitch Shifter', plan.d.item));
        await transaction(ctx.project, 'Edie: Add Pitch Shifter', function (actions) { actions.addAction(chain.createAppendComponentAction(created)); });
        added++;
        comp = preferredPitch(await pitchShifters(plan.d.item));
        if (!comp) throw new Error('Premiere did not add Pitch Shifter to ' + plan.d.name + '.');
      }
      var ratio = ratioParam(comp);
      if (!ratio) throw new Error('Transpose Ratio is not exposed on ' + plan.d.name + '.');
      if (ratio.keyed) throw new Error('Transpose Ratio is keyframed on ' + plan.d.name + '.');
      var wanted = (plan.displayed - PITCH_MIN) / (PITCH_MAX - PITCH_MIN);
      var param = await asPromise(comp.component.getParam(ratio.index));
      await transaction(ctx.project, 'Edie: Perfect Pitch', function (actions) { actions.addAction(param.createSetValueAction(param.createKeyframe(wanted), true)); });
      var back = await tryCall(param, 'getStartValue');
      back = Number(back && back.value !== undefined ? back.value : back);
      if (isNaN(back) || Math.abs(back - wanted) > 0.001) await failAndUndo('The correction did not take on ' + plan.d.name + '.');
      if (plan.reset) reset++;
    }
    var corrected = plans.length - reset, parts = [];
    if (corrected) parts.push('Corrected the pitch of ' + plural(corrected, 'clip') + (added ? ' (added Pitch Shifter to ' + added + ')' : ''));
    if (reset) parts.push((corrected ? 'reset ' : 'Reset ') + plural(reset, 'clip') + ' back to neutral at 100% speed');
    return parts.join(', ') + '.';
  }

  // MARK: Adjustment layer

  async function findAdjustmentLayer(project, snap) {
    for (var i = 0; i < snap.all.length; i++) {
      if (snap.all[i].adjustment) { var item = await tryCall(snap.all[i].item, 'getProjectItem'); if (item) return item; }
    }
    async function walk(folder, depth) {
      var items = folder ? toArray(await tryCall(folder, 'getItems')) : [];
      for (var j = 0; j < items.length; j++) {
        var sub = asFolder(items[j]);
        if (sub) { if (depth < 6) { var found = await walk(sub, depth + 1); if (found) return found; } continue; }
        if (/adjustment layer/i.test(itemName(items[j])) && asClip(items[j])) return items[j];
      }
      return null;
    }
    return walk(asFolder(await asPromise(project.getRootItem())), 0);
  }

  async function adjustmentLayer() {
    var ctx = await context(), snap = await snapshot(ctx.sequence);
    var selected = snap.selected.filter(function (d) { return d.kind === 'video'; });
    if (!selected.length) throw new Error('Select the video clips the adjustment layer should cover.');
    var start = Math.min.apply(null, selected.map(function (d) { return d.start; }));
    var end = Math.max.apply(null, selected.map(function (d) { return d.end; }));
    var top = Math.max.apply(null, selected.map(function (d) { return d.track; }));
    var item = await findAdjustmentLayer(ctx.project, snap);
    if (!item) throw new Error('Premiere cannot make an adjustment layer from a plug-in. Make one once (File › New › Adjustment Layer) and Edie will reuse it.');
    var clip = asClip(item);
    if (!clip || !clip.createSetInOutPointsAction) throw new Error('This Premiere cannot size an adjustment layer from UXP. Switch Edie’s command runtime to CEP for this.');
    var range = await clipRange(clip);
    var track = lowestFree(snap, 'video', start, end, top + 1);
    var mediaStart = range ? range.in : 0;
    await transaction(ctx.project, 'Edie: Adjustment layer – length', function (actions) { actions.addAction(clip.createSetInOutPointsAction(timeAt(mediaStart), timeAt(mediaStart + (end - start)))); });
    await overwrite(ctx, [{ item: item, at: start, v: track, a: snap.tracks.audio.length }], 'Edie: Adjustment Layer over Selection');
    if (range) await transaction(ctx.project, 'Edie: Adjustment layer – restore', function (actions) { actions.addAction(clip.createSetInOutPointsAction(timeAt(range.in), timeAt(range.out))); });
    var after = await snapshot(ctx.sequence);
    var placed = (after.tracks.video[track] || []).filter(function (d) { return Math.abs(d.start - start) <= 2; })[0];
    if (!placed) await failAndUndo('Premiere did not place the adjustment layer.');
    if (Math.abs(placed.end - end) > 2) {
      await transaction(ctx.project, 'Edie: Adjustment layer – fit', function (actions) { actions.addAction(placed.item.createSetEndAction(timeAt(end))); });
    }
    return 'Added “' + itemName(item) + '” on ' + trackLabel('video', track) + ' over ' + plural(selected.length, 'selected clip') + '.';
  }

  // MARK: Queue cuts to Media Encoder

  function exportSafeName(value) { return String(value || 'clip').replace(/[^A-Za-z0-9 ._-]/g, '_').replace(/\s+/g, ' ').substring(0, 80); }
  function stripExtension(value) { return String(value || '').replace(/\.[A-Za-z0-9]{2,5}$/, ''); }
  function exportName(pattern, sequenceName, index, clipName) {
    var padded = (index < 10 ? '0' : '') + index;
    var text = String(pattern || '{sequence} - {index}').split('{sequence}').join(exportSafeName(sequenceName)).split('{index}').join(padded).split('{clip}').join(exportSafeName(stripExtension(clipName)));
    text = exportSafeName(text);
    return text || exportSafeName(sequenceName) + ' - ' + padded;
  }

  async function presetPath() {
    try {
      var fs = require('uxp').storage.localFileSystem, folder = await fs.getPluginFolder();
      var epr = await folder.getEntry('epr'), entries = await epr.getEntries();
      for (var i = 0; i < entries.length; i++) if (/\.epr$/i.test(entries[i].name)) return entries[i].nativePath;
    } catch (_) {}
    return '';
  }

  async function queueToAME(command) {
    var ctx = await context();
    if (!ppro.EncoderManager || !ppro.EncoderManager.getManager) throw new Error('This Premiere cannot queue to Media Encoder from UXP. Switch Edie’s command runtime to CEP for this.');
    var manager = ppro.EncoderManager.getManager();
    var type = ppro.Constants && ppro.Constants.ExportType && ppro.Constants.ExportType.QUEUE_TO_AME;
    if (type === undefined) throw new Error('This Premiere has no Media Encoder queue in UXP.');
    var snap = await snapshot(ctx.sequence), ranges = [], seen = {};
    var video = snap.selected.filter(function (d) { return d.kind === 'video'; });
    if (!snap.selected.length) throw new Error('Select the Timeline clips you want queued. Each one becomes a separate Media Encoder job.');
    var synthetic = 0;
    for (var i = 0; i < video.length; i++) {
      var d = video[i];
      if (d.adjustment) { synthetic++; continue; }
      var source = asClip(await tryCall(d.item, 'getProjectItem'));
      var path = source ? String((await tryCall(source, 'getMediaFilePath')) || '') : '';
      if (!path) { synthetic++; continue; }
      var key = d.start + ':' + d.end;
      if (seen[key]) continue;
      seen[key] = true;
      ranges.push({ start: d.start, end: d.end, name: d.name, source: path });
    }
    if (!ranges.length) throw new Error(synthetic ? 'The selection only contains adjustment layers, mattes or graphics. Select the video or image clips you want exported.' : 'Select video or image clips on the Timeline. Audio-only selections do not define an export range.');
    ranges.sort(function (a, b) { return a.start - b.start; });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && (r.start < last.end - 1 || (command.mergeTouchingSameSource === true && Math.abs(r.start - last.end) <= ctx.frameTicks && r.source === last.source))) last.end = Math.max(last.end, r.end);
      else merged.push({ start: r.start, end: r.end, name: r.name, source: r.source });
    });
    if (merged.length > 100) throw new Error('That selection would queue ' + merged.length + ' Media Encoder jobs. Select fewer than 100 clips.');
    var projectPath = '';
    try { projectPath = String(ctx.project.path || ''); } catch (_) {}
    if (!projectPath || !api.exportFolder) throw new Error('Save the project first — Edie writes exports beside the project file.');
    var folder = await api.exportFolder(projectPath);
    var preset = await presetPath();
    var extension = 'mp4';
    try { extension = String((await asPromise(manager.getExportFileExtension(ctx.sequence, preset))) || extension).replace(/^\./, ''); } catch (_) {}
    var originalIn = await asPromise(ctx.sequence.getInPoint()), originalOut = await asPromise(ctx.sequence.getOutPoint());
    var sequenceName = String(ctx.sequence.name || 'Sequence'), separator = folder.indexOf('\\') >= 0 ? '\\' : '/';
    var queued = 0, failures = [];
    for (var r = 0; r < merged.length; r++) {
      var range = merged[r];
      await transaction(ctx.project, 'Edie: Set In/Out for export', function (actions) {
        actions.addAction(ctx.sequence.createSetInPointAction(timeAt(range.start)));
        actions.addAction(ctx.sequence.createSetOutPointAction(timeAt(range.end)));
      });
      var readBack = ticksOf(await asPromise(ctx.sequence.getInPoint()));
      if (isNaN(readBack) || Math.abs(readBack - range.start) > ctx.frameTicks) { failures.push(range.name + ' (Premiere did not accept the In point)'); continue; }
      var file = folder + separator + exportName(command.exportNamePattern, sequenceName, r + 1, range.name) + '.' + extension;
      try {
        var ok = await asPromise(manager.exportSequence(ctx.sequence, type, file, preset, false));
        if (ok === false) failures.push(range.name + ' (Media Encoder refused the job)'); else queued++;
      } catch (error) { failures.push(range.name + ' (' + (error && error.message || error) + ')'); }
    }
    try {
      await transaction(ctx.project, 'Edie: Restore In/Out', function (actions) {
        if (originalIn) actions.addAction(ctx.sequence.createSetInPointAction(originalIn));
        if (originalOut) actions.addAction(ctx.sequence.createSetOutPointAction(originalOut));
      });
    } catch (_) {}
    if (!queued) throw new Error('Nothing was queued: ' + failures.join('; ') + '.');
    return 'Queued ' + plural(queued, 'cut') + ' to Media Encoder in “PR FX Exports”.' + (failures.length ? ' Not queued: ' + failures.join('; ') + '.' : '') + ' Start the queue in Media Encoder when ready.';
  }

  // MARK: Inspect

  async function inspectSelectedClip() {
    var ctx = await context(), snap = await snapshot(ctx.sequence);
    var d = requireSelection(snap.selected)[0];
    var sec = function (t) { return (t / TICKS_PER_SECOND).toFixed(3) + 's'; };
    var speed = Number(await tryCall(d.item, 'getSpeed'));
    var inPoint = ticksOf(await tryCall(d.item, 'getInPoint')), outPoint = ticksOf(await tryCall(d.item, 'getOutPoint'));
    var source = asClip(await tryCall(d.item, 'getProjectItem'));
    var path = source ? String((await tryCall(source, 'getMediaFilePath')) || '') : '';
    var components = await componentsOf(d.item);
    var lines = [
      '“' + d.name + '” on ' + trackLabel(d.kind, d.track) + ': ' + sec(d.start) + ' – ' + sec(d.end) + ' (' + framesText(d.end - d.start, ctx.frameTicks) + ')',
      'Source In/Out ' + (isNaN(inPoint) ? '?' : sec(inPoint)) + ' – ' + (isNaN(outPoint) ? '?' : sec(outPoint)) + (speed > 0 ? ' · speed ' + (speed * 100).toFixed(1) + '%' : '') + (d.adjustment ? ' · adjustment layer' : ''),
      path ? 'Media ' + path : 'No media file (graphic, matte or adjustment layer)',
      'Effects: ' + (components.map(function (c) { return c.name + (c.params.some(function (p) { return p.keyed; }) ? ' (keyframed)' : ''); }).join(', ') || 'none')
    ];
    if (snap.selected.length > 1) lines.push(plural(snap.selected.length - 1, 'other clip') + ' also selected.');
    return lines.join('\n');
  }

  // MARK: Edie's Undo
  //
  // Each command that changed something leaves an entry: how many Premiere
  // steps it took and the Timeline as it left it. Undo refuses when the
  // Timeline has changed since (the editor's own edits would be undone too).

  var history = [], redoStack = [], HISTORY_DEPTH = 25;
  var ARRANGE = { 'move-selected-clips-up': 1, 'move-selected-clips-down': 1, 'pull-group-in': 1, 'pull-group-out': 1, 'snap-tracks-in': 1, 'snap-tracks-out': 1, 'stagger-ascending': 1, 'stagger-descending': 1, 'close-selected-gaps': 1, 'clean-up-track-rows': 1, 'fill-track-rows-down': 1 };

  async function rewind(filter, what) {
    var entry = history[history.length - 1];
    if (!entry) throw new Error('Edie has not made any changes to undo in this session.');
    if (filter && !filter(entry)) throw new Error('Edie’s last change was “' + entry.label + '”, not ' + what + '. Undo that first, or use Premiere’s Undo.');
    var ctx = await context();
    if (entry.after && (await fingerprint(ctx.sequence)) !== entry.after) throw new Error('The Timeline changed since “' + entry.label + '”. Undoing it would discard those edits too — use Premiere’s own Undo instead.');
    if (!api.pressUndo) throw new Error('Edie’s listener is needed to press Undo.');
    await api.pressUndo(entry.steps, false);
    await wait(250 + entry.steps * 120);
    history.pop();
    redoStack.push(entry);
    return 'Undid “' + entry.label + '” (' + plural(entry.steps, 'Premiere step') + ').';
  }

  async function redoArrange() {
    var entry = redoStack[redoStack.length - 1];
    if (!entry || !ARRANGE[entry.id]) throw new Error('There is no undone arrange step to redo.');
    var ctx = await context();
    if (entry.before && (await fingerprint(ctx.sequence)) !== entry.before) throw new Error('The Timeline changed since that step was undone, so Redo could land wrong. Use Premiere’s Redo instead.');
    await api.pressUndo(entry.steps, true);
    await wait(250 + entry.steps * 120);
    redoStack.pop();
    history.push(entry);
    return 'Redid “' + entry.label + '”.';
  }

  var UNDO_IDS = { 'undo-last-prfx-action': 1, 'undo-last-arrange': 1, 'redo-last-arrange': 1, 'undo-last-palette-action': 1 };

  // MARK: Folder sync — the same rules as prfx.syncFolder in host.jsx: each
  // watched folder is a same-named top-level bin, subfolders become sub-bins,
  // files already in that bin are refreshed and new ones imported.

  function normalizedPath(value) { return String(value || '').replace(/\\/g, '/').toLowerCase(); }

  async function children(folder) {
    var cast = asFolder(folder);
    return cast ? toArray(await asPromise(cast.getItems())) : [];
  }
  async function childBin(parent, name) {
    var items = await children(parent);
    for (var i = 0; i < items.length; i++) if (itemName(items[i]) === name && asFolder(items[i])) return asFolder(items[i]);
    return null;
  }
  async function findOrCreateBin(project, parent, name) {
    var found = await childBin(parent, name);
    if (found) return found;
    var folder = asFolder(parent);
    if (!folder || typeof folder.createBinAction !== 'function') throw new Error('Premiere cannot create bins here.');
    await transaction(project, 'Edie: Create bin', function (actions) { actions.addAction(folder.createBinAction(name, false)); });
    // The Project panel can list a new bin a moment after the transaction.
    for (var tries = 0; tries < 10; tries++) {
      found = await childBin(parent, name);
      if (found) return found;
      await wait(200);
    }
    throw new Error('Premiere did not create the bin “' + name + '”.');
  }
  async function mediaPath(item) {
    var clip = asClip(item);
    if (!clip || typeof clip.getMediaFilePath !== 'function') return '';
    try { return String(await asPromise(clip.getMediaFilePath()) || ''); } catch (_) { return ''; }
  }
  async function collectMedia(folder, known, deep) {
    var items = await children(folder);
    for (var i = 0; i < items.length; i++) {
      if (asFolder(items[i])) { if (deep) await collectMedia(items[i], known, true); continue; }
      var at = await mediaPath(items[i]);
      if (at) known[normalizedPath(at)] = items[i];
    }
    return known;
  }

  // Every key CEP may have stored this project's folders under (documentID,
  // path, name), so folders added in the old panel still show here.
  async function projectIdentity() {
    var project = await activeProject(), keys = [];
    try { if (project.guid) keys.push(String(project.guid)); } catch (_) {}
    try { if (project.path) keys.push(String(project.path)); } catch (_) {}
    var name = itemName(project) || 'Untitled Project';
    keys.push(name);
    return { keys: keys, name: name.replace(/\.prproj$/i, '') };
  }

  async function syncFolder(request) {
    var files = request.files || [], imported = 0, refreshed = 0, missed = [];
    var project = await activeProject();
    if (!request.binName || !files.length) return { imported: 0, refreshed: 0, missed: [] };
    var root = asFolder(await asPromise(project.getRootItem()));
    if (!root) throw new Error('Premiere could not read the Project panel.');
    var destination = await findOrCreateBin(project, root, request.binName);
    var known = await collectMedia(destination, {}, true), buckets = {}, order = [], i;

    for (i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file || !file.path || !file.relativePath) continue;
      var existing = asClip(known[normalizedPath(file.path)]);
      if (existing) {
        if (typeof existing.refreshMedia === 'function') {
          try { await asPromise(existing.refreshMedia()); refreshed++; } catch (_) {}
        }
        continue;
      }
      var parts = String(file.relativePath).split('/'), key = parts.slice(0, -1).filter(Boolean).join('/');
      if (!buckets[key]) { buckets[key] = { parts: parts.slice(0, -1).filter(Boolean), paths: [] }; order.push(key); }
      buckets[key].paths.push(file.path);
    }

    // Media already elsewhere in the project before this import: never moved,
    // so a misplaced new import can't be confused with the editor's own clip.
    var before = order.length ? await collectMedia(root, {}, true) : {};
    for (i = 0; i < order.length; i++) {
      var bucket = buckets[order[i]], bin = destination;
      for (var p = 0; p < bucket.parts.length; p++) bin = await findOrCreateBin(project, bin, bucket.parts[p]);
      try { await asPromise(project.importFiles(bucket.paths, true, bin, false)); }
      catch (error) { missed = missed.concat(bucket.paths); continue; }
      // Premiere may place imports in the selected bin instead of the one
      // asked for: find each new file by its media path and move it there.
      var inBin = await collectMedia(bin, {}, false), anywhere = null, moves = [];
      for (var f = 0; f < bucket.paths.length; f++) {
        var wanted = normalizedPath(bucket.paths[f]);
        if (inBin[wanted]) { imported++; continue; }
        if (!anywhere) anywhere = await collectMedia(root, {}, true);
        if (anywhere[wanted] && !before[wanted]) moves.push(anywhere[wanted]); else missed.push(bucket.paths[f]);
      }
      if (moves.length) {
        var target = bin;
        await transaction(project, 'Edie: Sync folder', function (actions) {
          for (var m = 0; m < moves.length; m++) actions.addAction(target.createMoveItemAction(moves[m], target));
        });
        imported += moves.length;
      }
    }
    return { imported: imported, refreshed: refreshed, missed: missed };
  }

  // MARK: Command table and routing

  var handlers = {
    'select-before-playhead': selectBeforePlayhead,
    'trim-in-to-playhead': function () { return trimToPlayhead('in'); },
    'trim-out-to-playhead': function () { return trimToPlayhead('out'); },
    'pull-group-in': function () { return pullGroup('in'); },
    'pull-group-out': function () { return pullGroup('out'); },
    'snap-tracks-in': function () { return snapTracks(false); },
    'snap-tracks-out': function () { return snapTracks(true); },
    'stagger-ascending': function (c) { return stagger(c, false); },
    'stagger-descending': function (c) { return stagger(c, true); },
    'close-selected-gaps': closeGaps,
    'move-selected-clips-up': function (c) { return moveVertical(c, 'up'); },
    'move-selected-clips-down': function (c) { return moveVertical(c, 'down'); },
    'clean-up-track-rows': function () { return cleanUpRows(false); },
    'fill-track-rows-down': function () { return cleanUpRows(true); },
    'remove-transitions': removeTransitions,
    'place-source-clip': placeSourceClip,
    'place-bin-clips': function () { return placeBinClips(false); },
    'place-bin-clips-column': function () { return placeBinClips(true); },
    'replace-from-bin': replaceFromBin,
    'perfect-pitch': perfectPitch,
    'adjustment-layer-over-selection': adjustmentLayer,
    'queue-cuts-to-ame': queueToAME,
    'inspect-selected-clip': inspectSelectedClip,
    'undo-last-prfx-action': function () { return rewind(null, ''); },
    'undo-last-arrange': function () { return rewind(function (e) { return ARRANGE[e.id]; }, 'an arrange step'); },
    'undo-last-palette-action': function () { return rewind(function (e) { return e.type === 'effect' || e.type === 'audio-effect' || e.type === 'transition'; }, 'an effect or transition'); },
    'redo-last-arrange': redoArrange
  };
  var READ_ONLY = { 'inspect-selected-clip': 1 };

  // What each command needs from Premiere's UXP API; a command whose needs
  // are missing is not registered, so it stays on the CEP engine.
  var NEEDS = {
    timing: ['TrackItem.createMoveAction'],
    tracks: ['SequenceEditor.createCloneTrackItemAction', 'SequenceEditor.createRemoveItemsAction'],
    trims: ['TrackItem.createSetStartAction', 'TrackItem.createSetEndAction'],
    place: ['SequenceEditor.createOverwriteItemAction'],
    replace: ['SequenceEditor.createOverwriteItemAction', 'SequenceEditor.createRemoveItemsAction', 'ClipProjectItem.createSetInOutPointsAction'],
    transitions: ['VideoClipTrackItem.createAddVideoTransitionAction'],
    removeTransitions: ['VideoClipTrackItem.createRemoveVideoTransitionAction'],
    encoder: ['EncoderManager', 'Sequence.createSetInPointAction', 'Sequence.createSetOutPointAction'],
    pitch: ['AudioFilterFactory.createComponentByDisplayName']
  };
  var COMMAND_NEEDS = {
    'pull-group-in': 'timing', 'pull-group-out': 'timing', 'snap-tracks-in': 'timing', 'snap-tracks-out': 'timing',
    'stagger-ascending': 'timing', 'stagger-descending': 'timing', 'close-selected-gaps': 'timing',
    'move-selected-clips-up': 'tracks', 'move-selected-clips-down': 'tracks', 'clean-up-track-rows': 'tracks', 'fill-track-rows-down': 'tracks',
    'trim-in-to-playhead': 'trims', 'trim-out-to-playhead': 'trims',
    'place-source-clip': 'place', 'place-bin-clips': 'place', 'place-bin-clips-column': 'place', 'adjustment-layer-over-selection': 'replace',
    'replace-from-bin': 'replace', 'remove-transitions': 'removeTransitions', 'queue-cuts-to-ame': 'encoder', 'perfect-pitch': 'pitch'
  };

  // Instances to check methods on: Premiere's UXP classes keep most methods
  // on the objects it hands out, not on the class.
  async function probes() {
    var found = { EncoderManager: ppro && ppro.EncoderManager && ppro.EncoderManager.getManager ? {} : null, AudioFilterFactory: ppro && ppro.AudioFilterFactory };
    try {
      var project = await ppro.Project.getActiveProject(), sequence = project && await project.getActiveSequence();
      if (!sequence) return found;
      found.Sequence = sequence;
      found.SequenceEditor = await asPromise(ppro.SequenceEditor.getEditor(sequence));
      var count = Number(await asPromise(sequence.getVideoTrackCount())) || 0;
      for (var t = 0; t < count && !found.TrackItem; t++) {
        var items = await trackItems(await asPromise(sequence.getVideoTrack(t)));
        if (items.length) { found.TrackItem = items[0]; found.VideoClipTrackItem = videoClip(items[0]); found.ClipProjectItem = asClip(await tryCall(items[0], 'getProjectItem')); }
      }
    } catch (_) {}
    return found;
  }

  function supported(need, found) {
    var list = NEEDS[need] || [];
    for (var i = 0; i < list.length; i++) {
      var parts = list[i].split('.'), object = found[parts[0]];
      if (object === null) return false;
      if (object === undefined) continue;   // nothing to check against yet: trust it
      if (parts[1] && typeof object[parts[1]] !== 'function') return false;
    }
    return true;
  }

  // The listener gives a command to UXP when its route key is registered: a
  // function's id, or type:name for effects and transitions.
  async function routeKeys(catalog) {
    if (!ppro) return [];
    var found = await probes(), keys = [];
    Object.keys(handlers).forEach(function (id) { if (!COMMAND_NEEDS[id] || supported(COMMAND_NEEDS[id], found)) keys.push(id); });
    var video = await effectNames('video'), audio = await effectNames('audio');
    var canTransition = supported('transitions', found);
    for (var i = 0; i < (catalog || []).length; i++) {
      var c = catalog[i];
      if (!c || c.id) continue;
      if (c.type === 'effect' && video[c.name]) keys.push('effect:' + c.name);
      else if (c.type === 'audio-effect' && audio[c.name]) keys.push('audio-effect:' + c.name);
      else if (c.type === 'transition' && canTransition && await transitionMatchName(c.name)) keys.push('transition:' + c.name);
    }
    return keys;
  }

  function handlerFor(command) {
    if (!command) return null;
    if (command.id && handlers[command.id]) return handlers[command.id];
    if (!command.id && command.type === 'effect') return function (c) { return applyEffect(c, 'video'); };
    if (!command.id && command.type === 'audio-effect') return function (c) { return applyEffect(c, 'audio'); };
    if (!command.id && command.type === 'transition') return applyTransition;
    return null;
  }

  var api = global.EdiePremiere = {
    ids: Object.keys(handlers),
    routeKeys: routeKeys,
    projectIdentity: projectIdentity,
    syncFolder: syncFolder,
    pressUndo: null,      // set by bridge.js: (count, redo) => Promise
    exportFolder: null,   // set by bridge.js: (projectPath) => Promise<path>
    async run(command) {
      var handler = handlerFor(command);
      if (!handler) throw new Error('This command has not moved to UXP yet.');
      var key = command.id || command.type;
      if (UNDO_IDS[key] || READ_ONLY[key]) return await handler(command);
      var before = '';
      try { var ctx = await context(); before = await fingerprint(ctx.sequence); } catch (_) {}
      steps = 0;
      var message;
      try { message = await handler(command); }
      catch (error) {
        // A step that failed part-way: roll back what it did unless the
        // editor chose to keep partial results (General › failure policy).
        if (steps > 0 && command.failurePolicy !== 'keep') {
          var count = steps, undone = await pressUndo(count);
          throw new Error(String(error && error.message || error) + (undone ? ' Edie rolled back ' + plural(count, 'Premiere step') + '.' : ''));
        }
        if (steps === 0) throw error;
        message = null;
        var kept = error;
      }
      if (steps > 0) {
        var after = '';
        try { var now = await context(); after = await fingerprint(now.sequence); } catch (_) {}
        history.push({ id: command.id || '', type: command.type, label: command.name || key, steps: steps, before: before, after: after });
        while (history.length > HISTORY_DEPTH) history.shift();
        redoStack = [];
      }
      if (kept) throw new Error(String(kept && kept.message || kept) + ' The changes made so far were kept; Undo Last Edie Action takes them back.');
      return message;
    }
  };
})(window);
