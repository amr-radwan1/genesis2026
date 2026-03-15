#include <jni.h>
#include <string>
#include <vector>
#include <chrono>
#include <cstring>
#include <android/log.h>

#include "llama.h"

#define LOG_TAG "BitnetBridge"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

static llama_model  * g_model   = nullptr;
static llama_context * g_ctx    = nullptr;
static double g_last_tps        = 0.0;

// Inline helpers (from common.h, not in llama.h)
static void batch_clear(llama_batch & batch) {
    batch.n_tokens = 0;
}

static void batch_add(llama_batch & batch, llama_token token, llama_pos pos,
                      const std::vector<llama_seq_id> & seq_ids, bool logits) {
    batch.token   [batch.n_tokens] = token;
    batch.pos     [batch.n_tokens] = pos;
    batch.n_seq_id[batch.n_tokens] = (int32_t) seq_ids.size();
    for (size_t i = 0; i < seq_ids.size(); ++i) {
        batch.seq_id[batch.n_tokens][i] = seq_ids[i];
    }
    batch.logits  [batch.n_tokens] = logits ? 1 : 0;
    batch.n_tokens++;
}

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_anonymous_gen2026_BitnetBridge_nativeInitBackend(JNIEnv *, jclass) {
    llama_backend_init();
    LOGI("BitNet backend initialised");
    return JNI_TRUE;
}

JNIEXPORT jboolean JNICALL
Java_com_anonymous_gen2026_BitnetBridge_nativeLoadModel(
        JNIEnv *env, jclass, jstring jModelPath, jint contextLength, jint threadCount) {

    // Release previous model if any
    if (g_ctx)   { llama_free(g_ctx);        g_ctx   = nullptr; }
    if (g_model) { llama_free_model(g_model); g_model = nullptr; }

    const char *modelPath = env->GetStringUTFChars(jModelPath, nullptr);
    LOGI("Loading model: %s  ctx=%d  threads=%d", modelPath, contextLength, threadCount);

    // Model params
    llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = 0;   // CPU-only for BitNet

    g_model = llama_load_model_from_file(modelPath, mparams);
    env->ReleaseStringUTFChars(jModelPath, modelPath);

    if (!g_model) {
        LOGE("Failed to load model");
        return JNI_FALSE;
    }

    // Context params
    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx   = contextLength > 0 ? (uint32_t) contextLength : 2048;
    cparams.n_batch = 512;
    if (threadCount > 0) {
        cparams.n_threads        = threadCount;
        cparams.n_threads_batch  = threadCount;
    }

    g_ctx = llama_new_context_with_model(g_model, cparams);
    if (!g_ctx) {
        LOGE("Failed to create context");
        llama_free_model(g_model);
        g_model = nullptr;
        return JNI_FALSE;
    }

    LOGI("Model loaded successfully");
    return JNI_TRUE;
}

JNIEXPORT jstring JNICALL
Java_com_anonymous_gen2026_BitnetBridge_nativeGenerate(
        JNIEnv *env, jclass, jstring jPrompt, jint maxTokens,
        jfloat temperature, jfloat topP) {

    if (!g_model || !g_ctx) {
        return env->NewStringUTF("");
    }

    const char *promptCStr = env->GetStringUTFChars(jPrompt, nullptr);
    std::string prompt(promptCStr);
    env->ReleaseStringUTFChars(jPrompt, promptCStr);

    LOGI("Generating max=%d temp=%.2f topP=%.2f prompt_len=%zu",
         maxTokens, temperature, topP, prompt.size());

    // Tokenize — this API takes llama_model*, not llama_vocab*
    int n_prompt_max = (int) prompt.size() + 32;
    std::vector<llama_token> tokens(n_prompt_max);
    int n_tokens = llama_tokenize(g_model, prompt.c_str(), (int32_t) prompt.size(),
                                  tokens.data(), n_prompt_max, true, true);
    if (n_tokens < 0) {
        n_prompt_max = -n_tokens;
        tokens.resize(n_prompt_max);
        n_tokens = llama_tokenize(g_model, prompt.c_str(), (int32_t) prompt.size(),
                                  tokens.data(), n_prompt_max, true, true);
    }
    tokens.resize(n_tokens);
    LOGI("Tokenized to %d tokens", n_tokens);

    // Clear KV cache
    llama_kv_cache_clear(g_ctx);

    // Create batch and process prompt
    llama_batch batch = llama_batch_init(512, 0, 1);

    // Feed prompt tokens
    for (int i = 0; i < n_tokens; i++) {
        batch_add(batch, tokens[i], i, {0}, false);
    }
    // Request logits for last prompt token
    batch.logits[batch.n_tokens - 1] = 1;

    if (llama_decode(g_ctx, batch) != 0) {
        LOGE("Failed to decode prompt");
        llama_batch_free(batch);
        return env->NewStringUTF("");
    }

    // Sampling setup
    llama_sampler * smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(temperature));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_p(topP, 1));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(0));

    // Generation loop
    std::string result;
    int n_decode = 0;
    auto t_start = std::chrono::high_resolution_clock::now();

    for (int i = 0; i < maxTokens; i++) {
        llama_token new_token = llama_sampler_sample(smpl, g_ctx, -1);

        // Uses llama_model*, not llama_vocab*
        if (llama_token_is_eog(g_model, new_token)) {
            LOGI("EOS reached at token %d", i);
            break;
        }

        // Convert token to text — uses llama_model*
        char buf[256];
        int n = llama_token_to_piece(g_model, new_token, buf, sizeof(buf), 0, true);
        if (n > 0) {
            result.append(buf, n);
        }
        n_decode++;

        // Prepare next batch
        batch_clear(batch);
        batch_add(batch, new_token, n_tokens + i, {0}, true);

        if (llama_decode(g_ctx, batch) != 0) {
            LOGE("Failed to decode at step %d", i);
            break;
        }
    }

    auto t_end = std::chrono::high_resolution_clock::now();
    double elapsed = std::chrono::duration<double>(t_end - t_start).count();
    g_last_tps = (elapsed > 0.001 && n_decode > 0) ? (n_decode / elapsed) : 0.0;

    LOGI("Generated %d tokens in %.2fs (%.1f tok/s)", n_decode, elapsed, g_last_tps);

    llama_sampler_free(smpl);
    llama_batch_free(batch);

    return env->NewStringUTF(result.c_str());
}

JNIEXPORT jdouble JNICALL
Java_com_anonymous_gen2026_BitnetBridge_nativeGetLastTokensPerSecond(JNIEnv *, jclass) {
    return g_last_tps;
}

JNIEXPORT jboolean JNICALL
Java_com_anonymous_gen2026_BitnetBridge_nativeRelease(JNIEnv *, jclass) {
    if (g_ctx)   { llama_free(g_ctx);        g_ctx   = nullptr; }
    if (g_model) { llama_free_model(g_model); g_model = nullptr; }
    llama_backend_free();
    g_last_tps = 0.0;
    LOGI("Released model and backend");
    return JNI_TRUE;
}

JNIEXPORT jboolean JNICALL
Java_com_anonymous_gen2026_BitnetBridge_nativeIsLoaded(JNIEnv *, jclass) {
    return (g_model != nullptr && g_ctx != nullptr) ? JNI_TRUE : JNI_FALSE;
}

} // extern "C"
