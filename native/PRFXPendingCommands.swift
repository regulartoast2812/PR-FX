import Foundation

// Access is serialized by CommandBridge's lock. A burst must not overwrite the
// previous keypress, and a stalled CEP panel must not replay old edits later.
//
// Expired and rejected entries are kept for the caller to report. Dropping
// them silently is how a keypress used to vanish with no trace.
struct PendingCommands<Value> {
    private var entries: [(value: Value, at: Date)] = []
    private var discarded: [Value] = []
    let capacity: Int
    let maxAge: TimeInterval
    private(set) var dropped = 0

    init(capacity: Int = 32, maxAge: TimeInterval = 5) {
        self.capacity = capacity
        self.maxAge = maxAge
    }

    mutating func expire(at now: Date = Date()) {
        let stale = entries.filter { now.timeIntervalSince($0.at) >= maxAge }
        guard !stale.isEmpty else { return }
        entries.removeAll { now.timeIntervalSince($0.at) >= maxAge }
        dropped += stale.count
        discarded.append(contentsOf: stale.map(\.value))
    }

    @discardableResult
    mutating func append(_ value: Value, at now: Date = Date()) -> Bool {
        expire(at: now)
        guard entries.count < capacity else {
            dropped += 1
            discarded.append(value)
            return false
        }
        entries.append((value, now))
        return true
    }

    mutating func take(at now: Date = Date()) -> Value? {
        expire(at: now)
        return entries.isEmpty ? nil : entries.removeFirst().value
    }

    // Take the oldest entry a particular runtime can execute, while preserving
    // the order of every other entry. This lets UXP and the CEP fallback share
    // one queue without racing each other or dropping an unsupported command.
    mutating func take(at now: Date = Date(), where accepts: (Value) -> Bool) -> Value? {
        expire(at: now)
        guard let index = entries.firstIndex(where: { accepts($0.value) }) else { return nil }
        return entries.remove(at: index).value
    }

    // Everything expired or rejected since the last call.
    mutating func drainDiscarded() -> [Value] {
        defer { discarded.removeAll() }
        return discarded
    }

    var first: Value? { entries.first?.value }
    var count: Int { entries.count }
}
