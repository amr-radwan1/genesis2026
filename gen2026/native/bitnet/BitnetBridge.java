package com.anonymous.gen2026;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.module.annotations.ReactModule;

@ReactModule(name = BitnetBridge.NAME)
public class BitnetBridge extends ReactContextBaseJavaModule {
    static final String NAME = "BitnetBridge";

    static {
        System.loadLibrary("bitnet_jni");
    }

    public BitnetBridge(ReactApplicationContext context) {
        super(context);
    }

    @Override
    @NonNull
    public String getName() {
        return NAME;
    }

    // ---- JNI declarations ----
    private static native boolean nativeInitBackend();
    private static native boolean nativeLoadModel(String modelPath, int contextLength, int threadCount);
    private static native String nativeGenerate(String prompt, int maxTokens, float temperature, float topP);
    private static native double nativeGetLastTokensPerSecond();
    private static native boolean nativeRelease();
    private static native boolean nativeIsLoaded();

    @ReactMethod
    public void initBackend(Promise promise) {
        try {
            boolean ok = nativeInitBackend();
            promise.resolve(ok);
        } catch (Exception e) {
            promise.reject("BITNET_INIT_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void loadModel(String modelPath, int contextLength, int threadCount, Promise promise) {
        new Thread(() -> {
            try {
                // Strip file:// prefix if present (Expo FileSystem URIs)
                String cleanPath = modelPath;
                if (cleanPath.startsWith("file://")) {
                    cleanPath = cleanPath.substring(7);
                }

                boolean ok = nativeLoadModel(cleanPath, contextLength, threadCount);
                if (ok) {
                    promise.resolve(true);
                } else {
                    promise.reject("BITNET_LOAD_ERROR", "Failed to load BitNet model");
                }
            } catch (Exception e) {
                promise.reject("BITNET_LOAD_ERROR", e.getMessage(), e);
            }
        }).start();
    }

    @ReactMethod
    public void generate(String prompt, int maxTokens, double temperature, double topP, Promise promise) {
        new Thread(() -> {
            try {
                String text = nativeGenerate(prompt, maxTokens, (float) temperature, (float) topP);
                double tps = nativeGetLastTokensPerSecond();

                WritableMap result = Arguments.createMap();
                result.putString("text", text != null ? text : "");
                result.putDouble("tokensPerSecond", tps);
                promise.resolve(result);
            } catch (Exception e) {
                promise.reject("BITNET_GENERATE_ERROR", e.getMessage(), e);
            }
        }).start();
    }

    @ReactMethod
    public void release(Promise promise) {
        try {
            boolean ok = nativeRelease();
            promise.resolve(ok);
        } catch (Exception e) {
            promise.reject("BITNET_RELEASE_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void isLoaded(Promise promise) {
        try {
            boolean loaded = nativeIsLoaded();
            promise.resolve(loaded);
        } catch (Exception e) {
            promise.reject("BITNET_STATUS_ERROR", e.getMessage(), e);
        }
    }
}
