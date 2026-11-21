using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace PrFxShortcutListener
{
    // A small JSON reader/writer, so the listener needs nothing beyond what
    // ships in .NET Framework 4.8 (every Windows 10/11 machine has it).
    //
    // Objects decode to Dictionary<string, object> and are written back with
    // every field they arrived with. Commands therefore pass through the
    // listener untouched: CEP can add a field (moveMode, presetUid, ...) and
    // the engine receives it without the listener being rebuilt. That is the
    // point -- the command catalog lives in client/app.js and nowhere else.
    internal static class Json
    {
        public static object? Parse(string text)
        {
            var reader = new Reader(text ?? "");
            reader.SkipWhitespace();
            var value = reader.ReadValue();
            reader.SkipWhitespace();
            if (!reader.AtEnd) throw new FormatException("Trailing characters after JSON value at " + reader.Position);
            return value;
        }

        public static bool TryParse(string text, out object? value)
        {
            try { value = Parse(text); return true; }
            catch (Exception) { value = null; return false; }
        }

        public static string Serialize(object? value)
        {
            var builder = new StringBuilder();
            Write(builder, value);
            return builder.ToString();
        }

        public static string Quote(string value)
        {
            var builder = new StringBuilder(value.Length + 2);
            WriteString(builder, value);
            return builder.ToString();
        }

        // ---- typed accessors -------------------------------------------------

        public static string? Str(IDictionary<string, object?>? obj, string key)
        {
            if (obj == null || !obj.TryGetValue(key, out var value) || value == null) return null;
            return value as string ?? Convert.ToString(value, CultureInfo.InvariantCulture);
        }

        public static int? Int(IDictionary<string, object?>? obj, string key)
        {
            if (obj == null || !obj.TryGetValue(key, out var value) || value == null) return null;
            switch (value)
            {
                case long l: return (int)Math.Max(int.MinValue, Math.Min(int.MaxValue, l));
                case int i: return i;
                case double d when !double.IsNaN(d) && !double.IsInfinity(d): return (int)Math.Round(d);
                case string s when int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed): return parsed;
                default: return null;
            }
        }

        public static bool Bool(IDictionary<string, object?>? obj, string key)
        {
            if (obj == null || !obj.TryGetValue(key, out var value) || value == null) return false;
            return value is bool b && b;
        }

        public static IDictionary<string, object?>? Obj(IDictionary<string, object?>? obj, string key)
        {
            if (obj == null || !obj.TryGetValue(key, out var value)) return null;
            return value as IDictionary<string, object?>;
        }

        public static IList<object?>? List(IDictionary<string, object?>? obj, string key)
        {
            if (obj == null || !obj.TryGetValue(key, out var value)) return null;
            return value as IList<object?>;
        }

        public static Dictionary<string, object?> Clone(IDictionary<string, object?> source)
        {
            var copy = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var pair in source) copy[pair.Key] = pair.Value;
            return copy;
        }

        // ---- writer ----------------------------------------------------------

        private static void Write(StringBuilder builder, object? value)
        {
            switch (value)
            {
                case null: builder.Append("null"); return;
                case string s: WriteString(builder, s); return;
                case bool b: builder.Append(b ? "true" : "false"); return;
                case int i: builder.Append(i.ToString(CultureInfo.InvariantCulture)); return;
                case long l: builder.Append(l.ToString(CultureInfo.InvariantCulture)); return;
                case double d:
                    if (double.IsNaN(d) || double.IsInfinity(d)) builder.Append("null");
                    else builder.Append(d.ToString("R", CultureInfo.InvariantCulture));
                    return;
                case IDictionary<string, object?> obj:
                    builder.Append('{');
                    var first = true;
                    foreach (var pair in obj)
                    {
                        if (!first) builder.Append(',');
                        first = false;
                        WriteString(builder, pair.Key);
                        builder.Append(':');
                        Write(builder, pair.Value);
                    }
                    builder.Append('}');
                    return;
                case IEnumerable list:
                    builder.Append('[');
                    var firstItem = true;
                    foreach (var item in list)
                    {
                        if (!firstItem) builder.Append(',');
                        firstItem = false;
                        Write(builder, item);
                    }
                    builder.Append(']');
                    return;
                default:
                    WriteString(builder, Convert.ToString(value, CultureInfo.InvariantCulture) ?? "");
                    return;
            }
        }

        private static void WriteString(StringBuilder builder, string value)
        {
            builder.Append('"');
            foreach (var c in value)
            {
                switch (c)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    case '\b': builder.Append("\\b"); break;
                    case '\f': builder.Append("\\f"); break;
                    default:
                        if (c < 0x20) builder.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else builder.Append(c);
                        break;
                }
            }
            builder.Append('"');
        }

        // ---- reader ----------------------------------------------------------

        private sealed class Reader
        {
            private readonly string text;
            private int index;

            public Reader(string text) { this.text = text; }
            public bool AtEnd => index >= text.Length;
            public int Position => index;

            public void SkipWhitespace()
            {
                while (index < text.Length && (text[index] == ' ' || text[index] == '\t' || text[index] == '\n' || text[index] == '\r' || text[index] == '﻿')) index++;
            }

            public object? ReadValue()
            {
                SkipWhitespace();
                if (AtEnd) throw new FormatException("Unexpected end of JSON");
                var c = text[index];
                switch (c)
                {
                    case '{': return ReadObject();
                    case '[': return ReadArray();
                    case '"': return ReadString();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9')) return ReadNumber();
                        throw new FormatException("Unexpected character '" + c + "' at " + index);
                }
            }

            private void Expect(string word)
            {
                if (string.CompareOrdinal(text, index, word, 0, word.Length) != 0) throw new FormatException("Expected " + word + " at " + index);
                index += word.Length;
            }

            private Dictionary<string, object?> ReadObject()
            {
                var result = new Dictionary<string, object?>(StringComparer.Ordinal);
                index++;
                SkipWhitespace();
                if (index < text.Length && text[index] == '}') { index++; return result; }
                while (true)
                {
                    SkipWhitespace();
                    if (AtEnd || text[index] != '"') throw new FormatException("Expected property name at " + index);
                    var key = ReadString();
                    SkipWhitespace();
                    if (AtEnd || text[index] != ':') throw new FormatException("Expected ':' at " + index);
                    index++;
                    result[key] = ReadValue();
                    SkipWhitespace();
                    if (AtEnd) throw new FormatException("Unterminated object");
                    if (text[index] == ',') { index++; continue; }
                    if (text[index] == '}') { index++; return result; }
                    throw new FormatException("Expected ',' or '}' at " + index);
                }
            }

            private List<object?> ReadArray()
            {
                var result = new List<object?>();
                index++;
                SkipWhitespace();
                if (index < text.Length && text[index] == ']') { index++; return result; }
                while (true)
                {
                    result.Add(ReadValue());
                    SkipWhitespace();
                    if (AtEnd) throw new FormatException("Unterminated array");
                    if (text[index] == ',') { index++; continue; }
                    if (text[index] == ']') { index++; return result; }
                    throw new FormatException("Expected ',' or ']' at " + index);
                }
            }

            private string ReadString()
            {
                index++;
                var builder = new StringBuilder();
                while (true)
                {
                    if (AtEnd) throw new FormatException("Unterminated string");
                    var c = text[index++];
                    if (c == '"') return builder.ToString();
                    if (c != '\\') { builder.Append(c); continue; }
                    if (AtEnd) throw new FormatException("Unterminated escape");
                    var escape = text[index++];
                    switch (escape)
                    {
                        case '"': builder.Append('"'); break;
                        case '\\': builder.Append('\\'); break;
                        case '/': builder.Append('/'); break;
                        case 'b': builder.Append('\b'); break;
                        case 'f': builder.Append('\f'); break;
                        case 'n': builder.Append('\n'); break;
                        case 'r': builder.Append('\r'); break;
                        case 't': builder.Append('\t'); break;
                        case 'u':
                            if (index + 4 > text.Length) throw new FormatException("Bad unicode escape");
                            builder.Append((char)int.Parse(text.Substring(index, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            index += 4;
                            break;
                        default: throw new FormatException("Bad escape \\" + escape);
                    }
                }
            }

            private object ReadNumber()
            {
                var start = index;
                if (text[index] == '-') index++;
                while (index < text.Length && char.IsDigit(text[index])) index++;
                var integral = true;
                if (index < text.Length && text[index] == '.')
                {
                    integral = false;
                    index++;
                    while (index < text.Length && char.IsDigit(text[index])) index++;
                }
                if (index < text.Length && (text[index] == 'e' || text[index] == 'E'))
                {
                    integral = false;
                    index++;
                    if (index < text.Length && (text[index] == '+' || text[index] == '-')) index++;
                    while (index < text.Length && char.IsDigit(text[index])) index++;
                }
                var token = text.Substring(start, index - start);
                if (integral && long.TryParse(token, NumberStyles.Integer, CultureInfo.InvariantCulture, out var whole)) return whole;
                return double.Parse(token, NumberStyles.Float, CultureInfo.InvariantCulture);
            }
        }
    }
}
