import Foundation

@main
enum ShortcutQueueChecks {
    static func main() {
        let start = Date(timeIntervalSince1970: 1_000)
        var queue = PendingCommands<String>(capacity: 3, maxAge: 5)
        precondition(queue.take(at: start) == nil)
        precondition(queue.append("up", at: start))
        precondition(queue.append("up", at: start.addingTimeInterval(0.05)))
        precondition(queue.append("down", at: start.addingTimeInterval(0.1)))
        precondition(!queue.append("overflow", at: start.addingTimeInterval(0.15)))
        precondition(queue.take(at: start.addingTimeInterval(0.25)) == "up")
        precondition(queue.take(at: start.addingTimeInterval(0.5)) == "up",
                     "Repeated intentional presses must not overwrite or deduplicate")
        precondition(queue.take(at: start.addingTimeInterval(0.75)) == "down")
        precondition(queue.take(at: start.addingTimeInterval(1)) == nil)
        precondition(queue.dropped == 1)

        queue.append("stale", at: start)
        queue.append("fresh", at: start.addingTimeInterval(4))
        precondition(queue.take(at: start.addingTimeInterval(5)) == "fresh",
                     "A recovering CEP panel must not replay expired timeline edits")
        precondition(queue.dropped == 2)
        queue.append("old", at: start.addingTimeInterval(6))
        queue.expire(at: start.addingTimeInterval(12))
        precondition(queue.count == 0 && queue.first == nil && queue.dropped == 3)

        var routed = PendingCommands<String>(capacity: 4, maxAge: 5)
        routed.append("cep-first", at: start)
        routed.append("uxp", at: start.addingTimeInterval(0.1))
        routed.append("cep-last", at: start.addingTimeInterval(0.2))
        precondition(routed.take(at: start.addingTimeInterval(1), where: { $0 == "uxp" }) == "uxp")
        precondition(routed.take(at: start.addingTimeInterval(1.1)) == "cep-first")
        precondition(routed.take(at: start.addingTimeInterval(1.2)) == "cep-last",
                     "Selective UXP routing must preserve CEP command order")
        print("Shortcut queue burst, ordering, overflow and stale-command checks passed")
    }
}
