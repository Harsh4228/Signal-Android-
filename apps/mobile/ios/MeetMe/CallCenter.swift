import AVFoundation
import CallKit
import Foundation
import PushKit
import React
import UIKit
import UserNotifications
#if canImport(WebRTC)
import WebRTC
#endif

/**
 * Wake-ups and the phone's own call screen on iPhone (the Android side is CallNotificationModule.kt).
 *
 * The CellMate server talks to Apple directly (no Firebase on iPhone). A push never carries who or what:
 * - "New message": a normal notification with that text; opening CellMate connects and decrypts.
 * - "Incoming call": a VoIP push. iOS requires the app to show the call screen (CallKit) at once, so it rings as
 *   "CellMate" over the lock screen; the JavaScript then connects, learns who is calling and updates the name.
 *
 * Created when the app starts (AppDelegate), so a VoIP push that launches the app is handled even before React runs.
 */
final class CallCenter: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
  static let shared = CallCenter()

  private let registry = PKPushRegistry(queue: .main)
  private let provider: CXProvider
  private let controller = CXCallController()
  private(set) var alertToken: String?
  private(set) var voipToken: String?
  private var tokenWaiters: [() -> Void] = []

  /** The call on the phone's call screen, if any. */
  private var current: UUID?
  /** "answer" / "decline" pressed before the JavaScript was listening (the app was still starting). */
  private var pending: String?
  /** Set by the React module while it listens. */
  var emit: ((String) -> Void)?

  private override init() {
    let config = CXProviderConfiguration()
    config.supportsVideo = true
    config.maximumCallGroups = 1
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.generic]
    config.includesCallsInRecents = false // the Phone app's list is outside CellMate's encryption
    if let icon = UIImage(named: "CallIcon") { config.iconTemplateImageData = icon.pngData() }
    provider = CXProvider(configuration: config)
    super.init()
    provider.setDelegate(self, queue: .main)
  }

  func start() {
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
  }

  // MARK: tokens

  /** The answer to registerForRemoteNotifications came (a token or an error). */
  private var alertAnswered = false

  func gotAlertToken(_ data: Data) {
    alertToken = data.map { String(format: "%02x", $0) }.joined()
    alertAnswered = true
    flushWaiters()
  }

  func failedAlertToken() {
    alertAnswered = true
    flushWaiters()
  }

  /** Asks for notification permission, registers, and calls back once the tokens are known (or after 10 s). */
  func tokens(_ done: @escaping ([String: Any]) -> Void) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
      DispatchQueue.main.async {
        var finished = false
        let finish = {
          if finished { return }
          finished = true
          var out: [String: Any] = ["granted": granted]
          #if DEBUG
          out["env"] = "sandbox"
          #else
          out["env"] = "production"
          #endif
          if granted, let a = self.alertToken { out["alert"] = a }
          if let v = self.voipToken { out["voip"] = v }
          done(out)
        }
        if !granted { self.alertAnswered = true }
        self.tokenWaiters.append(finish)
        if granted { UIApplication.shared.registerForRemoteNotifications() }
        self.flushWaiters()
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { finish() }
      }
    }
  }

  private func flushWaiters() {
    guard alertAnswered, voipToken != nil else { return }
    let waiting = tokenWaiters
    tokenWaiters = []
    waiting.forEach { $0() }
  }

  func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
    voipToken = credentials.token.map { String(format: "%02x", $0) }.joined()
    flushWaiters()
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    voipToken = nil
  }

  // MARK: incoming call push

  func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    // iOS ends the app (and stops VoIP pushes) unless every VoIP push shows the call screen right away.
    let id = UUID()
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: "CellMate")
    update.localizedCallerName = "CellMate"
    update.hasVideo = false
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    let busy = current != nil
    if !busy {
      current = id
      pending = nil
    }
    provider.reportNewIncomingCall(with: id, update: update) { error in
      if busy || error != nil {
        // Already in a call (or Do Not Disturb refused it): drop this one at once.
        self.provider.reportCall(with: id, endedAt: nil, reason: .unanswered)
        if !busy && self.current == id { self.current = nil }
      } else {
        self.send("incoming")
      }
      completion()
    }
  }

  /**
   * A call came over the open connection while CellMate is in the background (no push needed): ring on the
   * phone's call screen with the caller's name.
   */
  func showIncoming(name: String, video: Bool) {
    guard current == nil else { return update(name: name, video: video) }
    let id = UUID()
    current = id
    pending = nil
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: name)
    update.localizedCallerName = name
    update.hasVideo = video
    provider.reportNewIncomingCall(with: id, update: update) { error in
      if error != nil && self.current == id { self.current = nil }
    }
  }

  /** Who is calling, once the app has connected and the call itself has arrived. */
  func update(name: String, video: Bool) {
    guard let id = current else { return }
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: name)
    update.localizedCallerName = name
    update.hasVideo = video
    provider.reportCall(with: id, updated: update)
  }

  /** Answered inside the app: the phone's call screen stops ringing and holds the call (audio, lock screen). */
  func answer() {
    guard let id = current else { return }
    controller.request(CXTransaction(action: CXAnswerCallAction(call: id))) { _ in }
  }

  /** The call is over (or never arrived): take it off the phone's call screen. */
  func end() {
    guard let id = current else { return }
    current = nil
    pending = nil
    provider.reportCall(with: id, endedAt: nil, reason: .remoteEnded)
  }

  func takePending() -> String? {
    defer { pending = nil }
    return pending
  }

  private func send(_ action: String) {
    if let emit = emit { emit(action) } else { pending = action }
  }

  // MARK: CXProviderDelegate

  func providerDidReset(_ provider: CXProvider) {
    if current != nil { send("decline") }
    current = nil
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    send("answer")
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    if current == action.callUUID {
      current = nil
      send("decline") // declined while ringing, or hung up from the call screen
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    send(action.isMuted ? "mute" : "unmute")
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    #if canImport(WebRTC)
    RTCAudioSession.sharedInstance().audioSessionDidActivate(audioSession)
    RTCAudioSession.sharedInstance().isAudioEnabled = true
    #endif
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    #if canImport(WebRTC)
    RTCAudioSession.sharedInstance().audioSessionDidDeactivate(audioSession)
    #endif
  }
}

/** The JavaScript side: src/push.ts (tokens) and src/callNotify.ts (the call screen). */
@objc(ApplePush)
class ApplePush: RCTEventEmitter {
  private var listening = false

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["ApplePushAction"] }

  override func startObserving() {
    listening = true
    DispatchQueue.main.async {
      CallCenter.shared.emit = { [weak self] action in
        guard let self = self, self.listening else { return }
        self.sendEvent(withName: "ApplePushAction", body: action)
      }
    }
  }

  override func stopObserving() {
    listening = false
    DispatchQueue.main.async { CallCenter.shared.emit = nil }
  }

  @objc func getTokens(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async { CallCenter.shared.tokens { resolve($0) } }
  }

  @objc func updateCall(_ name: String, video: Bool) {
    DispatchQueue.main.async { CallCenter.shared.update(name: name, video: video) }
  }

  @objc func showCall(_ name: String, video: Bool) {
    DispatchQueue.main.async { CallCenter.shared.showIncoming(name: name, video: video) }
  }

  @objc func answerCall() {
    DispatchQueue.main.async { CallCenter.shared.answer() }
  }

  @objc func endCall() {
    DispatchQueue.main.async { CallCenter.shared.end() }
  }

  @objc func takePendingAction(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async { resolve(CallCenter.shared.takePending()) }
  }

  @objc func clearBadge() {
    DispatchQueue.main.async {
      UIApplication.shared.applicationIconBadgeNumber = 0
      UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    }
  }
}
