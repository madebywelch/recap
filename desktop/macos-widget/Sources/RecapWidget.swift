import SwiftUI
import WidgetKit

private struct Snapshot: Decodable {
    let concept: String?
    let dueCount: Int
}

private struct Entry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
}

private struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), snapshot: Snapshot(concept: "A concept to revisit", dueCount: 3))
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : readEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let entry = readEntry()
        completion(Timeline(entries: [entry], policy: .after(entry.date.addingTimeInterval(15 * 60))))
    }

    private func readEntry() -> Entry {
        let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("widget-data.json")
        let snapshot = (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode(Snapshot.self, from: $0) }
        return Entry(date: Date(), snapshot: snapshot)
    }
}

private struct WidgetView: View {
    let entry: Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("RECAP").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            if let snapshot = entry.snapshot {
                Text(snapshot.concept ?? "No concept yet")
                    .font(.headline)
                    .lineLimit(3)
                Spacer(minLength: 0)
                Text("\(snapshot.dueCount) due for review")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("Open Recap to get started")
                    .font(.headline)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding()
    }
}

@main
struct RecapWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RecapWidget", provider: Provider()) { entry in
            if #available(macOS 14.0, *) {
                WidgetView(entry: entry).containerBackground(.background, for: .widget)
            } else {
                WidgetView(entry: entry)
            }
        }
        .configurationDisplayName("Recap")
        .description("A concept and your review count.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
