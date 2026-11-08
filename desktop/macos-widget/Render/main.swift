import AppKit
import SwiftUI
import WidgetKit

@main
struct RenderWidgets {
    @MainActor
    static func main() throws {
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        for (name, family, width) in [("small", WidgetFamily.systemSmall, 158.0), ("medium", WidgetFamily.systemMedium, 338.0)] {
            for (appearance, scheme) in [("light", ColorScheme.light), ("dark", ColorScheme.dark)] {
                for (state, snapshot) in [("data", Snapshot(concepts: ["SQLite locking & WAL", "Shell quoting & expansion", "TIME_WAIT and socket reuse"], dueCount: 3)), ("empty", Snapshot(concepts: [], dueCount: 0))] {
                    let view = WidgetView(entry: Entry(date: Date(), snapshot: snapshot), family: family, renderMode: true)
                        .environment(\.colorScheme, scheme)
                        .frame(width: width, height: 158)
                    let renderer = ImageRenderer(content: view)
                    renderer.scale = 2
                    guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
                          let bitmap = NSBitmapImageRep(data: tiff),
                          let png = bitmap.representation(using: NSBitmapImageRep.FileType.png, properties: [:]) else {
                        throw NSError(domain: "WidgetRender", code: 1)
                    }
                    try png.write(to: output.appendingPathComponent("\(name)-\(appearance)-\(state).png"))
                }
            }
        }
    }
}
