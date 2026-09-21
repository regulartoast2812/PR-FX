/* global app, qe */
var prfx = prfx || {};
// This host intentionally contains only PR FX's native palette operations.
// Ported timeline functions are not loaded or dispatched from this extension.
prfx.HOST_BUILD = '20260916-hide-system-1';
// $.fileName reports the file being evaluated RIGHT NOW. Read inside a function
// that runs later -- called from an evalScript wrapper -- it reports that
// wrapper, not host.jsx, and the extension folder cannot be found. Capture it
// here, at load time, while this file is still the active script.
prfx.HOST_FILE = (function () { try { return String($.fileName); } catch (error) { return ''; } })();
// app.js knows the extension folder for certain and passes it to getCatalog;
// that value wins when present.
if (prfx.EXTENSION_ROOT === undefined) prfx.EXTENSION_ROOT = '';
if (prfx.lastPaletteEffectUndoCount === undefined) prfx.lastPaletteEffectUndoCount = 0;

// Reports the build that is RUNNING versus the build sitting on disk.
//
// The panel cannot detect its own staleness -- a cached app.js sends the old
// stamp, which matches the old host still in the engine, so the reload check
// passes and both halves agree while both are wrong. Reading host.jsx off disk
// from inside the running host is the one comparison that cannot be fooled.
prfx.buildStatus = function (extensionRoot) {
    var root = extensionRoot ? new Folder(String(extensionRoot)) : prfx.extensionRoot();
    var file, text = '', onDisk = '', marker = 'prfx.HOST_BUILD', start, quote, stop;
    if (extensionRoot) prfx.EXTENSION_ROOT = String(extensionRoot);
    try {
        file = new File(root.fsName + '/jsx/host.jsx');
        if (!file.exists) return '{"loaded":"' + prfx.HOST_BUILD + '","onDisk":"","error":"host.jsx not found"}';
        file.encoding = 'UTF-8';
        file.open('r');
        text = file.read(4096);
        file.close();
    } catch (readError) {
        return '{"loaded":"' + prfx.HOST_BUILD + '","onDisk":"","error":"could not read host.jsx"}';
    }
    start = text.indexOf(marker);
    if (start >= 0) {
        quote = text.indexOf("'", start);
        stop = quote >= 0 ? text.indexOf("'", quote + 1) : -1;
        if (quote >= 0 && stop > quote) onDisk = text.substring(quote + 1, stop);
    }
    return '{"loaded":"' + prfx.HOST_BUILD + '","onDisk":"' + onDisk + '"}';
};

prfx.getCatalog = function (extensionRoot) {
    try {
        if (extensionRoot) prfx.EXTENSION_ROOT = String(extensionRoot);
        app.enableQE();
        var catalog = [];
        prfx.safeAppendUserPresetCatalog(catalog);
        prfx.safeAppendCatalog(catalog, 'effect', 'getVideoEffectList');
        prfx.safeAppendCatalog(catalog, 'audio-effect', 'getAudioEffectList');
        prfx.safeAppendCatalog(catalog, 'transition', 'getVideoTransitionList');
        prfx.safeAppendCatalog(catalog, 'audio-transition', 'getAudioTransitionList');
        return catalog.length ? JSON.stringify(catalog) : 'ERROR: Premiere returned an empty Effects catalog.';
    } catch (error) {
        return 'ERROR: Could not read Premiere\'s Effects catalog: ' + error.toString();
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

prfx.safeAppendUserPresetCatalog = function (target) {
    var files = prfx.userPresetFiles(), seen = {}, presets = [], i, j, parsed, item, key;
    try {
        for (i = 0; i < files.length; i++) {
            parsed = prfx.parseUserPresetFile(files[i]);
            for (j = 0; j < parsed.length; j++) {
                item = parsed[j];
                key = item.uid ? ('uid:' + item.uid) : ('name:' + item.name.toLowerCase());
                if (seen[key]) continue;
                seen[key] = true;
                presets.push({ type: 'preset', name: item.name, presetUid: item.uid || '', transitionFrames: 30 });
            }
        }
        presets.sort(function (a, b) {
            var an = a.name.toLowerCase(), bn = b.name.toLowerCase();
            return an < bn ? -1 : (an > bn ? 1 : 0);
        });
        for (i = 0; i < presets.length; i++) target.push(presets[i]);
    } catch (ignore) {}
};

prfx.userPresetFiles = function () {
    var files = [], seen = {};
    function addFile(file) {
        var key;
        if (!file) return;
        try {
            file = file instanceof File ? file : new File(String(file));
            key = file.fsName;
            if (file.exists && !seen[key]) { seen[key] = true; files.push(file); }
        } catch (ignore) {}
    }
    function addProfileFolder(folder) {
        if (!folder) return;
        try {
            folder = folder instanceof Folder ? folder : new Folder(String(folder));
            if (!folder.exists) return;
            addFile(new File(folder.fsName + '/Effect Presets and Custom Items.prfpset'));
        } catch (ignore) {}
    }
    function scanPremiereRoot(root) {
        var versions, i, profiles, j;
        try {
            root = root instanceof Folder ? root : new Folder(String(root));
            if (!root.exists) return;
            versions = root.getFiles(function (entry) { return entry instanceof Folder; });
            for (i = 0; i < versions.length; i++) {
                profiles = versions[i].getFiles(function (entry) { return entry instanceof Folder && /^Profile-/i.test(entry.name); });
                for (j = 0; j < profiles.length; j++) addProfileFolder(profiles[j]);
            }
        } catch (ignore) {}
    }

    try { if (app.getPProPrefPath) addProfileFolder(app.getPProPrefPath()); } catch (ignore) {}
    try { scanPremiereRoot(new Folder(Folder.myDocuments.fsName + '/Adobe/Premiere Pro')); } catch (ignore) {}
    try { scanPremiereRoot(new Folder(Folder.myDocuments.fsName + '/Adobe/Premiere Pro (Beta)')); } catch (ignore) {}
    return files;
};

prfx.xmlText = function (value) {
    return String(value || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/^\s+|\s+$/g, '');
};

prfx.parseUserPresetFile = function (file) {
    var out = [], text = '', uidOpen = '<MZ.EffectPresets.PresetUID>', uidClose = '</MZ.EffectPresets.PresetUID>';
    var index = 0, uidStart, uidEnd, uid, prefix, nameStart, nameEnd, name;
    try {
        file.encoding = 'UTF-8';
        if (!file.open('r')) return out;
        text = file.read();
        file.close();
    } catch (readError) {
        try { file.close(); } catch (closeError) {}
        return out;
    }
    while ((uidStart = text.indexOf(uidOpen, index)) >= 0) {
        uidEnd = text.indexOf(uidClose, uidStart + uidOpen.length);
        if (uidEnd < 0) break;
        uid = prfx.xmlText(text.substring(uidStart + uidOpen.length, uidEnd));
        prefix = text.substring(Math.max(0, uidStart - 5000), uidStart);
        nameStart = prefix.lastIndexOf('<Name>');
        nameEnd = nameStart >= 0 ? prefix.indexOf('</Name>', nameStart + 6) : -1;
        name = nameStart >= 0 && nameEnd > nameStart ? prfx.xmlText(prefix.substring(nameStart + 6, nameEnd)) : '';
        if (name && name !== 'Root' && name !== 'Presets') out.push({ name: name, uid: uid });
        index = uidEnd + uidClose.length;
    }
    return out;
};

prfx.readTextFile = function (file) {
    var text = '';
    try {
        file = file instanceof File ? file : new File(String(file));
        if (!file.exists) return '';
        file.encoding = 'UTF-8';
        if (!file.open('r')) return '';
        text = file.read();
        file.close();
    } catch (error) {
        try { file.close(); } catch (closeError) {}
        text = '';
    }
    return text;
};

prfx.failureLogFolder = function () {
    var folder = null;
    try {
        if (Folder.userData) folder = new Folder(Folder.userData.fsName + '/PR FX Palette');
    } catch (userDataError) { folder = null; }
    if (!folder) {
        try { folder = new Folder(Folder.myDocuments.parent.fsName + '/Library/Application Support/PR FX Palette'); }
        catch (homeError) { folder = null; }
    }
    if (!folder) {
        try { folder = new Folder(Folder.temp.fsName + '/PR FX Palette'); }
        catch (tempError) { folder = null; }
    }
    try { if (folder && !folder.exists) folder.create(); } catch (createError) {}
    return folder;
};

prfx.failureLogPath = function () {
    var folder = prfx.failureLogFolder();
    return folder ? (folder.fsName + '/failure-log.jsonl') : '';
};

prfx.toPlainError = function (error) {
    var out = {};
    try { out.message = error && error.message ? String(error.message) : String(error); } catch (messageError) { out.message = 'Unknown error'; }
    try { if (error && error.line) out.line = Number(error.line); } catch (lineError) {}
    try { if (error && error.fileName) out.fileName = String(error.fileName); } catch (fileError) {}
    try { if (error && error.stack) out.stack = String(error.stack); } catch (stackError) {}
    return out;
};

prfx.logFileShortPath = function (path) {
    var value = String(path || '');
    try {
        if (Folder.myDocuments && Folder.myDocuments.parent && value.indexOf(Folder.myDocuments.parent.fsName) === 0) {
            return '~' + value.substring(Folder.myDocuments.parent.fsName.length);
        }
    } catch (error) {}
    return value;
};

prfx.writeFailureLog = function (entry) {
    var path = prfx.failureLogPath(), file, line;
    if (!path) return '';
    try {
        entry = entry || {};
        entry.at = (new Date()).toUTCString();
        entry.hostBuild = prfx.HOST_BUILD;
        line = JSON.stringify(entry);
        file = new File(path);
        file.encoding = 'UTF-8';
        if (!file.open('a')) return '';
        file.writeln(line);
        file.close();
        return path;
    } catch (error) {
        try { if (file) file.close(); } catch (closeError) {}
        return '';
    }
};

prfx.replaceLogTarget = function (detail) {
    if (!detail) return null;
    return {
        name: String(detail.name || detail.projectItemName || ''),
        projectItemName: String(detail.projectItemName || ''),
        extension: String(detail.projectItemExtension || ''),
        kind: String(detail.kind || ''),
        trackIndex: detail.sourceTrackIndex !== undefined ? Number(detail.sourceTrackIndex) + 1 : (detail.trackIndex !== undefined ? Number(detail.trackIndex) + 1 : null),
        start: detail.start,
        end: detail.end,
        duration: detail.end !== undefined && detail.start !== undefined ? Number(detail.end) - Number(detail.start) : null
    };
};

prfx.replaceLogSource = function (source) {
    if (!source) return null;
    return {
        name: String(source.name || ''),
        path: prfx.projectItemPath(source),
        extension: prfx.projectItemExtension(source),
        mediaCategory: prfx.mediaCategoryOf(prfx.projectItemExtension(source))
    };
};

prfx.escapeRegex = function (value) {
    return String(value || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
};

prfx.xmlTagValue = function (block, tagName) {
    var match;
    try {
        match = new RegExp('<' + prfx.escapeRegex(tagName) + '[^>]*>([\\s\\S]*?)<\\/' + prfx.escapeRegex(tagName) + '>', '').exec(String(block || ''));
        return match ? prfx.xmlText(match[1]) : '';
    } catch (error) { return ''; }
};

prfx.xmlObjectById = function (text, tagName, objectId) {
    var match;
    try {
        match = new RegExp('<' + prfx.escapeRegex(tagName) + '\\b[^>]*\\bObjectID="' + prfx.escapeRegex(objectId) + '"[^>]*>[\\s\\S]*?<\\/' + prfx.escapeRegex(tagName) + '>', '').exec(String(text || ''));
        return match ? match[0] : '';
    } catch (error) { return ''; }
};

prfx.xmlObjectAnyById = function (text, tagNames, objectId) {
    var i, block;
    for (i = 0; i < tagNames.length; i++) {
        block = prfx.xmlObjectById(text, tagNames[i], objectId);
        if (block) return { tagName: tagNames[i], block: block };
    }
    return { tagName: '', block: '' };
};

prfx.xmlObjectRefs = function (block, tagName) {
    var refs = [], re, match;
    try {
        re = new RegExp('<' + prfx.escapeRegex(tagName) + '\\b[^>]*\\bObjectRef="([^"]+)"[^>]*\\/?>', 'g');
        while ((match = re.exec(String(block || ''))) !== null) refs.push(match[1]);
    } catch (error) {}
    return refs;
};

prfx.xmlObjectRefEntries = function (block, tagName) {
    var refs = [], re, match, tag, indexMatch, indexValue;
    try {
        re = new RegExp('<' + prfx.escapeRegex(tagName) + '\\b[^>]*\\bObjectRef="([^"]+)"[^>]*\\/?>', 'g');
        while ((match = re.exec(String(block || ''))) !== null) {
            tag = match[0];
            indexMatch = /\bIndex="([^"]+)"/.exec(tag);
            indexValue = indexMatch ? Number(indexMatch[1]) : NaN;
            refs.push({ ref: match[1], index: indexValue });
        }
    } catch (error) {}
    return refs;
};

prfx.parsePresetValue = function (raw) {
    var value = prfx.xmlText(raw), parts, out, i, token, number;
    if (value === '') return null;
    if (/^(true|false)$/i.test(value)) return /^true$/i.test(value);
    if (value.indexOf(',') >= 0) {
        parts = value.split(',');
        out = [];
        for (i = 0; i < parts.length; i++) {
            token = prfx.xmlText(parts[i]);
            if (token === '') continue;
            if (/^(true|false)$/i.test(token)) out.push(/^true$/i.test(token));
            else {
                number = Number(token);
                if (isNaN(number)) return null;
                out.push(number);
            }
        }
        return out.length ? out : null;
    }
    number = Number(value);
    if (!isNaN(number)) return number;
    return null;
};

prfx.parsePresetStartValue = function (raw) {
    var parts = prfx.xmlText(raw).split(',');
    if (parts.length < 2) return null;
    return prfx.parsePresetValue(parts[1]);
};

prfx.presetValueWithinBounds = function (value, lower, upper) {
    if (typeof value !== 'number') return true;
    if (typeof lower === 'number' && !isNaN(lower) && value < lower - 0.0001) return false;
    if (typeof upper === 'number' && !isNaN(upper) && value > upper + 0.0001) return false;
    return true;
};

prfx.selectPresetParamValue = function (paramBlock, currentRaw) {
    var currentValue = prfx.parsePresetValue(currentRaw);
    var startValue = prfx.parsePresetStartValue(prfx.xmlTagValue(paramBlock, 'StartKeyframe'));
    var lower = prfx.parsePresetValue(prfx.xmlTagValue(paramBlock, 'LowerBound'));
    var upper = prfx.parsePresetValue(prfx.xmlTagValue(paramBlock, 'UpperBound'));
    if (currentValue !== null && prfx.presetValueWithinBounds(currentValue, lower, upper)) return currentValue;
    if (startValue !== null && prfx.presetValueWithinBounds(startValue, lower, upper)) return startValue;
    return currentValue;
};

prfx.parsePresetKeyframes = function (raw) {
    var out = [], rows = String(raw || '').split(';'), i, parts, ticks, value;
    for (i = 0; i < rows.length; i++) {
        if (!rows[i]) continue;
        parts = rows[i].split(',');
        if (parts.length < 2) continue;
        ticks = Number(prfx.xmlText(parts[0]));
        value = prfx.parsePresetValue(parts[1]);
        if (isNaN(ticks) || value === null || !prfx.isSimpleMockPresetValue(value)) continue;
        out.push({ ticks: ticks, value: value });
    }
    out.sort(function (a, b) { return a.ticks - b.ticks; });
    return out;
};

prfx.isMockPresetMetaParam = function (name) {
    var normalized = prfx.normalizedPresetLabel(name);
    if (!normalized) return true;
    if (normalized.indexOf('unused') === 0) return true;
    if (normalized.charAt(0) === '_') return true;
    return {
        erroroccurred: true,
        warning: true,
        pluginpresets: true,
        effecttiming: true,
        units: true,
        startoffset: true,
        enableduration: true,
        duration: true,
        controls: true,
        pretransform: true,
        applyprescale: true,
        visualcurveeditor: true,
        motioncontrols: true,
        motionblurengine: true,
        overlaymode: true,
        overlayinfo: true,
        overlayenabled: true,
        appliedversion: true,
        sequencewidth: true,
        sequenceheight: true,
        sequencepixelratio: true
    }[normalized] === true;
};

prfx.findUserPresetTreeBlock = function (text, command) {
    var uid = String(command && command.presetUid || ''), name = String(command && command.name || '');
    var index = -1, uidOpen, uidClose, namePattern, match, start, end;
    if (uid) {
        uidOpen = '<MZ.EffectPresets.PresetUID>';
        uidClose = '</MZ.EffectPresets.PresetUID>';
        index = String(text || '').indexOf(uidOpen + uid + uidClose);
    }
    if (index < 0 && name) {
        try {
            namePattern = new RegExp('<Name>\\s*' + prfx.escapeRegex(name) + '\\s*<\\/Name>');
            match = namePattern.exec(String(text || ''));
            if (match) index = match.index;
        } catch (nameError) {}
    }
    if (index < 0) return '';
    start = String(text || '').lastIndexOf('<TreeItem', index);
    end = String(text || '').indexOf('</TreeItem>', index);
    if (start < 0 || end < start) return '';
    return String(text || '').substring(start, end + 11);
};

prfx.readUserPresetData = function (command) {
    var files = prfx.userPresetFiles(), f, text, tree, dataRef, itemBlock, presetRefs, presets = [];
    var i, j, presetBlock, filterMatchName, componentRef, componentObject, componentBlock, componentTag, displayName, matchName, kind;
    var paramRefs, params, unsupportedParams, privateParams, hasPrivateData, p, paramObject, paramBlock, rawValue, parsedValue, paramName, keyframeText, keyframes, hasKeyframes, isVarying;
    for (f = 0; f < files.length; f++) {
        text = prfx.readTextFile(files[f]);
        if (!text) continue;
        tree = prfx.findUserPresetTreeBlock(text, command);
        if (!tree) continue;
        dataRef = prfx.xmlObjectRefs(tree, 'Data')[0] || '';
        itemBlock = dataRef ? prfx.xmlObjectById(text, 'FilterPresetItem', dataRef) : '';
        if (!itemBlock) continue;
        presetRefs = prfx.xmlObjectRefs(itemBlock, 'FilterPreset');
        for (i = 0; i < presetRefs.length; i++) {
            presetBlock = prfx.xmlObjectById(text, 'FilterPreset', presetRefs[i]);
            if (!presetBlock) continue;
            filterMatchName = prfx.xmlTagValue(presetBlock, 'FilterMatchName');
            componentRef = prfx.xmlObjectRefs(presetBlock, 'Component')[0] || '';
            componentObject = componentRef ? prfx.xmlObjectAnyById(text, ['VideoFilterComponent', 'AudioFilterComponent'], componentRef) : { tagName: '', block: '' };
            componentBlock = componentObject.block;
            componentTag = componentObject.tagName;
            if (!componentBlock) continue;
            kind = componentTag === 'AudioFilterComponent' ? 'audio' : 'video';
            displayName = prfx.xmlTagValue(componentBlock, 'DisplayName') || String(command.name || '');
            matchName = prfx.xmlTagValue(componentBlock, 'MatchName') || filterMatchName;
            paramRefs = prfx.xmlObjectRefEntries(componentBlock, 'Param');
            params = [];
            unsupportedParams = 0;
            privateParams = componentBlock.indexOf('<PremiereFilterPrivateData') >= 0 ? 1 : 0;
            hasPrivateData = privateParams > 0;
            for (j = 0; j < paramRefs.length; j++) {
                paramObject = prfx.xmlObjectAnyById(text, ['VideoComponentParam', 'AudioComponentParam', 'ArbVideoComponentParam', 'ArbAudioComponentParam'], paramRefs[j].ref);
                paramBlock = paramObject.block;
                if (!paramBlock) continue;
                if (paramObject.tagName === 'ArbVideoComponentParam' || paramObject.tagName === 'ArbAudioComponentParam') {
                    unsupportedParams++;
                    continue;
                }
                paramName = prfx.xmlTagValue(paramBlock, 'Name');
                rawValue = prfx.xmlTagValue(paramBlock, 'CurrentValue');
                keyframeText = prfx.xmlTagValue(paramBlock, 'Keyframes');
                keyframes = prfx.parsePresetKeyframes(keyframeText);
                hasKeyframes = keyframeText !== '';
                isVarying = /^true$/i.test(prfx.xmlTagValue(paramBlock, 'IsTimeVarying'));
                parsedValue = prfx.selectPresetParamValue(paramBlock, rawValue);
                if (!paramName || prfx.isMockPresetMetaParam(paramName) || parsedValue === null) {
                    unsupportedParams++;
                    continue;
                }
                if (hasKeyframes || isVarying) {
                    if (!keyframes.length) {
                        unsupportedParams++;
                        continue;
                    }
                    params.push({ name: paramName, index: paramRefs[j].index, value: parsedValue, keyframes: keyframes });
                } else {
                    params.push({ name: paramName, index: paramRefs[j].index, value: parsedValue });
                }
            }
            presets.push({
                kind: kind,
                displayName: displayName,
                matchName: matchName,
                params: params,
                unsupportedParams: unsupportedParams,
                privateParams: privateParams,
                hasPrivateData: hasPrivateData
            });
        }
        if (presets.length) return { name: String(command.name || ''), file: files[f].fsName, effects: presets };
    }
    return null;
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

// Registry of PR FX custom functions. Adding a function means adding one entry
// here; prfx.apply itself never needs another branch. Set needsSequence to
// false only for functions that do not touch the active sequence - those run
// before the sequence guard and before lastPaletteEffectUndoCount is cleared.
prfx.functions = {
    'undo-last-palette-action': { needsSequence: false, run: function () {
        return prfx.undoLastPaletteEffectApply();
    } },
    'remove-transitions': { run: function (publicSequence, qeSequence) {
        var removed = prfx.removeTransitionsAtSelection(publicSequence, qeSequence);
        return 'Removed ' + removed + ' transition' + (removed === 1 ? '' : 's') + ' from selected clips.';
    } },
    'move-selected-clips-up': { run: function (publicSequence, qeSequence, command) {
        return prfx.moveSelectedClipsUp(publicSequence, qeSequence, String(command.moveMode || 'group'));
    } },
    'move-selected-clips-down': { run: function (publicSequence, qeSequence, command) {
        return prfx.moveSelectedClipsDown(publicSequence, qeSequence, String(command.moveMode || 'group'));
    } },
    'pull-group-in': { run: function (publicSequence, qeSequence) {
        return prfx.pullSelectedGroupToPlayhead(publicSequence, qeSequence, false);
    } },
    'pull-group-out': { run: function (publicSequence, qeSequence) {
        return prfx.pullSelectedGroupToPlayhead(publicSequence, qeSequence, true);
    } },
    'stretch-speed-to-playhead': { run: function (publicSequence, qeSequence) {
        return prfx.stretchSelectedSpeedToPlayhead(publicSequence, qeSequence, 'stretch');
    } },
    'retract-speed-in-to-playhead': { run: function (publicSequence, qeSequence) {
        return prfx.stretchSelectedSpeedToPlayhead(publicSequence, qeSequence, 'retract-in');
    } },
    'retract-speed-out-to-playhead': { run: function (publicSequence, qeSequence) {
        return prfx.stretchSelectedSpeedToPlayhead(publicSequence, qeSequence, 'retract-out');
    } },
    'undo-last-arrange': { run: function () {
        return prfx.undoLastArrangeAction();
    } },
    'redo-last-arrange': { run: function () {
        return prfx.redoLastArrangeAction();
    } },
    'dump-qe-api': { needsSequence: false, run: function () {
        return prfx.dumpQeApi();
    } },
    'select-before-playhead': { run: function (publicSequence, qeSequence) {
        return prfx.selectClipsBeforePlayhead(publicSequence, qeSequence);
    } },
    'adjustment-layer-over-selection': { run: function (publicSequence, qeSequence) {
        return prfx.addAdjustmentLayerOverSelection(publicSequence, qeSequence);
    } },
    'perfect-pitch': { run: function (publicSequence, qeSequence) {
        return prfx.applyPerfectPitch(publicSequence, qeSequence);
    } },
    'place-source-clip': { run: function (publicSequence, qeSequence) {
        return prfx.placeSourceMonitorClip(publicSequence, qeSequence);
    } },
    'place-bin-clips-column': { run: function (publicSequence, qeSequence) {
        return prfx.placeSelectedProjectItemsAsColumn(publicSequence, qeSequence);
    } },
    'bulk-replace-by-name': { run: function (publicSequence, qeSequence, command) {
        return prfx.bulkReplaceByName(publicSequence, qeSequence, (command && command.nameTolerance) || 'normalized');
    } },
    'failure-report': { needsSequence: false, run: function () {
        return prfx.failureReport();
    } },
    'clear-failure-ledger': { needsSequence: false, run: function () {
        return prfx.clearFailureLedger();
    } },
    'inspect-selected-clip': { run: function (publicSequence, qeSequence) {
        return prfx.inspectSelectedClip(publicSequence, qeSequence);
    } },
    'undo-last-prfx-action': { needsSequence: false, run: function () {
        return prfx.undoLastPrfxAction();
    } },
    'bulk-replace-preview': { run: function (publicSequence, qeSequence, command) {
        return prfx.previewBulkReplaceByName(publicSequence, qeSequence, (command && command.nameTolerance) || 'normalized');
    } },
    'replace-from-bin': { run: function (publicSequence, qeSequence) {
        return prfx.replaceSelectedClipsFromBin(publicSequence, qeSequence);
    } },
    'place-bin-clips': { run: function (publicSequence, qeSequence) {
        return prfx.placeSelectedProjectItems(publicSequence, qeSequence);
    } },
    'queue-cuts-to-ame': { run: function (publicSequence, qeSequence, command) {
        return prfx.queueCutsToEncoder(publicSequence, qeSequence, '', command && command.exportNamePattern,
            command && command.mergeTouchingSameSource);
    } },
    'trim-in-to-playhead': { run: function (publicSequence, qeSequence) {
        return prfx.trimSelectedClipsToPlayhead(publicSequence, qeSequence, 'in');
    } },
    'trim-out-to-playhead': { run: function (publicSequence, qeSequence) {
        return prfx.trimSelectedClipsToPlayhead(publicSequence, qeSequence, 'out');
    } },
    'close-selected-gaps': { run: function (publicSequence, qeSequence) {
        return prfx.closeSelectedClipGaps(publicSequence, qeSequence);
    } },
    'clean-up-track-rows': { run: function (publicSequence, qeSequence) {
        return prfx.cleanUpSelectedTrackRows(publicSequence, qeSequence, false);
    } },
    'fill-track-rows-down': { run: function (publicSequence, qeSequence) {
        return prfx.cleanUpSelectedTrackRows(publicSequence, qeSequence, true);
    } },
    'snap-tracks-in': { run: function (publicSequence, qeSequence) {
        return prfx.snapSelectedTrackBlocksToPlayhead(publicSequence, qeSequence, false);
    } },
    'snap-tracks-out': { run: function (publicSequence, qeSequence) {
        return prfx.snapSelectedTrackBlocksToPlayhead(publicSequence, qeSequence, true);
    } },
    'stagger-ascending': { run: function (publicSequence, qeSequence, command) {
        return prfx.staggerSelectedTrackBlocks(publicSequence, qeSequence, Number(command.staggerFrames), Number(command.staggerGroup), false);
    } },
    'stagger-descending': { run: function (publicSequence, qeSequence, command) {
        return prfx.staggerSelectedTrackBlocks(publicSequence, qeSequence, Number(command.staggerFrames), Number(command.staggerGroup), true);
    } }
};

// ---------------------------------------------------------------------------
// Universal undo
//
// Every mutating command is bracketed by qe.project.undoStackIndex(), so one
// command can rewind whatever the last PR FX action did -- arrange, trim, place
// or replace -- without each function needing its own inverse.
//
// Deliberately NOT step-counting: the checkpoint is Premiere's own cursor, so
// there is nothing to miscount. It refuses when the editor has made their own
// edits since, because rewinding to the checkpoint would discard those too.
// ---------------------------------------------------------------------------
prfx.UNIVERSAL_UNDO_DEPTH = 25;
if (!prfx.universalUndoStack) prfx.universalUndoStack = [];

prfx.NON_MUTATING_COMMANDS = {
    'dump-qe-api': true,
    'inspect-selected-clip': true,
    'build-status': true,
    'failure-report': true,
    'clear-failure-ledger': true,
    'bulk-replace-preview': true,
    'undo-last-arrange': true,
    'redo-last-arrange': true,
    'undo-last-palette-action': true,
    'undo-last-prfx-action': true
};

prfx.commandLabel = function (command) {
    if (!command) return 'the last action';
    if (command.name) return String(command.name);
    return String(command.id || command.type || 'the last action');
};

prfx.apply = function (payload) {
    var command, before, result, after;
    try { command = JSON.parse(payload); } catch (parseError) { return 'ERROR: PR FX could not read the command.'; }
    if (command.type === 'custom' && prfx.NON_MUTATING_COMMANDS[String(command.id)]) {
        result = prfx.applyCommand(payload);
        prfx.recordOutcome(command, result);
        return result;
    }

    prfx.failurePolicy = String(command.failurePolicy || 'rollback');
    before = prfx.undoCheckpoint();
    result = prfx.applyCommand(payload);
    prfx.recordOutcome(command, result);
    if (typeof result === 'string' && result.indexOf('ERROR:') === 0) return result;
    after = prfx.undoCheckpoint();
    // Only record when Premiere's stack actually moved; a command that changed
    // nothing must not consume an undo slot.
    if (!isNaN(before) && !isNaN(after) && after > before) {
        prfx.universalUndoStack.push({ label: prfx.commandLabel(command), before: before, after: after });
        while (prfx.universalUndoStack.length > prfx.UNIVERSAL_UNDO_DEPTH) prfx.universalUndoStack.shift();
    }
    return result;
};

prfx.undoLastPrfxAction = function () {
    var entry, current, reverted;
    if (!prfx.universalUndoStack.length) return 'ERROR: PR FX has not made any changes to undo in this session.';
    entry = prfx.universalUndoStack[prfx.universalUndoStack.length - 1];
    current = prfx.undoCheckpoint();
    if (isNaN(current)) return 'ERROR: Premiere\'s undo stack is unreadable, so PR FX will not risk rewinding it.';
    if (current > entry.after) {
        return 'ERROR: There have been ' + (current - entry.after) + ' edit' + ((current - entry.after) === 1 ? '' : 's') +
            ' since "' + entry.label + '". Rewinding would discard those too - use Premiere\'s own Undo instead.';
    }
    if (current <= entry.before) {
        prfx.universalUndoStack.pop();
        return '"' + entry.label + '" has already been undone.';
    }
    reverted = prfx.revertToUndoCheckpoint(entry.before, (entry.after - entry.before) + 24);
    if (!reverted || reverted.ok !== true) {
        return 'ERROR: Could not rewind "' + entry.label + '" - ' + ((reverted && reverted.message) || 'unknown reason') + '.';
    }
    prfx.universalUndoStack.pop();
    return 'Undid "' + entry.label + '" (' + reverted.steps + ' Premiere step' + (reverted.steps === 1 ? '' : 's') + '). ' +
        prfx.universalUndoStack.length + ' PR FX action' + (prfx.universalUndoStack.length === 1 ? '' : 's') + ' still undoable.';
};

prfx.applyCommand = function (payload) {
    try {
        var command = JSON.parse(payload);
        var handler = command.type === 'custom' ? prfx.functions[String(command.id)] : null;
        if (command.type === 'custom' && !handler) return 'ERROR: Unknown PR FX function.';
        if (handler && handler.needsSequence === false) return handler.run(null, null, command);
        prfx.lastPaletteEffectUndoCount = 0;
        prfx.lastPaletteEffectCheckpoint = NaN;
        if (!app.project || !app.project.activeSequence) return 'ERROR: Open a sequence and select one or more clips first.';
        app.enableQE();
        var publicSequence = app.project.activeSequence;
        var sequence = qe.project.getActiveSequence();
        var item, selected, duration, i, effectKind;
        if (!sequence) return 'ERROR: Premiere could not access the active sequence.';
        if (handler) return handler.run(publicSequence, sequence, command);
        if (command.type === 'effect' || command.type === 'audio-effect') {
            effectKind = command.type === 'audio-effect' ? 'audio' : 'video';
            selected = prfx.getSelectedQEClips(publicSequence, sequence, effectKind);
            if (!selected.length) return prfx.selectionError(effectKind);
            item = effectKind === 'audio' ? qe.project.getAudioEffectByName(command.name) : qe.project.getVideoEffectByName(command.name);
            if (!item) return 'ERROR: "' + command.name + '" is not available in this Premiere installation.';
            // Checkpoint before the batch. Counting applies and replaying that
            // many undos assumes one undo step per effect, which Premiere does
            // not promise; the stack index is the actual position to return to.
            prfx.lastPaletteEffectCheckpoint = prfx.undoCheckpoint();
            for (i = 0; i < selected.length; i++) {
                if (effectKind === 'audio') selected[i].addAudioEffect(item);
                else selected[i].addVideoEffect(item);
            }
            prfx.lastPaletteEffectUndoCount = selected.length;
            return 'Applied ' + command.name + ' to ' + selected.length + ' selected ' + (effectKind === 'audio' ? 'audio ' : '') + 'clip' + (selected.length === 1 ? '' : 's') + '.';
        }
        if (command.type === 'preset') {
            return prfx.applyUserPresetCommand(publicSequence, sequence, command);
        }
        if (command.type === 'transition' || command.type === 'audio-transition') {
            var kind = command.type === 'audio-transition' ? 'audio' : 'video';
            var placement = String(command.transitionPlacement || 'both');
            if (!prfx.isTransitionPlacement(placement)) placement = 'both';
            selected = prfx.getSelectedQEClipDetails(publicSequence, sequence, kind);
            if (!selected.length) return prfx.selectionError(kind);
            item = kind === 'audio' ? qe.project.getAudioTransitionByName(command.name) : qe.project.getVideoTransitionByName(command.name);
            if (!item) return 'ERROR: "' + command.name + '" is not available in this Premiere installation.';
            duration = prfx.framesToSequenceTimecode(publicSequence, Number(command.transitionFrames) || 30);
            var applied = prfx.applyTransitionPlacement(selected, item, duration, placement, kind);
            if (applied.error) return 'ERROR: ' + applied.error;
            if (!applied.count) return 'ERROR: No eligible ' + (kind === 'audio' ? 'audio ' : '') + 'clip boundaries were found for ' + prfx.transitionPlacementLabel(placement) + '.';
            return 'Applied ' + command.name + ' to ' + applied.count + ' ' + prfx.transitionPlacementLabel(placement) + ' ' + (applied.count === 1 ? 'boundary' : 'boundaries') + '.';
        }
        return 'ERROR: Unknown command type.';
    } catch (error) { return 'ERROR: ' + error.toString(); }
};

prfx.applyUserPresetCommand = function (publicSequence, sequence, command) {
    var preset = prfx.readUserPresetData(command), reason, checkpoint, selectedByKind = {}, totalClips = 0, totalEffects = 0, totalWrites = 0;
    var i, j, entry, selected, detail, effectItem, addResult, resolved, writeResult, failure = '', rollback, label;
    if (!preset) return 'ERROR: Could not read saved preset "' + String(command && command.name || '') + '" from Premiere\'s preset file.';
    reason = prfx.mockPresetUnsupportedReason(preset);
    if (reason) return 'ERROR: Cannot safely recreate "' + preset.name + '" yet: ' + reason + '.';

    checkpoint = prfx.undoCheckpoint();
    try {
        for (i = 0; i < preset.effects.length; i++) {
            entry = preset.effects[i];
            if (!selectedByKind[entry.kind]) selectedByKind[entry.kind] = prfx.getSelectedQEClipDetails(publicSequence, sequence, entry.kind);
            selected = selectedByKind[entry.kind];
            if (!selected.length) throw new Error(prfx.selectionError(entry.kind).replace(/^ERROR: /, ''));

            effectItem = prfx.resolveQEPresetEffect(entry.kind, entry.displayName, entry.matchName, preset.name);
            if (!effectItem) throw new Error('underlying ' + entry.kind + ' effect "' + (entry.displayName || entry.matchName) + '" is not available');

            for (j = 0; j < selected.length; j++) {
                detail = selected[j];
                addResult = entry.kind === 'audio' ? detail.clip.addAudioEffect(effectItem) : detail.clip.addVideoEffect(effectItem);
                if (addResult === false) throw new Error('Premiere refused to add "' + (entry.displayName || preset.name) + '" to "' + (detail.name || 'clip') + '"');
                totalEffects++;

                resolved = prfx.resolveAddedPresetComponent(publicSequence, entry, detail);
                if (!resolved || !resolved.component) throw new Error('Premiere did not publish "' + (entry.displayName || preset.name) + '" after adding it to "' + (detail.name || 'clip') + '"');

                writeResult = prfx.applyMockPresetParams(resolved.component, entry.params, detail);
                if (writeResult.failed) {
                    throw new Error('Premiere refused preset parameter' + (writeResult.failed === 1 ? '' : 's') +
                        ' "' + writeResult.failedNames.join('", "') + '" for "' + preset.name + '" on "' + (detail.name || 'clip') + '"');
                }
                if (entry.params.length && !writeResult.matched) throw new Error('none of the public parameters in "' + preset.name + '" matched the added effect');
                totalWrites += writeResult.applied;
                totalClips++;
            }
        }
    } catch (error) { failure = error.toString(); }

    if (failure) {
        rollback = prfx.revertToUndoCheckpoint(checkpoint, totalEffects * 8 + totalWrites * 4 + 24);
        return 'ERROR: Mock preset apply stopped and was rolled back: ' + failure +
            ((!rollback || rollback.ok !== true) ? ' Undo manually if Premiere kept a partial change.' : '') + '.';
    }

    prfx.lastPaletteEffectCheckpoint = checkpoint;
    prfx.lastPaletteEffectUndoCount = totalEffects;
    label = totalWrites ? (' with ' + totalWrites + ' public parameter write' + (totalWrites === 1 ? '' : 's')) : ' as a default effect';
    return 'Recreated saved preset "' + preset.name + '" on ' + totalClips + ' selected clip' + (totalClips === 1 ? '' : 's') + label + '.';
};

prfx.selectedTrackItemMatchesKind = function (sequence, selected, kind) {
    var resolved = '', value = '';
    // TrackItem.type is not reliable for linked clips in Premiere. The move
    // subsystem already has the safer resolver, which checks mediaType first
    // and only falls back to track/range/type when needed.
    try { resolved = prfx.moveSelectionKind(sequence, selected); } catch (resolveError) { resolved = ''; }
    if (resolved) return resolved === kind;
    try { value = selected && selected.type !== undefined && selected.type !== null ? String(selected.type).toLowerCase() : ''; } catch (error) { value = ''; }
    if (!value) return true;
    if (kind === 'audio') return value === '2' || value.indexOf('audio') >= 0;
    return value === '1' || value.indexOf('video') >= 0;
};

prfx.getSelectedQEClipDetails = function (publicSequence, qeSequence, kind) {
    var publicSelection = publicSequence.getSelection(), details = [], seen = {}, i, selected, qeTrack, count, j, qeClip, key, start, end, snapshot, linkedAudio;
    prfx.lastPublicSelectionCount = publicSelection.length;
    for (i = 0; i < publicSelection.length; i++) {
        selected = publicSelection[i]; if (!selected || !prfx.selectedTrackItemMatchesKind(publicSequence, selected, kind)) continue;
        qeTrack = kind === 'audio' ? qeSequence.getAudioTrackAt(selected.parentTrackIndex) : qeSequence.getVideoTrackAt(selected.parentTrackIndex);
        count = qeTrack ? Number(qeTrack.numItems || 0) : 0;
        for (j = 0; j < count; j++) {
            qeClip = qeTrack.getItemAt(j);
            if (qeClip && prfx.sameTimelineRange(selected, qeClip)) {
                start = prfx.timeInSeconds(qeClip.start); end = prfx.timeInSeconds(qeClip.end);
                key = String(selected.parentTrackIndex) + ':' + String(start) + ':' + String(end);
                if (!seen[key]) {
                    seen[key] = true;
                    details.push({
                        clip: qeClip,
                        trackIndex: Number(selected.parentTrackIndex),
                        start: start,
                        end: end,
                        startTicks: prfx.timeTicks(qeClip.start),
                        endTicks: prfx.timeTicks(qeClip.end),
                        name: String(selected.name || qeClip.name || 'Timeline clip')
                    });
                }
                break;
            }
        }
    }
    if (!details.length && kind === 'audio') {
        try { snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence, true); linkedAudio = snapshot.selectedByKind.audio || []; } catch (linkedError) { linkedAudio = []; }
        for (i = 0; i < linkedAudio.length; i++) {
            selected = linkedAudio[i];
            qeTrack = qeSequence.getAudioTrackAt(selected.sourceTrackIndex);
            count = qeTrack ? Number(qeTrack.numItems || 0) : 0;
            for (j = 0; j < count; j++) {
                qeClip = qeTrack.getItemAt(j);
                if (qeClip && Math.abs(prfx.timeInSeconds(qeClip.start) - selected.start) < 0.0001 && Math.abs(prfx.timeInSeconds(qeClip.end) - selected.end) < 0.0001) {
                    start = prfx.timeInSeconds(qeClip.start); end = prfx.timeInSeconds(qeClip.end);
                    key = String(selected.sourceTrackIndex) + ':' + String(start) + ':' + String(end);
                    if (!seen[key]) {
                        seen[key] = true;
                        details.push({
                            clip: qeClip,
                            trackIndex: Number(selected.sourceTrackIndex),
                            start: start,
                            end: end,
                            startTicks: prfx.timeTicks(qeClip.start),
                            endTicks: prfx.timeTicks(qeClip.end),
                            name: String(selected.name || qeClip.name || 'Timeline clip')
                        });
                    }
                    break;
                }
            }
        }
    }
    details.sort(function (a, b) { return a.trackIndex === b.trackIndex ? a.start - b.start : a.trackIndex - b.trackIndex; });
    return details;
};

prfx.applyTransitionPlacement = function (selected, item, duration, placement, kind) {
    var applied = 0, i, current, previous, next, groupStart, groupEnd, firstError = '';
    function add(detail, atStart, position) {
        try {
            var result;
            // One call represents one requested clip edge. Do not retry a failed
            // QE mutation because some transition plug-ins mutate before throwing.
            result = kind === 'audio' ?
                detail.clip.addTransition(item, atStart, duration) :
                position === undefined ?
                detail.clip.addTransition(item, atStart, duration) :
                detail.clip.addTransition(item, atStart, duration, "0", position);
            if (result !== false) applied++;
        } catch (error) { if (!firstError) firstError = error.toString(); }
    }
    if (placement === 'in') {
        for (i = 0; i < selected.length; i++) {
            previous = selected[i - 1];
            // "In" means the exposed In edge of a selected run. If the
            // previous selected clip touches this clip on the same track, that
            // boundary belongs to the dedicated selected-cuts option instead.
            if (previous && previous.trackIndex === selected[i].trackIndex && prfx.sameBoundary(previous.end, selected[i].start)) continue;
            add(selected[i], true);
        }
    } else if (placement === 'out') {
        for (i = 0; i < selected.length; i++) {
            next = selected[i + 1];
            // "Out" mirrors "In": only exposed Out edges of selected runs.
            if (next && next.trackIndex === selected[i].trackIndex && prfx.sameBoundary(selected[i].end, next.start)) continue;
            add(selected[i], false);
        }
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
    // Vertical moves act on the explicit selection only. Linked partners are
    // deliberately NOT pulled in: moving a clip to another track does not change
    // its timing, so a linked pair cannot desync, and dragging the unselected
    // half onto a different track is both surprising and destructive to a
    // deliberate layout. Pull is different - it changes timing, so it does
    // expand to linked items.
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
            return 'ERROR: Could not safely resolve "' + operations[i].name + '" before moving. Nothing was changed.';
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
            return 'ERROR: Premiere did not republish "' + operations[i].name + '" after creating destination tracks. No clips were moved.';
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
            if (!qeClip) throw new Error('Could not resolve "' + operation.name + '" immediately before moving it.');
            direction = operation.targetTrackIndex - operation.currentTrackIndex;
            result = operation.kind === 'audio' ?
                qeClip.moveToTrack(0, direction, '00:00:00:00', 0) :
                qeClip.moveToTrack(direction, 0, '00:00:00:00', 0);
            if (result === false) throw new Error('Premiere rejected the move for "' + operation.name + '".');
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
        prfx.recordArrangeUndo(publicSequence, operations, transitions,
            'Move Selected Clips ' + (moveDirection === 'down' ? 'Down' : 'Up'));
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
    // Linked-media expansion, shared with Move and Stagger.
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

prfx.speedStretchDriverInfo = function (selected) {
    var explicitCounts = { video: 0, audio: 0 }, primaryKind, drivers = [], trackIndex = null;
    var i, detail, start = 999999999, end = -999999999, startTicks = NaN, endTicks = NaN, exact = true, tickValue;
    for (i = 0; i < selected.length; i++) if (selected[i].explicit) explicitCounts[selected[i].kind]++;
    primaryKind = explicitCounts.audio > explicitCounts.video ? 'audio' : 'video';
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        if (detail.explicit && detail.kind === primaryKind) drivers.push(detail);
    }
    if (!drivers.length) for (i = 0; i < selected.length; i++) if (selected[i].kind === primaryKind) drivers.push(selected[i]);
    if (!drivers.length) drivers = selected.slice(0);
    for (i = 0; i < drivers.length; i++) {
        detail = drivers[i];
        if (trackIndex === null) trackIndex = detail.sourceTrackIndex;
        else if (trackIndex !== detail.sourceTrackIndex) {
            return { error: 'Select clips on one ' + primaryKind + ' track for speed stretch/retract. Multiple driving tracks are ambiguous.' };
        }
        if (detail.start < start) start = detail.start;
        if (detail.end > end) end = detail.end;
        tickValue = prfx.numericTicks(detail.startTicks);
        if (isNaN(tickValue)) exact = false;
        else if (isNaN(startTicks) || tickValue < startTicks) startTicks = tickValue;
        tickValue = prfx.numericTicks(detail.endTicks);
        if (isNaN(tickValue)) exact = false;
        else if (isNaN(endTicks) || tickValue > endTicks) endTicks = tickValue;
    }
    if (!(end > start)) return { error: 'Could not read a valid selected duration.' };
    if (isNaN(startTicks) || isNaN(endTicks) || !(endTicks > startTicks)) exact = false;
    return { error: '', primaryKind: primaryKind, drivers: drivers, start: start, end: end, startTicks: startTicks, endTicks: endTicks, exact: exact };
};

prfx.roundSequenceTicks = function (sequence, ticks) {
    var frameTicks = prfx.numericTicks(sequence && sequence.timebase);
    if (!isNaN(frameTicks) && frameTicks > 0) return Math.round(Math.round(Number(ticks) / frameTicks) * frameTicks);
    return Math.round(Number(ticks));
};

prfx.assignSpeedStretchTargetTicks = function (sequence, detail, info, edge, scale) {
    var startTicks = prfx.numericTicks(detail.startTicks), endTicks = prfx.numericTicks(detail.endTicks);
    var targetStartTicks, targetEndTicks;
    if (edge === 'out') {
        targetStartTicks = info.startTicks + (startTicks - info.startTicks) * scale;
        targetEndTicks = info.startTicks + (endTicks - info.startTicks) * scale;
    } else {
        targetStartTicks = info.endTicks - (info.endTicks - startTicks) * scale;
        targetEndTicks = info.endTicks - (info.endTicks - endTicks) * scale;
    }
    targetStartTicks = prfx.roundSequenceTicks(sequence, targetStartTicks);
    targetEndTicks = prfx.roundSequenceTicks(sequence, targetEndTicks);
    detail.targetStartTicks = String(targetStartTicks);
    detail.targetEndTicks = String(targetEndTicks);
    detail.targetStart = prfx.secondsForTicks(targetStartTicks);
    detail.targetEnd = prfx.secondsForTicks(targetEndTicks);
    detail.speedSourceDurationTicks = endTicks - startTicks;
    detail.speedTargetDurationTicks = targetEndTicks - targetStartTicks;
};

prfx.assignSpeedStretchTargetSeconds = function (detail, info, edge, scale) {
    var startTime, endTime;
    if (edge === 'out') {
        detail.targetStart = info.start + (detail.start - info.start) * scale;
        detail.targetEnd = info.start + (detail.end - info.start) * scale;
    } else {
        detail.targetStart = info.end - (info.end - detail.start) * scale;
        detail.targetEnd = info.end - (info.end - detail.end) * scale;
    }
    try {
        startTime = new Time(); startTime.seconds = detail.targetStart;
        endTime = new Time(); endTime.seconds = detail.targetEnd;
        detail.targetStartTicks = String(startTime.ticks);
        detail.targetEndTicks = String(endTime.ticks);
        detail.speedSourceDurationTicks = prfx.numericTicks(detail.endTicks) - prfx.numericTicks(detail.startTicks);
        detail.speedTargetDurationTicks = prfx.numericTicks(detail.targetEndTicks) - prfx.numericTicks(detail.targetStartTicks);
    } catch (error) {
        detail.targetStartTicks = '';
        detail.targetEndTicks = '';
        detail.speedSourceDurationTicks = NaN;
        detail.speedTargetDurationTicks = NaN;
    }
};

prfx.speedStretchCollision = function (snapshot, details) {
    var i, detail, lane, j, interval;
    for (i = 0; i < details.length; i++) {
        detail = details[i];
        if (!(detail.targetEnd > detail.targetStart)) return '"' + detail.name + '" would become shorter than one frame.';
        if (detail.targetStart < -0.000001) return '"' + detail.name + '" would start before the sequence begins.';
        lane = snapshot.tracks[detail.kind][detail.sourceTrackIndex];
        if (!lane || lane.locked) return '"' + detail.name + '" is on a locked or unavailable track.';
        for (j = 0; j < lane.intervals.length; j++) {
            interval = lane.intervals[j];
            if (interval.selected) continue;
            if (prfx.moveRangesOverlap(detail.targetStart, detail.targetEnd, interval.start, interval.end)) {
                return 'Retiming "' + detail.name + '" would overlap an unselected clip on the same track.';
            }
        }
    }
    return '';
};

prfx.speedStretchOrder = function (details, edge, scale) {
    var ordered = details.slice(0), forward = edge === 'out' ? scale < 1 : scale >= 1;
    ordered.sort(function (a, b) {
        if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
        if (a.sourceTrackIndex !== b.sourceTrackIndex) return a.sourceTrackIndex - b.sourceTrackIndex;
        return forward ? a.start - b.start : b.start - a.start;
    });
    return ordered;
};

prfx.speedDurationTimecode = function (sequence, detail) {
    var targetTicks = prfx.numericTicks(detail.speedTargetDurationTicks), frameTicks = prfx.numericTicks(sequence && sequence.timebase), frames;
    if (!isNaN(targetTicks) && !isNaN(frameTicks) && frameTicks > 0) {
        frames = Math.max(1, Math.round(targetTicks / frameTicks));
        return prfx.framesToSequenceTimecode(sequence, frames);
    }
    return prfx.secondsToSequenceTimecode(sequence, detail.targetEnd - detail.targetStart);
};

prfx.speedClipIdentityMatches = function (clip, expected) {
    var actual = prfx.captureMoveClipState(clip);
    if (expected.projectItem !== null && actual.projectItem !== null && expected.projectItem !== actual.projectItem) return false;
    return true;
};

prfx.speedStretchFrameTolerance = function (sequence) {
    var frameTicks = prfx.numericTicks(sequence && sequence.timebase), seconds;
    if (!isNaN(frameTicks) && frameTicks > 0) {
        seconds = prfx.timeInSeconds({ ticks: frameTicks });
        if (seconds > 0) return Math.max(0.002, seconds * 1.5);
    }
    return 0.05;
};

prfx.syncSpeedStretchActualRange = function (detail, clip) {
    try { detail.targetStart = prfx.timeInSeconds(clip.start); detail.targetStartTicks = prfx.timeTicks(clip.start); } catch (startError) {}
    try { detail.targetEnd = prfx.timeInSeconds(clip.end); detail.targetEndTicks = prfx.timeTicks(clip.end); } catch (endError) {}
};

prfx.resolveSpeedStretchPublicClip = function (sequence, detail) {
    var tracks = detail.kind === 'audio' ? sequence.audioTracks : sequence.videoTracks, track, clips, count, i, clip, start, end, tolerance, score, best = null, bestScore = 999999999;
    tolerance = prfx.speedStretchFrameTolerance(sequence);
    try { track = tracks[detail.sourceTrackIndex]; clips = track.clips; count = Number(clips.numItems || clips.length || 0); } catch (error) { return null; }
    for (i = 0; i < count; i++) {
        try { clip = clips[i]; start = prfx.timeInSeconds(clip.start); end = prfx.timeInSeconds(clip.end); } catch (clipError) { continue; }
        if (Math.abs(start - detail.targetStart) > tolerance || Math.abs(end - detail.targetEnd) > tolerance) continue;
        if (!prfx.speedClipIdentityMatches(clip, detail.state)) continue;
        score = Math.abs(start - detail.targetStart) + Math.abs(end - detail.targetEnd);
        if (score < bestScore) { best = clip; bestScore = score; }
    }
    if (best) prfx.syncSpeedStretchActualRange(detail, best);
    return best;
};

prfx.resolveSpeedStretchQEClip = function (qeSequence, detail) {
    var track, count, i, clip, type, start, end, tolerance, score, best = null, bestScore = 999999999;
    tolerance = prfx.speedStretchFrameTolerance(app.project && app.project.activeSequence);
    try { track = detail.kind === 'audio' ? qeSequence.getAudioTrackAt(detail.sourceTrackIndex) : qeSequence.getVideoTrackAt(detail.sourceTrackIndex); } catch (trackError) { track = null; }
    count = track ? Number(track.numItems || 0) : 0;
    for (i = 0; i < count; i++) {
        try {
            clip = track.getItemAt(i);
            type = String(clip && clip.type || '').toLowerCase();
            start = prfx.timeInSeconds(clip.start);
            end = prfx.timeInSeconds(clip.end);
        } catch (clipError) { continue; }
        if (!clip || type.indexOf('transition') !== -1 || type.indexOf('empty') !== -1) continue;
        if (Math.abs(start - detail.targetStart) > tolerance || Math.abs(end - detail.targetEnd) > tolerance) continue;
        score = Math.abs(start - detail.targetStart) + Math.abs(end - detail.targetEnd);
        if (score < bestScore) { best = clip; bestScore = score; }
    }
    if (best) prfx.syncSpeedStretchActualRange(detail, best);
    return best;
};

prfx.waitForSpeedStretchClip = function (sequence, detail) {
    var attempt, liveSequence, clip, qeSequence;
    for (attempt = 0; attempt < 14; attempt++) {
        liveSequence = app.project && app.project.activeSequence ? app.project.activeSequence : sequence;
        clip = prfx.resolveSpeedStretchPublicClip(liveSequence, detail);
        if (clip) return clip;
        try { app.enableQE(); qeSequence = qe.project.getActiveSequence(); } catch (qeError) { qeSequence = null; }
        clip = qeSequence ? prfx.resolveSpeedStretchQEClip(qeSequence, detail) : null;
        if (clip) return clip;
        $.sleep(30 + attempt * 20);
    }
    return null;
};

prfx.verifySpeedStretch = function (sequence, operations) {
    var i, detail, clip;
    for (i = 0; i < operations.length; i++) {
        detail = operations[i];
        clip = prfx.waitForSpeedStretchClip(sequence, detail);
        if (!clip) return { ok: false, message: 'Premiere did not publish "' + detail.name + '" at ' + Number(detail.targetStart).toFixed(3) + '-' + Number(detail.targetEnd).toFixed(3) + '.' };
    }
    return { ok: true };
};

prfx.resolveSpeedStretchIntermediateQEClip = function (qeSequence, detail, trackIndex, start, end) {
    var track, count, i, clip, type, clipStart, clipEnd, duration, wantedDuration, tolerance, score, best = null, bestScore = 999999999;
    tolerance = prfx.speedStretchFrameTolerance(app.project && app.project.activeSequence);
    wantedDuration = end - start;
    try { track = detail.kind === 'audio' ? qeSequence.getAudioTrackAt(trackIndex) : qeSequence.getVideoTrackAt(trackIndex); } catch (trackError) { track = null; }
    count = track ? Number(track.numItems || 0) : 0;
    for (i = 0; i < count; i++) {
        try {
            clip = track.getItemAt(i);
            type = String(clip && clip.type || '').toLowerCase();
            clipStart = prfx.timeInSeconds(clip.start);
            clipEnd = prfx.timeInSeconds(clip.end);
        } catch (clipError) { continue; }
        if (!clip || type.indexOf('transition') !== -1 || type.indexOf('empty') !== -1 || typeof clip.moveToTrack !== 'function') continue;
        duration = clipEnd - clipStart;
        if (Math.abs(clipStart - start) > tolerance * 4) continue;
        if (Math.abs(duration - wantedDuration) > tolerance * 4 && Math.abs(clipEnd - end) > tolerance * 4) continue;
        score = Math.abs(clipStart - start) + Math.min(Math.abs(duration - wantedDuration), Math.abs(clipEnd - end));
        if (score < bestScore) { best = clip; bestScore = score; }
    }
    return best;
};

prfx.speedRatioFromPremiereValue = function (value) {
    var number = Number(value);
    if (!(number > 0)) return 1;
    return number > 10 ? number / 100 : number;
};

prfx.speedStretchClipDuration = function (clip) {
    try { return prfx.timeInSeconds(clip.end) - prfx.timeInSeconds(clip.start); } catch (durationError) { return NaN; }
};

prfx.speedStretchDurationMatches = function (clip, detail, sequence) {
    var actual = prfx.speedStretchClipDuration(clip), expected = detail.targetEnd - detail.targetStart, tolerance = prfx.speedStretchFrameTolerance(sequence);
    return actual > 0 && expected > 0 && Math.abs(actual - expected) <= tolerance * 2;
};

prfx.speedStretchClipSpeed = function (clip) {
    var value = NaN;
    try { value = Number(clip.getSpeed()); } catch (publicSpeedError) {}
    if (!(value > 0)) try { value = Number(clip.speed); } catch (qeSpeedError) {}
    return prfx.speedRatioFromPremiereValue(value);
};

prfx.speedStretchSpeedMatches = function (clip, targetRatio) {
    var actual = prfx.speedStretchClipSpeed(clip);
    return actual > 0 && Math.abs(actual - targetRatio) <= 0.001;
};

prfx.speedStretchDiagnosticNumber = function (value) {
    var number = Number(value);
    if (isNaN(number)) return 'NaN';
    return Number(number).toFixed(3);
};

prfx.forceSpeedStretchTimelineDuration = function (qeClip, targetRatio, detail, sequence) {
    var currentStart = detail.speedCurrentStart !== undefined ? detail.speedCurrentStart : detail.start;
    var currentEnd = prfx.speedStretchClipDuration(qeClip) + currentStart;
    var publicClip, targetEndTime, result, liveSequence, liveQe, liveQeClip, actualDuration, expectedDuration, notes = [], targetEndCode, afterQeEnd, afterPublicEnd;
    expectedDuration = detail.targetEnd - detail.targetStart;
    actualDuration = prfx.speedStretchClipDuration(qeClip);
    notes.push('after setSpeed duration=' + prfx.speedStretchDiagnosticNumber(actualDuration));
    notes.push('speed=' + prfx.speedStretchDiagnosticNumber(prfx.speedStretchClipSpeed(qeClip)));
    if (!(expectedDuration > 0) || !(actualDuration > 0)) return { ok: false, reason: 'duration readback was unavailable' };
    if (Math.abs(expectedDuration - actualDuration) <= prfx.speedStretchFrameTolerance(sequence) * 2) return { ok: true };
    if (expectedDuration <= actualDuration) return { ok: false, reason: 'duration stayed too long instead of too short' };
    if (!prfx.speedStretchSpeedMatches(qeClip, targetRatio)) {
        return { ok: false, reason: 'speed did not publish; ' + notes.join(', ') };
    }

    try {
        targetEndCode = prfx.secondsToSequenceTimecode(sequence, detail.targetEnd);
        result = qeClip.setEndPosition(targetEndCode);
        afterQeEnd = prfx.speedStretchClipDuration(qeClip);
        notes.push('qe setEndPosition(' + targetEndCode + ')=' + result + ' duration=' + prfx.speedStretchDiagnosticNumber(afterQeEnd));
        if (result !== false && prfx.speedStretchDurationMatches(qeClip, detail, sequence)) return { ok: true };
    } catch (qeEndError) { notes.push('qe setEndPosition error=' + qeEndError.toString()); }

    liveSequence = app.project && app.project.activeSequence ? app.project.activeSequence : sequence;
    publicClip = prfx.resolveMovePublicClipAt(liveSequence, detail, detail.sourceTrackIndex, currentStart, currentEnd);
    if (!publicClip) {
        publicClip = prfx.resolveMovePublicClipAt(liveSequence, detail, detail.sourceTrackIndex, currentStart, currentStart + actualDuration);
    }
    if (publicClip) {
        try {
            targetEndTime = new Time();
            if (detail.targetEndTicks !== undefined && detail.targetEndTicks !== '') targetEndTime.ticks = String(Math.round(prfx.numericTicks(detail.targetEndTicks)));
            else targetEndTime.seconds = detail.targetEnd;
            publicClip.end = targetEndTime;
            $.sleep(30);
            afterPublicEnd = prfx.speedStretchClipDuration(publicClip);
            notes.push('public end write duration=' + prfx.speedStretchDiagnosticNumber(afterPublicEnd));
            app.enableQE();
            liveQe = qe.project.getActiveSequence();
            liveQeClip = prfx.resolveMoveQEClipAt(liveQe, detail, detail.sourceTrackIndex, detail.targetStart, detail.targetEnd);
            if (!liveQeClip) liveQeClip = prfx.resolveSpeedStretchIntermediateQEClip(liveQe, detail, detail.sourceTrackIndex, detail.targetStart, detail.targetEnd);
            if (liveQeClip && prfx.speedStretchDurationMatches(liveQeClip, detail, liveSequence)) return { ok: true };
            if (!liveQeClip) notes.push('public end write did not publish target QE clip');
        } catch (publicEndError) { notes.push('public end write error=' + publicEndError.toString()); }
    } else {
        notes.push('public clip not resolved at ' + prfx.speedStretchDiagnosticNumber(currentStart) + '-' + prfx.speedStretchDiagnosticNumber(currentEnd));
    }
    return { ok: false, reason: notes.join('; ') };
};

prfx.applyQESpeedStretch = function (qeClip, targetRatio, duration, reversed, detail, sequence) {
    var result, alternateResult, actualDuration = NaN, expectedDuration = detail.targetEnd - detail.targetStart, forceResult, alternateError = '', diagnosis = [];
    diagnosis.push('targetSpeed=' + prfx.speedStretchDiagnosticNumber(targetRatio));
    diagnosis.push('durationArg=' + duration);
    // Match the rest of PR FX's verified QE usage: public TrackItem.getSpeed()
    // and qeClip.setSpeed() use ratio values, so 80% speed is 0.8.
    try { result = qeClip.setSpeed(targetRatio, duration, reversed, false, false); }
    catch (setSpeedError) { return { ok: false, actualDuration: actualDuration, expectedDuration: expectedDuration, error: setSpeedError.toString() }; }
    if (result === false) return { ok: false, actualDuration: actualDuration, expectedDuration: expectedDuration, error: 'Premiere rejected setSpeed' };
    $.sleep(30);
    diagnosis.push('setSpeed result=' + result);
    diagnosis.push('readSpeed=' + prfx.speedStretchDiagnosticNumber(prfx.speedStretchClipSpeed(qeClip)));
    diagnosis.push('readDuration=' + prfx.speedStretchDiagnosticNumber(prfx.speedStretchClipDuration(qeClip)));
    if (prfx.speedStretchDurationMatches(qeClip, detail, sequence)) return { ok: true, value: targetRatio };
    if (detail.speedPreparedForStretch === true) {
        forceResult = prfx.forceSpeedStretchTimelineDuration(qeClip, targetRatio, detail, sequence);
        if (forceResult.ok) return { ok: true, value: targetRatio };
        if (forceResult.reason) diagnosis.push(forceResult.reason);
        if (!prfx.speedStretchSpeedMatches(qeClip, targetRatio)) {
            try {
                alternateResult = qeClip.setSpeed(targetRatio * 100, duration, reversed, false, false);
                if (alternateResult !== false) {
                    $.sleep(30);
                    diagnosis.push('percent setSpeed result=' + alternateResult);
                    diagnosis.push('percent readSpeed=' + prfx.speedStretchDiagnosticNumber(prfx.speedStretchClipSpeed(qeClip)));
                    diagnosis.push('percent readDuration=' + prfx.speedStretchDiagnosticNumber(prfx.speedStretchClipDuration(qeClip)));
                    if (prfx.speedStretchDurationMatches(qeClip, detail, sequence)) return { ok: true, value: targetRatio * 100 };
                    forceResult = prfx.forceSpeedStretchTimelineDuration(qeClip, targetRatio, detail, sequence);
                    if (forceResult.ok) return { ok: true, value: targetRatio * 100 };
                    if (forceResult.reason) diagnosis.push('percent fallback: ' + forceResult.reason);
                } else {
                    alternateError = '; percent fallback was rejected';
                }
            } catch (alternateSpeedError) {
                alternateError = '; percent fallback failed: ' + alternateSpeedError.toString();
            }
        }
    }
    actualDuration = prfx.speedStretchClipDuration(qeClip);
    return { ok: false, actualDuration: actualDuration, expectedDuration: expectedDuration, error: diagnosis.join('; ') + alternateError };
};

prfx.speedStretchOldDurationSeconds = function (detail) {
    var sourceTicks = prfx.numericTicks(detail.speedSourceDurationTicks);
    if (!isNaN(sourceTicks) && sourceTicks > 0) return prfx.secondsForTicks(sourceTicks);
    return detail.end - detail.start;
};

prfx.prepareSpeedStretchOperation = function (publicSequence, detail) {
    var publicClip, qeSequence, qeClip, oldDurationSeconds, oldDurationTicks, targetStartTicks, timeOffset, result;
    publicClip = prfx.resolveMovePublicClipAt(publicSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
    if (!publicClip) throw new Error('Could not resolve "' + detail.name + '" before preparing stretch.');
    try { detail.speedOriginalRatio = prfx.speedRatioFromPremiereValue(publicClip.getSpeed()); } catch (speedError) { detail.speedOriginalRatio = 1; }
    try { detail.speedOriginalReversed = publicClip.isSpeedReversed() === true; } catch (reverseError) { detail.speedOriginalReversed = false; }
    oldDurationSeconds = prfx.speedStretchOldDurationSeconds(detail);
    oldDurationTicks = prfx.numericTicks(detail.speedSourceDurationTicks);
    app.enableQE();
    qeSequence = qe.project.getActiveSequence();
    qeClip = prfx.resolveMoveQEClipAt(qeSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
    if (!qeClip) throw new Error('Could not resolve QE clip "' + detail.name + '" before preparing stretch.');
    targetStartTicks = prfx.numericTicks(detail.targetStartTicks);
    timeOffset = prfx.moveTimingOffset(publicSequence, detail.targetStart - detail.start, targetStartTicks - prfx.numericTicks(detail.startTicks));
    try { result = qeClip.moveToTrack(0, 0, timeOffset, 0); }
    catch (moveError) { throw new Error('Premiere refused to prepare "' + detail.name + '" for stretching: ' + moveError.toString()); }
    if (result === false) throw new Error('Premiere rejected the prepare move for "' + detail.name + '".');
    detail.speedCurrentStart = detail.targetStart;
    detail.speedCurrentStartTicks = detail.targetStartTicks;
    detail.speedPreparedForStretch = true;
    if (!isNaN(targetStartTicks) && !isNaN(oldDurationTicks)) {
        detail.speedCurrentEndTicks = String(Math.round(targetStartTicks + oldDurationTicks));
        detail.speedCurrentEnd = prfx.secondsForTicks(detail.speedCurrentEndTicks);
    } else {
        detail.speedCurrentEnd = detail.targetStart + oldDurationSeconds;
        detail.speedCurrentEndTicks = '';
    }
};

prfx.applySpeedStretchOperation = function (publicSequence, detail) {
    var publicClip, qeSequence, qeClip, oldSpeed = 1, reversed = false, oldDuration, newDuration, newSpeed, duration, timeOffset, result, retimedEnd, retimedClip;
    var actualStart, actualStartTicks, targetStartTicks, retimedEndTicks, moveFailure, speedResult;
    var currentStart = detail.speedCurrentStart !== undefined ? detail.speedCurrentStart : detail.start;
    var currentEnd = detail.speedCurrentEnd !== undefined ? detail.speedCurrentEnd : detail.end;
    var currentStartTicks = detail.speedCurrentStartTicks !== undefined ? detail.speedCurrentStartTicks : detail.startTicks;
    publicClip = prfx.resolveMovePublicClipAt(publicSequence, detail, detail.sourceTrackIndex, currentStart, currentEnd);
    if (publicClip) {
        try { oldSpeed = prfx.speedRatioFromPremiereValue(publicClip.getSpeed()); } catch (speedError) { oldSpeed = detail.speedOriginalRatio || 1; }
        try { reversed = publicClip.isSpeedReversed() === true; } catch (reverseError) { reversed = detail.speedOriginalReversed === true; }
    } else {
        oldSpeed = detail.speedOriginalRatio || 1;
        reversed = detail.speedOriginalReversed === true;
    }
    oldDuration = prfx.numericTicks(detail.speedSourceDurationTicks);
    newDuration = prfx.numericTicks(detail.speedTargetDurationTicks);
    if (isNaN(oldDuration) || isNaN(newDuration) || !(oldDuration > 0) || !(newDuration > 0)) {
        oldDuration = detail.end - detail.start;
        newDuration = detail.targetEnd - detail.targetStart;
    }
    if (!(newDuration > 0)) throw new Error('"' + detail.name + '" would become too short.');
    newSpeed = oldSpeed * (oldDuration / newDuration);
    if (!(newSpeed > 0)) throw new Error('Could not calculate a valid speed for "' + detail.name + '".');
    duration = prfx.speedDurationTimecode(publicSequence, detail);
    app.enableQE();
    qeSequence = qe.project.getActiveSequence();
    qeClip = prfx.resolveMoveQEClipAt(qeSequence, detail, detail.sourceTrackIndex, currentStart, currentEnd);
    if (!qeClip) qeClip = prfx.resolveSpeedStretchIntermediateQEClip(qeSequence, detail, detail.sourceTrackIndex, currentStart, currentEnd);
    if (!qeClip) throw new Error('Could not resolve QE clip "' + detail.name + '" before retiming.');
    speedResult = prfx.applyQESpeedStretch(qeClip, newSpeed, duration, reversed, detail, publicSequence);
    if (!speedResult.ok) throw new Error('Premiere did not change "' + detail.name + '" to the target duration. Wanted ' +
        Number(speedResult.expectedDuration).toFixed(3) + 's, got ' +
        (isNaN(speedResult.actualDuration) ? 'unreadable' : Number(speedResult.actualDuration).toFixed(3) + 's') +
        (speedResult.error ? '. Diagnose: ' + speedResult.error : '') + '.');
    retimedClip = qeClip;
    if (Math.abs(detail.targetStart - currentStart) > 0.000001) {
        actualStart = currentStart;
        actualStartTicks = prfx.numericTicks(currentStartTicks);
        try {
            actualStart = prfx.timeInSeconds(retimedClip.start);
            actualStartTicks = prfx.numericTicks(prfx.timeTicks(retimedClip.start));
        } catch (actualStartError) {}
        targetStartTicks = prfx.numericTicks(detail.targetStartTicks);
        timeOffset = prfx.moveTimingOffset(publicSequence, detail.targetStart - actualStart,
            targetStartTicks - actualStartTicks);
        try { result = retimedClip.moveToTrack(0, 0, timeOffset, 0); }
        catch (moveError) { moveFailure = moveError.toString(); result = false; }
        if (result === false) {
            retimedEnd = currentStart + (detail.targetEnd - detail.targetStart);
            retimedEndTicks = prfx.numericTicks(currentStartTicks) + prfx.numericTicks(detail.speedTargetDurationTicks);
            app.enableQE();
            qeSequence = qe.project.getActiveSequence();
            retimedClip = prfx.resolveMoveQEClipAt(qeSequence, detail, detail.sourceTrackIndex, currentStart, retimedEnd);
            if (!retimedClip && !isNaN(retimedEndTicks)) retimedClip = prfx.resolveMoveQEClipAt(qeSequence, detail, detail.sourceTrackIndex, currentStart, prfx.secondsForTicks(retimedEndTicks));
            if (!retimedClip) retimedClip = prfx.resolveSpeedStretchIntermediateQEClip(qeSequence, detail, detail.sourceTrackIndex, currentStart, retimedEnd);
            if (!retimedClip && !isNaN(retimedEndTicks)) retimedClip = prfx.resolveSpeedStretchIntermediateQEClip(qeSequence, detail, detail.sourceTrackIndex, currentStart, prfx.secondsForTicks(retimedEndTicks));
            if (!retimedClip) throw new Error('Could not resolve "' + detail.name + '" after retiming.');
            try {
                actualStart = prfx.timeInSeconds(retimedClip.start);
                actualStartTicks = prfx.numericTicks(prfx.timeTicks(retimedClip.start));
            } catch (retryStartError) {
                actualStart = detail.start;
                actualStartTicks = prfx.numericTicks(detail.startTicks);
            }
            timeOffset = prfx.moveTimingOffset(publicSequence, detail.targetStart - actualStart,
                targetStartTicks - actualStartTicks);
            try { result = retimedClip.moveToTrack(0, 0, timeOffset, 0); }
            catch (retryMoveError) { throw new Error('Premiere refused to reposition "' + detail.name + '" after retiming: ' + retryMoveError.toString()); }
        }
        if (result === false) throw new Error('Premiere rejected the reposition for "' + detail.name + '" after retiming' + (moveFailure ? ': ' + moveFailure : '') + '.');
    }
};

prfx.stretchSelectedSpeedToPlayhead = function (publicSequence, qeSequence, mode) {
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence, true), selected = snapshot.selected;
    var playhead, playheadSeconds, playheadTicks, info, exact, edge = '', oldSpan, newSpan, scale;
    var frameTicks, minDurationTicks, i, detail, collision, checkpoint, transitions, transitionResult, ordered, verification, label, preparedStretch;
    if (!selected.length) {
        if (snapshot.staleSelectionCount) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        return 'ERROR: Select one or more Timeline clips first.';
    }
    try { playhead = publicSequence.getPlayerPosition(); } catch (playheadError) { playhead = null; }
    playheadSeconds = prfx.timeInSeconds(playhead);
    playheadTicks = prfx.numericTicks(playhead && playhead.ticks);
    if (!(playheadSeconds >= 0)) return 'ERROR: Premiere could not read the playhead position.';
    info = prfx.speedStretchDriverInfo(selected);
    if (info.error) return 'ERROR: ' + info.error;
    exact = info.exact && !isNaN(playheadTicks);

    if (mode === 'stretch') {
        if (playheadSeconds < info.start - 0.000001) edge = 'in';
        else if (playheadSeconds > info.end + 0.000001) edge = 'out';
        else return 'ERROR: Stretch Speed needs the playhead outside the selected group. Use a Retract Speed command when the playhead is inside.';
    } else if (mode === 'retract-in') {
        edge = 'in';
        if (!(playheadSeconds > info.start + 0.000001 && playheadSeconds < info.end - 0.000001)) return 'ERROR: Retract Speed In needs the playhead inside the selected group.';
    } else if (mode === 'retract-out') {
        edge = 'out';
        if (!(playheadSeconds > info.start + 0.000001 && playheadSeconds < info.end - 0.000001)) return 'ERROR: Retract Speed Out needs the playhead inside the selected group.';
    } else {
        return 'ERROR: Unknown speed stretch mode.';
    }

    if (exact) {
        oldSpan = info.endTicks - info.startTicks;
        newSpan = edge === 'out' ? playheadTicks - info.startTicks : info.endTicks - playheadTicks;
    } else {
        oldSpan = info.end - info.start;
        newSpan = edge === 'out' ? playheadSeconds - info.start : info.end - playheadSeconds;
    }
    if (!(oldSpan > 0) || !(newSpan > 0)) return 'ERROR: The selected group would collapse to zero duration.';
    scale = newSpan / oldSpan;
    if (!(scale > 0)) return 'ERROR: Could not calculate a valid speed scale.';

    frameTicks = prfx.numericTicks(publicSequence.timebase);
    minDurationTicks = !isNaN(frameTicks) && frameTicks > 0 ? frameTicks : 1;
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        detail.targetTrackIndex = detail.sourceTrackIndex;
        if (exact && !isNaN(prfx.numericTicks(detail.startTicks)) && !isNaN(prfx.numericTicks(detail.endTicks))) prfx.assignSpeedStretchTargetTicks(publicSequence, detail, info, edge, scale);
        else prfx.assignSpeedStretchTargetSeconds(detail, info, edge, scale);
        if (!isNaN(prfx.numericTicks(detail.speedTargetDurationTicks)) && prfx.numericTicks(detail.speedTargetDurationTicks) < minDurationTicks) {
            return 'ERROR: "' + detail.name + '" would become shorter than one frame.';
        }
    }
    collision = prfx.speedStretchCollision(snapshot, selected);
    if (collision) return 'ERROR: ' + collision + ' Nothing was changed.';

    checkpoint = prfx.undoCheckpoint();
    if (isNaN(checkpoint)) return 'ERROR: Premiere\'s undo stack is unreadable, so PR FX will not risk a speed stretch it cannot roll back.';
    transitions = prfx.captureMoveTransitions(publicSequence, selected);
    transitionResult = prfx.removeMoveTransitions(publicSequence, transitions);
    if (!transitionResult.ok) {
        if (!isNaN(checkpoint)) prfx.revertToUndoCheckpoint(checkpoint, transitions.length + 8);
        return 'ERROR: Speed stretch stopped before editing because transitions could not be prepared: ' + transitionResult.message;
    }
    ordered = prfx.speedStretchOrder(selected, edge, scale);
    try {
        preparedStretch = mode === 'stretch' && scale > 1.000001;
        if (preparedStretch) {
            for (i = 0; i < ordered.length; i++) prfx.prepareSpeedStretchOperation(publicSequence, ordered[i]);
            publicSequence = app.project.activeSequence;
        }
        for (i = 0; i < ordered.length; i++) prfx.applySpeedStretchOperation(publicSequence, ordered[i]);
        publicSequence = app.project.activeSequence;
        verification = prfx.verifySpeedStretch(publicSequence, selected);
        if (!verification.ok) throw new Error(verification.message);
        transitionResult = prfx.restoreMoveTransitions(publicSequence, transitions, false);
        if (!transitionResult.ok) throw new Error('Transition restore failed: ' + transitionResult.message);
        prfx.selectMovedClips(publicSequence, selected);
    } catch (error) {
        if (!isNaN(checkpoint)) prfx.revertToUndoCheckpoint(checkpoint, selected.length * 6 + transitions.length * 4 + 24);
        return 'ERROR: Speed stretch failed and was rolled back: ' + error.toString();
    }
    if (mode === 'stretch') label = 'Stretched speed ' + (edge === 'in' ? 'In' : 'Out') + ' to the playhead';
    else label = 'Retracted speed ' + (edge === 'in' ? 'In' : 'Out') + ' to the playhead';
    return label + ' across ' + selected.length + ' linked/selected clip' + (selected.length === 1 ? '' : 's') +
        ' at ' + Math.round((1 / scale) * 100) + '% of their previous speed' +
        (transitionResult.restored ? '. Preserved ' + transitionResult.restored + ' transition' + (transitionResult.restored === 1 ? '' : 's') : '') + '.';
};

// Groups tracks that must snap as a unit. Two tracks belong to the same
// component when a link group spans them, so a linked V1+A1 edit keeps one
// shared anchor instead of each track snapping independently and desyncing.
// Union-find, because a chain of linked edits can transitively bind three or
// more tracks together.
// Diagnostic. Enumerates what Premiere's QE DOM and public DOM actually expose,
// so questions like "is there a preset API?" are answered by reflection instead
// of assumption. Writes to ~/Library/Logs/PR FX QE API.txt and is never invoked
// during normal use.
// Bulk undo for arrange operations.
//
// Deliberately not step-counting Premiere's undo stack: the number of undo
// steps an operation produces is not knowable (transition removal, track
// creation and per-clip moves all contribute), and being wrong either leaves
// the timeline half-restored or eats the editor's previous edit.
//
// Instead we replay the inverse, reusing the same rollback path that already
// runs when an operation fails mid-flight - so this code is exercised on every
// error, not only on undo. Every clip is verified to be where we left it, with
// unchanged clip state, before anything moves.
// Records are plain data - positions, ticks and captured state strings, with no
// live Premiere object references - so keeping a stack of them is cheap and
// cannot go stale in a dangerous way. Every level is verified independently at
// undo time regardless of its depth.
prfx.ARRANGE_UNDO_DEPTH = 25;
prfx.arrangeUndoStack = [];
prfx.arrangeRedoStack = [];

prfx.sequenceIdentity = function (sequence) {
    try {
        if (!sequence) return '';
        if (sequence.sequenceID !== undefined) return 'sequence:' + String(sequence.sequenceID);
        if (sequence.projectItem && sequence.projectItem.nodeId !== undefined) return 'node:' + String(sequence.projectItem.nodeId);
    } catch (error) {}
    return '';
};

prfx.recordArrangeUndo = function (publicSequence, operations, transitions, label) {
    var i, detail;
    if (!operations || !operations.length) return;
    // Undo overwrites target* so the restored clips can be reselected, so the
    // action's real destination is stashed separately for redo to restore.
    for (i = 0; i < operations.length; i++) {
        detail = operations[i];
        detail.redoTrackIndex = detail.targetTrackIndex;
        detail.redoStart = detail.targetStart;
        detail.redoEnd = detail.targetEnd;
        detail.redoStartTicks = detail.targetStartTicks;
        detail.redoEndTicks = detail.targetEndTicks;
    }
    // A fresh action invalidates any redo history, as in every editor.
    prfx.arrangeRedoStack = [];
    prfx.arrangeUndoStack.push({
        sequenceId: prfx.sequenceIdentity(publicSequence),
        operations: operations,
        transitions: transitions || [],
        label: label
    });
    while (prfx.arrangeUndoStack.length > prfx.ARRANGE_UNDO_DEPTH) prfx.arrangeUndoStack.shift();
};

prfx.arrangeUndoRemaining = function () {
    var count = prfx.arrangeUndoStack.length;
    return count ? ' ' + count + ' earlier action' + (count === 1 ? '' : 's') + ' still undoable.' : '';
};

prfx.arrangeRedoRemaining = function () {
    var count = prfx.arrangeRedoStack.length;
    return count ? ' ' + count + ' action' + (count === 1 ? '' : 's') + ' can be redone.' : '';
};

prfx.redoLastArrangeAction = function () {
    var sequence = app.project && app.project.activeSequence, record;
    var operations, transitions, verification, clearance, replay, transitionResult, i, detail;
    if (!prfx.arrangeRedoStack.length) return 'ERROR: No PR FX arrange action is available to redo.';
    if (!sequence) return 'ERROR: Open the sequence the action was performed in first.';
    record = prfx.arrangeRedoStack[prfx.arrangeRedoStack.length - 1];
    if (record.sequenceId && record.sequenceId !== prfx.sequenceIdentity(sequence)) {
        return 'ERROR: That action was performed in a different sequence. Open it and try again.';
    }
    operations = record.operations;
    transitions = record.transitions;
    // Undo left target* pointing at the original positions, so this verifies the
    // clips are still where undo put them before anything is restored.
    verification = prfx.verifyMovedClipState(sequence, operations);
    if (!verification.ok) {
        prfx.arrangeRedoStack.pop();
        return 'ERROR: The timeline changed since "' + record.label + '" was undone, so it can no longer be redone safely. ' +
            verification.message + prfx.arrangeRedoRemaining();
    }
    for (i = 0; i < operations.length; i++) {
        detail = operations[i];
        detail.targetTrackIndex = detail.redoTrackIndex;
        detail.targetStart = detail.redoStart;
        detail.targetEnd = detail.redoEnd;
        detail.targetStartTicks = detail.redoStartTicks;
        detail.targetEndTicks = detail.redoEndTicks;
    }
    clearance = prfx.arrangeSlotsClear(sequence, operations, false);
    if (!clearance.ok) {
        // Restore the undone view of target* so a later undo attempt still reads
        // the clips correctly, and keep the record for a retry.
        for (i = 0; i < operations.length; i++) {
            detail = operations[i];
            detail.targetTrackIndex = detail.sourceTrackIndex;
            detail.targetStart = detail.start;
            detail.targetEnd = detail.end;
            detail.targetStartTicks = detail.startTicks;
            detail.targetEndTicks = detail.endTicks;
        }
        return 'ERROR: "' + record.label + '" cannot be redone right now. ' + clearance.message +
            ' Nothing was moved.' + prfx.arrangeRedoRemaining();
    }
    prfx.arrangeRedoStack.pop();
    prfx.removeMoveTransitions(sequence, transitions);
    replay = prfx.replayArrangeOperations(sequence, operations);
    transitionResult = prfx.restoreMoveTransitions(app.project.activeSequence, transitions, false);
    prfx.selectMovedClips(app.project.activeSequence, operations);
    prfx.arrangeUndoStack.push(record);
    while (prfx.arrangeUndoStack.length > prfx.ARRANGE_UNDO_DEPTH) prfx.arrangeUndoStack.shift();
    if (replay.failed) {
        return 'ERROR: Redo of "' + record.label + '" moved ' + replay.restored + ' clip' + (replay.restored === 1 ? '' : 's') +
            ' but ' + replay.failed + ' could not be moved. The timeline is partially restored.';
    }
    return 'Redid "' + record.label + '" across ' + replay.restored + ' clip' + (replay.restored === 1 ? '' : 's') + '.' +
        (transitionResult.ok ? '' : ' Transition restore reported: ' + transitionResult.message) + prfx.arrangeRedoRemaining();
};

// verifyMovedClipState only proves our clips are still where we left them. It
// says nothing about the space they came from, which a native Premiere edit may
// have filled in the meantime. Moving back onto an occupied slot is exactly the
// corruption this undo exists to avoid, so check the original positions are
// clear first.
// `toSource` true checks the original positions (undo), false checks the action's
// destinations (redo). Either way the clips we are about to move are currently
// sitting in the opposite slot, so they are excluded as blockers - which also
// makes swaps work, where one operation's origin is another's destination.
prfx.arrangeSlotsClear = function (sequence, operations, toSource) {
    var movingKeys = {}, i, operation, tracks, track, clips, count, j, clip, start, end;
    var destinationTrack, destinationStart, destinationEnd, vacatingTrack, vacatingStart;
    function slotKey(kind, trackIndex, at) { return kind + ':' + trackIndex + ':' + Number(at).toFixed(6); }
    for (i = 0; i < operations.length; i++) {
        operation = operations[i];
        vacatingTrack = toSource ? operation.targetTrackIndex : operation.sourceTrackIndex;
        vacatingStart = toSource ? operation.targetStart : operation.start;
        movingKeys[slotKey(operation.kind, vacatingTrack, vacatingStart)] = true;
    }
    for (i = 0; i < operations.length; i++) {
        operation = operations[i];
        destinationTrack = toSource ? operation.sourceTrackIndex : operation.targetTrackIndex;
        destinationStart = toSource ? operation.start : operation.targetStart;
        destinationEnd = toSource ? operation.end : operation.targetEnd;
        tracks = operation.kind === 'audio' ? sequence.audioTracks : sequence.videoTracks;
        try { track = tracks[destinationTrack]; clips = track.clips; count = Number(clips.numItems || clips.length || 0); }
        catch (trackError) { return { ok: false, message: 'Could not read the destination track for "' + operation.name + '".' }; }
        for (j = 0; j < count; j++) {
            try { clip = clips[j]; } catch (clipError) { clip = null; }
            if (!clip) continue;
            start = prfx.timeInSeconds(clip.start); end = prfx.timeInSeconds(clip.end);
            if (movingKeys[slotKey(operation.kind, destinationTrack, start)]) continue;
            if (prfx.moveRangesOverlap(destinationStart, destinationEnd, start, end)) {
                return { ok: false, message: 'Another clip now occupies the ' + (toSource ? 'original' : 'destination') +
                    ' position of "' + operation.name + '".' };
            }
        }
    }
    return { ok: true };
};

// Forward twin of rollbackMoveOperations: moves each clip from where it now sits
// to the action's recorded destination.
prfx.replayArrangeOperations = function (sequence, operations) {
    var ordered = prfx.orderTimingMoveOperations(operations) || operations;
    var applied = 0, failed = 0, i, detail, clip, offset, timeOffset, result, activeQe, currentStart, currentEnd, currentStartTicks;
    for (i = 0; i < ordered.length; i++) {
        detail = ordered[i];
        try {
            app.enableQE(); activeQe = qe.project.getActiveSequence();
            currentStart = detail.currentStart !== undefined ? detail.currentStart : detail.start;
            currentEnd = detail.currentEnd !== undefined ? detail.currentEnd : detail.end;
            currentStartTicks = prfx.numericTicks(detail.currentStartTicks !== undefined ? detail.currentStartTicks : detail.startTicks);
            clip = prfx.resolveMoveQEClipAt(activeQe, detail, detail.currentTrackIndex, currentStart, currentEnd);
            if (!clip) { failed++; continue; }
            offset = detail.targetTrackIndex - detail.currentTrackIndex;
            timeOffset = prfx.moveTimingOffset(sequence, detail.targetStart - currentStart, prfx.numericTicks(detail.targetStartTicks) - currentStartTicks);
            result = detail.kind === 'audio' ? clip.moveToTrack(0, offset, timeOffset, 0) : clip.moveToTrack(offset, 0, timeOffset, 0);
            if (result === false) { failed++; continue; }
            detail.currentTrackIndex = detail.targetTrackIndex;
            detail.currentStart = detail.targetStart; detail.currentEnd = detail.targetEnd;
            detail.currentStartTicks = detail.targetStartTicks; detail.currentEndTicks = detail.targetEndTicks;
            applied++;
        } catch (error) { failed++; }
    }
    return { restored: applied, failed: failed };
};

prfx.undoLastArrangeAction = function () {
    var sequence = app.project && app.project.activeSequence, record;
    var operations, transitions, verification, clearance, rollback, transitionResult, i, detail;
    if (!prfx.arrangeUndoStack.length) return 'ERROR: No PR FX arrange action is available to undo.';
    if (!sequence) return 'ERROR: Open the sequence the action was performed in first.';
    record = prfx.arrangeUndoStack[prfx.arrangeUndoStack.length - 1];
    if (record.sequenceId && record.sequenceId !== prfx.sequenceIdentity(sequence)) {
        return 'ERROR: The most recent action was performed in a different sequence. Open it and try again.';
    }
    operations = record.operations;
    transitions = record.transitions;
    // Refuse rather than corrupt: if anything has moved or been edited since,
    // the clips will not be found at their recorded destinations.
    verification = prfx.verifyMovedClipState(sequence, operations);
    if (!verification.ok) {
        // Drop only this level. Older records cover different clips and are
        // each verified on their own terms, so the history stays usable.
        prfx.arrangeUndoStack.pop();
        return 'ERROR: The timeline changed since "' + record.label + '", so it can no longer be undone safely. ' +
            verification.message + prfx.arrangeUndoRemaining();
    }
    clearance = prfx.arrangeSlotsClear(sequence, operations, true);
    if (!clearance.ok) {
        // Kept on the stack rather than discarded: an obstruction can be removed
        // and the undo retried, unlike a record whose own clips have moved.
        return 'ERROR: "' + record.label + '" cannot be undone right now. ' + clearance.message +
            ' Nothing was moved.' + prfx.arrangeUndoRemaining();
    }
    prfx.arrangeUndoStack.pop();
    prfx.removeRestoredMoveTransitions(sequence, transitions);
    rollback = prfx.rollbackMoveOperations(sequence, operations);
    transitionResult = prfx.restoreMoveTransitions(app.project.activeSequence, transitions, true);
    // Point the details back at their restored positions so the selection lands
    // on the clips as they now are, not where the undone action had put them.
    for (i = 0; i < operations.length; i++) {
        detail = operations[i];
        detail.targetTrackIndex = detail.sourceTrackIndex;
        detail.targetStart = detail.start;
        detail.targetEnd = detail.end;
        detail.targetStartTicks = detail.startTicks;
        detail.targetEndTicks = detail.endTicks;
    }
    prfx.selectMovedClips(app.project.activeSequence, operations);
    prfx.arrangeRedoStack.push(record);
    while (prfx.arrangeRedoStack.length > prfx.ARRANGE_UNDO_DEPTH) prfx.arrangeRedoStack.shift();
    if (rollback.failed) {
        return 'ERROR: Undo of "' + record.label + '" restored ' + rollback.restored + ' clip' + (rollback.restored === 1 ? '' : 's') +
            ' but ' + rollback.failed + ' could not be moved back. The timeline is partially restored.';
    }
    return 'Undid "' + record.label + '" across ' + rollback.restored + ' clip' + (rollback.restored === 1 ? '' : 's') + '.' +
        (transitionResult.ok ? '' : ' Transition restore reported: ' + transitionResult.message) + prfx.arrangeUndoRemaining();
};

prfx.reflectNames = function (label, target) {
    var lines = [label + ':'], list, i, name;
    if (target === null || target === undefined) return lines.concat(['  <unavailable>', '']);
    try {
        list = target.reflect.properties;
        for (i = 0; i < list.length; i++) {
            name = String(list[i].name);
            if (name !== '__proto__' && name !== 'reflect') lines.push('  prop   ' + name);
        }
    } catch (propertyError) { lines.push('  <properties unavailable: ' + propertyError.toString() + '>'); }
    try {
        list = target.reflect.methods;
        for (i = 0; i < list.length; i++) {
            name = String(list[i].name);
            if (name !== 'toString' && name !== 'valueOf') lines.push('  method ' + name);
        }
    } catch (methodError) { lines.push('  <methods unavailable: ' + methodError.toString() + '>'); }
    lines.push('');
    return lines;
};

// Reflection also carries argument lists, which is the only way to learn the
// shape of undocumented QE methods without guessing at them.
prfx.reflectSignatures = function (label, target, names) {
    var lines = [label + ' signatures:'], i, j, method, args, argNames;
    if (!target) return lines.concat(['  <unavailable>', '']);
    for (i = 0; i < names.length; i++) {
        try {
            method = target.reflect.find(names[i]);
            if (!method) { lines.push('  ' + names[i] + ' <not found>'); continue; }
            args = method.arguments || [];
            argNames = [];
            for (j = 0; j < args.length; j++) {
                argNames.push(String(args[j].name || ('arg' + j)) + ':' + String(args[j].dataType || '?'));
            }
            lines.push('  ' + names[i] + '(' + argNames.join(', ') + ')' +
                (method.dataType ? ' -> ' + method.dataType : '') +
                (method.description ? '   // ' + method.description : ''));
        } catch (error) { lines.push('  ' + names[i] + ' <reflection failed: ' + error.toString() + '>'); }
    }
    lines.push('');
    return lines;
};

prfx.dumpQeApi = function () {
    var lines = [], file, path, sequence, qeSequence, track, clip, effect, publicClip;
    // First line names the host build that produced this dump. Without it a
    // stale panel silently serves an old host and the dump looks current.
    lines.push('PR FX host build: ' + prfx.HOST_BUILD);
    lines.push('Premiere version: ' + String(app.version) + '  build ' + String(app.build));
    lines.push('');
    try {
        app.enableQE();
        lines = lines.concat(prfx.reflectNames('qe', qe));
        lines = lines.concat(prfx.reflectNames('qe.project', qe.project));
        try { qeSequence = qe.project.getActiveSequence(); } catch (sequenceError) { qeSequence = null; }
        lines = lines.concat(prfx.reflectNames('qe sequence', qeSequence));
        try { track = qeSequence ? qeSequence.getVideoTrackAt(0) : null; } catch (trackError) { track = null; }
        lines = lines.concat(prfx.reflectNames('qe video track', track));
        try { clip = track ? track.getItemAt(0) : null; } catch (clipError) { clip = null; }
        lines = lines.concat(prfx.reflectNames('qe track item', clip));
        try { effect = qe.project.getVideoEffectList ? qe.project.getVideoEffectList()[0] : null; } catch (effectError) { effect = null; }
        lines = lines.concat(prfx.reflectNames('qe effect entry', effect));
        lines = lines.concat(prfx.reflectNames('app', app));
        lines = lines.concat(prfx.reflectNames('app.project', app.project));
        sequence = app.project ? app.project.activeSequence : null;
        lines = lines.concat(prfx.reflectNames('public sequence', sequence));
        try { publicClip = sequence ? sequence.videoTracks[0].clips[0] : null; } catch (publicError) { publicClip = null; }
        lines = lines.concat(prfx.reflectNames('public track item', publicClip));
        try { lines = lines.concat(prfx.reflectNames('public component', publicClip ? publicClip.components[0] : null)); } catch (componentError) {}
        lines = lines.concat(prfx.reflectSignatures('qe video track', track,
            ['insert', 'overwrite', 'razor']));
        lines = lines.concat(prfx.reflectSignatures('qe track item', clip,
            ['move', 'moveToTrack', 'remove', 'rippleDelete', 'setSpeed', 'slip', 'slide']));
        lines = lines.concat(prfx.reflectSignatures('qe.project', qe.project,
            ['undo', 'redo', 'undoStackIndex']));
        lines = lines.concat(prfx.reflectSignatures('app.project', app.project,
            ['applyLumetriPreset', 'getAllLumetriPresetsList', 'getLumetriPresetsForFolderList']));
        try { lines = lines.concat(prfx.reflectNames('public video track', sequence ? sequence.videoTracks[0] : null)); } catch (publicTrackError) {}
        try { lines = lines.concat(prfx.reflectSignatures('public video track', sequence ? sequence.videoTracks[0] : null,
            ['setTargeted', 'isTargeted', 'setLocked', 'isLocked', 'overwriteClip', 'insertClip'])); } catch (publicTrackSigError) {}
        lines = lines.concat(prfx.reflectSignatures('public sequence', sequence,
            ['overwriteClip', 'insertClip', 'linkSelection', 'setSelection']));
        lines.push('app.getConstant probes:');
        var constantNames = ['Copy', 'Paste', 'PasteInsert', 'PasteAttributes', 'Duplicate',
            'Cut', 'Undo', 'Redo', 'Delete', 'RippleDelete'];
        for (var constantIndex = 0; constantIndex < constantNames.length; constantIndex++) {
            try {
                lines.push('  getConstant("' + constantNames[constantIndex] + '") = ' +
                    String(app.getConstant ? app.getConstant(constantNames[constantIndex]) : '<absent>'));
            } catch (constantError) { lines.push('  getConstant("' + constantNames[constantIndex] + '") threw: ' + constantError.toString()); }
        }
        lines.push('');
        lines.push('app.findMenuCommandId probes:');
        lines.push('  findMenuCommandId present = ' + String(typeof app.findMenuCommandId));
        var menuNames = ['Copy', 'Cut', 'Paste', 'Paste Insert', 'Paste Attributes',
            'Paste Attributes...', 'Duplicate', 'Undo', 'Redo', 'Clear', 'Ripple Delete',
            'Select All', 'Deselect All', 'copy', 'Edit>Copy', 'Edit > Copy'];
        for (var menuIndex = 0; menuIndex < menuNames.length; menuIndex++) {
            try {
                lines.push('  findMenuCommandId("' + menuNames[menuIndex] + '") = ' +
                    String(app.findMenuCommandId ? app.findMenuCommandId(menuNames[menuIndex]) : '<absent>'));
            } catch (menuError) { lines.push('  findMenuCommandId("' + menuNames[menuIndex] + '") threw: ' + menuError.toString()); }
        }
        lines.push('');
        // Non-enumerable methods do not appear in reflection, so absence there
        // proves nothing. typeof is the only honest test.
        lines.push('typeof probes (reflection cannot see non-enumerable methods):');
        var typeofProbes = [
            ['app.executeCommand', function () { return app.executeCommand; }],
            ['app.findMenuCommandId', function () { return app.findMenuCommandId; }],
            ['app.getConstant', function () { return app.getConstant; }],
            ['app.project.placeAsset', function () { return app.project.placeAsset; }],
            ['app.project.createNewSequenceFromClips', function () { return app.project.createNewSequenceFromClips; }],
            ['qe.executeConsoleCommand', function () { return qe.executeConsoleCommand; }],
            ['qe.project.undo', function () { return qe.project.undo; }],
            ['qe.source.openFilePath', function () { return qe.source.openFilePath; }],
            ['qe.project.newAdjustmentLayer', function () { return qe.project.newAdjustmentLayer; }],
            ['qe.project.newTransparentVideo', function () { return qe.project.newTransparentVideo; }],
            ['qe.project.newColorMatte', function () { return qe.project.newColorMatte; }],
            ['app.project.createNewAdjustmentLayer', function () { return app.project.createNewAdjustmentLayer; }],
            ['app.project.rootItem.createAdjustmentLayer', function () { return app.project.rootItem.createAdjustmentLayer; }],
            ['sequence.createAdjustmentLayer', function () { return app.project.activeSequence.createAdjustmentLayer; }],
            ['sequence.captionTracks', function () { return app.project.activeSequence.captionTracks; }],
            ['qe sequence.numCaptionTracks', function () { return qe.project.getActiveSequence().numCaptionTracks; }],
            ['qe sequence.getCaptionTrackAt', function () { return qe.project.getActiveSequence().getCaptionTrackAt; }]
        ];
        for (var probeIndex = 0; probeIndex < typeofProbes.length; probeIndex++) {
            try {
                lines.push('  typeof ' + typeofProbes[probeIndex][0] + ' = ' + String(typeof typeofProbes[probeIndex][1]()));
            } catch (probeError) { lines.push('  typeof ' + typeofProbes[probeIndex][0] + ' threw: ' + probeError.toString()); }
        }
        lines.push('');
        try { lines = lines.concat(prfx.reflectNames('app.encoder', app.encoder)); } catch (encoderError) { lines.push('app.encoder unreadable: ' + encoderError.toString()); }
        try { lines = lines.concat(prfx.reflectSignatures('app.encoder', app.encoder,
            ['encodeSequence', 'launchEncoder', 'startBatch', 'setSDKEncodeFileName'])); } catch (encoderSigError) {}
        try {
            var probeProperty = publicClip ? publicClip.components[1].properties[0] : null;
            lines.push('  typeof property.removeKey = ' + String(probeProperty ? typeof probeProperty.removeKey : '<none>'));
            lines.push('  typeof property.removeKeyRange = ' + String(probeProperty ? typeof probeProperty.removeKeyRange : '<none>'));
            lines.push('  first Motion property = ' + String(probeProperty && probeProperty.displayName));
            lines.push('  typeof property.setTimeVarying = ' + String(probeProperty ? typeof probeProperty.setTimeVarying : '<none>'));
            lines.push('  typeof property.addKey = ' + String(probeProperty ? typeof probeProperty.addKey : '<none>'));
            lines.push('  isTimeVarying = ' + String(probeProperty && probeProperty.isTimeVarying()));
        } catch (propertyProbeError) { lines.push('  property probe failed: ' + propertyProbeError.toString()); }
        lines.push('  typeof qe track item .replaceWith = ' + String(clip ? typeof clip.replaceWith : '<no clip>'));
        try { lines.push('  public TrackItem projectItem writable = ' + String(publicClip ? (typeof publicClip.projectItem) : '<no clip>')); } catch (swapProbeError) {}
        lines.push('extension root: ' + String(prfx.extensionRoot() && prfx.extensionRoot().fsName) +
            '  (HOST_FILE=' + prfx.HOST_FILE + ', EXTENSION_ROOT=' + prfx.EXTENSION_ROOT + ')');
        lines.push('epr presets found:');
        try {
            var eprList = prfx.eprPresetList(), eprIndex;
            if (!eprList.length) lines.push('  <none>');
            for (eprIndex = 0; eprIndex < eprList.length; eprIndex++) {
                lines.push('  ' + eprList[eprIndex].name + '  ext=' + (prfx.eprOutputExtension(eprList[eprIndex].path) || '<unknown>') + '  ' + eprList[eprIndex].path);
            }
        } catch (eprError) { lines.push('  <scan failed: ' + eprError.toString() + '>'); }
        lines.push('');
        lines = lines.concat(prfx.reflectSignatures('qe', qe, ['executeConsoleCommand']));
        lines = lines.concat(prfx.reflectSignatures('app.project', app.project, ['placeAsset', 'createNewSequenceFromClips']));
        lines.push('');
        lines = lines.concat(prfx.reflectSignatures('app', app, ['getConstant', 'executeCommand', 'findMenuCommandId']));
        lines.push('Lumetri preset list:');
        try {
            var lumetri = app.project.getAllLumetriPresetsList ? app.project.getAllLumetriPresetsList() : null;
            if (!lumetri) lines.push('  <returned nothing>');
            else {
                lines.push('  type=' + (typeof lumetri) + ' length=' + String(lumetri.length !== undefined ? lumetri.length : '?'));
                for (var lumetriIndex = 0; lumetriIndex < Math.min(12, Number(lumetri.length) || 0); lumetriIndex++) {
                    lines.push('  [' + lumetriIndex + '] ' + String(lumetri[lumetriIndex]));
                }
            }
        } catch (lumetriError) { lines.push('  <call failed: ' + lumetriError.toString() + '>'); }
        lines.push('');
        path = Folder.myDocuments.parent.fsName + '/Library/Logs/PR FX QE API.txt';
        file = new File(path);
        file.encoding = 'UTF-8';
        file.open('w');
        file.write(lines.join('\n'));
        file.close();
        return 'Wrote QE/DOM reflection to ' + path + ' (' + lines.length + ' lines).';
    } catch (error) {
        return 'ERROR: QE reflection failed: ' + error.toString();
    }
};

// Slides each selected clip left until its In meets the Out of the previous
// selected clip on the same track. Durations and order are untouched; only the
// dead air between them is removed. Clips stay on their own track - if a closed
// position would land on an unselected clip the whole action is refused, since
// silently spilling onto another track is not what "close gaps" means.
prfx.closeSelectedClipGaps = function (publicSequence, qeSequence) {
    // Closing gaps changes timing, so linked audio has to travel with its video
    // or the edit desyncs. One kind drives the packing - whichever the editor
    // selected more of, video winning ties - and every clip in a link group
    // takes the offset earned by its driving-kind member.
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence, true), selected = snapshot.selected;
    var explicitCounts = { video: 0, audio: 0 }, primaryKind, groups = {}, groupKeys = [], groupDeltas = {};
    var key, i, j, group, detail, cursorTicks, cursorSeconds, durationTicks, delta, lane, interval, compactable = false;
    if (selected.length < 2) {
        if (snapshot.staleSelectionCount) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        return 'ERROR: Select at least two Timeline clips on the same track to close gaps.';
    }
    for (i = 0; i < selected.length; i++) if (selected[i].explicit) explicitCounts[selected[i].kind]++;
    primaryKind = explicitCounts.audio > explicitCounts.video ? 'audio' : 'video';
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        if (!detail.explicit || detail.kind !== primaryKind) continue;
        key = String(detail.sourceTrackIndex);
        if (!groups[key]) { groups[key] = []; groupKeys.push(key); }
        groups[key].push(detail);
    }
    for (i = 0; i < groupKeys.length; i++) {
        group = groups[groupKeys[i]];
        if (group.length < 2) continue;
        compactable = true;
        group.sort(function (a, b) { return a.start - b.start; });
        // The first clip on each track anchors; everything after it packs left.
        groupDeltas[group[0].linkGroup] = { ticks: 0, seconds: 0 };
        cursorSeconds = group[0].end;
        cursorTicks = prfx.numericTicks(group[0].endTicks);
        for (j = 1; j < group.length; j++) {
            detail = group[j];
            durationTicks = prfx.numericTicks(detail.endTicks) - prfx.numericTicks(detail.startTicks);
            if (!isNaN(cursorTicks) && !isNaN(durationTicks) && !isNaN(prfx.numericTicks(detail.startTicks))) {
                groupDeltas[detail.linkGroup] = { ticks: cursorTicks - prfx.numericTicks(detail.startTicks), seconds: NaN };
                cursorTicks += durationTicks;
                cursorSeconds = prfx.secondsForTicks(cursorTicks);
            } else {
                groupDeltas[detail.linkGroup] = { ticks: NaN, seconds: cursorSeconds - detail.start };
                cursorTicks = NaN;
                cursorSeconds += detail.end - detail.start;
            }
        }
    }
    if (!compactable) return 'ERROR: Select at least two ' + primaryKind + ' clips on the same track to close gaps.';
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        delta = groupDeltas[detail.linkGroup];
        // A link group with no driving-kind member stays where it is.
        if (!delta) { prfx.assignTimingTargetSeconds(detail, detail.start); continue; }
        if (!isNaN(delta.ticks) && !isNaN(prfx.numericTicks(detail.startTicks))) prfx.assignTimingTargetTicks(detail, prfx.numericTicks(detail.startTicks) + delta.ticks);
        else prfx.assignTimingTargetSeconds(detail, detail.start + (isNaN(delta.seconds) ? 0 : delta.seconds));
    }
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        lane = snapshot.tracks[detail.kind][detail.sourceTrackIndex];
        if (!lane) continue;
        for (j = 0; j < lane.intervals.length; j++) {
            interval = lane.intervals[j];
            if (interval.selected) continue;
            if (prfx.moveRangesOverlap(detail.targetStart, detail.targetEnd, interval.start, interval.end)) {
                return 'ERROR: Closing gaps would move "' + detail.name + '" onto an unselected clip. Nothing was moved.';
            }
        }
    }
    return prfx.executeTimingMove(publicSequence, qeSequence, snapshot, selected, 'close-gaps', 'Closed gaps between the selected clips');
};

// Collapses the selection onto the fewest contiguous tracks, starting from the
// lowest track it already occupies, so empty rows left behind by earlier moves
// disappear. Timing is never changed - this is a purely vertical tidy-up.
prfx.assignCompactedTrackRows = function (snapshot, details) {
    var kinds = ['video', 'audio'], reservations = { video: [], audio: [] };
    var k, kind, byTrack, trackIndexes, i, t, group, detail, anchor, target;
    for (k = 0; k < kinds.length; k++) {
        kind = kinds[k];
        byTrack = {}; trackIndexes = [];
        for (i = 0; i < details.length; i++) {
            detail = details[i];
            if (detail.kind !== kind) continue;
            if (!byTrack[detail.sourceTrackIndex]) { byTrack[detail.sourceTrackIndex] = []; trackIndexes.push(detail.sourceTrackIndex); }
            byTrack[detail.sourceTrackIndex].push(detail);
        }
        if (!trackIndexes.length) continue;
        trackIndexes.sort(function (a, b) { return a - b; });
        anchor = trackIndexes[0];
        for (t = 0; t < trackIndexes.length; t++) {
            group = byTrack[trackIndexes[t]];
            group.sort(function (a, b) { return a.start - b.start; });
            for (i = 0; i < group.length; i++) {
                detail = group[i];
                target = anchor;
                prfx.ensureTimingVirtualTrack(snapshot, kind, target);
                while (!prfx.timingDetailFits(snapshot, detail, target, reservations[kind])) {
                    target++;
                    prfx.ensureTimingVirtualTrack(snapshot, kind, target);
                }
                detail.targetTrackIndex = target;
                prfx.reserveTimingDetail(reservations[kind], detail, target);
            }
        }
    }
};

// Fill variant: clips fall as far down the timeline as free space allows,
// rather than packing against the lowest selected track.
//
// Layer order is preserved. A clip can never drop below one that started on a
// lower track and overlaps it in time - so if a lower clip is blocked and stays
// put, everything above it stops there too. Without that floor, a background
// layer could end up on top of the clip it was behind.
prfx.assignFilledTrackRows = function (snapshot, details) {
    var kinds = ['video', 'audio'], reservations = { video: [], audio: [] }, placed = { video: [], audio: [] };
    var k, kind, byTrack, trackIndexes, i, t, p, group, detail, target, floor, blocker;
    for (k = 0; k < kinds.length; k++) {
        kind = kinds[k];
        byTrack = {}; trackIndexes = [];
        for (i = 0; i < details.length; i++) {
            detail = details[i];
            if (detail.kind !== kind) continue;
            if (!byTrack[detail.sourceTrackIndex]) { byTrack[detail.sourceTrackIndex] = []; trackIndexes.push(detail.sourceTrackIndex); }
            byTrack[detail.sourceTrackIndex].push(detail);
        }
        if (!trackIndexes.length) continue;
        // Lowest tracks are placed first so upper ones can read their results.
        trackIndexes.sort(function (a, b) { return a - b; });
        for (t = 0; t < trackIndexes.length; t++) {
            group = byTrack[trackIndexes[t]];
            group.sort(function (a, b) { return a.start - b.start; });
            for (i = 0; i < group.length; i++) {
                detail = group[i];
                floor = 0;
                for (p = 0; p < placed[kind].length; p++) {
                    blocker = placed[kind][p];
                    if (blocker.sourceTrackIndex < detail.sourceTrackIndex &&
                        prfx.moveRangesOverlap(detail.targetStart, detail.targetEnd, blocker.start, blocker.end) &&
                        blocker.target + 1 > floor) {
                        floor = blocker.target + 1;
                    }
                }
                target = floor;
                prfx.ensureTimingVirtualTrack(snapshot, kind, target);
                while (!prfx.timingDetailFits(snapshot, detail, target, reservations[kind])) {
                    target++;
                    prfx.ensureTimingVirtualTrack(snapshot, kind, target);
                }
                detail.targetTrackIndex = target;
                prfx.reserveTimingDetail(reservations[kind], detail, target);
                placed[kind].push({ sourceTrackIndex: detail.sourceTrackIndex, target: target, start: detail.targetStart, end: detail.targetEnd });
            }
        }
    }
};

prfx.cleanUpSelectedTrackRows = function (publicSequence, qeSequence, fillDown) {
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence), selected = snapshot.selected, i, detail, changed = false;
    if (!selected.length) {
        if (snapshot.staleSelectionCount) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        return 'ERROR: Select one or more Timeline clips to clean up.';
    }
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        prfx.assignTimingTargetSeconds(detail, detail.start);
        detail.targetStartTicks = detail.startTicks;
        detail.targetEndTicks = detail.endTicks;
    }
    if (fillDown) prfx.assignFilledTrackRows(snapshot, selected);
    else prfx.assignCompactedTrackRows(snapshot, selected);
    for (i = 0; i < selected.length; i++) if (selected[i].targetTrackIndex !== selected[i].sourceTrackIndex) { changed = true; break; }
    if (!changed) return fillDown ? 'The selected clips have already fallen as far down as free space allows.' : 'The selected clips already sit on the lowest available tracks.';
    return prfx.executeTimingMove(publicSequence, qeSequence, snapshot, selected, 'preassigned',
        fillDown ? 'Cleaned up the selected clips by timeline' : 'Cleaned up the selected clips by selection');
};

// ---------------------------------------------------------------------------
// Trim In / Trim Out to the playhead
//
// Only ever SHRINKS a clip - the playhead must fall inside it. A shrink can
// only ever open a gap, never write over a neighbour, which is what keeps this
// on the safe side of the create-a-clip line that Duplicate died on.
//
// Which call actually trims is not documented. Public TrackItem.start/end and
// QE setStartPosition/setEndPosition all exist, and any of them might reposition
// the clip rather than trim it. Rather than guess, each strategy is applied to
// the whole batch and then verified: the trimmed edge must land on the playhead
// AND the opposite edge must not have moved. Anything else is rolled back to the
// undo checkpoint and the next strategy is tried.
// ---------------------------------------------------------------------------
prfx.secondsToSequenceTimecode = function (sequence, seconds) {
    var frames, rate;
    try {
        rate = Number(sequence.videoFrameRate || 0);
        if (!(rate > 0)) rate = 254016000000 / Number(sequence.timebase);
        frames = Math.round(Number(seconds) * rate);
        return prfx.framesToSequenceTimecode(sequence, frames);
    } catch (error) { return prfx.framesToTimecode(Math.round(Number(seconds) * 30)); }
};

prfx.trimStrategies = ['public', 'qe'];

// Extending an edge needs the timeline space to actually be free. Shrinking
// never does, so this only bites in the outward direction.
prfx.trimExtendRoomFree = function (snapshot, detail, edge, targetSeconds) {
    var lane = snapshot.tracks[detail.kind][detail.sourceTrackIndex], i, interval, from, to;
    if (edge === 'in') {
        if (targetSeconds >= detail.start - 0.000001) return true;
        from = targetSeconds; to = detail.start;
    } else {
        if (targetSeconds <= detail.end + 0.000001) return true;
        from = detail.end; to = targetSeconds;
    }
    if (!lane) return false;
    for (i = 0; i < lane.intervals.length; i++) {
        interval = lane.intervals[i];
        if (Math.abs(interval.start - detail.start) < 0.0001 && Math.abs(interval.end - detail.end) < 0.0001) continue;
        if (prfx.moveRangesOverlap(from, to, interval.start, interval.end)) return false;
    }
    return true;
};

// How much source media is left beyond each edge of a clip, in TIMELINE seconds.
// Extending past this produces a clip pointing at media that does not exist,
// which Premiere renders as offline and which cannot be undone by re-trimming.
//
// Returns null when the bounds cannot be established. Callers must treat null as
// "no extending allowed" -- guessing here damages the edit, so refusing to act
// is always the better failure.
prfx.clipMediaHandles = function (clip) {
    var item, speed = 1, inTicks, outTicks, mediaInTicks, mediaOutTicks, before, after;
    try {
        item = clip.projectItem;
        if (!item) return null;
        inTicks = Number(clip.inPoint.ticks);
        outTicks = Number(clip.outPoint.ticks);
    } catch (readError) { return null; }
    if (isNaN(inTicks) || isNaN(outTicks)) return null;
    try { speed = Number(clip.getSpeed()); } catch (speedError) { speed = 1; }
    if (!(speed > 0)) speed = 1;
    // getInPoint/getOutPoint report the master clip's usable range. For an
    // untrimmed master that is the whole media; for a trimmed one it is
    // narrower, which only makes this more conservative.
    try {
        mediaInTicks = Number(item.getInPoint().ticks);
        mediaOutTicks = Number(item.getOutPoint().ticks);
    } catch (boundsError) { return null; }
    if (isNaN(mediaInTicks) || isNaN(mediaOutTicks) || !(mediaOutTicks > mediaInTicks)) return null;
    before = (inTicks - mediaInTicks) / speed;
    after = (mediaOutTicks - outTicks) / speed;
    return {
        beforeSeconds: prfx.secondsForTicks(String(Math.max(0, Math.round(before)))),
        afterSeconds: prfx.secondsForTicks(String(Math.max(0, Math.round(after))))
    };
};

// The furthest a clip's edge may legally travel outward, as an absolute
// timeline position. Null means the handle is unknown and no extend is allowed.
prfx.trimExtendLimit = function (publicSequence, detail, edge) {
    var clip = prfx.resolveMovePublicClipAt(publicSequence, detail, detail.sourceTrackIndex, detail.start, detail.end),
        handles;
    if (!clip) return null;
    handles = prfx.clipMediaHandles(clip);
    if (!handles) return null;
    return edge === 'in' ? detail.start - handles.beforeSeconds : detail.end + handles.afterSeconds;
};

// A clip whose timeline length disagrees with its source in/out range has no
// handles left to drag -- Premiere believes the media is exhausted. Some trim
// calls move the timeline edge without moving the matching source point, which
// is what makes a trimmed clip un-draggable. Read the result back and correct
// the source range only when it is actually inconsistent, so an API that
// already did the right thing is not double-corrected.
prfx.reconcileClipSourceRange = function (publicSequence, detail, edge, expectedStart, expectedEnd) {
    var clip = prfx.resolveMovePublicClipAt(publicSequence, detail, detail.sourceTrackIndex, expectedStart, expectedEnd),
        speed = 1, inTicks, outTicks, timelineTicks, expectedSourceTicks, frameTicks, time;
    if (!clip) return 'missing';
    try { speed = Number(clip.getSpeed()); } catch (speedError) { speed = 1; }
    if (!(speed > 0)) speed = 1;
    try {
        inTicks = Number(clip.inPoint.ticks);
        outTicks = Number(clip.outPoint.ticks);
        timelineTicks = Number(clip.end.ticks) - Number(clip.start.ticks);
    } catch (readError) { return 'unreadable'; }
    frameTicks = prfx.numericTicks(publicSequence.timebase);
    if (isNaN(frameTicks) || frameTicks <= 0) frameTicks = 254016000000 / 30;
    expectedSourceTicks = timelineTicks * speed;
    if (Math.abs((outTicks - inTicks) - expectedSourceTicks) <= frameTicks / 2) return 'consistent';
    try {
        time = new Time();
        if (edge === 'in') {
            time.ticks = String(Math.round(outTicks - expectedSourceTicks));
            clip.inPoint = time;
        } else {
            time.ticks = String(Math.round(inTicks + expectedSourceTicks));
            clip.outPoint = time;
        }
        return 'corrected';
    } catch (writeError) { return 'uncorrectable'; }
};

prfx.applyClipTrim = function (publicSequence, qeSequence, detail, edge, targetSeconds, targetTicks, strategy) {
    var clip, qeClip, time, timecode;
    if (strategy === 'public') {
        clip = prfx.resolveMovePublicClipAt(publicSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
        if (!clip) return false;
        try {
            time = new Time();
            if (!isNaN(targetTicks)) time.ticks = String(Math.round(targetTicks));
            else time.seconds = targetSeconds;
            if (edge === 'in') clip.start = time; else clip.end = time;
            return true;
        } catch (publicError) { return false; }
    }
    qeClip = prfx.resolveMoveQEClipAt(qeSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
    if (!qeClip) return false;
    timecode = prfx.secondsToSequenceTimecode(publicSequence, targetSeconds);
    try {
        if (edge === 'in') {
            if (typeof qeClip.setStartPosition !== 'function') return false;
            qeClip.setStartPosition(timecode);
        } else {
            if (typeof qeClip.setEndPosition !== 'function') return false;
            qeClip.setEndPosition(timecode);
        }
        return true;
    } catch (qeError) { return false; }
};

// The trimmed edge must sit on the playhead and the far edge must be exactly
// where it started. A call that slid the clip instead of trimming it fails here.
prfx.verifyClipTrim = function (publicSequence, detail, edge, targetSeconds) {
    var expectedStart = edge === 'in' ? targetSeconds : detail.start,
        expectedEnd = edge === 'in' ? detail.end : targetSeconds,
        clip = prfx.resolveMovePublicClipAt(publicSequence, detail, detail.sourceTrackIndex, expectedStart, expectedEnd);
    return !!clip;
};

prfx.trimSelectedClipsToPlayhead = function (publicSequence, qeSequence, edge) {
    // Trimming changes a clip's duration, so a linked partner has to be trimmed
    // with it or the pair desyncs at the trimmed end.
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence, true),
        selected, playhead, playheadSeconds, playheadTicks, groups = {}, groupKeys = [],
        targets = [], skippedGroups = 0, transitionBlocked = null, blockedByNeighbour = false,
        checkpoint, strategyIndex, strategy, i, j, detail, group, crossed, ok, boundary, usedStrategy,
        reconciled, corrections = 0, uncorrectable = 0,
        groupTarget, isExtend, limit, unknownHandle = false, exhausted = false, clamped = 0;

    if (!snapshot.selected.length) {
        if (snapshot.staleSelectionCount) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        return 'ERROR: Select one or more Timeline clips first.';
    }
    selected = snapshot.selected;
    try { playhead = publicSequence.getPlayerPosition(); } catch (playheadError) { playhead = null; }
    playheadSeconds = prfx.timeInSeconds(playhead);
    playheadTicks = prfx.numericTicks(playhead && playhead.ticks);
    if (!(playheadSeconds >= 0)) return 'ERROR: Premiere could not read the playhead position.';

    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        if (!groups[detail.linkGroup]) { groups[detail.linkGroup] = []; groupKeys.push(detail.linkGroup); }
        groups[detail.linkGroup].push(detail);
    }
    // A link group is trimmed whole or not at all. Trimming one half of a linked
    // pair is precisely the desync this tool exists to avoid.
    for (i = 0; i < groupKeys.length; i++) {
        group = groups[groupKeys[i]];
        crossed = true;
        groupTarget = playheadSeconds;
        for (j = 0; j < group.length; j++) {
            // The playhead only has to stay on the correct side of the OPPOSITE
            // edge. Inside the clip this shortens it; outside, it lengthens it.
            if (edge === 'in' ? !(playheadSeconds < group[j].end - 0.000001)
                              : !(playheadSeconds > group[j].start + 0.000001)) { crossed = false; break; }
            // Extending needs BOTH free timeline space and real source media
            // behind the edge. Running past the media end leaves the clip
            // pointing at nothing, and re-trimming does not repair it.
            isExtend = edge === 'in' ? playheadSeconds < group[j].start - 0.000001
                                     : playheadSeconds > group[j].end + 0.000001;
            if (isExtend) {
                if (!prfx.trimExtendRoomFree(snapshot, group[j], edge, playheadSeconds)) { crossed = false; blockedByNeighbour = true; break; }
                limit = prfx.trimExtendLimit(publicSequence, group[j], edge);
                if (limit === null) { crossed = false; unknownHandle = true; break; }
                // One shared target for the whole link group, clamped to the
                // shortest handle in it, so a linked pair cannot drift apart.
                groupTarget = edge === 'in' ? Math.max(groupTarget, limit) : Math.min(groupTarget, limit);
            }
        }
        if (crossed) {
            for (j = 0; j < group.length; j++) {
                if (edge === 'in' ? groupTarget >= group[j].start - 0.000001 && groupTarget <= group[j].start + 0.000001
                                  : groupTarget >= group[j].end - 0.000001 && groupTarget <= group[j].end + 0.000001) {
                    crossed = false; exhausted = true; break;
                }
            }
        }
        if (!crossed) { skippedGroups++; continue; }
        if (Math.abs(groupTarget - playheadSeconds) > 0.000001) clamped++;
        for (j = 0; j < group.length; j++) {
            group[j].trimTargetSeconds = groupTarget;
            group[j].trimTargetTicks = Math.abs(groupTarget - playheadSeconds) < 0.000001 ? playheadTicks : NaN;
        }
        for (j = 0; j < group.length; j++) {
            detail = group[j];
            // A transition sitting on the edge we are about to move would be
            // left hanging over nothing. Refuse rather than mangle it.
            boundary = edge === 'in' ? detail.start : detail.end;
            if (prfx.qeTrackHasTransitionAt(qeSequence, detail.kind, detail.sourceTrackIndex, boundary)) {
                transitionBlocked = detail.name;
                break;
            }
            targets.push(detail);
        }
        if (transitionBlocked) break;
    }
    if (transitionBlocked) {
        return 'ERROR: "' + transitionBlocked + '" has a transition on the edge being trimmed. Remove it first - Remove Transitions on Selected Clips does this.';
    }
    if (!targets.length) {
        if (exhausted) return 'ERROR: These clips are already at the end of their source media - there is no ' + (edge === 'in' ? 'head' : 'tail') + ' left to extend into. Nothing was changed.';
        if (unknownHandle) return 'ERROR: PR FX could not read how much source media is left on these clips, so it refused to extend rather than risk running past the end. Shrinking still works.';
        if (blockedByNeighbour) return 'ERROR: Extending to the playhead would run into another clip on the same track. Move it or close the gap first.';
        return 'ERROR: The playhead is on the wrong side of the ' + (edge === 'in' ? 'Out' : 'In') + ' point of every selected clip.';
    }

    checkpoint = prfx.undoCheckpoint();
    for (strategyIndex = 0; strategyIndex < prfx.trimStrategies.length; strategyIndex++) {
        strategy = prfx.trimStrategies[strategyIndex];
        ok = true;
        for (i = 0; i < targets.length; i++) {
            if (!prfx.applyClipTrim(publicSequence, qeSequence, targets[i], edge, targets[i].trimTargetSeconds, targets[i].trimTargetTicks, strategy)) { ok = false; break; }
        }
        if (ok) {
            for (i = 0; i < targets.length; i++) {
                if (!prfx.verifyClipTrim(publicSequence, targets[i], edge, targets[i].trimTargetSeconds)) { ok = false; break; }
            }
        }
        if (ok) {
            usedStrategy = strategy;
            // Put the source in/out back in step with the new timeline length,
            // otherwise the clip has no handles and cannot be dragged again.
            for (i = 0; i < targets.length; i++) {
                reconciled = prfx.reconcileClipSourceRange(publicSequence, targets[i], edge,
                    edge === 'in' ? targets[i].trimTargetSeconds : targets[i].start,
                    edge === 'in' ? targets[i].end : targets[i].trimTargetSeconds);
                if (reconciled === 'corrected') corrections++;
                else if (reconciled === 'uncorrectable') uncorrectable++;
            }
            return 'Trimmed the ' + (edge === 'in' ? 'In' : 'Out') + ' point of ' + targets.length +
                ' clip' + (targets.length === 1 ? '' : 's') + ' to the playhead [' + usedStrategy + ']' +
                (corrections ? ', restoring the source range on ' + corrections + ' of them' : '') + '.' +
                (uncorrectable ? ' ' + uncorrectable + ' clip' + (uncorrectable === 1 ? '' : 's') + ' may have lost drag handles - report this.' : '') +
                (clamped ? ' ' + clamped + ' stopped at the end of their source media rather than running past it.' : '') +
                (skippedGroups ? ' ' + skippedGroups + ' selected group' + (skippedGroups === 1 ? ' was' : 's were') + ' skipped.' : '');
        }
        // Put the timeline back before trying the next call. Without this a
        // half-applied strategy would compound into the next attempt.
        prfx.revertToUndoCheckpoint(checkpoint, targets.length * 4 + 8);
    }
    return 'ERROR: Premiere would not trim these clips - no available call moved the ' +
        (edge === 'in' ? 'In' : 'Out') + ' point without also moving the clip. Nothing was changed.';
};


// Premiere's own undo stack, used as a transaction boundary.
//
// qe.project.undoStackIndex() is a cursor into that stack, so an operation can
// record where it started and unwind precisely back there. This is what makes
// destructive experiments survivable: anything that goes wrong is rolled back
// to the exact prior state rather than merely reported.
prfx.undoCheckpoint = function () {
    try { app.enableQE(); return Number(qe.project.undoStackIndex()); } catch (error) { return NaN; }
};

prfx.revertToUndoCheckpoint = function (checkpoint, maxSteps) {
    var steps = 0, current, guard;
    if (isNaN(checkpoint)) return { ok: false, steps: 0, message: 'no undo checkpoint was recorded' };
    guard = maxSteps || 80;
    try {
        app.enableQE();
        while (steps < guard) {
            current = Number(qe.project.undoStackIndex());
            if (!isFinite(current) || current <= checkpoint) break;
            if (qe.project.undo() === false) break;
            steps++;
        }
        current = Number(qe.project.undoStackIndex());
        if (!isFinite(current)) return { ok: false, steps: steps, message: 'the undo stack index became unreadable' };
        if (current > checkpoint) return { ok: false, steps: steps, message: 'the undo stack stopped at ' + current + ' instead of ' + checkpoint };
        return { ok: true, steps: steps, message: '' };
    } catch (error) { return { ok: false, steps: steps, message: error.toString() }; }
};

prfx.snapTrackComponents = function (details) {
    var parents = {}, byGroup = {}, map = {}, i, j, key, group;
    function trackKey(detail) { return detail.kind + ':' + detail.sourceTrackIndex; }
    function root(value) {
        while (parents[value] !== value) { parents[value] = parents[parents[value]]; value = parents[value]; }
        return value;
    }
    function join(first, second) {
        var firstRoot = root(first), secondRoot = root(second);
        if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot;
    }
    for (i = 0; i < details.length; i++) {
        key = trackKey(details[i]);
        if (parents[key] === undefined) parents[key] = key;
        if (!byGroup[details[i].linkGroup]) byGroup[details[i].linkGroup] = [];
        byGroup[details[i].linkGroup].push(key);
    }
    for (group in byGroup) {
        if (!byGroup.hasOwnProperty(group)) continue;
        for (j = 1; j < byGroup[group].length; j++) join(byGroup[group][0], byGroup[group][j]);
    }
    for (i = 0; i < details.length; i++) { key = trackKey(details[i]); map[key] = root(key); }
    return map;
};

// Snap is Pull applied per track rather than to the whole selection: every
// track component gets its own offset so that its earliest In (or latest Out)
// lands on the playhead. Pull moves the selection rigidly and preserves the
// relative offsets between tracks; Snap deliberately collapses them.
prfx.snapSelectedTrackBlocksToPlayhead = function (publicSequence, qeSequence, useEnd) {
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence, true), selected = snapshot.selected;
    var components, anchors = {}, anchorTicks = {}, playhead, playheadSeconds, playheadTicks, exact = true;
    var i, detail, key, edgeSeconds, edgeTicks, delta, deltaTicks;
    if (!selected.length) {
        if (snapshot.staleSelectionCount) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        return 'ERROR: Select one or more Timeline clips first.';
    }
    try { playhead = publicSequence.getPlayerPosition(); } catch (playheadError) { playhead = null; }
    playheadSeconds = prfx.timeInSeconds(playhead);
    playheadTicks = prfx.numericTicks(playhead && playhead.ticks);
    if (!(playheadSeconds >= 0)) return 'ERROR: Premiere could not read the playhead position.';
    if (isNaN(playheadTicks)) exact = false;
    components = prfx.snapTrackComponents(selected);
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        key = components[detail.kind + ':' + detail.sourceTrackIndex];
        edgeSeconds = useEnd ? detail.end : detail.start;
        edgeTicks = prfx.numericTicks(useEnd ? detail.endTicks : detail.startTicks);
        if (isNaN(edgeTicks) || isNaN(prfx.numericTicks(detail.startTicks))) exact = false;
        if (anchors[key] === undefined) { anchors[key] = edgeSeconds; anchorTicks[key] = edgeTicks; }
        else {
            anchors[key] = useEnd ? Math.max(anchors[key], edgeSeconds) : Math.min(anchors[key], edgeSeconds);
            if (!isNaN(edgeTicks) && !isNaN(anchorTicks[key])) {
                anchorTicks[key] = useEnd ? Math.max(anchorTicks[key], edgeTicks) : Math.min(anchorTicks[key], edgeTicks);
            }
        }
    }
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        key = components[detail.kind + ':' + detail.sourceTrackIndex];
        if (exact && !isNaN(anchorTicks[key])) {
            deltaTicks = playheadTicks - anchorTicks[key];
            prfx.assignTimingTargetTicks(detail, prfx.numericTicks(detail.startTicks) + deltaTicks);
        } else {
            delta = playheadSeconds - anchors[key];
            prfx.assignTimingTargetSeconds(detail, detail.start + delta);
        }
        if (detail.targetStart < -0.000001) {
            return 'ERROR: Snap would move a track block before the start of the sequence. Nothing was moved.';
        }
    }
    return prfx.executeTimingMove(publicSequence, qeSequence, snapshot, selected, 'snap',
        'Snapped each track block ' + (useEnd ? 'Out' : 'In') + ' to the playhead');
};

prfx.staggerSelectedTrackBlocks = function (publicSequence, qeSequence, frameAmount, groupSize, descending) {
    // Stagger shifts timing, so linked audio must travel with its video or the
    // edit desyncs. One kind drives the ordering: whichever the editor actually
    // selected more of, with video winning ties because staggering video layers
    // is the common case. Every clip in a link group takes the offset earned by
    // its driving-kind member, so a linked pair always moves as one.
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence, true), selected = snapshot.selected;
    var trackOrder = [], trackRanks = {}, seenTrack = {}, groupRanks = {};
    var explicitCounts = { video: 0, audio: 0 }, primaryKind, frameTicks, i, detail, rank, multiplier, startTicks;
    if (!selected.length) {
        if (snapshot.staleSelectionCount) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        return 'ERROR: Select clips on at least two video tracks or at least two audio tracks first.';
    }
    frameAmount = isNaN(frameAmount) ? 5 : Math.max(0, Math.round(frameAmount));
    groupSize = isNaN(groupSize) ? 1 : Math.max(1, Math.floor(groupSize));
    frameTicks = prfx.numericTicks(publicSequence.timebase);
    for (i = 0; i < selected.length; i++) if (selected[i].explicit) explicitCounts[selected[i].kind]++;
    primaryKind = explicitCounts.audio > explicitCounts.video ? 'audio' : 'video';
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        if (!detail.explicit || detail.kind !== primaryKind) continue;
        if (!seenTrack[detail.sourceTrackIndex]) {
            seenTrack[detail.sourceTrackIndex] = true;
            trackOrder.push(detail.sourceTrackIndex);
        }
    }
    trackOrder.sort(function (a, b) { return a - b; });
    if (descending) trackOrder.reverse();
    if (trackOrder.length < 2) {
        return 'ERROR: Select clips on at least two ' + primaryKind + ' tracks to stagger.';
    }
    for (i = 0; i < trackOrder.length; i++) trackRanks[trackOrder[i]] = i;
    // Rank per link group, taken from the driving-kind member.
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        if (!detail.explicit || detail.kind !== primaryKind) continue;
        if (groupRanks[detail.linkGroup] === undefined) groupRanks[detail.linkGroup] = trackRanks[detail.sourceTrackIndex];
    }
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        rank = groupRanks[detail.linkGroup];
        // A group with no driving-kind member stays where it is.
        multiplier = rank === undefined ? 0 : (groupSize === 1 ? rank : rank % groupSize);
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
        if (!prfx.resolveMoveQEClipAt(qeSequence, detail, detail.sourceTrackIndex, detail.start, detail.end)) return 'ERROR: Could not safely resolve "' + detail.name + '" before moving. Nothing was changed.';
        if (snapshot.tracks[detail.kind][detail.sourceTrackIndex].locked) return 'ERROR: "' + detail.name + '" is on a locked track. Nothing was changed.';
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
        if (!prfx.resolveMoveQEClipAt(qeSequence, detail, detail.sourceTrackIndex, detail.start, detail.end)) return 'ERROR: Premiere did not republish "' + detail.name + '" after creating destination tracks. No clips were moved.';
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
            if (!qeClip) throw new Error('Could not resolve "' + detail.name + '" immediately before moving it.');
            trackOffset = detail.targetTrackIndex - detail.currentTrackIndex;
            timeOffset = prfx.moveTimingOffset(publicSequence, detail.targetStart - detail.currentStart, prfx.numericTicks(detail.targetStartTicks) - prfx.numericTicks(detail.currentStartTicks));
            result = detail.kind === 'audio' ? qeClip.moveToTrack(0, trackOffset, timeOffset, 0) : qeClip.moveToTrack(trackOffset, 0, timeOffset, 0);
            if (result === false) throw new Error('Premiere rejected the move for "' + detail.name + '".');
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
        prfx.recordArrangeUndo(publicSequence, operations, transitions, successLabel);
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

prfx.timingDetailStationary = function (detail) {
    var startTicks = prfx.numericTicks(detail.startTicks), targetTicks = prfx.numericTicks(detail.targetStartTicks);
    if (detail.targetStart === undefined) return true;
    if (!isNaN(startTicks) && !isNaN(targetTicks)) return startTicks === targetTicks;
    return Math.abs(Number(detail.targetStart) - Number(detail.start)) < 0.000001;
};

// Selected clips that are not moving in time still occupy their slots. Collect
// them by key so the fit checks stop planning other clips on top of them.
prfx.stationaryTimingKeys = function (details) {
    var map = {}, i, detail;
    for (i = 0; i < details.length; i++) {
        detail = details[i];
        if (prfx.timingDetailStationary(detail)) {
            map[prfx.moveSelectionKey(detail.kind, detail.sourceTrackIndex, detail.start, detail.end)] = true;
        }
    }
    return map;
};

prfx.timingDetailKeys = function (details) {
    var map = {}, i, detail;
    for (i = 0; i < details.length; i++) {
        detail = details[i];
        map[prfx.moveSelectionKey(detail.kind, detail.sourceTrackIndex, detail.start, detail.end)] = true;
    }
    return map;
};

prfx.planTimingMoveDestinations = function (snapshot, details, layoutMode) {
    var kinds = ['video', 'audio'], kindIndex, kind, kindDetails, i, offset, fits, candidateReservations, target, laneCount;
    var groups, groupKeys, key, group, reservations, stationary = prfx.stationaryTimingKeys(details), selfKeys;
    // 'preassigned' means the caller has already chosen targetTrackIndex for
    // every detail and the planner must not second-guess it.
    if (layoutMode === 'preassigned') {
        for (i = 0; i < details.length; i++) prfx.ensureTimingVirtualTrack(snapshot, details[i].kind, details[i].targetTrackIndex);
        return { error: '' };
    }
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
                    if (!prfx.timingDetailFits(snapshot, kindDetails[i], target, candidateReservations, stationary, prfx.timingDetailKeys(kindDetails))) { fits = false; break; }
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
            selfKeys = prfx.timingDetailKeys(group.members);
            while (true) {
                prfx.ensureTimingVirtualTrack(snapshot, kind, target);
                if (prfx.timingGroupFits(snapshot, group.members, target, reservations, stationary, selfKeys)) break;
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

// A selected clip is treated as free space because it is expected to vacate its
// slot. That is only true if it is actually moving. A selected clip that stays
// put -- a stagger group with offset zero, for instance -- is as solid an
// obstacle as an unselected one, and planning through it lands one clip on top
// of another. `stationary` lists those; `exclude` holds the clips currently
// being placed, which must never block themselves.
prfx.timingDetailFits = function (snapshot, detail, targetTrackIndex, reservations, stationary, exclude) {
    var lane = snapshot.tracks[detail.kind][targetTrackIndex], i, interval, blocks;
    if (!lane || lane.locked) return false;
    for (i = 0; i < lane.intervals.length; i++) {
        interval = lane.intervals[i];
        blocks = !interval.selected ||
            (stationary && interval.key && stationary[interval.key] && !(exclude && exclude[interval.key]));
        if (blocks && prfx.moveRangesOverlap(detail.targetStart, detail.targetEnd, interval.start, interval.end)) return false;
    }
    for (i = 0; i < reservations.length; i++) {
        interval = reservations[i];
        if (interval.trackIndex === targetTrackIndex && prfx.moveRangesOverlap(detail.targetStart, detail.targetEnd, interval.start, interval.end)) return false;
    }
    return true;
};

prfx.timingGroupFits = function (snapshot, members, targetTrackIndex, reservations, stationary, exclude) {
    var i;
    for (i = 0; i < members.length; i++) if (!prfx.timingDetailFits(snapshot, members[i], targetTrackIndex, reservations, stationary, exclude)) return false;
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

// Describes what is actually sitting on a track, so a verification failure says
// where the clip went instead of only that it is missing.
prfx.describeTrackOccupants = function (sequence, kind, trackIndex, nearStart) {
    var tracks = kind === 'audio' ? sequence.audioTracks : sequence.videoTracks, track, clips, count, i, clip, parts = [], start, end;
    try { track = tracks[trackIndex]; clips = track.clips; count = Number(clips.numItems || clips.length || 0); } catch (error) { return 'track ' + (trackIndex + 1) + ' unreadable'; }
    for (i = 0; i < count; i++) {
        try { clip = clips[i]; start = prfx.timeInSeconds(clip.start); end = prfx.timeInSeconds(clip.end); } catch (clipError) { continue; }
        if (Math.abs(start - nearStart) > 15) continue;
        parts.push(start.toFixed(3) + '-' + end.toFixed(3));
    }
    return parts.length ? parts.join(', ') : 'nothing nearby';
};

prfx.verifyMovedClipState = function (sequence, operations) {
    var i, operation, clip;
    for (i = 0; i < operations.length; i++) {
        operation = operations[i];
        clip = prfx.resolveMovePublicClip(sequence, operation, operation.targetTrackIndex);
        if (!clip) return { ok: false, message: 'Premiere did not publish "' + operation.name + '" at its planned destination (' +
            operation.kind + ' track ' + (operation.targetTrackIndex + 1) + ' ' + Number(operation.targetStart).toFixed(3) + '-' + Number(operation.targetEnd).toFixed(3) +
            '); that track holds: ' + prfx.describeTrackOccupants(sequence, operation.kind, operation.targetTrackIndex, operation.targetStart) + '.' };
        if (!prfx.moveClipStateMatches(clip, operation.state)) return { ok: false, message: 'Premiere changed clip state while moving "' + operation.name + '".' };
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
        if (!current || !current.remove) return { ok: false, message: 'Could not resolve transition "' + transitions[i].name + '" before moving.' };
        try { result = current.remove(false, false); } catch (error) { return { ok: false, message: error.toString() }; }
        if (result === false) return { ok: false, message: 'Premiere rejected transition removal for "' + transitions[i].name + '".' };
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
    return prfx.framesToSequenceTimecode(sequence, 30);
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
        if (!qeClip || !transition) return { ok: false, restored: restored, message: 'Could not resolve transition "' + data.name + '" for restoration.' };
        duration = prfx.moveTransitionDuration(sequence, data);
        try { result = qeClip.addTransition(transition, data.atStart, duration, '0', data.alignment); }
        catch (detailedError) {
            try { result = qeClip.addTransition(transition, data.atStart, duration); }
            catch (simpleError) { return { ok: false, restored: restored, message: simpleError.toString() }; }
        }
        if (result === false) return { ok: false, restored: restored, message: 'Premiere rejected transition "' + data.name + '".' };
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
    // Normalise to entries so every detail carries its link group and whether
    // the editor selected it explicitly, whichever path produced it.
    var entries = [];
    if (includeLinked) entries = prfx.expandLinkedMoveSelection(sequence, selected);
    else for (i = 0; i < Number(selected.numItems || selected.length || 0); i++) {
        try { entries.push({ item: selected[i], linkGroup: 'g' + i, explicit: true }); } catch (entryError) {}
    }
    for (i = 0; i < entries.length; i++) {
        item = entries[i].item;
        kind = prfx.moveSelectionKind(sequence, item);
        if (!kind) continue;
        detail = { kind: kind, name: String(item.name || 'Timeline clip'), sourceTrackIndex: Number(item.parentTrackIndex), start: prfx.timeInSeconds(item.start), end: prfx.timeInSeconds(item.end), startTicks: prfx.timeTicks(item.start), endTicks: prfx.timeTicks(item.end), state: prfx.captureMoveClipState(item), linkGroup: entries[i].linkGroup, explicit: entries[i].explicit };
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
                snapshot.tracks[kind][trackIndex].intervals.push({ start: detail.start, end: detail.end, selected: !!selectedKeys[key], key: key });
            }
        }
    }
    return snapshot;
};

// Expands a selection to every live linked TrackItem, and records two things
// callers need to reason about the result: which entries the editor actually
// selected, and which link group each entry belongs to. Commands that shift
// timing use the group to give a linked pair one shared offset, so the pair
// cannot drift apart.
//
// Each seed is walked to completion before the next one starts. That way two
// explicitly selected halves of the same linked edit land in one group rather
// than two, which would otherwise let them receive different offsets.
prfx.expandLinkedMoveSelection = function (sequence, selected) {
    var output = [], entries = {}, count = selected ? Number(selected.numItems || selected.length || 0) : 0;
    var groupCounter = 0, i, seed, groupId, localQueue, item, linked, linkedCount, linkedIndex, linkedItem;
    function identityFor(candidate) {
        var candidateKind = prfx.moveSelectionKind(sequence, candidate);
        if (!candidateKind) return '';
        return prfx.moveTrackItemIdentity(sequence, candidate, candidateKind);
    }
    function add(candidate, group, explicit) {
        var identity;
        if (!candidate) return null;
        identity = identityFor(candidate);
        if (!identity) return null;
        if (entries[identity]) {
            if (explicit) entries[identity].explicit = true;
            return null;
        }
        entries[identity] = { item: candidate, linkGroup: group, explicit: !!explicit };
        output.push(entries[identity]);
        return entries[identity];
    }
    for (i = 0; i < count; i++) {
        try { seed = selected[i]; } catch (selectionError) { seed = null; }
        if (!seed) continue;
        groupId = 'g' + groupCounter;
        if (!add(seed, groupId, true)) continue;
        groupCounter++;
        localQueue = [seed];
        for (var queueIndex = 0; queueIndex < localQueue.length; queueIndex++) {
            item = localQueue[queueIndex]; linked = null;
            try { linked = item.getLinkedItems ? item.getLinkedItems() : null; } catch (linkedError) { linked = null; }
            linkedCount = linked ? Number(linked.numItems || linked.length || 0) : 0;
            for (linkedIndex = 0; linkedIndex < linkedCount; linkedIndex++) {
                try { linkedItem = linked[linkedIndex]; } catch (linkedItemError) { linkedItem = null; }
                if (add(linkedItem, groupId, false)) localQueue.push(linkedItem);
            }
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

// Premiere 26 removed app.executeCommand along with app.findMenuCommandId, so
// the old executeCommand(16) undo loop could only ever throw. qe.project.undo()
// is the surviving undo, and undoStackIndex() gives an exact position to return
// to instead of a guessed step count.
prfx.undoLastPaletteEffectApply = function () {
    var count = Number(prfx.lastPaletteEffectUndoCount || 0),
        checkpoint = Number(prfx.lastPaletteEffectCheckpoint), reverted, i;
    if (count < 1) return 'ERROR: No PR FX effect batch is available to undo.';
    try {
        app.enableQE();
        if (!isNaN(checkpoint)) {
            reverted = prfx.revertToUndoCheckpoint(checkpoint, count * 4 + 8);
            prfx.lastPaletteEffectUndoCount = 0;
            prfx.lastPaletteEffectCheckpoint = NaN;
            if (!reverted || reverted.ok !== true) {
                return 'ERROR: Could not step Premiere\'s undo stack back to before the effect was applied - ' +
                    ((reverted && reverted.message) || 'unknown reason') + '. Undo manually.';
            }
            return 'Undid PR FX effect apply on ' + count + ' clip' + (count === 1 ? '' : 's') + '.';
        }
        for (i = 0; i < count; i++) qe.project.undo();
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
    var publicSelection = publicSequence.getSelection(), qeClips = [], seen = {}, i, selected, qeTrack, count, j, qeClip, key;
    prfx.lastPublicSelectionCount = publicSelection.length;
    for (i = 0; i < publicSelection.length; i++) {
        selected = publicSelection[i]; if (!selected || !prfx.selectedTrackItemMatchesKind(publicSequence, selected, kind)) continue;
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
// Converts a frame count into a timecode string at the sequence's real frame
// rate. Always prefer this over framesToTimecode: a frame count only means a
// duration relative to a timebase, so assuming 30 makes every transition the
// wrong length in 23.976/24/25/50/60fps sequences.
prfx.framesToSequenceTimecode = function (sequence, frames) {
    var frameTime, value;
    frames = Math.max(0, Math.round(Number(frames) || 0));
    try {
        frameTime = new Time();
        frameTime.ticks = String(sequence.timebase);
        value = new Time();
        value.ticks = String(Math.round(Number(frameTime.ticks) * frames));
        return value.getFormatted(frameTime, sequence.videoDisplayFormat);
    } catch (error) {
        return prfx.framesToTimecode(frames);
    }
};

// Last-resort fallback only, for when Premiere will not construct a Time and
// the real timebase is therefore unreadable. Assumes 30fps.
prfx.framesToTimecode = function (frames) { var seconds = Math.floor(frames / 30), remainder = frames % 30; return '00:00:' + (seconds < 10 ? '0' : '') + seconds + ':' + (remainder < 10 ? '0' : '') + remainder; };

// ---------------------------------------------------------------------------
// Batch queue to Adobe Media Encoder
//
// One AME job per selected clip: the sequence In/Out is parked on the clip's
// range, the sequence is queued with an .epr preset, and the editor's original
// In/Out is put back afterwards.
//
// Presets are read from the extension's own `epr` folder at catalog time, so
// dropping another .epr in there and refreshing the panel is all it takes to
// get another palette entry. Nothing is hardcoded.
// ---------------------------------------------------------------------------
prfx.extensionRoot = function () {
    var folder;
    if (prfx.EXTENSION_ROOT) {
        try { folder = new Folder(prfx.EXTENSION_ROOT); if (folder.exists) return folder; } catch (rootError) {}
    }
    try { return File(prfx.HOST_FILE).parent.parent; } catch (error) { return null; }
};

// .epr is plain XML. ExporterFileType is a FourCC packed into an integer --
// 1211250228 is 0x48323634, "H264" -- which is where the output extension comes
// from. Guessing the extension would silently produce files AME cannot write.
prfx.fourCCFromNumber = function (value) {
    // 'byte' would be the natural name here and is an ES3 FutureReservedWord,
    // which ExtendScript rejects outright -- taking the whole host with it.
    var n = Number(value), chars = '', i, octet;
    if (!isFinite(n) || n <= 0) return '';
    for (i = 3; i >= 0; i--) {
        octet = Math.floor(n / Math.pow(256, i)) % 256;
        chars += String.fromCharCode(octet);
    }
    return chars;
};

prfx.EXPORT_EXTENSIONS = {
    'H264': 'mp4', 'HEVC': 'mp4', 'MPEG': 'mpg', 'M2V ': 'm2v', 'MOV ': 'mov',
    'AVI ': 'avi', 'MXF ': 'mxf', 'DNXH': 'mxf', 'WAVE': 'wav', 'MP3 ': 'mp3',
    'AAC ': 'aac', 'GIF ': 'gif', 'PNG ': 'png', 'JPEG': 'jpg', 'TIFF': 'tif', 'DPX ': 'dpx'
};

prfx.eprOutputExtension = function (path) {
    var file = new File(path), text = '', fourCC, openTag, closeTag, start, stop;
    try {
        file.encoding = 'UTF-8';
        if (!file.open('r')) return '';
        text = file.read(4096);
        file.close();
    } catch (error) { try { file.close(); } catch (closeError) {} return ''; }
    // Deliberately no regex here. ExtendScript's parser is E4X-enabled, where a
    // bare '<' opens an XML literal, and a pattern containing '<' or '</' can
    // fail to parse the whole file -- which takes the entire host down, not
    // just this function.
    openTag = '<' + 'ExporterFileType' + '>';
    closeTag = '<' + '/' + 'ExporterFileType' + '>';
    start = text.indexOf(openTag);
    if (start < 0) return '';
    start += openTag.length;
    stop = text.indexOf(closeTag, start);
    if (stop < 0) return '';
    fourCC = prfx.fourCCFromNumber(text.substring(start, stop));
    return prfx.EXPORT_EXTENSIONS[fourCC] || '';
};

prfx.eprPresetList = function () {
    var root = prfx.extensionRoot(), folder, entries, presets = [], i, entry, name;
    if (!root) return presets;
    folder = new Folder(root.fsName + '/epr');
    if (!folder.exists) return presets;
    try { entries = folder.getFiles(); } catch (error) { return presets; }
    for (i = 0; i < entries.length; i++) {
        entry = entries[i];
        if (entry instanceof Folder) continue;
        name = String(entry.name || '');
        // ExtendScript hands back URI-encoded names; %20 in a preset label is
        // not something the editor ever typed.
        try { name = decodeURI(name); } catch (decodeError) {}
        if (!/\.epr$/i.test(name)) continue;
        presets.push({ name: name.replace(/\.epr$/i, ''), path: entry.fsName });
    }
    presets.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    return presets;
};

prfx.exportSafeName = function (value) {
    return String(value || 'clip').replace(/[^A-Za-z0-9 ._-]/g, '_').replace(/\s+/g, ' ').substring(0, 80);
};

// Only real media belongs in an export queue. Adjustment layers, colour mattes,
// bars, transparent video and Motion Graphics templates are selectable clips
// with no source footage of their own, and each one would otherwise become its
// own render job.
prfx.clipIsMediaSource = function (clip) {
    var item, path = '';
    try { if (clip.isAdjustmentLayer && clip.isAdjustmentLayer()) return false; } catch (adjustmentError) {}
    try { if (clip.isMGT && clip.isMGT()) return false; } catch (mgtError) {}
    try { item = clip.projectItem; } catch (itemError) { item = null; }
    if (!item) return false;
    // Synthetics are project items with no file behind them.
    try { path = String(item.getMediaPath ? item.getMediaPath() : ''); } catch (pathError) { path = ''; }
    return path.length > 0;
};

prfx.clipSourceId = function (clip) {
    try { return String(clip.projectItem.nodeId || ''); } catch (error) { return ''; }
};

// Overlapping ranges are always one job -- two stacked selected clips describe a
// single stretch of timeline, not two renders. Touching ranges only merge when
// the editor asks for it AND both come from the same source, which is the
// "one source, cut up, export as one" case.
prfx.mergeExportRanges = function (ranges, mergeTouchingSameSource, frameSeconds) {
    var merged = [], i, current, next, touching, overlapping;
    ranges.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    for (i = 0; i < ranges.length; i++) {
        next = ranges[i];
        if (!current) { current = { start: next.start, end: next.end, name: next.name, source: next.source }; continue; }
        overlapping = next.start < current.end - 0.000001;
        touching = Math.abs(next.start - current.end) <= frameSeconds / 2;
        if (overlapping || (touching && mergeTouchingSameSource && next.source && next.source === current.source)) {
            if (next.end > current.end) current.end = next.end;
            continue;
        }
        merged.push(current);
        current = { start: next.start, end: next.end, name: next.name, source: next.source };
    }
    if (current) merged.push(current);
    return merged;
};

prfx.encoderAvailable = function () {
    try { return !!(app.encoder && typeof app.encoder.encodeSequence === 'function'); } catch (error) { return false; }
};

// Filenames come from a user pattern, not from clip names. A clip name can be
// an entire source filename -- extension included -- which produced output like
// "Sequence 01 - 02 - MeadowEase v4.1[ngoc.mnbui][the.ducnguyen].mp4.mp4".
prfx.stripMediaExtension = function (value) {
    var text = String(value || ''), dot = text.lastIndexOf('.'), tail;
    if (dot <= 0 || dot < text.length - 6) return text;
    tail = text.substring(dot + 1);
    return /^[A-Za-z0-9]+$/.test(tail) ? text.substring(0, dot) : text;
};

prfx.expandExportNamePattern = function (pattern, sequenceName, index, clipName) {
    var text = String(pattern || '{sequence} - {index}');
    var padded = (index < 10 ? '0' : '') + index;
    text = text.split('{sequence}').join(prfx.exportSafeName(sequenceName));
    text = text.split('{index}').join(padded);
    // Clip names are usually source filenames. Left intact, "{sequence} - {clip}"
    // renders as "... .mp4.mp4" once the output extension is appended.
    text = text.split('{clip}').join(prfx.exportSafeName(prfx.stripMediaExtension(clipName)));
    text = prfx.exportSafeName(text);
    return text || (prfx.exportSafeName(sequenceName) + ' - ' + padded);
};

prfx.queueCutsToEncoder = function (publicSequence, qeSequence, presetName, namePattern, mergeTouchingSameSource) {
    var presets = prfx.eprPresetList(), preset = null, i, snapshot, selected, ranges = [], seen = {}, key;
    var extension, projectFile, outputFolder, originalIn, originalOut, queued = 0, failures = [], detail;
    var outputPath, baseName, result, readBack, frameSeconds, presetPath, clip;
    var skippedSynthetic = 0, rawCount = 0;

    if (!prfx.encoderAvailable()) {
        return 'ERROR: This Premiere build does not expose app.encoder.encodeSequence, so PR FX cannot queue to Media Encoder.';
    }
    // Premiere 26 ignores the preset argument -- it falls back to AME's default
    // or last-used settings whatever we pass, verified with both the original
    // path and a space-free staged copy. The .epr is still passed in case a
    // future build honours it, but the result message never claims it applied.
    if (presetName) for (i = 0; i < presets.length; i++) if (presets[i].name === presetName) { preset = presets[i]; break; }
    if (!preset && presets.length) preset = presets[0];
    if (!preset) preset = { name: '', path: '' };
    extension = prfx.eprOutputExtension(preset.path);
    presetPath = preset.path;

    snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence, false);
    selected = snapshot.selected;
    if (!selected.length) {
        if (snapshot.staleSelectionCount) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        return 'ERROR: Select the Timeline clips you want queued. Each one becomes a separate Media Encoder job.';
    }
    frameSeconds = 1 / 30;
    try { if (Number(publicSequence.videoFrameRate) > 0) frameSeconds = 1 / Number(publicSequence.videoFrameRate); } catch (rateError) {}
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        // Audio comes along as the linked partner of a video clip and describes
        // the same stretch of timeline, so ranges are taken from video only.
        if (detail.kind !== 'video') continue;
        clip = prfx.resolveMovePublicClipAt(publicSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
        if (!clip) continue;
        if (!prfx.clipIsMediaSource(clip)) { skippedSynthetic++; continue; }
        key = Number(detail.start).toFixed(4) + ':' + Number(detail.end).toFixed(4);
        if (seen[key]) continue;
        seen[key] = true;
        ranges.push({ start: detail.start, end: detail.end, name: detail.name, source: prfx.clipSourceId(clip) });
    }
    if (!ranges.length) {
        if (skippedSynthetic) return 'ERROR: The selection only contains adjustment layers, mattes or graphics. Select the video or image clips you want exported.';
        return 'ERROR: Select video or image clips on the Timeline. Audio-only selections do not define an export range.';
    }
    rawCount = ranges.length;
    ranges = prfx.mergeExportRanges(ranges, mergeTouchingSameSource === true, frameSeconds);
    if (ranges.length > 100) {
        return 'ERROR: That selection would queue ' + ranges.length + ' Media Encoder jobs. Select fewer than 100 clips.';
    }

    try { projectFile = new File(app.project.path); } catch (pathError) { projectFile = null; }
    if (!projectFile || !projectFile.parent || !String(app.project.path || '').length) {
        return 'ERROR: Save the project first - PR FX writes exports beside the project file.';
    }
    outputFolder = new Folder(projectFile.parent.fsName + '/PR FX Exports');
    if (!outputFolder.exists && !outputFolder.create()) {
        return 'ERROR: Could not create the export folder at ' + outputFolder.fsName + '.';
    }

    try { originalIn = publicSequence.getInPointAsTime(); } catch (inError) { originalIn = null; }
    try { originalOut = publicSequence.getOutPointAsTime(); } catch (outError) { originalOut = null; }

    try { app.encoder.launchEncoder(); } catch (launchError) {}

    for (i = 0; i < ranges.length; i++) {
        try {
            publicSequence.setInPoint(ranges[i].start);
            publicSequence.setOutPoint(ranges[i].end);
        } catch (setError) {
            failures.push(ranges[i].name + ' (In/Out could not be set)');
            continue;
        }
        // Confirm the range actually took before queueing. A job built on the
        // wrong In/Out renders silently and is only discovered hours later.
        readBack = NaN;
        try { readBack = Number(publicSequence.getInPointAsTime().seconds); } catch (readError) { readBack = NaN; }
        if (isNaN(readBack) || Math.abs(readBack - ranges[i].start) > frameSeconds) {
            failures.push(ranges[i].name + ' (Premiere did not accept the In point)');
            continue;
        }
        baseName = prfx.expandExportNamePattern(namePattern, publicSequence.name, i + 1, ranges[i].name);
        outputPath = outputFolder.fsName + '/' + baseName + (extension ? '.' + extension : '');
        try {
            // workAreaType 1 = in-to-out. Queue only; the editor starts the
            // batch in AME when they are ready for the machine to be busy.
            result = app.encoder.encodeSequence(publicSequence, outputPath, presetPath, 1, 0, 0);
            if (result === false) failures.push(ranges[i].name + ' (Media Encoder rejected the job)');
            else queued++;
        } catch (encodeError) {
            failures.push(ranges[i].name + ' (' + encodeError.toString() + ')');
        }
    }

    try { if (originalIn) publicSequence.setInPoint(Number(originalIn.seconds)); } catch (restoreInError) {}
    try { if (originalOut) publicSequence.setOutPoint(Number(originalOut.seconds)); } catch (restoreOutError) {}

    if (!queued) {
        return 'ERROR: No jobs were queued. ' + (failures.length ? failures[0] : 'Media Encoder did not accept the sequence.');
    }
    return 'Queued ' + queued + ' job' + (queued === 1 ? '' : 's') + ' to Media Encoder. ' +
        'Premiere 26 ignores the export preset, so set the format in AME - select all jobs and edit once. ' +
        'Output: ' + outputFolder.fsName + '.' +
        (rawCount > ranges.length ? ' Merged ' + rawCount + ' clips into ' + ranges.length + ' range' + (ranges.length === 1 ? '' : 's') + '.' : '') +
        (skippedSynthetic ? ' Skipped ' + skippedSynthetic + ' adjustment layer/graphic.' : '') +
        (failures.length ? ' ' + failures.length + ' clip' + (failures.length === 1 ? '' : 's') + ' failed: ' + failures.join('; ') + '.' : '');
};

// ---------------------------------------------------------------------------
// Place selected bin clips onto the Timeline
//
// This CREATES clips, which is the operation that destroyed an adjustment layer
// during the Duplicate attempt. The cause was never overwriteClip itself but
// where Premiere decides to put things: it routes A/V by TRACK TARGETING, not
// by the track object you address, so a companion audio stream lands on a lane
// you never chose and overwrites whatever is there. Nothing restores it.
//
// The fix is to make that impossible rather than to detect it afterwards. Every
// write goes to staging tracks appended at the end of the sequence and verified
// empty first, so there is nothing on them to destroy. Only once the clips
// exist and have been checked are they moved into place with moveToTrack --
// the same primitive Move and Stagger use, which never overwrites.
//
// The whole run sits inside an undo checkpoint. Any failure rewinds to it.
// ---------------------------------------------------------------------------
prfx.selectedProjectItems = function () {
    var raw = null, items = [], i, viewIDs;
    try { raw = app.getCurrentProjectViewSelection ? app.getCurrentProjectViewSelection() : null; } catch (currentError) { raw = null; }
    if (!raw || !raw.length) {
        try {
            viewIDs = app.getProjectViewIDs ? app.getProjectViewIDs() : null;
            if (viewIDs && viewIDs.length) raw = app.getProjectViewSelection(viewIDs[0]);
        } catch (viewError) { raw = raw || null; }
    }
    if (!raw) return items;
    for (i = 0; i < Number(raw.length || 0); i++) {
        try { if (raw[i]) items.push(raw[i]); } catch (itemError) {}
    }
    return items;
};

prfx.projectItemIsPlaceable = function (item) {
    var path = '';
    try { if (item.isSequence && item.isSequence()) return false; } catch (sequenceError) {}
    try { path = String(item.getMediaPath ? item.getMediaPath() : ''); } catch (pathError) { path = ''; }
    return path.length > 0;
};

// Appends one video and one audio track and confirms both are empty. An empty
// destination is the entire safety guarantee here, so it is checked rather
// than assumed.
prfx.createStagingTracks = function (publicSequence, qeSequence) {
    var addError, live, videoIndex, audioIndex, state;
    addError = prfx.addMoveDestinationTrack(qeSequence, 'video', 0, 0);
    if (addError) return { ok: false, message: addError };
    live = app.project.activeSequence;
    videoIndex = Number(live.videoTracks.numTracks) - 1;
    addError = prfx.addMoveDestinationTrack(qeSequence, 'audio', Number(live.audioTracks.numTracks), 0);
    if (addError) return { ok: false, message: addError };
    live = app.project.activeSequence;
    audioIndex = Number(live.audioTracks.numTracks) - 1;
    state = { videoIndex: videoIndex, audioIndex: audioIndex, extra: { video: [], audio: [] } };
    if (!prfx.stagingTrackEmpty(live, 'video', videoIndex) || !prfx.stagingTrackEmpty(live, 'audio', audioIndex)) {
        return { ok: false, message: 'the new staging tracks did not come up empty' };
    }
    return { ok: true, tracks: state };
};

// Placing used to fail outright when every existing track was occupied at the
// playhead: "there are not enough free video tracks ... Add tracks or move the
// playhead", and the whole run rolled back. A sequence that has not been set up
// in advance is the normal case, so placement makes the room it needs.
//
// The new track is appended above the staging track, using the same append that
// createStagingTracks uses -- inserting between tracks renumbers existing clips,
// appending never does. That leaves the staging indices, which the replace paths
// also rely on, untouched for the rest of the run. removeStagingTracks then
// takes the staging track out from under these, so anything recorded above it
// shifts down one; settleCreatedTrackIndexes applies that before the placed
// clips are reselected.
prfx.appendPlacementTrack = function (staging, kind) {
    var live, qeSequence, before, addError, newIndex;
    try { app.enableQE(); qeSequence = qe.project.getActiveSequence(); } catch (bindError) { qeSequence = null; }
    if (!qeSequence) throw new Error('Premiere did not publish the active sequence while adding a ' + kind + ' track');
    live = app.project.activeSequence;
    before = Number(kind === 'audio' ? live.audioTracks.numTracks : live.videoTracks.numTracks);
    addError = prfx.addMoveDestinationTrack(qeSequence, kind, before, 0);
    if (addError) throw new Error(addError);
    newIndex = before;
    live = app.project.activeSequence;
    if (!prfx.stagingTrackEmpty(live, kind, newIndex)) {
        throw new Error('the ' + kind + ' track Premiere added did not come up empty');
    }
    if (!staging.tracks.extra) staging.tracks.extra = { video: [], audio: [] };
    staging.tracks.extra[kind].push(newIndex);
    return newIndex;
};

// The staging lane has to be unusable as a destination without hiding the lanes
// above it, which is where appended tracks live. Truncating the snapshot to the
// staging index removed both.
prfx.maskStagingLanes = function (snapshot, staging) {
    var blocked = { locked: true, intervals: [] };
    if (snapshot.tracks.video[staging.tracks.videoIndex]) snapshot.tracks.video[staging.tracks.videoIndex] = blocked;
    if (snapshot.tracks.audio[staging.tracks.audioIndex]) snapshot.tracks.audio[staging.tracks.audioIndex] = blocked;
};

prfx.settleCreatedTrackIndexes = function (staging, created) {
    var i, entry, stagingIndex;
    for (i = 0; i < created.length; i++) {
        entry = created[i];
        stagingIndex = entry.kind === 'audio' ? staging.tracks.audioIndex : staging.tracks.videoIndex;
        if (entry.trackIndex > stagingIndex) entry.trackIndex--;
    }
    return created;
};

prfx.appendedTrackNote = function (staging) {
    var extra = staging.tracks && staging.tracks.extra;
    var total = extra ? (extra.video.length + extra.audio.length) : 0;
    if (!total) return '';
    return ' Added ' + total + ' track' + (total === 1 ? '' : 's') + ' to make room.';
};

prfx.stagingTrackEmpty = function (sequence, kind, index) {
    var tracks = kind === 'audio' ? sequence.audioTracks : sequence.videoTracks, track, clips;
    try { track = tracks[index]; clips = track.clips; return Number(clips.numItems || clips.length || 0) === 0; }
    catch (error) { return false; }
};

prfx.stagingTrackClips = function (sequence, kind, index) {
    var tracks = kind === 'audio' ? sequence.audioTracks : sequence.videoTracks, track, clips, count, i, out = [];
    try { track = tracks[index]; clips = track.clips; count = Number(clips.numItems || clips.length || 0); } catch (error) { return out; }
    for (i = 0; i < count; i++) {
        try { out.push(clips[i]); } catch (clipError) {}
    }
    return out;
};

prfx.removeStagingTracks = function (qeSequence, tracks) {
    var live;
    try {
        app.enableQE();
        live = qe.project.getActiveSequence();
        if (!live) return;
        // Highest indices first so removing one does not renumber the other.
        try { live.removeAudioTrack(tracks.audioIndex); } catch (audioError) {}
        try { live.removeVideoTrack(tracks.videoIndex); } catch (videoError) {}
    } catch (error) {}
};

// Finds the lowest track pair with room for every span, so placed clips do not
// land on existing work. Returns null when nothing fits.
prfx.freeDestinationTrack = function (snapshot, kind, spans) {
    var laneCount = snapshot.tracks[kind].length, trackIndex, lane, i, j, fits, interval;
    for (trackIndex = 0; trackIndex < laneCount; trackIndex++) {
        lane = snapshot.tracks[kind][trackIndex];
        if (!lane || lane.locked) continue;
        fits = true;
        for (i = 0; i < spans.length && fits; i++) {
            for (j = 0; j < lane.intervals.length; j++) {
                interval = lane.intervals[j];
                if (prfx.moveRangesOverlap(spans[i].start, spans[i].end, interval.start, interval.end)) { fits = false; break; }
            }
        }
        if (fits) return trackIndex;
    }
    return null;
};

prfx.placeSelectedProjectItems = function (publicSequence, qeSequence) {
    var items = prfx.selectedProjectItems(), placeable = [], i, skipped = 0;
    var checkpoint, staging, live, playhead, cursor, clip;
    var videoTarget = null, audioTarget = null, failure = null, snapshot, created = [];
    var staged, kind, fromIndex, target, span, placedAudio, j;

    if (!items.length) return 'ERROR: Select one or more clips in the Project panel first.';
    for (i = 0; i < items.length; i++) {
        if (prfx.projectItemIsPlaceable(items[i])) placeable.push(items[i]);
        else skipped++;
    }
    if (!placeable.length) return 'ERROR: None of the selected Project items are placeable media. Sequences and bins cannot be placed.';

    try { playhead = publicSequence.getPlayerPosition(); } catch (playheadError) { playhead = null; }
    cursor = prfx.timeInSeconds(playhead);
    if (!(cursor >= 0)) return 'ERROR: Premiere could not read the playhead position.';

    checkpoint = prfx.undoCheckpoint();
    staging = prfx.createStagingTracks(publicSequence, qeSequence);
    if (!staging.ok) {
        prfx.revertToUndoCheckpoint(checkpoint, 12);
        return 'ERROR: Could not prepare a safe staging track - ' + staging.message + '. Nothing was placed.';
    }

    try {
        // One item at a time: stage it, then move it off, leaving the staging
        // tracks empty for the next. Batching them onto the video staging track
        // could not represent an audio-only file at all, so music and voiceover
        // failed outright.
        for (i = 0; i < placeable.length; i++) {
            // keepRange: place what the editor marked. Widening is a Replace
            // concern, and here it produced ten-hour clips running past the media.
            staged = prfx.stageOneProjectItem(staging.tracks, placeable[i], cursor, true);
            kind = staged.audioOnly ? 'audio' : 'video';
            fromIndex = staged.fromTrackIndex;

            live = app.project.activeSequence;
            snapshot = prfx.moveSelectionSnapshot(live, qe.project.getActiveSequence(), false);
            prfx.maskStagingLanes(snapshot, staging);
            span = [{ start: staged.start, end: staged.end }];

            // Keep the run on one row where possible: reuse the track already
            // chosen for this kind, and only look elsewhere if it is occupied.
            target = kind === 'audio' ? audioTarget : videoTarget;
            if (target === null || target === undefined ||
                !prfx.trackHasRoom(snapshot, kind, target, staged.start, staged.end, null)) {
                target = prfx.freeDestinationTrack(snapshot, kind, span);
            }
            if (target === null || target === undefined) target = prfx.appendPlacementTrack(staging, kind);
            if (kind === 'audio') audioTarget = target; else videoTarget = target;

            if (staged.audioOnly) {
                placedAudio = prfx.placeStagedAudioClips(staging, staged.audioClips, null, audioTarget,
                    '"' + String(placeable[i].name) + '"');
                for (j = 0; j < placedAudio.length; j++) created.push(placedAudio[j]);
                if (placedAudio.length) audioTarget = placedAudio[0].trackIndex;
            } else {
                prfx.moveStagedClipToTrack(kind, fromIndex, target, staged.start, staged.end, '"' + String(placeable[i].name) + '"');
                created.push({ kind: kind, trackIndex: target, start: staged.start, end: staged.end });
            }
            cursor = staged.end;

            // An A/V item brings its audio. Targeting decides where that lands,
            // so it has to be pulled down to a real lane rather than left
            // wherever Premiere happened to put it.
            if (!staged.audioOnly && staged.audioClips && staged.audioClips.length) {
                placedAudio = prfx.placeStagedAudioClips(staging, staged.audioClips, null, audioTarget,
                    '"' + String(placeable[i].name) + '"');
                for (j = 0; j < placedAudio.length; j++) created.push(placedAudio[j]);
                if (placedAudio.length) audioTarget = placedAudio[0].trackIndex;
            }
        }
    } catch (error) {
        failure = error.toString();
    }

    prfx.removeStagingTracks(qeSequence, staging.tracks);

    if (failure) {
        prfx.revertUnlessKeeping(checkpoint, placeable.length * 8 + 20);
        return 'ERROR: Placing stopped and ' + prfx.failureOutcomeText() + ' - ' + failure;
    }

    // The staging tracks are gone, so anything placed above them has moved down
    // a row. Report and reselect the rows the editor can actually see.
    prfx.settleCreatedTrackIndexes(staging, created);
    if (videoTarget > staging.tracks.videoIndex) videoTarget--;
    if (audioTarget > staging.tracks.audioIndex) audioTarget--;
    prfx.selectClipRanges(app.project.activeSequence, created);

    return 'Placed ' + created.length + ' clip' + (created.length === 1 ? '' : 's') + ' (video plus any linked audio) from the Project panel, back to back from the playhead' +
        (videoTarget !== null && videoTarget !== undefined ? ' on V' + (videoTarget + 1) : '') +
        (audioTarget !== null && audioTarget !== undefined ? (videoTarget !== null && videoTarget !== undefined ? ' and' : ' on') + ' A' + (audioTarget + 1) : '') + '.' +
        prfx.appendedTrackNote(staging) +
        (skipped ? ' Skipped ' + skipped + ' non-media item' + (skipped === 1 ? '' : 's') + '.' : '');
};

// overwriteClip writes the project item's CURRENT bin in/out range, not the
// whole media, so a clip someone trimmed in the Source monitor lands short --
// and a short replacement cannot fill the edit it is replacing.
prfx.projectItemRange = function (item) {
    var inSeconds, outSeconds;
    try {
        inSeconds = prfx.timeInSeconds(item.getInPoint());
        outSeconds = prfx.timeInSeconds(item.getOutPoint());
    } catch (error) { return null; }
    if (isNaN(inSeconds) || isNaN(outSeconds)) return null;
    return { inSeconds: inSeconds, outSeconds: outSeconds };
};

// The media-type argument to setInPoint/setOutPoint is undocumented, so every
// plausible form is tried and the result is READ BACK. Guessing it and
// swallowing the error makes the widening silently do nothing.
prfx.PROJECT_ITEM_MEDIA_TYPES = [4, 1, 0, 2];

prfx.expandProjectItemRange = function (item) {
    var saved = prfx.projectItemRange(item), i, after, best = null, bestSpan;
    if (!saved) return { saved: null, expanded: false, reason: 'the bin item has no readable in/out range' };
    bestSpan = saved.outSeconds - saved.inSeconds;
    for (i = 0; i < prfx.PROJECT_ITEM_MEDIA_TYPES.length; i++) {
        try {
            item.setInPoint(0, prfx.PROJECT_ITEM_MEDIA_TYPES[i]);
            item.setOutPoint(36000, prfx.PROJECT_ITEM_MEDIA_TYPES[i]);
        } catch (writeError) { continue; }
        after = prfx.projectItemRange(item);
        if (!after) continue;
        // Premiere clamps an over-long out point to the real media end, so a
        // widened span is proof the call actually landed.
        if (after.outSeconds - after.inSeconds > bestSpan + 0.0001) {
            best = after;
            bestSpan = after.outSeconds - after.inSeconds;
        }
    }
    if (!best) return { saved: saved, expanded: false, reason: 'Premiere would not widen the bin in/out range' };
    return { saved: saved, expanded: true, range: best };
};

prfx.restoreProjectItemRange = function (item, state) {
    var i;
    if (!state || !state.saved || !state.expanded) return;
    for (i = 0; i < prfx.PROJECT_ITEM_MEDIA_TYPES.length; i++) {
        try {
            item.setOutPoint(state.saved.outSeconds, prfx.PROJECT_ITEM_MEDIA_TYPES[i]);
            item.setInPoint(state.saved.inSeconds, prfx.PROJECT_ITEM_MEDIA_TYPES[i]);
        } catch (restoreError) {}
    }
};

prfx.applyProjectItemSourceRange = function (item, sourceState) {
    var saved = prfx.projectItemRange(item), inSeconds, outSeconds, i, after;
    if (!sourceState || (sourceState.inTicks === '' && sourceState.outTicks === '')) {
        return { saved: saved, expanded: false, reason: 'no source range requested' };
    }
    if (!saved) return { saved: null, expanded: false, reason: 'the bin item has no readable in/out range' };

    inSeconds = sourceState.inTicks !== '' ? prfx.secondsForTicks(sourceState.inTicks) : saved.inSeconds;
    outSeconds = sourceState.outTicks !== '' ? prfx.secondsForTicks(sourceState.outTicks) : saved.outSeconds;
    if (isNaN(inSeconds) || isNaN(outSeconds) || outSeconds <= inSeconds) {
        return { saved: saved, expanded: false, reason: 'the original clip source range is invalid' };
    }

    for (i = 0; i < prfx.PROJECT_ITEM_MEDIA_TYPES.length; i++) {
        try {
            // Write Out first so a range whose In is beyond the current bin Out
            // does not get clamped/refused before the range has been widened.
            item.setOutPoint(outSeconds, prfx.PROJECT_ITEM_MEDIA_TYPES[i]);
            item.setInPoint(inSeconds, prfx.PROJECT_ITEM_MEDIA_TYPES[i]);
        } catch (writeError) {}
    }

    after = prfx.projectItemRange(item);
    if (!after) return { saved: saved, expanded: false, reason: 'the staged bin in/out could not be read back' };
    if (Math.abs(after.inSeconds - inSeconds) > 0.02 || Math.abs(after.outSeconds - outSeconds) > 0.02) {
        return {
            saved: saved,
            expanded: false,
            reason: 'Premiere did not accept the original source range (' +
                inSeconds.toFixed(3) + '-' + outSeconds.toFixed(3) +
                's, got ' + after.inSeconds.toFixed(3) + '-' + after.outSeconds.toFixed(3) + 's)'
        };
    }
    return {
        saved: saved,
        expanded: true,
        sourceRange: true,
        requested: { inSeconds: inSeconds, outSeconds: outSeconds },
        range: after
    };
};

// Explains where a staged length came from, so a short stage caused by a bin
// trim is distinguishable from genuinely short media.
prfx.describeStagedRange = function () {
    var state = prfx.lastStagedRange;
    if (!state) return 'no bin range recorded';
    if (!state.saved) return 'bin in/out unreadable: ' + (state.reason || 'unknown');
    if (!state.expanded) {
        return 'bin in/out ' + state.saved.inSeconds.toFixed(2) + '-' + state.saved.outSeconds.toFixed(2) +
            ', NOT widened: ' + (state.reason || 'unknown');
    }
    if (state.sourceRange && state.requested) {
        return 'bin in/out was ' + state.saved.inSeconds.toFixed(2) + '-' + state.saved.outSeconds.toFixed(2) +
            ', staged from source range ' + state.requested.inSeconds.toFixed(2) + '-' +
            state.requested.outSeconds.toFixed(2) + ' and read back ' +
            state.range.inSeconds.toFixed(2) + '-' + state.range.outSeconds.toFixed(2);
    }
    return 'bin in/out was ' + state.saved.inSeconds.toFixed(2) + '-' + state.saved.outSeconds.toFixed(2) +
        ', widened to ' + state.range.inSeconds.toFixed(2) + '-' + state.range.outSeconds.toFixed(2);
};

// Writes one project item onto the staging video track and returns the clips it
// produced. The track must be empty on entry; anything else means a previous
// step leaked and the caller should abort rather than guess which clip is new.
// keepRange honours the item's current in/out instead of widening to the whole
// media. Replace wants the full media (it trims to the edit itself); a clip the
// editor has just marked up in the Source monitor must land exactly as marked.
// Where a written clip actually lands is decided by Premiere's track targeting,
// not by the track object we address. For an audio-only item nothing arrives on
// the staging video track and the audio can arrive on ANY targeted audio track,
// so the only reliable way to find the new clip is to diff the sequence.
prfx.trackContentsMap = function (sequence, kind) {
    var map = {}, tracks, count, t, clips, clipCount, i, clip;
    tracks = kind === 'audio' ? sequence.audioTracks : sequence.videoTracks;
    count = tracks ? Number(tracks.numTracks || tracks.length || 0) : 0;
    for (t = 0; t < count; t++) {
        try { clips = tracks[t].clips; clipCount = Number(clips.numItems || clips.length || 0); }
        catch (trackError) { clipCount = 0; }
        for (i = 0; i < clipCount; i++) {
            try { clip = clips[i]; } catch (clipError) { continue; }
            if (!clip) continue;
            map[t + ':' + prfx.timeInSeconds(clip.start).toFixed(4) + ':' + prfx.timeInSeconds(clip.end).toFixed(4)] = true;
        }
    }
    return map;
};

prfx.newClipsSince = function (sequence, kind, before) {
    var out = [], tracks, count, t, clips, clipCount, i, clip, key;
    tracks = kind === 'audio' ? sequence.audioTracks : sequence.videoTracks;
    count = tracks ? Number(tracks.numTracks || tracks.length || 0) : 0;
    for (t = 0; t < count; t++) {
        try { clips = tracks[t].clips; clipCount = Number(clips.numItems || clips.length || 0); }
        catch (trackError) { clipCount = 0; }
        for (i = 0; i < clipCount; i++) {
            try { clip = clips[i]; } catch (clipError) { continue; }
            if (!clip) continue;
            key = t + ':' + prfx.timeInSeconds(clip.start).toFixed(4) + ':' + prfx.timeInSeconds(clip.end).toFixed(4);
            if (!before[key]) out.push({ clip: clip, trackIndex: t, start: prfx.timeInSeconds(clip.start), end: prfx.timeInSeconds(clip.end) });
        }
    }
    return out;
};

// Moves every staged audio clip onto a free lane. `used` marks lanes taken by
// this run (a column wants one clip per lane); pass null to let a row reuse the
// same lanes across items.
prfx.placeStagedAudioClips = function (staging, clips, used, preferTrack, label) {
    var out = [], i, entry, live, snapshot, target, trackIndex, laneCount;
    for (i = 0; i < clips.length; i++) {
        entry = clips[i];
        live = app.project.activeSequence;
        snapshot = prfx.moveSelectionSnapshot(live, qe.project.getActiveSequence(), false);
        prfx.maskStagingLanes(snapshot, staging);
        laneCount = snapshot.tracks.audio.length;
        target = null;
        if (!used && preferTrack !== null && preferTrack !== undefined && preferTrack < laneCount &&
            prfx.trackHasRoom(snapshot, 'audio', preferTrack, entry.start, entry.end, null)) {
            target = preferTrack;
        }
        if (target === null) {
            for (trackIndex = 0; trackIndex < laneCount; trackIndex++) {
                if (used && used['audio' + trackIndex]) continue;
                if (prfx.trackHasRoom(snapshot, 'audio', trackIndex, entry.start, entry.end, null)) { target = trackIndex; break; }
            }
        }
        if (target === null) target = prfx.appendPlacementTrack(staging, 'audio');
        if (used) used['audio' + target] = true;
        if (target !== entry.trackIndex) {
            prfx.moveStagedClipToTrack('audio', entry.trackIndex, target, entry.start, entry.end, label + ' audio');
        }
        out.push({ kind: 'audio', trackIndex: target, start: entry.start, end: entry.end });
    }
    return out;
};

prfx.stageOneProjectItem = function (stagingTracks, item, atSeconds, keepRange, sourceState) {
    var live = app.project.activeSequence, videoClips, audioClips, rangeState = null, beforeVideo, beforeAudio;
    var earliest, latest, index;
    if (!prfx.stagingTrackEmpty(live, 'video', stagingTracks.videoIndex)) {
        throw new Error('the staging track was not empty before writing "' + String(item.name) + '"');
    }
    if (sourceState && (sourceState.inTicks !== '' || sourceState.outTicks !== '')) {
        rangeState = prfx.applyProjectItemSourceRange(item, sourceState);
        if (!rangeState.expanded) {
            throw new Error('could not stage "' + String(item.name) + '" from the original source in/out: ' +
                (rangeState.reason || 'unknown'));
        }
    } else if (!keepRange) {
        rangeState = prfx.expandProjectItemRange(item);
    }
    prfx.lastStagedRange = rangeState;
    beforeVideo = prfx.trackContentsMap(live, 'video');
    beforeAudio = prfx.trackContentsMap(live, 'audio');
    try {
        try {
            live.videoTracks[stagingTracks.videoIndex].overwriteClip(item, atSeconds);
        } catch (writeError) {
            throw new Error('Premiere refused to stage "' + String(item.name) + '": ' + writeError.toString());
        }
    } finally {
        // The bin item is shared state; never leave it modified.
        prfx.restoreProjectItemRange(item, rangeState);
    }
    live = app.project.activeSequence;
    // Diff, don't look in one place: targeting decides where the clip lands.
    videoClips = prfx.newClipsSince(live, 'video', beforeVideo);
    audioClips = prfx.newClipsSince(live, 'audio', beforeAudio);
    // Music and voiceover have no video stream at all, so an audio-only result
    // is a success, not the failure the video-only check used to report.
    // A source can publish SEVERAL audio clips -- dual mono, 5.1, split stereo.
    // Insisting on exactly one stranded every extra channel wherever targeting
    // dropped it, which is the same failure as leaving a companion behind.
    if (!videoClips.length && audioClips.length) {
        earliest = audioClips[0].start;
        latest = audioClips[0].end;
        for (index = 1; index < audioClips.length; index++) {
            if (audioClips[index].start < earliest) earliest = audioClips[index].start;
            if (audioClips[index].end > latest) latest = audioClips[index].end;
        }
        return {
            video: null,
            audio: audioClips[0].clip,
            audioClips: audioClips,
            audioOnly: true,
            fromTrackIndex: audioClips[0].trackIndex,
            audioTrackIndex: audioClips[0].trackIndex,
            start: earliest,
            end: latest
        };
    }
    if (videoClips.length !== 1) {
        throw new Error('Premiere published ' + videoClips.length + ' video and ' + audioClips.length +
            ' audio clips for "' + String(item.name) + '"; expected one video, or one audio for an audio-only file');
    }
    return {
        video: videoClips[0].clip,
        audio: audioClips.length ? audioClips[0].clip : null,
        audioClips: audioClips,
        audioOnly: false,
        fromTrackIndex: videoClips[0].trackIndex,
        audioTrackIndex: audioClips.length ? audioClips[0].trackIndex : -1,
        start: videoClips[0].start,
        end: videoClips[0].end
    };
};

// Audio-only equivalent of stageOneProjectItem. Used only when replacing a
// selected Timeline audio clip and Premiere refuses the direct source swap.
prfx.stageOneAudioProjectItem = function (stagingTracks, item, atSeconds, keepRange, sourceState) {
    var live = app.project.activeSequence, videoClips, audioClips, rangeState = null;
    if (!prfx.stagingTrackEmpty(live, 'audio', stagingTracks.audioIndex)) {
        throw new Error('the staging audio track was not empty before writing "' + String(item.name) + '"');
    }
    if (!prfx.stagingTrackEmpty(live, 'video', stagingTracks.videoIndex)) {
        throw new Error('the staging video track was not empty before writing audio from "' + String(item.name) + '"');
    }
    if (sourceState && (sourceState.inTicks !== '' || sourceState.outTicks !== '')) {
        rangeState = prfx.applyProjectItemSourceRange(item, sourceState);
        if (!rangeState.expanded) {
            throw new Error('could not stage audio from "' + String(item.name) + '" from the original source in/out: ' +
                (rangeState.reason || 'unknown'));
        }
    } else if (!keepRange) {
        rangeState = prfx.expandProjectItemRange(item);
    }
    prfx.lastStagedRange = rangeState;
    try {
        try {
            live.audioTracks[stagingTracks.audioIndex].overwriteClip(item, atSeconds);
        } catch (writeError) {
            throw new Error('Premiere refused to stage audio from "' + String(item.name) + '": ' + writeError.toString());
        }
    } finally {
        prfx.restoreProjectItemRange(item, rangeState);
    }
    live = app.project.activeSequence;
    audioClips = prfx.stagingTrackClips(live, 'audio', stagingTracks.audioIndex);
    videoClips = prfx.stagingTrackClips(live, 'video', stagingTracks.videoIndex);
    if (audioClips.length !== 1) {
        throw new Error('Premiere published ' + audioClips.length + ' audio clips for "' + String(item.name) + '" instead of one');
    }
    if (videoClips.length > 1) {
        throw new Error('Premiere published ' + videoClips.length + ' video companion clips for "' + String(item.name) + '" instead of one or none');
    }
    return {
        video: videoClips.length === 1 ? videoClips[0] : null,
        audio: audioClips[0],
        start: prfx.timeInSeconds(audioClips[0].start),
        end: prfx.timeInSeconds(audioClips[0].end)
    };
};

// Moves a clip off the staging track onto a real one. Track offset only -- the
// clip is already at its final time, so nothing shifts horizontally.
prfx.moveStagedClipToTrack = function (kind, fromTrackIndex, toTrackIndex, start, end, label) {
    var qeSequence, qeClip, offset, present;
    app.enableQE();
    qeSequence = qe.project.getActiveSequence();
    qeClip = prfx.resolveMoveQEClipAt(qeSequence, { kind: kind }, fromTrackIndex, start, end);
    if (!qeClip) {
        // Say what is actually on the staging track. "Lost track of a clip" on
        // its own gives nothing to work from.
        present = prfx.describeTrackOccupants(app.project.activeSequence, kind, fromTrackIndex, start);
        throw new Error('could not find the staged ' + kind + ' clip for ' + (label || 'the replacement') +
            ' at ' + Number(start).toFixed(3) + '-' + Number(end).toFixed(3) +
            '; the staging ' + kind + ' track holds: ' + present);
    }
    offset = toTrackIndex - fromTrackIndex;
    if (offset === 0) return;
    if ((kind === 'audio' ? qeClip.moveToTrack(0, offset, '00:00:00:00', 0)
                          : qeClip.moveToTrack(offset, 0, '00:00:00:00', 0)) === false) {
        throw new Error('Premiere rejected moving a staged clip onto ' + kind + ' track ' + (toTrackIndex + 1));
    }
};

prfx.trackHasRoom = function (snapshot, kind, trackIndex, start, end, ignoreRanges) {
    var lane = snapshot.tracks[kind][trackIndex], i, j, interval, ignored;
    if (!lane || lane.locked) return false;
    for (i = 0; i < lane.intervals.length; i++) {
        interval = lane.intervals[i];
        if (!prfx.moveRangesOverlap(start, end, interval.start, interval.end)) continue;
        ignored = false;
        for (j = 0; ignoreRanges && j < ignoreRanges.length; j++) {
            if (Math.abs(ignoreRanges[j].start - interval.start) < 0.0001 && Math.abs(ignoreRanges[j].end - interval.end) < 0.0001) { ignored = true; break; }
        }
        if (!ignored) return false;
    }
    return true;
};

// Place each selected bin clip at the SAME start time, stacked one per track --
// a column rather than a row.
prfx.placeSelectedProjectItemsAsColumn = function (publicSequence, qeSequence) {
    var items = prfx.selectedProjectItems(), placeable = [], i, skipped = 0;
    var checkpoint, staging, live, playhead, atSeconds, failure = null, used = {}, created = [];
    var stagedClip, snapshot, trackIndex, target, laneCount, clip, kind, fromIndex, placedAudio, j;

    if (!items.length) return 'ERROR: Select one or more clips in the Project panel first.';
    for (i = 0; i < items.length; i++) {
        if (prfx.projectItemIsPlaceable(items[i])) placeable.push(items[i]);
        else skipped++;
    }
    if (!placeable.length) return 'ERROR: None of the selected Project items are placeable media. Sequences and bins cannot be placed.';

    try { playhead = publicSequence.getPlayerPosition(); } catch (playheadError) { playhead = null; }
    atSeconds = prfx.timeInSeconds(playhead);
    if (!(atSeconds >= 0)) return 'ERROR: Premiere could not read the playhead position.';

    checkpoint = prfx.undoCheckpoint();
    staging = prfx.createStagingTracks(publicSequence, qeSequence);
    if (!staging.ok) {
        prfx.revertToUndoCheckpoint(checkpoint, 12);
        return 'ERROR: Could not prepare a safe staging track - ' + staging.message + '. Nothing was placed.';
    }

    try {
        for (i = 0; i < placeable.length; i++) {
            // One at a time: stage it, move it off, leaving the staging track
            // empty again for the next. Two clips on one staging track at the
            // same start would overwrite each other.
            stagedClip = prfx.stageOneProjectItem(staging.tracks, placeable[i], atSeconds, true);
            // Audio-only files have no video stream to stack, so they take their
            // own column on the audio side.
            kind = stagedClip.audioOnly ? 'audio' : 'video';
            fromIndex = stagedClip.fromTrackIndex;
            live = app.project.activeSequence;
            snapshot = prfx.moveSelectionSnapshot(live, qe.project.getActiveSequence(), false);
            prfx.maskStagingLanes(snapshot, staging);
            laneCount = snapshot.tracks[kind].length;
            target = null;
            for (trackIndex = 0; trackIndex < laneCount; trackIndex++) {
                if (used[kind + trackIndex]) continue;
                if (prfx.trackHasRoom(snapshot, kind, trackIndex, stagedClip.start, stagedClip.end, null)) { target = trackIndex; break; }
            }
            // Every existing lane is taken at this point, so make one rather
            // than refusing the whole column.
            if (target === null) target = prfx.appendPlacementTrack(staging, kind);
            if (stagedClip.audioOnly) {
                placedAudio = prfx.placeStagedAudioClips(staging, stagedClip.audioClips, used, null,
                    '"' + String(placeable[i].name) + '"');
                for (j = 0; j < placedAudio.length; j++) created.push(placedAudio[j]);
            } else {
                used[kind + target] = true;
                prfx.moveStagedClipToTrack(kind, fromIndex, target, stagedClip.start, stagedClip.end);
                created.push({ kind: kind, trackIndex: target, start: stagedClip.start, end: stagedClip.end });
            }
            // The companion audio gets its own lane in the column, chosen the
            // same way as the video: lowest free track not already used here.
            if (!stagedClip.audioOnly && stagedClip.audioClips && stagedClip.audioClips.length) {
                placedAudio = prfx.placeStagedAudioClips(staging, stagedClip.audioClips, used, null,
                    '"' + String(placeable[i].name) + '"');
                for (j = 0; j < placedAudio.length; j++) created.push(placedAudio[j]);
            }
        }
    } catch (error) {
        failure = error.toString();
    }

    prfx.removeStagingTracks(qeSequence, staging.tracks);

    if (failure) {
        prfx.revertUnlessKeeping(checkpoint, placeable.length * 10 + 20);
        return 'ERROR: Placing stopped and ' + prfx.failureOutcomeText() + ' - ' + failure;
    }

    prfx.settleCreatedTrackIndexes(staging, created);
    prfx.selectClipRanges(app.project.activeSequence, created);

    return 'Placed ' + created.length + ' clip' + (created.length === 1 ? '' : 's') + ' as a column at the playhead, one per video track.' +
        prfx.appendedTrackNote(staging) +
        (skipped ? ' Skipped ' + skipped + ' non-media item' + (skipped === 1 ? '' : 's') + '.' : '');
};

// ---------------------------------------------------------------------------
// Replace selected Timeline clips with the selected bin clip
//
// Each target keeps its exact track, start, end AND speed. The replacement is
// staged, retimed to the original's speed, trimmed to the original's duration,
// and only then swapped in -- the original is lifted first so the move lands in
// a gap and can never overwrite a neighbour.
//
// Refuses per clip rather than approximating: a replacement that cannot cover
// the original's duration at the required speed leaves the timeline untouched.
// ---------------------------------------------------------------------------
// Replaces one Timeline clip with one project item, preserving track, position,
// length and speed, and swapping the linked audio when there is one.
// Throws on any problem so the caller can roll the whole run back.
prfx.replaceOneAudioTarget = function (staging, detail, source, frameSeconds, results) {
    var live, clip, staged, qeClip, speed, reversed, durationSeconds, timecode, endTime, direct, writeProblem;
    var capturedAudio, attributesAudio, transitions, newClip, restored, sourceState, mismatches, m;
    var beforeStart, probe, audioRange, companionVideo, sourceCategory;

    sourceCategory = prfx.mediaCategoryOf(prfx.projectItemExtension(source));
    if (sourceCategory === 'image') {
        throw new Error('"' + String(source.name) + '" is an image/still and cannot replace an audio clip');
    }

    durationSeconds = detail.end - detail.start;
    live = app.project.activeSequence;
    clip = prfx.resolveMovePublicClipAt(live, detail, detail.sourceTrackIndex, detail.start, detail.end);
    if (!clip) throw new Error('lost track of "' + detail.name + '" before replacing its audio');

    // Direct swap is the best audio path: it keeps clip gain, effects, keyframes,
    // source range, speed and links because the existing audio clip remains alive.
    capturedAudio = prfx.captureComponentState(clip);
    attributesAudio = prfx.captureClipAttributes(clip);
    direct = prfx.tryDirectSourceSwap(live, detail, source, frameSeconds);
    if (direct.ok) {
        prfx.lastDirectSwaps++;
        if (direct.sourceRangeWarning) {
            throw new Error('could not restore the source in/out of "' + detail.name + '" after swapping its audio (' +
                direct.sourceRangeWarning + ')');
        }
        live = app.project.activeSequence;
        newClip = prfx.resolveMovePublicClipAt(live, detail, detail.sourceTrackIndex, detail.start, detail.end);
        if (newClip) {
            app.enableQE();
            qeClip = prfx.resolveMoveQEClipAt(qe.project.getActiveSequence(), detail,
                detail.sourceTrackIndex, detail.start, detail.end);
            prfx.applyComponentState(qe.project.getActiveSequence(), newClip, qeClip, 'audio', capturedAudio);
            prfx.applyClipAttributes(newClip, attributesAudio);
            prfx.warnIfClipOffline(newClip, detail.name);
        }
        prfx.noteReplaceOutcome(detail, capturedAudio);
        results.push({ kind: 'audio', trackIndex: detail.sourceTrackIndex, start: detail.start, end: detail.end });
        return false;
    }
    prfx.lastDirectSwapReason = direct.reason;

    // Fallback rebuild for audio-only targets. It mirrors the video rebuild path
    // but writes to an audio staging track and moves only the audio clip back.
    clip = prfx.resolveMovePublicClipAt(live, detail, detail.sourceTrackIndex, detail.start, detail.end);
    if (!clip) throw new Error('lost track of "' + detail.name + '" before rebuilding its audio');
    try { speed = Number(clip.getSpeed()); } catch (speedError) { speed = 1; }
    if (!(speed > 0)) speed = 1;
    try { reversed = clip.isSpeedReversed() === true; } catch (reverseError) { reversed = false; }
    capturedAudio = prfx.captureComponentState(clip);
    attributesAudio = prfx.captureClipAttributes(clip);
    sourceState = prfx.clipSourceState(clip);

    transitions = prfx.captureMoveTransitions(live, [{
        kind: 'audio', sourceTrackIndex: detail.sourceTrackIndex,
        start: detail.start, end: detail.end,
        targetTrackIndex: detail.sourceTrackIndex,
        targetStart: detail.start, targetEnd: detail.end,
        name: detail.name
    }]);

    staged = prfx.stageOneAudioProjectItem(staging.tracks, source, detail.start, false, sourceState);
    if (!staged.audio) throw new Error('"' + String(source.name) + '" has no audio to replace "' + detail.name + '"');

    if (Math.abs(speed - 1) > 0.0001 || reversed) {
        app.enableQE();
        qeClip = prfx.resolveMoveQEClipAt(qe.project.getActiveSequence(), { kind: 'audio' },
            staging.tracks.audioIndex, staged.start, staged.end);
        if (!qeClip) throw new Error('lost the staged replacement audio for "' + detail.name + '" before retiming it');
        timecode = prfx.secondsToSequenceTimecode(live, durationSeconds);
        try { qeClip.setSpeed(speed, timecode, reversed, false, false); }
        catch (setSpeedError) { throw new Error('Premiere refused to set ' + Math.round(speed * 100) + '% speed on the replacement audio for "' + detail.name + '"'); }
        live = app.project.activeSequence;
        staged.audio = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0];
        staged.video = prfx.stagingTrackClips(live, 'video', staging.tracks.videoIndex)[0] || null;
        if (!staged.audio) throw new Error('the retimed replacement audio for "' + detail.name + '" disappeared');
        staged.start = prfx.timeInSeconds(staged.audio.start);
        staged.end = prfx.timeInSeconds(staged.audio.end);
    }

    if (sourceState && (sourceState.inTicks !== '' || sourceState.outTicks !== '')) {
        beforeStart = staged.start;
        writeProblem = prfx.writeClipSourceRange(staged.audio, sourceState);
        if (writeProblem) throw new Error('could not restore the source in/out of "' + detail.name + '" (' + writeProblem + ')');
        live = app.project.activeSequence;
        probe = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0];
        if (probe && Math.abs(prfx.timeInSeconds(probe.start) - beforeStart) < frameSeconds / 2) {
            if (!prfx.sourceStateMatches(prfx.clipSourceState(probe), sourceState)) {
                throw new Error('the staged audio source in/out of "' + detail.name + '" did not take');
            }
            staged.audio = probe;
            staged.start = prfx.timeInSeconds(probe.start);
            staged.end = prfx.timeInSeconds(probe.end);
            staged.video = prfx.stagingTrackClips(live, 'video', staging.tracks.videoIndex)[0] || null;
        } else if (!probe) {
            throw new Error('Premiere lost the staged audio while matching the source in/out of "' + detail.name + '"');
        } else if (probe) {
            throw new Error('Premiere moved the staged audio while matching the source in/out of "' + detail.name + '"');
        }
    }

    if (staged.end - staged.start < durationSeconds - frameSeconds / 2) {
        throw new Error('"' + String(source.name) + '" gives only ' + (staged.end - staged.start).toFixed(2) +
            's at ' + Math.round(speed * 100) + '% speed and cannot fill the ' + durationSeconds.toFixed(2) +
            's of "' + detail.name + '" [' + prfx.describeStagedRange() + ']');
    }
    if (staged.end - staged.start > durationSeconds + frameSeconds / 2) {
        try {
            endTime = new Time();
            endTime.seconds = detail.start + durationSeconds;
            staged.audio.end = endTime;
        } catch (trimError) { throw new Error('could not trim the replacement audio for "' + detail.name + '" to length'); }
        live = app.project.activeSequence;
        staged.audio = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0];
        if (!staged.audio || Math.abs(prfx.timeInSeconds(staged.audio.end) - (detail.start + durationSeconds)) > frameSeconds / 2) {
            throw new Error('the replacement audio for "' + detail.name + '" did not trim to the original length');
        }
        staged.start = prfx.timeInSeconds(staged.audio.start);
        staged.end = detail.start + durationSeconds;
        staged.video = prfx.stagingTrackClips(live, 'video', staging.tracks.videoIndex)[0] || null;
    }

    live = app.project.activeSequence;
    clip = prfx.resolveMovePublicClipAt(live, detail, detail.sourceTrackIndex, detail.start, detail.end);
    if (!clip) throw new Error('lost track of "' + detail.name + '" before lifting it');
    try { clip.remove(false, false); }
    catch (removeError) { throw new Error('Premiere refused to lift "' + detail.name + '"'); }

    live = app.project.activeSequence;
    clip = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0];
    if (!clip) {
        throw new Error('the staged audio for "' + detail.name + '" is no longer on the staging track; it holds: ' +
            prfx.describeTrackOccupants(live, 'audio', staging.tracks.audioIndex, staged.start));
    }
    audioRange = { start: prfx.timeInSeconds(clip.start), end: prfx.timeInSeconds(clip.end) };
    if (Math.abs(audioRange.start - detail.start) > frameSeconds / 2 ||
        Math.abs(audioRange.end - (detail.start + durationSeconds)) > frameSeconds / 2) {
        throw new Error('the staged audio for "' + detail.name + '" is ' +
            audioRange.start.toFixed(3) + '-' + audioRange.end.toFixed(3) +
            ' but the target is ' + detail.start.toFixed(3) + '-' + (detail.start + durationSeconds).toFixed(3));
    }

    prfx.moveStagedClipToTrack('audio', staging.tracks.audioIndex, detail.sourceTrackIndex,
        audioRange.start, audioRange.end, '"' + detail.name + '" audio');

    live = app.project.activeSequence;
    newClip = prfx.resolveMovePublicClipAt(live, { kind: 'audio' }, detail.sourceTrackIndex, detail.start, detail.start + durationSeconds);
    if (!newClip) {
        throw new Error('the replacement audio for "' + detail.name + '" did not arrive on audio track ' + (detail.sourceTrackIndex + 1) +
            '; that track holds: ' + prfx.describeTrackOccupants(live, 'audio', detail.sourceTrackIndex, detail.start));
    }
    results.push({ kind: 'audio', trackIndex: detail.sourceTrackIndex, start: detail.start, end: detail.start + durationSeconds });
    app.enableQE();
    qeClip = prfx.resolveMoveQEClipAt(qe.project.getActiveSequence(), { kind: 'audio' },
        detail.sourceTrackIndex, detail.start, detail.start + durationSeconds);
    prfx.applyComponentState(qe.project.getActiveSequence(), newClip, qeClip, 'audio', capturedAudio);
    prfx.applyClipAttributes(newClip, attributesAudio);
    mismatches = prfx.verifyComponentState(app.project.activeSequence, 'audio',
        detail.sourceTrackIndex, detail.start, detail.start + durationSeconds, capturedAudio);
    for (m = 0; m < mismatches.length; m++) prfx.lastPropertyFailures.push(mismatches[m]);
    if (transitions && transitions.length) {
        restored = prfx.restoreMoveTransitions(app.project.activeSequence, transitions, false);
        if (restored && restored.restored) prfx.lastTransitionsRestored += restored.restored;
    }

    live = app.project.activeSequence;
    try {
        companionVideo = prfx.stagingTrackClips(live, 'video', staging.tracks.videoIndex)[0];
        if (companionVideo && companionVideo.remove) companionVideo.remove(false, false);
    } catch (videoCleanupError) {}
    return false;
};

prfx.replaceOneTarget = function (staging, detail, source, frameSeconds, results) {
    var live, clip, staged, qeClip, speed, reversed, durationSeconds, timecode, endTime, direct, writeProblem;
    var audioPartner, audioDetail, audioRange, pair, relinkedHere = false;
    var capturedVideo, capturedAudio, attributesVideo, attributesAudio, transitions, newClip, restored;
    var sourceState, audioSourceState, mismatches, m, beforeStart, probe, directAudio, sourceCategory, directFallbackReason;
        if (detail.kind === 'audio') return prfx.replaceOneAudioTarget(staging, detail, source, frameSeconds, results);
        sourceCategory = prfx.mediaCategoryOf(prfx.projectItemExtension(source));
        if (sourceCategory === 'audio') throw new Error('"' + String(source.name) + '" is audio-only and cannot replace a video clip');
        durationSeconds = detail.end - detail.start;
        live = app.project.activeSequence;
        clip = prfx.resolveMovePublicClipAt(live, detail, detail.sourceTrackIndex, detail.start, detail.end);
        if (!clip) throw new Error('lost track of "' + detail.name + '" before replacing it');

        // Cheapest and most faithful route first: swap the media under the clip
        // that is already there. Nothing needs copying because nothing is
        // rebuilt -- it is still the same clip.
        //
        // The linked audio has to be swapped in the same breath. Swapping only
        // the video leaves the pair pointing at two different files, which looks
        // fine on the timeline and is wrong in every render.
        capturedVideo = prfx.captureComponentState(clip);
        attributesVideo = prfx.captureClipAttributes(clip);
        sourceState = prfx.clipSourceState(clip);
        audioPartner = prfx.linkedAudioPartner(live, clip);
        audioDetail = null;
        capturedAudio = null;
        attributesAudio = null;
        audioSourceState = null;
        if (audioPartner) {
            audioDetail = {
                kind: 'audio',
                sourceTrackIndex: Number(audioPartner.parentTrackIndex),
                trackIndex: Number(audioPartner.parentTrackIndex),
                start: prfx.timeInSeconds(audioPartner.start),
                end: prfx.timeInSeconds(audioPartner.end),
                name: detail.name
            };
            capturedAudio = prfx.captureComponentState(audioPartner);
            attributesAudio = prfx.captureClipAttributes(audioPartner);
            audioSourceState = prfx.clipSourceState(audioPartner);
        }

        direct = prfx.tryDirectSourceSwap(live, detail, source, frameSeconds);
        if (direct.ok) {
            directFallbackReason = '';
            // A direct swap that cannot preserve the source range is not safe,
            // but it also is not a hard failure. Fall through to the staging
            // rebuild path using the pre-direct state captured above.
            if (direct.sourceRangeWarning) {
                directFallbackReason = 'direct video swap could not restore source in/out (' + direct.sourceRangeWarning + ')';
            }
            if (!directFallbackReason && audioDetail) {
                directAudio = prfx.tryDirectSourceSwap(app.project.activeSequence, audioDetail, source, frameSeconds);
                if (!directAudio.ok) {
                    directFallbackReason = 'linked audio direct swap refused (' + directAudio.reason + ')';
                } else if (directAudio.sourceRangeWarning) {
                    directFallbackReason = 'linked audio direct swap could not restore source in/out (' + directAudio.sourceRangeWarning + ')';
                }
            }
            if (directFallbackReason) {
                prfx.lastDirectSwapReason = directFallbackReason + '; rebuilding the linked pair instead';
            } else {
                prfx.lastDirectSwaps++;
                // Half-succeeding is worse than failing: the keyframe shift below
                // would compensate for the wrong in-point, producing a clip whose
                // animation looks right and whose framing is wrong. Refuse instead.
                live = app.project.activeSequence;
                newClip = prfx.resolveMovePublicClipAt(live, detail, detail.sourceTrackIndex, detail.start, detail.end);
                if (newClip) {
                    app.enableQE();
                    qeClip = prfx.resolveMoveQEClipAt(qe.project.getActiveSequence(), detail,
                        detail.sourceTrackIndex, detail.start, detail.end);
                    prfx.applyComponentState(qe.project.getActiveSequence(), newClip, qeClip, 'video', capturedVideo);
                    prfx.warnIfClipOffline(newClip, detail.name);
                }
                prfx.noteReplaceOutcome(detail, capturedVideo);
                results.push({ kind: 'video', trackIndex: detail.sourceTrackIndex, start: detail.start, end: detail.end });
                if (audioDetail) {
                    newClip = prfx.resolveMovePublicClipAt(live, audioDetail, audioDetail.trackIndex, audioDetail.start, audioDetail.end);
                    if (newClip && capturedAudio) {
                        app.enableQE();
                        qeClip = prfx.resolveMoveQEClipAt(qe.project.getActiveSequence(), audioDetail,
                            audioDetail.trackIndex, audioDetail.start, audioDetail.end);
                        prfx.applyComponentState(qe.project.getActiveSequence(), newClip, qeClip, 'audio', capturedAudio);
                    }
                    results.push({ kind: 'audio', trackIndex: audioDetail.trackIndex, start: audioDetail.start, end: audioDetail.end });
                }
                return false;
            }
        } else {
            prfx.lastDirectSwapReason = direct.reason;
        }

        clip = prfx.resolveMovePublicClipAt(live, detail, detail.sourceTrackIndex, detail.start, detail.end);
        if (!clip) throw new Error('lost track of "' + detail.name + '" before replacing it');
        try { speed = Number(clip.getSpeed()); } catch (speedError) { speed = 1; }
        if (!(speed > 0)) speed = 1;
        try { reversed = clip.isSpeedReversed() === true; } catch (reverseError) { reversed = false; }

        // A full source replace swaps the linked audio too, so the original
        // partner is recorded now -- once the video is lifted the link is
        // gone and the partner can no longer be found from it.
        audioPartner = prfx.linkedAudioPartner(live, clip);
        if (audioPartner) {
            audioDetail = {
                kind: 'audio',
                sourceTrackIndex: Number(audioPartner.parentTrackIndex),
                trackIndex: Number(audioPartner.parentTrackIndex),
                start: prfx.timeInSeconds(audioPartner.start),
                end: prfx.timeInSeconds(audioPartner.end),
                name: detail.name
            };
        }

        // Everything the editor built lives on the CLIP, not on the media, so it
        // has to be read off before the original is lifted.
        if (!capturedVideo) capturedVideo = prfx.captureComponentState(clip);
        if (!attributesVideo) attributesVideo = prfx.captureClipAttributes(clip);
        // The replacement is staged from the full media, so without this it
        // starts at frame 0 of the new file instead of the same point in the
        // shot the editor had chosen.
        if (!sourceState) sourceState = prfx.clipSourceState(clip);
        if (audioPartner) {
            if (!capturedAudio) capturedAudio = prfx.captureComponentState(audioPartner);
            if (!attributesAudio) attributesAudio = prfx.captureClipAttributes(audioPartner);
            if (!audioSourceState) audioSourceState = prfx.clipSourceState(audioPartner);
        }
        // Transitions sit between clips and do not survive the lift.
        transitions = prfx.captureMoveTransitions(live, [{
            kind: 'video', sourceTrackIndex: detail.sourceTrackIndex,
            start: detail.start, end: detail.end,
            targetTrackIndex: detail.sourceTrackIndex,
            targetStart: detail.start, targetEnd: detail.end,
            name: detail.name
        }]);

        staged = prfx.stageOneProjectItem(staging.tracks, source, detail.start, false, sourceState);
        if (audioDetail && !staged.audio) {
            throw new Error('"' + String(source.name) + '" has no audio, so it cannot fully replace the linked pair "' + detail.name + '"');
        }

        // Retime first: changing speed changes the clip's timeline length and
        // would undo any trim applied before it.
        if (Math.abs(speed - 1) > 0.0001 || reversed) {
            app.enableQE();
            qeClip = prfx.resolveMoveQEClipAt(qe.project.getActiveSequence(), { kind: 'video' },
                staging.tracks.videoIndex, staged.start, staged.end);
            if (!qeClip) throw new Error('lost the staged replacement for "' + detail.name + '" before retiming it');
            timecode = prfx.secondsToSequenceTimecode(live, durationSeconds);
            try { qeClip.setSpeed(speed, timecode, reversed, false, false); }
            catch (setSpeedError) { throw new Error('Premiere refused to set ' + Math.round(speed * 100) + '% speed on the replacement for "' + detail.name + '"'); }
            // Speed does NOT carry across the video/audio link. Retiming the
            // video alone leaves the audio at 100% and the pair a completely
            // different length, so the audio has to be retimed by hand.
            if (staged.audio) {
                live = app.project.activeSequence;
                clip = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0];
                if (clip) {
                    app.enableQE();
                    qeClip = prfx.resolveMoveQEClipAt(qe.project.getActiveSequence(), { kind: 'audio' },
                        staging.tracks.audioIndex, prfx.timeInSeconds(clip.start), prfx.timeInSeconds(clip.end));
                    if (!qeClip) throw new Error('lost the staged replacement audio for "' + detail.name + '" before retiming it');
                    try { qeClip.setSpeed(speed, timecode, reversed, false, false); }
                    catch (audioSpeedError) { throw new Error('Premiere refused to set ' + Math.round(speed * 100) + '% speed on the replacement audio for "' + detail.name + '"'); }
                }
            }
            live = app.project.activeSequence;
            staged.video = prfx.stagingTrackClips(live, 'video', staging.tracks.videoIndex)[0];
            staged.audio = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0] || null;
            if (!staged.video) throw new Error('the retimed replacement for "' + detail.name + '" disappeared');
            staged.end = prfx.timeInSeconds(staged.video.end);
        }

        // Match the original's source in-point so the replacement shows the same
        // part of the shot. Verified rather than assumed: if Premiere shifts the
        // clip instead of slipping it, the change is abandoned and the
        // replacement simply starts from the media beginning.
        if (sourceState && (sourceState.inTicks !== '' || sourceState.outTicks !== '')) {
            beforeStart = staged.start;
            writeProblem = prfx.writeClipSourceRange(staged.video, sourceState);
            if (writeProblem) throw new Error('could not restore the source in/out of "' + detail.name + '" (' + writeProblem + ')');
            live = app.project.activeSequence;
            probe = prfx.stagingTrackClips(live, 'video', staging.tracks.videoIndex)[0];
            if (probe && Math.abs(prfx.timeInSeconds(probe.start) - beforeStart) < frameSeconds / 2) {
                if (!prfx.sourceStateMatches(prfx.clipSourceState(probe), sourceState)) {
                    throw new Error('the staged video source in/out of "' + detail.name + '" did not take');
                }
                staged.video = probe;
                staged.end = prfx.timeInSeconds(probe.end);
                staged.audio = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0] || null;
                if (staged.audio && audioSourceState && (audioSourceState.inTicks !== '' || audioSourceState.outTicks !== '')) {
                    writeProblem = prfx.writeClipSourceRange(staged.audio, audioSourceState);
                    if (writeProblem) throw new Error('could not restore the linked audio source in/out of "' + detail.name + '" (' + writeProblem + ')');
                    live = app.project.activeSequence;
                    staged.audio = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0] || null;
                    if (!staged.audio || !prfx.sourceStateMatches(prfx.clipSourceState(staged.audio), audioSourceState)) {
                        throw new Error('the staged linked audio source in/out of "' + detail.name + '" did not take');
                    }
                }
            } else if (!probe) {
                throw new Error('Premiere lost the staged video while matching the source in/out of "' + detail.name + '"');
            } else if (probe) {
                throw new Error('Premiere moved the staged video while matching the source in/out of "' + detail.name + '"');
            }
        }

        if (staged.end - staged.start < durationSeconds - frameSeconds / 2) {
            throw new Error('"' + String(source.name) + '" gives only ' + (staged.end - staged.start).toFixed(2) +
                's at ' + Math.round(speed * 100) + '% speed and cannot fill the ' + durationSeconds.toFixed(2) +
                's of "' + detail.name + '" [' + prfx.describeStagedRange() + ']');
        }

        // Trim both halves to the original length. Premiere may carry the
        // video trim across the link, so the audio is only trimmed when a
        // read-back shows it did not follow.
        if (staged.end - staged.start > durationSeconds + frameSeconds / 2) {
            try {
                endTime = new Time();
                endTime.seconds = detail.start + durationSeconds;
                staged.video.end = endTime;
            } catch (trimError) { throw new Error('could not trim the replacement for "' + detail.name + '" to length'); }
            live = app.project.activeSequence;
            staged.video = prfx.stagingTrackClips(live, 'video', staging.tracks.videoIndex)[0];
            if (!staged.video || Math.abs(prfx.timeInSeconds(staged.video.end) - (detail.start + durationSeconds)) > frameSeconds / 2) {
                throw new Error('the replacement for "' + detail.name + '" did not trim to the original length');
            }
            staged.end = detail.start + durationSeconds;
            staged.audio = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0] || null;
            if (staged.audio && Math.abs(prfx.timeInSeconds(staged.audio.end) - staged.end) > frameSeconds / 2) {
                try {
                    endTime = new Time();
                    endTime.seconds = staged.end;
                    staged.audio.end = endTime;
                } catch (audioTrimError) { throw new Error('could not trim the replacement audio for "' + detail.name + '" to length'); }
                live = app.project.activeSequence;
                staged.audio = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0] || null;
            }
        }

        // Lift both originals so the destinations are genuine gaps.
        // moveToTrack never overwrites, so without this the swap just fails.
        live = app.project.activeSequence;
        clip = prfx.resolveMovePublicClipAt(live, detail, detail.sourceTrackIndex, detail.start, detail.end);
        if (!clip) throw new Error('lost track of "' + detail.name + '" before lifting it');
        try { clip.remove(false, false); }
        catch (removeError) { throw new Error('Premiere refused to lift "' + detail.name + '"'); }
        if (audioDetail) {
            live = app.project.activeSequence;
            clip = prfx.resolveMovePublicClipAt(live, audioDetail, audioDetail.trackIndex, audioDetail.start, audioDetail.end);
            if (clip) {
                try { clip.remove(false, false); }
                catch (audioRemoveError) { throw new Error('Premiere refused to lift the linked audio of "' + detail.name + '"'); }
            }
        }

        // Read the staged audio's OWN range rather than assuming it matches
        // the video. Retiming and trimming do not always carry across the
        // link, and moving by the wrong coordinates simply finds nothing.
        audioRange = null;
        if (audioDetail) {
            live = app.project.activeSequence;
            clip = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0];
            if (!clip) {
                throw new Error('the staged audio for "' + detail.name + '" is no longer on the staging track; it holds: ' +
                    prfx.describeTrackOccupants(live, 'audio', staging.tracks.audioIndex, staged.start));
            }
            audioRange = { start: prfx.timeInSeconds(clip.start), end: prfx.timeInSeconds(clip.end) };
            if (Math.abs(audioRange.start - staged.start) > frameSeconds / 2 ||
                Math.abs(audioRange.end - staged.end) > frameSeconds / 2) {
                throw new Error('the staged audio for "' + detail.name + '" is ' +
                    audioRange.start.toFixed(3) + '-' + audioRange.end.toFixed(3) +
                    ' but the video is ' + staged.start.toFixed(3) + '-' + staged.end.toFixed(3) +
                    '; swapping them would desync the pair');
            }
        }

        prfx.moveStagedClipToTrack('video', staging.tracks.videoIndex, detail.sourceTrackIndex, staged.start, staged.end, '"' + detail.name + '"');
        if (audioRange) {
            // The video may have carried its linked audio along. Only move
            // the audio if it is still sitting on the staging track.
            live = app.project.activeSequence;
            clip = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0];
            if (clip) {
                prfx.moveStagedClipToTrack('audio', staging.tracks.audioIndex, audioDetail.trackIndex,
                    prfx.timeInSeconds(clip.start), prfx.timeInSeconds(clip.end), '"' + detail.name + '" audio');
            }
        }

        live = app.project.activeSequence;
        if (!prfx.resolveMovePublicClipAt(live, { kind: 'video' }, detail.sourceTrackIndex, staged.start, staged.end)) {
            throw new Error('the replacement for "' + detail.name + '" did not arrive on video track ' + (detail.sourceTrackIndex + 1) +
                '; that track holds: ' + prfx.describeTrackOccupants(live, 'video', detail.sourceTrackIndex, staged.start));
        }
        results.push({ kind: 'video', trackIndex: detail.sourceTrackIndex, start: staged.start, end: staged.end });

        newClip = prfx.resolveMovePublicClipAt(live, { kind: 'video' }, detail.sourceTrackIndex, staged.start, staged.end);
        if (newClip) {
            app.enableQE();
            qeClip = prfx.resolveMoveQEClipAt(qe.project.getActiveSequence(), { kind: 'video' },
                detail.sourceTrackIndex, staged.start, staged.end);
            prfx.applyComponentState(qe.project.getActiveSequence(), newClip, qeClip, 'video', capturedVideo);
            prfx.applyClipAttributes(newClip, attributesVideo);
            // Re-read from the sequence; a detached property wrapper will happily
            // confirm a write that never reached the published clip.
            mismatches = prfx.verifyComponentState(app.project.activeSequence, 'video',
                detail.sourceTrackIndex, staged.start, staged.end, capturedVideo);
            for (m = 0; m < mismatches.length; m++) prfx.lastPropertyFailures.push(mismatches[m]);
        }
        if (audioRange) {
            if (!prfx.resolveMovePublicClipAt(live, { kind: 'audio' }, audioDetail.trackIndex, staged.start, staged.end)) {
                throw new Error('the replacement audio for "' + detail.name + '" did not arrive on audio track ' + (audioDetail.trackIndex + 1) +
                    '; that track holds: ' + prfx.describeTrackOccupants(live, 'audio', audioDetail.trackIndex, staged.start));
            }
            results.push({ kind: 'audio', trackIndex: audioDetail.trackIndex, start: staged.start, end: staged.end });
            newClip = prfx.resolveMovePublicClipAt(live, { kind: 'audio' }, audioDetail.trackIndex, staged.start, staged.end);
            if (newClip && capturedAudio) {
                app.enableQE();
                qeClip = prfx.resolveMoveQEClipAt(qe.project.getActiveSequence(), { kind: 'audio' },
                    audioDetail.trackIndex, staged.start, staged.end);
                prfx.applyComponentState(qe.project.getActiveSequence(), newClip, qeClip, 'audio', capturedAudio);
                prfx.applyClipAttributes(newClip, attributesAudio);
            }
            // Re-link the pair so the new clips behave like the ones they
            // replaced. Selecting exactly the two is what linkSelection acts on.
            pair = prfx.selectClipRanges(live, [
                { kind: 'video', trackIndex: detail.sourceTrackIndex, start: staged.start, end: staged.end },
                { kind: 'audio', trackIndex: audioDetail.trackIndex, start: staged.start, end: staged.end }
            ]);
            if (pair.length === 2) {
                try { if (live.linkSelection() !== false) relinkedHere = true; } catch (linkError) {}
            }
        }


        if (transitions && transitions.length) {
            restored = prfx.restoreMoveTransitions(app.project.activeSequence, transitions, false);
            if (restored && restored.restored) prfx.lastTransitionsRestored += restored.restored;
        }

        // Anything left on the staging tracks would break the next
        // iteration's empty check, and an orphan is not something to ship.
        // (transitions restored just above)
        live = app.project.activeSequence;
        try {
            clip = prfx.stagingTrackClips(live, 'audio', staging.tracks.audioIndex)[0];
            if (clip && clip.remove) clip.remove(false, false);
        } catch (audioCleanupError) {}
        try {
            clip = prfx.stagingTrackClips(app.project.activeSequence, 'video', staging.tracks.videoIndex)[0];
            if (clip && clip.remove) clip.remove(false, false);
        } catch (videoCleanupError) {}
    return relinkedHere;
};

// Gathers the Timeline clips eligible for replacement: real media, video or
// audio. If linked video+audio are both selected, the video entry owns the pair
// so the audio half is not replaced twice.
prfx.collectReplaceTargets = function (publicSequence, qeSequence, sourceCategory) {
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence, false);
    var out = { targets: [], skippedSynthetic: 0, stale: snapshot.staleSelectionCount, selectedCount: snapshot.selected.length };
    var i, clip, detail, linkedAudioKeys = {}, partner, key, audioOnlySource = sourceCategory === 'audio';
    for (i = 0; i < snapshot.selected.length; i++) {
        detail = snapshot.selected[i];
        if (audioOnlySource) continue;
        if (detail.kind !== 'video') continue;
        clip = prfx.resolveMovePublicClipAt(publicSequence, detail, detail.sourceTrackIndex,
            detail.start, detail.end);
        if (!clip) continue;
        if (!prfx.clipIsMediaSource(clip)) { out.skippedSynthetic++; continue; }
        detail.projectItemName = prfx.projectItemNameOf(clip);
        try { detail.projectItemExtension = prfx.projectItemExtension(clip.projectItem); }
        catch (extensionError) { detail.projectItemExtension = ''; }
        out.targets.push(detail);

        partner = prfx.linkedAudioPartner(publicSequence, clip);
        if (partner) {
            key = prfx.moveSelectionKey('audio', Number(partner.parentTrackIndex),
                prfx.timeInSeconds(partner.start), prfx.timeInSeconds(partner.end));
            linkedAudioKeys[key] = true;
        }
    }
    for (i = 0; i < snapshot.selected.length; i++) {
        detail = snapshot.selected[i];
        if (detail.kind !== 'audio') continue;
        key = prfx.moveSelectionKey('audio', detail.sourceTrackIndex, detail.start, detail.end);
        if (!audioOnlySource && linkedAudioKeys[key]) continue;
        clip = prfx.resolveMovePublicClipAt(publicSequence, detail, detail.sourceTrackIndex,
            detail.start, detail.end);
        if (!clip) continue;
        if (!prfx.clipIsMediaSource(clip)) { out.skippedSynthetic++; continue; }
        detail.projectItemName = prfx.projectItemNameOf(clip);
        try { detail.projectItemExtension = prfx.projectItemExtension(clip.projectItem); }
        catch (audioExtensionError) { detail.projectItemExtension = ''; }
        out.targets.push(detail);
    }
    return out;
};

prfx.projectItemNameOf = function (clip) {
    try { return String(clip.projectItem.name || ''); } catch (error) { return ''; }
};

// Shared driver: staging tracks, undo checkpoint, per-target replace, rollback.
// resolveSource(detail) returns the project item to use, or null to skip.
prfx.runReplace = function (publicSequence, qeSequence, targets, resolveSource, sourceLabel) {
    var checkpoint, staging, failure = null, i, frameSeconds, results = [], relinked = 0;
    var replaced = 0, unmatched = 0, source, activeTarget = null, activeSource = null, rollback = null, logPath = '';

    frameSeconds = 1 / 30;
    try { if (Number(publicSequence.videoFrameRate) > 0) frameSeconds = 1 / Number(publicSequence.videoFrameRate); } catch (rateError) {}

    checkpoint = prfx.undoCheckpoint();
    prfx.lastTransitionsRestored = 0;
    prfx.lastPropertyFailures = [];
    prfx.lastReplacePairs = [];
    prfx.lastDirectSwaps = 0;
    prfx.lastDirectSwapReason = '';
    prfx.lastKeyClearFailures = 0;
    prfx.lastReplaceStep = '';
    prfx.lastReplaceSourceRange = null;
    // NOT cleared here: callers fill lastSkipNotes before invoking runReplace.
    if (!prfx.lastSkipNotes) prfx.lastSkipNotes = [];
    if (prfx.lastSelectedCount === undefined) prfx.lastSelectedCount = 0;
    staging = prfx.createStagingTracks(publicSequence, qeSequence);
    if (!staging.ok) {
        prfx.revertToUndoCheckpoint(checkpoint, 12);
        return 'ERROR: Could not prepare a safe staging track - ' + staging.message + '. Nothing was replaced.';
    }

    try {
        for (i = 0; i < targets.length; i++) {
            activeTarget = targets[i];
            source = resolveSource(targets[i]);
            activeSource = source;
            if (!source) { unmatched++; continue; }
            prfx.lastReplacePairs.push(String(targets[i].projectItemName) + ' -> ' + String(source.name));
            prfx.lastReplaceStep = 'Replacing ' + String(targets[i].projectItemName || targets[i].name || 'target') +
                ' with ' + String(source.name || 'selected source') + ' (' + (i + 1) + ' of ' + targets.length + ')';
            if (prfx.replaceOneTarget(staging, targets[i], source, frameSeconds, results)) relinked++;
            replaced++;
        }
    } catch (error) {
        failure = error.toString();
    }

    prfx.removeStagingTracks(qeSequence, staging.tracks);

    if (failure) {
        rollback = prfx.revertUnlessKeeping(checkpoint, targets.length * 16 + 24);
        logPath = prfx.writeFailureLog({
            operation: 'replace',
            sourceLabel: String(sourceLabel || ''),
            failure: failure,
            lastStep: String(prfx.lastReplaceStep || ''),
            target: prfx.replaceLogTarget(activeTarget),
            source: prfx.replaceLogSource(activeSource),
            rollback: rollback || null,
            replacedBeforeFailure: replaced,
            unmatchedBeforeFailure: unmatched,
            eligibleTargets: targets.length,
            selectedCount: prfx.lastSelectedCount,
            replacePairs: prfx.uniqueList(prfx.lastReplacePairs || []),
            directSwaps: prfx.lastDirectSwaps || 0,
            directSwapReason: String(prfx.lastDirectSwapReason || ''),
            sourceRange: prfx.lastReplaceSourceRange || null,
            propertyFailures: prfx.uniqueList(prfx.lastPropertyFailures || []),
            skipped: prfx.uniqueList(prfx.lastSkipNotes || [])
        });
        return 'ERROR: Replace stopped and ' + prfx.failureOutcomeText() + ' - ' + failure + '.' +
            (logPath ? ' Failure logged.' : ' Failure log could not be written.');
    }
    if (!replaced) {
        prfx.revertToUndoCheckpoint(checkpoint, 12);
        return 'ERROR: Nothing matched - none of the selected clips have a counterpart in ' + sourceLabel + '. Nothing was changed.';
    }

    prfx.selectClipRanges(app.project.activeSequence, results);

    return 'Replaced ' + replaced + ' clip' + (replaced === 1 ? '' : 's') + ' from ' + sourceLabel +
        (prfx.lastReplacePairs.length ? ' [' + prfx.uniqueList(prfx.lastReplacePairs).join('; ') + ']' : '') +
        ', keeping each original\'s track, position, length and speed.' +
        (relinked ? ' Re-linked ' + relinked + ' video/audio pair' + (relinked === 1 ? '' : 's') + '.' : '') +
        (prfx.lastTransitionsRestored ? ' Restored ' + prfx.lastTransitionsRestored + ' transition' + (prfx.lastTransitionsRestored === 1 ? '' : 's') + '.' : '') +
        (prfx.lastDirectSwaps ? ' ' + prfx.lastDirectSwaps + ' done by swapping the source in place (everything preserved).' : '') +
        (prfx.lastDirectSwapReason && prfx.lastDirectSwaps < replaced ? ' Rebuilt the rest - direct swap unavailable: ' + prfx.lastDirectSwapReason + '.' : '') +
        (prfx.lastSkipNotes.length ? ' Left alone: ' + prfx.uniqueList(prfx.lastSkipNotes).join('; ') + '.' : '') +
        (prfx.lastKeyClearFailures ? ' ' + prfx.lastKeyClearFailures + ' propert' + (prfx.lastKeyClearFailures === 1 ? 'y' : 'ies') + ' kept stale keyframes - Premiere would not remove them.' : '') +
        (prfx.lastPropertyFailures.length ? ' Could not carry over: ' + prfx.uniqueList(prfx.lastPropertyFailures).join(', ') + '.' : '') +
        (unmatched ? ' Left ' + unmatched + ' clip' + (unmatched === 1 ? '' : 's') + ' alone - no name match.' : '') +
        ' [' + targets.length + ' eligible of ' + prfx.lastSelectedCount + ' selected]';
};

prfx.replaceSelectedClipsFromBin = function (publicSequence, qeSequence) {
    var items = prfx.selectedProjectItems(), source = null, i, collected, sourceCategory;
    prfx.lastSelectedCount = 0;
    prfx.lastSkipNotes = [];
    for (i = 0; i < items.length; i++) if (prfx.projectItemIsPlaceable(items[i])) { source = items[i]; break; }
    if (!source) return 'ERROR: Select one media clip in the Project panel to replace with.';
    if (items.length > 1) return 'ERROR: Select exactly one Project panel clip to replace with - ' + items.length + ' are selected.';

    sourceCategory = prfx.mediaCategoryOf(prfx.projectItemExtension(source));
    collected = prfx.collectReplaceTargets(publicSequence, qeSequence, sourceCategory);
    if (!collected.targets.length) {
        if (collected.stale) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        if (collected.skippedSynthetic) return 'ERROR: The selection only contains adjustment layers, mattes or graphics. Select video or audio media clips you want replaced.';
        if (sourceCategory === 'audio') return 'ERROR: "' + String(source.name) + '" is audio-only. Select audio Timeline clips to replace.';
        return 'ERROR: Select video or audio clips on the Timeline to replace.';
    }
    return prfx.runReplace(publicSequence, qeSequence, collected.targets,
        function () { return source; }, '"' + String(source.name) + '"');
};

// Deselects everything currently published, then selects exactly the given
// ranges. Premiere keeps stale TrackItem wrappers selected after QE moves, so
// clearing by hand first is the only way to end with a clean selection.
prfx.selectClipRanges = function (sequence, ranges) {
    var kinds = ['video', 'audio'], k, tracks, trackCount, t, clips, count, i, clip, selection = [], previous;
    try {
        previous = sequence.getSelection();
        for (i = 0; i < Number(previous && previous.length || 0); i++) {
            try { if (previous[i] && previous[i].setSelected) previous[i].setSelected(false, false); } catch (previousError) {}
        }
    } catch (readError) {}
    for (k = 0; k < kinds.length; k++) {
        tracks = kinds[k] === 'audio' ? sequence.audioTracks : sequence.videoTracks;
        trackCount = tracks ? Number(tracks.numTracks || tracks.length || 0) : 0;
        for (t = 0; t < trackCount; t++) {
            try { clips = tracks[t].clips; count = Number(clips.numItems || clips.length || 0); } catch (trackError) { count = 0; }
            for (i = 0; i < count; i++) {
                try { clip = clips[i]; if (clip && clip.setSelected) clip.setSelected(false, false); } catch (clipError) {}
            }
        }
    }
    for (i = 0; i < ranges.length; i++) {
        clip = prfx.resolveMovePublicClipAt(sequence, { kind: ranges[i].kind || 'video' }, ranges[i].trackIndex, ranges[i].start, ranges[i].end);
        if (clip) {
            try { clip.setSelected(true, true); } catch (selectError) {}
            selection.push(clip);
        }
    }
    return selection;
};

// The audio half of a linked pair, if there is one.
prfx.linkedAudioPartner = function (sequence, clip) {
    var linked, i, partner;
    try { linked = clip.getLinkedItems ? clip.getLinkedItems() : null; } catch (error) { return null; }
    for (i = 0; i < Number(linked && linked.length || 0); i++) {
        try { partner = linked[i]; } catch (readError) { partner = null; }
        if (!partner) continue;
        if (prfx.moveSelectionKind(sequence, partner) === 'audio') return partner;
    }
    return null;
};

// ---------------------------------------------------------------------------
// Bulk replace by name
//
// Select the bin holding the new iteration of the footage; every Timeline clip
// whose source filename matches something in that bin is swapped for it. Clips
// with no counterpart are left exactly as they are -- a version bump normally
// covers part of a sequence, not all of it.
// ---------------------------------------------------------------------------
prfx.projectItemIsBin = function (item) {
    try { return !!(item && item.children && item.children.numItems !== undefined); }
    catch (error) { return false; }
};

prfx.collectBinMedia = function (bin, out, depth) {
    var children, count, i, child;
    if (depth > 8) return out;
    try { children = bin.children; count = Number(children.numItems || 0); } catch (error) { return out; }
    for (i = 0; i < count; i++) {
        try { child = children[i]; } catch (childError) { child = null; }
        if (!child) continue;
        if (prfx.projectItemIsBin(child)) prfx.collectBinMedia(child, out, depth + 1);
        else if (prfx.projectItemIsPlaceable(child)) out.push(child);
    }
    return out;
};

// ---------------------------------------------------------------------------
// Shot-name matching
//
// Editors name iterations by hand, so the same shot appears as "K1 Beige O1",
// "K1 Beige 1" or "K1 Beige". The names decompose into three parts with very
// different tolerances:
//
//   KEY      K1, K6.1, K8.2, S9   identifies the shot. Must match exactly --
//                                 K8 and K8.1 are different shots, so dots are
//                                 part of the key and are never split on.
//   DETAIL   Beige, Purple, Teal  the variant. Must match, but case and
//                                 punctuation are noise.
//   OPTION   O1, 1, -2            which take. Lenient: present, absent or
//                                 different all still match, they just rank
//                                 lower than an exact option hit.
//
// Format matters too: the same name can exist as a still and as a video, and
// swapping one for the other is always wrong. Category must match; identical
// extensions rank above merely compatible ones (mp4 for mov).
// ---------------------------------------------------------------------------
prfx.EXTENSION_CATEGORY = {
    'mp4': 'video', 'mov': 'video', 'm4v': 'video', 'avi': 'video', 'mxf': 'video',
    'mkv': 'video', 'webm': 'video', 'mpg': 'video', 'mpeg': 'video', 'm2v': 'video',
    'r3d': 'video', 'braw': 'video', 'mts': 'video', 'wmv': 'video',
    'png': 'image', 'jpg': 'image', 'jpeg': 'image', 'tif': 'image', 'tiff': 'image',
    'psd': 'image', 'exr': 'image', 'tga': 'image', 'gif': 'image', 'bmp': 'image',
    'webp': 'image', 'dpx': 'image', 'ai': 'image', 'svg': 'image',
    'wav': 'audio', 'mp3': 'audio', 'aac': 'audio', 'aif': 'audio', 'aiff': 'audio', 'm4a': 'audio'
};

prfx.fileExtensionOf = function (value) {
    var text = String(value || ''), dot = text.lastIndexOf('.'), tail;
    if (dot < 0) return '';
    tail = text.substring(dot + 1).toLowerCase();
    return /^[a-z0-9]{1,5}$/.test(tail) ? tail : '';
};

prfx.mediaCategoryOf = function (extension) {
    return prfx.EXTENSION_CATEGORY[String(extension || '').toLowerCase()] || '';
};

prfx.projectItemExtension = function (item) {
    var path = '';
    try { path = String(item.getMediaPath ? item.getMediaPath() : ''); } catch (error) { path = ''; }
    return prfx.fileExtensionOf(path) || prfx.fileExtensionOf(item && item.name);
};

// Splits a filename into key / details / option.
prfx.parseShotName = function (name) {
    var base = prfx.stripMediaExtension(String(name || '')), tokens, i, last, option = null, details = [], inner;
    // "S9.png.mp4" is shot S9 exported from a still, not a shot called "S9.png".
    // Fold away a second media extension so it still finds "S9.mp4". Only known
    // media extensions are stripped, so keys like "K8.1" and "K6.1" survive.
    inner = prfx.fileExtensionOf(base);
    if (inner && prfx.EXTENSION_CATEGORY[inner]) base = base.substring(0, base.length - inner.length - 1);
    // Underscores and hyphens are separators; dots are NOT -- "K8.1" is a key.
    base = base.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    tokens = base.length ? base.split(' ') : [];
    if (!tokens.length) return { key: '', details: [], detailText: '', option: null, base: base };
    if (tokens.length > 1) {
        last = tokens[tokens.length - 1];
        // "O1", "o2" and a bare "3" all mean the same thing to an editor.
        if (/^[oO]?\d+$/.test(last)) {
            option = Number(last.replace(/^[oO]/, ''));
            tokens = tokens.slice(0, tokens.length - 1);
        }
    }
    for (i = 1; i < tokens.length; i++) details.push(tokens[i].toLowerCase());
    return {
        key: tokens[0].toLowerCase(),
        details: details,
        detailText: details.join(' '),
        option: option,
        base: base
    };
};

// Standard edit distance, rolling row so a long filename does not allocate a
// full matrix.
prfx.editDistance = function (a, b) {
    var previous = [], current = [], i, j, cost;
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    for (j = 0; j <= b.length; j++) previous[j] = j;
    for (i = 1; i <= a.length; i++) {
        current[0] = i;
        for (j = 1; j <= b.length; j++) {
            cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
        }
        for (j = 0; j <= b.length; j++) previous[j] = current[j];
    }
    return previous[b.length];
};

prfx.nameSimilarity = function (a, b) {
    var longest = Math.max(a.length, b.length);
    if (!longest) return 0;
    return 1 - (prfx.editDistance(a, b) / longest);
};

prfx.FUZZY_MIN = 0.82;

// Scores one candidate against one target. Returns null when it is not a
// legitimate match at all; higher scores win.
// "K6" and "K6.1" are the same shot re-versioned; "K8" and "K8.1" are different
// shots that happily coexist. Sub-version keys are therefore only ever
// considered as a LAST resort, and only when exactly one candidate qualifies --
// see resolveReplacementItem.
prfx.baseShotKey = function (key) {
    var dot = String(key || '').indexOf('.');
    return dot > 0 ? key.substring(0, dot) : key;
};

// Some projects carry a product prefix that a later version drops entirely:
//   v1 bin:  "VeraLifting v.B 1.0 Lace_Black.png"
//   v3 bin:  "Lace_Black.png"
// There is no shot key here at all -- the distinguishing part is the TAIL. When
// one name's tokens end with the whole of the other's, they are the same asset
// and the extra leading tokens are boilerplate.
prfx.nameTokens = function (name) {
    var base = prfx.stripMediaExtension(String(name || '')).toLowerCase(), inner, parts, out = [], i;
    inner = prfx.fileExtensionOf(base);
    if (inner && prfx.EXTENSION_CATEGORY[inner]) base = base.substring(0, base.length - inner.length - 1);
    parts = base.replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '').split(/\s+/);
    for (i = 0; i < parts.length; i++) if (parts[i].length) out.push(parts[i]);
    // A trailing option number is noise here as well.
    if (out.length > 2 && /^\d+$/.test(out[out.length - 1])) out.pop();
    return out;
};

prfx.TAIL_MIN_TOKENS = 2;

// A leading "v1" / "V2 -" / "v3 " is a version marker, and versions differing is
// the whole point of a replace. Drop it from the front of both names so what
// remains is the asset itself: "v1- fabric" and "V3 - fabric" are both "fabric".
prfx.stripVersionPrefix = function (tokens) {
    var out = tokens.slice(0), guard = 0;
    while (out.length > 1 && guard < 4) {
        guard++;
        if (/^v\d+$/.test(out[0]) || /^ver\d*$/.test(out[0]) || /^version$/.test(out[0])) { out.shift(); continue; }
        // "v" and its number split by punctuation, as in "v 3 - fabric".
        if (out.length > 2 && /^v$/.test(out[0]) && /^\d+$/.test(out[1])) { out.shift(); out.shift(); continue; }
        break;
    }
    return out;
};

prfx.tokensEqual = function (a, b) {
    var i;
    if (a.length !== b.length || !a.length) return false;
    for (i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
};

// True when one token list ends with the whole of the other.
prfx.tokensShareTail = function (a, b) {
    var shortest = a.length < b.length ? a : b, longest = a.length < b.length ? b : a, i, offset;
    if (shortest.length < prfx.TAIL_MIN_TOKENS) return false;
    if (shortest.length === longest.length) return false;
    offset = longest.length - shortest.length;
    for (i = 0; i < shortest.length; i++) if (shortest[i] !== longest[offset + i]) return false;
    return true;
};

prfx.scoreNameMatch = function (target, candidate, tolerance, allowBaseKey) {
    var score = 0, similarity;
    if (!target.parsed.key.length) return null;
    if (target.parsed.key !== candidate.parsed.key) {
        if (!allowBaseKey) return null;
        if (prfx.baseShotKey(target.parsed.key) !== prfx.baseShotKey(candidate.parsed.key)) return null;
        // Ranks below any exact-key match; only ever reached when there are none.
        score -= 20;
    }
    // Never swap a still for a video, whatever the names say.
    if (target.category && candidate.category && target.category !== candidate.category) return null;

    if (target.parsed.detailText === candidate.parsed.detailText) score += 50;
    else if (tolerance === 'exact') return null;
    else if (!target.parsed.detailText.length || !candidate.parsed.detailText.length) {
        // One side carries a variant the other does not. Allowed, but weak.
        if (tolerance !== 'fuzzy') return null;
        score += 10;
    } else {
        similarity = prfx.nameSimilarity(target.parsed.detailText, candidate.parsed.detailText);
        if (similarity >= prfx.FUZZY_MIN) score += Math.round(30 * similarity);
        else return null;
    }

    if (target.extension && target.extension === candidate.extension) score += 20;
    else if (target.category && target.category === candidate.category) score += 8;

    if (target.parsed.option !== null && target.parsed.option === candidate.parsed.option) score += 15;
    else if (target.parsed.option === null && candidate.parsed.option === null) score += 12;
    else if (target.parsed.option === null || candidate.parsed.option === null) score += 4;

    return score;
};

prfx.describeName = function (name, extension) {
    return { name: String(name || ''), extension: String(extension || ''), category: prfx.mediaCategoryOf(extension), parsed: prfx.parseShotName(name) };
};

prfx.buildReplacementIndex = function (items) {
    var built = [], i;
    for (i = 0; i < items.length; i++) {
        built.push({ item: items[i], described: prfx.describeName(items[i].name, prfx.projectItemExtension(items[i])) });
    }
    return built;
};

prfx.MATCH_MARGIN = 6;

// When a bin genuinely holds two files with the same name, the newer file on
// disk is the later iteration. This is the only place the tool guesses between
// candidates, so it only does so on hard evidence -- a readable, strictly
// greater modification time -- and reports that it did.
prfx.projectItemPath = function (item) {
    try { return String(item.getMediaPath ? item.getMediaPath() : ''); } catch (error) { return ''; }
};

prfx.projectItemFileTimes = function (item) {
    var path = prfx.projectItemPath(item), file, times = { modified: NaN, created: NaN, size: NaN };
    if (!path.length) return times;
    try {
        file = new File(path);
        if (!file.exists) return times;
        try { times.modified = Number(file.modified.getTime()); } catch (modifiedError) {}
        try { times.created = Number(file.created.getTime()); } catch (createdError) {}
        try { times.size = Number(file.length); } catch (sizeError) {}
    } catch (error) {}
    return times;
};

prfx.shortPath = function (path) {
    var text = String(path || ''), cut = text.length - 60;
    return cut > 0 ? '...' + text.substring(cut) : text;
};

// Bins routinely end up with two entries of the same name. They are resolved in
// order of how much the answer can be trusted:
//   1. both entries point at the SAME file -- no ambiguity at all
//   2. one file is newer on disk (modified, then created)
// Anything else is refused, with both paths named so the editor can see what
// actually differs. Picking blind here would swap in the wrong iteration.
prfx.pickNewestCandidate = function (candidates, name, tierLabel) {
    var i, paths = {}, distinct = 0, path, times, best = null, bestValue = NaN, tied = false, field, fields = ['modified', 'created'], f;

    for (i = 0; i < candidates.length; i++) {
        path = prfx.projectItemPath(candidates[i].item).toLowerCase();
        if (path.length && !paths[path]) { paths[path] = true; distinct++; }
    }
    if (distinct === 1) {
        return { item: candidates[0].item, tier: tierLabel, match: candidates[0].described,
            duplicateEntry: true, count: candidates.length };
    }

    for (f = 0; f < fields.length; f++) {
        field = fields[f];
        best = null; bestValue = NaN; tied = false;
        for (i = 0; i < candidates.length; i++) {
            times = prfx.projectItemFileTimes(candidates[i].item);
            if (isNaN(times[field])) continue;
            if (isNaN(bestValue) || times[field] > bestValue) { bestValue = times[field]; best = candidates[i]; tied = false; }
            else if (times[field] === bestValue) tied = true;
        }
        if (best && !tied) {
            return { item: best.item, tier: tierLabel, match: best.described, newest: field, count: candidates.length };
        }
    }

    paths = [];
    for (i = 0; i < candidates.length; i++) paths.push(prfx.shortPath(prfx.projectItemPath(candidates[i].item)));
    return { item: null, reason: 'the bin holds ' + candidates.length + ' files called "' + name +
        '" and neither their modified nor created dates separate them (' + paths.join(' | ') + ')' };
};

prfx.resolveReplacementItem = function (built, name, extension, tolerance) {
    var target = prfx.describeName(name, extension), i, score, scored = [], exact = [], top, tied = [], targetTokens, candidateTokens;

    for (i = 0; i < built.length; i++) {
        if (String(built[i].described.name).toLowerCase() === target.name.toLowerCase()) exact.push(built[i]);
    }
    if (exact.length === 1) return { item: exact[0].item, tier: 'exact', match: exact[0].described, target: target };
    if (exact.length > 1) return prfx.pickNewestCandidate(exact, name, 'exact');

    if (!target.parsed.key.length) return { item: null, reason: 'could not read a shot key from "' + name + '"' };

    for (i = 0; i < built.length; i++) {
        score = prfx.scoreNameMatch(target, built[i].described, tolerance, false);
        if (score === null) continue;
        scored.push({ item: built[i].item, described: built[i].described, score: score });
    }
    if (!scored.length && tolerance !== 'exact') {
        // No exact-key candidate. Fall back to sub-version keys -- K6 finding
        // K6.1 -- but only when precisely one qualifies. If a bin holds K8,
        // K8.1 and K8.2 they are separate shots and the answer is unknowable.
        for (i = 0; i < built.length; i++) {
            score = prfx.scoreNameMatch(target, built[i].described, tolerance, true);
            if (score === null) continue;
            scored.push({ item: built[i].item, described: built[i].described, score: score, baseKey: true });
        }
        if (scored.length > 1) {
            return { item: null, reason: 'no "' + target.parsed.key + '" in the bin, and ' + scored.length +
                ' version keys could be meant - they are separate shots, so PR FX will not choose' };
        }
    }
    if (!scored.length && tolerance !== 'exact') {
        // Last resort: names that share a tail, e.g. a product prefix present in
        // one bin and absent in the other. Only when exactly one qualifies.
        targetTokens = prfx.nameTokens(name);
        for (i = 0; i < built.length; i++) {
            if (target.category && built[i].described.category && target.category !== built[i].described.category) continue;
            candidateTokens = prfx.nameTokens(built[i].described.name);
            if (prfx.tokensShareTail(targetTokens, candidateTokens)) {
                scored.push({ item: built[i].item, described: built[i].described, score: 1, sharedTail: true });
            } else if (prfx.tokensEqual(prfx.stripVersionPrefix(targetTokens), prfx.stripVersionPrefix(candidateTokens))) {
                scored.push({ item: built[i].item, described: built[i].described, score: 1, versionPrefix: true });
            }
        }
        if (scored.length > 1) {
            return { item: null, reason: scored.length + ' files in the bin match "' + name + '" once version markers are ignored' };
        }
    }
    if (!scored.length) {
        return { item: null, reason: 'nothing in the bin shares the key "' + target.parsed.key + '"' +
            (target.category ? ' as ' + target.category : '') };
    }
    top = -1;
    for (i = 0; i < scored.length; i++) if (scored[i].score > top) top = scored[i].score;
    for (i = 0; i < scored.length; i++) if (top - scored[i].score < prfx.MATCH_MARGIN) tied.push(scored[i]);
    if (tied.length === 1) {
        return { item: tied[0].item, tier: 'structured', score: tied[0].score, match: tied[0].described,
            target: target, baseKey: tied[0].baseKey, sharedTail: tied[0].sharedTail, versionPrefix: tied[0].versionPrefix };
    }
    // Several equally good names: fall back to the newest file, or refuse.
    return prfx.pickNewestCandidate(tied, name, 'structured');
};

prfx.planBulkReplace = function (publicSequence, qeSequence, tolerance) {
    var items = prfx.selectedProjectItems(), bins = [], media = [], i, built, collected, binNames = [];
    var plan = { matches: [], skips: [], binNames: [] }, resolved, detail;

    for (i = 0; i < items.length; i++) if (prfx.projectItemIsBin(items[i])) bins.push(items[i]);
    if (!bins.length) return { error: 'Select the bin holding the new footage in the Project panel. Bulk replace matches by filename, so it needs a bin rather than individual clips.' };
    for (i = 0; i < bins.length; i++) {
        binNames.push(String(bins[i].name));
        prfx.collectBinMedia(bins[i], media, 0);
    }
    if (!media.length) return { error: '"' + binNames.join('", "') + '" contains no media to replace with.' };

    collected = prfx.collectReplaceTargets(publicSequence, qeSequence);
    if (!collected.targets.length) {
        if (collected.stale) return { error: 'Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.' };
        if (collected.skippedSynthetic) return { error: 'The selection only contains adjustment layers, mattes or graphics. Select video or audio media clips you want replaced.' };
        return { error: 'Select the Timeline clips you want considered for replacement.' };
    }

    built = prfx.buildReplacementIndex(media);
    plan.binNames = binNames;
    plan.selectedCount = collected.selectedCount;
    plan.skippedSynthetic = collected.skippedSynthetic;
    plan.staleCount = collected.stale;
    plan.built = built;
    plan.targets = collected.targets;
    plan.mediaCount = media.length;
    for (i = 0; i < collected.targets.length; i++) {
        detail = collected.targets[i];
        resolved = prfx.resolveReplacementItem(built, detail.projectItemName, detail.projectItemExtension, tolerance);
        if (resolved.item) plan.matches.push({ detail: detail, item: resolved.item, tier: resolved.tier, score: resolved.score, match: resolved.match, target: resolved.target, newest: resolved.newest, count: resolved.count, duplicateEntry: resolved.duplicateEntry, baseKey: resolved.baseKey, sharedTail: resolved.sharedTail, versionPrefix: resolved.versionPrefix });
        else plan.skips.push({ detail: detail, reason: resolved.reason });
        detail.resolvedItem = resolved.item || null;
    }
    return plan;
};

// writePropertyValue reads back through the SAME property object it wrote to,
// which can be detached from the published clip -- it reports success while
// Effect Controls shows something else. This re-resolves the clip from the
// sequence and re-reads it, which is the only check that cannot be fooled.
prfx.verifyComponentState = function (sequence, kind, trackIndex, start, end, captured) {
    var clip = prfx.resolveMovePublicClipAt(sequence, { kind: kind }, trackIndex, start, end);
    var actual, i, j, entry, record, mismatches = [];
    if (!clip) return ['clip not found for verification'];
    actual = prfx.captureComponentState(clip);
    for (i = 0; i < captured.length && i < actual.length; i++) {
        entry = captured[i];
        if (entry.matchName !== actual[i].matchName) continue;
        for (j = 0; j < entry.properties.length && j < actual[i].properties.length; j++) {
            record = entry.properties[j];
            if (record.displayName !== actual[i].properties[j].displayName) continue;
            if (record.varying || actual[i].properties[j].varying) continue;
            if (record.value === null) continue;
            if (!prfx.capturedValuesMatch(record.value, actual[i].properties[j].value)) {
                mismatches.push(entry.displayName + '/' + record.displayName +
                    ' wanted ' + prfx.describeCapturedValue(record.value) +
                    ' got ' + prfx.describeCapturedValue(actual[i].properties[j].value));
            }
        }
    }
    return mismatches;
};

prfx.uniqueList = function (values) {
    var seen = {}, out = [], i;
    for (i = 0; i < values.length; i++) {
        if (seen[values[i]]) continue;
        seen[values[i]] = true;
        out.push(values[i]);
    }
    return out;
};

prfx.describeMatchTier = function (entry) {
    var parts = [], target, found;
    if (entry.versionPrefix && entry.match) return 'version prefix ignored -> ' + String(entry.match.name);
    if (entry.sharedTail && entry.match) return 'shared name tail -> ' + String(entry.match.name);
    if (entry.baseKey && entry.target && entry.match) {
        return 'version key ' + entry.target.parsed.key + ' -> ' + entry.match.parsed.key;
    }
    if (entry.duplicateEntry) return entry.count + ' bin entries, same file';
    if (entry.newest) return 'newest by ' + entry.newest + ' date, of ' + entry.count + ' same-name files';
    if (entry.tier === 'exact') return 'exact';
    target = entry.target; found = entry.match;
    if (!target || !found) return 'matched';
    parts.push('key ' + target.parsed.key);
    if (target.parsed.detailText !== found.parsed.detailText) {
        parts.push('detail "' + (target.parsed.detailText || '-') + '"->"' + (found.parsed.detailText || '-') + '"');
    }
    if (target.parsed.option !== found.parsed.option) {
        parts.push('option ' + (target.parsed.option === null ? '-' : target.parsed.option) +
            '->' + (found.parsed.option === null ? '-' : found.parsed.option));
    }
    if (target.extension !== found.extension) parts.push('.' + target.extension + '->.' + found.extension);
    return parts.join(', ');
};

prfx.writeDiagnostic = function (fileName, lines) {
    var path, file;
    try {
        path = Folder.myDocuments.parent.fsName + '/Library/Logs/' + fileName;
        file = new File(path);
        file.encoding = 'UTF-8';
        file.open('w');
        file.write(lines.join('\n'));
        file.close();
        return path;
    } catch (error) { return ''; }
};

prfx.previewBulkReplaceByName = function (publicSequence, qeSequence, tolerance) {
    var plan = prfx.planBulkReplace(publicSequence, qeSequence, tolerance), lines = [], i, entry, shown;
    if (plan.error) return 'ERROR: ' + plan.error;
    lines.push('Dry run against "' + plan.binNames.join('", "') + '" (' + plan.mediaCount + ' files, ' + tolerance + ' matching). Nothing was changed.');
    lines.push('selection: ' + plan.selectedCount + ' clips -> ' + plan.targets.length + ' eligible' +
        (plan.skippedSynthetic ? ', ' + plan.skippedSynthetic + ' skipped as graphics' : '') +
        (plan.staleCount ? ', ' + plan.staleCount + ' stale selection references' : '') + '.');
    lines.push(plan.matches.length + ' of ' + plan.targets.length + ' eligible clips would be replaced.');
    shown = Math.min(plan.matches.length, 12);
    for (i = 0; i < shown; i++) {
        entry = plan.matches[i];
        lines.push('  ' + entry.detail.projectItemName + '  ->  ' + String(entry.item.name) + '  [' + prfx.describeMatchTier(entry) + ']');
    }
    if (plan.matches.length > shown) lines.push('  ...and ' + (plan.matches.length - shown) + ' more.');
    if (plan.skips.length) {
        lines.push(plan.skips.length + ' left alone:');
        shown = Math.min(plan.skips.length, 8);
        for (i = 0; i < shown; i++) {
            lines.push('  ' + plan.skips[i].detail.projectItemName + ' - ' + plan.skips[i].reason);
        }
        if (plan.skips.length > shown) lines.push('  ...and ' + (plan.skips.length - shown) + ' more.');
    }
    // Also written to disk: the panel truncates long output, and the interesting
    // part of a dry run is usually the skip list at the bottom.
    prfx.writeDiagnostic('PR FX Bulk Replace Preview.txt', lines);
    return lines.join('\n') + '\n(also written to ~/Library/Logs/PR FX Bulk Replace Preview.txt)';
};

prfx.bulkReplaceByName = function (publicSequence, qeSequence, tolerance) {
    var plan = prfx.planBulkReplace(publicSequence, qeSequence, tolerance), tierCounts = {}, i, label, parts = [];
    if (plan.error) return 'ERROR: ' + plan.error;
    prfx.lastSelectedCount = plan.selectedCount;
    prfx.lastSkipNotes = [];
    // Name every clip that will be left alone, and why. A silent skip in a bulk
    // run is indistinguishable from a clip that was never selected.
    for (i = 0; i < plan.skips.length; i++) {
        prfx.lastSkipNotes.push(String(plan.skips[i].detail.projectItemName) + ': ' + plan.skips[i].reason);
    }
    if (!plan.matches.length) {
        return 'ERROR: None of the selected clips matched anything in "' + plan.binNames.join('", "') +
            '" at ' + tolerance + ' tolerance. Nothing was changed. Try the dry run to see how close the names are.';
    }
    for (i = 0; i < plan.matches.length; i++) {
        label = plan.matches[i].versionPrefix ? 'version prefix ignored'
              : plan.matches[i].sharedTail ? 'shared name tail'
              : plan.matches[i].baseKey ? 'version key (K6 -> K6.1)'
              : plan.matches[i].duplicateEntry ? 'duplicate bin entries of one file'
              : plan.matches[i].newest ? 'newest of same-name duplicates'
              : (plan.matches[i].tier === 'exact' ? 'exact filename' : 'by shot key');
        tierCounts[label] = (tierCounts[label] || 0) + 1;
    }
    for (label in tierCounts) if (tierCounts.hasOwnProperty(label)) parts.push(tierCounts[label] + ' ' + label);

    return prfx.runReplace(publicSequence, qeSequence, plan.targets, function (detail) {
        return detail.resolvedItem;
    }, '"' + plan.binNames.join('", "') + '" by name') + ' Matched by: ' + parts.join(', ') + '.';
};

// ---------------------------------------------------------------------------
// Carrying a clip's attributes onto its replacement
//
// A replacement is a brand new clip and starts with Premiere's defaults, so
// everything the editor built on the original -- Motion, Opacity, added effects,
// keyframes, blend mode -- has to be copied across or the replace silently
// throws away their work.
//
// Replace is the easy case for keyframes: the new clip occupies exactly the same
// timeline range as the old one, so key times copy across verbatim with no
// remapping.
// ---------------------------------------------------------------------------
prfx.captureComponentState = function (clip) {
    var captured = [], components, count, i, component, entry;
    // Keyframe times are meaningless without knowing what they are measured
    // from. Record the clip's own anchors so they can be re-based onto a clip
    // with a different source in-point.
    try { captured.inTicks = Number(clip.inPoint.ticks); } catch (inError) { captured.inTicks = NaN; }
    try { captured.outTicks = Number(clip.outPoint.ticks); } catch (outError) { captured.outTicks = NaN; }
    try { captured.startTicks = Number(clip.start.ticks); } catch (startError) { captured.startTicks = NaN; }
    try { components = clip.components; count = Number(components.numItems || components.length || 0); }
    catch (error) { return captured; }
    for (i = 0; i < count; i++) {
        try { component = components[i]; } catch (componentError) { continue; }
        if (!component) continue;
        entry = {
            matchName: String(component.matchName || ''),
            displayName: String(component.displayName || ''),
            properties: prfx.capturePropertyState(component)
        };
        captured.push(entry);
    }
    return captured;
};

prfx.capturePropertyState = function (component) {
    var out = [], properties, count, i, property, record, keys, k, keyTime;
    try { properties = component.properties; count = Number(properties.numItems || properties.length || 0); }
    catch (error) { return out; }
    for (i = 0; i < count; i++) {
        try { property = properties[i]; } catch (propertyError) { continue; }
        if (!property) continue;
        record = { displayName: String(property.displayName || ''), keys: [], value: null, varying: false };
        try { record.varying = property.isTimeVarying && property.isTimeVarying() === true; } catch (varyError) { record.varying = false; }
        if (record.varying) {
            try { keys = property.getKeys(); } catch (keysError) { keys = null; }
            for (k = 0; k < Number(keys && keys.length || 0); k++) {
                keyTime = keys[k];
                try {
                    record.keys.push({
                        ticks: String(keyTime.ticks),
                        value: prfx.cloneCapturedValue(property.getValueAtKey(keyTime)),
                        interpolation: prfx.safeInterpolation(property, keyTime)
                    });
                } catch (keyError) {}
            }
            if (!record.keys.length) record.varying = false;
        }
        if (!record.varying) {
            try { record.value = prfx.cloneCapturedValue(property.getValue()); } catch (valueError) { record.value = null; }
        }
        out.push(record);
    }
    return out;
};

// getValue() on a multi-dimensional property (Position, Anchor Point, Scale
// with separate width) hands back an array that can be bound to the live clip.
// The original is lifted before these values are written, so anything not
// copied out by value can read back as zeros. Snapshot it now.
prfx.cloneCapturedValue = function (value) {
    var copy, i;
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return value;
    if (typeof value.length !== 'number') return value;
    copy = [];
    for (i = 0; i < value.length; i++) copy.push(value[i]);
    return copy;
};

prfx.capturedValuesMatch = function (a, b) {
    var i;
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (typeof a === 'object' && typeof a.length === 'number') {
        if (typeof b !== 'object' || typeof b.length !== 'number' || a.length !== b.length) return false;
        for (i = 0; i < a.length; i++) if (Math.abs(Number(a[i]) - Number(b[i])) > 0.0001) return false;
        return true;
    }
    if (typeof a === 'number') return Math.abs(Number(a) - Number(b)) < 0.0001;
    return String(a) === String(b);
};

prfx.safeInterpolation = function (property, keyTime) {
    try { return property.getInterpolationTypeAtKey(keyTime); } catch (error) { return null; }
};

prfx.findComponentByMatchName = function (clip, matchName, usedIndices) {
    var components, count, i, component;
    try { components = clip.components; count = Number(components.numItems || components.length || 0); }
    catch (error) { return null; }
    for (i = 0; i < count; i++) {
        if (usedIndices['i' + i]) continue;
        try { component = components[i]; } catch (componentError) { continue; }
        if (component && String(component.matchName || '') === matchName) {
            usedIndices['i' + i] = true;
            return component;
        }
    }
    return null;
};

prfx.normalizedPresetLabel = function (value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
};

prfx.findLastComponentByMatchOrName = function (clip, matchName, displayName) {
    var components, count, i, component, wantedMatch = String(matchName || ''), wantedName = String(displayName || '');
    try { components = clip.components; count = Number(components.numItems || components.length || 0); }
    catch (error) { return null; }
    for (i = count - 1; i >= 0; i--) {
        try { component = components[i]; } catch (componentError) { continue; }
        if (component && wantedMatch && String(component.matchName || '') === wantedMatch) return component;
    }
    for (i = count - 1; i >= 0; i--) {
        try { component = components[i]; } catch (displayError) { continue; }
        if (component && wantedName && String(component.displayName || '') === wantedName) return component;
    }
    return null;
};

prfx.resolveQEPresetEffect = function (kind, displayName, matchName, presetName) {
    var getter = kind === 'audio' ? 'getAudioEffectByName' : 'getVideoEffectByName';
    var listGetter = kind === 'audio' ? 'getAudioEffectList' : 'getVideoEffectList';
    var names = [displayName, presetName, matchName], i, item, list, count, entry, name, display, match;
    for (i = 0; i < names.length; i++) {
        if (!names[i]) continue;
        try {
            item = qe.project && qe.project[getter] ? qe.project[getter](String(names[i])) : null;
            if (item) return item;
        } catch (directError) {}
    }
    try {
        if (!qe.project || !qe.project[listGetter]) return null;
        list = qe.project[listGetter]();
        count = list && (list.numItems !== undefined ? list.numItems : list.length) || 0;
        for (i = 0; i < count; i++) {
            entry = null;
            try { entry = list[i]; } catch (indexedReadError) {}
            if (!entry) { try { entry = list.getItemAt(i); } catch (itemReadError) {} }
            if (!entry) continue;
            try { name = String(entry.name || ''); } catch (nameError) { name = ''; }
            try { display = String(entry.displayName || ''); } catch (displayError) { display = ''; }
            try { match = String(entry.matchName || ''); } catch (matchError) { match = ''; }
            if ((matchName && match === String(matchName)) ||
                (displayName && (name === String(displayName) || display === String(displayName))) ||
                (presetName && (name === String(presetName) || display === String(presetName)))) {
                return entry;
            }
        }
    } catch (listError) {}
    return null;
};

prfx.isSimpleMockPresetValue = function (value) {
    if (typeof value === 'number') return isFinite(value);
    if (typeof value === 'boolean') return true;
    return false;
};

prfx.mockPresetUnsupportedReason = function (preset) {
    var i, j, entry, value;
    if (!preset || !preset.effects || !preset.effects.length) return 'no readable effect data was found in the preset';
    for (i = 0; i < preset.effects.length; i++) {
        entry = preset.effects[i];
        if (!entry.matchName && !entry.displayName) return 'one effect in the preset has no stable effect identity';
        if (String(entry.matchName || '') === 'AE.ADBE Lumetri' || /lumetri/i.test(String(entry.displayName || ''))) {
            return 'Lumetri presets store their real settings in private Premiere data';
        }
        if (entry.hasPrivateData === true || Number(entry.privateParams || 0) > 0) return 'it contains private Premiere preset data';
        if (Number(entry.params && entry.params.length || 0) < 1 && Number(entry.unsupportedParams || 0) > 0) {
            return 'it has no public scalar parameters to recreate';
        }
        for (j = 0; j < Number(entry.params && entry.params.length || 0); j++) {
            value = entry.params[j].value;
            if (!prfx.isSimpleMockPresetValue(value)) return 'it contains a non-scalar parameter value PR FX cannot safely recreate yet';
        }
    }
    return '';
};

prfx.resolveAddedPresetComponent = function (publicSequence, entry, detail) {
    var attempt, publicClip, component;
    for (attempt = 0; attempt < 12; attempt++) {
        publicClip = prfx.resolveMovePublicClipAt(publicSequence, { kind: entry.kind }, detail.trackIndex, detail.start, detail.end);
        component = publicClip ? prfx.findLastComponentByMatchOrName(publicClip, entry.matchName, entry.displayName) : null;
        if (component) return { clip: publicClip, component: component };
        try { $.sleep(50); } catch (sleepError) {}
    }
    return { clip: publicClip || null, component: null };
};

prfx.findMockPresetProperty = function (component, param, usedIndices) {
    var properties, count, i, property, wanted = String(param && param.name || ''), wantedNormalized = prfx.normalizedPresetLabel(wanted);
    try { properties = component.properties; count = Number(properties.numItems || properties.length || 0); }
    catch (error) { return null; }
    for (i = 0; i < count; i++) {
        if (usedIndices['i' + i]) continue;
        try { property = properties[i]; } catch (propertyError) { continue; }
        if (property && String(property.displayName || '') === wanted) {
            usedIndices['i' + i] = true;
            return property;
        }
    }
    if (!wantedNormalized) return null;
    for (i = 0; i < count; i++) {
        if (usedIndices['i' + i]) continue;
        try { property = properties[i]; } catch (normalizedError) { continue; }
        if (property && prfx.normalizedPresetLabel(property.displayName) === wantedNormalized) {
            usedIndices['i' + i] = true;
            return property;
        }
    }
    return null;
};

prfx.mockPresetClipStartTicks = function (detail) {
    var ticks = prfx.numericTicks(detail && detail.startTicks);
    if (!isNaN(ticks)) return ticks;
    return Math.round(Number(detail && detail.start || 0) * 254016000000);
};

prfx.writeMockPresetKeyframes = function (property, param, detail) {
    var keys = param && param.keyframes || [], baseTicks, firstTicks, i, time, wanted, landed, readBack;
    if (!keys.length) return false;
    baseTicks = prfx.mockPresetClipStartTicks(detail);
    firstTicks = Number(keys[0].ticks);
    if (isNaN(baseTicks) || isNaN(firstTicks)) return false;
    try { if (typeof property.setTimeVarying === 'function') property.setTimeVarying(true); } catch (varyError) {}
    if (!prfx.clearPropertyKeys(property)) return false;
    for (i = 0; i < keys.length; i++) {
        wanted = keys[i].value;
        time = new Time();
        time.ticks = String(Math.round(baseTicks + (Number(keys[i].ticks) - firstTicks)));
        try { property.addKey(time); } catch (addError) {}
        try { property.setValueAtKey(time, wanted, true); } catch (setError) {}
        try {
            readBack = property.getValueAtKey(time);
            if (!prfx.capturedValuesMatch(wanted, readBack)) return false;
        } catch (readError) { return false; }
    }
    landed = prfx.countPropertyKeys(property);
    return landed >= keys.length;
};

prfx.applyMockPresetParams = function (component, params, detail) {
    var usedIndices = {}, applied = 0, matched = 0, failed = 0, skippedDefault = 0, unmatched = 0, keyframed = 0, failedNames = [], unmatchedNames = [], i, property, value, hasKeys;
    for (i = 0; i < Number(params && params.length || 0); i++) {
        value = params[i].value;
        if (!prfx.isSimpleMockPresetValue(value)) { unmatched++; continue; }
        property = prfx.findMockPresetProperty(component, params[i], usedIndices);
        if (!property) { unmatched++; unmatchedNames.push(String(params[i].name || 'parameter')); continue; }
        matched++;
        hasKeys = params[i].keyframes && params[i].keyframes.length;
        if (hasKeys) {
            if (prfx.writeMockPresetKeyframes(property, params[i], detail)) keyframed++;
            else { failed++; failedNames.push(String(params[i].name || 'keyframed parameter')); }
        } else if (prfx.propertyReadsAs(property, value)) {
            skippedDefault++;
        } else if (prfx.writePropertyValue(property, value)) {
            applied++;
        } else {
            failed++;
            failedNames.push(String(params[i].name || 'parameter'));
        }
    }
    return { applied: applied + keyframed, matched: matched, failed: failed, skippedDefault: skippedDefault, unmatched: unmatched, keyframed: keyframed, failedNames: failedNames, unmatchedNames: unmatchedNames };
};

prfx.findPresetProperty = function (component, param, usedIndices) {
    var properties, count, i, property, wanted = String(param && param.name || ''), wantedNormalized = prfx.normalizedPresetLabel(wanted);
    try { properties = component.properties; count = Number(properties.numItems || properties.length || 0); }
    catch (error) { return null; }
    for (i = 0; i < count; i++) {
        if (usedIndices['i' + i]) continue;
        try { property = properties[i]; } catch (propertyError) { continue; }
        if (property && String(property.displayName || '') === wanted) {
            usedIndices['i' + i] = true;
            return property;
        }
    }
    if (!wantedNormalized) return null;
    for (i = 0; i < count; i++) {
        if (usedIndices['i' + i]) continue;
        try { property = properties[i]; } catch (normalizedError) { continue; }
        if (property && prfx.normalizedPresetLabel(property.displayName) === wantedNormalized) {
            usedIndices['i' + i] = true;
            return property;
        }
    }
    return null;
};

prfx.applyPresetParams = function (component, params) {
    var usedIndices = {}, applied = 0, matched = 0, failed = 0, i, property;
    for (i = 0; i < Number(params && params.length || 0); i++) {
        property = prfx.findPresetProperty(component, params[i], usedIndices);
        if (!property) continue;
        matched++;
        if (prfx.writePropertyValue(property, params[i].value)) applied++;
        else failed++;
    }
    return { applied: applied, matched: matched, failed: failed };
};

// Removing keys is undocumented; both known spellings are tried and the result
// is confirmed by counting. Returns true only if the property ends up empty.
prfx.clearPropertyKeys = function (property) {
    var keys, i, guard = 0;
    if (prfx.countPropertyKeys(property) === 0) return true;
    try {
        if (typeof property.removeKeyRange === 'function') {
            keys = property.getKeys();
            if (keys && keys.length) property.removeKeyRange(keys[0], keys[keys.length - 1], true);
        }
    } catch (rangeError) {}
    while (prfx.countPropertyKeys(property) > 0 && guard < 200) {
        guard++;
        try {
            keys = property.getKeys();
            if (!keys || !keys.length) break;
            if (typeof property.removeKey !== 'function') break;
            for (i = 0; i < keys.length; i++) property.removeKey(keys[i]);
        } catch (removeError) { break; }
    }
    return prfx.countPropertyKeys(property) === 0;
};

prfx.countPropertyKeys = function (property) {
    var keys;
    try { if (property.isTimeVarying && property.isTimeVarying() !== true) return 0; } catch (varyError) {}
    try { keys = property.getKeys(); } catch (keysError) { return 0; }
    return Number(keys && keys.length || 0);
};

prfx.applyPropertyState = function (component, records, keyShift) {
    var properties, count, i, property, record, k, keyTime, applied = 0, landed;
    keyShift = Number(keyShift) || 0;
    try { properties = component.properties; count = Number(properties.numItems || properties.length || 0); }
    catch (error) { return 0; }
    for (i = 0; i < count && i < records.length; i++) {
        try { property = properties[i]; } catch (propertyError) { continue; }
        record = records[i];
        if (!property || !record) continue;
        // Names must line up, otherwise a reordered component would write
        // Rotation into Scale.
        if (String(property.displayName || '') !== record.displayName) continue;
        if (record.varying) {
            // Seed the static value from the first keyframe BEFORE animating, so
            // a failed keyframe write still leaves a sensible value rather than
            // the property default -- [0,0] for a normalized point.
            if (record.keys.length) prfx.writePropertyValue(property, record.keys[0].value);
            // A property will not accept keys until it is time-varying, and
            // addKey does not always turn that on by itself.
            try { if (typeof property.setTimeVarying === 'function') property.setTimeVarying(true); } catch (varyError) {}
            // Swapping a clip's media collapses its existing keyframes toward
            // the media start. Those stale keys have to go, or re-adding the
            // correct ones just interleaves with them.
            if (!prfx.clearPropertyKeys(property)) prfx.lastKeyClearFailures++;
            for (k = 0; k < record.keys.length; k++) {
                try {
                    keyTime = new Time();
                    keyTime.ticks = String(Math.round(Number(record.keys[k].ticks) + keyShift));
                    property.addKey(keyTime);
                    property.setValueAtKey(keyTime, record.keys[k].value, true);
                    if (record.keys[k].interpolation !== null) {
                        try { property.setInterpolationTypeAtKey(keyTime, record.keys[k].interpolation, true); } catch (interpolationError) {}
                    }
                } catch (keyError) {}
            }
            // Confirm the animation actually exists; a silently dropped keyframe
            // set looks identical to a static copy.
            landed = prfx.countPropertyKeys(property);
            if (landed < record.keys.length) {
                prfx.lastPropertyFailures.push(record.displayName + ' keyframes (' + landed + ' of ' + record.keys.length + ' applied)');
            }
            applied++;
        } else if (record.value !== null) {
            // Write, then READ BACK. A silently ignored setValue is how Position
            // came out as 0,0 while everything around it survived.
            if (prfx.writePropertyValue(property, record.value)) applied++;
            else prfx.lastPropertyFailures.push(record.displayName);
        }
    }
    return applied;
};

// setValue's second argument is undocumented and not honoured for every
// property type, so both forms are tried and the result is confirmed.
// Scalar writes land; array-valued ones (Position, Anchor Point -- both
// normalized 0..1 points, not pixels) do not always. Several argument forms are
// tried and each is confirmed by reading the property back.
prfx.writePropertyValue = function (property, value) {
    var attempt, forms = [], i;
    forms.push(value);
    if (typeof value === 'object' && typeof value.length === 'number') {
        // Some builds want a real Array rather than the collection getValue
        // handed back, and some want the values spread across arguments.
        attempt = [];
        for (i = 0; i < value.length; i++) attempt.push(Number(value[i]));
        forms.push(attempt);
    }
    for (i = 0; i < forms.length; i++) {
        try { property.setValue(forms[i], true); } catch (firstError) {}
        if (prfx.propertyReadsAs(property, value)) return true;
        try { property.setValue(forms[i]); } catch (secondError) {}
        if (prfx.propertyReadsAs(property, value)) return true;
    }
    if (typeof value === 'object' && typeof value.length === 'number' && value.length === 2) {
        try { property.setValue(Number(value[0]), Number(value[1])); } catch (pairError) {}
        if (prfx.propertyReadsAs(property, value)) return true;
    }
    return false;
};

prfx.propertyReadsAs = function (property, value) {
    var readBack;
    try { readBack = property.getValue(); } catch (readError) { return false; }
    return prfx.capturedValuesMatch(value, readBack);
};

// Copies every component from the captured original onto the replacement.
// Components already present (Motion, Opacity, and the other intrinsics) are
// matched by matchName and written into; anything else is an added effect and
// is recreated by name through QE first.
prfx.applyComponentState = function (qeSequence, publicClip, qeClip, kind, captured) {
    var usedIndices = {}, i, entry, target, effect, missing = 0, shift = 0, nowIn, nowStart;
    if (!prfx.lastPropertyFailures) prfx.lastPropertyFailures = [];
    // Work out how far this clip's source range sits from the original's and
    // slide every keyframe by the same amount. Identical in-points give a shift
    // of zero, so this is a no-op in the common case.
    try { nowIn = Number(publicClip.inPoint.ticks); } catch (inError) { nowIn = NaN; }
    try { nowStart = Number(publicClip.start.ticks); } catch (startError) { nowStart = NaN; }
    if (!isNaN(captured.inTicks) && !isNaN(nowIn)) shift = nowIn - captured.inTicks;
    else if (!isNaN(captured.startTicks) && !isNaN(nowStart)) shift = nowStart - captured.startTicks;
    prfx.lastKeyShift = shift;
    for (i = 0; i < captured.length; i++) {
        entry = captured[i];
        target = prfx.findComponentByMatchName(publicClip, entry.matchName, usedIndices);
        if (!target && qeClip && entry.displayName) {
            try {
                effect = kind === 'audio' ? qe.project.getAudioEffectByName(entry.displayName)
                                          : qe.project.getVideoEffectByName(entry.displayName);
                if (effect) {
                    if (kind === 'audio') qeClip.addAudioEffect(effect);
                    else qeClip.addVideoEffect(effect);
                }
            } catch (addError) {}
            target = prfx.findComponentByMatchName(publicClip, entry.matchName, usedIndices);
        }
        if (!target) { missing++; continue; }
        prfx.applyPropertyState(target, entry.properties, shift);
    }
    return missing;
};

// Attributes that live on the TrackItem rather than in a component.
prfx.captureClipAttributes = function (clip) {
    var state = { disabled: false, name: '' };
    try { state.disabled = clip.disabled === true; } catch (disabledError) {}
    try { state.name = String(clip.name || ''); } catch (nameError) {}
    return state;
};

prfx.applyClipAttributes = function (clip, state) {
    try { if (state.disabled === true) clip.disabled = true; } catch (disabledError) {}
};

// Dumps the selected clip's components and property values. Effect Controls
// shows what Premiere renders; this shows what the scripting API actually
// returns, which is what the copy code works from. The two can differ, and
// guessing which is why Position took several rounds.
prfx.describeCapturedValue = function (value) {
    var parts = [], i;
    if (value === null || value === undefined) return '<null>';
    if (typeof value === 'object' && typeof value.length === 'number') {
        for (i = 0; i < value.length; i++) parts.push(String(value[i]));
        return '[' + parts.join(', ') + ']';
    }
    return String(value);
};

prfx.inspectSelectedClip = function (publicSequence, qeSequence) {
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence, false), detail, clip;
    var captured, lines = [], i, j, entry, record, path, file;

    if (!snapshot.selected.length) return 'ERROR: Select one Timeline clip to inspect.';
    detail = snapshot.selected[0];
    clip = prfx.resolveMovePublicClipAt(publicSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
    if (!clip) return 'ERROR: Could not resolve the selected clip.';

    lines.push('PR FX clip inspection - host ' + prfx.HOST_BUILD);
    lines.push('clip: ' + detail.name + '  (' + detail.kind + ' track ' + (detail.sourceTrackIndex + 1) + ')');
    lines.push('range: ' + detail.start.toFixed(3) + ' - ' + detail.end.toFixed(3));
    try { lines.push('speed: ' + clip.getSpeed() + '   reversed: ' + clip.isSpeedReversed()); } catch (speedError) {}
    try {
        path = prfx.projectItemPath(clip.projectItem);
        lines.push('media: ' + path);
        file = new File(path);
        if (file.exists) lines.push('  modified: ' + file.modified + '   created: ' + file.created + '   size: ' + file.length);
    } catch (pathError) {}
    lines.push('');

    captured = prfx.captureComponentState(clip);
    lines.push('clip inPoint ticks=' + captured.inTicks + ' (' + prfx.secondsForTicks(String(captured.inTicks)).toFixed(3) + 's)' +
        '   start ticks=' + captured.startTicks);
    lines.push(captured.length + ' components:');
    for (i = 0; i < captured.length; i++) {
        entry = captured[i];
        lines.push('  [' + i + '] ' + entry.displayName + '   matchName=' + entry.matchName);
        for (j = 0; j < entry.properties.length; j++) {
            record = entry.properties[j];
            lines.push('       ' + j + '. ' + record.displayName +
                (record.varying ? '  KEYFRAMED x' + record.keys.length +
                    (record.keys.length ? '  first=' + prfx.describeCapturedValue(record.keys[0].value) : '')
                  : '  = ' + prfx.describeCapturedValue(record.value)));
            for (var kk = 0; record.varying && kk < record.keys.length; kk++) {
                lines.push('            key ' + kk + ' ticks=' + record.keys[kk].ticks +
                    '  = ' + prfx.secondsForTicks(record.keys[kk].ticks).toFixed(3) + 's' +
                    '  clipStart+' + (prfx.secondsForTicks(record.keys[kk].ticks) - detail.start).toFixed(3) +
                    '  in+' + (prfx.secondsForTicks(record.keys[kk].ticks) - prfx.secondsForTicks(String(captured.inTicks))).toFixed(3) +
                    '  ' + prfx.describeCapturedValue(record.keys[kk].value));
            }
        }
    }
    lines.push('');

    path = Folder.myDocuments.parent.fsName + '/Library/Logs/PR FX Clip Inspection.txt';
    try {
        file = new File(path);
        file.encoding = 'UTF-8';
        file.open('w');
        file.write(lines.join('\n'));
        file.close();
    } catch (writeError) { return 'ERROR: Could not write the inspection: ' + writeError.toString(); }
    return 'Wrote clip inspection to ' + path + ' (' + lines.length + ' lines).';
};

// ---------------------------------------------------------------------------
// Direct source swap
//
// Rebuilding a clip and copying its attributes across is inherently lossy --
// normalized array properties and keyframes are proving unwritable. Swapping the
// media UNDER the existing clip keeps position, scale, keyframes, effects,
// speed, in/out and links because it is still the same clip.
//
// Neither route is documented, so both are attempted and the result is verified
// against the media path. Failure falls back to the staging path.
// ---------------------------------------------------------------------------
prfx.clipMediaPath = function (clip) {
    try { return prfx.projectItemPath(clip.projectItem).toLowerCase(); } catch (error) { return ''; }
};

// A shorter replacement leaves the clip's tail pointing past the end of the new
// media, which renders as offline rather than failing outright.
// After a replace, confirm the clip really carries the original's source
// in/out range and keyframe counts. Two clips diverging in a single run is only
// visible if each one is checked and reported.
prfx.noteReplaceOutcome = function (detail, captured) {
    var clip = prfx.resolveMovePublicClipAt(app.project.activeSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
    var actual, i, j, wantKeys = 0, gotKeys = 0;
    if (!clip) { prfx.lastPropertyFailures.push('"' + detail.name + '" could not be re-read after replacing'); return; }
    try {
        if (!isNaN(captured.inTicks) && Math.abs(Number(clip.inPoint.ticks) - captured.inTicks) > 1000) {
            prfx.lastPropertyFailures.push('"' + detail.name + '" source in-point is ' +
                prfx.secondsForTicks(String(clip.inPoint.ticks)).toFixed(3) + 's, wanted ' +
                prfx.secondsForTicks(String(captured.inTicks)).toFixed(3) + 's');
        }
    } catch (inError) {}
    try {
        if (!isNaN(captured.outTicks) && Math.abs(Number(clip.outPoint.ticks) - captured.outTicks) > 1000) {
            prfx.lastPropertyFailures.push('"' + detail.name + '" source out-point is ' +
                prfx.secondsForTicks(String(clip.outPoint.ticks)).toFixed(3) + 's, wanted ' +
                prfx.secondsForTicks(String(captured.outTicks)).toFixed(3) + 's');
        }
    } catch (outError) {}
    actual = prfx.captureComponentState(clip);
    for (i = 0; i < captured.length; i++) {
        for (j = 0; j < captured[i].properties.length; j++) if (captured[i].properties[j].varying) wantKeys += captured[i].properties[j].keys.length;
    }
    for (i = 0; i < actual.length; i++) {
        for (j = 0; j < actual[i].properties.length; j++) if (actual[i].properties[j].varying) gotKeys += actual[i].properties[j].keys.length;
    }
    if (gotKeys !== wantKeys) {
        prfx.lastPropertyFailures.push('"' + detail.name + '" has ' + gotKeys + ' keyframes, wanted ' + wantKeys);
    }
};

prfx.warnIfClipOffline = function (clip, name) {
    var handles = prfx.clipMediaHandles(clip);
    if (!handles) return;
    if (handles.afterSeconds < -0.0001) {
        prfx.lastPropertyFailures.push('"' + name + '" now runs past the end of the new media');
    }
};

prfx.clipSourceState = function (clip) {
    var state = { inTicks: '', outTicks: '' };
    try { state.inTicks = String(clip.inPoint.ticks); } catch (inError) {}
    try { state.outTicks = String(clip.outPoint.ticks); } catch (outError) {}
    return state;
};

prfx.sourceTicksMatch = function (a, b) {
    var left, right;
    if (String(a || '') === String(b || '')) return true;
    left = prfx.numericTicks(a);
    right = prfx.numericTicks(b);
    if (isNaN(left) || isNaN(right)) return false;
    return Math.abs(left - right) <= 1000;
};

prfx.sourceStateMatches = function (actual, wanted) {
    if (!wanted) return true;
    if (wanted.inTicks !== '' && !prfx.sourceTicksMatch(actual && actual.inTicks, wanted.inTicks)) return false;
    if (wanted.outTicks !== '' && !prfx.sourceTicksMatch(actual && actual.outTicks, wanted.outTicks)) return false;
    return true;
};

prfx.writeClipSourceRange = function (clip, wantedState) {
    var time;
    if (!clip || !wantedState) return 'missing clip or source range';
    if (wantedState.inTicks !== '') {
        try {
            time = new Time();
            time.ticks = wantedState.inTicks;
            clip.inPoint = time;
        } catch (inError) { return 'Premiere refused to set the source in-point'; }
    }
    if (wantedState.outTicks !== '') {
        try {
            time = new Time();
            time.ticks = wantedState.outTicks;
            clip.outPoint = time;
        } catch (outError) { return 'Premiere refused to set the source out-point'; }
    }
    return '';
};

// Swapping the media does not necessarily carry the clip's source in/out with
// it -- the new file gets used from its own start, which shows as the shot being
// chopped. Put the original source range back and confirm it took, without
// letting the clip move on the timeline.
prfx.restoreClipSourceRange = function (detail, wantedState, frameSeconds) {
    var clip = prfx.resolveMovePublicClipAt(app.project.activeSequence, detail, detail.sourceTrackIndex, detail.start, detail.end),
        actual, writeProblem;
    prfx.lastReplaceStep = 'Restoring source in/out for ' + String(detail && detail.name || detail && detail.projectItemName || 'replacement clip');
    prfx.lastReplaceSourceRange = { wanted: wantedState || null, before: null, after: null };
    if (!clip) return 'the clip could not be re-read after the swap';
    actual = prfx.clipSourceState(clip);
    prfx.lastReplaceSourceRange.before = actual;
    if (prfx.sourceStateMatches(actual, wantedState)) {
        prfx.lastReplaceSourceRange.after = actual;
        return '';
    }
    writeProblem = prfx.writeClipSourceRange(clip, wantedState);
    if (writeProblem) return writeProblem;

    clip = prfx.resolveMovePublicClipAt(app.project.activeSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
    if (!clip) return 'the clip moved on the timeline when its source range was set';
    actual = prfx.clipSourceState(clip);
    prfx.lastReplaceSourceRange.after = actual;
    if (wantedState.inTicks !== '' && !prfx.sourceTicksMatch(actual.inTicks, wantedState.inTicks)) return 'the source in-point did not take';
    if (wantedState.outTicks !== '' && !prfx.sourceTicksMatch(actual.outTicks, wantedState.outTicks)) return 'the source out-point did not take';
    return '';
};

prfx.tryDirectSourceSwap = function (publicSequence, detail, source, frameSeconds) {
    var clip, wanted, before, attempts, i, after, sourceState, problem, qeClip;
    clip = prfx.resolveMovePublicClipAt(publicSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
    if (!clip) return { ok: false, reason: 'clip not found' };
    wanted = prfx.projectItemPath(source).toLowerCase();
    if (!wanted.length) return { ok: false, reason: 'replacement has no media path' };
    before = prfx.clipMediaPath(clip);
    // Record the source range BEFORE the swap; it is what makes the shot show
    // the same moment rather than restarting from frame zero.
    sourceState = prfx.clipSourceState(clip);
    if (before === wanted) return { ok: true, already: true };

    attempts = ['projectItem', 'qeReplaceWith'];
    for (i = 0; i < attempts.length; i++) {
        try {
            if (attempts[i] === 'projectItem') {
                clip.projectItem = source;
            } else {
                app.enableQE();
                qeClip = prfx.resolveMoveQEClipAt(qe.project.getActiveSequence(), detail,
                    detail.sourceTrackIndex, detail.start, detail.end);
                if (!qeClip || typeof qeClip.replaceWith !== 'function') continue;
                qeClip.replaceWith(prfx.projectItemPath(source));
            }
        } catch (attemptError) { continue; }

        clip = prfx.resolveMovePublicClipAt(app.project.activeSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
        if (!clip) return { ok: false, reason: 'the clip vanished after the ' + attempts[i] + ' swap' };
        after = prfx.clipMediaPath(clip);
        if (after !== wanted) continue;
        problem = prfx.restoreClipSourceRange(detail, sourceState, frameSeconds);
        if (problem) return { ok: true, how: attempts[i], sourceRangeWarning: problem };
        return { ok: true, how: attempts[i] };
    }
    return { ok: false, reason: 'neither projectItem assignment nor QE replaceWith took' };
};

// ---------------------------------------------------------------------------
// Place the Source monitor clip at the playhead
//
// The usual workflow is to load footage into the Source monitor and mark In/Out
// there without ever touching the Project panel. Those marks live on the
// projectItem, which is why this stages with keepRange -- widening the range as
// the bin placement does would throw the editor's marks away.
// ---------------------------------------------------------------------------
prfx.sourceMonitorItem = function () {
    var item = null;
    try {
        if (!app.sourceMonitor || typeof app.sourceMonitor.getProjectItem !== 'function') return null;
        item = app.sourceMonitor.getProjectItem();
    } catch (error) { return null; }
    return item || null;
};

prfx.placeSourceMonitorClip = function (publicSequence, qeSequence) {
    var item = prfx.sourceMonitorItem(), checkpoint, staging, live, playhead, atSeconds;
    var staged, snapshot, videoTarget, audioTarget, failure = null, created = [], spans, clip, marked, placedAudio, j;

    if (!item) return 'ERROR: Load a clip into the Source monitor first - PR FX places whatever is open there.';
    if (!prfx.projectItemIsPlaceable(item)) {
        return 'ERROR: "' + String(item.name) + '" is not placeable media. Sequences and synthetics cannot be placed.';
    }

    try { playhead = publicSequence.getPlayerPosition(); } catch (playheadError) { playhead = null; }
    atSeconds = prfx.timeInSeconds(playhead);
    if (!(atSeconds >= 0)) return 'ERROR: Premiere could not read the playhead position.';

    marked = prfx.projectItemRange(item);
    checkpoint = prfx.undoCheckpoint();
    staging = prfx.createStagingTracks(publicSequence, qeSequence);
    if (!staging.ok) {
        prfx.revertToUndoCheckpoint(checkpoint, 12);
        return 'ERROR: Could not prepare a safe staging track - ' + staging.message + '. Nothing was placed.';
    }

    try {
        // keepRange: the Source monitor In/Out is the whole point here.
        staged = prfx.stageOneProjectItem(staging.tracks, item, atSeconds, true);
        spans = [{ start: staged.start, end: staged.end }];
        if (staged.audioOnly) {
            // Music loaded in the Source monitor is the common case here.
            live = app.project.activeSequence;
            snapshot = prfx.moveSelectionSnapshot(live, qe.project.getActiveSequence(), false);
            snapshot.tracks.audio.length = staging.tracks.audioIndex;
            placedAudio = prfx.placeStagedAudioClips(staging, staged.audioClips, null, null, '"' + String(item.name) + '"');
            for (j = 0; j < placedAudio.length; j++) created.push(placedAudio[j]);
            audioTarget = placedAudio.length ? placedAudio[0].trackIndex : null;
            throw { prfxDone: true };
        }

        live = app.project.activeSequence;
        snapshot = prfx.moveSelectionSnapshot(live, qe.project.getActiveSequence(), false);
        snapshot.tracks.video.length = staging.tracks.videoIndex;
        snapshot.tracks.audio.length = staging.tracks.audioIndex;

        videoTarget = prfx.freeDestinationTrack(snapshot, 'video', spans);
        if (videoTarget === null) throw new Error('no video track has room at the playhead');
        audioTarget = staged.audio ? prfx.freeDestinationTrack(snapshot, 'audio', spans) : null;
        if (staged.audio && audioTarget === null) throw new Error('no audio track has room at the playhead');

        prfx.moveStagedClipToTrack('video', staged.fromTrackIndex, videoTarget, staged.start, staged.end, '"' + String(item.name) + '"');
        created.push({ kind: 'video', trackIndex: videoTarget, start: staged.start, end: staged.end });

        if (staged.audio) {
            live = app.project.activeSequence;
            if (staged.audioClips && staged.audioClips.length) {
                placedAudio = prfx.placeStagedAudioClips(staging, staged.audioClips, null, audioTarget, '"' + String(item.name) + '"');
                for (j = 0; j < placedAudio.length; j++) created.push(placedAudio[j]);
                audioTarget = placedAudio.length ? placedAudio[0].trackIndex : audioTarget;
            }
        }
    } catch (error) {
        // The audio-only path finishes early rather than running the video
        // placement below; that is a completed run, not a failure.
        if (!error || error.prfxDone !== true) failure = error.toString();
    }

    prfx.removeStagingTracks(qeSequence, staging.tracks);

    if (failure) {
        prfx.revertUnlessKeeping(checkpoint, 24);
        return 'ERROR: Placing stopped and ' + prfx.failureOutcomeText() + ' - ' + failure + '.';
    }

    live = app.project.activeSequence;
    prfx.selectClipRanges(live, created);
    // Re-link the pair so it behaves like a normal edit rather than two loose clips.
    if (created.length === 2) {
        try { live.linkSelection(); } catch (linkError) {}
    }

    return 'Placed "' + String(item.name) + '" from the Source monitor at the playhead on video track ' + (videoTarget + 1) +
        (created.length === 2 ? ' with its audio on A' + (audioTarget + 1) : '') + '.' +
        (marked ? ' Used the marked In/Out (' + marked.inSeconds.toFixed(2) + '-' + marked.outSeconds.toFixed(2) + 's).' : '');
};

// ---------------------------------------------------------------------------
// Perfect Pitch
//
// A speed-changed audio clip plays back transposed. Pitch Shifter can undo that,
// but the correction has to be the exact reciprocal of the clip's speed: a clip
// at 200% needs a displayed ratio of 0.5.
//
// Premiere exposes Transpose Ratio as 0..1 while the effect UI displays it
// linearly as 0.5..2.0, so the displayed ratio must be encoded before writing.
// Writing the displayed value straight into the parameter is the obvious bug
// and produces a silently wrong correction.
// ---------------------------------------------------------------------------
prfx.PITCH_MIN_RATIO = 0.5;
prfx.PITCH_MAX_RATIO = 2.0;

prfx.normalizedPitchName = function (value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
};

prfx.displayedPitchToParameter = function (displayedRatio) {
    return (displayedRatio - prfx.PITCH_MIN_RATIO) / (prfx.PITCH_MAX_RATIO - prfx.PITCH_MIN_RATIO);
};

prfx.componentLooksLikePitchShifter = function (component) {
    var names = ['displayName', 'matchName', 'name'], i, text;
    for (i = 0; i < names.length; i++) {
        try { text = prfx.normalizedPitchName(component[names[i]]); } catch (error) { text = ''; }
        if (text.indexOf('pitchshifter') !== -1) return true;
    }
    return false;
};

// An instance the editor renamed "speed" is the one they mean; that convention
// comes from the reference tool and is worth honouring.
prfx.componentIsSpeedPitchShifter = function (component) {
    var text = '';
    if (!prfx.componentLooksLikePitchShifter(component)) return false;
    try { text = prfx.normalizedPitchName(component.instanceName || component.name); } catch (error) { text = ''; }
    return text.indexOf('speed') !== -1;
};

prfx.pitchShifterComponents = function (clip) {
    var out = [], components, count, i, component;
    try { components = clip.components; count = Number(components.numItems || components.length || 0); }
    catch (error) { return out; }
    for (i = 0; i < count; i++) {
        try { component = components[i]; } catch (componentError) { continue; }
        if (component && prfx.componentLooksLikePitchShifter(component)) out.push(component);
    }
    return out;
};

prfx.preferredPitchComponent = function (clip) {
    var found = prfx.pitchShifterComponents(clip), i;
    for (i = 0; i < found.length; i++) if (prfx.componentIsSpeedPitchShifter(found[i])) return found[i];
    // Two unlabelled Pitch Shifters is genuinely ambiguous; refuse rather than
    // pick one and silently double-correct.
    return found.length === 1 ? found[0] : null;
};

prfx.pitchRatioParameter = function (component) {
    var properties, count, i, name, fallback = null;
    if (!component) return null;
    try { properties = component.properties; count = Number(properties.numItems || properties.length || 0); }
    catch (error) { return null; }
    for (i = 0; i < count; i++) {
        try { name = prfx.normalizedPitchName(properties[i].displayName); } catch (propertyError) { continue; }
        if (name === 'transposeratio' || name === 'pitchtransposeratio') return properties[i];
        if (name === 'ratio') fallback = properties[i];
    }
    return fallback;
};

prfx.applyPerfectPitch = function (publicSequence, qeSequence) {
    // Linked audio is included, so selecting the video half of a retimed pair
    // corrects its audio without the editor having to select it separately.
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence, true), selected = snapshot.selected;
    var plans = [], unsupported = [], i, detail, clip, speed, displayed, component, parameter;
    var checkpoint, effect, qeClip, corrected = 0, reset = 0, added = 0, failure = null, readBack, wanted;

    if (!selected.length) {
        if (snapshot.staleSelectionCount) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        return 'ERROR: Select clips with audio to correct.';
    }

    // Preflight the whole batch before touching anything.
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        if (detail.kind !== 'audio') continue;
        clip = prfx.resolveMovePublicClipAt(publicSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
        if (!clip) continue;
        try { speed = Number(clip.getSpeed()); } catch (speedError) { speed = 1; }
        if (!(speed > 0)) { unsupported.push(detail.name + ' has an unreadable speed'); continue; }
        displayed = 1 / speed;
        component = prfx.preferredPitchComponent(clip);
        if (Math.abs(speed - 1) < 0.0001) {
            // At 100% there is nothing to correct, but a stale correction from a
            // previous speed must not be left running.
            if (component) plans.push({ detail: detail, displayed: 1, component: component, resetOnly: true });
            continue;
        }
        if (displayed < prfx.PITCH_MIN_RATIO - 0.0001 || displayed > prfx.PITCH_MAX_RATIO + 0.0001) {
            unsupported.push(detail.name + ' needs a ' + displayed.toFixed(3) +
                ' correction, outside Pitch Shifter\'s ' + prfx.PITCH_MIN_RATIO + '-' + prfx.PITCH_MAX_RATIO + ' range');
            continue;
        }
        if (!component && prfx.pitchShifterComponents(clip).length > 1) {
            unsupported.push(detail.name + ' has more than one Pitch Shifter and none named "speed"');
            continue;
        }
        plans.push({ detail: detail, displayed: displayed, component: component, resetOnly: false });
    }

    if (unsupported.length) {
        return 'ERROR: Nothing was changed. ' + unsupported.join('; ') + '.';
    }
    if (!plans.length) return 'No selected audio needs a pitch correction.';

    checkpoint = prfx.undoCheckpoint();
    try {
        for (i = 0; i < plans.length; i++) {
            detail = plans[i].detail;
            clip = prfx.resolveMovePublicClipAt(app.project.activeSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
            if (!clip) throw new Error('lost track of ' + detail.name);
            component = plans[i].component;
            if (!component) {
                app.enableQE();
                qeClip = prfx.resolveMoveQEClipAt(qe.project.getActiveSequence(), detail, detail.sourceTrackIndex, detail.start, detail.end);
                effect = qe.project.getAudioEffectByName('Pitch Shifter');
                if (!qeClip || !effect) throw new Error('Pitch Shifter is not available in this Premiere installation');
                qeClip.addAudioEffect(effect);
                added++;
                clip = prfx.resolveMovePublicClipAt(app.project.activeSequence, detail, detail.sourceTrackIndex, detail.start, detail.end);
                component = prfx.preferredPitchComponent(clip);
                if (!component) throw new Error('Premiere did not publish Pitch Shifter on ' + detail.name);
            }
            parameter = prfx.pitchRatioParameter(component);
            if (!parameter) throw new Error('Transpose Ratio is not exposed on ' + detail.name);
            if (prfx.countPropertyKeys(parameter) > 0) throw new Error('Transpose Ratio is keyframed on ' + detail.name);
            wanted = prfx.displayedPitchToParameter(plans[i].displayed);
            try { parameter.setValue(wanted, true); } catch (writeError) { throw new Error('Premiere refused the correction on ' + detail.name); }
            try { readBack = Number(parameter.getValue()); } catch (readError) { readBack = NaN; }
            if (isNaN(readBack) || Math.abs(readBack - wanted) > 0.001) {
                throw new Error('the correction did not take on ' + detail.name);
            }
            if (plans[i].resetOnly) reset++; else corrected++;
        }
    } catch (error) { failure = error.toString(); }

    if (failure) {
        prfx.revertUnlessKeeping(checkpoint, plans.length * 4 + 12);
        return 'ERROR: Perfect Pitch stopped and ' + prfx.failureOutcomeText() + ' - ' + failure + '.';
    }

    return 'Corrected pitch on ' + corrected + ' clip' + (corrected === 1 ? '' : 's') +
        (added ? ' (added Pitch Shifter to ' + added + ')' : '') +
        (reset ? ', reset ' + reset + ' back to neutral at 100% speed' : '') + '.';
};

// ---------------------------------------------------------------------------
// Failure ledger
//
// Failures have been intermittent, which is the hardest kind to chase from
// screenshots. Every command outcome is recorded against a fingerprint of the
// error, so repeats group together and the ledger can say whether something is
// still broken, genuinely intermittent, or fixed by a later build.
//
// The build stamp is recorded on every entry on purpose: a stale host produces
// exactly this "works sometimes" signature, and an entry whose failures all
// happened on an out-of-date build usually is not a real bug at all.
// ---------------------------------------------------------------------------
// Verification here is deliberately strict, and strict checks produce the odd
// false alarm -- a read-back that lags, a wrapper that reports stale values.
// Rolling back good work on a false alarm is its own kind of damage, so the
// editor chooses: undo everything, or keep it and judge for themselves.
// Either way the universal undo checkpoint is still recorded, so "keep" is
// recoverable rather than final.
if (prfx.failurePolicy === undefined) prfx.failurePolicy = 'rollback';

prfx.revertUnlessKeeping = function (checkpoint, maxSteps) {
    if (prfx.failurePolicy === 'keep') {
        return { ok: false, steps: 0, kept: true, message: 'kept by failure policy' };
    }
    return prfx.revertToUndoCheckpoint(checkpoint, maxSteps);
};

// Wording has to follow the policy, or the message lies about what is on the
// Timeline -- which is worse than the failure it is reporting.
prfx.failureOutcomeText = function () {
    return prfx.failurePolicy === 'keep'
        ? 'changes were KEPT (failure policy). Check the Timeline; Undo Last PR FX Action (Any) reverts it'
        : 'everything was rolled back';
};

prfx.LEDGER_FILE = 'PR FX Failures.json';
prfx.REPORT_FILE = 'PR FX Failure Report.txt';

prfx.logPath = function (fileName) {
    return Folder.myDocuments.parent.fsName + '/Library/Logs/' + fileName;
};

prfx.readLedger = function () {
    var file, text = '', parsed;
    try {
        file = new File(prfx.logPath(prfx.LEDGER_FILE));
        if (!file.exists) return { entries: {} };
        file.encoding = 'UTF-8';
        file.open('r');
        text = file.read();
        file.close();
    } catch (readError) { return { entries: {} }; }
    try { parsed = JSON.parse(text); } catch (parseError) { return { entries: {} }; }
    if (!parsed || !parsed.entries) return { entries: {} };
    return parsed;
};

prfx.writeLedger = function (ledger) {
    var file;
    try {
        file = new File(prfx.logPath(prfx.LEDGER_FILE));
        file.encoding = 'UTF-8';
        file.open('w');
        file.write(JSON.stringify(ledger));
        file.close();
        return true;
    } catch (writeError) { return false; }
};

// Strip the parts that vary between runs -- clip names, numbers, paths -- so the
// same underlying failure lands on one entry instead of fifty.
prfx.failureFingerprint = function (commandId, message) {
    var text = String(message || '');
    text = text.replace(/“[^”]*”/g, 'X');
    text = text.replace(/"[^"]*"/g, 'X');
    text = text.replace(/\/[^\s,;)]+/g, 'PATH');
    text = text.replace(/[0-9]+(\.[0-9]+)?/g, 'N');
    text = text.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ');
    text = text.replace(/^\s+|\s+$/g, '').substring(0, 120);
    return String(commandId || 'unknown') + '|' + text;
};

prfx.nowStamp = function () {
    var now = new Date();
    function pad(value) { return (value < 10 ? '0' : '') + value; }
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
        ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
};

// Reads the build on disk so a failure can be flagged as "ran on a stale host".
prfx.onDiskBuild = function () {
    var status;
    try { status = JSON.parse(prfx.buildStatus(prfx.EXTENSION_ROOT)); } catch (error) { return ''; }
    return status && status.onDisk ? String(status.onDisk) : '';
};

prfx.recordOutcome = function (command, result) {
    var failed = typeof result === 'string' && result.indexOf('ERROR:') === 0;
    var ledger, key, entry, label, onDisk;
    if (!command) return;
    label = prfx.commandLabel(command);
    ledger = prfx.readLedger();
    key = failed ? prfx.failureFingerprint(command.id, result) : ('ok|' + String(command.id));

    if (!failed) {
        // Successes are only interesting against a known failure: they turn
        // "still broken" into "intermittent" or "fixed in a later build".
        for (var existing in ledger.entries) {
            if (!ledger.entries.hasOwnProperty(existing)) continue;
            if (existing.indexOf(String(command.id) + '|') !== 0) continue;
            ledger.entries[existing].successCount = Number(ledger.entries[existing].successCount || 0) + 1;
            ledger.entries[existing].lastSuccess = prfx.nowStamp();
            ledger.entries[existing].lastSuccessBuild = prfx.HOST_BUILD;
        }
        prfx.writeLedger(ledger);
        return;
    }

    onDisk = prfx.onDiskBuild();
    entry = ledger.entries[key];
    if (!entry) {
        entry = { command: label, commandId: String(command.id || ''), firstSeen: prfx.nowStamp(),
            failCount: 0, successCount: 0, sample: String(result).substring(0, 400) };
    }
    entry.failCount = Number(entry.failCount || 0) + 1;
    entry.lastSeen = prfx.nowStamp();
    entry.lastFailBuild = prfx.HOST_BUILD;
    entry.sample = String(result).substring(0, 400);
    entry.staleHost = (onDisk && onDisk !== prfx.HOST_BUILD) ? (prfx.HOST_BUILD + ' vs ' + onDisk) : '';
    ledger.entries[key] = entry;
    prfx.writeLedger(ledger);
};

// OPEN        failed, and nothing has succeeded since
// INTERMITTENT failed and succeeded on the SAME build -- the nasty kind
// RESOLVED    last success came from a newer build than the last failure
prfx.ledgerStatus = function (entry) {
    if (!Number(entry.successCount || 0)) return 'OPEN';
    if (!entry.lastSuccess || entry.lastSuccess < entry.lastSeen) return 'OPEN';
    if (entry.lastSuccessBuild && entry.lastFailBuild && entry.lastSuccessBuild !== entry.lastFailBuild) {
        return 'RESOLVED';
    }
    return 'INTERMITTENT';
};

// A short stable handle per distinct bug, so a specific one can be referred to
// ("a3f1 is fixed") instead of pasting the whole message around.
prfx.entryTag = function (key) {
    var hash = 0, i;
    for (i = 0; i < key.length; i++) {
        hash = ((hash * 31) + key.charCodeAt(i)) % 1048576;
    }
    hash = hash.toString(16);
    while (hash.length < 4) hash = '0' + hash;
    return hash.substring(hash.length - 4);
};

prfx.STATUS_ORDER = ['OPEN', 'INTERMITTENT', 'RESOLVED'];

// Grouped by FUNCTION, not by status: after fixing something the question is
// always "what else has this function hit, and is any of it still open".
// Functions with no recorded failures are listed too, so the report doubles as
// a checklist of what has actually been exercised.
prfx.failureReport = function () {
    var ledger = prfx.readLedger(), lines = [], byCommand = {}, ids = [], key, entry, id;
    var i, j, list, status, counts = { OPEN: 0, INTERMITTENT: 0, RESOLVED: 0 };
    var clean = [], withHistory = [], openFunctions = [];

    for (key in ledger.entries) {
        if (!ledger.entries.hasOwnProperty(key)) continue;
        entry = ledger.entries[key];
        entry.key = key;
        entry.status = prfx.ledgerStatus(entry);
        entry.tag = prfx.entryTag(key);
        counts[entry.status]++;
        id = String(entry.commandId || 'unknown');
        if (!byCommand[id]) { byCommand[id] = { name: entry.command || id, entries: [] }; ids.push(id); }
        byCommand[id].entries.push(entry);
    }
    // Every registered function, so ones that have never failed still appear.
    for (id in prfx.functions) {
        if (!prfx.functions.hasOwnProperty(id)) continue;
        if (byCommand[id]) continue;
        byCommand[id] = { name: id, entries: [] };
        ids.push(id);
    }

    for (i = 0; i < ids.length; i++) {
        list = byCommand[ids[i]].entries;
        if (!list.length) { clean.push(ids[i]); continue; }
        status = 'RESOLVED';
        for (j = 0; j < list.length; j++) {
            if (list[j].status === 'OPEN') { status = 'OPEN'; break; }
            if (list[j].status === 'INTERMITTENT') status = 'INTERMITTENT';
        }
        if (status === 'RESOLVED') withHistory.push(ids[i]); else openFunctions.push(ids[i]);
    }

    lines.push('PR FX failure report — ' + prfx.nowStamp());
    lines.push('Host build: ' + prfx.HOST_BUILD + '   on disk: ' + (prfx.onDiskBuild() || '?'));
    try { lines.push('Premiere: ' + String(app.version) + ' build ' + String(app.build)); } catch (versionError) {}
    lines.push('Bugs: ' + counts.OPEN + ' open, ' + counts.INTERMITTENT + ' intermittent, ' + counts.RESOLVED + ' resolved');
    lines.push('Functions: ' + openFunctions.length + ' needing attention, ' + withHistory.length +
        ' fixed, ' + clean.length + ' with no failures recorded');
    lines.push('');
    lines.push('OPEN         still broken; nothing has succeeded since');
    lines.push('INTERMITTENT failed AND succeeded on the SAME build');
    lines.push('RESOLVED     succeeded on a newer build than it last failed on');
    lines.push('');

    lines = lines.concat(prfx.reportFunctionSection('NEEDS ATTENTION', openFunctions, byCommand));
    lines = lines.concat(prfx.reportFunctionSection('FIXED (history kept)', withHistory, byCommand));

    lines.push('== NO FAILURES RECORDED (' + clean.length + ') ==');
    lines.push('  Never failed, or never run — the ledger cannot tell these apart.');
    for (i = 0; i < clean.length; i++) lines.push('  ' + clean[i]);
    lines.push('');

    prfx.writeDiagnostic(prfx.REPORT_FILE, lines);
    return 'Failure report: ' + counts.OPEN + ' open, ' + counts.INTERMITTENT + ' intermittent, ' +
        counts.RESOLVED + ' resolved across ' + (openFunctions.length + withHistory.length) +
        ' function(s). Written to ' + prfx.logPath(prfx.REPORT_FILE);
};

prfx.reportFunctionSection = function (title, ids, byCommand) {
    var lines = [], i, j, list, entry, order, s;
    lines.push('== ' + title + ' (' + ids.length + ') ==');
    if (!ids.length) lines.push('  none');
    for (i = 0; i < ids.length; i++) {
        lines.push('');
        lines.push('  ' + byCommand[ids[i]].name + '   [' + ids[i] + ']');
        list = byCommand[ids[i]].entries;
        for (s = 0; s < prfx.STATUS_ORDER.length; s++) {
            order = prfx.STATUS_ORDER[s];
            for (j = 0; j < list.length; j++) {
                entry = list[j];
                if (entry.status !== order) continue;
                lines.push('    [' + entry.status + ' #' + entry.tag + '] ' +
                    entry.failCount + ' fail / ' + Number(entry.successCount || 0) + ' ok since');
                lines.push('        first ' + entry.firstSeen + '   last ' + entry.lastSeen);
                lines.push('        fail build ' + (entry.lastFailBuild || '?') +
                    '   last ok build ' + (entry.lastSuccessBuild || 'never'));
                if (entry.staleHost) lines.push('        ** STALE HOST (' + entry.staleHost + ') — probably not a real bug **');
                lines.push('        ' + entry.sample);
            }
        }
    }
    lines.push('');
    return lines;
};

prfx.clearFailureLedger = function () {
    prfx.writeLedger({ entries: {} });
    return 'Cleared the PR FX failure ledger.';
};

// ---------------------------------------------------------------------------
// Adjustment layer over the selection
//
// QE has newBarsAndTone, newBlackVideo, newColorMatte and newTransparentVideo
// but no newAdjustmentLayer, so one cannot be created from a script. That suits
// the requirement: reuse the adjustment layer the project already has instead of
// adding another bin item every time.
//
// It is found from the Timeline first -- isAdjustmentLayer() on a TrackItem is
// the only reliable test -- then by scanning the bins as a fallback.
// ---------------------------------------------------------------------------
// A project can hold several sequences at different frame sizes, and an
// adjustment layer is built for the size it was created at. Reusing a 1080x1920
// layer in a 1920x1080 sequence letterboxes it, so "an adjustment layer exists"
// is not enough -- it has to fit THIS timeline.
prfx.sequenceFrameSize = function (sequence) {
    var width = NaN, height = NaN;
    try { width = Number(sequence.frameSizeHorizontal); } catch (widthError) {}
    try { height = Number(sequence.frameSizeVertical); } catch (heightError) {}
    if (!(width > 0) || !(height > 0)) return null;
    return { width: width, height: height };
};

// Frame size is not exposed directly on a ProjectItem; it appears in the
// project metadata as "1080 x 1920". Absent or unparseable means unknown, and
// unknown must never be treated as a match.
prfx.projectItemFrameSize = function (item) {
    var text = '', match;
    try { text = String(item.getProjectMetadata ? item.getProjectMetadata() : ''); } catch (error) { return null; }
    if (!text.length) return null;
    match = text.match(/([0-9]{2,5})\s*[xX\u00d7]\s*([0-9]{2,5})/);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
};

prfx.frameSizesMatch = function (a, b) {
    if (!a || !b) return false;
    return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
};

// Every adjustment layer in the project, plus whether each is already used in
// this sequence -- a layer already living on this timeline is proof of fit that
// no metadata check can beat.
prfx.collectAdjustmentLayers = function (sequence) {
    var out = [], seen = {}, tracks, count, t, clips, clipCount, i, clip, item, id;
    tracks = sequence ? sequence.videoTracks : null;
    count = tracks ? Number(tracks.numTracks || tracks.length || 0) : 0;
    for (t = 0; t < count; t++) {
        try { clips = tracks[t].clips; clipCount = Number(clips.numItems || clips.length || 0); }
        catch (trackError) { clipCount = 0; }
        for (i = 0; i < clipCount; i++) {
            try { clip = clips[i]; } catch (clipError) { continue; }
            try {
                if (!clip || !clip.isAdjustmentLayer || clip.isAdjustmentLayer() !== true) continue;
                item = clip.projectItem;
            } catch (testError) { continue; }
            if (!item) continue;
            id = String(item.nodeId || item.name);
            if (seen[id]) continue;
            seen[id] = true;
            out.push({ item: item, inThisSequence: true });
        }
    }
    prfx.collectAdjustmentLayersInBins(app.project.rootItem, 0, out, seen);
    return out;
};

prfx.collectAdjustmentLayersInBins = function (bin, depth, out, seen) {
    var children, count, i, child, path, id;
    if (depth > 8) return;
    try { children = bin.children; count = Number(children.numItems || 0); } catch (error) { return; }
    for (i = 0; i < count; i++) {
        try { child = children[i]; } catch (childError) { continue; }
        if (!child) continue;
        if (prfx.projectItemIsBin(child)) { prfx.collectAdjustmentLayersInBins(child, depth + 1, out, seen); continue; }
        try { path = String(child.getMediaPath ? child.getMediaPath() : ''); } catch (pathError) { path = ''; }
        if (path.length) continue;
        if (prfx.normalizedPitchName(child.name).indexOf('adjustmentlayer') === -1) continue;
        id = String(child.nodeId || child.name);
        if (seen[id]) continue;
        seen[id] = true;
        out.push({ item: child, inThisSequence: false });
    }
};

// Creation is undocumented, so every plausible entry point is tried and the
// result is confirmed by re-scanning for a layer that was not there before.
prfx.createAdjustmentLayerItem = function (sequence) {
    var size = prfx.sequenceFrameSize(sequence), before = {}, existing, i, after, attempt, attempts;
    existing = prfx.collectAdjustmentLayers(sequence);
    for (i = 0; i < existing.length; i++) before[String(existing[i].item.nodeId || existing[i].item.name)] = true;

    attempts = [
        function () { return qe.project.newAdjustmentLayer ? qe.project.newAdjustmentLayer() : null; },
        function () { return app.project.createNewAdjustmentLayer ? app.project.createNewAdjustmentLayer() : null; },
        function () { return app.project.rootItem.createAdjustmentLayer ? app.project.rootItem.createAdjustmentLayer() : null; },
        function () { return sequence.createAdjustmentLayer ? sequence.createAdjustmentLayer() : null; }
    ];
    for (i = 0; i < attempts.length; i++) {
        try { attempt = attempts[i](); } catch (attemptError) { continue; }
        after = prfx.collectAdjustmentLayers(sequence);
        for (var j = 0; j < after.length; j++) {
            if (!before[String(after[j].item.nodeId || after[j].item.name)]) {
                return { item: after[j].item, created: true, size: size };
            }
        }
    }
    return null;
};

// Premiere cannot create an adjustment layer from a script, so when the project
// has none that fits, they are imported from a template project shipped with the
// tool. Premiere authored that file; nothing here writes it.
prfx.adjustmentTemplatePath = function () {
    var root = prfx.extensionRoot();
    return root ? root.fsName + '/assets/adjustment-layers.prproj' : '';
};

prfx.importAdjustmentTemplate = function (sequence) {
    var path = prfx.adjustmentTemplatePath(), file, before = {}, existing, i, after, attempts, imported = false;
    if (!path.length) return { ok: false, reason: 'the PR FX extension folder could not be located' };
    try { file = new File(path); } catch (fileError) { return { ok: false, reason: 'the template path is unreadable' }; }
    if (!file.exists) {
        return { ok: false, missingTemplate: true,
            reason: 'assets/adjustment-layers.prproj is not installed. See assets/README.md for how to make it' };
    }

    existing = prfx.collectAdjustmentLayers(sequence);
    for (i = 0; i < existing.length; i++) before[String(existing[i].item.nodeId || existing[i].item.name)] = true;

    // Both import routes are undocumented for .prproj, so each is tried and the
    // result confirmed by re-scanning rather than by a return value.
    attempts = [
        function () { return app.project.importFiles ? app.project.importFiles([path], true, app.project.rootItem, false) : null; },
        function () { app.enableQE(); return qe.project.importProject ? qe.project.importProject(path) : null; }
    ];
    for (i = 0; i < attempts.length; i++) {
        try { attempts[i](); imported = true; } catch (attemptError) { continue; }
        after = prfx.collectAdjustmentLayers(sequence);
        for (var j = 0; j < after.length; j++) {
            if (!before[String(after[j].item.nodeId || after[j].item.name)]) {
                return { ok: true, layers: after };
            }
        }
    }
    return { ok: false, reason: imported
        ? 'the template imported but produced no adjustment layer items'
        : 'Premiere refused to import the template project' };
};

// Ordered by how confident we can be that the layer fits:
//   1. already on this timeline  2. metadata frame size matches  3. create one
// A layer of unknown or wrong size is used only as a last resort, and said so.
prfx.resolveAdjustmentLayer = function (sequence) {
    var candidates = prfx.collectAdjustmentLayers(sequence), size = prfx.sequenceFrameSize(sequence);
    var i, itemSize, fallback = null, created, imported;
    for (i = 0; i < candidates.length; i++) {
        if (candidates[i].inThisSequence) return { item: candidates[i].item, reason: 'already used in this sequence' };
    }
    for (i = 0; i < candidates.length; i++) {
        itemSize = prfx.projectItemFrameSize(candidates[i].item);
        if (prfx.frameSizesMatch(itemSize, size)) {
            return { item: candidates[i].item, reason: 'frame size matches this sequence' };
        }
        if (!fallback) fallback = candidates[i].item;
    }
    created = prfx.createAdjustmentLayerItem(sequence);
    if (created) return { item: created.item, reason: 'created for this sequence', created: true };

    // Nothing in the project fits and Premiere will not make one: import the
    // shipped template and look again for a size that matches.
    imported = prfx.importAdjustmentTemplate(sequence);
    if (imported.ok) {
        for (i = 0; i < imported.layers.length; i++) {
            itemSize = prfx.projectItemFrameSize(imported.layers[i].item);
            if (prfx.frameSizesMatch(itemSize, size)) {
                return { item: imported.layers[i].item, reason: 'imported from the PR FX template', created: true };
            }
        }
        // Imported, but none matched this sequence's frame size.
        if (imported.layers.length) {
            return { item: imported.layers[0].item, reason: 'imported from the PR FX template', created: true,
                warning: 'the template has no layer at ' + (size ? size.width + 'x' + size.height : 'this sequence size') +
                    ', so the closest available one was used' };
        }
    }
    if (fallback) {
        return { item: fallback, reason: 'existing layer reused', mismatch: true,
            warning: 'its frame size could not be confirmed against this sequence' };
    }
    return { item: null, importProblem: imported.reason, missingTemplate: imported.missingTemplate === true };
};

prfx.findAdjustmentLayerItem = function (sequence) {
    var tracks, count, t, clips, clipCount, i, clip;
    tracks = sequence.videoTracks;
    count = tracks ? Number(tracks.numTracks || tracks.length || 0) : 0;
    for (t = 0; t < count; t++) {
        try { clips = tracks[t].clips; clipCount = Number(clips.numItems || clips.length || 0); }
        catch (trackError) { clipCount = 0; }
        for (i = 0; i < clipCount; i++) {
            try { clip = clips[i]; } catch (clipError) { continue; }
            try {
                if (clip && clip.isAdjustmentLayer && clip.isAdjustmentLayer() === true) return clip.projectItem;
            } catch (testError) {}
        }
    }
    return prfx.findAdjustmentLayerInBins(app.project.rootItem, 0);
};

// Bins carry no isAdjustmentLayer test, so this leans on the two things that are
// true of one: it is synthetic (no media file) and Premiere names it
// "Adjustment Layer". The name half will not survive a localized install.
prfx.findAdjustmentLayerInBins = function (bin, depth) {
    var children, count, i, child, found, path = '';
    if (depth > 8) return null;
    try { children = bin.children; count = Number(children.numItems || 0); } catch (error) { return null; }
    for (i = 0; i < count; i++) {
        try { child = children[i]; } catch (childError) { continue; }
        if (!child) continue;
        if (prfx.projectItemIsBin(child)) {
            found = prfx.findAdjustmentLayerInBins(child, depth + 1);
            if (found) return found;
            continue;
        }
        try { path = String(child.getMediaPath ? child.getMediaPath() : ''); } catch (pathError) { path = ''; }
        if (path.length) continue;
        if (prfx.normalizedPitchName(child.name).indexOf('adjustmentlayer') !== -1) return child;
    }
    return null;
};

// Sets a synthetic item's range so the staged clip comes out exactly as long as
// the span it has to cover. Verified by reading back, like every other write.
prfx.setProjectItemRange = function (item, outSeconds) {
    var i, after;
    for (i = 0; i < prfx.PROJECT_ITEM_MEDIA_TYPES.length; i++) {
        try {
            item.setInPoint(0, prfx.PROJECT_ITEM_MEDIA_TYPES[i]);
            item.setOutPoint(outSeconds, prfx.PROJECT_ITEM_MEDIA_TYPES[i]);
        } catch (writeError) { continue; }
        after = prfx.projectItemRange(item);
        if (after && Math.abs((after.outSeconds - after.inSeconds) - outSeconds) < 0.5) return true;
    }
    return false;
};

prfx.addAdjustmentLayerOverSelection = function (publicSequence, qeSequence) {
    var snapshot = prfx.moveSelectionSnapshot(publicSequence, qeSequence, false), selected;
    var i, detail, spanStart = NaN, spanEnd = NaN, topTrack = -1, item, savedRange;
    var checkpoint, staging, live, target, snapshotLive, failure = null, created = [], staged, addError, resolved;

    selected = snapshot.selected;
    if (!selected.length) {
        if (snapshot.staleSelectionCount) return 'ERROR: Premiere\'s Timeline selection is stale. Click an empty Timeline area, reselect the clips, and try again.';
        return 'ERROR: Select the Timeline clips the adjustment layer should cover.';
    }
    for (i = 0; i < selected.length; i++) {
        detail = selected[i];
        if (detail.kind !== 'video') continue;
        if (isNaN(spanStart) || detail.start < spanStart) spanStart = detail.start;
        if (isNaN(spanEnd) || detail.end > spanEnd) spanEnd = detail.end;
        if (detail.sourceTrackIndex > topTrack) topTrack = detail.sourceTrackIndex;
    }
    if (isNaN(spanStart) || !(spanEnd > spanStart)) {
        return 'ERROR: Select video clips — an adjustment layer needs a video span to cover.';
    }

    resolved = prfx.resolveAdjustmentLayer(publicSequence);
    if (!resolved || !resolved.item) {
        if (resolved && resolved.missingTemplate) {
            return 'ERROR: This project has no adjustment layer that fits the sequence, and the PR FX template is not installed. ' +
                'Either make one Adjustment Layer in the Project panel, or add assets/adjustment-layers.prproj (see assets/README.md).';
        }
        return 'ERROR: No adjustment layer fits this sequence and one could not be obtained' +
            (resolved && resolved.importProblem ? ' - ' + resolved.importProblem : '') +
            '. Premiere gives scripts no way to create one, so make a single Adjustment Layer in the Project panel; PR FX will reuse it and match it to the right sequence from then on.';
    }
    item = resolved.item;

    checkpoint = prfx.undoCheckpoint();

    // Find a lane above the selection with room, adding one if every existing
    // track is occupied across the span. Done before staging so track indices
    // do not shift underneath it.
    target = null;
    live = app.project.activeSequence;
    snapshotLive = prfx.moveSelectionSnapshot(live, qeSequence, false);
    for (i = topTrack + 1; i < snapshotLive.tracks.video.length; i++) {
        if (prfx.trackHasRoom(snapshotLive, 'video', i, spanStart, spanEnd, null)) { target = i; break; }
    }
    if (target === null) {
        addError = prfx.addMoveDestinationTrack(qeSequence, 'video', 0, 0);
        if (addError) {
            prfx.revertToUndoCheckpoint(checkpoint, 12);
            return 'ERROR: ' + addError + ' Nothing was added.';
        }
        live = app.project.activeSequence;
        target = Number(live.videoTracks.numTracks) - 1;
        try { qeSequence = qe.project.getActiveSequence(); } catch (rebindError) {}
    }

    savedRange = prfx.projectItemRange(item);
    staging = prfx.createStagingTracks(app.project.activeSequence, qeSequence);
    if (!staging.ok) {
        prfx.revertToUndoCheckpoint(checkpoint, 16);
        return 'ERROR: Could not prepare a safe staging track - ' + staging.message + '. Nothing was added.';
    }

    try {
        if (!prfx.setProjectItemRange(item, spanEnd - spanStart)) {
            throw new Error('the adjustment layer\'s duration could not be set to ' + (spanEnd - spanStart).toFixed(2) + 's');
        }
        staged = prfx.stageOneProjectItem(staging.tracks, item, spanStart, true);
        if (Math.abs((staged.end - staged.start) - (spanEnd - spanStart)) > 0.5) {
            throw new Error('the staged adjustment layer is ' + (staged.end - staged.start).toFixed(2) +
                's, not the ' + (spanEnd - spanStart).toFixed(2) + 's the selection spans');
        }
        prfx.moveStagedClipToTrack('video', staged.fromTrackIndex, target, staged.start, staged.end, 'the adjustment layer');
        created.push({ kind: 'video', trackIndex: target, start: staged.start, end: staged.end });
    } catch (error) {
        failure = error.toString();
    }

    prfx.removeStagingTracks(qeSequence, staging.tracks);
    // The bin item is shared; a changed range would follow it into every later use.
    prfx.restoreProjectItemRange(item, { saved: savedRange, expanded: true });

    if (failure) {
        prfx.revertUnlessKeeping(checkpoint, 24);
        return 'ERROR: Adjustment layer not added and ' + prfx.failureOutcomeText() + ' - ' + failure + '.';
    }

    prfx.selectClipRanges(app.project.activeSequence, created);
    return 'Added an adjustment layer on V' + (target + 1) + ' covering ' +
        (spanEnd - spanStart).toFixed(2) + 's of the selection (' + resolved.reason + ').' +
        (resolved.warning ? ' Note: ' + resolved.warning + '.' : '');
};

// ---------------------------------------------------------------------------
// Select everything starting before the playhead
//
// "Behind the playhead" means the clip's In point is earlier than the playhead,
// regardless of where it ends. A clip starting exactly ON the playhead is not
// behind it and is left out.
//
// Caption tracks are not part of the public sequence reflection -- only
// createCaptionTrack is exposed -- so several accessors are attempted and the
// result reports whether captions were actually reachable rather than implying
// they were covered.
// ---------------------------------------------------------------------------
prfx.captionTrackList = function (sequence, qeSequence) {
    var out = [], collection, count, i, track;
    try {
        collection = sequence.captionTracks;
        count = collection ? Number(collection.numTracks || collection.length || 0) : 0;
        for (i = 0; i < count; i++) {
            try { track = collection[i]; } catch (indexError) { track = null; }
            if (track) out.push(track);
        }
        if (out.length) return out;
    } catch (publicError) {}
    try {
        count = qeSequence ? Number(qeSequence.numCaptionTracks || 0) : 0;
        for (i = 0; i < count; i++) {
            try { track = qeSequence.getCaptionTrackAt(i); } catch (qeIndexError) { track = null; }
            if (track) out.push(track);
        }
    } catch (qeError) {}
    return out;
};

prfx.selectClipsBeforePlayhead = function (publicSequence, qeSequence) {
    var playhead, playheadSeconds, kinds = ['video', 'audio'], k, tracks, trackCount, t, track;
    var clips, clipCount, i, clip, matched = 0, lockedSkipped = 0, captionMatched = 0;
    var captionTracks, captionReachable, selectedClips = [], start;

    try { playhead = publicSequence.getPlayerPosition(); } catch (playheadError) { playhead = null; }
    playheadSeconds = prfx.timeInSeconds(playhead);
    if (!(playheadSeconds >= 0)) return 'ERROR: Premiere could not read the playhead position.';

    // Clear the whole sequence first: Premiere keeps stale selections on clips
    // that a previous operation moved, and those would survive into the result.
    for (k = 0; k < kinds.length; k++) {
        tracks = kinds[k] === 'audio' ? publicSequence.audioTracks : publicSequence.videoTracks;
        trackCount = tracks ? Number(tracks.numTracks || tracks.length || 0) : 0;
        for (t = 0; t < trackCount; t++) {
            try { clips = tracks[t].clips; clipCount = Number(clips.numItems || clips.length || 0); }
            catch (trackError) { clipCount = 0; }
            for (i = 0; i < clipCount; i++) {
                try { clip = clips[i]; if (clip && clip.setSelected) clip.setSelected(false, false); } catch (clearError) {}
            }
        }
    }

    for (k = 0; k < kinds.length; k++) {
        tracks = kinds[k] === 'audio' ? publicSequence.audioTracks : publicSequence.videoTracks;
        trackCount = tracks ? Number(tracks.numTracks || tracks.length || 0) : 0;
        for (t = 0; t < trackCount; t++) {
            try { track = tracks[t]; } catch (trackReadError) { track = null; }
            if (!track) continue;
            // A locked track refuses selection; counting it is more honest than
            // silently returning fewer clips than the editor can see.
            if (prfx.moveTrackLocked(track)) { lockedSkipped++; continue; }
            try { clips = track.clips; clipCount = Number(clips.numItems || clips.length || 0); }
            catch (clipsError) { clipCount = 0; }
            for (i = 0; i < clipCount; i++) {
                try { clip = clips[i]; } catch (clipError) { continue; }
                if (!clip) continue;
                start = prfx.timeInSeconds(clip.start);
                if (!(start < playheadSeconds - 0.000001)) continue;
                try { clip.setSelected(true, false); matched++; selectedClips.push(clip); } catch (selectError) {}
            }
        }
    }

    captionTracks = prfx.captionTrackList(publicSequence, qeSequence);
    captionReachable = captionTracks.length > 0;
    for (t = 0; t < captionTracks.length; t++) {
        try { clips = captionTracks[t].clips; clipCount = Number(clips.numItems || clips.length || 0); }
        catch (captionClipsError) { clipCount = 0; }
        for (i = 0; i < clipCount; i++) {
            try { clip = clips[i]; } catch (captionClipError) { continue; }
            if (!clip) continue;
            start = prfx.timeInSeconds(clip.start);
            if (!(start < playheadSeconds - 0.000001)) continue;
            try { clip.setSelected(true, false); captionMatched++; } catch (captionSelectError) {}
        }
    }

    if (!matched && !captionMatched) {
        return 'Nothing starts before the playhead' + (lockedSkipped ? ' on an unlocked track' : '') + '.';
    }
    return 'Selected ' + matched + ' clip' + (matched === 1 ? '' : 's') + ' starting before the playhead' +
        (captionMatched ? ', plus ' + captionMatched + ' caption' + (captionMatched === 1 ? '' : 's') : '') +
        (captionReachable ? '' : ' (caption tracks are not reachable from scripting on this Premiere version, so none were included)') +
        (lockedSkipped ? '. Skipped ' + lockedSkipped + ' locked track' + (lockedSkipped === 1 ? '' : 's') : '') + '.';
};
