import Foundation
import UIKit
import React

/**
 * iPhone side of the DeviceFiles module (see DeviceFilesModule.kt on Android): the ways content may leave
 * CellMate, used only when the admin allows it (the JavaScript checks the rights), plus the light / dark choice.
 */
@objc(DeviceFiles)
class DeviceFiles: NSObject {
  static let themeKey = "cellmate.theme"

  @objc static func requiresMainQueueSetup() -> Bool { false }

  /** Read once when the app starts (the colours are chosen then): "system", "light" or "dark". */
  @objc func constantsToExport() -> [AnyHashable: Any]! {
    ["theme": UserDefaults.standard.string(forKey: DeviceFiles.themeKey) ?? "system"]
  }

  /** The window follows the choice too (alerts, keyboard, pickers). Called at start and after a change. */
  static func applyTheme(to window: UIWindow?) {
    switch UserDefaults.standard.string(forKey: themeKey) {
    case "light": window?.overrideUserInterfaceStyle = .light
    case "dark": window?.overrideUserInterfaceStyle = .dark
    default: window?.overrideUserInterfaceStyle = .unspecified
    }
  }

  @objc func setTheme(_ theme: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    UserDefaults.standard.set(theme == "light" || theme == "dark" ? theme : "system", forKey: DeviceFiles.themeKey)
    resolve(nil)
  }

  /** Load the app again (to apply the new colours); iOS apps may not quit themselves. */
  @objc func restart() {
    DispatchQueue.main.async {
      DeviceFiles.applyTheme(to: DeviceFiles.appWindow)
      RCTTriggerReloadCommandListeners("theme changed")
    }
  }

  @objc func copyText(_ text: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      // Local only: never synced to the user's other Apple devices (Universal Clipboard), gone after 10 minutes.
      UIPasteboard.general.setItems([[UIPasteboard.typeAutomatic: text]], options: [
        .localOnly: true,
        .expirationDate: Date().addingTimeInterval(600),
      ])
      resolve(nil)
    }
  }

  /** iOS has no Downloads folder: the Files picker opens to choose where on the phone to keep it (no sharing to other apps). */
  @objc func saveToDownloads(_ name: String, mime: String, base64: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
      return reject("save_failed", "Could not read the file", nil)
    }
    let bad = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)
    let safe = String(String(name.unicodeScalars.map { bad.contains($0) ? "_" : Character($0) }).prefix(120))
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let file = dir.appendingPathComponent(safe.isEmpty ? "file" : safe)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try data.write(to: file, options: [.completeFileProtection])
    } catch {
      return reject("save_failed", "Could not write the file", error)
    }
    DispatchQueue.main.async {
      guard let top = DeviceFiles.topController() else {
        try? FileManager.default.removeItem(at: dir)
        return reject("save_failed", "Could not open Files", nil)
      }
      let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
      let done = SaveDone { saved in
        try? FileManager.default.removeItem(at: dir)
        if saved { resolve("Files") } else { reject("cancelled", "Not saved", nil) }
      }
      picker.delegate = done
      objc_setAssociatedObject(picker, &SaveDone.key, done, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
      top.present(picker, animated: true)
    }
  }

  static var appWindow: UIWindow? { (UIApplication.shared.delegate as? AppDelegate)?.window }

  static func topController() -> UIViewController? {
    let window = DeviceFiles.appWindow
    var top = window?.rootViewController
    while let next = top?.presentedViewController { top = next }
    return top
  }
}

/** Tells the save call how the Files picker ended; kept alive by the picker itself. */
private final class SaveDone: NSObject, UIDocumentPickerDelegate {
  static var key = 0
  private var finish: ((Bool) -> Void)?
  init(_ finish: @escaping (Bool) -> Void) { self.finish = finish }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finish?(true); finish = nil }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish?(false); finish = nil }
}
