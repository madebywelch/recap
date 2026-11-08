import SwiftUI
import WidgetKit

struct Snapshot: Decodable {
    let concept: String?
    let dueCount: Int
}

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
}

private struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), snapshot: nil)
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

struct WidgetView: View {
    @Environment(\.colorScheme) private var colorScheme
    let entry: Entry
    let family: WidgetFamily

    private var dark: Bool { colorScheme == .dark }
    private var ink: Color { dark ? Color(red: 240/255, green: 240/255, blue: 247/255) : Color(red: 34/255, green: 36/255, blue: 56/255) }
    private var muted: Color { dark ? Color(red: 195/255, green: 197/255, blue: 210/255) : Color(red: 98/255, green: 103/255, blue: 121/255) }
    private var accent: Color { dark ? Color(red: 163/255, green: 148/255, blue: 255/255) : Color(red: 108/255, green: 88/255, blue: 219/255) }
    private var surface: Color {
        if family == .systemSmall {
            return dark ? Color(red: 56/255, green: 49/255, blue: 84/255) : Color(red: 233/255, green: 228/255, blue: 255/255)
        }
        return dark ? Color(red: 36/255, green: 39/255, blue: 53/255) : .white
    }

    var body: some View {
        Group {
            if #available(macOS 14.0, *) {
                content.containerBackground(for: .widget) { surface }
            } else {
                content.background(surface)
            }
        }
    }

    var snapshotView: some View { content.background(surface) }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("✳ recap").font(.system(size: 14, weight: .bold))
                Spacer(minLength: 4)
                if family == .systemMedium {
                    Text("TODAY’S FOCUS")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(accent)
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(accent.opacity(dark ? 0.18 : 0.12), in: Capsule())
                } else {
                    Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .semibold))
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .leading, spacing: 5) {
            if let snapshot = entry.snapshot, let concept = snapshot.concept, !concept.isEmpty {
                if family == .systemSmall {
                    Text("\(snapshot.dueCount)").font(.system(size: 35, weight: .bold))
                    Text(snapshot.dueCount == 1 ? "idea to revisit" : "ideas to revisit")
                        .font(.system(size: 11))
                    Text(concept).font(.system(size: 11, weight: .medium)).foregroundStyle(muted).lineLimit(2).padding(.top, 4)
                } else {
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(dark ? Color(red: 139/255, green: 211/255, blue: 184/255) : Color(red: 66/255, green: 140/255, blue: 117/255)).frame(width: 8, height: 8).padding(.top, 5)
                        Text(concept).font(.system(size: 16, weight: .bold)).lineLimit(3)
                    }
                    Text("\(snapshot.dueCount) due for review").font(.system(size: 11)).foregroundStyle(muted).padding(.leading, 16)
                }
            } else if let snapshot = entry.snapshot {
                Text("No brief yet").font(.system(size: 17, weight: .bold))
                Text("Open Recap to create your first brief.").font(.system(size: 11)).foregroundStyle(muted).padding(.top, 5)
                Text("\(snapshot.dueCount) due for review").font(.system(size: 11)).foregroundStyle(muted)
            } else {
                Text("Open Recap").font(.system(size: 17, weight: .bold))
                Text("Your brief and review count will appear here.").font(.system(size: 11)).foregroundStyle(muted).padding(.top, 5)
            }
            }
            Spacer(minLength: 8)
        }
        .foregroundStyle(ink)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
    }
}

#if !WIDGET_RENDER
@main
struct RecapWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RecapWidget", provider: Provider()) { entry in
            WidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Recap")
        .description("A concept and your review count.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private struct WidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    var body: some View { WidgetView(entry: entry, family: family) }
}
#endif
