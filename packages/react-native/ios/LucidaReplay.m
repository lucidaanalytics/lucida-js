#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (LucidaReplay, NSObject)
RCT_EXTERN_METHOD(captureWireframe : (NSDictionary *)options resolver : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(installInfo : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
// Blocking synchronous: the JS queue storage is synchronous (src/native-cipher.ts).
RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(encryptQueue : (NSString *)plain)
RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(decryptQueue : (NSString *)value)
RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(encryptSensitive : (NSString *)pkcs1 n : (NSString *)n e : (NSString *)e plain : (NSString *)plain)
@end
