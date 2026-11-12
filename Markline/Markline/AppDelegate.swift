import Cocoa
import WebKit
import UniformTypeIdentifiers

/// Serves the bundled interface (and user-picked PDFs, by one-time token) to the web view.
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private var files: [String: URL] = [:]
    private let root: URL = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true).standardizedFileURL

    func register(_ url: URL) -> String {
        let token = UUID().uuidString
        files[token] = url
        return "/__file/\(token)"
    }

    private func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "pdf": return "application/pdf"
        default: return "application/octet-stream"
        }
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        var fileURL: URL?
        var type = "application/octet-stream"
        if path.hasPrefix("/__file/") {
            fileURL = files[String(path.dropFirst("/__file/".count))]
            type = "application/pdf"
        } else {
            let candidate = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
            if candidate.path.hasPrefix(root.path) {
                fileURL = candidate
                type = mime(candidate.pathExtension)
            }
        }
        if let fileURL = fileURL, let data = try? Data(contentsOf: fileURL, options: .mappedIfSafe) {
            let headers = ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-store"]
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
            task.didReceive(response)
            task.didReceive(data)
            task.didFinish()
        } else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": "0"])!
            task.didReceive(response)
            task.didReceive(Data())
            task.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let scheme = SchemeHandler()
    private var ready = false
    private var pending: [URL] = []
    private var anyDirty = false
    private var quitConfirmed = false

    // MARK: Launch

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(scheme, forURLScheme: "markline")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "native")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Markline"
        window.minSize = NSSize(width: 900, height: 600)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("MarklineMainWindow")
        window.makeKeyAndOrderFront(nil)

        webView.load(URLRequest(url: URL(string: "markline://app/index.html")!))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func application(_ application: NSApplication, open urls: [URL]) {
        let pdfs = urls.filter { $0.pathExtension.lowercased() == "pdf" }
        if ready { openInWeb(pdfs) } else { pending.append(contentsOf: pdfs) }
    }

    // MARK: Unsaved-changes guard

    private func confirmDiscard() -> Bool {
        if !anyDirty || quitConfirmed { return true }
        let alert = NSAlert()
        alert.messageText = "You have unsaved changes."
        alert.informativeText = "If you quit now, markups you have not saved will be lost."
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Quit Without Saving")
        if alert.runModal() == .alertSecondButtonReturn {
            quitConfirmed = true
            return true
        }
        return false
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { confirmDiscard() }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        confirmDiscard() ? .terminateNow : .terminateCancel
    }

    // MARK: Web bridge

    private func js(_ source: String) {
        webView.evaluateJavaScript(source, completionHandler: nil)
    }

    private func fileInfo(_ url: URL) -> [String: Any] {
        ["name": url.lastPathComponent, "path": url.path, "url": scheme.register(url)]
    }

    private func openInWeb(_ urls: [URL]) {
        guard !urls.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: urls.map(fileInfo)),
              let json = String(data: data, encoding: .utf8) else { return }
        for url in urls { NSDocumentController.shared.noteNewRecentDocumentURL(url) }
        js("App.nativeOpen(\(json))")
    }

    private func showError(_ text: String, _ error: Error) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = text
        alert.informativeText = error.localizedDescription
        alert.runModal()
    }

    private func write(_ data: Data, to url: URL, reply: @escaping (Any?, String?) -> Void) {
        do {
            try data.write(to: url, options: .atomic)
            reply(["ok": true, "path": url.path, "name": url.lastPathComponent], nil)
        } catch {
            showError("The file could not be saved.", error)
            reply(["ok": false], nil)
        }
    }

    private func savePanel(name: String, type: UTType, data: Data, reply: @escaping (Any?, String?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.allowedContentTypes = [type]
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { response in
            if response == .OK, let url = panel.url {
                self.write(data, to: url, reply: reply)
            } else {
                reply(["ok": false], nil)
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
            replyHandler(nil, nil)
            return
        }
        switch cmd {
        case "ready":
            ready = true
            let urls = pending
            pending = []
            openInWeb(urls)
            replyHandler(true, nil)
        case "title":
            window.title = (body["title"] as? String) ?? "Markline"
            anyDirty = (body["dirty"] as? Bool) ?? false
            window.isDocumentEdited = anyDirty
            replyHandler(true, nil)
        case "pick":
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [.pdf]
            panel.allowsMultipleSelection = true
            panel.canChooseDirectories = false
            panel.beginSheetModal(for: window) { response in
                let urls = response == .OK ? panel.urls : []
                for url in urls { NSDocumentController.shared.noteNewRecentDocumentURL(url) }
                replyHandler(urls.map(self.fileInfo), nil)
            }
        case "save":
            guard let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else {
                replyHandler(["ok": false], nil)
                return
            }
            if let path = body["path"] as? String, !path.isEmpty {
                write(data, to: URL(fileURLWithPath: path), reply: replyHandler)
            } else {
                savePanel(name: (body["name"] as? String) ?? "Untitled.pdf", type: .pdf, data: data, reply: replyHandler)
            }
        case "saveText":
            let text = (body["text"] as? String) ?? ""
            savePanel(name: (body["name"] as? String) ?? "markups.csv", type: .commaSeparatedText,
                      data: Data(text.utf8), reply: replyHandler)
        default:
            replyHandler(nil, nil)
        }
    }

    // MARK: WebKit delegates

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, url.scheme == "markline" || url.scheme == "about" || url.scheme == "blob" {
            decisionHandler(.allow)
        } else {
            if let url = navigationAction.request.url, url.scheme == "http" || url.scheme == "https" {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.pdf]
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    // MARK: Menu

    @objc private func runCommand(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        js("App.cmd('\(name)')")
    }

    private func item(_ title: String, _ command: String, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        let menuItem = NSMenuItem(title: title, action: #selector(runCommand(_:)), keyEquivalent: key)
        menuItem.keyEquivalentModifierMask = mods
        menuItem.representedObject = command
        menuItem.target = self
        return menuItem
    }

    private func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let menu = NSMenu(title: title)
            items.forEach { menu.addItem($0) }
            let holder = NSMenuItem()
            holder.submenu = menu
            main.addItem(holder)
            return menu
        }
        let sep = { NSMenuItem.separator() }

        _ = add("Markline", [
            NSMenuItem(title: "About Markline", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""),
            sep(),
            NSMenuItem(title: "Hide Markline", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"),
            NSMenuItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: ""),
            sep(),
            NSMenuItem(title: "Quit Markline", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"),
        ])
        _ = add("File", [
            item("Open…", "open", "o"),
            sep(),
            item("Close Document", "close", "w"),
            item("Save", "save", "s"),
            item("Save As…", "saveAs", "s", [.command, .shift]),
            sep(),
            item("Export Markups to CSV…", "csv", "e"),
        ])
        _ = add("Edit", [
            item("Undo", "undo", "z"),
            item("Redo", "redo", "z", [.command, .shift]),
            sep(),
            NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"),
            NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"),
            NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"),
            item("Duplicate", "duplicate", "d"),
            item("Delete", "delete"),
            item("Select All", "selectAll", "a"),
            sep(),
            item("Find…", "find", "f"),
        ])
        _ = add("View", [
            item("Zoom In", "zoomIn", "+"),
            item("Zoom Out", "zoomOut", "-"),
            item("Fit Page", "fit", "0"),
            item("Actual Size", "actual", "1"),
            sep(),
            item("Next Page", "nextPage"),
            item("Previous Page", "prevPage"),
            sep(),
            NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f"),
        ])
        main.items.last?.submenu?.items.last?.keyEquivalentModifierMask = [.command, .control]

        let tools: [(String, String)] = [
            ("Select  (V)", "select"), ("Pan  (H)", "pan"), ("-", ""),
            ("Text Box  (T)", "text"), ("Callout  (Q)", "callout"), ("Line  (L)", "line"), ("Arrow  (A)", "arrow"),
            ("Rectangle  (R)", "rect"), ("Ellipse  (E)", "ellipse"), ("Polygon  (G)", "polygon"), ("Cloud  (C)", "cloud"),
            ("Polyline  (N)", "polyline"), ("Pen  (P)", "pen"), ("Highlighter  (Y)", "hlpen"), ("Highlight Area  (I)", "highlight"), ("-", ""),
            ("Calibrate Scale  (K)", "calibrate"), ("Length  (M)", "length"), ("Polylength  (J)", "polylength"), ("Area  (S)", "area"),
            ("Perimeter  (D)", "perimeter"), ("Volume  (U)", "volume"), ("Count  (O)", "count"),
        ]
        _ = add("Tools", tools.map { $0.0 == "-" ? NSMenuItem.separator() : item($0.0, "tool:\($0.1)") })

        let windowMenu = add("Window", [
            NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"),
            NSMenuItem(title: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: ""),
        ])
        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }
}
