if (typeof JSON === "undefined") {
  JSON = {};
}

if (!JSON.stringify) {
  JSON.stringify = function (value) {
    function quote(text) {
      return '"' + String(text).replace(/\\/g, "\\\\").replace(new RegExp('"', "g"), '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
    }

    function encode(input) {
      var type = typeof input;
      if (input === null) {
        return "null";
      }
      if (type === "number" || type === "boolean") {
        return String(input);
      }
      if (type === "string") {
        return quote(input);
      }
      if (type === "undefined" || type === "function") {
        return undefined;
      }
      if (input && typeof input === "object" && input.length !== undefined) {
        var arrayParts = [];
        for (var i = 0; i < input.length; i++) {
          var arrayValue = encode(input[i]);
          arrayParts.push(arrayValue === undefined ? "null" : arrayValue);
        }
        return "[" + arrayParts.join(",") + "]";
      }
      var objectParts = [];
      for (var key in input) {
        if (input.hasOwnProperty(key)) {
          var objectValue = encode(input[key]);
          if (objectValue !== undefined) {
            objectParts.push(quote(key) + ":" + objectValue);
          }
        }
      }
      return "{" + objectParts.join(",") + "}";
    }

    return encode(value);
  };
}

if (!JSON.parse) {
  JSON.parse = function (text) {
    return eval("(" + String(text || "null") + ")");
  };
}

function prAI_result(ok, data, error) {
  return JSON.stringify({
    ok: ok,
    data: data || null,
    error: error || null
  });
}

var prAI_lastSequenceId = "";
var prAI_currentTargetSequenceId = "";
var prAI_hostVersion = "20261120-agent-menu1";

function prAI_ping() {
  try {
    return prAI_result(true, {
      hostVersion: prAI_hostVersion,
      hasApp: typeof app !== "undefined",
      hasProject: typeof app !== "undefined" && !!app.project
    }, null);
  } catch (err) {
    return prAI_result(false, null, err.toString());
  }
}

function prAI_projectItemPath(item) {
  var names = [];
  var cursor = item;
  while (cursor) {
    try {
      if (cursor.name) {
        names.unshift(cursor.name);
      }
      cursor = cursor.parent;
    } catch (err) {
      break;
    }
  }
  return names.join("/");
}

function prAI_projectItemMediaPath(item) {
  try {
    if (item.getMediaPath) {
      return item.getMediaPath() || "";
    }
  } catch (err) {
  }
  return "";
}

function prAI_pushProjectItemSnapshot(out, item) {
  if (!item) {
    return;
  }
  var nodeId = "";
  var name = "";
  try {
    nodeId = item.nodeId || "";
    name = item.name || "";
  } catch (err) {
  }
  for (var i = 0; i < out.length; i++) {
    if ((nodeId && out[i].nodeId === nodeId) || (!nodeId && name && out[i].name === name)) {
      return;
    }
  }
  var itemType = "";
  try {
    itemType = item.type;
  } catch (typeErr) {
  }
  out.push({
    name: name,
    nodeId: nodeId,
    type: itemType,
    path: prAI_projectItemPath(item),
    mediaPath: prAI_projectItemMediaPath(item),
    mediaStartSeconds: prAI_projectItemMediaStartSeconds(item),
    transcriptAvailable: false,
    thumbnailsAvailable: false
  });
}

function prAI_collectionCount(collection) {
  if (!collection) {
    return 0;
  }
  try {
    if (collection.numItems !== undefined) {
      return Number(collection.numItems) || 0;
    }
  } catch (err) {
  }
  try {
    if (collection.numSequences !== undefined) {
      return Number(collection.numSequences) || 0;
    }
  } catch (seqErr) {
  }
  try {
    if (collection.numTracks !== undefined) {
      return Number(collection.numTracks) || 0;
    }
  } catch (trackErr) {
  }
  try {
    if (collection.length !== undefined) {
      return Number(collection.length) || 0;
    }
  } catch (lengthErr) {
  }
  return 0;
}

function prAI_collectionItem(collection, index) {
  if (!collection) {
    return null;
  }
  try {
    if (collection[index]) {
      return collection[index];
    }
  } catch (indexErr) {
  }
  try {
    if (collection.getItemAt) {
      return collection.getItemAt(index);
    }
  } catch (getItemErr) {
  }
  return null;
}

function prAI_projectItemChildren(item) {
  try {
    return item && item.children ? item.children : null;
  } catch (err) {
  }
  return null;
}

function prAI_walkProjectItems(root, out, limit) {
  var hasLimit = limit !== undefined && limit !== null && Number(limit) > 0;
  if (!root || (hasLimit && out.length >= limit)) {
    return;
  }

  var children = prAI_projectItemChildren(root);
  var childCount = prAI_collectionCount(children);
  for (var i = 0; i < childCount && (!hasLimit || out.length < limit); i++) {
    var item = prAI_collectionItem(children, i);
    if (!item) {
      continue;
    }
    prAI_pushProjectItemSnapshot(out, item);
    if (prAI_collectionCount(prAI_projectItemChildren(item))) {
      prAI_walkProjectItems(item, out, limit);
    }
  }
}

function prAI_ticksToSeconds(ticks) {
  var ticksPerSecond = 254016000000;
  return Number(ticks) / ticksPerSecond;
}

function prAI_readTimeSeconds(owner, propertyName) {
  try {
    if (owner[propertyName] && owner[propertyName].ticks !== undefined) {
      return prAI_ticksToSeconds(owner[propertyName].ticks);
    }
  } catch (err) {
  }
  return null;
}

function prAI_secondsToTicks(seconds) {
  var ticksPerSecond = 254016000000;
  return String(Math.round(Number(seconds) * ticksPerSecond));
}

function prAI_timeFromSeconds(seconds) {
  var time = new Time();
  time.seconds = Number(seconds);
  return time;
}

function prAI_timeValueSeconds(value) {
  try {
    if (value && value.ticks !== undefined) {
      return prAI_ticksToSeconds(value.ticks);
    }
    if (value && value.seconds !== undefined) {
      return Number(value.seconds);
    }
  } catch (err) {
  }
  var number = Number(value);
  return isNaN(number) ? null : number;
}

function prAI_hexToColorInt(hex) {
  var clean = String(hex || "#ffffff").replace(/[^0-9a-fA-F]/g, "");
  if (clean.length !== 6) {
    clean = "ffffff";
  }
  return parseInt(clean, 16);
}

function prAI_colorIntToHex(value) {
  var number = Number(value);
  var hex = ("000000" + (number & 0xFFFFFF).toString(16)).slice(-6);
  return "#" + hex.toUpperCase();
}

function prAI_pickColor(payloadText) {
  try {
    if (typeof $ === "undefined" || !$.colorPicker) {
      return prAI_result(false, null, "Native Adobe color picker is not available in this host.");
    }
    var payload = payloadText ? JSON.parse(payloadText) : {};
    var picked = $.colorPicker(prAI_hexToColorInt(payload.color));
    if (picked < 0) {
      return prAI_result(true, { cancelled: true }, null);
    }
    return prAI_result(true, { hex: prAI_colorIntToHex(picked) }, null);
  } catch (err) {
    return prAI_result(false, null, err.toString());
  }
}

function prAI_pad2(value) {
  value = Number(value);
  return value < 10 ? "0" + value : String(value);
}

function prAI_secondsToSrtTime(seconds) {
  var totalMs = Math.max(0, Math.round(Number(seconds) * 1000));
  var ms = totalMs % 1000;
  var totalSeconds = Math.floor(totalMs / 1000);
  var s = totalSeconds % 60;
  var totalMinutes = Math.floor(totalSeconds / 60);
  var m = totalMinutes % 60;
  var h = Math.floor(totalMinutes / 60);
  var msText = ms < 10 ? "00" + ms : (ms < 100 ? "0" + ms : String(ms));
  return prAI_pad2(h) + ":" + prAI_pad2(m) + ":" + prAI_pad2(s) + "," + msText;
}

function prAI_escapeSrtText(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function prAI_safeFileName(name) {
  return String(name || "PR AI Subtitles").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function prAI_defaultTempFolderPath() {
  return Folder.temp.fsName + "/PR_AI_Text";
}

function prAI_tempFolder(action) {
  var folderPath = action && action.tempFolder ? String(action.tempFolder) : prAI_defaultTempFolderPath();
  var folder = new Folder(folderPath);
  if (!folder.exists && !folder.create()) {
    throw new Error("Could not create PR AI text folder: " + folderPath);
  }
  return folder;
}

function prAI_filePathDiagnostics(filePath, action) {
  var file = new File(filePath || "");
  var parent = null;
  try {
    parent = file.parent ? new Folder(file.parent.fsName) : null;
  } catch (err) {
    parent = null;
  }
  return {
    inputPath: String(filePath || ""),
    resolvedPath: file.fsName || String(filePath || ""),
    exists: file.exists === true,
    parentPath: parent ? parent.fsName : "",
    parentExists: parent ? parent.exists === true : false,
    configuredTempFolder: action && action.tempFolder ? String(action.tempFolder) : "",
    defaultTempFolder: prAI_defaultTempFolderPath()
  };
}

function prAI_fileDiagnosticError(prefix, filePath, action) {
  var details = prAI_filePathDiagnostics(filePath, action);
  return prefix + " " + details.resolvedPath + " | details: " + JSON.stringify(details);
}

function prAI_checkFilePath(action) {
  if (!action.filePath) {
    throw new Error("checkFilePath needs filePath.");
  }
  return {
    type: "checkFilePath",
    details: prAI_filePathDiagnostics(action.filePath, action)
  };
}

function prAI_selectCsvFile() {
  try {
    var selected = File.openDialog("Choose a script CSV file", "CSV files:*.csv;All files:*.*");
    if (!selected) {
      return prAI_result(true, { filePath: "" });
    }
    return prAI_result(true, { filePath: selected.fsName });
  } catch (err) {
    return prAI_result(false, null, err.toString());
  }
}

function prAI_selectTextFolder() {
  try {
    var selected = Folder.selectDialog("Choose PR AI text file folder");
    if (!selected) {
      return prAI_result(true, { folderPath: "" });
    }
    if (!selected.exists && !selected.create()) {
      return prAI_result(false, null, "Could not create selected folder.");
    }
    var probe = new File(selected.fsName + "/.pr_ai_write_test");
    if (!probe.open("w")) {
      return prAI_result(false, null, "Selected folder is not writable.");
    }
    probe.write("ok");
    probe.close();
    probe.remove();
    return prAI_result(true, { folderPath: selected.fsName });
  } catch (err) {
    return prAI_result(false, null, err.toString());
  }
}

function prAI_sanitizeExtension(extension) {
  var ext = String(extension || "txt").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (ext !== "txt" && ext !== "srt" && ext !== "csv" && ext !== "json" && ext !== "xml") {
    throw new Error("Unsupported temp text extension: " + ext);
  }
  return ext;
}

function prAI_isTempPath(filePath, action) {
  var tempRoot = prAI_tempFolder(action).fsName;
  var defaultRoot = prAI_tempFolder(null).fsName;
  var file = new File(filePath);
  var fsName = String(file.fsName);
  return fsName === tempRoot || fsName.indexOf(tempRoot + "/") === 0 || fsName === defaultRoot || fsName.indexOf(defaultRoot + "/") === 0;
}

function prAI_writeTempTextFile(action) {
  var ext = prAI_sanitizeExtension(action.extension || action.fileExtension || "txt");
  var name = prAI_safeFileName(action.suggestedName || action.name || ("PR_AI_Text_" + (new Date()).getTime()));
  if (name.toLowerCase().lastIndexOf("." + ext) !== name.length - ext.length - 1) {
    name += "." + ext;
  }
  var file = new File(prAI_tempFolder(action).fsName + "/" + name);
  file.encoding = "UTF-8";
  if (ext === "srt") {
    file.lineFeed = "Windows";
  }
  if (!file.open("w")) {
    throw new Error("Could not create temp text file.");
  }
  file.write(String(action.contents || action.text || ""));
  file.close();
  return {
    type: "writeTempTextFile",
    filePath: file.fsName,
    extension: ext,
    bytes: String(action.contents || action.text || "").length
  };
}

function prAI_parentFolderPath(filePath) {
  var path = String(filePath || "");
  var index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.substr(0, index) : "";
}

function prAI_xmlOutputFolder(action) {
  if (action && action.outputFolder) {
    var explicitFolder = new Folder(String(action.outputFolder));
    if (!explicitFolder.exists && !explicitFolder.create()) {
      throw new Error("Could not create XML output folder: " + explicitFolder.fsName);
    }
    return explicitFolder;
  }
  if (action && action.tempFolder) {
    return prAI_tempFolder(action);
  }
  var projectPath = app.project && app.project.path ? String(app.project.path) : "";
  var parentPath = prAI_parentFolderPath(projectPath);
  if (!parentPath) {
    return prAI_tempFolder(null);
  }
  var folder = new Folder(parentPath + "/XML");
  if (!folder.exists && !folder.create()) {
    throw new Error("Could not create project XML folder: " + folder.fsName);
  }
  return folder;
}

function prAI_timestampName(date) {
  date = date || new Date();
  function pad(value) {
    value = Number(value);
    return value < 10 ? "0" + value : String(value);
  }
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "-" + pad(date.getHours()) + "-" + pad(date.getMinutes());
}

function prAI_xmlFunctionName(action) {
  var raw = prAI_safeFileName(action && action.functionName ? action.functionName : (action && action.workflowFunction ? action.workflowFunction : "Text"));
  var functionName = String(raw || "Text").toLowerCase();
  if (functionName.indexOf("both") !== -1 || (functionName.indexOf("text") !== -1 && functionName.indexOf("cut") !== -1)) {
    return "Both";
  }
  if (functionName.indexOf("cut") !== -1) {
    return "Cut";
  }
  if (functionName.indexOf("text") !== -1) {
    return "Text";
  }
  if (functionName === "both") {
    return "Both";
  }
  if (functionName === "cut") {
    return "Cut";
  }
  return "Text";
}

function prAI_autoEditXmlFileName(action) {
  var functionName = prAI_xmlFunctionName(action);
  if (!functionName) {
    functionName = "Text";
  }
  return prAI_timestampName(new Date()) + " - AutoEdit - " + functionName + ".xml";
}

function prAI_autoEditSrtFileName(action) {
  var date = new Date();
  var functionName = prAI_safeFileName(action && action.functionName ? action.functionName : (action && action.workflowFunction ? action.workflowFunction : "Subtitle"));
  if (!functionName || String(functionName).toLowerCase() === "text") {
    functionName = "Subtitle";
  }
  function pad(value) {
    value = Number(value);
    return value < 10 ? "0" + value : String(value);
  }
  return prAI_timestampName(date) + "-" + pad(date.getSeconds()) + " - AutoEdit - " + functionName + ".srt";
}

function prAI_openXmlFile(file) {
  try {
    if (app.openDocument && app.openDocument(file.fsName)) {
      return { ok: true, method: "app.openDocument" };
    }
  } catch (err) {
  }
  try {
    if (file.execute()) {
      return { ok: true, method: "file.execute" };
    }
  } catch (execErr) {
    return { ok: false, error: execErr.toString() };
  }
  return { ok: false, error: "Could not open XML file." };
}

function prAI_openFolder(folder) {
  try {
    return folder.execute();
  } catch (err) {
    return false;
  }
}

function prAI_xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(new RegExp("<", "g"), "&lt;")
    .replace(/>/g, "&gt;")
    .replace(new RegExp('"', "g"), "&quot;");
}

function prAI_base64Decode(input) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var clean = String(input || "").replace(/[^A-Za-z0-9+\/=]/g, "");
  var out = "";
  for (var i = 0; i < clean.length; i += 4) {
    var e1 = chars.indexOf(clean.charAt(i));
    var e2 = chars.indexOf(clean.charAt(i + 1));
    var e3 = chars.indexOf(clean.charAt(i + 2));
    var e4 = chars.indexOf(clean.charAt(i + 3));
    var c1 = (e1 << 2) | (e2 >> 4);
    var c2 = ((e2 & 15) << 4) | (e3 >> 2);
    var c3 = ((e3 & 3) << 6) | e4;
    out += String.fromCharCode(c1 & 255);
    if (clean.charAt(i + 2) !== "=") {
      out += String.fromCharCode(c2 & 255);
    }
    if (clean.charAt(i + 3) !== "=") {
      out += String.fromCharCode(c3 & 255);
    }
  }
  return out;
}

function prAI_base64Encode(input) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = "";
  var str = String(input || "");
  for (var i = 0; i < str.length; i += 3) {
    var c1 = str.charCodeAt(i) & 255;
    var c2 = i + 1 < str.length ? str.charCodeAt(i + 1) & 255 : NaN;
    var c3 = i + 2 < str.length ? str.charCodeAt(i + 2) & 255 : NaN;
    out += chars.charAt(c1 >> 2);
    out += chars.charAt(((c1 & 3) << 4) | (isNaN(c2) ? 0 : (c2 >> 4)));
    out += isNaN(c2) ? "=" : chars.charAt(((c2 & 15) << 2) | (isNaN(c3) ? 0 : (c3 >> 6)));
    out += isNaN(c3) ? "=" : chars.charAt(c3 & 63);
  }
  return out;
}

function prAI_replaceSameLengthAscii(binary, from, to) {
  from = String(from);
  to = String(to);
  if (from.length !== to.length) {
    throw new Error("Styled XML text replacement must be the same byte length for now: '" + from + "' -> '" + to + "'.");
  }
  var index = binary.indexOf(from);
  if (index === -1) {
    throw new Error("Styled XML source text string not found: " + from);
  }
  return binary.substr(0, index) + to + binary.substr(index + from.length);
}

function prAI_normalizeReplacementPairs(replacements) {
  var pairs = [];
  if (!replacements) {
    return pairs;
  }
  if (Object.prototype.toString.call(replacements) === "[object Array]") {
    for (var i = 0; i < replacements.length; i++) {
      if (replacements[i] && replacements[i].from !== undefined && replacements[i].to !== undefined) {
        pairs.push({ from: String(replacements[i].from), to: String(replacements[i].to) });
      }
    }
    return pairs;
  }
  for (var key in replacements) {
    if (replacements.hasOwnProperty(key)) {
      pairs.push({ from: String(key), to: String(replacements[key]) });
    }
  }
  return pairs;
}

function prAI_styledTextTemplateId(action) {
  return String((action && action.templateId) || "text-xml-two-style-graphic");
}

function prAI_styledTextBlobBase64(templateId) {
  if (String(templateId || "") === "text-xml-five-run-switching") {
    return "nAQAAAAAAABEMyIRDAAAAAAABgAKAAQABgAAAGQAAAAAAF4AQAAQAAwAPAA4ADQAMAAAAAAAAAAAACwAKwAkAAAAIAAcABgAAAAAAAAAAAAAAAAAAAAAAAAAFgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAABcABwBeAAAAAAAAATgAAABIAAAAaAAAAAAAAQAAAEBBAADAQAAAQEAAAMhCAAAAASAAAAABAAAAAgAAAACAAkQAAKZELPz//zD8//80/P//Svz//wAAAAABAAAABAAAABQAAABLaXRSb3VuZGVkLUV4dHJhQm9sZAAAAAAFAAAAaAIAANwBAAAQAQAAuAAAAAQAAAAE////oAAAAAQAAACq/f//AgAAABwAAAAcAAAAAQAAAAAAQEAAAAABcAAAAAAAqkKs/P//bv3//wgAAAAkAAAAAgAAABQAAAAEAAAA+v7//wAAgD8AAAA/Vv3//wAAAD8CAAAAIAAAAAQAAABK/f//DAAAAAAAgD8AAAA/Cv3//wD3wInu/v//CAAAAAAAAD8e/f//APDbeSb9//8AGBgYHP3//wUAAAAgZ2l2ZQAAALT///88AAAABAAAAOL+//8CAAAAGAAAABgAAAAAAIBAAAAAARAAAAAAAKpCWP3//1z9//9y/f//ABgYGGj9//8EAAAAZm91cgAAAAAIAAwABAAIAAgAAAC4AAAABAAAAK7+//8CAAAAHAAAABwAAAABAAAAAABAQAAAAAGIAAAAAACqQrD9//9y/v//CAAAADAAAAACAAAAIAAAABAAAAAAAAoADAAAAAQACAAKAAAAAACAPwAAAD9m/v//AAAAPwIAAAAsAAAABAAAAFr+//8MAAAAAACAPwAAAD8u/v//AAAA98CJCgAMAAQAAAAIAAoAAAAIAAAAAAAAPzr+//8A8Nt5Qv7//wAYGBg4/v//BwAAACB0aHJlZSAAgP///3QAAAA8AAAAAAA2ACAAAAAcAAAAAAAYABcAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAgABAA2AAAAAgAAABgAAAAYAAAAAACAQAAAAAEQAAAAAACqQqz+//+w/v//xv7//wAYGBi8/v//AwAAAHR3bwAIAA4ABAAIAAgAAAA0AQAAPAAAAAAANgAkAAAAIAAAAAAAHAAbABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAwAAAAIAAQANgAAAAIAAAAgAAAALAAAAAEAAAAAAEBAAAAAAcgAAAAAAKpCBAAGAAQAAAAAAAoADAAAAAgABAAKAAAACAAAADwAAAACAAAALAAAABAAAAAAAAoADgAAAAQACAAKAAAAAACAPwAAAD8AAAoACAAAAAAABAAKAAAAAAAAPwIAAAA4AAAAEAAAAAAACgAQAAQACAAMAAoAAAAMAAAAAACAPwAAAD/e////AAAA98CJCgAOAAQAAAAIAAoAAAAUAAAAAAAAPwAACgAKAAcACAAJAAoAAAAAAADw23kKAAgABQAGAAcACgAAAAAYGBgEAAQABAAAAAQAAABvbmUgAAAAAA==";
  }
  return "LAMAAAAAAABEMyIRDAAAAAAABgAKAAQABgAAAGQAAAAAAF4AQAAQAAwAPAA4ADQAMAAAAAAAAAAAACwAKwAkAAAAIAAcABgAAAAAAAAAAAAAAAAAAAAAAAAAFgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAABcABwBeAAAAAAAAATgAAABIAAAAaAAAAAAAAQAAAEBBAADAQAAAQEAAAMhCAAAAASAAAAABAAAAAgAAAAAAgEQAQMVEpP3//6j9//+s/f//wv3//wAAAAABAAAABAAAABQAAABLaXRSb3VuZGVkLUV4dHJhQm9sZAAAAAADAAAA8AAAAFwAAAAMAAAACAAMAAQACAAIAAAAPAAAAAQAAACy////AgAAABgAAAAYAAAAAACAQAAAAAEQAAAAq6o6QyD+//8k/v//Ov7//wAYGBgw/v//BwAAAGluIDIwMjYAeP///3QAAAA8AAAAAAA2ACAAAAAcAAAAAAAYABcAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAgABAA2AAAAAgAAABgAAAAYAAAAAACAQAAAAAEQAAAABPIoQ6T+//+o/v//vv7//wAYGBi0/v//CAAAACANcGFudHMgAAAAAAgADgAEAAgACAAAADQBAAA8AAAAAAA2ACQAAAAgAAAAAAAcABsAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAADAAAAAgABAA2AAAAAgAAACAAAAAsAAAAAQAAAAAAQEAAAAAByAAAAKuqOkMEAAYABAAAAAAACgAMAAAACAAEAAoAAAAIAAAAPAAAAAIAAAAsAAAAEAAAAAAACgAOAAAABAAIAAoAAAAAAIA/AAAAPwAACgAIAAAAAAAEAAoAAAAAAAA/AgAAADgAAAAQAAAAAAAKABAABAAIAAwACgAAAAwAAAAAAIA/AAAAP97///8AAAD3wIkKAA4ABAAAAAgACgAAABQAAAAAAAA/AAAKAAoABwAIAAkACgAAAAAAAPDbeQoACAAFAAYABwAKAAAAABgYGAQABAAEAAAADAAAAEJlc3QgU2VsbGluZwAAAAA=";
}

function prAI_styledTextHash(templateId) {
  if (String(templateId || "") === "text-xml-five-run-switching") {
    return "4f8b4462-8e2c-5ffa-2d42-08da000004b4";
  }
  return "07d69853-5a75-cc49-a07e-022000000344";
}

function prAI_styledTextSourceBase64(replacements, templateId) {
  var blob = prAI_base64Decode(prAI_styledTextBlobBase64(templateId));
  var pairs = prAI_normalizeReplacementPairs(replacements);
  for (var i = 0; i < pairs.length; i++) {
    blob = prAI_replaceSameLengthAscii(blob, pairs[i].from, pairs[i].to);
  }
  return { sourceText: prAI_base64Encode(blob), replacements: pairs };
}

function prAI_normalizeStyledTextFrames(action) {
  var raw = action.frames || action.textFrames || action.clips || action.items;
  var frames = [];
  if (raw && Object.prototype.toString.call(raw) === "[object Array]" && raw.length) {
    for (var i = 0; i < raw.length; i++) {
      if (raw[i]) {
        frames.push(raw[i]);
      }
    }
  }
  if (!frames.length) {
    frames.push(action);
  }
  return frames;
}

function prAI_frameStart(frame, action, index, previousEnd, timebase, defaultDuration) {
  if (frame.startFrame !== undefined) {
    return Number(frame.startFrame);
  }
  if (frame.startSeconds !== undefined) {
    return Math.round(Number(frame.startSeconds) * timebase);
  }
  if (frame.seconds !== undefined) {
    return Math.round(Number(frame.seconds) * timebase);
  }
  if (frame.offsetFrames !== undefined) {
    return Number(frame.offsetFrames);
  }
  if (action.stackFrames === true || action.stack === true || action.layered === true) {
    return Number(action.startFrame || 0);
  }
  if (index === 0) {
    return Number(action.startFrame || 0);
  }
  return previousEnd;
}

function prAI_styledTextClipItemXml(index, frame, action, timebase, defaultDuration, previousEnd) {
  var templateId = prAI_styledTextTemplateId(frame.templateId ? frame : action);
  var start = prAI_frameStart(frame, action, index, previousEnd, timebase, defaultDuration);
  var duration = Number(frame.durationFrames || action.durationFrames || defaultDuration);
  var end = frame.endFrame !== undefined ? Number(frame.endFrame) : start + duration;
  var source = prAI_styledTextSourceBase64(frame.replacements || frame.textReplacements || frame.text || action.replacements || action.textReplacements || action.text, templateId);
  var effectName = prAI_xmlEscape(frame.effectName || frame.displayText || action.effectName || action.displayText || ("Styled Text Graphic " + (index + 1)));
  var name = prAI_xmlEscape(frame.clipName || action.clipName || "Graphic");
  var itemId = index + 1;
  var inFrame = Number(frame.inFrame || action.inFrame || 180246);
  var outFrame = inFrame + (end - start);
  var xml = [
    '          <clipitem id="clipitem-' + itemId + '">',
    '            <masterclipid>masterclip-' + itemId + '</masterclipid>',
    '            <name>' + name + '</name>',
    '            <enabled>TRUE</enabled>',
    '            <duration>2160000</duration>',
    '            <rate><timebase>' + timebase + '</timebase><ntsc>FALSE</ntsc></rate>',
    '            <start>' + start + '</start><end>' + end + '</end><in>' + inFrame + '</in><out>' + outFrame + '</out>',
    '            <alphatype>straight</alphatype><pixelaspectratio>square</pixelaspectratio><anamorphic>FALSE</anamorphic>',
    '            <file id="file-' + itemId + '"><name>Graphic</name><mediaSource>GraphicAndType</mediaSource><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><media><video><samplecharacteristics><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><width>1920</width><height>1080</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video></media></file>',
    '            <filter><effect><name>Vector Motion</name><effectid>GraphicGroup</effectid><effectcategory>graphic</effectcategory><effecttype>filter</effecttype><mediatype>video</mediatype><pproBypass>false</pproBypass>',
    '              <parameter authoringApp="PremierePro"><parameterid>1</parameterid><name>Position</name><value>-91445760000000000,0.5:0.21875,0,0,0,0,0,0,5,4,0,0,0,0</value></parameter>',
    '              <parameter authoringApp="PremierePro"><parameterid>2</parameterid><name>Scale</name><value>-91445760000000000,100.,0,0,0,0,0,0</value></parameter>',
    '              <parameter authoringApp="PremierePro"><parameterid>3</parameterid><name>Scale Width</name><value>-91445760000000000,100.,0,0,0,0,0,0</value></parameter>',
    '              <parameter authoringApp="PremierePro"><parameterid>4</parameterid><name> </name><value>-91445760000000000,true,0,0,0,0,0,0</value></parameter>',
    '              <parameter authoringApp="PremierePro"><parameterid>5</parameterid><name>Rotation</name><value>-91445760000000000,0.,0,0,0,0,0,0</value></parameter>',
    '              <parameter authoringApp="PremierePro"><parameterid>6</parameterid><name>Anchor Point</name><value>-91445760000000000,0.5:0.5,0,0,0,0,0,0,5,4,0,0,0,0</value></parameter>',
    '            </effect></filter>',
    '            <filter><effect><name>' + effectName + '</name><effectid>GraphicAndType</effectid><effectcategory>graphic</effectcategory><effecttype>filter</effecttype><mediatype>video</mediatype><pproBypass>false</pproBypass>',
    '              <parameter authoringApp="PremierePro"><parameterid>1</parameterid><name>Source Text</name><hash>' + prAI_styledTextHash(templateId) + '</hash><value>' + source.sourceText + '</value></parameter>',
    '              <parameter authoringApp="PremierePro"><parameterid>2</parameterid><name>Transform</name><value>-91445760000000000,false,0,0,0,0,0,0</value></parameter>',
    '              <parameter authoringApp="PremierePro"><parameterid>3</parameterid><name>Position</name><value>-91445760000000000,0.16100493979950745:0.30717598635841298,0,0,0,0,0,0,5,4,0,0,0,0</value></parameter>',
    '              <parameter authoringApp="PremierePro"><parameterid>4</parameterid><name>Scale</name><value>-91445760000000000,100.,0,0,0,0,0,0</value></parameter>',
    '              <parameter authoringApp="PremierePro"><parameterid>8</parameterid><name>Opacity</name><value>-91445760000000000,100.,0,0,0,0,0,0</value></parameter>',
    '              <parameter authoringApp="PremierePro"><parameterid>9</parameterid><name>Anchor Point</name><value>-91445760000000000,0.07194244762301405:0,0,0,0,0,0,0,5,4,0,0,0,0</value></parameter>',
    '            </effect></filter>',
    '          </clipitem>'
  ].join("\n");
  return { xml: xml, start: start, end: end, replacements: source.replacements };
}

function prAI_createStyledTextXml(action) {
  var frames = prAI_normalizeStyledTextFrames(action);
  var defaultDuration = Number(action.durationFrames || 114);
  var timebase = Number(action.timebase || 50);
  var fileName = prAI_autoEditXmlFileName(action);
  var defaultSequenceName = fileName.replace(/\.xml$/i, "");
  var sequenceName = prAI_xmlEscape(action.sequenceName || defaultSequenceName);
  var clipItems = [];
  var frameResults = [];
  var previousEnd = Number(action.startFrame || 0);
  var sequenceDuration = defaultDuration;
  for (var f = 0; f < frames.length; f++) {
    var clip = prAI_styledTextClipItemXml(f, frames[f], action, timebase, defaultDuration, previousEnd);
    clipItems.push(clip.xml);
    frameResults.push({ index: f, startFrame: clip.start, endFrame: clip.end, replacements: clip.replacements });
    previousEnd = clip.end;
    if (clip.end > sequenceDuration) {
      sequenceDuration = clip.end;
    }
  }
  var lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE xmeml>',
    '<xmeml version="4">',
    '  <sequence id="sequence-1">',
    '    <duration>' + sequenceDuration + '</duration>',
    '    <rate><timebase>' + timebase + '</timebase><ntsc>FALSE</ntsc></rate>',
    '    <name>' + sequenceName + '</name>',
    '    <media>',
    '      <video>',
    '        <format><samplecharacteristics><rate><timebase>' + timebase + '</timebase><ntsc>FALSE</ntsc></rate><width>1920</width><height>1080</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance><colordepth>24</colordepth></samplecharacteristics></format>',
    '        <track>',
    clipItems.join("\n"),
    '          <enabled>TRUE</enabled><locked>FALSE</locked>',
    '        </track>',
    '      </video>',
    '    </media>',
    '  </sequence>',
    '</xmeml>'
  ];
  var xml = lines.join("\n");
  var outputFolder = prAI_xmlOutputFolder(action);
  var file = new File(outputFolder.fsName + "/" + fileName);
  file.encoding = "UTF-8";
  if (!file.open("w")) {
    throw new Error("Could not create styled text XML file.");
  }
  file.write(xml);
  file.close();
  var afterCreateAction = String(action.afterCreateAction || (action.openAfterImport ? "open" : "import"));
  var importAfterCreate = action.importAfterCreate !== false && afterCreateAction !== "openFolder" && afterCreateAction !== "open";
  var importOk = null;
  var importError = "";
  var opened = false;
  var openError = "";
  var folderOpened = false;
  if (importAfterCreate) {
    try {
      importOk = app.project.importFiles([file.fsName], action.suppressUI === true, app.project.rootItem, false);
    } catch (importErr) {
      importError = importErr.toString();
      importOk = false;
    }
  }
  if (afterCreateAction === "openFolder") {
    folderOpened = prAI_openFolder(outputFolder);
  } else if (afterCreateAction === "open") {
    var openResult = prAI_openXmlFile(file);
    opened = openResult.ok === true;
    openError = openResult.error || "";
  }
  return {
    type: "createStyledTextXml",
    filePath: file.fsName,
    outputFolder: outputFolder.fsName,
    afterCreateAction: afterCreateAction,
    imported: importOk,
    importError: importError,
    opened: opened,
    openError: openError,
    folderOpened: folderOpened,
    openedInPremiere: importAfterCreate && importOk === true,
    templateId: action.templateId || "text-xml-two-style-graphic",
    fileName: fileName,
    functionName: prAI_xmlFunctionName(action),
    ignoredCustomName: !!(action.suggestedName || action.name),
    frameCount: frames.length,
    frames: frameResults,
    bytes: xml.length
  };
}

function prAI_deleteTempFile(action) {
  if (!action.filePath) {
    throw new Error("deleteTempFile needs filePath.");
  }
  if (!prAI_isTempPath(action.filePath, action)) {
    throw new Error("deleteTempFile is limited to PR AI temp files.");
  }
  var file = new File(action.filePath);
  var existed = file.exists;
  if (file.exists && !file.remove()) {
    throw new Error("Could not delete temp file: " + action.filePath);
  }
  return { type: "deleteTempFile", filePath: file.fsName, existed: existed };
}

function prAI_readTextFile(filePath) {
  var file = new File(filePath);
  if (!file.exists) {
    throw new Error(prAI_fileDiagnosticError("Text file not found:", filePath, null));
  }
  file.encoding = "UTF-8";
  if (!file.open("r")) {
    throw new Error(prAI_fileDiagnosticError("Could not read text file:", filePath, null));
  }
  var contents = file.read();
  file.close();
  return contents;
}

function prAI_importTextFile(action) {
  var filePath = action.filePath || "";
  var wroteTemp = false;
  if (!filePath) {
    var writeResult = prAI_writeTempTextFile({
      extension: action.extension || "txt",
      suggestedName: action.suggestedName || action.name || "PR_AI_Text",
      contents: action.contents || action.text || ""
    });
    filePath = writeResult.filePath;
    wroteTemp = true;
  }
  var file = new File(filePath);
  if (!file.exists) {
    throw new Error(prAI_fileDiagnosticError("Text file not found:", filePath, action));
  }
  var importOk = false;
  try {
    importOk = app.project.importFiles([file.fsName], action.suppressUI === true, app.project.rootItem, false);
  } catch (importErr) {
    throw new Error(prAI_fileDiagnosticError("Premiere threw while importing text file:", file.fsName, action) + " | premiereError: " + importErr.toString());
  }
  if (!importOk) {
    throw new Error(prAI_fileDiagnosticError("Premiere returned false while importing text file:", file.fsName, action));
  }
  var item = prAI_findProjectItemByMediaPath(app.project.rootItem, file.fsName) || prAI_findProjectItemByName(app.project.rootItem, file.name);
  if (wroteTemp && action.cleanupAfterImport === true) {
    prAI_deleteTempFile({ filePath: file.fsName });
  }
  return {
    type: "importTextFile",
    filePath: file.fsName,
    projectItemName: item ? item.name : file.name,
    projectItemId: item ? (item.nodeId || "") : "",
    cleanupAfterImport: wroteTemp && action.cleanupAfterImport === true
  };
}

function prAI_importMediaFile(action) {
  if (!action.filePath) {
    throw new Error("importMediaFile needs filePath.");
  }
  var file = new File(action.filePath);
  if (!file.exists) {
    throw new Error("Media file not found: " + file.fsName);
  }
  var importOk = app.project.importFiles([file.fsName], action.suppressUI !== false, app.project.rootItem, false);
  var item = prAI_findProjectItemByMediaPath(app.project.rootItem, file.fsName) || prAI_findProjectItemByName(app.project.rootItem, file.name);
  var inserted = null;
	  if (item && action.insertInTimeline === true) {
	    inserted = prAI_insertProjectItemWithMode(prAI_requireSequence(), {
	      sourcePath: file.fsName,
	      trackType: action.trackType || "video",
	      trackIndex: action.trackIndex || action.videoTrackIndex || 0,
	      seconds: action.seconds || action.startSeconds || 0,
	      inPointSeconds: action.inPointSeconds,
	      outPointSeconds: action.outPointSeconds
	    }, action.overwrite === true);
	  }
  return {
    type: "importMediaFile",
    filePath: file.fsName,
    imported: importOk,
    projectItemName: item ? item.name : "",
    projectItemId: item ? (item.nodeId || "") : "",
    inserted: inserted
  };
}

function prAI_svgEscape(value) {
  return prAI_xmlEscape(value).replace(new RegExp("'", "g"), "&apos;");
}

function prAI_normalizeRichTextLines(action) {
  var input = action.lines || action.paragraphs || action.items || action.runs || action.text || "";
  var lines = [];
  if (typeof input === "string") {
    var parts = input.split(/\r\n|\r|\n/);
    for (var i = 0; i < parts.length; i++) {
      lines.push([{ text: parts[i] }]);
    }
  } else if (Object.prototype.toString.call(input) === "[object Array]") {
    for (var j = 0; j < input.length; j++) {
      var line = input[j];
      if (typeof line === "string") {
        lines.push([{ text: line }]);
      } else if (line && Object.prototype.toString.call(line) === "[object Array]") {
        lines.push(line);
      } else if (line && line.runs) {
        lines.push(line.runs);
      } else if (line && line.text !== undefined) {
        lines.push([line]);
      }
    }
  }
  if (!lines.length) {
    lines.push([{ text: "" }]);
  }
  return lines;
}

function prAI_richTextSvgFileName(action) {
  var functionName = prAI_xmlFunctionName(action);
  return prAI_timestampName(new Date()) + " - AutoEdit - " + functionName + ".svg";
}

function prAI_svgStyleAttributes(run, action) {
  var fill = run.fill || run.color || action.fill || action.color || "#ffffff";
  var stroke = run.stroke || action.stroke || "";
  var strokeWidth = run.strokeWidth !== undefined ? run.strokeWidth : action.strokeWidth;
  var attrs = [
    'fill="' + prAI_svgEscape(fill) + '"'
  ];
  if (stroke) {
    attrs.push('stroke="' + prAI_svgEscape(stroke) + '"');
    attrs.push('stroke-width="' + prAI_svgEscape(strokeWidth !== undefined ? strokeWidth : 0) + '"');
    attrs.push('paint-order="' + (run.fillOverStroke === false || action.fillOverStroke === false ? "fill stroke" : "stroke fill") + '"');
    attrs.push('stroke-linejoin="round"');
  }
  if (run.fontWeight || run.bold || action.fontWeight) {
    attrs.push('font-weight="' + prAI_svgEscape(run.fontWeight || (run.bold ? "700" : action.fontWeight)) + '"');
  }
  if (run.fontStyle || run.italic || action.fontStyle) {
    attrs.push('font-style="' + prAI_svgEscape(run.fontStyle || (run.italic ? "italic" : action.fontStyle)) + '"');
  }
  if (run.opacity !== undefined) {
    attrs.push('opacity="' + prAI_svgEscape(run.opacity) + '"');
  }
  return attrs.join(" ");
}

function prAI_createStyledTextSvg(action) {
  var width = Number(action.width || 1920);
  var height = Number(action.height || 1080);
  var x = Number(action.x !== undefined ? action.x : width / 2);
  var y = Number(action.y !== undefined ? action.y : height / 2);
  var fontSize = Number(action.fontSize || action.size || 96);
  var lineHeight = Number(action.lineHeight || Math.round(fontSize * 1.18));
  var fontFamily = action.fontFamily || action.font || "KitRounded-ExtraBold, Arial, sans-serif";
  var align = action.align || action.textAlign || "center";
  var anchor = align === "left" ? "start" : (align === "right" ? "end" : "middle");
  var lines = prAI_normalizeRichTextLines(action);
  var startY = y - ((lines.length - 1) * lineHeight / 2);
  var svgLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">',
    '  <rect width="100%" height="100%" fill="none"/>',
    '  <text x="' + x + '" y="' + startY + '" text-anchor="' + anchor + '" dominant-baseline="middle" font-family="' + prAI_svgEscape(fontFamily) + '" font-size="' + fontSize + '">'
  ];
  for (var i = 0; i < lines.length; i++) {
    var runs = lines[i];
    var dy = i === 0 ? 0 : lineHeight;
    svgLines.push('    <tspan x="' + x + '" dy="' + dy + '">');
    for (var r = 0; r < runs.length; r++) {
      var run = runs[r] || {};
      svgLines.push('      <tspan ' + prAI_svgStyleAttributes(run, action) + '>' + prAI_svgEscape(run.text || "") + '</tspan>');
    }
    svgLines.push('    </tspan>');
  }
  svgLines.push('  </text>');
  svgLines.push('</svg>');

  var outputFolder = prAI_xmlOutputFolder(action);
  var fileName = prAI_richTextSvgFileName(action);
  var file = new File(outputFolder.fsName + "/" + fileName);
  file.encoding = "UTF-8";
  if (!file.open("w")) {
    throw new Error("Could not create styled SVG text file.");
  }
  file.write(svgLines.join("\n"));
  file.close();

  var afterCreateAction = String(action.afterCreateAction || "import");
  var importOk = null;
  var importError = "";
  var projectItem = null;
  var inserted = null;
  var opened = false;
  var openError = "";
  var folderOpened = false;
  if (afterCreateAction !== "openFolder" && afterCreateAction !== "open") {
    try {
      importOk = app.project.importFiles([file.fsName], action.suppressUI === true, app.project.rootItem, false);
      projectItem = prAI_findProjectItemByMediaPath(app.project.rootItem, file.fsName) || prAI_findProjectItemByName(app.project.rootItem, file.name);
      if (projectItem && (action.insertInTimeline === true || action.seconds !== undefined || action.startSeconds !== undefined)) {
        inserted = prAI_insertProjectItemWithMode(prAI_requireSequence(), {
          sourcePath: file.fsName,
          trackType: action.trackType || "video",
          trackIndex: action.trackIndex || action.videoTrackIndex || 0,
          seconds: action.seconds !== undefined ? action.seconds : (action.startSeconds || 0)
        }, action.overwrite === true);
      }
    } catch (err) {
      importError = err.toString();
      importOk = false;
    }
  }
  if (afterCreateAction === "openFolder") {
    folderOpened = prAI_openFolder(outputFolder);
  } else if (afterCreateAction === "open") {
    try {
      opened = file.execute();
    } catch (openErr) {
      openError = openErr.toString();
    }
  }
  return {
    type: "createStyledTextSvg",
    filePath: file.fsName,
    outputFolder: outputFolder.fsName,
    fileName: fileName,
    afterCreateAction: afterCreateAction,
    imported: importOk,
    importError: importError,
    projectItemName: projectItem ? projectItem.name : "",
    projectItemId: projectItem ? (projectItem.nodeId || "") : "",
    inserted: inserted,
    opened: opened,
    openError: openError,
    folderOpened: folderOpened,
    lineCount: lines.length,
    bytes: svgLines.join("\n").length,
    note: "SVG supports arbitrary text length and style switches, but imports as a media asset, not an editable Essential Graphics text layer."
  };
}

function prAI_buildSrt(items) {
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    out.push(String(i + 1));
    out.push(prAI_secondsToSrtTime(item.startSeconds) + " --> " + prAI_secondsToSrtTime(item.endSeconds));
    out.push(prAI_escapeSrtText(item.text));
    out.push("");
  }
  return out.join("\r\n");
}

function prAI_parseSrtTime(value) {
  var match = String(value || "").replace(/^\s+|\s+$/g, "").match(/(\d+):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?/);
  if (!match) {
    return null;
  }
  var msText = match[4] || "0";
  while (msText.length < 3) {
    msText += "0";
  }
  return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]) + (Number(msText.slice(0, 3)) / 1000);
}

function prAI_parseSrt(contents, offsetSeconds) {
  var text = String(contents || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  var blocks = text.split(/\n\s*\n/);
  var items = [];
  var offset = Number(offsetSeconds || 0);
  for (var i = 0; i < blocks.length; i++) {
    var lines = blocks[i].split("\n");
    var timingIndex = -1;
    for (var l = 0; l < lines.length; l++) {
      if (lines[l].indexOf("-->") !== -1) {
        timingIndex = l;
        break;
      }
    }
    if (timingIndex === -1) {
      continue;
    }
    var parts = lines[timingIndex].split("-->");
    var start = prAI_parseSrtTime(parts[0]);
    var end = prAI_parseSrtTime(parts[1]);
    if (start === null || end === null) {
      continue;
    }
    start = Math.max(0, start + offset);
    end = Math.max(start + 0.1, end + offset);
    var captionLines = [];
    for (var t = timingIndex + 1; t < lines.length; t++) {
      if (String(lines[t]).replace(/^\s+|\s+$/g, "")) {
        captionLines.push(lines[t]);
      }
    }
    if (!captionLines.length) {
      continue;
    }
    items.push({
      text: captionLines.join("\n"),
      startSeconds: start,
      endSeconds: end
    });
  }
  return items;
}

function prAI_findProjectItemByMediaPath(root, mediaPath) {
  if (!root) {
    return null;
  }
  var children = prAI_projectItemChildren(root);
  var childCount = prAI_collectionCount(children);
  for (var i = 0; i < childCount; i++) {
    var item = prAI_collectionItem(children, i);
    if (!item) {
      continue;
    }
    if (prAI_projectItemMediaPath(item) === mediaPath) {
      return item;
    }
    if (prAI_collectionCount(prAI_projectItemChildren(item))) {
      var found = prAI_findProjectItemByMediaPath(item, mediaPath);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function prAI_getProjectSnapshot(payloadText) {
  try {
    if (!app.project) {
      return prAI_result(false, null, "No Premiere project is open.");
    }
    var payload = {};
    if (payloadText) {
      try {
        payload = JSON.parse(payloadText);
      } catch (parseErr) {
        payload = {};
      }
    }

    var items = [];
    var diagnostics = {
      rootItemAvailable: false,
      projectItemWalkError: "",
      sequenceListError: "",
      sequenceScanError: ""
    };
    try {
      diagnostics.rootItemAvailable = !!app.project.rootItem;
      prAI_walkProjectItems(app.project.rootItem, items, 0);
    } catch (walkErr) {
      diagnostics.projectItemWalkError = walkErr.toString();
    }

    var skipComponents = payload.skipComponents === true;
    var requestedSequenceId = payload.targetSequenceId || payload.sequenceId || "";
    var sequence = requestedSequenceId ? prAI_findSequenceById(requestedSequenceId) : null;
    if (!sequence) {
      sequence = prAI_resolveActiveSequence();
    }
    var sequenceData = null;
    var sequences = [];
    var sequenceCount = 0;
    try {
      if (app.project.sequences) {
        sequenceCount = prAI_collectionCount(app.project.sequences);
        for (var si = 0; si < sequenceCount; si++) {
          var listedSequence = prAI_collectionItem(app.project.sequences, si);
          if (listedSequence) {
            sequences.push({
              name: listedSequence.name || ("Sequence " + (si + 1)),
              sequenceId: listedSequence.sequenceID || "",
              active: sequence && listedSequence.sequenceID === sequence.sequenceID
            });
          }
        }
      }
    } catch (listErr) {
      diagnostics.sequenceListError = listErr.toString();
    }

    if (sequence) {
      try {
        var sequenceFps = prAI_sequenceFrameRate(sequence);
        var videoTracks = [];
        var videoTrackCount = prAI_collectionCount(sequence.videoTracks);
        for (var vt = 0; vt < videoTrackCount; vt++) {
          var vTrack = prAI_collectionItem(sequence.videoTracks, vt);
          if (!vTrack) {
            continue;
          }
          var vClips = [];
          var videoClipCount = prAI_collectionCount(vTrack.clips);
          for (var vc = 0; vc < videoClipCount; vc++) {
            var vClip = prAI_collectionItem(vTrack.clips, vc);
            if (!vClip) {
              continue;
            }
            var vProjectItem = prAI_clipProjectItem(vClip);
            prAI_pushProjectItemSnapshot(items, vProjectItem);
            vClips.push({
              clipId: "video:" + vt + ":" + vc + ":" + prAI_readTimeSeconds(vClip, "start") + ":" + vClip.name,
              index: vc,
              trackIndex: vt,
              trackType: "video",
              name: vClip.name,
              projectItemName: vProjectItem ? vProjectItem.name : "",
              projectItemId: vProjectItem ? (vProjectItem.nodeId || "") : "",
              sourcePath: vProjectItem ? prAI_projectItemMediaPath(vProjectItem) : "",
              startSeconds: prAI_readTimeSeconds(vClip, "start"),
              endSeconds: prAI_readTimeSeconds(vClip, "end"),
              durationSeconds: prAI_readTimeSeconds(vClip, "duration"),
              inPointSeconds: prAI_readTimeSeconds(vClip, "inPoint"),
              outPointSeconds: prAI_readTimeSeconds(vClip, "outPoint"),
              disabled: !!vClip.disabled,
              linkedGroupId: vProjectItem ? (vProjectItem.nodeId || vProjectItem.name) : vClip.name,
              components: skipComponents ? [] : prAI_readClipComponents(vClip)
            });
          }
          videoTracks.push({ index: vt, clips: vClips });
        }

        var audioTracks = [];
        var audioTrackCount = prAI_collectionCount(sequence.audioTracks);
        for (var at = 0; at < audioTrackCount; at++) {
          var aTrack = prAI_collectionItem(sequence.audioTracks, at);
          if (!aTrack) {
            continue;
          }
          var aClips = [];
          var audioClipCount = prAI_collectionCount(aTrack.clips);
          for (var ac = 0; ac < audioClipCount; ac++) {
            var aClip = prAI_collectionItem(aTrack.clips, ac);
            if (!aClip) {
              continue;
            }
            var aProjectItem = prAI_clipProjectItem(aClip);
            prAI_pushProjectItemSnapshot(items, aProjectItem);
            aClips.push({
              clipId: "audio:" + at + ":" + ac + ":" + prAI_readTimeSeconds(aClip, "start") + ":" + aClip.name,
              index: ac,
              trackIndex: at,
              trackType: "audio",
              name: aClip.name,
              projectItemName: aProjectItem ? aProjectItem.name : "",
              projectItemId: aProjectItem ? (aProjectItem.nodeId || "") : "",
              sourcePath: aProjectItem ? prAI_projectItemMediaPath(aProjectItem) : "",
              startSeconds: prAI_readTimeSeconds(aClip, "start"),
              endSeconds: prAI_readTimeSeconds(aClip, "end"),
              durationSeconds: prAI_readTimeSeconds(aClip, "duration"),
              inPointSeconds: prAI_readTimeSeconds(aClip, "inPoint"),
              outPointSeconds: prAI_readTimeSeconds(aClip, "outPoint"),
              disabled: !!aClip.disabled,
              linkedGroupId: aProjectItem ? (aProjectItem.nodeId || aProjectItem.name) : aClip.name,
              components: skipComponents ? [] : prAI_readClipComponents(aClip)
            });
          }
          audioTracks.push({ index: at, clips: aClips });
        }

        sequenceData = {
          name: sequence.name,
          sequenceId: sequence.sequenceID,
          sequenceFps: sequenceFps,
          videoTracks: videoTracks,
          audioTracks: audioTracks
        };
      } catch (scanErr) {
        diagnostics.sequenceScanError = scanErr.toString();
        sequenceData = {
          name: sequence.name || "",
          sequenceId: sequence.sequenceID || "",
          sequenceFps: null,
          videoTracks: [],
          audioTracks: []
        };
      }
    }

    diagnostics.projectItemCount = items.length;
    diagnostics.sequenceCollectionCount = sequenceCount;
    diagnostics.sequenceCount = sequences.length;
    diagnostics.activeSequenceAvailable = sequenceData !== null;

    return prAI_result(true, {
      projectName: app.project.name || "",
      projectPath: app.project.path || "",
      activeSequence: sequenceData,
      sequences: sequences,
      targetSequenceId: sequenceData ? sequenceData.sequenceId : "",
      projectItems: items,
      diagnostics: diagnostics,
      capabilities: {
        stableProjectItemIds: true,
        sourceRangeInsert: true,
        overwriteRange: true,
        splitClip: true,
        splitTrackAtTimes: true,
        duplicateClip: true,
        slipSlideDuration: true,
        replaceClipRange: true,
        projectBins: "best-effort; no project item deletion",
        projectItemLabels: "best-effort",
        trackState: "best-effort",
        clipMarkers: "source-marker best-effort",
        motionControls: "best-effort",
        essentialGraphics: "best-effort existing graphics text/property edits; MOGRT insert if importMGT is available",
        fades: "best-effort keyframes",
        exports: "best-effort",
        linkedAV: "best-effort",
        thumbnails: false,
        transcripts: false,
        dryRun: true
      }
    });
  } catch (err) {
    return prAI_result(false, null, err.toString());
  }
}

function prAI_getProjectSnapshotLite(payloadText) {
  try {
    if (!app.project) {
      return prAI_result(false, null, "No Premiere project is open.");
    }
    var payload = {};
    if (payloadText) {
      try {
        payload = JSON.parse(payloadText);
      } catch (parseErr) {
        payload = {};
      }
    }
    var diagnostics = {
      liteSnapshot: true,
      rootItemAvailable: false,
      projectItemWalkError: "",
      sequenceListError: "",
      sequenceScanError: ""
    };
    var items = [];
    try {
      diagnostics.rootItemAvailable = !!app.project.rootItem;
      prAI_walkProjectItems(app.project.rootItem, items, 0);
    } catch (walkErr) {
      diagnostics.projectItemWalkError = walkErr.toString();
    }

    var requestedSequenceId = payload.targetSequenceId || payload.sequenceId || "";
    var sequence = requestedSequenceId ? prAI_findSequenceById(requestedSequenceId) : null;
    if (!sequence) {
      sequence = prAI_resolveActiveSequence();
    }

    var sequences = [];
    var sequenceCount = 0;
    try {
      if (app.project.sequences) {
        sequenceCount = prAI_collectionCount(app.project.sequences);
        for (var si = 0; si < sequenceCount; si++) {
          var listedSequence = prAI_collectionItem(app.project.sequences, si);
          if (listedSequence) {
            sequences.push({
              name: listedSequence.name || ("Sequence " + (si + 1)),
              sequenceId: listedSequence.sequenceID || "",
              active: sequence && listedSequence.sequenceID === sequence.sequenceID
            });
          }
        }
      }
    } catch (listErr) {
      diagnostics.sequenceListError = listErr.toString();
    }

    var sequenceData = null;
    if (sequence) {
      try {
        var videoTracks = [];
        var videoTrackCount = prAI_collectionCount(sequence.videoTracks);
        for (var vt = 0; vt < videoTrackCount; vt++) {
          var vTrack = prAI_collectionItem(sequence.videoTracks, vt);
          if (!vTrack) {
            continue;
          }
          var vClips = [];
          var videoClipCount = prAI_collectionCount(vTrack.clips);
          for (var vc = 0; vc < videoClipCount; vc++) {
            var vClip = prAI_collectionItem(vTrack.clips, vc);
            if (!vClip) {
              continue;
            }
            var vProjectItem = prAI_clipProjectItem(vClip);
            prAI_pushProjectItemSnapshot(items, vProjectItem);
            vClips.push({
              clipId: "video:" + vt + ":" + vc + ":" + prAI_readTimeSeconds(vClip, "start") + ":" + vClip.name,
              index: vc,
              trackIndex: vt,
              trackType: "video",
              name: vClip.name || "",
              projectItemName: vProjectItem ? vProjectItem.name : "",
              projectItemId: vProjectItem ? (vProjectItem.nodeId || "") : "",
              sourcePath: vProjectItem ? prAI_projectItemMediaPath(vProjectItem) : "",
              startSeconds: prAI_readTimeSeconds(vClip, "start"),
              endSeconds: prAI_readTimeSeconds(vClip, "end"),
              durationSeconds: prAI_readTimeSeconds(vClip, "duration")
            });
          }
          videoTracks.push({ index: vt, clips: vClips });
        }

        var audioTracks = [];
        var audioTrackCount = prAI_collectionCount(sequence.audioTracks);
        for (var at = 0; at < audioTrackCount; at++) {
          var aTrack = prAI_collectionItem(sequence.audioTracks, at);
          if (!aTrack) {
            continue;
          }
          var aClips = [];
          var audioClipCount = prAI_collectionCount(aTrack.clips);
          for (var ac = 0; ac < audioClipCount; ac++) {
            var aClip = prAI_collectionItem(aTrack.clips, ac);
            if (!aClip) {
              continue;
            }
            var aProjectItem = prAI_clipProjectItem(aClip);
            prAI_pushProjectItemSnapshot(items, aProjectItem);
            aClips.push({
              clipId: "audio:" + at + ":" + ac + ":" + prAI_readTimeSeconds(aClip, "start") + ":" + aClip.name,
              index: ac,
              trackIndex: at,
              trackType: "audio",
              name: aClip.name || "",
              projectItemName: aProjectItem ? aProjectItem.name : "",
              projectItemId: aProjectItem ? (aProjectItem.nodeId || "") : "",
              sourcePath: aProjectItem ? prAI_projectItemMediaPath(aProjectItem) : "",
              startSeconds: prAI_readTimeSeconds(aClip, "start"),
              endSeconds: prAI_readTimeSeconds(aClip, "end"),
              durationSeconds: prAI_readTimeSeconds(aClip, "duration")
            });
          }
          audioTracks.push({ index: at, clips: aClips });
        }
        sequenceData = {
          name: sequence.name || "",
          sequenceId: sequence.sequenceID || "",
          sequenceFps: prAI_sequenceFrameRate(sequence),
          videoTracks: videoTracks,
          audioTracks: audioTracks
        };
      } catch (scanErr) {
        diagnostics.sequenceScanError = scanErr.toString();
      }
    }

    diagnostics.projectItemCount = items.length;
    diagnostics.sequenceCollectionCount = sequenceCount;
    diagnostics.sequenceCount = sequences.length;
    diagnostics.activeSequenceAvailable = sequenceData !== null;

    return prAI_result(true, {
      projectName: app.project.name || "",
      projectPath: app.project.path || "",
      activeSequence: sequenceData,
      sequences: sequences,
      targetSequenceId: sequenceData ? sequenceData.sequenceId : "",
      projectItems: items,
      diagnostics: diagnostics,
      capabilities: {
        stableProjectItemIds: true,
        sourceRangeInsert: true,
        overwriteRange: true,
        splitClip: true,
        splitTrackAtTimes: true,
        thumbnails: false,
        transcripts: false,
        liteSnapshot: true
      }
    });
  } catch (err) {
    return prAI_result(false, null, err.toString());
  }
}

function prAI_findProjectItemByName(root, name) {
  if (!root) {
    return null;
  }
  var children = prAI_projectItemChildren(root);
  var childCount = prAI_collectionCount(children);
  for (var i = 0; i < childCount; i++) {
    var item = prAI_collectionItem(children, i);
    if (!item) {
      continue;
    }
    if (item.name === name) {
      return item;
    }
    if (prAI_collectionCount(prAI_projectItemChildren(item))) {
      var found = prAI_findProjectItemByName(item, name);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function prAI_findProjectItemByNodeId(root, nodeId) {
  if (!root || !nodeId) {
    return null;
  }
  var children = prAI_projectItemChildren(root);
  var childCount = prAI_collectionCount(children);
  for (var i = 0; i < childCount; i++) {
    var item = prAI_collectionItem(children, i);
    if (!item) {
      continue;
    }
    try {
      if (item.nodeId === nodeId) {
        return item;
      }
    } catch (nodeIdErr) {
    }
    if (prAI_collectionCount(prAI_projectItemChildren(item))) {
      var nested = prAI_findProjectItemByNodeId(item, nodeId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function prAI_findProjectItemExact(root, requestedName, requestedNorm) {
  if (!root || (!requestedName && !requestedNorm)) {
    return null;
  }
  var children = prAI_projectItemChildren(root);
  var childCount = prAI_collectionCount(children);
  for (var i = 0; i < childCount; i++) {
    var item = prAI_collectionItem(children, i);
    if (!item) {
      continue;
    }
    var itemIsBin = false;
    try {
      itemIsBin = Number(item.type) === 2;
    } catch (itemTypeErr) {
    }
    if (!itemIsBin) {
      var mediaPath = prAI_projectItemMediaPath(item);
      var mediaFile = mediaPath ? mediaPath.split(/[\/\\]/).pop() : "";
      var itemNorm = prAI_normalizeProjectItemLookupName(item.name);
      var pathNorm = prAI_normalizeProjectItemLookupName(mediaFile);
      if ((requestedName && (item.name === requestedName || mediaFile === requestedName)) || (requestedNorm && (itemNorm === requestedNorm || pathNorm === requestedNorm))) {
        return item;
      }
    }
    if (prAI_collectionCount(prAI_projectItemChildren(item))) {
      var nested = prAI_findProjectItemExact(item, requestedName, requestedNorm);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function prAI_compactProjectItemId(value, requireWholeValue) {
  var text = String(value || "").replace(/^\s+|\s+$/g, "").replace(/\.(mp4|mov|m4v|avi|mxf|webm|wav|mp3|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)$/i, "");
  var pattern = requireWholeValue
    ? /^([A-Za-z]+)\s*([0-9]+(?:\s*[._-]\s*[0-9]+)*)$/
    : /^([A-Za-z]+)\s*([0-9]+(?:\s*[._-]\s*[0-9]+)*)/;
  var match = text.match(pattern);
  if (!match) {
    return "";
  }
  return String(match[1]).toLowerCase() + String(match[2]).replace(/\s+/g, "").replace(/[._-]+/g, ".");
}

function prAI_findProjectItemUniqueCompact(root, requestedName, state) {
  var requestedId = prAI_compactProjectItemId(requestedName, true);
  if (!root || !requestedId) {
    return null;
  }
  state = state || { match: null, count: 0, nodeIds: {} };
  var children = prAI_projectItemChildren(root);
  var childCount = prAI_collectionCount(children);
  for (var i = 0; i < childCount; i++) {
    var item = prAI_collectionItem(children, i);
    if (!item) {
      continue;
    }
    var itemIsBin = false;
    try {
      itemIsBin = Number(item.type) === 2;
    } catch (itemTypeErr) {
    }
    if (!itemIsBin) {
      var mediaPath = prAI_projectItemMediaPath(item);
      var mediaFile = mediaPath ? mediaPath.split(/[\/\\]/).pop() : "";
      var itemId = prAI_compactProjectItemId(item.name, false) || prAI_compactProjectItemId(mediaFile, false);
      if (itemId === requestedId) {
        var nodeKey = "";
        try {
          nodeKey = String(item.nodeId || "");
        } catch (nodeErr) {
        }
        nodeKey = nodeKey || (String(item.name || "") + "|" + String(mediaPath || ""));
        if (!state.nodeIds[nodeKey]) {
          state.nodeIds[nodeKey] = true;
          state.match = item;
          state.count++;
        }
      }
    }
    if (prAI_collectionCount(prAI_projectItemChildren(item))) {
      prAI_findProjectItemUniqueCompact(item, requestedName, state);
    }
  }
  return state.count === 1 ? state.match : null;
}

function prAI_findProjectItem(root, action, fallbackOnly) {
  if (!root) {
    return null;
  }
  var requestedName = action.projectItemName || action.sourceName || action.source || "";
  var requestedNorm = prAI_normalizeProjectItemLookupName(requestedName);
  if (!fallbackOnly) {
    var selectedById = action.projectItemId ? prAI_findProjectItemByNodeId(root, action.projectItemId) : null;
    if (selectedById) {
      return selectedById;
    }
    var selectedExactly = prAI_findProjectItemExact(root, requestedName, requestedNorm);
    if (selectedExactly) {
      return selectedExactly;
    }
    var selectedByUniqueCompactId = prAI_findProjectItemUniqueCompact(root, requestedName);
    if (selectedByUniqueCompactId) {
      return selectedByUniqueCompactId;
    }
    if (action.projectItemId || action.strictProjectItemLookup === true) {
      return null;
    }
  }
  var children = prAI_projectItemChildren(root);
  var childCount = prAI_collectionCount(children);
  var numericFallback = null;
  var numericFallbackCount = 0;
  for (var i = 0; i < childCount; i++) {
    var item = prAI_collectionItem(children, i);
    if (!item) {
      continue;
    }
    var mediaPath = prAI_projectItemMediaPath(item);
    var itemIsBin = false;
    try {
      itemIsBin = Number(item.type) === 2;
    } catch (itemTypeErr) {
    }
    if (!itemIsBin && action.projectItemId && item.nodeId === action.projectItemId) {
      return item;
    }
    if (!itemIsBin && requestedName && item.name === requestedName) {
      return item;
    }
    if (!itemIsBin && requestedNorm) {
      var itemNorm = prAI_normalizeProjectItemLookupName(item.name);
      var pathNorm = prAI_normalizeProjectItemLookupName(mediaPath ? mediaPath.split(/[\/\\]/).pop() : "");
      if (itemNorm === requestedNorm || pathNorm === requestedNorm) {
        return item;
      }
      if (requestedNorm.length >= 3 && (itemNorm.indexOf(requestedNorm) === 0 || pathNorm.indexOf(requestedNorm) === 0)) {
        return item;
      }
      var compactMatch = String(requestedName || "").match(/[A-Za-z]+\d+(?:[._-]\d+)*/);
      if (compactMatch) {
        var compactPattern = new RegExp("^" + compactMatch[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^A-Za-z0-9]|$)", "i");
        var compactMediaFile = mediaPath ? mediaPath.split(/[\/\\]/).pop() : "";
        if (compactPattern.test(item.name || "") || compactPattern.test(compactMediaFile)) {
          return item;
        }
      }
      if (/^\d+$/.test(requestedNorm)) {
        var mediaFile = mediaPath ? mediaPath.split(/[\/\\]/).pop() : "";
        var leadingDigitsPattern = new RegExp("^0*" + requestedNorm + "([^0-9]|$)");
        if (leadingDigitsPattern.test(item.name || "") || leadingDigitsPattern.test(mediaFile)) {
          return item;
        }
        var digitsPattern = new RegExp("(^|[^a-z0-9])0*" + requestedNorm + "([^0-9]|$)", "i");
        if (digitsPattern.test(item.name || "") || digitsPattern.test(mediaFile)) {
          numericFallback = item;
          numericFallbackCount++;
        }
      }
    }
    if (!itemIsBin && action.sourcePath && mediaPath === action.sourcePath) {
      return item;
    }
    if (prAI_collectionCount(prAI_projectItemChildren(item))) {
      var found = prAI_findProjectItem(item, action, true);
      if (found) {
        return found;
      }
    }
  }
  if (numericFallbackCount === 1) {
    return numericFallback;
  }
  return null;
}

function prAI_normalizeProjectItemLookupName(value) {
  return String(value || "").toLowerCase()
    .replace(/\.(mp4|mov|m4v|avi|mxf|webm|wav|mp3|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function prAI_clipProjectItem(clip) {
  try {
    if (clip.projectItem) {
      return clip.projectItem;
    }
  } catch (err) {
  }
  return null;
}

function prAI_clipIsSelected(clip) {
  try {
    if (clip.isSelected && clip.isSelected()) {
      return true;
    }
  } catch (err) {
  }
  try {
    if (clip.selected === true) {
      return true;
    }
  } catch (selErr) {
  }
  return false;
}

function prAI_sequenceFrameRate(sequence) {
  try {
    if (sequence && sequence.getSettings) {
      var settings = sequence.getSettings();
      if (settings && settings.videoFrameRate) {
        var frameDuration = Number(settings.videoFrameRate.seconds);
        if (frameDuration > 0) {
          return 1 / frameDuration;
        }
      }
    }
  } catch (err) {
  }
  return 0;
}

function prAI_timelineClipPayload(clip, trackType, trackIndex, clipIndex, sequenceFps) {
  var projectItem = prAI_clipProjectItem(clip);
  return {
    clipId: trackType + ":" + trackIndex + ":" + clipIndex + ":" + prAI_readTimeSeconds(clip, "start") + ":" + clip.name,
    index: clipIndex,
    trackIndex: trackIndex,
    trackType: trackType,
    name: clip.name,
    projectItemName: projectItem ? projectItem.name : "",
    projectItemId: projectItem ? (projectItem.nodeId || "") : "",
    sourcePath: projectItem ? prAI_projectItemMediaPath(projectItem) : "",
    startSeconds: prAI_readTimeSeconds(clip, "start"),
    endSeconds: prAI_readTimeSeconds(clip, "end"),
    durationSeconds: prAI_readTimeSeconds(clip, "duration"),
    inPointSeconds: prAI_readTimeSeconds(clip, "inPoint"),
    outPointSeconds: prAI_readTimeSeconds(clip, "outPoint"),
    sequenceFps: Number(sequenceFps || 0),
    disabled: !!clip.disabled
  };
}

function prAI_getSelectedTimelineClips() {
  try {
    var sequence = prAI_requireSequence();
    var sequenceFps = prAI_sequenceFrameRate(sequence);
    var clips = [];
    for (var vt = 0; vt < sequence.videoTracks.numTracks; vt++) {
      var track = sequence.videoTracks[vt];
      for (var vc = 0; vc < track.clips.numItems; vc++) {
        var clip = track.clips[vc];
        if (prAI_clipIsSelected(clip)) {
          clips.push(prAI_timelineClipPayload(clip, "video", vt, vc, sequenceFps));
        }
      }
    }
    return prAI_result(true, { clips: clips, sequenceFps: sequenceFps });
  } catch (err) {
    return prAI_result(false, null, err.toString());
  }
}

function prAI_readClipComponents(clip) {
  var components = [];
  try {
    for (var c = 0; c < clip.components.numItems && c < 25; c++) {
      var component = clip.components[c];
      var props = [];
      try {
        for (var p = 0; p < component.properties.numItems && p < 60; p++) {
          var property = component.properties[p];
          var value = null;
          try {
            if (property.getValue) {
              value = property.getValue();
            }
          } catch (valueErr) {
          }
          if (prAI_shouldSkipComponentProperty(component, property, value)) {
            continue;
          }
          props.push({
            displayName: String(property.displayName || ""),
            matchName: String(property.matchName || ""),
            value: prAI_propertyLooksLikeMaskFeather(component, property) && value && typeof value === "object" && value.length !== undefined ? prAI_firstNumber(value) : value,
            linked: prAI_propertyLooksLikeMaskFeather(component, property) ? true : undefined
          });
        }
      } catch (propErr) {
      }
      if (!props.length) {
        continue;
      }
      components.push({
        displayName: String(component.displayName || ""),
        matchName: String(component.matchName || ""),
        properties: props
      });
    }
  } catch (err) {
  }
  return components;
}

function prAI_shouldSkipComponentProperty(component, property, value) {
  var componentName = String(component.displayName || component.matchName || "").toLowerCase();
  var propertyName = String(property.displayName || property.matchName || "").toLowerCase();
  var isChannelVolume = componentName.indexOf("channel volume") !== -1;
  if (isChannelVolume) {
    return true;
  }
  if (componentName.indexOf("volume") !== -1 && propertyName.indexOf("level") === -1) {
    return true;
  }
  if (value && typeof value === "object" && value.length !== undefined && value.length > 8) {
    return true;
  }
  return false;
}

function prAI_getTrack(sequence, trackType, trackIndex) {
  var tracks = trackType === "audio" ? sequence.audioTracks : sequence.videoTracks;
  var index = Number(trackIndex || 0);
  if (index < 0 || index >= tracks.numTracks) {
    throw new Error("Track not found: " + trackType + " " + index);
  }
  return tracks[index];
}

function prAI_projectItemAvailableOutSeconds(item) {
  if (!item) {
    return null;
  }
  try {
    if (item.getOutPoint) {
      var outPoint = prAI_timeValueSeconds(item.getOutPoint());
      if (outPoint !== null && outPoint > 0) {
        return outPoint;
      }
    }
  } catch (outErr) {
  }
  return null;
}

function prAI_projectItemMediaStartSeconds(item) {
  if (!item) {
    return 0;
  }
  try {
    if (item.startTime) {
      var mediaStart = prAI_timeValueSeconds(item.startTime());
      if (mediaStart !== null && !isNaN(mediaStart)) {
        return Number(mediaStart);
      }
    }
    if (item.getStartTime) {
      var start = prAI_timeValueSeconds(item.getStartTime());
      if (start !== null && !isNaN(start)) {
        return Number(start);
      }
    }
  } catch (startErr) {
  }
  return 0;
}

function prAI_resolveSourceOffsetRange(mediaStartSeconds, inPointSeconds, outPointSeconds, rangeMode) {
  var start = Number(mediaStartSeconds || 0);
  var requestedIn = inPointSeconds;
  var requestedOut = outPointSeconds;
  var mode = typeof rangeMode === "string" ? String(rangeMode).toLowerCase() : (rangeMode === true ? "offset" : "absolute");
  var usesEmbeddedTimecode = mode === "timecode" || mode === "embedded" || mode === "embeddedtimecode" || mode === "absolute-timecode";
  function resolvePoint(value) {
    if (value === undefined || value === null || value === "") {
      return value;
    }
    return Number(value) - (usesEmbeddedTimecode ? start : 0);
  }
  return {
    inPointSeconds: resolvePoint(requestedIn),
    outPointSeconds: resolvePoint(requestedOut),
    requestedInPointSeconds: requestedIn,
    requestedOutPointSeconds: requestedOut,
    mediaStartSeconds: start,
    sourceRangeMode: usesEmbeddedTimecode ? "timecode" : (mode || "offset"),
    sourceRangeResolved: true,
    clampedOutPointSeconds: false
  };
}

function prAI_normalizeProjectItemRange(item, action) {
  var rangeMode = String(action.sourceRangeMode || action.sourceTimeMode || "").toLowerCase();
  if (action.sourceRangeResolved === true) {
    rangeMode = "offset";
  } else if (action.sourceRangeIsEmbeddedTimecode === true) {
    rangeMode = "timecode";
  } else if (action.sourceRangeIsOffset === true || !rangeMode) {
    rangeMode = "offset";
  }
  return prAI_resolveSourceOffsetRange(prAI_projectItemMediaStartSeconds(item), action.inPointSeconds, action.outPointSeconds, rangeMode);
}

function prAI_applyProjectItemRange(item, action) {
  if (!item) {
    return { inPointSeconds: action.inPointSeconds, outPointSeconds: action.outPointSeconds, clampedOutPointSeconds: false };
  }
  var range = prAI_normalizeProjectItemRange(item, action);
  if (Number(range.inPointSeconds) < 0 || Number(range.outPointSeconds) <= Number(range.inPointSeconds)) {
    throw new Error("Invalid source range after timecode normalization: " + range.inPointSeconds + "-" + range.outPointSeconds + "s.");
  }
  try {
    if (action.inPointSeconds !== undefined && action.inPointSeconds !== null && action.inPointSeconds !== "" && item.setInPoint) {
      item.setInPoint(prAI_secondsToTicks(range.inPointSeconds), 4);
    }
  } catch (inErr) {
    try {
      item.setInPoint(prAI_secondsToTicks(range.inPointSeconds));
    } catch (ignoredInErr) {
    }
  }
  try {
    if (action.outPointSeconds !== undefined && action.outPointSeconds !== null && action.outPointSeconds !== "" && item.setOutPoint) {
      item.setOutPoint(prAI_secondsToTicks(range.outPointSeconds), 4);
    }
  } catch (outErr) {
    try {
      item.setOutPoint(prAI_secondsToTicks(range.outPointSeconds));
    } catch (ignoredOutErr) {
    }
  }
  var actualInPoint = null;
  var actualOutPoint = null;
  try {
    actualInPoint = item.getInPoint ? prAI_timeValueSeconds(item.getInPoint()) : null;
    actualOutPoint = item.getOutPoint ? prAI_timeValueSeconds(item.getOutPoint()) : null;
  } catch (verifyRangeErr) {
  }
  var requestedDuration = Number(range.outPointSeconds) - Number(range.inPointSeconds);
  if (requestedDuration > 0 && actualInPoint !== null && actualOutPoint !== null && Math.abs((actualOutPoint - actualInPoint) - requestedDuration) > 0.08) {
    throw new Error("Premiere rejected the requested source range " + Number(range.inPointSeconds).toFixed(3) + "-" + Number(range.outPointSeconds).toFixed(3) + "s; stopped before inserting an incorrectly long clip.");
  }
  action.inPointSeconds = range.inPointSeconds;
  action.outPointSeconds = range.outPointSeconds;
  action.requestedInPointSeconds = range.requestedInPointSeconds;
  action.requestedOutPointSeconds = range.requestedOutPointSeconds;
  action.mediaStartSeconds = range.mediaStartSeconds;
  action.sourceRangeMode = range.sourceRangeMode;
  action.sourceRangeResolved = range.sourceRangeResolved;
  action.clampedOutPointSeconds = range.clampedOutPointSeconds;
  return range;
}

function prAI_getClip(sequence, action) {
  var track = prAI_getTrack(sequence, action.trackType || "video", action.trackIndex || 0);
  var identityStart = prAI_actionIdentityStart(action);

  if (action.clipName && identityStart !== null) {
    var namedClip = prAI_findClipOnTrack(track, action, identityStart);
    if (namedClip) {
      return namedClip;
    }
  }

  if (action.clipIndex !== undefined && action.clipIndex !== null && action.clipIndex !== "") {
    var index = Number(action.clipIndex);
    if (index < 0 || index >= track.clips.numItems) {
      throw new Error("Clip index not found: " + index);
    }
    var indexedClip = track.clips[index];
    if (identityStart !== null && !prAI_clipMatchesIdentity(indexedClip, action, identityStart)) {
      var fallbackClip = prAI_findClipOnTrack(track, action, identityStart);
      if (fallbackClip) {
        return fallbackClip;
      }
      throw new Error("Clip index " + index + " no longer matches the requested clip identity.");
    }
    return indexedClip;
  }
  if (action.clipName) {
    var clip = prAI_findClipOnTrack(track, action, identityStart);
    if (clip) {
      return clip;
    }
    throw new Error("Clip not found by name: " + action.clipName);
  }
  throw new Error("Clip action needs clipIndex or clipName.");
}

function prAI_hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function prAI_actionIdentityStart(action) {
  if (prAI_hasValue(action.targetStartSeconds)) {
    return Number(action.targetStartSeconds);
  }
  if (prAI_hasValue(action.originalStartSeconds)) {
    return Number(action.originalStartSeconds);
  }
  if (prAI_hasValue(action.clipStartSeconds)) {
    return Number(action.clipStartSeconds);
  }
  var mutatesStart = action.type === "trimClip" || action.type === "rippleTrimClip" || action.type === "moveClip" || action.type === "slideClip";
  if (!mutatesStart && prAI_hasValue(action.startSeconds)) {
    return Number(action.startSeconds);
  }
  return null;
}

function prAI_clipMatchesIdentity(clip, action, identityStart) {
  if (action.clipName && clip.name !== action.clipName) {
    return false;
  }
  var projectItem = prAI_clipProjectItem(clip);
  if (action.projectItemId && (!projectItem || projectItem.nodeId !== action.projectItemId)) {
    return false;
  }
  if (action.projectItemName && (!projectItem || projectItem.name !== action.projectItemName)) {
    return false;
  }
  if (identityStart !== null) {
    var startSeconds = prAI_readTimeSeconds(clip, "start");
    if (startSeconds === null || Math.abs(startSeconds - Number(identityStart)) > 0.05) {
      return false;
    }
  }
  return true;
}

function prAI_findClipOnTrack(track, action, identityStart) {
  for (var i = 0; i < track.clips.numItems; i++) {
    if (prAI_clipMatchesIdentity(track.clips[i], action, identityStart)) {
      return track.clips[i];
    }
  }
  return null;
}

function prAI_setClipTime(clip, propertyName, seconds) {
  if (seconds === undefined || seconds === null || seconds === "") {
    return;
  }
  try {
    clip[propertyName] = prAI_timeFromSeconds(seconds);
  } catch (timeErr) {
    try {
      clip[propertyName] = prAI_secondsToTicks(seconds);
    } catch (ticksErr) {
      clip[propertyName] = Number(seconds);
    }
  }
}

function prAI_normalizeAction(action) {
  if (!action || !action.type) {
    return action;
  }
  if (action.trackIndex === undefined || action.trackIndex === null || action.trackIndex === "") {
    if (action.videoTrackIndex !== undefined && action.videoTrackIndex !== null && action.videoTrackIndex !== "") {
      action.trackIndex = action.videoTrackIndex;
    } else if (action.audioTrackIndex !== undefined && action.audioTrackIndex !== null && action.audioTrackIndex !== "") {
      action.trackIndex = action.audioTrackIndex;
    } else if (action.track !== undefined && action.track !== null && action.track !== "" && !/^A\s*\d+$/i.test(String(action.track))) {
      action.trackIndex = action.track;
    }
  }
  if (action.seconds === undefined && action.startSeconds !== undefined && (
    action.type === "insertProjectItem" ||
    action.type === "insertClipRange" ||
    action.type === "overwriteClipRange" ||
    action.type === "insertMogrt" ||
    action.type === "importMediaFile"
  )) {
    action.seconds = action.startSeconds;
  }
  if (action.inPointSeconds === undefined && action.in !== undefined) {
    action.inPointSeconds = action.in;
  }
  if (action.outPointSeconds === undefined && action.out !== undefined) {
    action.outPointSeconds = action.out;
  }
  if (!action.projectItemName && (action.sourceName || action.source)) {
    action.projectItemName = action.sourceName || action.source;
  }
  if (action.type === "muteAudioClip") {
    action.type = "setClipEnabled";
    action.trackType = "audio";
    action.enabled = false;
    return action;
  }
  if (action.type !== "audio") {
    return action;
  }

  var operation = String(action.operation || action.action || action.command || "").toLowerCase();
  action.trackType = "audio";
  if (operation.indexOf("gain") !== -1 || operation.indexOf("volume") !== -1 || action.gainDb !== undefined || action.levelDb !== undefined) {
    action.type = "setAudioGain";
    action.gainDb = action.gainDb !== undefined ? action.gainDb : action.levelDb;
  } else if (operation.indexOf("mute") !== -1 || operation.indexOf("disable") !== -1 || action.mute === true) {
    action.type = "setClipEnabled";
    action.enabled = false;
  } else if (operation.indexOf("delete") !== -1 || operation.indexOf("remove") !== -1) {
    action.type = "deleteClip";
  } else if (operation.indexOf("trim") !== -1) {
    action.type = "trimClip";
  } else if (operation.indexOf("split") !== -1 || operation.indexOf("razor") !== -1) {
    action.type = "splitClip";
  } else {
    action.type = "moveClip";
  }
  return action;
}

function prAI_isProjectItemDeleteAction(action) {
  var type = String(action && action.type ? action.type : "").toLowerCase();
  return type === "deleteprojectitem" || type === "removeprojectitem" || type === "deletebin" || type === "removebin" || type === "deletemediafile";
}

function prAI_requireSequence() {
  var sequence = prAI_currentTargetSequenceId ? prAI_findSequenceById(prAI_currentTargetSequenceId) : null;
  if (!sequence) {
    sequence = prAI_resolveActiveSequence(true);
  }
  if (!sequence) {
    throw new Error("No active sequence.");
  }
  prAI_lastSequenceId = sequence.sequenceID || prAI_lastSequenceId;
  return sequence;
}

function prAI_audioLevelProperty(clip) {
  try {
    for (var c = 0; c < clip.components.numItems; c++) {
      var component = clip.components[c];
      if (String(component.displayName).toLowerCase().indexOf("volume") !== -1) {
        for (var p = 0; p < component.properties.numItems; p++) {
          var property = component.properties[p];
          var name = String(property.displayName).toLowerCase();
          if (name.indexOf("level") !== -1 || name.indexOf("volume") !== -1) {
            return property;
          }
        }
      }
    }
  } catch (err) {
  }
  return null;
}

function prAI_readAudioGain(clip) {
  var property = prAI_audioLevelProperty(clip);
  if (!property) {
    return null;
  }
  try {
    return property.getValue();
  } catch (err) {
  }
  return null;
}

function prAI_setAudioGain(action) {
  action.trackType = "audio";
  var sequence = prAI_requireSequence();
  var clip = prAI_getClip(sequence, action);
  var property = prAI_audioLevelProperty(clip);
  if (!property || !property.setValue) {
    throw new Error("Audio gain property not found for clip: " + clip.name);
  }
  var gain = Number(action.gainDb !== undefined ? action.gainDb : action.levelDb);
  if (isNaN(gain)) {
    throw new Error("setAudioGain needs gainDb.");
  }
  property.setValue(gain, true);
  return {
    type: "setAudioGain",
    trackType: "audio",
    trackIndex: Number(action.trackIndex || 0),
    clipIndex: action.clipIndex,
    clipName: clip.name,
    gainDb: gain
  };
}

function prAI_createSubtitleLayer(action) {
  var sequence = prAI_requireSequence();
  var items = action.items || action.captions || action.subtitles || [];
  if (!items.length && action.text) {
    items = [{ text: action.text, startSeconds: action.startSeconds || 0, endSeconds: action.endSeconds || 3 }];
  }
  if (!items.length) {
    throw new Error("addSubtitleLayer needs items with text, startSeconds, and endSeconds.");
  }

  for (var i = 0; i < items.length; i++) {
    if (items[i].endSeconds === undefined || Number(items[i].endSeconds) <= Number(items[i].startSeconds)) {
      throw new Error("Subtitle item " + i + " needs endSeconds after startSeconds.");
    }
  }

  var name = prAI_safeFileName(action.name || "PR_AI_Subtitles_" + (new Date()).getTime());
  var file = new File(prAI_tempFolder(action).fsName + "/" + name + ".srt");
  file.encoding = "UTF-8";
  file.lineFeed = "Windows";
  if (!file.open("w")) {
    throw new Error("Could not create SRT file.");
  }
  file.write(prAI_buildSrt(items));
  file.close();

  var importOk = false;
  try {
    importOk = app.project.importFiles([file.fsName], action.suppressUI !== false, app.project.rootItem, false);
  } catch (importErr) {
    throw new Error(prAI_fileDiagnosticError("Premiere threw while importing generated SRT file:", file.fsName, action) + " | premiereError: " + importErr.toString());
  }
  if (!importOk) {
    throw new Error(prAI_fileDiagnosticError("Premiere returned false while importing generated SRT file:", file.fsName, action));
  }

  var captionItem = prAI_findProjectItemByMediaPath(app.project.rootItem, file.fsName);
  if (!captionItem) {
    captionItem = prAI_findProjectItemByName(app.project.rootItem, file.name);
  }
  if (!captionItem) {
    throw new Error(prAI_fileDiagnosticError("Imported SRT project item was not found for:", file.fsName, action));
  }

  var captionFormat = typeof Sequence !== "undefined" && Sequence.CAPTION_FORMAT_SUBTITLE ? Sequence.CAPTION_FORMAT_SUBTITLE : 0;
  if (typeof Sequence !== "undefined" && action.captionFormat && Sequence["CAPTION_FORMAT_" + action.captionFormat]) {
    captionFormat = Sequence["CAPTION_FORMAT_" + action.captionFormat];
  }
  var startAtTime = Number(action.startAtTime || 0);
  if (!sequence.createCaptionTrack) {
    return {
      type: action.type,
      name: action.name || name,
      srtPath: file.fsName,
      projectItemName: captionItem.name,
      projectItemId: captionItem.nodeId || "",
      itemCount: items.length,
      startAtTime: startAtTime,
      importedOnly: true,
      warning: "Premiere did not expose sequence.createCaptionTrack; imported the SRT file into the project instead."
    };
  }
  var created = sequence.createCaptionTrack(captionItem, startAtTime, captionFormat);
  if (!created) {
    return {
      type: action.type,
      name: action.name || name,
      srtPath: file.fsName,
      projectItemName: captionItem.name,
      projectItemId: captionItem.nodeId || "",
      itemCount: items.length,
      startAtTime: startAtTime,
      importedOnly: true,
      warning: "Premiere imported the SRT file, but did not create a caption track through CEP."
    };
  }

  var captionItemCleanup = prAI_removeImportedCaptionProjectItem(captionItem, action);
  if (action.deleteSrtAfterImport === true) {
    prAI_deleteTempFile({ filePath: file.fsName });
  }

  return {
    type: action.type,
    name: action.name || name,
    srtPath: file.fsName,
    itemCount: items.length,
    startAtTime: startAtTime,
    projectItemRemoved: captionItemCleanup.removed,
    projectItemCleanupError: captionItemCleanup.error,
    cleanupAfterImport: action.deleteSrtAfterImport === true
  };
}

function prAI_removeImportedCaptionProjectItem(captionItem, action) {
  if (!captionItem || action.removeProjectItemAfterCaptionTrack !== true) {
    return { removed: false, error: "" };
  }
  try {
    if (typeof captionItem.deleteBin !== "function") {
      return { removed: false, error: "Premiere did not expose ProjectItem.deleteBin for the imported SRT." };
    }
    captionItem.deleteBin();
    return { removed: true, error: "" };
  } catch (err) {
    return { removed: false, error: err.toString() };
  }
}

function prAI_createCaptionTrackFromFile(action) {
  var sequence = prAI_requireSequence();
  var filePath = action.filePath || "";
  var wroteTemp = false;
  var parsedItems = [];
  var normalizeSrt = action.normalize !== false;

  if (!filePath) {
    var contents = String(action.contents || action.text || "");
    if (!contents) {
      throw new Error(action.type + " needs filePath or contents.");
    }
    parsedItems = prAI_parseSrt(contents, action.offsetSeconds);
    if (!parsedItems.length) {
      throw new Error("No valid SRT caption items found.");
    }
    var writeResult = prAI_writeTempTextFile({
      extension: "srt",
      suggestedName: prAI_autoEditSrtFileName(action),
      contents: prAI_buildSrt(parsedItems)
    });
    filePath = writeResult.filePath;
    wroteTemp = true;
  } else {
    var sourceFile = new File(filePath);
    if (!sourceFile.exists) {
      throw new Error(prAI_fileDiagnosticError("Caption file not found:", filePath, action));
    }
    parsedItems = prAI_parseSrt(prAI_readTextFile(filePath), action.offsetSeconds);
    if (!parsedItems.length) {
      throw new Error("No valid SRT caption items found.");
    }
    if (normalizeSrt || (action.offsetSeconds !== undefined && action.offsetSeconds !== null && action.offsetSeconds !== "")) {
      var offsetWrite = prAI_writeTempTextFile({
        extension: "srt",
        suggestedName: prAI_autoEditSrtFileName(action),
        contents: prAI_buildSrt(parsedItems)
      });
      filePath = offsetWrite.filePath;
      wroteTemp = true;
    }
  }

  var file = new File(filePath);
  if (!file.exists) {
    throw new Error(prAI_fileDiagnosticError("Caption file not found:", filePath, action));
  }

  var suppressUI = action.suppressUI !== false;
  var importOk = false;
  try {
    importOk = app.project.importFiles([file.fsName], suppressUI, app.project.rootItem, false);
  } catch (importErr) {
    throw new Error(prAI_fileDiagnosticError("Premiere threw while importing caption file:", file.fsName, action) + " | suppressUI: " + suppressUI + " | premiereError: " + importErr.toString());
  }
  if (!importOk) {
    throw new Error(prAI_fileDiagnosticError("Premiere returned false while importing caption file:", file.fsName, action) + " | suppressUI: " + suppressUI);
  }

  var captionItem = prAI_findProjectItemByMediaPath(app.project.rootItem, file.fsName) || prAI_findProjectItemByName(app.project.rootItem, file.name);
  if (!captionItem) {
    throw new Error(prAI_fileDiagnosticError("Imported caption project item was not found for:", file.fsName, action));
  }

  if (action.createCaptionTrack !== true) {
    if (wroteTemp && action.deleteSrtAfterImport === true) {
      prAI_deleteTempFile({ filePath: file.fsName });
    }
    return {
      type: action.type,
      filePath: file.fsName,
      projectItemName: captionItem.name,
      projectItemId: captionItem.nodeId || "",
      itemCount: parsedItems.length,
      startAtTime: Number(action.startAtTime || 0),
      offsetSeconds: Number(action.offsetSeconds || 0),
      importedOnly: true,
      cleanupAfterImport: wroteTemp && action.deleteSrtAfterImport === true
    };
  }

  var captionFormat = typeof Sequence !== "undefined" && Sequence.CAPTION_FORMAT_SUBTITLE ? Sequence.CAPTION_FORMAT_SUBTITLE : 0;
  if (typeof Sequence !== "undefined" && action.captionFormat && Sequence["CAPTION_FORMAT_" + action.captionFormat]) {
    captionFormat = Sequence["CAPTION_FORMAT_" + action.captionFormat];
  }
  var startAtTime = Number(action.startAtTime || 0);
  if (!sequence.createCaptionTrack) {
    throw new Error("Premiere did not expose sequence.createCaptionTrack. Re-run importSrtFile without createCaptionTrack to use native import only.");
  }
  var created = sequence.createCaptionTrack(captionItem, startAtTime, captionFormat);
  if (!created) {
    throw new Error("Premiere did not create the caption track from the imported caption file.");
  }

  var captionItemName = captionItem.name;
  var captionItemId = captionItem.nodeId || "";
  var captionItemCleanup = prAI_removeImportedCaptionProjectItem(captionItem, action);

  if (wroteTemp && action.deleteSrtAfterImport === true) {
    prAI_deleteTempFile({ filePath: file.fsName });
  }

  return {
    type: action.type,
    filePath: file.fsName,
    projectItemName: captionItemName,
    projectItemId: captionItemId,
    itemCount: parsedItems.length,
    startAtTime: startAtTime,
    offsetSeconds: Number(action.offsetSeconds || 0),
    cleanupAfterImport: wroteTemp && action.deleteSrtAfterImport === true,
    projectItemRemoved: captionItemCleanup.removed,
    projectItemCleanupError: captionItemCleanup.error
  };
}

function prAI_clipUndoIdentity(action, clip) {
  return {
    trackType: action.trackType || "video",
    trackIndex: Number(action.trackIndex || 0),
    clipIndex: action.clipIndex,
    clipName: clip.name,
    startSeconds: prAI_readTimeSeconds(clip, "start")
  };
}

function prAI_clipProjectItemName(clip) {
  try {
    if (clip.projectItem && clip.projectItem.name) {
      return clip.projectItem.name;
    }
  } catch (err) {
  }
  return clip.name;
}

function prAI_insertProjectItemWithMode(sequence, action, overwrite) {
  var insertItem = prAI_findProjectItem(app.project.rootItem, action);
  if (!insertItem) {
    throw new Error("Project item not found for insert: " + (action.projectItemId || action.projectItemName || action.sourcePath || ""));
  }
  var appliedRange = prAI_applyProjectItemRange(insertItem, action);
  var insertTrack = prAI_getTrack(sequence, action.trackType || "video", action.trackIndex || 0);
  var insertTime = prAI_timeFromSeconds(action.seconds || 0);

  if (overwrite && insertTrack.overwriteClip) {
    insertTrack.overwriteClip(insertItem, insertTime);
  } else {
    insertTrack.insertClip(insertItem, insertTime);
  }

  return {
    type: overwrite ? "overwriteClipRange" : "insertProjectItem",
    projectItemName: insertItem.name,
    projectItemId: insertItem.nodeId || "",
    sourcePath: prAI_projectItemMediaPath(insertItem),
    trackType: action.trackType || "video",
    trackIndex: Number(action.trackIndex || 0),
    seconds: Number(action.seconds || 0),
    inPointSeconds: appliedRange.inPointSeconds,
    outPointSeconds: appliedRange.outPointSeconds,
    requestedInPointSeconds: appliedRange.requestedInPointSeconds,
    requestedOutPointSeconds: appliedRange.requestedOutPointSeconds,
    mediaStartSeconds: appliedRange.mediaStartSeconds,
    sourceRangeMode: appliedRange.sourceRangeMode,
    clampedOutPointSeconds: appliedRange.clampedOutPointSeconds === true,
    linked: action.linked === true
  };
}

function prAI_assembleFromScript(action) {
  var sequence = prAI_requireSequence();
  var clips = action.clips || action.items || [];
  if (!clips.length) {
    throw new Error("assembleFromScript needs clips.");
  }

  var trackType = action.trackType || "video";
  var trackIndex = Number(action.trackIndex || 0);
  var cursor = Number(action.startSeconds || 0);
  var overwrite = action.overwrite !== false;
  var assembled = [];
  var skipped = [];
  var skipInvalid = action.skipMissing === true || action.skipInvalid === true || action.continueOnError === true || action.ignoreMissing === true || action.ignoreInvalid === true;
  var preserveSkippedGaps = action.preserveSkippedGaps !== false && action.collapseSkippedGaps !== true;

  for (var i = 0; i < clips.length; i++) {
    var clipPlan = clips[i];
    var inPoint = clipPlan.inPointSeconds;
    if (inPoint === undefined) {
      inPoint = clipPlan.in;
    }
    var outPoint = clipPlan.outPointSeconds;
    if (outPoint === undefined) {
      outPoint = clipPlan.out;
    }
    if (inPoint === undefined || outPoint === undefined || Number(outPoint) <= Number(inPoint)) {
      if (skipInvalid) {
        var invalidDuration = Number(clipPlan.durationSeconds || clipPlan.duration || 0);
        skipped.push({
          index: i,
          source: clipPlan.projectItemName || clipPlan.source || clipPlan.sourceName || clipPlan.sourcePath || "",
          reason: "Invalid in/out.",
          startSeconds: cursor,
          endSeconds: invalidDuration > 0 ? cursor + invalidDuration : cursor,
          durationSeconds: invalidDuration > 0 ? invalidDuration : 0
        });
        if (preserveSkippedGaps && invalidDuration > 0) {
          cursor += invalidDuration;
        }
        continue;
      }
      throw new Error("assembleFromScript clip " + i + " needs valid in/out.");
    }
    var plannedDuration = Number(outPoint) - Number(inPoint);

    var insertAction = {
      type: overwrite ? "overwriteClipRange" : "insertClipRange",
      projectItemId: clipPlan.projectItemId || action.projectItemId,
      projectItemName: clipPlan.projectItemName || clipPlan.source || clipPlan.sourceName || action.projectItemName,
      sourcePath: clipPlan.sourcePath || action.sourcePath,
      trackType: clipPlan.trackType || trackType,
      trackIndex: clipPlan.trackIndex !== undefined ? clipPlan.trackIndex : trackIndex,
      seconds: cursor,
      inPointSeconds: Number(inPoint),
      outPointSeconds: Number(outPoint),
      sourceRangeMode: clipPlan.sourceRangeMode || action.sourceRangeMode || "offset",
      sourceRangeIsOffset: clipPlan.sourceRangeIsOffset !== undefined ? clipPlan.sourceRangeIsOffset : action.sourceRangeIsOffset,
      linked: clipPlan.linked !== undefined ? clipPlan.linked : action.linked
    };

    try {
      var inserted = prAI_insertProjectItemWithMode(sequence, insertAction, overwrite);
      assembled.push(inserted);
      cursor += plannedDuration;
    } catch (insertErr) {
      if (!skipInvalid) {
        throw insertErr;
      }
      skipped.push({
        index: i,
        source: insertAction.projectItemName || insertAction.projectItemId || insertAction.sourcePath || "",
        reason: String(insertErr).replace(/^Error:\s*/i, ""),
        startSeconds: cursor,
        endSeconds: cursor + plannedDuration,
        durationSeconds: plannedDuration
      });
      if (preserveSkippedGaps) {
        cursor += plannedDuration;
      }
    }
  }

  return {
    type: "assembleFromScript",
    trackType: trackType,
    trackIndex: trackIndex,
    startSeconds: Number(action.startSeconds || 0),
    endSeconds: cursor,
    overwrite: overwrite,
    linked: action.linked === true,
    preserveSkippedGaps: preserveSkippedGaps,
    clipCount: assembled.length,
    skippedCount: skipped.length,
    skipped: skipped,
    clips: assembled
  };
}

function prAI_trackTargets(sequence, action) {
  var targets = [];
  var trackType = action.trackType || "video";
  if (trackType === "both") {
    targets.push({ trackType: "video", trackIndex: Number(action.videoTrackIndex || 0), track: prAI_getTrack(sequence, "video", action.videoTrackIndex || 0) });
    if (action.linked !== true) {
      targets.push({ trackType: "audio", trackIndex: Number(action.audioTrackIndex || 0), track: prAI_getTrack(sequence, "audio", action.audioTrackIndex || 0) });
    }
  } else {
    targets.push({ trackType: trackType, trackIndex: Number(action.trackIndex || 0), track: prAI_getTrack(sequence, trackType, action.trackIndex || 0) });
  }
  return targets;
}

function prAI_clipInDeleteRange(clip, action) {
  var clipStart = prAI_readTimeSeconds(clip, "start");
  var clipEnd = prAI_readTimeSeconds(clip, "end");
  var hasStart = action.startSeconds !== undefined && action.startSeconds !== null && action.startSeconds !== "";
  var hasEnd = action.endSeconds !== undefined && action.endSeconds !== null && action.endSeconds !== "";
  var rangeStart = hasStart ? Number(action.startSeconds) : null;
  var rangeEnd = hasEnd ? Number(action.endSeconds) : null;
  var mode = action.mode || "startWithin";

  if (mode === "overlap") {
    var startsBeforeEnd = !hasEnd || clipStart < rangeEnd - 0.02;
    var endsAfterStart = !hasStart || clipEnd > rangeStart + 0.02;
    return startsBeforeEnd && endsAfterStart;
  }

  if (hasStart && clipStart < rangeStart - 0.02) {
    return false;
  }
  if (hasEnd && clipStart >= rangeEnd - 0.02) {
    return false;
  }
  return true;
}

function prAI_deleteTrackRange(action) {
  var sequence = prAI_requireSequence();
  var targets = prAI_trackTargets(sequence, action);
  var deleted = [];
  var isClear = action.type === "clearTrack";

  for (var t = 0; t < targets.length; t++) {
    var target = targets[t];
    for (var i = target.track.clips.numItems - 1; i >= 0; i--) {
      var clip = target.track.clips[i];
      if (!isClear && !prAI_clipInDeleteRange(clip, action)) {
        continue;
      }
      deleted.push({
        trackType: target.trackType,
        trackIndex: target.trackIndex,
        clipName: clip.name,
        startSeconds: prAI_readTimeSeconds(clip, "start"),
        endSeconds: prAI_readTimeSeconds(clip, "end")
      });
      clip.remove(action.ripple === true, action.linked === true);
    }
  }

  return {
    type: action.type,
    trackType: action.trackType || "video",
    trackIndex: action.trackIndex,
    videoTrackIndex: action.videoTrackIndex,
    audioTrackIndex: action.audioTrackIndex,
    startSeconds: action.startSeconds,
    endSeconds: action.endSeconds,
    mode: action.mode || "startWithin",
    ripple: action.ripple === true,
    linked: action.linked === true,
    deletedCount: deleted.length,
    deleted: deleted
  };
}

function prAI_splitClip(action) {
  var sequence = prAI_requireSequence();
  var clip = prAI_getClip(sequence, action);
  var splitAt = Number(action.seconds);
  var clipStart = prAI_readTimeSeconds(clip, "start");
  var clipEnd = prAI_readTimeSeconds(clip, "end");
  var sourceIn = prAI_readTimeSeconds(clip, "inPoint");
  var sourceOut = prAI_readTimeSeconds(clip, "outPoint");
  var sourceItem = prAI_clipProjectItem(clip);

  if (!sourceItem) {
    throw new Error("Cannot split: clip does not expose a source project item.");
  }
  if (splitAt <= clipStart || splitAt >= clipEnd) {
    throw new Error("Cannot split outside clip bounds.");
  }

  var sourceSplit = sourceIn + (splitAt - clipStart);
  prAI_setClipTime(clip, "end", splitAt);
  prAI_setClipTime(clip, "outPoint", sourceSplit);
  prAI_applyProjectItemRange(sourceItem, { inPointSeconds: sourceSplit, outPointSeconds: sourceOut });
  var track = prAI_getTrack(sequence, action.trackType || "video", action.trackIndex || 0);
  track.insertClip(sourceItem, prAI_timeFromSeconds(splitAt));

  return {
    type: "splitClip",
    trackType: action.trackType || "video",
    trackIndex: Number(action.trackIndex || 0),
    clipIndex: action.clipIndex,
    clipName: clip.name,
    seconds: splitAt,
    sourceInPointSeconds: sourceIn,
    sourceSplitSeconds: sourceSplit,
    sourceOutPointSeconds: sourceOut,
    linked: action.linked === true
  };
}

function prAI_splitTrackAtTimes(action) {
  var sequence = prAI_requireSequence();
  var trackType = action.trackType || "audio";
  var trackIndex = Number(action.trackIndex || 0);
  var track = prAI_getTrack(sequence, trackType, trackIndex);
  var rawTimes = action.times || action.seconds || action.atSeconds || [];
  if (!(rawTimes instanceof Array)) {
    rawTimes = [rawTimes];
  }
  var epsilon = Number(action.epsilonSeconds || 0.01);
  var normalized = [];
  for (var i = 0; i < rawTimes.length; i++) {
    var time = Number(rawTimes[i]);
    if (!isFinite(time)) {
      continue;
    }
    var duplicate = false;
    for (var d = 0; d < normalized.length; d++) {
      if (Math.abs(normalized[d] - time) <= epsilon) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      normalized.push(time);
    }
  }
  normalized.sort(function (a, b) { return b - a; });

  if (action.method !== "rebuild" && action.rebuildSplit !== true) {
    var razorResult = prAI_razorTrackAtTimes(sequence, track, trackType, trackIndex, normalized, epsilon);
    if (action.requireAllSplits === true && razorResult.skippedCount) {
      throw new Error("Could not add every requested " + trackType + " cut; " + razorResult.skippedCount + " boundary/boundaries failed.");
    }
    return razorResult;
  }

  var split = [];
  var skipped = [];
  for (var t = 0; t < normalized.length; t++) {
    var splitAt = normalized[t];
    var targetClip = null;
    var clipIndex = -1;
    for (var c = 0; c < track.clips.numItems; c++) {
      var candidate = track.clips[c];
      var start = prAI_readTimeSeconds(candidate, "start");
      var end = prAI_readTimeSeconds(candidate, "end");
      if (splitAt > start + epsilon && splitAt < end - epsilon) {
        targetClip = candidate;
        clipIndex = c;
        break;
      }
    }
    if (!targetClip) {
      skipped.push({ seconds: splitAt, reason: "No clip crossing this boundary." });
      continue;
    }

    var sourceItem = prAI_clipProjectItem(targetClip);
    if (!sourceItem) {
      skipped.push({ seconds: splitAt, reason: "Clip has no source project item." });
      continue;
    }
    var clipStart = prAI_readTimeSeconds(targetClip, "start");
    var sourceIn = prAI_readTimeSeconds(targetClip, "inPoint");
    var sourceOut = prAI_readTimeSeconds(targetClip, "outPoint");
    var sourceSplit = sourceIn + (splitAt - clipStart);
    prAI_setClipTime(targetClip, "end", splitAt);
    prAI_setClipTime(targetClip, "outPoint", sourceSplit);
    prAI_applyProjectItemRange(sourceItem, { inPointSeconds: sourceSplit, outPointSeconds: sourceOut });
    track.insertClip(sourceItem, prAI_timeFromSeconds(splitAt));
    split.push({
      seconds: splitAt,
      clipIndex: clipIndex,
      clipName: targetClip.name,
      sourceSplitSeconds: sourceSplit
    });
  }

  var splitResult = {
    type: "splitTrackAtTimes",
    trackType: trackType,
    trackIndex: trackIndex,
    requestedCount: normalized.length,
    splitCount: split.length,
    skippedCount: skipped.length,
    split: split,
    skipped: skipped
  };
  if (action.requireAllSplits === true && splitResult.skippedCount) {
    throw new Error("Could not add every requested " + trackType + " cut; " + splitResult.skippedCount + " boundary/boundaries failed.");
  }
  return splitResult;
}

function prAI_sequenceFrameRate(sequence) {
  try {
    var frameDuration = prAI_ticksToSeconds(sequence.timebase);
    if (frameDuration > 0) {
      return Math.round(1 / frameDuration);
    }
  } catch (err) {
  }
  return 30;
}

function prAI_timecodeFromSeconds(sequence, seconds) {
  var fps = prAI_sequenceFrameRate(sequence);
  var totalFrames = Math.max(0, Math.round(Number(seconds) * fps));
  var frames = totalFrames % fps;
  var totalSeconds = Math.floor(totalFrames / fps);
  var s = totalSeconds % 60;
  var totalMinutes = Math.floor(totalSeconds / 60);
  var m = totalMinutes % 60;
  var h = Math.floor(totalMinutes / 60);
  return prAI_pad2(h) + ":" + prAI_pad2(m) + ":" + prAI_pad2(s) + ":" + prAI_pad2(frames);
}

function prAI_qeTimecodeForSeconds(sequence, qeSequence, seconds) {
  try {
    if (sequence.setPlayerPosition && qeSequence && qeSequence.CTI) {
      sequence.setPlayerPosition(prAI_secondsToTicks(seconds));
      if (qeSequence.CTI.timecode) {
        return qeSequence.CTI.timecode;
      }
    }
  } catch (err) {
  }
  return prAI_timecodeFromSeconds(sequence, seconds);
}

function prAI_razorTrackAtTimes(sequence, track, trackType, trackIndex, normalized, epsilon) {
  if (typeof app === "undefined" || !app.enableQE) {
    throw new Error("Premiere QE razor API is not available; refusing rebuild split because it can move audio clips.");
  }
  app.enableQE();
  if (typeof qe === "undefined" || !qe.project) {
    throw new Error("Premiere QE razor API did not initialize; refusing rebuild split because it can move audio clips.");
  }
  try {
    var activeSequence = app.project.activeSequence;
    if (sequence && sequence.sequenceID && activeSequence && activeSequence.sequenceID !== sequence.sequenceID && app.project.openSequence) {
      app.project.openSequence(sequence.sequenceID);
    }
  } catch (activeErr) {
  }
  var qeSequence = qe.project.getActiveSequence();
  if (!qeSequence) {
    throw new Error("QE active sequence was not found; open the target sequence and try again.");
  }
  var qeTrack = trackType === "audio" ? qeSequence.getAudioTrackAt(trackIndex) : qeSequence.getVideoTrackAt(trackIndex);
  if (!qeTrack || !qeTrack.razor) {
    throw new Error("QE razor is not available for " + trackType + " track " + trackIndex + ".");
  }

  var split = [];
  var skipped = [];
  for (var t = 0; t < normalized.length; t++) {
    var splitAt = normalized[t];
    var crossing = false;
    for (var c = 0; c < track.clips.numItems; c++) {
      var candidate = track.clips[c];
      var start = prAI_readTimeSeconds(candidate, "start");
      var end = prAI_readTimeSeconds(candidate, "end");
      if (splitAt > start + epsilon && splitAt < end - epsilon) {
        crossing = true;
        break;
      }
    }
    if (!crossing) {
      skipped.push({ seconds: splitAt, reason: "No clip crossing this boundary." });
      continue;
    }
    var timecode = prAI_qeTimecodeForSeconds(sequence, qeSequence, splitAt);
    try {
      qeTrack.razor(timecode);
      split.push({ seconds: splitAt, timecode: timecode, method: "qeRazor" });
    } catch (razorErr) {
      skipped.push({ seconds: splitAt, timecode: timecode, reason: "QE razor failed: " + razorErr.toString() });
    }
  }

  return {
    type: "splitTrackAtTimes",
    trackType: trackType,
    trackIndex: trackIndex,
    method: "qeRazor",
    requestedCount: normalized.length,
    splitCount: split.length,
    skippedCount: skipped.length,
    split: split,
    skipped: skipped
  };
}

function prAI_duplicateClip(action) {
  var sequence = prAI_requireSequence();
  var clip = prAI_getClip(sequence, action);
  var item = prAI_clipProjectItem(clip);
  if (!item) {
    throw new Error("Cannot duplicate clip without source project item.");
  }
  var start = prAI_readTimeSeconds(clip, "start");
  var end = prAI_readTimeSeconds(clip, "end");
  var inPoint = prAI_readTimeSeconds(clip, "inPoint");
  var outPoint = prAI_readTimeSeconds(clip, "outPoint");
  var seconds = action.seconds !== undefined ? Number(action.seconds) : (end + Number(action.offsetSeconds || 0));
  prAI_applyProjectItemRange(item, { inPointSeconds: inPoint, outPointSeconds: outPoint });
  var track = prAI_getTrack(sequence, action.trackType || "video", action.trackIndex || 0);
  track.insertClip(item, prAI_timeFromSeconds(seconds));
  return {
    type: "duplicateClip",
    trackType: action.trackType || "video",
    trackIndex: Number(action.trackIndex || 0),
    clipName: clip.name,
    seconds: seconds,
    inPointSeconds: inPoint,
    outPointSeconds: outPoint
  };
}

function prAI_slipClip(action) {
  var clip = prAI_getClip(prAI_requireSequence(), action);
  var inPoint = prAI_readTimeSeconds(clip, "inPoint");
  var outPoint = prAI_readTimeSeconds(clip, "outPoint");
  var delta = Number(action.deltaSeconds || 0);
  var newIn = action.inPointSeconds !== undefined ? Number(action.inPointSeconds) : inPoint + delta;
  var newOut = action.outPointSeconds !== undefined ? Number(action.outPointSeconds) : outPoint + delta;
  if (newOut <= newIn) {
    throw new Error("slipClip needs source out after source in.");
  }
  prAI_setClipTime(clip, "inPoint", newIn);
  prAI_setClipTime(clip, "outPoint", newOut);
  return { type: "slipClip", trackType: action.trackType || "video", trackIndex: Number(action.trackIndex || 0), clipIndex: action.clipIndex, clipName: clip.name, inPointSeconds: newIn, outPointSeconds: newOut };
}

function prAI_slideClip(action) {
  var clip = prAI_getClip(prAI_requireSequence(), action);
  var delta = Number(action.deltaSeconds || 0);
  var start = prAI_readTimeSeconds(clip, "start");
  var end = prAI_readTimeSeconds(clip, "end");
  prAI_setClipTime(clip, "start", start + delta);
  prAI_setClipTime(clip, "end", end + delta);
  return { type: "slideClip", trackType: action.trackType || "video", trackIndex: Number(action.trackIndex || 0), clipIndex: action.clipIndex, clipName: clip.name, deltaSeconds: delta };
}

function prAI_setClipDuration(action) {
  var clip = prAI_getClip(prAI_requireSequence(), action);
  var start = prAI_readTimeSeconds(clip, "start");
  var duration = Number(action.durationSeconds);
  if (isNaN(duration) || duration <= 0) {
    throw new Error("setClipDuration needs positive durationSeconds.");
  }
  prAI_setClipTime(clip, "end", start + duration);
  return { type: "setClipDuration", trackType: action.trackType || "video", trackIndex: Number(action.trackIndex || 0), clipIndex: action.clipIndex, clipName: clip.name, durationSeconds: duration };
}

function prAI_replaceClipRange(action) {
  var sequence = prAI_requireSequence();
  var oldClip = prAI_getClip(sequence, action);
  var oldStart = prAI_readTimeSeconds(oldClip, "start");
  var oldEnd = prAI_readTimeSeconds(oldClip, "end");
  var trackType = action.trackType || "video";
  var trackIndex = Number(action.trackIndex || 0);
  oldClip.remove(false, true);
  var insertAction = {
    type: "overwriteClipRange",
    projectItemId: action.projectItemId,
    projectItemName: action.projectItemName,
    sourcePath: action.sourcePath,
    trackType: trackType,
    trackIndex: trackIndex,
    seconds: oldStart,
    inPointSeconds: action.inPointSeconds,
    outPointSeconds: action.outPointSeconds
  };
  var result = prAI_insertProjectItemWithMode(sequence, insertAction, true);
  result.type = "replaceClipRange";
  result.replacedStartSeconds = oldStart;
  result.replacedEndSeconds = oldEnd;
  return result;
}

function prAI_findProjectItemByPath(root, pathText) {
  if (!root) {
    return null;
  }
  var children = prAI_projectItemChildren(root);
  var childCount = prAI_collectionCount(children);
  for (var i = 0; i < childCount; i++) {
    var item = prAI_collectionItem(children, i);
    if (!item) {
      continue;
    }
    if (prAI_projectItemPath(item) === pathText || item.name === pathText) {
      return item;
    }
    if (prAI_collectionCount(prAI_projectItemChildren(item))) {
      var found = prAI_findProjectItemByPath(item, pathText);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function prAI_createBin(action) {
  var parent = app.project.rootItem;
  if (action.parentPath) {
    var foundParent = prAI_findProjectItemByPath(app.project.rootItem, action.parentPath);
    if (foundParent && foundParent.children) {
      parent = foundParent;
    }
  }
  if (!parent.createBin) {
    throw new Error("Parent item cannot create bins.");
  }
  var bin = parent.createBin(action.name || "AI Bin");
  return { type: "createBin", name: bin ? bin.name : (action.name || "AI Bin"), parentPath: prAI_projectItemPath(parent) };
}

function prAI_renameBin(action) {
  var bin = prAI_findProjectItemByPath(app.project.rootItem, action.from || action.name);
  if (!bin) {
    throw new Error("Bin not found: " + (action.from || action.name));
  }
  bin.name = action.to;
  return { type: "renameBin", from: action.from || action.name, to: action.to };
}

function prAI_moveProjectItemToBin(action) {
  var item = prAI_findProjectItem(app.project.rootItem, action);
  var bin = prAI_findProjectItemByPath(app.project.rootItem, action.binPath || action.binName);
  if (!item) {
    throw new Error("Project item not found.");
  }
  if (!bin || !bin.children) {
    throw new Error("Target bin not found.");
  }
  if (!item.moveBin) {
    throw new Error("moveProjectItemToBin is not exposed by this Premiere version.");
  }
  item.moveBin(bin);
  return { type: "moveProjectItemToBin", projectItemName: item.name, binName: bin.name };
}

function prAI_setProjectItemLabel(action) {
  var item = prAI_findProjectItem(app.project.rootItem, action);
  if (!item) {
    throw new Error("Project item not found.");
  }
  if (item.setColorLabel) {
    item.setColorLabel(Number(action.labelIndex || 0));
  } else {
    item.label = Number(action.labelIndex || 0);
  }
  return { type: "setProjectItemLabel", projectItemName: item.name, labelIndex: Number(action.labelIndex || 0) };
}

function prAI_setProjectItemInOut(action) {
  var item = prAI_findProjectItem(app.project.rootItem, action);
  if (!item) {
    throw new Error("Project item not found.");
  }
  prAI_applyProjectItemRange(item, action);
  return { type: "setProjectItemInOut", projectItemName: item.name, inPointSeconds: action.inPointSeconds, outPointSeconds: action.outPointSeconds };
}

function prAI_clearSequenceTracks(sequence) {
  var deleted = 0;
  if (!sequence) {
    return deleted;
  }
  if (sequence.videoTracks) {
    for (var vt = 0; vt < sequence.videoTracks.numTracks; vt++) {
      var vTrack = sequence.videoTracks[vt];
      for (var vc = vTrack.clips.numItems - 1; vc >= 0; vc--) {
        vTrack.clips[vc].remove(false, false);
        deleted++;
      }
    }
  }
  if (sequence.audioTracks) {
    for (var at = 0; at < sequence.audioTracks.numTracks; at++) {
      var aTrack = sequence.audioTracks[at];
      for (var ac = aTrack.clips.numItems - 1; ac >= 0; ac--) {
        aTrack.clips[ac].remove(false, false);
        deleted++;
      }
    }
  }
  return deleted;
}

function prAI_findSequenceById(sequenceId) {
  try {
    if (!sequenceId || !app.project.sequences) {
      return null;
    }
    var sequenceCount = prAI_collectionCount(app.project.sequences);
    for (var i = 0; i < sequenceCount; i++) {
      var sequence = prAI_collectionItem(app.project.sequences, i);
      if (sequence && sequence.sequenceID === sequenceId) {
        return sequence;
      }
    }
  } catch (err) {
  }
  return null;
}

function prAI_resolveActiveSequence(openIfNeeded) {
  var active = null;
  try {
    active = app.project.activeSequence;
  } catch (err) {
    active = null;
  }
  if (active) {
    prAI_lastSequenceId = active.sequenceID || prAI_lastSequenceId;
    return active;
  }

  var sequence = prAI_findSequenceById(prAI_lastSequenceId);
  try {
    if (!sequence && app.project.sequences) {
      var sequenceCount = prAI_collectionCount(app.project.sequences);
      for (var i = sequenceCount - 1; i >= 0; i--) {
        var candidate = prAI_collectionItem(app.project.sequences, i);
        if (candidate && (candidate.videoTracks || candidate.audioTracks)) {
          sequence = candidate;
          break;
        }
      }
    }
  } catch (fallbackErr) {
  }
  if (!sequence) {
    return null;
  }

  prAI_lastSequenceId = sequence.sequenceID || prAI_lastSequenceId;
  if (openIfNeeded && app.project.openSequence && sequence.sequenceID) {
    try {
      app.project.openSequence(sequence.sequenceID);
      active = app.project.activeSequence;
      if (active) {
        prAI_lastSequenceId = active.sequenceID || prAI_lastSequenceId;
        return active;
      }
    } catch (err) {
    }
  }
  return sequence;
}

function prAI_createSequenceFromActive(action) {
  var source = prAI_requireSequence();
  if (!source.clone) {
    throw new Error("This Premiere version does not expose active sequence cloning. Provide a presetPath in createSequence to create a sequence.");
  }
  var sourceId = source.sequenceID;
  var beforeIds = {};
  if (app.project.sequences) {
    for (var b = 0; b < app.project.sequences.numSequences; b++) {
      if (app.project.sequences[b] && app.project.sequences[b].sequenceID) {
        beforeIds[app.project.sequences[b].sequenceID] = true;
      }
    }
  }
  var result = source.clone();
  var created = null;
  if (result && result.name !== undefined) {
    created = result;
  } else if (app.project.activeSequence && app.project.activeSequence.sequenceID !== sourceId) {
    created = app.project.activeSequence;
  }
  if (!created && app.project.sequences) {
    for (var i = app.project.sequences.numSequences - 1; i >= 0; i--) {
      var candidate = app.project.sequences[i];
      if (candidate && candidate.sequenceID && !beforeIds[candidate.sequenceID]) {
        created = candidate;
        break;
      }
    }
  }
  if (!created) {
    throw new Error("Premiere cloned the sequence but PR AI could not locate the clone.");
  }
  if (action.name) {
    created.name = action.name;
  }
  if (!prAI_currentTargetSequenceId && app.project.openSequence && created.sequenceID) {
    app.project.openSequence(created.sequenceID);
    created = prAI_findSequenceById(created.sequenceID) || app.project.activeSequence || created;
  }
  if (created && created.sequenceID) {
    prAI_currentTargetSequenceId = created.sequenceID;
    prAI_lastSequenceId = created.sequenceID;
  }
  var deleted = action.clear === false ? 0 : prAI_clearSequenceTracks(created);
  return {
    type: "createSequence",
    name: created.name,
    sequenceId: created.sequenceID,
    sourceSequenceName: source.name,
    method: "cloneActiveSequence",
    clearedClips: deleted
  };
}

function prAI_createSequence(action) {
  if (action.presetPath && app.project.createNewSequenceFromPreset) {
    var sequence = app.project.createNewSequenceFromPreset(action.name || "AI Sequence", action.presetPath);
    return { type: "createSequence", name: sequence ? sequence.name : action.name, presetPath: action.presetPath, method: "preset" };
  }
  return prAI_createSequenceFromActive(action);
}

function prAI_renameSequence(action) {
  var sequence = prAI_requireSequence();
  var from = sequence.name;
  if (action.name && sequence.name !== action.name && action.sequenceName && sequence.name !== action.sequenceName) {
    throw new Error("Only the active sequence can be renamed by this action.");
  }
  sequence.name = action.to;
  return { type: "renameSequence", from: from, to: action.to };
}

function prAI_setTrackState(action) {
  var trackType = action.type === "setTrackMute" ? "audio" : (action.trackType || "video");
  var track = prAI_getTrack(prAI_requireSequence(), trackType, action.trackIndex || 0);
  if (action.type === "setTrackMute") {
    if (track.setMute) {
      track.setMute(action.muted !== false);
    } else {
      track.muted = action.muted !== false;
    }
    return { type: action.type, trackType: "audio", trackIndex: Number(action.trackIndex || 0), muted: action.muted !== false };
  }
  if (action.type === "setTrackVisibility") {
    if (track.setVisible) {
      track.setVisible(action.visible !== false);
    } else {
      track.visible = action.visible !== false;
    }
    return { type: action.type, trackType: "video", trackIndex: Number(action.trackIndex || 0), visible: action.visible !== false };
  }
  if (track.setLocked) {
    track.setLocked(action.locked === true);
  } else {
    track.locked = action.locked === true;
  }
  return { type: action.type, trackType: trackType, trackIndex: Number(action.trackIndex || 0), locked: action.locked === true };
}

function prAI_addClipMarker(action) {
  var clip = prAI_getClip(prAI_requireSequence(), action);
  var item = prAI_clipProjectItem(clip);
  if (!item || !item.createMarker) {
    throw new Error("Clip source markers are not exposed for this clip.");
  }
  var clipStart = prAI_readTimeSeconds(clip, "start");
  var sourceIn = prAI_readTimeSeconds(clip, "inPoint");
  var markerSeconds = sourceIn + (Number(action.seconds || clipStart) - clipStart);
  var marker = item.createMarker(markerSeconds);
  marker.name = action.name || "AI Clip Marker";
  marker.comments = action.comment || "";
  return { type: "addClipMarker", clipName: clip.name, seconds: Number(action.seconds || clipStart), sourceSeconds: markerSeconds, name: marker.name };
}

function prAI_findComponentByName(clip, names) {
  try {
    for (var c = 0; c < clip.components.numItems; c++) {
      var component = clip.components[c];
      var displayName = String(component.displayName || "").toLowerCase();
      for (var n = 0; n < names.length; n++) {
        if (displayName.indexOf(String(names[n]).toLowerCase()) !== -1) {
          return component;
        }
      }
    }
  } catch (err) {
  }
  return null;
}

function prAI_findPropertyByName(component, names) {
  if (!component) {
    return null;
  }
  try {
    for (var p = 0; p < component.properties.numItems; p++) {
      var property = component.properties[p];
      var displayName = String(property.displayName || "").toLowerCase();
      for (var n = 0; n < names.length; n++) {
        if (displayName.indexOf(String(names[n]).toLowerCase()) !== -1) {
          return property;
        }
      }
    }
  } catch (err) {
  }
  return null;
}

function prAI_propertyLooksLikeMaskFeather(component, property) {
  var name = String(property && property.displayName ? property.displayName : "") + " " +
    String(property && property.matchName ? property.matchName : "") + " " +
    String(component && component.displayName ? component.displayName : "") + " " +
    String(component && component.matchName ? component.matchName : "");
  name = name.toLowerCase();
  return name.indexOf("mask") !== -1 && name.indexOf("feather") !== -1;
}

function prAI_firstNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    var parsed = Number(value);
    return isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value === "object" && value.length !== undefined) {
    for (var i = 0; i < value.length; i++) {
      var itemNumber = prAI_firstNumber(value[i]);
      if (itemNumber !== null) {
        return itemNumber;
      }
    }
  }
  if (value && typeof value === "object") {
    if (value.value !== undefined) {
      return prAI_firstNumber(value.value);
    }
    if (value.x !== undefined) {
      return prAI_firstNumber(value.x);
    }
    if (value.X !== undefined) {
      return prAI_firstNumber(value.X);
    }
    if (value.y !== undefined) {
      return prAI_firstNumber(value.y);
    }
    if (value.Y !== undefined) {
      return prAI_firstNumber(value.Y);
    }
  }
  return null;
}

function prAI_linkedMaskFeatherValue(component, property, value, action) {
  if (!prAI_propertyLooksLikeMaskFeather(component, property)) {
    return value;
  }
  if (action && (action.linked === false || action.linkFeather === false || action.unlinkFeather === true || action.separateFeather === true)) {
    return value;
  }
  var feather = prAI_firstNumber(value);
  if (feather === null) {
    return value;
  }
  var current = null;
  try {
    if (property && property.getValue) {
      current = property.getValue();
    }
  } catch (err) {
    current = null;
  }
  if (current && typeof current === "object" && current.length !== undefined) {
    var linked = [];
    for (var i = 0; i < current.length; i++) {
      linked.push(feather);
    }
    return linked.length ? linked : [feather, feather];
  }
  return feather;
}

function prAI_setPropertyValue(property, value, component, action) {
  if (!property || !property.setValue) {
    return false;
  }
  value = prAI_linkedMaskFeatherValue(component, property, value, action);
  property.setValue(value, true);
  return true;
}

function prAI_stringContains(haystack, needle) {
  return String(haystack || "").toLowerCase().indexOf(String(needle || "").toLowerCase()) !== -1;
}

function prAI_graphicProperties(clip) {
  return prAI_readClipComponents(clip);
}

function prAI_findGraphicProperty(clip, action) {
  var found = prAI_findGraphicPropertyWithComponent(clip, action);
  return found ? found.property : null;
}

function prAI_findGraphicPropertyWithComponent(clip, action) {
  var componentName = action.componentName || action.component || "";
  var propertyName = action.propertyName || action.property || action.name || "";
  if (!propertyName) {
    return null;
  }
  try {
    for (var c = 0; c < clip.components.numItems; c++) {
      var component = clip.components[c];
      if (componentName && !prAI_stringContains(component.displayName, componentName) && !prAI_stringContains(component.matchName, componentName)) {
        continue;
      }
      for (var p = 0; p < component.properties.numItems; p++) {
        var property = component.properties[p];
        if (prAI_stringContains(property.displayName, propertyName) || prAI_stringContains(property.matchName, propertyName)) {
          return { component: component, property: property };
        }
      }
    }
  } catch (err) {
  }
  return null;
}

function prAI_findTextProperties(clip, propertyName) {
  var found = [];
  try {
    for (var c = 0; c < clip.components.numItems; c++) {
      var component = clip.components[c];
      var componentLooksGraphic = prAI_stringContains(component.displayName, "graphic") || prAI_stringContains(component.displayName, "text") || prAI_stringContains(component.matchName, "graphic");
      for (var p = 0; p < component.properties.numItems; p++) {
        var property = component.properties[p];
        var name = String(property.displayName || "") + " " + String(property.matchName || "");
        if (propertyName) {
          if (prAI_stringContains(name, propertyName)) {
            found.push(property);
          }
        } else if (prAI_stringContains(name, "source text") || prAI_stringContains(name, "text") || componentLooksGraphic) {
          found.push(property);
        }
      }
    }
  } catch (err) {
  }
  return found;
}

function prAI_setGraphicText(action) {
  var clip = prAI_getClip(prAI_requireSequence(), action);
  var changed = [];
  if (action.values) {
    for (var key in action.values) {
      if (action.values.hasOwnProperty(key)) {
        var namedProperty = prAI_findGraphicPropertyWithComponent(clip, { propertyName: key });
        if (prAI_setPropertyValue(namedProperty ? namedProperty.property : null, action.values[key], namedProperty ? namedProperty.component : null, action)) {
          changed.push(key);
        }
      }
    }
  } else {
    var properties = prAI_findTextProperties(clip, action.propertyName);
    for (var i = 0; i < properties.length; i++) {
      if (prAI_setPropertyValue(properties[i], String(action.text || ""), null, action)) {
        changed.push(String(properties[i].displayName || action.propertyName || "text"));
        if (action.propertyName) {
          break;
        }
      }
    }
  }
  if (!changed.length) {
    throw new Error("No editable graphics text property was found. Use listGraphicProperties on the graphics clip to inspect available fields.");
  }
  return { type: "setGraphicText", trackIndex: Number(action.trackIndex || 0), clipIndex: action.clipIndex, clipName: clip.name, changed: changed };
}

function prAI_setGraphicProperty(action) {
  var clip = prAI_getClip(prAI_requireSequence(), action);
  var found = prAI_findGraphicPropertyWithComponent(clip, action);
  var property = found ? found.property : null;
  var component = found ? found.component : null;
  var value = prAI_linkedMaskFeatherValue(component, property, action.value, action);
  if (!prAI_setPropertyValue(property, action.value, component, action)) {
    throw new Error("Graphic property not found or not editable: " + (action.propertyName || action.property || ""));
  }
  return { type: "setGraphicProperty", trackIndex: Number(action.trackIndex || 0), clipIndex: action.clipIndex, clipName: clip.name, propertyName: action.propertyName || action.property, value: value, linked: prAI_propertyLooksLikeMaskFeather(component, property) && !(action && (action.linked === false || action.linkFeather === false || action.unlinkFeather === true || action.separateFeather === true)) };
}

function prAI_listGraphicProperties(action) {
  var clip = prAI_getClip(prAI_requireSequence(), action);
  return { type: "listGraphicProperties", trackIndex: Number(action.trackIndex || 0), clipIndex: action.clipIndex, clipName: clip.name, components: prAI_graphicProperties(clip) };
}

function prAI_defaultStylePreviewValues() {
  return {
    fillType: "solid",
    fillColor: "#f7f8fb",
    strokeColor: "#111111",
    strokeAdjust: 0,
    fillOverStroke: true,
    shadow: true
  };
}

function prAI_stylePropertyLooksRelevant(component, property) {
  var name = (String(component.displayName || component.matchName || "") + " " + String(property.displayName || property.matchName || "")).toLowerCase();
  return name.indexOf("style") !== -1 ||
    name.indexOf("font") !== -1 ||
    name.indexOf("fill") !== -1 ||
    name.indexOf("stroke") !== -1 ||
    name.indexOf("color") !== -1 ||
    name.indexOf("text") !== -1 ||
    name.indexOf("graphic") !== -1;
}

function prAI_styleValueSummary(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  try {
    if (value.length !== undefined) {
      var parts = [];
      for (var i = 0; i < value.length && i < 8; i++) {
        parts.push(value[i]);
      }
      return parts.join(", ");
    }
  } catch (err) {
  }
  return String(value);
}

function prAI_projectItemLooksLikeStyle(item) {
  var name = String(item.name || "").toLowerCase();
  var mediaPath = prAI_projectItemMediaPath(item).toLowerCase();
  return name.indexOf("style") !== -1 ||
    name.indexOf(".prtextstyle") !== -1 ||
    mediaPath.indexOf(".prtextstyle") !== -1;
}

function prAI_collectProjectStyleItems(root, out, limit) {
  if (!root || out.length >= limit) {
    return;
  }
  for (var i = 0; i < root.children.numItems && out.length < limit; i++) {
    var item = root.children[i];
    if (prAI_projectItemLooksLikeStyle(item)) {
      out.push({
        kind: "projectItem",
        name: item.name || "Project Style Item",
        source: "Project panel",
        path: prAI_projectItemPath(item),
        mediaPath: prAI_projectItemMediaPath(item),
        sampleText: "Ag",
        previewValues: prAI_defaultStylePreviewValues()
      });
    }
    if (item.children && item.children.numItems) {
      prAI_collectProjectStyleItems(item, out, limit);
    }
  }
}

function prAI_styleRecordSignature(properties) {
  var parts = [];
  for (var i = 0; i < properties.length && i < 30; i++) {
    parts.push(properties[i].component + ":" + properties[i].displayName + ":" + properties[i].matchName + ":" + properties[i].value);
  }
  return parts.join("|");
}

function prAI_collectClipStyleRecord(clip, trackIndex, clipIndex, out, seen) {
  var properties = [];
  var hasGraphicComponent = false;
  try {
    for (var c = 0; c < clip.components.numItems; c++) {
      var component = clip.components[c];
      var componentName = String(component.displayName || component.matchName || "");
      if (prAI_stringContains(componentName, "graphic") || prAI_stringContains(componentName, "text")) {
        hasGraphicComponent = true;
      }
      for (var p = 0; p < component.properties.numItems && properties.length < 60; p++) {
        var property = component.properties[p];
        if (!prAI_stylePropertyLooksRelevant(component, property)) {
          continue;
        }
        var value = null;
        try {
          if (property.getValue) {
            value = property.getValue();
          }
        } catch (valueErr) {
        }
        properties.push({
          component: componentName,
          displayName: String(property.displayName || ""),
          matchName: String(property.matchName || ""),
          value: prAI_styleValueSummary(value)
        });
      }
    }
  } catch (err) {
  }
  if (!hasGraphicComponent && !properties.length) {
    return;
  }
  var signature = prAI_styleRecordSignature(properties);
  if (seen[signature]) {
    seen[signature].usedBy.push({ clipName: clip.name || "", trackIndex: trackIndex, clipIndex: clipIndex });
    seen[signature].useCount += 1;
    return;
  }
  seen[signature] = { useCount: 1, usedBy: [{ clipName: clip.name || "", trackIndex: trackIndex, clipIndex: clipIndex }] };
  out.push({
    kind: "timelineGraphic",
    name: "Project Style " + (out.length + 1),
    source: "Open Projects",
    clipName: clip.name || "",
    trackIndex: trackIndex,
    clipIndex: clipIndex,
    startSeconds: prAI_readTimeSeconds(clip, "start"),
    endSeconds: prAI_readTimeSeconds(clip, "end"),
    propertyCount: properties.length,
    properties: properties,
    signature: signature,
    useCount: 1,
    usedBy: seen[signature].usedBy,
    sampleText: "Ag",
    previewValues: prAI_defaultStylePreviewValues()
  });
}

function prAI_localStyleFileLooksRelevant(file) {
  var name = String(file.name || "").toLowerCase();
  return name.indexOf(".prtextstyle") !== -1 ||
    name.indexOf("textstyle") !== -1 ||
    name.indexOf("text-style") !== -1 ||
    name.indexOf("text_style") !== -1;
}

function prAI_scanLocalStyleFolder(folder, out, limit, depth) {
  if (!folder || !folder.exists || out.length >= limit || depth > 6) {
    return;
  }
  var entries = [];
  try {
    entries = folder.getFiles();
  } catch (err) {
    return;
  }
  for (var i = 0; i < entries.length && out.length < limit; i++) {
    var entry = entries[i];
    if (entry instanceof Folder) {
      prAI_scanLocalStyleFolder(entry, out, limit, depth + 1);
    } else if (entry instanceof File && prAI_localStyleFileLooksRelevant(entry)) {
      out.push({
        kind: "localStyleFile",
        name: entry.displayName || entry.name || "Local Style",
        source: "Local Styles",
        path: entry.fsName,
        sampleText: "Ag",
        previewValues: prAI_defaultStylePreviewValues()
      });
    }
  }
}

function prAI_scanLocalTextStyles(limit) {
  var styles = [];
  var base = Folder.userData ? Folder.userData.fsName : "";
  var folders = [
    base + "/Adobe/Premiere Pro",
    base + "/Adobe/Common",
    base + "/Adobe/Common/Motion Graphics Templates",
    base + "/Adobe/Creative Cloud Libraries"
  ];
  for (var i = 0; i < folders.length && styles.length < limit; i++) {
    prAI_scanLocalStyleFolder(new Folder(folders[i]), styles, limit, 0);
  }
  return styles;
}

function prAI_listNativeTextStyles() {
  try {
    if (!app.project) {
      return prAI_result(false, null, "No Premiere project is open.");
    }
    var localStyles = prAI_scanLocalTextStyles(80);
    var openProjectStyles = [];
    prAI_collectProjectStyleItems(app.project.rootItem, openProjectStyles, 80);

    var sequence = app.project.activeSequence;
    var seen = {};
    if (sequence) {
      for (var vt = 0; vt < sequence.videoTracks.numTracks && openProjectStyles.length < 120; vt++) {
        var track = sequence.videoTracks[vt];
        for (var vc = 0; vc < track.clips.numItems && openProjectStyles.length < 120; vc++) {
          prAI_collectClipStyleRecord(track.clips[vc], vt, vc, openProjectStyles, seen);
        }
      }
    }

    return prAI_result(true, {
      projectName: app.project.name || "",
      sequenceName: sequence ? sequence.name : "",
      nativeStylesApi: false,
      note: "Premiere's Properties > My Styles UI appears to draw from Local Styles and Open Projects. CEP does not expose that library as a direct scripting collection here, so this mirrors the same shape from local text-style files and deduped open-project graphic style records.",
      groups: [
        { id: "local", name: "Local Styles", styles: localStyles },
        { id: "project", name: "Open Projects", styles: openProjectStyles }
      ],
      styles: localStyles.concat(openProjectStyles)
    });
  } catch (err) {
    return prAI_result(false, null, err.toString());
  }
}

function prAI_insertMogrt(action) {
  var sequence = prAI_requireSequence();
  var mogrtPath = action.mogrtPath || action.templatePath;
  if (!mogrtPath) {
    throw new Error("insertMogrt needs mogrtPath or templatePath.");
  }
  if (!sequence.importMGT) {
    throw new Error("MOGRT import is not exposed by this Premiere version.");
  }
  var imported = sequence.importMGT(mogrtPath, prAI_secondsToTicks(action.seconds || action.startSeconds || 0), Number(action.videoTrackIndex || action.trackIndex || 0), Number(action.audioTrackIndex || 0));
  var result = {
    type: "insertMogrt",
    mogrtPath: mogrtPath,
    seconds: Number(action.seconds || action.startSeconds || 0),
    videoTrackIndex: Number(action.videoTrackIndex || action.trackIndex || 0)
  };
  if (imported) {
    result.clipName = imported.name || "";
    if (action.textValues || action.text) {
      var textAction = {
        trackType: "video",
        trackIndex: Number(action.videoTrackIndex || action.trackIndex || 0),
        clipName: imported.name,
        text: action.text,
        values: action.textValues
      };
      try {
        result.textEdit = prAI_setGraphicText(textAction);
      } catch (textErr) {
        result.textEditError = textErr.toString();
      }
    }
    if (action.propertyValues) {
      result.propertyEdits = [];
      for (var key in action.propertyValues) {
        if (action.propertyValues.hasOwnProperty(key)) {
          try {
            result.propertyEdits.push(prAI_setGraphicProperty({
              trackType: "video",
              trackIndex: Number(action.videoTrackIndex || action.trackIndex || 0),
              clipName: imported.name,
              propertyName: key,
              value: action.propertyValues[key],
              linked: action.linked,
              linkFeather: action.linkFeather,
              unlinkFeather: action.unlinkFeather,
              separateFeather: action.separateFeather
            }));
          } catch (propErr) {
            result.propertyEdits.push({ propertyName: key, error: propErr.toString() });
          }
        }
      }
    }
  }
  return result;
}

function prAI_createTextGraphic(action) {
  if (action.templatePath || action.mogrtPath) {
    return prAI_insertMogrt({
      type: "insertMogrt",
      mogrtPath: action.mogrtPath || action.templatePath,
      seconds: action.startSeconds || action.seconds || 0,
      videoTrackIndex: action.trackIndex || action.videoTrackIndex || 0,
      audioTrackIndex: action.audioTrackIndex || 0,
      text: action.text,
      textValues: action.textValues,
      propertyValues: action.propertyValues
    });
  }
  prAI_unsupported(action, "Direct freeform Essential Graphics text creation is not reliably exposed without a MOGRT/template path.");
}

function prAI_setClipMotion(action) {
  var clip = prAI_getClip(prAI_requireSequence(), action);
  var motion = prAI_findComponentByName(clip, ["motion"]);
  var opacityComponent = prAI_findComponentByName(clip, ["opacity"]);
  var changed = [];
  if (action.scale !== undefined) {
    if (prAI_setPropertyValue(prAI_findPropertyByName(motion, ["scale"]), Number(action.scale))) {
      changed.push("scale");
    }
  }
  if (action.position) {
    if (prAI_setPropertyValue(prAI_findPropertyByName(motion, ["position"]), action.position)) {
      changed.push("position");
    }
  }
  if (action.rotation !== undefined) {
    if (prAI_setPropertyValue(prAI_findPropertyByName(motion, ["rotation"]), Number(action.rotation))) {
      changed.push("rotation");
    }
  }
  if (action.opacity !== undefined) {
    if (prAI_setPropertyValue(prAI_findPropertyByName(opacityComponent, ["opacity"]), Number(action.opacity))) {
      changed.push("opacity");
    }
  }
  if (!changed.length) {
    throw new Error("No motion/opacity properties were changed. Component property names may differ in this Premiere version.");
  }
  return { type: "setClipMotion", trackType: action.trackType || "video", trackIndex: Number(action.trackIndex || 0), clipName: clip.name, changed: changed };
}

function prAI_fadeClip(action) {
  var clip = prAI_getClip(prAI_requireSequence(), action);
  var component = action.trackType === "audio" ? prAI_findComponentByName(clip, ["volume"]) : prAI_findComponentByName(clip, ["opacity"]);
  var property = action.trackType === "audio" ? prAI_audioLevelProperty(clip) : prAI_findPropertyByName(component, ["opacity"]);
  if (!property || !property.setTimeVarying || !property.addKey || !property.setValueAtKey) {
    throw new Error("fadeClip keyframes are not exposed for this clip/property.");
  }
  var start = prAI_readTimeSeconds(clip, "start");
  var end = prAI_readTimeSeconds(clip, "end");
  var maxValue = action.trackType === "audio" ? 0 : 100;
  property.setTimeVarying(true);
  if (action.fadeInSeconds !== undefined) {
    property.addKey(prAI_timeFromSeconds(start));
    property.setValueAtKey(prAI_timeFromSeconds(start), action.trackType === "audio" ? -96 : 0, true);
    property.addKey(prAI_timeFromSeconds(start + Number(action.fadeInSeconds)));
    property.setValueAtKey(prAI_timeFromSeconds(start + Number(action.fadeInSeconds)), maxValue, true);
  }
  if (action.fadeOutSeconds !== undefined) {
    property.addKey(prAI_timeFromSeconds(end - Number(action.fadeOutSeconds)));
    property.setValueAtKey(prAI_timeFromSeconds(end - Number(action.fadeOutSeconds)), maxValue, true);
    property.addKey(prAI_timeFromSeconds(end));
    property.setValueAtKey(prAI_timeFromSeconds(end), action.trackType === "audio" ? -96 : 0, true);
  }
  return { type: "fadeClip", trackType: action.trackType || "video", trackIndex: Number(action.trackIndex || 0), clipName: clip.name, fadeInSeconds: action.fadeInSeconds, fadeOutSeconds: action.fadeOutSeconds };
}

function prAI_applyEffectPreset(action) {
  var clip = prAI_getClip(prAI_requireSequence(), action);
  if (!action.presetPath) {
    throw new Error("applyEffectPreset needs presetPath.");
  }
  if (clip.applyPreset) {
    clip.applyPreset(action.presetPath);
    return { type: "applyEffectPreset", clipName: clip.name, presetPath: action.presetPath };
  }
  throw new Error("applyEffectPreset is not exposed by this Premiere version.");
}

function prAI_exportFrame(action) {
  var sequence = prAI_requireSequence();
  if (!action.outputPath) {
    throw new Error("exportFrame needs outputPath.");
  }
  if (sequence.exportFramePNG) {
    sequence.exportFramePNG(prAI_secondsToTicks(action.seconds || 0), action.outputPath);
    return { type: "exportFrame", seconds: Number(action.seconds || 0), outputPath: action.outputPath };
  }
  throw new Error("exportFrame is not exposed by this Premiere version.");
}

function prAI_queueExport(action) {
  var sequence = prAI_requireSequence();
  if (!app.encoder || !app.encoder.encodeSequence) {
    throw new Error("Adobe Media Encoder scripting is not available.");
  }
  if (!action.outputPath) {
    throw new Error("queueExport needs outputPath.");
  }
  app.encoder.launchEncoder();
  var presetPath = action.presetPath || "";
  var jobId = app.encoder.encodeSequence(sequence, action.outputPath, presetPath, 0, 0);
  return { type: "queueExport", outputPath: action.outputPath, presetPath: presetPath, jobId: jobId };
}

function prAI_unsupported(action, reason) {
  throw new Error((action.type || "Action") + " is not safely exposed by this CEP prototype. " + reason);
}

function prAI_setSequencePoint(sequence, methodName, seconds) {
  try {
    sequence[methodName](prAI_secondsToTicks(seconds));
  } catch (ticksErr) {
    try {
      sequence[methodName](Number(seconds));
    } catch (secondsErr) {
      sequence[methodName](prAI_timeFromSeconds(seconds));
    }
  }
}

function prAI_makeUndoActions(action) {
  action = prAI_normalizeAction(action);
  var undo = [];
  if (prAI_isProjectItemDeleteAction(action)) {
    return undo;
  }
  if (action.type === "addSequenceMarker") {
    undo.push({ type: "removeSequenceMarker", name: action.name || "AI Marker", seconds: Number(action.seconds || 0) });
  } else if (action.type === "removeSequenceMarker") {
    undo.push({ type: "addSequenceMarker", name: action.name || "AI Marker", seconds: Number(action.seconds || 0) });
  } else if (action.type === "setSequenceInOut") {
    undo.push({ type: "clearSequenceInOut" });
  } else if (action.type === "addSubtitleLayer" || action.type === "createCaptionTrack" || action.type === "importSrtFile" || action.type === "importCaptionFile") {
    undo.push({ type: "note", message: "Caption track undo is not available through CEP scripting; delete the caption track manually if needed." });
  } else if (action.type === "writeTempTextFile" || action.type === "createStyledTextXml" || action.type === "createStyledTextSvg") {
    undo.push({ type: "note", message: "Temp file cleanup can be done with deleteTempFile using the returned filePath." });
  } else if (action.type === "importTextFile") {
    undo.push({ type: "note", message: "Imported text project item undo is not available through CEP scripting; remove it manually if needed." });
  } else if (action.type === "splitClip") {
    var splitSequence = prAI_requireSequence();
    var splitClip = prAI_getClip(splitSequence, action);
    var splitIdentity = prAI_clipUndoIdentity(action, splitClip);
    var splitProjectItem = prAI_clipProjectItem(splitClip);
    undo.push({
      type: "deleteClip",
      trackType: splitIdentity.trackType,
      trackIndex: splitIdentity.trackIndex,
      clipName: splitProjectItem ? splitProjectItem.name : splitClip.name,
      startSeconds: Number(action.seconds),
      ripple: false
    });
    undo.push({
      type: "trimClip",
      trackType: splitIdentity.trackType,
      trackIndex: splitIdentity.trackIndex,
      clipIndex: splitIdentity.clipIndex,
      clipName: splitIdentity.clipName,
      startSeconds: splitIdentity.startSeconds,
      endSeconds: prAI_readTimeSeconds(splitClip, "end"),
      inPointSeconds: prAI_readTimeSeconds(splitClip, "inPoint"),
      outPointSeconds: prAI_readTimeSeconds(splitClip, "outPoint")
    });
  } else if (action.type === "trimClip" || action.type === "rippleTrimClip" || action.type === "moveClip" || action.type === "slipClip" || action.type === "slideClip" || action.type === "setClipDuration") {
    var trimSequence = prAI_requireSequence();
    var trimClip = prAI_getClip(trimSequence, action);
    var trimIdentity = prAI_clipUndoIdentity(action, trimClip);
    undo.push({
      type: "trimClip",
      trackType: trimIdentity.trackType,
      trackIndex: trimIdentity.trackIndex,
      clipIndex: trimIdentity.clipIndex,
      clipName: trimIdentity.clipName,
      startSeconds: trimIdentity.startSeconds,
      endSeconds: prAI_readTimeSeconds(trimClip, "end"),
      inPointSeconds: prAI_readTimeSeconds(trimClip, "inPoint"),
      outPointSeconds: prAI_readTimeSeconds(trimClip, "outPoint")
    });
  } else if (action.type === "deleteClip") {
    var deleteSequence = prAI_requireSequence();
    var deleteClip = prAI_getClip(deleteSequence, action);
    var deleteIdentity = prAI_clipUndoIdentity(action, deleteClip);
    var projectItemName = prAI_clipProjectItemName(deleteClip);
    undo.push({
      type: "insertProjectItem",
      projectItemName: projectItemName,
      trackType: deleteIdentity.trackType,
      trackIndex: deleteIdentity.trackIndex,
      seconds: deleteIdentity.startSeconds
    });
    undo.push({
      type: "trimClip",
      trackType: deleteIdentity.trackType,
      trackIndex: deleteIdentity.trackIndex,
      clipName: projectItemName,
      startSeconds: deleteIdentity.startSeconds,
      endSeconds: prAI_readTimeSeconds(deleteClip, "end"),
      inPointSeconds: prAI_readTimeSeconds(deleteClip, "inPoint"),
      outPointSeconds: prAI_readTimeSeconds(deleteClip, "outPoint")
    });
  } else if (action.type === "clearTrack" || action.type === "deleteTrackRange") {
    undo.push({ type: "note", message: "Bulk track cleanup undo is limited. Use the panel undo only when Premiere can recreate deleted clips from generated undo data; otherwise restore from project history/autosave." });
  } else if (action.type === "setClipEnabled") {
    var enabledSequence = prAI_requireSequence();
    var enabledClip = prAI_getClip(enabledSequence, action);
    var enabledIdentity = prAI_clipUndoIdentity(action, enabledClip);
    undo.push({
      type: "setClipEnabled",
      trackType: enabledIdentity.trackType,
      trackIndex: enabledIdentity.trackIndex,
      clipIndex: enabledIdentity.clipIndex,
      clipName: enabledIdentity.clipName,
      enabled: enabledClip.disabled !== true
    });
  } else if (action.type === "setAudioGain") {
    var gainSequence = prAI_requireSequence();
    var gainClip = prAI_getClip(gainSequence, action);
    undo.push({
      type: "setAudioGain",
      trackType: "audio",
      trackIndex: Number(action.trackIndex || 0),
      clipIndex: action.clipIndex,
      clipName: gainClip.name,
      gainDb: prAI_readAudioGain(gainClip)
    });
  } else if (action.type === "insertProjectItem" || action.type === "insertClipRange" || action.type === "overwriteClipRange") {
    var insertedItem = prAI_findProjectItem(app.project.rootItem, action);
    undo.push({
      type: "deleteClip",
      trackType: action.trackType || "video",
      trackIndex: Number(action.trackIndex || 0),
      clipName: action.projectItemName || (insertedItem ? insertedItem.name : ""),
      startSeconds: Number(action.seconds || 0),
      ripple: false
    });
  } else if (action.type === "assembleFromScript") {
    undo.push({
      type: "deleteTrackRange",
      trackType: action.trackType || "video",
      trackIndex: Number(action.trackIndex || 0),
      startSeconds: Number(action.startSeconds || 0),
      endSeconds: Number(action.endSeconds || 999999),
      mode: "overlap",
      ripple: false,
      linked: action.linked === true
    });
  } else if (action.type === "renameProjectItem") {
    undo.push({ type: "renameProjectItem", from: action.to, to: action.from });
  } else if (action.type === "duplicateClip") {
    undo.push({ type: "deleteClip", trackType: action.trackType || "video", trackIndex: Number(action.trackIndex || 0), clipName: action.clipName || "", startSeconds: action.seconds, ripple: false });
  } else if (action.type === "renameBin") {
    undo.push({ type: "renameBin", from: action.to, to: action.from || action.name });
  } else if (action.type === "renameSequence") {
    var renameSequence = prAI_requireSequence();
    undo.push({ type: "renameSequence", to: renameSequence.name });
  } else if (action.type === "insertMogrt" || (action.type === "createTextGraphic" && (action.templatePath || action.mogrtPath))) {
    undo.push({ type: "deleteClip", trackType: "video", trackIndex: Number(action.videoTrackIndex || action.trackIndex || 0), startSeconds: Number(action.seconds || action.startSeconds || 0), ripple: false });
  }
  return undo;
}

function prAI_previewActions(payloadText) {
  try {
    var payload = JSON.parse(payloadText);
    var actions = payload.actions || [];
    var issues = [];
    var plan = [];

    for (var i = 0; i < actions.length; i++) {
      var action = prAI_normalizeAction(actions[i]);
      if (prAI_isProjectItemDeleteAction(action)) {
        issues.push({ index: i, type: action.type, error: "Project panel item/file deletion is blocked for safety." });
        continue;
      }
      var item = null;
      var clip = null;
      var needsClip = action.type === "trimClip" || action.type === "rippleTrimClip" || action.type === "moveClip" || action.type === "deleteClip" || action.type === "setClipEnabled" || action.type === "splitClip" || action.type === "setAudioGain" || action.type === "duplicateClip" || action.type === "slipClip" || action.type === "slideClip" || action.type === "setClipDuration" || action.type === "replaceClipRange" || action.type === "addClipMarker" || action.type === "setClipMotion" || action.type === "fadeClip" || action.type === "applyEffectPreset" || action.type === "setGraphicText" || action.type === "setGraphicProperty" || action.type === "listGraphicProperties";
      var needsItem = action.type === "insertProjectItem" || action.type === "insertClipRange" || action.type === "overwriteClipRange" || action.type === "moveProjectItemToBin" || action.type === "setProjectItemLabel" || action.type === "setProjectItemInOut";

      try {
        if (needsClip) {
          clip = prAI_getClip(prAI_requireSequence(), action);
          plan.push({ index: i, type: action.type, target: clip.name, startSeconds: prAI_readTimeSeconds(clip, "start"), endSeconds: prAI_readTimeSeconds(clip, "end") });
        } else if (needsItem) {
          item = prAI_findProjectItem(app.project.rootItem, action);
          if (!item) {
            issues.push({ index: i, type: action.type, error: "Project item not found." });
          } else {
            if (action.inPointSeconds !== undefined && action.outPointSeconds !== undefined && Number(action.outPointSeconds) <= Number(action.inPointSeconds)) {
              issues.push({ index: i, type: action.type, error: "Source out must be after source in." });
            }
            plan.push({ index: i, type: action.type, projectItemName: item.name, projectItemId: item.nodeId || "", sourcePath: prAI_projectItemMediaPath(item), seconds: action.seconds });
          }
        } else if (action.type === "addSubtitleLayer" || action.type === "createCaptionTrack") {
          var subtitleItems = action.items || action.captions || action.subtitles || [];
          if (!subtitleItems.length && action.text) {
            subtitleItems = [{ text: action.text, startSeconds: action.startSeconds || 0, endSeconds: action.endSeconds || 3 }];
          }
          if (!subtitleItems.length) {
            issues.push({ index: i, type: action.type, error: "No subtitle items provided." });
          }
          plan.push({ index: i, type: action.type, itemCount: subtitleItems.length });
        } else if (action.type === "writeTempTextFile") {
          plan.push({ index: i, type: action.type, extension: action.extension || "txt", suggestedName: action.suggestedName || action.name || "" });
        } else if (action.type === "createStyledTextXml") {
          var styledFrames = prAI_normalizeStyledTextFrames(action);
          var styledReplacementCount = 0;
          for (var sf = 0; sf < styledFrames.length; sf++) {
            styledReplacementCount += prAI_normalizeReplacementPairs(styledFrames[sf].replacements || styledFrames[sf].textReplacements || styledFrames[sf].text || action.replacements || action.textReplacements || action.text).length;
          }
          plan.push({ index: i, type: action.type, templateId: action.templateId || "text-xml-two-style-graphic", fileName: prAI_autoEditXmlFileName(action), functionName: prAI_xmlFunctionName(action), frameCount: styledFrames.length, afterCreateAction: action.afterCreateAction || "import", outputFolder: action.outputFolder || "(project folder/XML)", importAfterCreate: action.importAfterCreate !== false, replacementCount: styledReplacementCount });
        } else if (action.type === "createStyledTextSvg") {
          plan.push({ index: i, type: action.type, fileName: prAI_richTextSvgFileName(action), lineCount: prAI_normalizeRichTextLines(action).length, afterCreateAction: action.afterCreateAction || "import", outputFolder: action.outputFolder || "(project folder/XML)", insertInTimeline: action.insertInTimeline === true || action.seconds !== undefined || action.startSeconds !== undefined });
        } else if (action.type === "importTextFile") {
          plan.push({ index: i, type: action.type, filePath: action.filePath || "(temp from contents)", extension: action.extension || "txt" });
        } else if (action.type === "importMediaFile") {
          plan.push({ index: i, type: action.type, filePath: action.filePath || "", insertInTimeline: action.insertInTimeline === true, trackIndex: action.trackIndex || action.videoTrackIndex || 0, seconds: action.seconds || action.startSeconds || 0 });
        } else if (action.type === "importSrtFile" || action.type === "importCaptionFile") {
          plan.push({ index: i, type: action.type, filePath: action.filePath || "(temp from contents)", startAtTime: action.startAtTime || 0, offsetSeconds: action.offsetSeconds || 0 });
        } else if (action.type === "checkFilePath") {
          if (!action.filePath) {
            issues.push({ index: i, type: action.type, error: "checkFilePath needs filePath." });
          }
          plan.push({ index: i, type: action.type, filePath: action.filePath || "" });
        } else if (action.type === "assembleFromScript") {
          plan.push({ index: i, type: action.type, trackType: action.trackType || "video", trackIndex: action.trackIndex || 0, startSeconds: action.startSeconds || 0, clipCount: (action.clips || action.items || []).length });
        } else if (action.type === "insertMogrt") {
          if (!(action.mogrtPath || action.templatePath)) {
            issues.push({ index: i, type: action.type, error: "insertMogrt needs mogrtPath or templatePath." });
          }
          plan.push({ index: i, type: action.type, seconds: action.seconds || action.startSeconds || 0, mogrtPath: action.mogrtPath || action.templatePath });
        } else if (action.type === "createTextGraphic") {
          if (!(action.mogrtPath || action.templatePath)) {
            issues.push({ index: i, type: action.type, error: "createTextGraphic needs templatePath/mogrtPath in this CEP prototype." });
          }
          plan.push({ index: i, type: action.type, text: action.text || "", seconds: action.seconds || action.startSeconds || 0, templatePath: action.templatePath || action.mogrtPath || "" });
        } else if (action.type === "clearTrack" || action.type === "deleteTrackRange") {
          plan.push({
            index: i,
            type: action.type,
            trackType: action.trackType || "video",
            trackIndex: action.trackIndex,
            startSeconds: action.startSeconds,
            endSeconds: action.endSeconds,
            mode: action.mode || "startWithin"
          });
        } else if (action.type === "splitTrackAtTimes") {
          plan.push({
            index: i,
            type: action.type,
            trackType: action.trackType || "audio",
            trackIndex: Number(action.trackIndex || 0),
            splitCount: ((action.times || action.seconds || action.atSeconds || []) instanceof Array) ? (action.times || action.seconds || action.atSeconds || []).length : 1
          });
        } else {
          plan.push({ index: i, type: action.type });
        }
      } catch (err) {
        issues.push({ index: i, type: action.type, error: err.toString() });
      }
    }

    return prAI_result(true, {
      valid: issues.length === 0,
      issues: issues,
      plan: plan
    });
  } catch (err) {
    return prAI_result(false, null, err.toString());
  }
}

function prAI_actionTargetsAudioTrack(action, trackIndex) {
  var trackType = String(action.trackType || "video");
  if (trackType === "both") {
    return Number(action.audioTrackIndex || 0) === Number(trackIndex);
  }
  return trackType === "audio" && Number(action.trackIndex || 0) === Number(trackIndex);
}

function prAI_validateActionProtections(actions, protections) {
  protections = protections || {};
  if (protections.preserveAudioTrackIndex === undefined || protections.preserveAudioTrackIndex === null || protections.preserveAudioTrackIndex === "") {
    return;
  }
  var protectedTrackIndex = Number(protections.preserveAudioTrackIndex);
  var destructiveTypes = {
    clearTrack: true,
    deleteTrackRange: true,
    deleteClip: true,
    trimClip: true,
    rippleTrimClip: true,
    setClipDuration: true,
    replaceClipRange: true,
    slipClip: true,
    slideClip: true
  };
  var insertionTypes = {
    insertProjectItem: true,
    insertClipRange: true,
    overwriteClipRange: true,
    assembleFromScript: true,
    duplicateClip: true
  };
  for (var i = 0; i < actions.length; i++) {
    var action = prAI_normalizeAction(actions[i]);
    if (!action) {
      continue;
    }
    if (prAI_actionTargetsAudioTrack(action, protectedTrackIndex) && (destructiveTypes[action.type] || insertionTypes[action.type])) {
      throw new Error("Protected audio preflight rejected " + action.type + " on A" + (protectedTrackIndex + 1) + ". Full Process may only split or move existing source audio.");
    }
    if (protections.preserveImportedSrt === true && (action.type === "importSrtFile" || action.type === "importCaptionFile" || action.type === "addSubtitleLayer" || action.type === "createCaptionTrack") &&
        (action.cleanupAfterImport === true || action.removeProjectItemAfterCaptionTrack === true || action.deleteSrtAfterImport === true)) {
      throw new Error("Protected SRT preflight rejected caption cleanup.");
    }
    if (protections.preserveImportedSrt === true && action.type === "deleteTempFile" && /\.srt$/i.test(String(action.filePath || ""))) {
      throw new Error("Protected SRT preflight rejected SRT file deletion.");
    }
  }
}

function prAI_audioTrackIntegritySnapshot(sequence, trackIndex) {
  var track = prAI_getTrack(sequence, "audio", trackIndex);
  var timelineDuration = 0;
  var sourceDuration = 0;
  var clips = [];
  for (var i = 0; i < track.clips.numItems; i++) {
    var clip = track.clips[i];
    var start = prAI_readTimeSeconds(clip, "start");
    var end = prAI_readTimeSeconds(clip, "end");
    var inPoint = prAI_readTimeSeconds(clip, "inPoint");
    var outPoint = prAI_readTimeSeconds(clip, "outPoint");
    timelineDuration += Math.max(0, end - start);
    sourceDuration += Math.max(0, outPoint - inPoint);
    clips.push({
      name: clip.name,
      startSeconds: start,
      endSeconds: end,
      inPointSeconds: inPoint,
      outPointSeconds: outPoint
    });
  }
  return {
    trackIndex: Number(trackIndex),
    clipCount: clips.length,
    timelineDuration: timelineDuration,
    sourceDuration: sourceDuration,
    clips: clips
  };
}

function prAI_assertAudioTrackIntegrity(before, after) {
  var tolerance = Math.max(0.08, Math.max(before.clipCount, after.clipCount) * 0.01);
  if (Math.abs(before.timelineDuration - after.timelineDuration) > tolerance || Math.abs(before.sourceDuration - after.sourceDuration) > tolerance) {
    throw new Error("Protected audio integrity changed on A" + (before.trackIndex + 1) + ": timeline " + before.timelineDuration.toFixed(3) + "s -> " + after.timelineDuration.toFixed(3) + "s, source " + before.sourceDuration.toFixed(3) + "s -> " + after.sourceDuration.toFixed(3) + "s. Stopped before continuing.");
  }
}

function prAI_applyActions(payloadText) {
  var previousTargetSequenceId = prAI_currentTargetSequenceId;
  try {
    var payload = JSON.parse(payloadText);
    var actions = payload.actions || [];
    var applied = [];
    var undoActions = [];
    var failed = [];
    prAI_currentTargetSequenceId = payload.targetSequenceId || payload.sequenceId || "";
    if (prAI_currentTargetSequenceId && !prAI_findSequenceById(prAI_currentTargetSequenceId)) {
      throw new Error("Target sequence was not found: " + prAI_currentTargetSequenceId);
    }
    prAI_validateActionProtections(actions, payload.protections || {});
    var protectedAudioBaseline = null;
    if (payload.protections && payload.protections.preserveAudioTrackIndex !== undefined && payload.protections.preserveAudioTrackIndex !== null && payload.protections.preserveAudioTrackIndex !== "") {
      protectedAudioBaseline = prAI_audioTrackIntegritySnapshot(prAI_requireSequence(), Number(payload.protections.preserveAudioTrackIndex));
    }

    for (var i = 0; i < actions.length; i++) {
      var action = prAI_normalizeAction(actions[i]);
      try {
        if (prAI_isProjectItemDeleteAction(action)) {
          throw new Error("Project panel item/file deletion is blocked for safety.");
        }
        var inverse = prAI_makeUndoActions(action);

        if (action.type === "addSequenceMarker") {
        var markerSequence = prAI_requireSequence();
        var marker = markerSequence.markers.createMarker(Number(action.seconds || 0));
        marker.name = action.name || "AI Marker";
        marker.comments = action.comment || "";
        applied.push({ type: action.type, name: marker.name, seconds: Number(action.seconds || 0) });
      } else if (action.type === "removeSequenceMarker") {
        var removeSequence = prAI_requireSequence();
        var markers = removeSequence.markers;
        var cursor = markers.getFirstMarker();
        var removed = false;
        while (cursor) {
          var markerSeconds = prAI_readTimeSeconds(cursor, "start");
          var nameMatches = !action.name || cursor.name === action.name;
          var timeMatches = action.seconds === undefined || action.seconds === null || Math.abs(markerSeconds - Number(action.seconds)) <= 0.02;
          if (nameMatches && timeMatches) {
            markers.deleteMarker(cursor);
            removed = true;
            break;
          }
          cursor = markers.getNextMarker(cursor);
        }
        if (!removed) {
          throw new Error("Marker not found for removal.");
        }
        applied.push({ type: action.type, name: action.name || "", seconds: action.seconds });
      } else if (action.type === "setSequenceInOut") {
        var inOutSequence = prAI_requireSequence();
        if (action.inSeconds !== undefined && action.inSeconds !== null && action.inSeconds !== "") {
          prAI_setSequencePoint(inOutSequence, "setInPoint", action.inSeconds);
        }
        if (action.outSeconds !== undefined && action.outSeconds !== null && action.outSeconds !== "") {
          prAI_setSequencePoint(inOutSequence, "setOutPoint", action.outSeconds);
        }
        applied.push({ type: action.type, inSeconds: action.inSeconds, outSeconds: action.outSeconds });
      } else if (action.type === "clearSequenceInOut") {
        var clearSequence = prAI_requireSequence();
        if (clearSequence.clearInPoint) {
          clearSequence.clearInPoint();
        }
        if (clearSequence.clearOutPoint) {
          clearSequence.clearOutPoint();
        }
        applied.push({ type: action.type });
      } else if (action.type === "trimClip") {
        var trimSequence = prAI_requireSequence();
        var trimClip = prAI_getClip(trimSequence, action);
        prAI_setClipTime(trimClip, "start", action.startSeconds);
        prAI_setClipTime(trimClip, "end", action.endSeconds);
        prAI_setClipTime(trimClip, "inPoint", action.inPointSeconds);
        prAI_setClipTime(trimClip, "outPoint", action.outPointSeconds);
        applied.push({
          type: action.type,
          trackType: action.trackType || "video",
          trackIndex: Number(action.trackIndex || 0),
          clipIndex: action.clipIndex,
          clipName: trimClip.name
        });
      } else if (action.type === "rippleTrimClip") {
        var rippleSequence = prAI_requireSequence();
        var rippleClip = prAI_getClip(rippleSequence, action);
        var oldStart = prAI_readTimeSeconds(rippleClip, "start");
        var oldEnd = prAI_readTimeSeconds(rippleClip, "end");
        var delta = 0;
        if (action.startSeconds !== undefined && action.startSeconds !== null && action.startSeconds !== "") {
          delta = Number(action.startSeconds) - oldStart;
          prAI_setClipTime(rippleClip, "start", action.startSeconds);
        }
        if (action.endSeconds !== undefined && action.endSeconds !== null && action.endSeconds !== "") {
          delta = Number(action.endSeconds) - oldEnd;
          prAI_setClipTime(rippleClip, "end", action.endSeconds);
        }
        if (delta !== 0) {
          var rippleTrack = prAI_getTrack(rippleSequence, action.trackType || "video", action.trackIndex || 0);
          for (var rt = 0; rt < rippleTrack.clips.numItems; rt++) {
            var laterClip = rippleTrack.clips[rt];
            var laterStart = prAI_readTimeSeconds(laterClip, "start");
            if (laterClip !== rippleClip && laterStart >= oldEnd - 0.02) {
              prAI_setClipTime(laterClip, "start", laterStart + delta);
            }
          }
        }
        applied.push({
          type: action.type,
          trackType: action.trackType || "video",
          trackIndex: Number(action.trackIndex || 0),
          clipIndex: action.clipIndex,
          clipName: rippleClip.name,
          deltaSeconds: delta
        });
      } else if (action.type === "moveClip") {
        var moveSequence = prAI_requireSequence();
        var moveClip = prAI_getClip(moveSequence, action);
        var moveOldStart = prAI_readTimeSeconds(moveClip, "start");
        var moveOldEnd = prAI_readTimeSeconds(moveClip, "end");
        var moveOldIn = prAI_readTimeSeconds(moveClip, "inPoint");
        var moveOldOut = prAI_readTimeSeconds(moveClip, "outPoint");
        var moveNewStart = Number(action.startSeconds);
        var moveDuration = Math.max(0, moveOldEnd - moveOldStart);
        var moveNewEnd = moveNewStart + moveDuration;
        prAI_setClipTime(moveClip, "start", moveNewStart);
        if (Math.abs(prAI_readTimeSeconds(moveClip, "end") - moveNewEnd) > 0.02) {
          prAI_setClipTime(moveClip, "end", moveNewEnd);
        }
        if (Math.abs(prAI_readTimeSeconds(moveClip, "inPoint") - moveOldIn) > 0.02) {
          prAI_setClipTime(moveClip, "inPoint", moveOldIn);
        }
        if (Math.abs(prAI_readTimeSeconds(moveClip, "outPoint") - moveOldOut) > 0.02) {
          prAI_setClipTime(moveClip, "outPoint", moveOldOut);
        }
        prAI_setClipTime(moveClip, "start", moveNewStart);
        prAI_setClipTime(moveClip, "end", moveNewEnd);
        var moveActualStart = prAI_readTimeSeconds(moveClip, "start");
        var moveActualEnd = prAI_readTimeSeconds(moveClip, "end");
        var moveActualIn = prAI_readTimeSeconds(moveClip, "inPoint");
        var moveActualOut = prAI_readTimeSeconds(moveClip, "outPoint");
        if (Math.abs(moveActualStart - moveNewStart) > 0.05 ||
            Math.abs((moveActualEnd - moveActualStart) - moveDuration) > 0.05 ||
            Math.abs(moveActualIn - moveOldIn) > 0.05 ||
            Math.abs(moveActualOut - moveOldOut) > 0.05) {
          throw new Error("Premiere changed the clip duration or source range while moving it; stopped to prevent audio trimming.");
        }
        applied.push({
          type: action.type,
          trackType: action.trackType || "video",
          trackIndex: Number(action.trackIndex || 0),
          clipIndex: action.clipIndex,
          clipName: moveClip.name,
          startSeconds: moveNewStart,
          endSeconds: moveNewEnd,
          durationSeconds: moveDuration,
          sourceInPointSeconds: moveOldIn,
          sourceOutPointSeconds: moveOldOut
        });
      } else if (action.type === "deleteClip") {
        var deleteSequence = prAI_requireSequence();
        var deleteClip = prAI_getClip(deleteSequence, action);
        var deleteName = deleteClip.name;
        deleteClip.remove(action.ripple === true, true);
        applied.push({
          type: action.type,
          trackType: action.trackType || "video",
          trackIndex: Number(action.trackIndex || 0),
          clipIndex: action.clipIndex,
          clipName: deleteName,
          ripple: action.ripple === true
        });
      } else if (action.type === "clearTrack" || action.type === "deleteTrackRange") {
        applied.push(prAI_deleteTrackRange(action));
      } else if (action.type === "setClipEnabled") {
        var enabledSequence = prAI_requireSequence();
        var enabledClip = prAI_getClip(enabledSequence, action);
        enabledClip.disabled = action.enabled === false;
        applied.push({
          type: action.type,
          trackType: action.trackType || "video",
          trackIndex: Number(action.trackIndex || 0),
          clipIndex: action.clipIndex,
          clipName: enabledClip.name,
          enabled: action.enabled !== false
        });
      } else if (action.type === "setAudioGain") {
        applied.push(prAI_setAudioGain(action));
      } else if (action.type === "addSubtitleLayer" || action.type === "createCaptionTrack") {
        applied.push(prAI_createSubtitleLayer(action));
      } else if (action.type === "writeTempTextFile") {
        applied.push(prAI_writeTempTextFile(action));
      } else if (action.type === "createStyledTextXml") {
        applied.push(prAI_createStyledTextXml(action));
      } else if (action.type === "createStyledTextSvg") {
        applied.push(prAI_createStyledTextSvg(action));
      } else if (action.type === "importTextFile") {
        applied.push(prAI_importTextFile(action));
      } else if (action.type === "importMediaFile") {
        applied.push(prAI_importMediaFile(action));
      } else if (action.type === "importSrtFile" || action.type === "importCaptionFile") {
        applied.push(prAI_createCaptionTrackFromFile(action));
      } else if (action.type === "checkFilePath") {
        applied.push(prAI_checkFilePath(action));
      } else if (action.type === "deleteTempFile") {
        applied.push(prAI_deleteTempFile(action));
      } else if (action.type === "assembleFromScript") {
        applied.push(prAI_assembleFromScript(action));
      } else if (action.type === "insertProjectItem" || action.type === "insertClipRange" || action.type === "overwriteClipRange") {
        var insertSequence = prAI_requireSequence();
        applied.push(prAI_insertProjectItemWithMode(insertSequence, action, action.type === "overwriteClipRange"));
      } else if (action.type === "splitClip") {
        applied.push(prAI_splitClip(action));
      } else if (action.type === "splitTrackAtTimes") {
        applied.push(prAI_splitTrackAtTimes(action));
      } else if (action.type === "duplicateClip") {
        applied.push(prAI_duplicateClip(action));
      } else if (action.type === "slipClip") {
        applied.push(prAI_slipClip(action));
      } else if (action.type === "slideClip") {
        applied.push(prAI_slideClip(action));
      } else if (action.type === "setClipDuration") {
        applied.push(prAI_setClipDuration(action));
      } else if (action.type === "replaceClipRange") {
        applied.push(prAI_replaceClipRange(action));
      } else if (action.type === "renameProjectItem") {
        var item = prAI_findProjectItemByName(app.project.rootItem, action.from);
        if (!item) {
          throw new Error("Project item not found: " + action.from);
        }
        item.name = action.to;
        applied.push({ type: action.type, from: action.from, to: action.to });
      } else if (action.type === "createBin") {
        applied.push(prAI_createBin(action));
      } else if (action.type === "renameBin") {
        applied.push(prAI_renameBin(action));
      } else if (action.type === "moveProjectItemToBin") {
        applied.push(prAI_moveProjectItemToBin(action));
      } else if (action.type === "setProjectItemLabel") {
        applied.push(prAI_setProjectItemLabel(action));
      } else if (action.type === "setProjectItemInOut") {
        applied.push(prAI_setProjectItemInOut(action));
      } else if (action.type === "createSequence") {
        applied.push(prAI_createSequence(action));
      } else if (action.type === "renameSequence") {
        applied.push(prAI_renameSequence(action));
      } else if (action.type === "setTrackMute" || action.type === "setTrackVisibility" || action.type === "setTrackLock") {
        applied.push(prAI_setTrackState(action));
      } else if (action.type === "addClipMarker") {
        applied.push(prAI_addClipMarker(action));
      } else if (action.type === "setClipMotion") {
        applied.push(prAI_setClipMotion(action));
      } else if (action.type === "fadeClip") {
        applied.push(prAI_fadeClip(action));
      } else if (action.type === "applyEffectPreset") {
        applied.push(prAI_applyEffectPreset(action));
      } else if (action.type === "insertMogrt") {
        applied.push(prAI_insertMogrt(action));
      } else if (action.type === "setGraphicText") {
        applied.push(prAI_setGraphicText(action));
      } else if (action.type === "setGraphicProperty") {
        applied.push(prAI_setGraphicProperty(action));
      } else if (action.type === "listGraphicProperties") {
        applied.push(prAI_listGraphicProperties(action));
      } else if (action.type === "exportFrame") {
        applied.push(prAI_exportFrame(action));
      } else if (action.type === "queueExport") {
        applied.push(prAI_queueExport(action));
      } else if (action.type === "createTextGraphic") {
        applied.push(prAI_createTextGraphic(action));
      } else if (action.type === "note") {
        applied.push(action);
      } else {
        throw new Error("Unsupported action type: " + action.type);
      }

        if (protectedAudioBaseline) {
          prAI_assertAudioTrackIntegrity(
            protectedAudioBaseline,
            prAI_audioTrackIntegritySnapshot(prAI_requireSequence(), protectedAudioBaseline.trackIndex)
          );
        }

        for (var u = inverse.length - 1; u >= 0; u--) {
          undoActions.unshift(inverse[u]);
        }
      } catch (actionErr) {
        failed.push({
          index: i,
          type: action && action.type ? action.type : "",
          projectItemName: action && action.projectItemName ? action.projectItemName : "",
          sourceReference: action && action.sourceReference ? action.sourceReference : "",
          error: actionErr.toString()
        });
        if (action && action.abortOnFailure === true) {
          break;
        }
      }
    }

    return prAI_result(true, {
      applied: applied,
      failed: failed,
      partial: failed.length > 0,
      undoActions: undoActions
    });
  } catch (err) {
    return prAI_result(false, null, err.toString());
  } finally {
    prAI_currentTargetSequenceId = previousTargetSequenceId;
  }
}
