import Foundation

// Access is serialized by CommandBridge's lock. A burst must not overwrite the
// previous keypress, and a stalled CEP panel must not replay old edits later.
struct PendingCommands<Value> {
    private var entries: [(value: Value, at: Date)] = []
    let capacity: Int
    let maxAge: TimeInterval
    private(set) var dropped = 0

    init(capacity: Int = 32, maxAge: TimeInterval = 5) {
        self.capacity = capacity
        self.maxAge = maxAge
    }

    mutating func expire(at now: Date = Date()) {
        let oldCount = entries.count
        entries.removeAll { now.timeIntervalSince($0.at) >= maxAge }
        dropped += oldCount - entries.count
    }

    @discardableResult
    mutating func append(_ value: Value, at now: Date = Date()) -> Bool {
        expire(at: now)
        guard entries.count < capacity else { dropped += 1; return false }
        entries.append((value, now))
        return true
    }

    mutating func take(at now: Date = Date()) -> Value? {
        expire(at: now)
        return entries.isEmpty ? nil : entries.removeFirst().value
    }

    var first: Value? { entries.first?.value }
    var count: Int { entries.count }
}
