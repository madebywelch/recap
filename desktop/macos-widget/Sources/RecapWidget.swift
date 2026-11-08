import SwiftUI
import WidgetKit

struct Snapshot: Decodable {
    let concepts: [String]
    let date: String
    let dueCount: Int

    init(concepts: [String], dueCount: Int) {
        self.concepts = concepts
        self.date = ""
        self.dueCount = dueCount
    }

    private enum CodingKeys: String, CodingKey { case concepts, concept, date, dueCount }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        concepts = try values.decodeIfPresent([String].self, forKey: .concepts)
            ?? values.decodeIfPresent(String.self, forKey: .concept).map { [$0] } ?? []
        date = try values.decodeIfPresent(String.self, forKey: .date) ?? ""
        dueCount = try values.decode(Int.self, forKey: .dueCount)
    }
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
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let snapshot = (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode(Snapshot.self, from: $0) }
            .flatMap { $0.date == formatter.string(from: Date()) ? $0 : nil }
        return Entry(date: Date(), snapshot: snapshot)
    }
}

struct WidgetView: View {
    @Environment(\.colorScheme) private var colorScheme
    let entry: Entry
    let family: WidgetFamily
    var renderMode = false

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
            if renderMode {
                content.background(surface)
            } else if #available(macOS 14.0, *) {
                content.containerBackground(for: .widget) { surface }
            } else {
                content.background(surface)
            }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("✳ recap").font(.system(size: 14, weight: .bold))
                Spacer(minLength: 4)
                if family == .systemSmall {
                    Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .semibold))
                }
            }
            Spacer(minLength: 8)
            if let snapshot = entry.snapshot, !snapshot.concepts.isEmpty {
                if family == .systemSmall {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("\(snapshot.dueCount)").font(.system(size: 35, weight: .bold))
                        Text("due for review").font(.system(size: 11))
                        Text("TODAY’S FOCUS").font(.system(size: 9, weight: .bold)).foregroundStyle(accent).padding(.top, 4)
                        Text(snapshot.concepts[0]).font(.system(size: 11, weight: .medium)).foregroundStyle(muted).lineLimit(2)
                    }
                } else {
                    HStack(alignment: .center, spacing: 12) {
                        ViewThatFits(in: .vertical) {
                            ForEach((1...min(3, snapshot.concepts.count)).reversed(), id: \.self) { count in
                                VStack(alignment: .leading, spacing: 5) {
                                    ForEach(Array(snapshot.concepts.prefix(count).enumerated()), id: \.offset) { _, title in
                                        Text(title).font(.system(size: 12, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                                    }
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(snapshot.dueCount)").font(.system(size: 35, weight: .bold))
                            Text("to review").font(.system(size: 11)).foregroundStyle(muted)
                        }.frame(width: 70, alignment: .leading)
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    Text(entry.snapshot == nil ? "Open Recap" : "No brief yet").font(.system(size: 17, weight: .bold))
                    Text("Open Recap to create your first brief.").font(.system(size: 11)).foregroundStyle(muted)
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
