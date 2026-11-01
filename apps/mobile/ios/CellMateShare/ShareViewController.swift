import UIKit
import UniformTypeIdentifiers

/**
 * "Share" from WhatsApp, Photos, Files...: CellMate appears in the list. This extension only copies what was shared
 * into the App Group folder shared with CellMate (ShareInbox) and opens CellMate, where the person chooses the
 * chats and sends it end-to-end encrypted. Nothing is uploaded from here.
 */
@objc(ShareViewController)
class ShareViewController: UIViewController {
  static let appGroup = "group.com.gosite.cellmate"
  private var started = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor.black.withAlphaComponent(0.25)
    let spinner = UIActivityIndicatorView(style: .large)
    spinner.color = .white
    spinner.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(spinner)
    NSLayoutConstraint.activate([spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor), spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
    spinner.startAnimating()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    if started { return }
    started = true
    collect()
  }

  private func collect() {
    guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ShareViewController.appGroup) else {
      return done(opened: false)
    }
    let inbox = base.appendingPathComponent("ShareInbox", isDirectory: true)
    try? FileManager.default.removeItem(at: inbox)
    try? FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    var files: [[String: Any]] = []
    var texts: [String] = []
    let lock = NSLock()
    let group = DispatchGroup()
    let fileTypes: [UTType] = [.fileURL, .image, .movie, .audio, .pdf]

    for (i, p) in providers.prefix(20).enumerated() {
      let fileType = fileTypes.first { p.hasItemConformingToTypeIdentifier($0.identifier) }
      if fileType == nil, p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
        group.enter()
        p.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
          if let u = item as? URL {
            lock.lock()
            texts.append(u.absoluteString)
            lock.unlock()
          }
          group.leave()
        }
        continue
      }
      if fileType == nil, p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
        group.enter()
        p.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
          if let t = item as? String, !t.isEmpty {
            lock.lock()
            texts.append(t)
            lock.unlock()
          }
          group.leave()
        }
        continue
      }
      let type = fileType ?? (p.hasItemConformingToTypeIdentifier(UTType.data.identifier) ? UTType.data : nil)
      guard let type else { continue }
      group.enter()
      p.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
        defer { group.leave() }
        guard let url else { return }
        var name = p.suggestedName ?? url.lastPathComponent
        if (name as NSString).pathExtension.isEmpty, !url.pathExtension.isEmpty { name += ".\(url.pathExtension)" }
        name = name.replacingOccurrences(of: "/", with: "_")
        let stored = "\(i)-\(name)"
        let dest = inbox.appendingPathComponent(stored)
        do {
          try FileManager.default.copyItem(at: url, to: dest)
        } catch {
          return
        }
        let ext = (name as NSString).pathExtension
        let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? type.preferredMIMEType ?? "application/octet-stream"
        let size = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? NSNumber)?.doubleValue ?? -1
        lock.lock()
        files.append(["file": stored, "name": name, "mime": mime, "size": size])
        lock.unlock()
      }
    }

    group.notify(queue: .main) {
      if files.isEmpty && texts.isEmpty { return self.done(opened: false) }
      let manifest: [String: Any] = ["files": files, "text": texts.joined(separator: "\n"), "ts": Date().timeIntervalSince1970 * 1000]
      if let data = try? JSONSerialization.data(withJSONObject: manifest) {
        try? data.write(to: inbox.appendingPathComponent("manifest.json"))
      }
      self.done(opened: self.openCellMate())
    }
  }

  /** Opens CellMate (it picks the shared items up from ShareInbox as soon as it is in front). */
  private func openCellMate() -> Bool {
    guard let url = URL(string: "cellmate://share") else { return false }
    var responder: UIResponder? = self
    while let r = responder {
      if let app = r as? UIApplication {
        app.open(url, options: [:], completionHandler: nil)
        return true
      }
      responder = r.next
    }
    return false
  }

  private func done(opened: Bool) {
    if opened {
      extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
      return
    }
    // Could not open CellMate from here: it finds what was shared the next time it is opened.
    let alert = UIAlertController(title: "CellMate", message: "Open CellMate to choose who to send it to.", preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
      self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    })
    present(alert, animated: true)
  }
}
