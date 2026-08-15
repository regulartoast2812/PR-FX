/* global app, qe */
// PR FX Timeline Core
//
// This module is deliberately self-contained. It is based on the transaction
// pattern used by the local reference tool, but it does not load, call, or
// share state with that tool at runtime.
var prfxTimeline = prfxTimeline || {};
prfxTimeline.BUILD = '20260813-transaction-core-1';

prfxTimeline.timeSeconds = function (value) {
    var numeric;
    try {
        if (value === undefined || value === null) return -999999;
        if (value.seconds !== undefined) return Number(value.seconds);
        if (value.secs !== undefined) return Number(value.secs);
        if (value.ticks !== undefined) return Number(value.ticks) / 254016000000;
        numeric = Number(value);
        if (!isNaN(numeric)) return Math.abs(numeric) > 10000000 ? numeric / 254016000000 : numeric;
    } catch (error) {}
    return -999999;
};

prfxTimeline.ticks = function (value) {
    try { return value && value.ticks !== undefined ? String(value.ticks) : ''; } catch (error) { return ''; }
};

prfxTimeline.publicTrackAt = function (sequence, mediaType, trackIndex) {
    try {
        if (!sequence || trackIndex < 0) return null;
        return mediaType === 'audio' ? sequence.audioTracks[trackIndex] : sequence.videoTracks[trackIndex];
    } catch (error) { return null; }
};

prfxTimeline.trackItemCount = function (track) {
    try { return track && track.clips && track.clips.numItems !== undefined ? Number(track.clips.numItems) || 0 : 0; } catch (error) { return 0; }
};

prfxTimeline.trackItemAt = function (track, index) {
    try { return track && track.clips ? track.clips[index] : null; } catch (error) { return null; }
};

prfxTimeline.trackLocked = function (track) {
    var value;
    try {
        if (track && track.isLocked) {
            value = track.isLocked();
            return value === true || Number(value) === 1;
        }
    } catch (error) {}
    return false;
};

prfxTimeline.rangesOverlap = function (startA, endA, startB, endB) {
    return startA < endB - 0.000001 && endA > startB + 0.000001;
};

prfxTimeline.sequenceIdentity = function (sequence) {
    try {
        if (!sequence) return '';
        if (sequence.sequenceID !== undefined) return 'sequence:' + String(sequence.sequenceID);
        if (sequence.projectItem && sequence.projectItem.nodeId !== undefined) return 'node:' + String(sequence.projectItem.nodeId);
    } catch (error) {}
    return '';
};

prfxTimeline.activeSequenceStillMatches = function (sequence) {
    var active = app.project && app.project.activeSequence;
    var expectedID = prfxTimeline.sequenceIdentity(sequence);
    var activeID = prfxTimeline.sequenceIdentity(active);
    return sequence === active || (!!expectedID && expectedID === activeID);
};

prfxTimeline.detailForItem = function (mediaType, trackIndex, clipIndex, item) {
    return {
        mediaType: mediaType,
        trackIndex: trackIndex,
        originalTrackIndex: trackIndex,
        clipIndex: clipIndex,
        name: String(item.name || 'Timeline clip'),
        start: prfxTimeline.timeSeconds(item.start),
        end: prfxTimeline.timeSeconds(item.end),
        startTicks: prfxTimeline.ticks(item.start),
        endTicks: prfxTimeline.ticks(item.end),
        item: item,
        targetTrackIndex: trackIndex
    };
};

prfxTimeline.snapshot = function (sequence) {
    var output = { video: [], audio: [], selected: [], tracks: { video: [], audio: [] } };
    var mediaTypes = ['video', 'audio'];
    var mediaType;
    var tracks;
    var trackIndex;
    var clipIndex;
    var track;
    var item;
    var interval;
    var selected;
    for (var typeIndex = 0; typeIndex < mediaTypes.length; typeIndex++) {
        mediaType = mediaTypes[typeIndex];
        tracks = mediaType === 'audio' ? sequence.audioTracks : sequence.videoTracks;
        for (trackIndex = 0; trackIndex < tracks.numTracks; trackIndex++) {
            track = prfxTimeline.publicTrackAt(sequence, mediaType, trackIndex);
            output.tracks[mediaType][trackIndex] = { locked: !track || prfxTimeline.trackLocked(track), intervals: [] };
            if (!track) continue;
            for (clipIndex = 0; clipIndex < prfxTimeline.trackItemCount(track); clipIndex++) {
                item = prfxTimeline.trackItemAt(track, clipIndex);
                if (!item) { output.tracks[mediaType][trackIndex].locked = true; continue; }
                interval = { start: prfxTimeline.timeSeconds(item.start), end: prfxTimeline.timeSeconds(item.end), item: item, selected: false };
                if (!(interval.end > interval.start)) { output.tracks[mediaType][trackIndex].locked = true; continue; }
                try { selected = item.isSelected && item.isSelected() === true; } catch (error) { selected = false; }
                interval.selected = selected;
                output.tracks[mediaType][trackIndex].intervals.push(interval);
                if (selected) {
                    item = prfxTimeline.detailForItem(mediaType, trackIndex, clipIndex, item);
                    output[mediaType].push(item);
                    output.selected.push(item);
                }
            }
        }
    }
    return output;
};

prfxTimeline.destinationIsFree = function (snapshot, detail, targetTrackIndex, reservations) {
    var lane = snapshot.tracks[detail.mediaType][targetTrackIndex];
    var intervals;
    var index;
    if (!lane || lane.locked) return false;
    intervals = lane.intervals;
    for (index = 0; index < intervals.length; index++) {
        if (intervals[index].selected) continue;
        if (prfxTimeline.rangesOverlap(detail.start, detail.end, intervals[index].start, intervals[index].end)) return false;
    }
    for (index = 0; index < reservations.length; index++) {
        if (reservations[index].trackIndex === targetTrackIndex &&
            prfxTimeline.rangesOverlap(detail.start, detail.end, reservations[index].start, reservations[index].end)) return false;
    }
    return true;
};

prfxTimeline.planVerticalMove = function (snapshot, mediaType, direction) {
    var selected = snapshot[mediaType];
    var trackCount = snapshot.tracks[mediaType].length;
    var reservations = [];
    var targetTrackIndex;
    var index;
    var detail;
    if (!selected.length) return { ok: false, message: 'Select one or more ' + mediaType + ' clips first.' };
    for (index = 0; index < selected.length; index++) {
        detail = selected[index];
        targetTrackIndex = detail.trackIndex + direction;
        if (targetTrackIndex < 0 || targetTrackIndex >= trackCount) {
            return { ok: false, message: 'No destination ' + (mediaType === 'video' ? 'video' : 'audio') + ' track exists for the complete selection.' };
        }
        if (!prfxTimeline.destinationIsFree(snapshot, detail, targetTrackIndex, reservations)) {
            return { ok: false, message: 'The destination track is occupied or locked. Nothing was moved.' };
        }
        detail.targetTrackIndex = targetTrackIndex;
        reservations.push({ trackIndex: targetTrackIndex, start: detail.start, end: detail.end });
    }
    return { ok: true, details: selected };
};

prfxTimeline.qeValue = function (item, property) {
    try {
        if (!item) return null;
        var value = item[property];
        return value === undefined ? null : value;
    } catch (error) { return null; }
};

prfxTimeline.qeTrackAt = function (sequence, mediaType, trackIndex) {
    try { return mediaType === 'audio' ? sequence.getAudioTrackAt(trackIndex) : sequence.getVideoTrackAt(trackIndex); } catch (error) { return null; }
};

prfxTimeline.qeTrackItemCount = function (track) {
    try { return track && track.numItems !== undefined ? Number(track.numItems) || 0 : 0; } catch (error) { return 0; }
};

prfxTimeline.qeTrackItemAt = function (track, index) {
    try { return track && track.getItemAt ? track.getItemAt(index) : null; } catch (error) { return null; }
};

prfxTimeline.qeTimeSeconds = function (value) { return prfxTimeline.timeSeconds(value); };
prfxTimeline.qeTimeTicks = function (value) { return prfxTimeline.ticks(value); };

prfxTimeline.qeClipIsMovable = function (item) {
    var itemType = prfxTimeline.qeValue(item, 'type');
    itemType = itemType === null ? '' : String(itemType).toLowerCase();
    if (!item || itemType.indexOf('transition') !== -1 || itemType.indexOf('empty') !== -1) return false;
    return prfxTimeline.qeValue(item, 'moveToTrack') !== null;
};

prfxTimeline.qeClipMatches = function (sequence, item, detail) {
    var startTicks = prfxTimeline.qeTimeTicks(prfxTimeline.qeValue(item, 'start'));
    var endTicks = prfxTimeline.qeTimeTicks(prfxTimeline.qeValue(item, 'end'));
    var start = prfxTimeline.qeTimeSeconds(prfxTimeline.qeValue(item, 'start'));
    var end = prfxTimeline.qeTimeSeconds(prfxTimeline.qeValue(item, 'end'));
    var epsilon = 0.0001;
    try {
        if (sequence.timebase) {
            var frame = new Time();
            frame.ticks = String(sequence.timebase);
            epsilon = Math.max(epsilon, Number(frame.seconds) * 0.6);
        }
    } catch (error) {}
    if (detail.startTicks && detail.endTicks && startTicks === detail.startTicks && endTicks === detail.endTicks) return true;
    return Math.abs(start - detail.start) < epsilon && Math.abs(end - detail.end) < epsilon;
};

prfxTimeline.resolveQeClip = function (sequence, detail, qeSequence) {
    var track = prfxTimeline.qeTrackAt(qeSequence, detail.mediaType, detail.trackIndex);
    var count = prfxTimeline.qeTrackItemCount(track);
    var item;
    for (var index = 0; index < count; index++) {
        item = prfxTimeline.qeTrackItemAt(track, index);
        if (prfxTimeline.qeClipIsMovable(item) && prfxTimeline.qeClipMatches(sequence, item, detail)) return item;
    }
    return null;
};

prfxTimeline.freshQeClip = function (sequence, detail) {
    var qeSequence;
    try {
        if (!prfxTimeline.activeSequenceStillMatches(sequence)) return null;
        app.enableQE();
        qeSequence = qe.project.getActiveSequence();
        if (!qeSequence) return null;
        return prfxTimeline.resolveQeClip(sequence, detail, qeSequence);
    } catch (error) { return null; }
};

prfxTimeline.preflightQe = function (sequence, details) {
    var qeSequence;
    var index;
    try {
        app.enableQE();
        qeSequence = qe.project.getActiveSequence();
    } catch (error) { qeSequence = null; }
    if (!qeSequence) return { ok: false, message: 'Premiere did not expose the Timeline engine.' };
    for (index = 0; index < details.length; index++) {
        if (!prfxTimeline.resolveQeClip(sequence, details[index], qeSequence)) {
            return { ok: false, message: 'Could not resolve every selected clip before moving anything.' };
        }
    }
    return { ok: true };
};

prfxTimeline.sortMoveOrder = function (details, direction) {
    details.sort(function (a, b) {
        return direction > 0 ? b.trackIndex - a.trackIndex || b.clipIndex - a.clipIndex : a.trackIndex - b.trackIndex || a.clipIndex - b.clipIndex;
    });
};

prfxTimeline.rollback = function (sequence, moved) {
    var restored = 0;
    var detail;
    var clip;
    var index;
    var result;
    for (index = moved.length - 1; index >= 0; index--) {
        detail = moved[index];
        clip = prfxTimeline.freshQeClip(sequence, detail);
        if (!clip) continue;
        try {
            result = detail.mediaType === 'audio' ? clip.moveToTrack(0, detail.originalTrackIndex - detail.trackIndex, '00:00:00:00', 0) : clip.moveToTrack(detail.originalTrackIndex - detail.trackIndex, 0, '00:00:00:00', 0);
            if (result !== false) { detail.trackIndex = detail.originalTrackIndex; restored++; }
        } catch (error) {}
    }
    return restored;
};

prfxTimeline.moveSelectionByMajority = function (moveUp) {
    var sequence = app.project && app.project.activeSequence;
    var snapshot;
    var mediaType;
    var direction;
    var plan;
    var details;
    var moved = [];
    var detail;
    var clip;
    var result;
    var index;
    if (!sequence) return 'ERROR: Open a sequence and select clips first.';
    snapshot = prfxTimeline.snapshot(sequence);
    if (!snapshot.selected.length) return 'ERROR: Select one or more Timeline clips first.';
    if (snapshot.video.length === snapshot.audio.length) return 'ERROR: Move Selection needs a clear video or audio majority.';
    mediaType = snapshot.video.length > snapshot.audio.length ? 'video' : 'audio';
    // Video indexes rise upward. Audio indexes rise downward.
    direction = mediaType === 'video' ? (moveUp ? 1 : -1) : (moveUp ? -1 : 1);
    plan = prfxTimeline.planVerticalMove(snapshot, mediaType, direction);
    if (!plan.ok) return 'ERROR: ' + plan.message;
    details = plan.details;
    plan = prfxTimeline.preflightQe(sequence, details);
    if (!plan.ok) return 'ERROR: ' + plan.message;
    prfxTimeline.sortMoveOrder(details, direction);
    try {
        for (index = 0; index < details.length; index++) {
            detail = details[index];
            clip = prfxTimeline.freshQeClip(sequence, detail);
            if (!clip) throw new Error('Could not resolve ' + detail.name + ' immediately before moving it.');
            result = detail.mediaType === 'audio' ? clip.moveToTrack(0, detail.targetTrackIndex - detail.trackIndex, '00:00:00:00', 0) : clip.moveToTrack(detail.targetTrackIndex - detail.trackIndex, 0, '00:00:00:00', 0);
            if (result === false) throw new Error('Premiere rejected the move.');
            detail.trackIndex = detail.targetTrackIndex;
            moved.push(detail);
        }
        try { if (app.refresh) app.refresh(); } catch (ignore) {}
        return 'Moved ' + moved.length + ' selected ' + mediaType + ' clip' + (moved.length === 1 ? '' : 's') + ' ' + (moveUp ? 'up' : 'down') + '.';
    } catch (error) {
        var restored = prfxTimeline.rollback(sequence, moved);
        return 'ERROR: Move stopped safely after ' + moved.length + ' edit' + (moved.length === 1 ? '' : 's') + '; restored ' + restored + ': ' + error.toString();
    }
};
