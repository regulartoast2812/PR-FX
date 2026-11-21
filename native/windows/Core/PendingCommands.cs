using System;
using System.Collections.Generic;

namespace PrFxShortcutListener
{
    // Port of native/PRFXPendingCommands.swift. Access is serialized by the
    // bridge's lock. A burst must not overwrite the previous keypress, and a
    // stalled CEP panel must not replay old edits later.
    //
    // Expired and rejected entries are kept for the caller to report. Dropping
    // them silently is how a keypress used to vanish with no trace.
    internal sealed class PendingCommands<T>
    {
        private readonly List<KeyValuePair<T, DateTime>> entries = new List<KeyValuePair<T, DateTime>>();
        private readonly List<T> discarded = new List<T>();
        public int Capacity { get; }
        public TimeSpan MaxAge { get; }
        public int Dropped { get; private set; }

        public PendingCommands(int capacity = 32, double maxAgeSeconds = 5)
        {
            Capacity = capacity;
            MaxAge = TimeSpan.FromSeconds(maxAgeSeconds);
        }

        public void Expire(DateTime now)
        {
            for (var i = entries.Count - 1; i >= 0; i--)
            {
                if (now - entries[i].Value < MaxAge) continue;
                discarded.Insert(0, entries[i].Key);
                entries.RemoveAt(i);
                Dropped++;
            }
        }

        public bool Append(T value, DateTime now)
        {
            Expire(now);
            if (entries.Count >= Capacity)
            {
                Dropped++;
                discarded.Add(value);
                return false;
            }
            entries.Add(new KeyValuePair<T, DateTime>(value, now));
            return true;
        }

        public bool TryTake(DateTime now, out T value)
        {
            Expire(now);
            if (entries.Count == 0) { value = default!; return false; }
            value = entries[0].Key;
            entries.RemoveAt(0);
            return true;
        }

        public bool TryTake(DateTime now, Predicate<T> accepts, out T value)
        {
            Expire(now);
            var index = entries.FindIndex(entry => accepts(entry.Key));
            if (index < 0) { value = default!; return false; }
            value = entries[index].Key;
            entries.RemoveAt(index);
            return true;
        }

        public List<T> DrainDiscarded()
        {
            var copy = new List<T>(discarded);
            discarded.Clear();
            return copy;
        }

        public bool TryPeek(out T value)
        {
            if (entries.Count == 0) { value = default!; return false; }
            value = entries[0].Key;
            return true;
        }

        public int Count => entries.Count;
    }
}
