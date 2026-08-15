/* global app, qe */
var prfx = prfx || {};
// This host intentionally contains only PR FX's native palette operations.
// Ported timeline functions are not loaded or dispatched from this extension.
prfx.HOST_BUILD = '20260815-arrange-timing-2';
if (prfx.lastPaletteEffectUndoCount === undefined) prfx.lastPaletteEffectUndoCount = 0;

prfx.getCatalog = function () {
    try {
        app.enableQE();
        var catalog = [];
        prfx.safeAppendCatalog(catalog, 'effect', 'getVideoEffectList');
        prfx.safeAppendCatalog(catalog, 'transition', 'getVideoTransitionList');
        prfx.safeAppendCatalog(catalog, 'audio-transition', 'getAudioTransitionList');
        return catalog.length ? JSON.stringify(catalog) : 'ERROR: Premiere returned an empty Effects catalog.';
    } catch (error) {
        return 'ERROR: Could not read Premiere’s Effects catalog: ' + error.toString();
    }
};

prfx.safeAppendCatalog = function (target, type, methodName) {
    var source, count, entry, name, i;
    try {
        if (!qe.project || !qe.project[methodName]) return;
        source = qe.project[methodName]();
        count = source && (source.numItems !== undefined ? source.numItems : source.length) || 0;
        for (i = 0; i < count; i++) {
            entry = null;
            try { entry = source[i]; } catch (indexedReadError) {}
            if (!entry) { try { entry = source.getItemAt(i); } catch (itemReadError) {} }
            if (!entry) continue;
            try { name = String(typeof entry === 'string' ? entry : (entry.name || entry.displayName || '')); } catch (nameError) { name = ''; }
            name = name.replace(/^\s+|\s+$/g, '');
            if (name) target.push({ type: type, name: name, transitionFrames: 30 });
        }
    } catch (ignore) {}
};

prfx.syncFolder = function (payload) {
    try {
        var request = JSON.parse(payload), files = request.files || [], destination, known = {}, buckets = {}, imported = 0, refreshed = 0, i, file, existing, bucket;
        if (!app.project || !app.project.rootItem) return 'ERROR: Open a Premiere project before syncing folders.';
        if (!request.binName || !files.length) return JSON.stringify({ imported: 0, refreshed: 0 });
        destination = prfx.findOrCreateBin(app.project.rootItem, request.binName);
        prfx.collectMediaItems(destination, known);
        for (i = 0; i < files.length; i++) {
            file = files[i]; if (!file || !file.path || !file.relativePath) continue;
            existing = known[prfx.normalizedMediaPath(file.path)];
            if (existing) {
                try { existing.refreshMedia(); refreshed++; } catch (refreshError) {}
                continue;
            }
            bucket = prfx.folderBucket(destination, file.relativePath);
            if (!buckets[bucket.key]) buckets[bucket.key] = { bin: bucket.bin, paths: [] };
            buckets[bucket.key].paths.push(file.path);
        }
        for (var key in buckets) {
            try { app.project.importFiles(buckets[key].paths, true, buckets[key].bin, false); imported += buckets[key].paths.length; } catch (importError) {}
        }
        return JSON.stringify({ imported: imported, refreshed: refreshed });
    } catch (error) { return 'ERROR: Folder sync failed: ' + error.toString(); }
};

prfx.getProjectSyncIdentity = function () {
    try {
        if (!app.project) return 'ERROR: Open a project before using folder sync.';
        var documentID = String(app.project.documentID || ''), path = String(app.project.path || ''), name = String(app.project.name || 'Untitled Project');
        return JSON.stringify({ key: documentID || path || name, name: name });
    } catch (error) { return 'ERROR: Could not identify the active project: ' + error.toString(); }
};

prfx.findOrCreateBin = function (parent, name) {
    var children = parent.children, count = children ? Number(children.numItems || 0) : 0, i, child;
    for (i = 0; i < count; i++) {
        try { child = children[i]; } catch (readError) { child = null; }
        if (child && child.type === 2 && child.name === name) return child;
    }
    return parent.createBin(name);
};

prfx.folderBucket = function (root, relativePath) {
    var parts = String(relativePath).split('/'), bin = root, i, key = '';
    for (i = 0; i < parts.length - 1; i++) {
        if (!parts[i]) continue;
        bin = prfx.findOrCreateBin(bin, parts[i]);
        key += '/' + parts[i];
    }
    return { key: key || '/', bin: bin };
};

prfx.collectMediaItems = function (parent, known) {
    var children = parent.children, count = children ? Number(children.numItems || 0) : 0, i, child, mediaPath;
    for (i = 0; i < count; i++) {
        try { child = children[i]; } catch (readError) { child = null; }
        if (!child) continue;
        if (child.type === 2) { prfx.collectMediaItems(child, known); continue; }
        try { mediaPath = child.getMediaPath(); } catch (pathError) { mediaPath = ''; }
        if (mediaPath) known[prfx.normalizedMediaPath(mediaPath)] = child;
    }
};

prfx.normalizedMediaPath = function (path) { return String(path || '').replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase(); };

prfx.apply = function (payload) {
    try {
        var command = JSON.parse(payload);
        if (command.type === 'custom' && command.id === 'undo-last-palette-action') return prfx.undoLastPaletteEffectApply();
        if (command.type === 'custom' && command.id !== 'remove-transitions' && command.id !== 'move-selected-clips-up' && command.id !== 'move-selected-clips-down' && command.id !== 'pull-group-in' && command.id !== 'pull-group-out' && command.id !== 'stagger-ascending' && command.id !== 'stagger-descending') return 'ERROR: Unknown PR FX function.';
        prfx.lastPaletteEffectUndoCount = 0;
        if (!app.project || !app.project.activeSequence) return 'ERROR: Open a sequence and select one or more clips first.';
        app.enableQE();
        var publicSequence = app.project.activeSequence;
        var sequence = qe.project.getActiveSequence();
        var item, selected, duration, i;
        if (!sequence) return 'ERROR: Premiere could not access the active sequence.';
        if (command.type === 'custom') {
            if (command.id === 'move-selected-clips-up') return prfx.moveSelectedClipsUp(publicSequence, sequence, String(command.moveMode || 'group'));
            if (command.id === 'move-selected-clips-down') return prfx.moveSelectedClipsDown(publicSequence, sequence, String(command.moveMode || 'group'));
            if (command.id === 'pull-group-in') return prfx.pullSelectedGroupToPlayhead(publicSequence, sequence, false);
            if (command.id === 'pull-group-out') return prfx.pullSelectedGroupToPlayhead(publicSequence, sequence, true);
            if (command.id === 'stagger-ascending') return prfx.staggerSelectedTrackBlocks(publicSequence, sequence, Number(command.staggerFrames), Number(command.staggerGroup), false);
            if (command.id === 'stagger-descending') return prfx.staggerSelectedTrackBlocks(publicSequence, sequence, Number(command.staggerFrames), Number(command.staggerGroup), true);
            var removed = prfx.removeTransitionsAtSelection(publicSequence, sequence);
            return 'Removed ' + removed + ' transition' + (removed === 1 ? '' : 's') + ' from selected clips.';
        }
        if (command.type === 'effect') {
            selected = prfx.getSelectedQEClips(publicSequence, sequence, 'video');
            if (!selected.length) return prfx.selectionError('video');
            item = qe.project.getVideoEffectByName(command.name);
            if (!item) return 'ERROR: “' + command.name + '” is not available in this Premiere installation.';
            for (i = 0; i < selected.length; i++) selected[i].addVideoEffect(item);
            prfx.lastPaletteEffectUndoCount = selected.length;
            return 'Applied ' + command.name + ' to ' + selected.length + ' selected clip' + (selected.length === 1 ? '' : 's') + '.';
        }
        if (command.type === 'transition' || command.type === 'audio-transition') {
            var kind = command.type === 'audio-transition' ? 'audio' : 'video';
            var placement = String(command.transitionPlacement || 'both');
            if (!prfx.isTransitionPlacement(placement)) placement = 'both';
            selected = prfx.getSelectedQEClipDetails(publicSequence, sequence, kind);
            if (!selected.length) return prfx.selectionError(kind);
            item = kind === 'audio' ? qe.project.getAudioTransitionByName(command.name) : qe.project.getVideoTransitionByName(command.name);
            if (!item) return 'ERROR: “' + command.name + '” is not available in this Premiere installation.';
            duration = prfx.framesToTimecode(Number(command.transitionFrames) || 30);
            var applied = prfx.applyTransitionPlacement(selected, item, duration, placement);
            if (applied.error) return 'ERROR: ' + applied.error;
            if (!applied.count) return 'ERROR: No eligible ' + (kind === 'audio' ? 'audio ' : '') + 'clip boundaries were found for ' + prfx.transitionPlacementLabel(placement) + '.';
            return 'Applied ' + command.name + ' to ' + applied.count + ' ' + prfx.transitionPlacementLabel(placement) + ' ' + (applied.count === 1 ? 'boundary' : 'boundaries') + '.';
        }
        return 'ERROR: Unknown command type.';
    } catch (error) { return 'ERROR: ' + error.toString(); }
};

prfx.getSelectedQEClipDetails = function (publicSequence, qeSequence, kind) {
    var publicSelection = publicSequence.getSelection(), details = [], seen = {}, expectedType = kind === 'audio' ? 2 : 1, i, selected, qeTrack, count, j, qeClip, key, start, end;
    prfx.lastPublicSelectionCount = publicSelection.length;
    for (i = 0; i < publicSelection.length; i++) {
        selected = publicSelection[i]; if (!selected || (selected.type && selected.type !== expectedType)) continue;
        qeTrack = kind === 'audio' ? qeSequence.getAudioTrackAt(selected.parentTrackIndex) : qeSequence.getVideoTrackAt(selected.parentTrackIndex);
        count = qeTrack ? Number(qeTrack.numItems || 0) : 0;
        for (j = 0; j < count; j++) {
            qeClip = qeTrack.getItemAt(j);
            if (qeClip && prfx.sameTimelineRange(selected, qeClip)) {
                start = prfx.timeInSeconds(qeClip.start); end = prfx.timeInSeconds(qeClip.end);
                key = String(selected.parentTrackIndex) + ':' + String(start) + ':' + String(end);
                if (!seen[key]) { seen[key] = true; details.push({ clip: qeClip, trackIndex: Number(selected.parentTrackIndex), start: start, end: end }); }
                break;
            }
        }
    }
    details.sort(function (a, b) { return a.trackIndex === b.trackIndex ? a.start - b.start : a.trackIndex - b.trackIndex; });
    return details;
};

prfx.applyTransitionPlacement = function (selected, item, duration, placement) {
    var applied = 0, i, current, previous, next, groupStart, groupEnd, firstError = '';
    function add(detail, atStart, position) {
        try {
            var result;
            // One call represents one requested clip edge. Do not retry a failed
            // QE mutation because some transition plug-ins mutate before throwing.
            result = position === undefined ?
                detail.clip.addTransition(item, atStart, duration) :
                detail.clip.addTransition(item, atStart, duration, "0", position);
            if (result !== false) applied++;
        } catch (error) { if (!firstError) firstError = error.toString(); }
    }
    if (placement === 'in') {
        for (i = 0; i < selected.length; i++) add(selected[i], true);
    } else if (placement === 'out') {
        for (i = 0; i < selected.length; i++) add(selected[i], false);
    } else if (placement === 'selected-cuts') {
        for (i = 1; i < selected.length; i++) {
            previous = selected[i - 1]; current = selected[i];
            if (current.trackIndex === previous.trackIndex && prfx.sameBoundary(previous.end, current.start)) add(current, true, 0.5);
        }
    } else if (placement === 'group-ends') {
        groupStart = 0;
        for (i = 1; i <= selected.length; i++) {
            previous = selected[i - 1]; next = selected[i];
            if (!next || next.trackIndex !== previous.trackIndex || !prfx.sameBoundary(previous.end, next.start)) {
                add(selected[groupStart], true);
                add(previous, false);
                groupStart = i;
            }
        }
    } else if (placement === 'centered') {
        for (i = 0; i < selected.length; i++) { add(selected[i], true, 0.5); add(selected[i], false, 0.5); }
    } else {
        for (i = 0; i < selected.length; i++) { add(selected[i], true); add(selected[i], false); }
    }
    return { count: applied, error: !applied && firstError ? firstError : '' };
};

prfx.sameBoundary = function (left, right) { return Math.abs(Number(left) - Number(right)) < 0.0001; };
prfx.isTransitionPlacement = function (placement) { return placement === 'both' || placement === 'in' || placement === 'out' || placement === 'selected-cuts' || placement === 'group-ends' || placement === 'centered'; };
prfx.transitionPlacementLabel = function (placement) {
    var labels = { both: 'In + Out', 'in': 'In', out: 'Out', 'selected-cuts': 'selected-cut', 'group-ends': 'group-edge', centered: 'centered' };
    return labels[placement] || labels.both;
};

prfx.moveSelectedClipsUp = function (publicSequence, qeSequence, moveMode) {
    return prfx.moveSelectedClips(publicSequence, qeSequence, moveMode, 'up');
};

prfx.moveSelectedClipsDown = function (publicSequence, qeSequence, moveMode) {
    return prfx.moveSelectedClips(publicSequence, qeSequence, moveMode, 'down');
};

prfx.moveSelectedClips = function (publicSequence, qeSequence, moveMode, moveDirection) {
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence), groups = [];
    var groupsByKind = { video: [], audio: [] };
    var createdTracks = { video: 0, audio: 0 };
    var operations = [], skippedDetails = [], moved = [], transitions = [], restoredTransitions = 0;
    var group, addError, i, j, operation, qeClip, result, direction, verification, rollback, transitionResult, movePlan, kind, liveTrackCount, requiredTrackCount, sourceTrackIndex, skippedCount;
    if (snapshot.error) return 'ERROR: ' + snapshot.error;
    if (!snapshot.selected.length) {
        if (snapshot.staleSelectionCount) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        return 'ERROR: Select one or more Timeline clips first.';
    }
    moveMode = moveMode === 'individual' ? 'individual' : 'group';
    moveDirection = moveDirection === 'down' ? 'down' : 'up';

    groupsByKind.video = prfx.transitionMoveGroups(snapshot.selectedByKind.video, qeSequence, 'video');
    groupsByKind.audio = prfx.transitionMoveGroups(snapshot.selectedByKind.audio, qeSequence, 'audio');
    movePlan = prfx.planMoveSelectedClipGroups(snapshot, groupsByKind, moveMode, moveDirection);
    if (movePlan.error) return 'ERROR: ' + movePlan.error;
    groups = movePlan.groups;
    skippedCount = 0;
    for (i = 0; i < movePlan.skipped.length; i++) {
        group = movePlan.skipped[i];
        for (j = 0; j < group.members.length; j++) {
            skippedDetails.push(group.members[j]);
            skippedCount++;
        }
    }

    for (i = 0; i < groups.length; i++) {
        group = groups[i];
        group.members.sort(function (a, b) { return b.start - a.start; });
        for (j = 0; j < group.members.length; j++) {
            operation = group.members[j];
            operation.targetTrackIndex = group.targetTrackIndex;
            operation.currentTrackIndex = operation.sourceTrackIndex;
            operations.push(operation);
        }
    }
    if (!operations.length) return 'ERROR: No selected clips have an unlocked collision-free track ' + moveDirection + '; nothing was moved.';

    // Resolve every original item before the first timeline mutation. This
    // prevents a stale or ambiguous selection from creating tracks or moving a
    // partial subset.
    for (i = 0; i < operations.length; i++) {
        if (!prfx.resolveMoveQEClip(qeSequence, operations[i], operations[i].sourceTrackIndex)) {
            return 'ERROR: Could not safely resolve “' + operations[i].name + '” before moving. Nothing was changed.';
        }
    }
    // Skipped individual units remain entirely untouched, including their
    // transitions. Only capture and prepare transitions for actual moves.
    transitions = prfx.captureMoveTransitions(publicSequence, operations);

    for (i = 0; i < 2; i++) {
        kind = i === 0 ? 'video' : 'audio';
        requiredTrackCount = snapshot.tracks[kind].length;
        liveTrackCount = Number(kind === 'audio' ? app.project.activeSequence.audioTracks.numTracks : app.project.activeSequence.videoTracks.numTracks);
        sourceTrackIndex = snapshot.selectedByKind[kind].length ? snapshot.selectedByKind[kind][0].sourceTrackIndex : 0;
        while (liveTrackCount < requiredTrackCount) {
            addError = prfx.addMoveDestinationTrack(qeSequence, kind, liveTrackCount, sourceTrackIndex);
            if (addError) return 'ERROR: ' + addError + ' No clips were moved.';
            createdTracks[kind]++;
            publicSequence = app.project.activeSequence;
            try { qeSequence = qe.project.getActiveSequence(); } catch (rebindError) { qeSequence = null; }
            if (!qeSequence) return 'ERROR: Premiere did not republish the active sequence after appending a ' + kind + ' track. No clips were moved.';
            liveTrackCount = Number(kind === 'audio' ? publicSequence.audioTracks.numTracks : publicSequence.videoTracks.numTracks);
        }
    }

    // Structural edits invalidate QE wrappers. Re-resolve the entire source set
    // again before removing transitions or moving a single clip.
    for (i = 0; i < operations.length; i++) {
        if (!prfx.resolveMoveQEClip(qeSequence, operations[i], operations[i].sourceTrackIndex)) {
            return 'ERROR: Premiere did not republish “' + operations[i].name + '” after creating destination tracks. No clips were moved.';
        }
    }

    transitionResult = prfx.removeMoveTransitions(publicSequence, transitions);
    if (!transitionResult.ok) {
        prfx.restoreMoveTransitions(publicSequence, transitions, true);
        return 'ERROR: Move stopped before editing because transitions could not be prepared: ' + transitionResult.message;
    }

    operations.sort(function (a, b) {
        var aDirection;
        if (a.kind !== b.kind) return a.kind === 'video' ? -1 : 1;
        aDirection = a.kind === 'video' ? (moveDirection === 'down' ? -1 : 1) : (moveDirection === 'down' ? 1 : -1);
        if (a.sourceTrackIndex !== b.sourceTrackIndex) return aDirection > 0 ? b.sourceTrackIndex - a.sourceTrackIndex : a.sourceTrackIndex - b.sourceTrackIndex;
        return b.start - a.start;
    });
    try {
        for (i = 0; i < operations.length; i++) {
            operation = operations[i];
            app.enableQE();
            qeSequence = qe.project.getActiveSequence();
            qeClip = prfx.resolveMoveQEClip(qeSequence, operation, operation.currentTrackIndex);
            if (!qeClip) throw new Error('Could not resolve “' + operation.name + '” immediately before moving it.');
            direction = operation.targetTrackIndex - operation.currentTrackIndex;
            result = operation.kind === 'audio' ?
                qeClip.moveToTrack(0, direction, '00:00:00:00', 0) :
                qeClip.moveToTrack(direction, 0, '00:00:00:00', 0);
            if (result === false) throw new Error('Premiere rejected the move for “' + operation.name + '”.');
            operation.currentTrackIndex = operation.targetTrackIndex;
            moved.push(operation);
        }

        publicSequence = app.project.activeSequence;
        verification = prfx.verifyMovedClipState(publicSequence, operations);
        if (!verification.ok) throw new Error(verification.message);
        transitionResult = prfx.restoreMoveTransitions(publicSequence, transitions, false);
        if (!transitionResult.ok) throw new Error('Transition restore failed: ' + transitionResult.message);
        restoredTransitions = transitionResult.restored;
        prfx.selectMovedClips(publicSequence, operations.concat(skippedDetails));
    } catch (error) {
        prfx.removeRestoredMoveTransitions(app.project.activeSequence, transitions);
        rollback = prfx.rollbackMoveOperations(app.project.activeSequence, moved);
        transitionResult = prfx.restoreMoveTransitions(app.project.activeSequence, transitions, true);
        return 'ERROR: Move failed; ' + rollback.restored + ' completed move' + (rollback.restored === 1 ? '' : 's') + ' rolled back' +
            (rollback.failed ? ', ' + rollback.failed + ' rollback failed' : '') +
            (transitionResult.ok ? '' : ', and transition restore failed: ' + transitionResult.message) + ': ' + error.toString();
    }

    var trackMessage = '';
    if (createdTracks.video) trackMessage += ' Created ' + createdTracks.video + ' top video track' + (createdTracks.video === 1 ? '' : 's') + ' without shifting existing tracks.';
    if (createdTracks.audio) trackMessage += ' Created ' + createdTracks.audio + ' bottom audio track' + (createdTracks.audio === 1 ? '' : 's') + ' without shifting existing tracks.';
    var transitionMessage = restoredTransitions ? ' Preserved ' + restoredTransitions + ' transition' + (restoredTransitions === 1 ? '' : 's') + '.' : '';
    var staleMessage = snapshot.staleSelectionCount ? ' Ignored ' + snapshot.staleSelectionCount + ' stale Premiere selection reference' + (snapshot.staleSelectionCount === 1 ? '.' : 's.') : '';
    var skippedMessage = skippedCount ? ' Left ' + skippedCount + ' selected clip' + (skippedCount === 1 ? '' : 's') + ' in place because no clear track existed ' + moveDirection + '.' : '';
    return 'Moved ' + operations.length + ' selected clip' + (operations.length === 1 ? '' : 's') + ' ' + moveDirection + ' ' + (moveMode === 'individual' ? 'individually' : 'as a group') + ' while preserving clip data.' + transitionMessage + trackMessage + skippedMessage + staleMessage;
};

prfx.pullSelectedGroupToPlayhead = function (publicSequence, qeSequence, useOutPoint) {
    // Pull is a linked-media operation: selecting either side of a linked A/V
    // edit must carry every live linked TrackItem. Other arrange commands keep
    // their explicit-selection semantics.
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence, true), selected, playhead, playheadTicks, anchorTicks, anchorSeconds, exact = true;
    var i, detail, edgeTicks, edgeSeconds, deltaTicks, deltaSeconds;
    if (!snapshot.selected.length) {
        if (snapshot.staleSelectionCount) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        return 'ERROR: Select one or more Timeline clips first.';
    }
    selected = snapshot.selected;
    try { playhead = publicSequence.getPlayerPosition(); } catch (playheadError) { playhead = null; }
    playheadTicks = prfx.numericTicks(playhead && playhead.ticks);
    anchorTicks = NaN;
    anchorSeconds = useOutPoint ? selected[0].end : selected[0].start;
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        edgeTicks = prfx.numericTicks(useOutPoint ? detail.endTicks : detail.startTicks);
        edgeSeconds = useOutPoint ? detail.end : detail.start;
        if (isNaN(edgeTicks) || isNaN(prfx.numericTicks(detail.startTicks)) || isNaN(prfx.numericTicks(detail.endTicks))) exact = false;
        else if (isNaN(anchorTicks) || (useOutPoint ? edgeTicks > anchorTicks : edgeTicks < anchorTicks)) anchorTicks = edgeTicks;
        if (useOutPoint ? edgeSeconds > anchorSeconds : edgeSeconds < anchorSeconds) anchorSeconds = edgeSeconds;
    }
    if (isNaN(playheadTicks) || isNaN(anchorTicks)) exact = false;
    deltaTicks = exact ? playheadTicks - anchorTicks : NaN;
    deltaSeconds = prfx.timeInSeconds(playhead) - anchorSeconds;
    if (!exact && !(prfx.timeInSeconds(playhead) >= 0)) return 'ERROR: Premiere could not read the playhead position.';
    if ((!exact && Math.abs(deltaSeconds) < 0.000001) || (exact && Math.abs(deltaTicks) < 1)) return 'The selected group is already aligned to the playhead.';
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        if (exact) prfx.assignTimingTargetTicks(detail, prfx.numericTicks(detail.startTicks) + deltaTicks);
        else prfx.assignTimingTargetSeconds(detail, detail.start + deltaSeconds);
        if (detail.targetStart < -0.000001) return 'ERROR: The selected group cannot be pulled before the start of the sequence. Nothing was moved.';
    }
    return prfx.executeTimingMove(publicSequence, qeSequence, snapshot, selected, 'pull', 'Pulled the selected group ' + (useOutPoint ? 'Out' : 'In') + ' to the playhead');
};

prfx.staggerSelectedTrackBlocks = function (publicSequence, qeSequence, frameAmount, groupSize, descending) {
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence), selected = snapshot.selected, kinds = ['video', 'audio'];
    var trackOrders = { video: [], audio: [] }, trackRanks = { video: {}, audio: {} }, seen = { video: {}, audio: {} };
    var staggerable = false, frameTicks, i, j, kind, detail, rank, multiplier, startTicks;
    if (!selected.length) {
        if (snapshot.staleSelectionCount) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        return 'ERROR: Select clips on at least two video tracks or at least two audio tracks first.';
    }
    frameAmount = isNaN(frameAmount) ? 5 : Math.max(0, Math.round(frameAmount));
    groupSize = isNaN(groupSize) ? 1 : Math.max(1, Math.floor(groupSize));
    frameTicks = prfx.numericTicks(publicSequence.timebase);
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        if (!seen[detail.kind][detail.sourceTrackIndex]) {
            seen[detail.kind][detail.sourceTrackIndex] = true;
            trackOrders[detail.kind].push(detail.sourceTrackIndex);
        }
    }
    for (i = 0; i < kinds.length; i++) {
        kind = kinds[i];
        trackOrders[kind].sort(function (a, b) { return a - b; });
        if (descending) trackOrders[kind].reverse();
        if (trackOrders[kind].length >= 2) staggerable = true;
        for (j = 0; j < trackOrders[kind].length; j++) trackRanks[kind][trackOrders[kind][j]] = j;
    }
    if (!staggerable) return 'ERROR: Select clips on at least two video tracks or at least two audio tracks to stagger.';
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        rank = trackOrders[detail.kind].length < 2 ? 0 : trackRanks[detail.kind][detail.sourceTrackIndex];
        multiplier = groupSize === 1 ? rank : rank % groupSize;
        startTicks = prfx.numericTicks(detail.startTicks);
        if (!isNaN(frameTicks) && !isNaN(startTicks) && !isNaN(prfx.numericTicks(detail.endTicks))) prfx.assignTimingTargetTicks(detail, startTicks + multiplier * frameAmount * frameTicks);
        else prfx.assignTimingTargetSeconds(detail, detail.start + multiplier * frameAmount * prfx.timeInSeconds({ ticks: publicSequence.timebase }));
    }
    return prfx.executeTimingMove(publicSequence, qeSequence, snapshot, selected, 'stagger', 'Staggered selected track blocks ' + (descending ? 'Descending' : 'Ascending') + ' by ' + frameAmount + ' frame' + (frameAmount === 1 ? '' : 's'));
};

prfx.numericTicks = function (value) {
    var number;
    if (value === undefined || value === null || value === '') return NaN;
    number = Number(value);
    return isNaN(number) ? NaN : number;
};

prfx.secondsForTicks = function (ticks) {
    var value;
    try { value = new Time(); value.ticks = String(Math.round(ticks)); return Number(value.seconds); } catch (error) { return Number(ticks) / 254016000000; }
};

prfx.assignTimingTargetTicks = function (detail, targetStartTicks) {
    var startTicks = prfx.numericTicks(detail.startTicks), endTicks = prfx.numericTicks(detail.endTicks), durationTicks = endTicks - startTicks;
    detail.targetStartTicks = String(Math.round(targetStartTicks));
    detail.targetEndTicks = String(Math.round(targetStartTicks + durationTicks));
    detail.targetStart = prfx.secondsForTicks(detail.targetStartTicks);
    detail.targetEnd = prfx.secondsForTicks(detail.targetEndTicks);
};

prfx.assignTimingTargetSeconds = function (detail, targetStart) {
    var startTime, endTime;
    detail.targetStart = Number(targetStart);
    detail.targetEnd = detail.targetStart + (detail.end - detail.start);
    try {
        startTime = new Time(); startTime.seconds = detail.targetStart;
        endTime = new Time(); endTime.seconds = detail.targetEnd;
        detail.targetStartTicks = String(startTime.ticks);
        detail.targetEndTicks = String(endTime.ticks);
    } catch (error) { detail.targetStartTicks = ''; detail.targetEndTicks = ''; }
};

prfx.timingDetailChanged = function (detail) {
    var sourceTicks = prfx.numericTicks(detail.startTicks), targetTicks = prfx.numericTicks(detail.targetStartTicks);
    if (detail.targetTrackIndex !== detail.sourceTrackIndex) return true;
    if (!isNaN(sourceTicks) && !isNaN(targetTicks)) return Math.abs(sourceTicks - targetTicks) >= 1;
    return Math.abs(detail.start - detail.targetStart) >= 0.000001;
};

prfx.executeTimingMove = function (publicSequence, qeSequence, snapshot, details, layoutMode, successLabel) {
    var plan = prfx.planTimingMoveDestinations(snapshot, details, layoutMode), operations = [], unchanged = [], moved = [], transitions, transitionResult;
    var createdTracks = { video: 0, audio: 0 }, i, detail, kind, liveTrackCount, requiredTrackCount, sourceTrackIndex, addError;
    var ordered, qeClip, trackOffset, timeOffset, result, verification, rollback, restoredTransitions = 0;
    if (plan.error) return 'ERROR: ' + plan.error;
    for (i = 0; i < details.length; i++) {
        detail = details[i];
        detail.currentTrackIndex = detail.sourceTrackIndex;
        detail.currentStart = detail.start;
        detail.currentEnd = detail.end;
        detail.currentStartTicks = detail.startTicks;
        detail.currentEndTicks = detail.endTicks;
        if (prfx.timingDetailChanged(detail)) operations.push(detail);
        else unchanged.push(detail);
    }
    if (!operations.length) return 'The selected clips are already at the requested timing.';
    for (i = 0; i < operations.length; i++) {
        detail = operations[i];
        if (!prfx.resolveMoveQEClipAt(qeSequence, detail, detail.sourceTrackIndex, detail.start, detail.end)) return 'ERROR: Could not safely resolve “' + detail.name + '” before moving. Nothing was changed.';
        if (snapshot.tracks[detail.kind][detail.sourceTrackIndex].locked) return 'ERROR: “' + detail.name + '” is on a locked track. Nothing was changed.';
    }
    transitions = prfx.captureMoveTransitions(publicSequence, operations);
    for (i = 0; i < 2; i++) {
        kind = i === 0 ? 'video' : 'audio';
        requiredTrackCount = snapshot.tracks[kind].length;
        liveTrackCount = Number(kind === 'audio' ? publicSequence.audioTracks.numTracks : publicSequence.videoTracks.numTracks);
        sourceTrackIndex = snapshot.selectedByKind[kind].length ? snapshot.selectedByKind[kind][0].sourceTrackIndex : 0;
        while (liveTrackCount < requiredTrackCount) {
            addError = prfx.addMoveDestinationTrack(qeSequence, kind, liveTrackCount, sourceTrackIndex);
            if (addError) return 'ERROR: ' + addError + ' No clips were moved.';
            createdTracks[kind]++;
            publicSequence = app.project.activeSequence;
            try { qeSequence = qe.project.getActiveSequence(); } catch (rebindError) { qeSequence = null; }
            if (!qeSequence) return 'ERROR: Premiere did not republish the active sequence after appending a ' + kind + ' track. No clips were moved.';
            liveTrackCount = Number(kind === 'audio' ? publicSequence.audioTracks.numTracks : publicSequence.videoTracks.numTracks);
        }
    }
    for (i = 0; i < operations.length; i++) {
        detail = operations[i];
        if (!prfx.resolveMoveQEClipAt(qeSequence, detail, detail.sourceTrackIndex, detail.start, detail.end)) return 'ERROR: Premiere did not republish “' + detail.name + '” after creating destination tracks. No clips were moved.';
    }
    transitionResult = prfx.removeMoveTransitions(publicSequence, transitions);
    if (!transitionResult.ok) {
        prfx.restoreMoveTransitions(publicSequence, transitions, true);
        return 'ERROR: Move stopped before editing because transitions could not be prepared: ' + transitionResult.message;
    }
    ordered = prfx.orderTimingMoveOperations(operations);
    if (!ordered) {
        prfx.restoreMoveTransitions(publicSequence, transitions, true);
        return 'ERROR: Premiere cannot safely perform this timing layout without using a temporary track. Nothing was moved.';
    }
    try {
        for (i = 0; i < ordered.length; i++) {
            detail = ordered[i];
            app.enableQE(); qeSequence = qe.project.getActiveSequence();
            qeClip = prfx.resolveMoveQEClipAt(qeSequence, detail, detail.currentTrackIndex, detail.currentStart, detail.currentEnd);
            if (!qeClip) throw new Error('Could not resolve “' + detail.name + '” immediately before moving it.');
            trackOffset = detail.targetTrackIndex - detail.currentTrackIndex;
            timeOffset = prfx.moveTimingOffset(publicSequence, detail.targetStart - detail.currentStart, prfx.numericTicks(detail.targetStartTicks) - prfx.numericTicks(detail.currentStartTicks));
            result = detail.kind === 'audio' ? qeClip.moveToTrack(0, trackOffset, timeOffset, 0) : qeClip.moveToTrack(trackOffset, 0, timeOffset, 0);
            if (result === false) throw new Error('Premiere rejected the move for “' + detail.name + '”.');
            detail.currentTrackIndex = detail.targetTrackIndex;
            detail.currentStart = detail.targetStart;
            detail.currentEnd = detail.targetEnd;
            detail.currentStartTicks = detail.targetStartTicks;
            detail.currentEndTicks = detail.targetEndTicks;
            moved.push(detail);
        }
        publicSequence = app.project.activeSequence;
        verification = prfx.verifyMovedClipState(publicSequence, operations);
        if (!verification.ok) throw new Error(verification.message);
        transitionResult = prfx.restoreMoveTransitions(publicSequence, transitions, false);
        if (!transitionResult.ok) throw new Error('Transition restore failed: ' + transitionResult.message);
        restoredTransitions = transitionResult.restored;
        prfx.selectMovedClips(publicSequence, operations.concat(unchanged));
    } catch (error) {
        prfx.removeRestoredMoveTransitions(app.project.activeSequence, transitions);
        rollback = prfx.rollbackMoveOperations(app.project.activeSequence, moved);
        transitionResult = prfx.restoreMoveTransitions(app.project.activeSequence, transitions, true);
        return 'ERROR: Timing move failed; ' + rollback.restored + ' completed move' + (rollback.restored === 1 ? '' : 's') + ' rolled back' + (rollback.failed ? ', ' + rollback.failed + ' rollback failed' : '') + (transitionResult.ok ? '' : ', and transition restore failed: ' + transitionResult.message) + ': ' + error.toString();
    }
    var trackMessage = '';
    if (createdTracks.video) trackMessage += ' Created ' + createdTracks.video + ' top video track' + (createdTracks.video === 1 ? '' : 's') + '.';
    if (createdTracks.audio) trackMessage += ' Created ' + createdTracks.audio + ' higher-numbered audio track' + (createdTracks.audio === 1 ? '' : 's') + '.';
    return successLabel + ' across ' + operations.length + ' clip' + (operations.length === 1 ? '' : 's') + ' while preserving clip data.' + (restoredTransitions ? ' Preserved ' + restoredTransitions + ' transition' + (restoredTransitions === 1 ? '' : 's') + '.' : '') + trackMessage + (snapshot.staleSelectionCount ? ' Ignored ' + snapshot.staleSelectionCount + ' stale selection reference' + (snapshot.staleSelectionCount === 1 ? '.' : 's.') : '');
};

prfx.planTimingMoveDestinations = function (snapshot, details, layoutMode) {
    var kinds = ['video', 'audio'], kindIndex, kind, kindDetails, i, offset, fits, candidateReservations, target, laneCount;
    var groups, groupKeys, key, group, reservations;
    for (kindIndex = 0; kindIndex < kinds.length; kindIndex++) {
        kind = kinds[kindIndex]; kindDetails = [];
        for (i = 0; i < details.length; i++) if (details[i].kind === kind) kindDetails.push(details[i]);
        if (!kindDetails.length) continue;
        if (layoutMode === 'pull') {
            fits = false;
            laneCount = snapshot.tracks[kind].length;
            for (offset = 0; offset <= laneCount + 1 && !fits; offset++) {
                candidateReservations = []; fits = true;
                for (i = 0; i < kindDetails.length; i++) {
                    target = kindDetails[i].sourceTrackIndex + offset;
                    prfx.ensureTimingVirtualTrack(snapshot, kind, target);
                    if (!prfx.timingDetailFits(snapshot, kindDetails[i], target, candidateReservations)) { fits = false; break; }
                    prfx.reserveTimingDetail(candidateReservations, kindDetails[i], target);
                }
            }
            if (!fits) return { error: 'No collision-free ' + kind + ' track layout can fit the pulled group.' };
            offset--;
            for (i = 0; i < kindDetails.length; i++) kindDetails[i].targetTrackIndex = kindDetails[i].sourceTrackIndex + offset;
            continue;
        }
        groups = {}; groupKeys = [];
        for (i = 0; i < kindDetails.length; i++) {
            key = String(kindDetails[i].sourceTrackIndex);
            if (!groups[key]) { groups[key] = { sourceTrackIndex: kindDetails[i].sourceTrackIndex, members: [] }; groupKeys.push(key); }
            groups[key].members.push(kindDetails[i]);
        }
        groupKeys.sort(function (a, b) { return Number(a) - Number(b); });
        reservations = [];
        for (i = 0; i < groupKeys.length; i++) {
            group = groups[groupKeys[i]]; target = group.sourceTrackIndex;
            while (true) {
                prfx.ensureTimingVirtualTrack(snapshot, kind, target);
                if (prfx.timingGroupFits(snapshot, group.members, target, reservations)) break;
                target++;
            }
            for (var memberIndex = 0; memberIndex < group.members.length; memberIndex++) {
                group.members[memberIndex].targetTrackIndex = target;
                prfx.reserveTimingDetail(reservations, group.members[memberIndex], target);
            }
        }
    }
    return { error: '' };
};

prfx.ensureTimingVirtualTrack = function (snapshot, kind, trackIndex) {
    while (trackIndex >= snapshot.tracks[kind].length) snapshot.tracks[kind].push({ locked: false, intervals: [] });
};

prfx.timingDetailFits = function (snapshot, detail, targetTrackIndex, reservations) {
    var lane = snapshot.tracks[detail.kind][targetTrackIndex], i, interval;
    if (!lane || lane.locked) return false;
    for (i = 0; i < lane.intervals.length; i++) {
        interval = lane.intervals[i];
        if (!interval.selected && prfx.moveRangesOverlap(detail.targetStart, detail.targetEnd, interval.start, interval.end)) return false;
    }
    for (i = 0; i < reservations.length; i++) {
        interval = reservations[i];
        if (interval.trackIndex === targetTrackIndex && prfx.moveRangesOverlap(detail.targetStart, detail.targetEnd, interval.start, interval.end)) return false;
    }
    return true;
};

prfx.timingGroupFits = function (snapshot, members, targetTrackIndex, reservations) {
    var i;
    for (i = 0; i < members.length; i++) if (!prfx.timingDetailFits(snapshot, members[i], targetTrackIndex, reservations)) return false;
    return true;
};

prfx.reserveTimingDetail = function (reservations, detail, targetTrackIndex) {
    reservations.push({ trackIndex: targetTrackIndex, start: detail.targetStart, end: detail.targetEnd });
};

prfx.orderTimingMoveOperations = function (operations) {
    var remaining = operations.slice(0), ordered = [], candidateIndex, blockerIndex, candidate, blocker, blocked;
    while (remaining.length) {
        candidateIndex = -1;
        for (var i = 0; i < remaining.length; i++) {
            candidate = remaining[i]; blocked = false;
            for (blockerIndex = 0; blockerIndex < remaining.length; blockerIndex++) {
                if (blockerIndex === i) continue;
                blocker = remaining[blockerIndex];
                if (candidate.kind === blocker.kind && candidate.targetTrackIndex === blocker.currentTrackIndex && prfx.moveRangesOverlap(candidate.targetStart, candidate.targetEnd, blocker.currentStart, blocker.currentEnd)) { blocked = true; break; }
            }
            if (!blocked) { candidateIndex = i; break; }
        }
        if (candidateIndex < 0) return null;
        ordered.push(remaining[candidateIndex]);
        remaining.splice(candidateIndex, 1);
    }
    return ordered;
};

prfx.moveTimingOffset = function (sequence, deltaSeconds, deltaTicks) {
    var value, frame, formatted, negative;
    negative = !isNaN(deltaTicks) ? deltaTicks < 0 : deltaSeconds < 0;
    if ((!isNaN(deltaTicks) && Math.abs(deltaTicks) < 1) || (isNaN(deltaTicks) && Math.abs(deltaSeconds) < 0.000001)) return '00:00:00:00';
    try {
        value = new Time();
        if (!isNaN(deltaTicks)) value.ticks = String(Math.round(Math.abs(deltaTicks)));
        else value.seconds = Math.abs(deltaSeconds);
        frame = new Time(); frame.ticks = String(sequence.timebase);
        formatted = value.getFormatted(frame, sequence.videoDisplayFormat);
        return negative ? '-' + formatted : formatted;
    } catch (error) {
        return (negative ? '-' : '') + prfx.framesToTimecode(Math.max(0, Math.round(Math.abs(deltaSeconds) * 30)));
    }
};

prfx.planMoveSelectedClipGroups = function (snapshot, groupsByKind, moveMode, moveDirection) {
    var planned = [], skipped = [], kinds = ['video', 'audio'], i, kind, direction, kindGroups, sourceLane, j, group;
    var target, laneCount, reservations, candidateReservations, offset, maxOffset, fits, k, canAppend;
    moveDirection = moveDirection === 'down' ? 'down' : 'up';
    for (i = 0; i < kinds.length; i++) {
        kind = kinds[i];
        direction = kind === 'video' ? 1 : -1;
        if (moveDirection === 'down') direction *= -1;
        kindGroups = groupsByKind[kind] || [];
        if (!kindGroups.length) continue;
        kindGroups.sort(function (a, b) {
            if (a.sourceTrackIndex !== b.sourceTrackIndex) return direction > 0 ? b.sourceTrackIndex - a.sourceTrackIndex : a.sourceTrackIndex - b.sourceTrackIndex;
            return a.start - b.start;
        });
        for (j = 0; j < kindGroups.length; j++) {
            sourceLane = snapshot.tracks[kind][kindGroups[j].sourceTrackIndex];
            if (!sourceLane || sourceLane.locked) return { error: 'A selected ' + kind + ' clip is on a locked or unavailable track. Nothing was moved.', groups: [] };
        }

        if (moveMode === 'individual') {
            reservations = [];
            laneCount = snapshot.tracks[kind].length;
            for (j = 0; j < kindGroups.length; j++) {
                group = kindGroups[j];
                target = group.sourceTrackIndex + direction;
                while (target >= 0 && target < laneCount && !prfx.moveGroupFits(snapshot, group, target, reservations)) target += direction;
                if (target < 0) {
                    skipped.push(group);
                    continue;
                }
                while (target >= laneCount) {
                    snapshot.tracks[kind].push({ locked: false, intervals: [] });
                    laneCount++;
                }
                group.targetTrackIndex = target;
                prfx.reserveMoveGroup(reservations, group, target);
                planned.push(group);
            }
            continue;
        }

        // Group mode uses one shared offset for every selected unit of this media
        // kind. Relative track positions are therefore preserved exactly.
        laneCount = snapshot.tracks[kind].length;
        canAppend = direction > 0;
        maxOffset = canAppend ? laneCount + 1 : kindGroups[0].sourceTrackIndex;
        for (j = 1; !canAppend && j < kindGroups.length; j++) maxOffset = Math.min(maxOffset, kindGroups[j].sourceTrackIndex);
        fits = false;
        for (offset = 1; offset <= maxOffset && !fits; offset++) {
            candidateReservations = [];
            fits = true;
            for (k = 0; k < kindGroups.length; k++) {
                group = kindGroups[k];
                target = group.sourceTrackIndex + direction * offset;
                if (target < 0) { fits = false; break; }
                while (target >= snapshot.tracks[kind].length) snapshot.tracks[kind].push({ locked: false, intervals: [] });
                if (!prfx.moveGroupFits(snapshot, group, target, candidateReservations)) { fits = false; break; }
                prfx.reserveMoveGroup(candidateReservations, group, target);
            }
        }
        if (!fits) return { error: 'No shared unlocked collision-free ' + kind + ' track offset can fit the selected group. Nothing was moved.', groups: [] };
        offset--;
        for (j = 0; j < kindGroups.length; j++) {
            group = kindGroups[j];
            group.targetTrackIndex = group.sourceTrackIndex + direction * offset;
            planned.push(group);
        }
    }
    return { error: '', groups: planned, skipped: skipped };
};

prfx.reserveMoveGroup = function (reservations, group, targetTrackIndex) {
    reservations.push({ trackIndex: targetTrackIndex, start: group.start, end: group.end });
};

prfx.addMoveDestinationTrack = function (qeSequence, kind, insertIndex, sourceTrackIndex) {
    var before, after, result, audioType, liveSequence, attempt;
    try {
        liveSequence = app.project && app.project.activeSequence;
        before = Number(kind === 'audio' ? liveSequence.audioTracks.numTracks : liveSequence.videoTracks.numTracks);
        if (kind === 'audio') {
            audioType = prfx.moveAudioTrackType(qeSequence, sourceTrackIndex);
            result = qeSequence.addTracks(0, 0, 1, audioType, insertIndex);
        } else {
            // Passing the current count appends above the existing highest video
            // track. It never inserts between tracks or renumbers existing clips.
            result = qeSequence.addTracks(1, before, 0);
        }
        after = before;
        for (attempt = 0; attempt < 18 && after <= before; attempt++) {
            liveSequence = app.project && app.project.activeSequence;
            after = liveSequence ? Number(kind === 'audio' ? liveSequence.audioTracks.numTracks : liveSequence.videoTracks.numTracks) : before;
            if (after <= before) $.sleep(Math.min(100, 12 + attempt * 6));
        }
        if (result === false || (!isNaN(before) && !isNaN(after) && after <= before)) {
            return 'Premiere did not create the required ' + kind + ' track.';
        }
        return '';
    } catch (error) {
        return 'Premiere could not create the required ' + kind + ' track: ' + error.toString();
    }
};

prfx.resolveMovePublicClip = function (sequence, detail, trackIndex) {
    var start = detail.targetStart !== undefined ? detail.targetStart : detail.start;
    var end = detail.targetEnd !== undefined ? detail.targetEnd : detail.end;
    return prfx.resolveMovePublicClipAt(sequence, detail, trackIndex, start, end);
};

prfx.resolveMovePublicClipAt = function (sequence, detail, trackIndex, start, end) {
    var tracks = detail.kind === 'audio' ? sequence.audioTracks : sequence.videoTracks, track, clips, count, i, clip;
    try { track = tracks[trackIndex]; clips = track.clips; count = Number(clips.numItems || clips.length || 0); } catch (error) { return null; }
    for (i = 0; i < count; i++) {
        try { clip = clips[i]; } catch (clipError) { clip = null; }
        if (clip && Math.abs(prfx.timeInSeconds(clip.start) - start) < 0.0001 && Math.abs(prfx.timeInSeconds(clip.end) - end) < 0.0001) return clip;
    }
    return null;
};

prfx.captureMoveClipState = function (clip) {
    var state = { components: '', speed: '', reversed: '', inTicks: '', outTicks: '', projectItem: '' }, components, count, i, component, names = [];
    try {
        components = clip.components;
        count = components ? Number(components.numItems || components.length || 0) : 0;
        for (i = 0; i < count; i++) {
            try { component = components[i]; names.push(String(component.matchName || component.displayName || component.name || '')); } catch (componentError) { names.push('?'); }
        }
        state.components = names.join('|');
    } catch (componentsError) { state.components = null; }
    try { state.speed = String(clip.getSpeed()); } catch (speedError) { state.speed = null; }
    try { state.reversed = String(clip.isSpeedReversed()); } catch (reverseError) { state.reversed = null; }
    try { state.inTicks = String(clip.inPoint.ticks); } catch (inError) { state.inTicks = null; }
    try { state.outTicks = String(clip.outPoint.ticks); } catch (outError) { state.outTicks = null; }
    try { state.projectItem = String(clip.projectItem.nodeId || ''); } catch (projectItemError) { state.projectItem = null; }
    return state;
};

prfx.moveClipStateMatches = function (clip, expected) {
    var actual = prfx.captureMoveClipState(clip), fields = ['components', 'speed', 'reversed', 'inTicks', 'outTicks', 'projectItem'], i, field;
    for (i = 0; i < fields.length; i++) {
        field = fields[i];
        if (expected[field] !== null && actual[field] !== null && expected[field] !== actual[field]) return false;
    }
    return true;
};

prfx.verifyMovedClipState = function (sequence, operations) {
    var i, operation, clip;
    for (i = 0; i < operations.length; i++) {
        operation = operations[i];
        clip = prfx.resolveMovePublicClip(sequence, operation, operation.targetTrackIndex);
        if (!clip) return { ok: false, message: 'Premiere did not publish “' + operation.name + '” at its planned destination.' };
        if (!prfx.moveClipStateMatches(clip, operation.state)) return { ok: false, message: 'Premiere changed clip state while moving “' + operation.name + '”.' };
    }
    return { ok: true };
};

prfx.selectMovedClips = function (sequence, operations) {
    var i, clip, previous, previousCount, tracks, trackCount, trackIndex, clips, clipCount, clipIndex, selectionTrackIndex;
    // QE moves can leave the old public TrackItem wrappers selected even after
    // their source slots are empty. Deselect both those wrappers and every
    // currently published clip before selecting the moved results.
    try {
        previous = sequence.getSelection(); previousCount = previous ? Number(previous.length || 0) : 0;
        for (i = 0; i < previousCount; i++) {
            try { if (previous[i] && previous[i].setSelected) previous[i].setSelected(false, false); } catch (previousError) {}
        }
    } catch (selectionReadError) {}
    for (var kindIndex = 0; kindIndex < 2; kindIndex++) {
        tracks = kindIndex ? sequence.audioTracks : sequence.videoTracks;
        trackCount = tracks ? Number(tracks.numTracks || tracks.length || 0) : 0;
        for (trackIndex = 0; trackIndex < trackCount; trackIndex++) {
            try { clips = tracks[trackIndex].clips; clipCount = Number(clips.numItems || clips.length || 0); } catch (trackError) { clipCount = 0; }
            for (clipIndex = 0; clipIndex < clipCount; clipIndex++) {
                try { clip = clips[clipIndex]; if (clip && clip.setSelected) clip.setSelected(false, false); } catch (clipError) {}
            }
        }
    }
    for (i = 0; i < operations.length; i++) {
        selectionTrackIndex = operations[i].targetTrackIndex;
        if (selectionTrackIndex === undefined || selectionTrackIndex === null) selectionTrackIndex = operations[i].sourceTrackIndex;
        clip = prfx.resolveMovePublicClip(sequence, operations[i], selectionTrackIndex);
        try { if (clip && clip.setSelected) clip.setSelected(true, i === operations.length - 1); } catch (selectionError) {}
    }
};

prfx.rollbackMoveOperations = function (sequence, moved) {
    var restored = 0, failed = 0, i, detail, clip, offset, timeOffset, result, activeQe, currentStart, currentEnd, currentStartTicks;
    for (i = moved.length - 1; i >= 0; i--) {
        detail = moved[i];
        try {
            app.enableQE(); activeQe = qe.project.getActiveSequence();
            currentStart = detail.currentStart !== undefined ? detail.currentStart : detail.start;
            currentEnd = detail.currentEnd !== undefined ? detail.currentEnd : detail.end;
            currentStartTicks = prfx.numericTicks(detail.currentStartTicks !== undefined ? detail.currentStartTicks : detail.startTicks);
            clip = prfx.resolveMoveQEClipAt(activeQe, detail, detail.currentTrackIndex, currentStart, currentEnd);
            if (!clip) { failed++; continue; }
            offset = detail.sourceTrackIndex - detail.currentTrackIndex;
            timeOffset = prfx.moveTimingOffset(sequence, detail.start - currentStart, prfx.numericTicks(detail.startTicks) - currentStartTicks);
            result = detail.kind === 'audio' ? clip.moveToTrack(0, offset, timeOffset, 0) : clip.moveToTrack(offset, 0, timeOffset, 0);
            if (result === false) failed++;
            else {
                detail.currentTrackIndex = detail.sourceTrackIndex;
                detail.currentStart = detail.start; detail.currentEnd = detail.end;
                detail.currentStartTicks = detail.startTicks; detail.currentEndTicks = detail.endTicks;
                restored++;
            }
        } catch (error) { failed++; }
    }
    return { restored: restored, failed: failed };
};

prfx.captureMoveTransitions = function (sequence, details) {
    var groups = {}, keys = [], output = [], i, detail, key, group, tracks, track, transitions, count, index, transition, anchor, atStart, start, end, boundary, durationTicks, alignment;
    for (i = 0; i < details.length; i++) {
        detail = details[i]; key = detail.kind + ':' + detail.sourceTrackIndex;
        if (!groups[key]) { groups[key] = []; keys.push(key); }
        groups[key].push(detail);
    }
    for (i = 0; i < keys.length; i++) {
        key = keys[i]; group = groups[key]; detail = group[0];
        tracks = detail.kind === 'audio' ? sequence.audioTracks : sequence.videoTracks;
        try { track = tracks[detail.sourceTrackIndex]; transitions = track.transitions; count = Number(transitions.numItems || transitions.length || 0); } catch (trackError) { count = 0; }
        for (index = 0; index < count; index++) {
            try { transition = transitions[index]; } catch (transitionError) { transition = null; }
            if (!transition) continue;
            anchor = null; atStart = false;
            for (var memberIndex = 0; memberIndex < group.length; memberIndex++) {
                detail = group[memberIndex];
                if (prfx.transitionTouchesAnyBoundary(transition, [detail.end])) { anchor = detail; atStart = false; break; }
                if (!anchor && prfx.transitionTouchesAnyBoundary(transition, [detail.start])) { anchor = detail; atStart = true; }
            }
            if (!anchor) continue;
            start = prfx.transitionTime(transition, ['start', 'startTime', 'inPoint']);
            end = prfx.transitionTime(transition, ['end', 'endTime', 'outPoint']);
            boundary = atStart ? anchor.start : anchor.end;
            durationTicks = '';
            try { durationTicks = String(transition.duration.ticks); } catch (durationError) {}
            alignment = end > start ? Math.max(0, Math.min(1, (boundary - start) / (end - start))) : 0.5;
            output.push({
                kind: anchor.kind,
                originalTrackIndex: anchor.sourceTrackIndex,
                anchor: anchor,
                originalBoundary: boundary,
                atStart: atStart,
                name: String(transition.name || ''),
                matchName: String(transition.matchName || ''),
                durationTicks: durationTicks,
                alignment: alignment,
                disabled: transition.disabled === true,
                removed: false,
                restored: false
            });
        }
    }
    return output;
};

prfx.findMoveTransition = function (sequence, data, original) {
    var trackIndex = original ? data.originalTrackIndex : data.anchor.targetTrackIndex;
    var targetStart = data.anchor.targetStart !== undefined ? data.anchor.targetStart : data.anchor.start;
    var targetEnd = data.anchor.targetEnd !== undefined ? data.anchor.targetEnd : data.anchor.end;
    var tracks = data.kind === 'audio' ? sequence.audioTracks : sequence.videoTracks, track, transitions, count, i, transition;
    var boundary = original ? data.originalBoundary : (data.atStart ? targetStart : targetEnd);
    try { track = tracks[trackIndex]; transitions = track.transitions; count = Number(transitions.numItems || transitions.length || 0); } catch (error) { return null; }
    for (i = 0; i < count; i++) {
        try { transition = transitions[i]; } catch (readError) { transition = null; }
        if (!transition) continue;
        if (data.name && String(transition.name || '') !== data.name && (!data.matchName || String(transition.matchName || '') !== data.matchName)) continue;
        if (prfx.transitionTouchesAnyBoundary(transition, [boundary])) return transition;
    }
    return null;
};

prfx.removeMoveTransitions = function (sequence, transitions) {
    var i, current, result;
    for (i = transitions.length - 1; i >= 0; i--) {
        current = prfx.findMoveTransition(sequence, transitions[i], true);
        if (!current || !current.remove) return { ok: false, message: 'Could not resolve transition “' + transitions[i].name + '” before moving.' };
        try { result = current.remove(false, false); } catch (error) { return { ok: false, message: error.toString() }; }
        if (result === false) return { ok: false, message: 'Premiere rejected transition removal for “' + transitions[i].name + '”.' };
        transitions[i].removed = true;
    }
    return { ok: true };
};

prfx.moveTransitionDuration = function (sequence, data) {
    var duration, frame;
    if (data.durationTicks) {
        try {
            duration = new Time(); duration.ticks = data.durationTicks;
            frame = new Time(); frame.ticks = String(sequence.timebase);
            return duration.getFormatted(frame, sequence.videoDisplayFormat);
        } catch (timeError) {}
    }
    return prfx.framesToTimecode(30);
};

prfx.restoreMoveTransitions = function (sequence, transitions, original) {
    var restored = 0, i, data, trackIndex, activeQe, qeClip, transition, duration, result, publicTransition, clipStart, clipEnd;
    for (i = 0; i < transitions.length; i++) {
        data = transitions[i];
        if (!data.removed || (!original && data.restored)) continue;
        trackIndex = original ? data.originalTrackIndex : data.anchor.targetTrackIndex;
        try { app.enableQE(); activeQe = qe.project.getActiveSequence(); } catch (qeError) { activeQe = null; }
        clipStart = original ? data.anchor.start : (data.anchor.targetStart !== undefined ? data.anchor.targetStart : data.anchor.start);
        clipEnd = original ? data.anchor.end : (data.anchor.targetEnd !== undefined ? data.anchor.targetEnd : data.anchor.end);
        qeClip = activeQe ? prfx.resolveMoveQEClipAt(activeQe, data.anchor, trackIndex, clipStart, clipEnd) : null;
        try { transition = data.kind === 'audio' ? qe.project.getAudioTransitionByName(data.name) : qe.project.getVideoTransitionByName(data.name); } catch (lookupError) { transition = null; }
        if (!qeClip || !transition) return { ok: false, restored: restored, message: 'Could not resolve transition “' + data.name + '” for restoration.' };
        duration = prfx.moveTransitionDuration(sequence, data);
        try { result = qeClip.addTransition(transition, data.atStart, duration, '0', data.alignment); }
        catch (detailedError) {
            try { result = qeClip.addTransition(transition, data.atStart, duration); }
            catch (simpleError) { return { ok: false, restored: restored, message: simpleError.toString() }; }
        }
        if (result === false) return { ok: false, restored: restored, message: 'Premiere rejected transition “' + data.name + '”.' };
        data.restored = !original;
        restored++;
        publicTransition = prfx.findMoveTransition(sequence, data, original);
        try { if (publicTransition && publicTransition.disabled !== data.disabled) publicTransition.disabled = data.disabled; } catch (disabledError) {}
    }
    return { ok: true, restored: restored };
};

prfx.removeRestoredMoveTransitions = function (sequence, transitions) {
    var i, current;
    for (i = transitions.length - 1; i >= 0; i--) {
        if (!transitions[i].restored) continue;
        current = prfx.findMoveTransition(sequence, transitions[i], false);
        try { if (current && current.remove) current.remove(false, false); } catch (error) {}
        transitions[i].restored = false;
    }
};

prfx.moveAudioTrackType = function (qeSequence, sourceTrackIndex) {
    var track, values = [], value, i;
    try { track = qeSequence.getAudioTrackAt(sourceTrackIndex); } catch (trackError) { track = null; }
    if (track) {
        try { values.push(String(track.audioType || '')); } catch (audioTypeError) {}
        try { values.push(String(track.trackType || '')); } catch (trackTypeError) {}
        try { values.push(String(track.type || '')); } catch (typeError) {}
    }
    for (i = 0; i < values.length; i++) {
        value = values[i].toLowerCase();
        if (value.indexOf('adaptive') !== -1) return 1;
        if (value.indexOf('5.1') !== -1 || value.indexOf('surround') !== -1) return 2;
        if (value.indexOf('mono') !== -1) return 0;
        if (value.indexOf('stereo') !== -1 || value.indexOf('standard') !== -1) return 3;
    }
    return 3;
};

prfx.moveSelectionSnapshot = function (sequence, qeSequence, includeLinked) {
    var selected = sequence.getSelection(), snapshot = { selected: [], selectedByKind: { video: [], audio: [] }, tracks: { video: [], audio: [] }, staleSelectionCount: 0 };
    var selectedKeys = {}, kinds = ['video', 'audio'], i, kind, item, detail, tracks, trackCount, trackIndex, track, clips, clipCount, clipIndex, clip, key;
    if (includeLinked) selected = prfx.expandLinkedMoveSelection(sequence, selected);
    for (i = 0; i < selected.length; i++) {
        item = selected[i];
        kind = prfx.moveSelectionKind(sequence, item);
        if (!kind) continue;
        detail = { kind: kind, name: String(item.name || 'Timeline clip'), sourceTrackIndex: Number(item.parentTrackIndex), start: prfx.timeInSeconds(item.start), end: prfx.timeInSeconds(item.end), startTicks: prfx.timeTicks(item.start), endTicks: prfx.timeTicks(item.end), state: prfx.captureMoveClipState(item) };
        if (!(detail.end > detail.start) || detail.sourceTrackIndex < 0) continue;
        // Premiere can retain selected public TrackItem wrappers after QE has
        // moved their real timeline items. They look selected to getSelection
        // but no longer exist on their reported source track. Never plan from
        // those ghost wrappers; keep any simultaneously returned live items.
        if (qeSequence && !prfx.resolveMoveQEClip(qeSequence, detail, detail.sourceTrackIndex)) {
            snapshot.staleSelectionCount++;
            continue;
        }
        key = prfx.moveSelectionKey(detail.kind, detail.sourceTrackIndex, detail.start, detail.end);
        if (selectedKeys[key]) continue;
        selectedKeys[key] = true;
        snapshot.selected.push(detail);
        snapshot.selectedByKind[kind].push(detail);
    }
    for (i = 0; i < kinds.length; i++) {
        kind = kinds[i]; tracks = kind === 'audio' ? sequence.audioTracks : sequence.videoTracks;
        trackCount = tracks ? Number(tracks.numTracks || tracks.length || 0) : 0;
        for (trackIndex = 0; trackIndex < trackCount; trackIndex++) {
            try { track = tracks[trackIndex]; } catch (trackError) { track = null; }
            snapshot.tracks[kind][trackIndex] = { locked: prfx.moveTrackLocked(track), intervals: [] };
            clips = track && track.clips; clipCount = clips ? Number(clips.numItems || clips.length || 0) : 0;
            for (clipIndex = 0; clipIndex < clipCount; clipIndex++) {
                try { clip = clips[clipIndex]; } catch (clipError) { clip = null; }
                if (!clip) continue;
                detail = { start: prfx.timeInSeconds(clip.start), end: prfx.timeInSeconds(clip.end) };
                if (!(detail.end > detail.start)) continue;
                key = prfx.moveSelectionKey(kind, trackIndex, detail.start, detail.end);
                snapshot.tracks[kind][trackIndex].intervals.push({ start: detail.start, end: detail.end, selected: !!selectedKeys[key] });
            }
        }
    }
    return snapshot;
};

prfx.expandLinkedMoveSelection = function (sequence, selected) {
    var output = [], queue = [], seen = {}, count = selected ? Number(selected.numItems || selected.length || 0) : 0;
    var i, item, identity, linked, linkedCount, linkedIndex, linkedItem;
    function add(candidate) {
        var candidateKind;
        if (!candidate) return;
        candidateKind = prfx.moveSelectionKind(sequence, candidate);
        if (!candidateKind) return;
        identity = prfx.moveTrackItemIdentity(sequence, candidate, candidateKind);
        if (!identity || seen[identity]) return;
        seen[identity] = true;
        output.push(candidate);
        queue.push(candidate);
    }
    for (i = 0; i < count; i++) {
        try { add(selected[i]); } catch (selectionError) {}
    }
    for (i = 0; i < queue.length; i++) {
        item = queue[i]; linked = null;
        try { linked = item.getLinkedItems ? item.getLinkedItems() : null; } catch (linkedError) { linked = null; }
        linkedCount = linked ? Number(linked.numItems || linked.length || 0) : 0;
        for (linkedIndex = 0; linkedIndex < linkedCount; linkedIndex++) {
            try { linkedItem = linked[linkedIndex]; } catch (linkedItemError) { linkedItem = null; }
            add(linkedItem);
        }
    }
    return output;
};

prfx.moveTrackItemIdentity = function (sequence, item, kind) {
    var nodeId, trackIndex, start, end;
    try { nodeId = item.nodeId; if (nodeId !== undefined && nodeId !== null && String(nodeId) !== '') return 'node:' + String(nodeId); } catch (nodeError) {}
    try {
        trackIndex = Number(item.parentTrackIndex);
        start = prfx.timeInSeconds(item.start);
        end = prfx.timeInSeconds(item.end);
        return prfx.moveSelectionKey(kind || prfx.moveSelectionKind(sequence, item), trackIndex, start, end);
    } catch (identityError) { return ''; }
};

prfx.moveSelectionKind = function (sequence, item) {
    var type = Number(item && item.type), mediaType = '', trackIndex, start, end, inVideo, inAudio;
    if (!item) return '';
    // TrackItem.type describes the item class in current Premiere builds; both
    // linked video and audio clips can report `1`. mediaType is the reliable
    // stream discriminator.
    try { mediaType = String(item.mediaType || '').toLowerCase(); } catch (mediaTypeError) {}
    if (mediaType.indexOf('video') !== -1) return 'video';
    if (mediaType.indexOf('audio') !== -1) return 'audio';
    trackIndex = Number(item.parentTrackIndex); start = prfx.timeInSeconds(item.start); end = prfx.timeInSeconds(item.end);
    inVideo = prfx.publicTrackContainsRange(sequence.videoTracks, trackIndex, start, end);
    inAudio = prfx.publicTrackContainsRange(sequence.audioTracks, trackIndex, start, end);
    if (inVideo && !inAudio) return 'video';
    if (inAudio && !inVideo) return 'audio';
    // Compatibility fallback for older hosts that omit mediaType.
    if (type === 2) return 'audio';
    if (type === 1) return 'video';
    return '';
};

prfx.publicTrackContainsRange = function (tracks, trackIndex, start, end) {
    var track, clips, count, i, clip;
    try { track = tracks[trackIndex]; clips = track.clips; count = Number(clips.numItems || clips.length || 0); } catch (error) { return false; }
    for (i = 0; i < count; i++) {
        try { clip = clips[i]; } catch (readError) { clip = null; }
        if (clip && Math.abs(prfx.timeInSeconds(clip.start) - start) < 0.0001 && Math.abs(prfx.timeInSeconds(clip.end) - end) < 0.0001) return true;
    }
    return false;
};

prfx.moveTrackLocked = function (track) {
    var locked;
    try { if (!track) return true; locked = track.isLocked ? track.isLocked() : false; return locked === true || Number(locked) === 1; } catch (error) { return true; }
};
prfx.moveSelectionKey = function (kind, trackIndex, start, end) { return kind + ':' + trackIndex + ':' + Number(start).toFixed(6) + ':' + Number(end).toFixed(6); };
prfx.moveRangesOverlap = function (startA, endA, startB, endB) { return startA < endB - 0.000001 && endA > startB + 0.000001; };

prfx.transitionMoveGroups = function (details, qeSequence, kind) {
    var ordered = details.slice(0), groups = [], current, previous, group, i;
    ordered.sort(function (a, b) { return a.sourceTrackIndex === b.sourceTrackIndex ? a.start - b.start : a.sourceTrackIndex - b.sourceTrackIndex; });
    for (i = 0; i < ordered.length; i++) {
        current = ordered[i]; previous = i ? ordered[i - 1] : null;
        if (group && previous && current.sourceTrackIndex === previous.sourceTrackIndex && prfx.sameBoundary(previous.end, current.start) && prfx.qeTrackHasTransitionAt(qeSequence, kind, current.sourceTrackIndex, current.start)) {
            group.members.push(current); group.end = Math.max(group.end, current.end); group.name = group.members[0].name + ' + ' + current.name;
        } else {
            group = { kind: kind, sourceTrackIndex: current.sourceTrackIndex, start: current.start, end: current.end, name: current.name, members: [current], targetTrackIndex: current.sourceTrackIndex };
            groups.push(group);
        }
    }
    return groups;
};

prfx.qeTrackHasTransitionAt = function (qeSequence, kind, trackIndex, boundary) {
    var track, count, i, transition, transitionType, itemCount, item, itemType;
    try { track = kind === 'audio' ? qeSequence.getAudioTrackAt(trackIndex) : qeSequence.getVideoTrackAt(trackIndex); } catch (trackError) { track = null; }
    if (!track) return false;
    count = Number(track.numTransitions || 0);
    for (i = 0; i < count; i++) {
        try { transition = track.getTransitionAt(i); transitionType = String(transition && transition.type || '').toLowerCase(); } catch (transitionError) { transition = null; transitionType = ''; }
        // QE exposes the empty regions between real transitions through
        // getTransitionAt() as type "Empty". Those spans can cover an entire
        // track and must never connect otherwise independent selected clips.
        if (transition && transitionType.indexOf('transition') !== -1 && prfx.transitionTouchesAnyBoundary(transition, [boundary])) return true;
    }
    itemCount = Number(track.numItems || 0);
    for (i = 0; i < itemCount; i++) {
        try { item = track.getItemAt(i); itemType = String(item && item.type || '').toLowerCase(); } catch (itemError) { item = null; itemType = ''; }
        if (item && itemType.indexOf('transition') !== -1 && prfx.transitionTouchesAnyBoundary(item, [boundary])) return true;
    }
    return false;
};

prfx.moveGroupFits = function (snapshot, group, targetTrackIndex, reservations) {
    var lane = snapshot.tracks[group.kind][targetTrackIndex], i, member, j, interval;
    if (!lane || lane.locked) return false;
    for (i = 0; i < group.members.length; i++) {
        member = group.members[i];
        for (j = 0; j < lane.intervals.length; j++) {
            interval = lane.intervals[j];
            if (!interval.selected && prfx.moveRangesOverlap(member.start, member.end, interval.start, interval.end)) return false;
        }
    }
    for (i = 0; i < reservations.length; i++) {
        interval = reservations[i];
        if (interval.trackIndex === targetTrackIndex && prfx.moveRangesOverlap(group.start, group.end, interval.start, interval.end)) return false;
    }
    return true;
};

prfx.resolveMoveQEClip = function (qeSequence, detail, trackIndex) {
    return prfx.resolveMoveQEClipAt(qeSequence, detail, trackIndex, detail.start, detail.end);
};

prfx.resolveMoveQEClipAt = function (qeSequence, detail, trackIndex, start, end) {
    var track, count, i, clip, type;
    try { track = detail.kind === 'audio' ? qeSequence.getAudioTrackAt(trackIndex) : qeSequence.getVideoTrackAt(trackIndex); } catch (trackError) { track = null; }
    count = track ? Number(track.numItems || 0) : 0;
    for (i = 0; i < count; i++) {
        try { clip = track.getItemAt(i); type = String(clip && clip.type || '').toLowerCase(); } catch (clipError) { clip = null; type = ''; }
        if (!clip || type.indexOf('transition') !== -1 || type.indexOf('empty') !== -1 || typeof clip.moveToTrack !== 'function') continue;
        if (Math.abs(prfx.timeInSeconds(clip.start) - start) < 0.0001 && Math.abs(prfx.timeInSeconds(clip.end) - end) < 0.0001) return clip;
    }
    return null;
};

prfx.undoLastPaletteEffectApply = function () {
    var count = Number(prfx.lastPaletteEffectUndoCount || 0), i;
    if (count < 1) return 'ERROR: No PR FX effect batch is available to undo.';
    try {
        for (i = 0; i < count; i++) app.executeCommand(16);
        prfx.lastPaletteEffectUndoCount = 0;
        return 'Undid PR FX effect apply on ' + count + ' clip' + (count === 1 ? '' : 's') + '.';
    } catch (error) { return 'ERROR: Effect undo failed: ' + error.toString(); }
};

prfx.removeTransitionsAtSelection = function (publicSequence, qeSequence) {
    var selected = publicSequence.getSelection(), boundaries = [], i, clip, kind, start, end;
    for (i = 0; i < selected.length; i++) {
        clip = selected[i]; if (!clip) continue;
        kind = clip.type === 2 ? 'audio' : 'video';
        start = prfx.timeInSeconds(clip.start); end = prfx.timeInSeconds(clip.end);
        if (start >= 0 && end >= 0) { boundaries.push({ kind: kind, trackIndex: Number(clip.parentTrackIndex), time: start }); boundaries.push({ kind: kind, trackIndex: Number(clip.parentTrackIndex), time: end }); }
    }
    return prfx.removeTransitionsAtBoundaries(qeSequence, boundaries);
};

prfx.removeTransitionsAtBoundaries = function (qeSequence, boundaries) {
    var removed = 0, tracks = {}, i, boundary, key, split, track, count, index, transition;
    for (i = 0; i < boundaries.length; i++) { boundary = boundaries[i]; key = boundary.kind + ':' + boundary.trackIndex; if (!tracks[key]) tracks[key] = []; tracks[key].push(boundary.time); }
    for (key in tracks) {
        split = key.split(':'); track = null;
        try { track = split[0] === 'audio' ? qeSequence.getAudioTrackAt(Number(split[1])) : qeSequence.getVideoTrackAt(Number(split[1])); } catch (trackError) {}
        count = track ? Number(track.numTransitions || 0) : 0;
        for (index = count - 1; index >= 0; index--) {
            try { transition = track.getTransitionAt(index); if (transition && prfx.transitionTouchesAnyBoundary(transition, tracks[key])) { transition.remove(); removed++; } } catch (transitionError) {}
        }
    }
    return removed;
};

prfx.transitionTouchesAnyBoundary = function (transition, boundaries) {
    var start = prfx.transitionTime(transition, ['start', 'startTime', 'inPoint']);
    var end = prfx.transitionTime(transition, ['end', 'endTime', 'outPoint']);
    var i, epsilon = 1 / 12;
    for (i = 0; i < boundaries.length; i++) if (Math.abs(start - boundaries[i]) <= epsilon || Math.abs(end - boundaries[i]) <= epsilon || (start >= 0 && end >= 0 && start <= boundaries[i] + epsilon && end >= boundaries[i] - epsilon)) return true;
    return false;
};

prfx.transitionTime = function (transition, fields) {
    var i, value;
    for (i = 0; i < fields.length; i++) { try { value = prfx.timeInSeconds(transition[fields[i]]); if (value >= 0) return value; } catch (ignore) {} }
    return -1;
};

prfx.getSelectedQEClips = function (publicSequence, qeSequence, kind) {
    var publicSelection = publicSequence.getSelection(), qeClips = [], seen = {}, expectedType = kind === 'audio' ? 2 : 1, i, selected, qeTrack, count, j, qeClip, key;
    prfx.lastPublicSelectionCount = publicSelection.length;
    for (i = 0; i < publicSelection.length; i++) {
        selected = publicSelection[i]; if (!selected || (selected.type && selected.type !== expectedType)) continue;
        qeTrack = kind === 'audio' ? qeSequence.getAudioTrackAt(selected.parentTrackIndex) : qeSequence.getVideoTrackAt(selected.parentTrackIndex);
        count = qeTrack ? Number(qeTrack.numItems || 0) : 0;
        for (j = 0; j < count; j++) {
            qeClip = qeTrack.getItemAt(j);
            if (qeClip && prfx.sameTimelineRange(selected, qeClip)) {
                key = String(selected.parentTrackIndex) + ':' + String(prfx.timeInSeconds(qeClip.start)) + ':' + String(prfx.timeInSeconds(qeClip.end));
                if (!seen[key]) { seen[key] = true; qeClips.push(qeClip); }
                break;
            }
        }
    }
    return qeClips;
};

prfx.selectionError = function (kind) { return prfx.lastPublicSelectionCount > 0 ? 'ERROR: Premiere found selected Timeline items, but could not resolve a compatible ' + kind + ' clip.' : 'ERROR: No selected ' + kind + ' clips found in the active sequence.'; };
prfx.sameTimelineRange = function (publicClip, qeClip) { try { return Math.abs(prfx.timeInSeconds(publicClip.start) - prfx.timeInSeconds(qeClip.start)) < 0.0001 && Math.abs(prfx.timeInSeconds(publicClip.end) - prfx.timeInSeconds(qeClip.end)) < 0.0001; } catch (error) { return false; } };
prfx.timeInSeconds = function (time) { if (typeof time === 'number') return time; if (time && time.seconds !== undefined) return Number(time.seconds); if (time && time.ticks !== undefined) return Number(time.ticks) / 254016000000; return -999999; };
prfx.timeTicks = function (time) { try { return String(time.ticks); } catch (error) { return ''; } };
prfx.framesToTimecode = function (frames) { var seconds = Math.floor(frames / 30), remainder = frames % 30; return '00:00:' + (seconds < 10 ? '0' : '') + seconds + ':' + (remainder < 10 ? '0' : '') + remainder; };
