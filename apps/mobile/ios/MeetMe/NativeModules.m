// Registers the Swift modules (DeviceFiles.swift, CallCenter.swift) with React Native.
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(DeviceFiles, NSObject)
RCT_EXTERN_METHOD(setTheme:(NSString *)theme resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(restart)
RCT_EXTERN_METHOD(copyText:(NSString *)text resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(saveToDownloads:(NSString *)name mime:(NSString *)mime base64:(NSString *)base64 resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end

@interface RCT_EXTERN_MODULE(ApplePush, RCTEventEmitter)
RCT_EXTERN_METHOD(getTokens:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(showCall:(NSString *)name video:(BOOL)video)
RCT_EXTERN_METHOD(updateCall:(NSString *)name video:(BOOL)video)
RCT_EXTERN_METHOD(answerCall)
RCT_EXTERN_METHOD(endCall)
RCT_EXTERN_METHOD(takePendingAction:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(clearBadge)
@end
