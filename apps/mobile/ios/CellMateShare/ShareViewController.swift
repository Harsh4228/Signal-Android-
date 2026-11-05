import UIKit
import UniformTypeIdentifiers
import UserNotifications

/** One chat or colleague to send to, from the list the app keeps (names only, no messages). */
private struct Target: Decodable {
  let key: String
  let title: String
  let sub: String
  let group: Bool
  let files: Bool
  let chat: Bool
}

/**
 * "Share" from WhatsApp, Photos, Files...: CellMate appears in the list and shows, like WhatsApp, the chats and the
 * people of the company to pick from, with a caption. What was shared is copied into the folder shared with CellMate
 * (ShareInbox) with the chosen chats; CellMate sends it end-to-end encrypted as soon as it is opened (iOS doesn't
 * let an app run in the background for this), so a notification "Tap to send" opens it. Nothing is uploaded from here.
 * Before the app has written its list (first start after the update) it falls back to: open CellMate and choose there.
 */
@objc(ShareViewController)
class ShareViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, UISearchBarDelegate {
  static let appGroup = "group.com.gosite.cellmate"

  private var inbox: URL?
  private var targets: [Target] = []
  private var sections: [[Target]] = [[], []]
  private var picked: [String] = []
  private var files: [[String: Any]] = []
  private var texts: [String] = []
  private var collecting = true
  private var started = false

  private let navBar = UINavigationBar()
  private let navItem = UINavigationItem(title: "Send to…")
  private let summary = UILabel()
  private let caption = UITextField()
  private let search = UISearchBar()
  private let table = UITableView(frame: .zero, style: .insetGrouped)
  private let spinner = UIActivityIndicatorView(style: .large)

  // ---------------------------------------------------------------- layout

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemGroupedBackground
    targets = loadTargets()

    navItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(cancel))
    navItem.rightBarButtonItem = UIBarButtonItem(title: "Send", style: .done, target: self, action: #selector(send))
    navItem.rightBarButtonItem?.isEnabled = false
    navBar.items = [navItem]

    summary.font = .preferredFont(forTextStyle: .subheadline)
    summary.textColor = .secondaryLabel
    summary.numberOfLines = 2
    summary.text = "Preparing…"

    caption.placeholder = "Add a message (optional)"
    caption.borderStyle = .roundedRect
    caption.backgroundColor = .secondarySystemGroupedBackground
    caption.returnKeyType = .done
    caption.addTarget(caption, action: #selector(UIResponder.resignFirstResponder), for: .editingDidEndOnExit)

    search.placeholder = "Search name, ID or department"
    search.searchBarStyle = .minimal
    search.delegate = self

    table.dataSource = self
    table.delegate = self
    table.keyboardDismissMode = .onDrag
    table.register(UITableViewCell.self, forCellReuseIdentifier: "t")

    for v in [navBar, summary, caption, search, table, spinner] as [UIView] {
      v.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(v)
    }
    let g = view.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      navBar.topAnchor.constraint(equalTo: g.topAnchor),
      navBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      navBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      summary.topAnchor.constraint(equalTo: navBar.bottomAnchor, constant: 8),
      summary.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 16),
      summary.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -16),
      caption.topAnchor.constraint(equalTo: summary.bottomAnchor, constant: 8),
      caption.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 16),
      caption.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -16),
      caption.heightAnchor.constraint(greaterThanOrEqualToConstant: 40),
      search.topAnchor.constraint(equalTo: caption.bottomAnchor, constant: 4),
      search.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 8),
      search.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -8),
      table.topAnchor.constraint(equalTo: search.bottomAnchor),
      table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      table.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
    let hasList = !targets.isEmpty
    for v in [summary, caption, search, table] as [UIView] { v.isHidden = !hasList }
    if !hasList { spinner.startAnimating() }
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    if started { return }
    started = true
    collect()
  }

  /** The list the app keeps in the shared folder (written by CellMate whenever chats change). */
  private func loadTargets() -> [Target] {
    guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ShareViewController.appGroup),
          let data = try? Data(contentsOf: base.appendingPathComponent("ShareTargets.json")),
          let list = try? JSONDecoder().decode([Target].self, from: data) else { return [] }
    return list
  }

  // ---------------------------------------------------------------- what was shared

  private func collect() {
    guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ShareViewController.appGroup) else {
      return finishWithoutList()
    }
    let inbox = base.appendingPathComponent("ShareInbox", isDirectory: true)
    self.inbox = inbox
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
      self.files = files
      self.texts = texts
      self.collecting = false
      if files.isEmpty && texts.isEmpty {
        return self.finish(message: "Nothing that CellMate can send was shared.")
      }
      if self.targets.isEmpty { return self.finishWithoutList() }
      if self.caption.text?.isEmpty ?? true, files.isEmpty == false { self.caption.text = texts.joined(separator: "\n") }
      self.summary.text = self.describe()
      self.refilter()
    }
  }

  /** "2 photos, 1 document" / the start of the text. */
  private func describe() -> String {
    if files.isEmpty { return texts.joined(separator: " ").prefix(120).description }
    let mimes = files.compactMap { $0["mime"] as? String }
    let photos = mimes.filter { $0.hasPrefix("image/") }.count
    let videos = mimes.filter { $0.hasPrefix("video/") }.count
    let other = mimes.count - photos - videos
    var parts: [String] = []
    if photos > 0 { parts.append("\(photos) photo\(photos == 1 ? "" : "s")") }
    if videos > 0 { parts.append("\(videos) video\(videos == 1 ? "" : "s")") }
    if other > 0 { parts.append("\(other) file\(other == 1 ? "" : "s")") }
    return parts.joined(separator: ", ")
  }

  // ---------------------------------------------------------------- list

  private func refilter() {
    let q = (search.text ?? "").trimmingCharacters(in: .whitespaces).lowercased()
    let usable = targets.filter { (files.isEmpty || $0.files) && (q.isEmpty || "\($0.title) \($0.sub) \($0.key)".lowercased().contains(q)) }
    sections = [usable.filter { $0.chat }, usable.filter { !$0.chat }]
    table.reloadData()
    updateSend()
  }

  private func updateSend() {
    navItem.rightBarButtonItem?.isEnabled = !picked.isEmpty && !collecting
    navItem.title = picked.isEmpty ? "Send to…" : "Send to \(picked.count)"
  }

  func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) { refilter() }
  func searchBarSearchButtonClicked(_ searchBar: UISearchBar) { searchBar.resignFirstResponder() }

  func numberOfSections(in tableView: UITableView) -> Int { 2 }
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { sections[section].count }
  func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
    sections[section].isEmpty ? nil : (section == 0 ? "Chats" : "Other people")
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let t = sections[indexPath.section][indexPath.row]
    let cell = tableView.dequeueReusableCell(withIdentifier: "t", for: indexPath)
    var content = UIListContentConfiguration.subtitleCell()
    content.text = t.title
    content.secondaryText = t.sub.isEmpty ? nil : t.sub
    content.secondaryTextProperties.color = .secondaryLabel
    content.image = UIImage(systemName: t.group ? "person.3.fill" : "person.crop.circle.fill")
    content.imageProperties.tintColor = .systemBlue
    cell.contentConfiguration = content
    cell.accessoryType = picked.contains(t.key) ? .checkmark : .none
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    let key = sections[indexPath.section][indexPath.row].key
    if let i = picked.firstIndex(of: key) { picked.remove(at: i) } else { picked.append(key) }
    tableView.reloadRows(at: [indexPath], with: .none)
    updateSend()
  }

  // ---------------------------------------------------------------- send / cancel

  @objc private func cancel() {
    if let inbox { try? FileManager.default.removeItem(at: inbox) }
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }

  @objc private func send() {
    guard let inbox, !picked.isEmpty else { return }
    let message = (caption.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    // Files: the message is their caption. Text or a link: my message goes with it (nothing shared is dropped).
    let text = files.isEmpty ? (texts + [message]).filter { !$0.isEmpty }.joined(separator: "\n") : message
    let manifest: [String: Any] = ["files": files, "text": text, "targets": picked, "ts": Date().timeIntervalSince1970 * 1000]
    if let data = try? JSONSerialization.data(withJSONObject: manifest) {
      try? data.write(to: inbox.appendingPathComponent("manifest.json"), options: .atomic)
    }
    let names = picked.compactMap { k in targets.first { $0.key == k }?.title }
    notify(body: picked.count == 1 ? "Tap to send to \(names.first ?? "the chat")" : "Tap to send to \(picked.count) chats")
    _ = openCellMate()
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }

  /** CellMate sends it when opened: this notification opens it (and is removed when CellMate opens). */
  private func notify(body: String) {
    let content = UNMutableNotificationContent()
    content.title = "CellMate"
    content.body = body
    content.sound = .default
    UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "cellmate-share", content: content, trigger: nil))
  }

  /** Tries to open CellMate right away (iOS may not allow it from a share sheet; the notification covers that). */
  private func openCellMate() -> Bool {
    guard let url = URL(string: "cellmate://share") else { return false }
    let selector = NSSelectorFromString("openURL:options:completionHandler:")
    typealias OpenURL = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, (@convention(block) (Bool) -> Void)?) -> Void
    var responder: UIResponder? = self
    while let r = responder {
      if r.responds(to: selector), let method = r.method(for: selector) {
        unsafeBitCast(method, to: OpenURL.self)(r, selector, url as NSURL, NSDictionary(), nil)
        return true
      }
      responder = r.next
    }
    return false
  }

  /** The app has not written its chat list yet (first share after the update): choose the chats in CellMate. */
  private func finishWithoutList() {
    guard let inbox else { return finish(message: "Open CellMate to choose who to send it to.") }
    let manifest: [String: Any] = ["files": files, "text": texts.joined(separator: "\n"), "ts": Date().timeIntervalSince1970 * 1000]
    if let data = try? JSONSerialization.data(withJSONObject: manifest) {
      try? data.write(to: inbox.appendingPathComponent("manifest.json"), options: .atomic)
    }
    notify(body: "Tap to choose who to send it to")
    _ = openCellMate()
    finish(message: "Open CellMate to choose who to send it to.")
  }

  private func finish(message: String) {
    spinner.stopAnimating()
    let alert = UIAlertController(title: "CellMate", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
      self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    })
    present(alert, animated: true)
  }
}
