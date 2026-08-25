// The bridge to the Node.js for Mobile shared library. It does two things:
// it hands node its argv, and it sends node's stdout and stderr to logcat.
// Adapted from the nodejs-mobile-samples native-gradle sample.
#include <jni.h>
#include <string>
#include <cstdlib>
#include <cstring>
#include <pthread.h>
#include <unistd.h>
#include <android/log.h>
#include "node.h"

static const char *LOGTAG = "RiverTable-node";
static int pipe_stdout[2];
static int pipe_stderr[2];
static pthread_t thread_stdout;
static pthread_t thread_stderr;

static void *pump(int fd, int prio) {
  ssize_t n;
  char buf[2048];
  while ((n = read(fd, buf, sizeof buf - 1)) > 0) {
    if (buf[n - 1] == '\n') --n;                 // the log adds its own
    buf[n] = 0;
    __android_log_write(prio, LOGTAG, buf);
  }
  return 0;
}
static void *thread_stdout_func(void *) { return pump(pipe_stdout[0], ANDROID_LOG_INFO); }
static void *thread_stderr_func(void *) { return pump(pipe_stderr[0], ANDROID_LOG_ERROR); }

static int redirect_output() {
  setvbuf(stdout, 0, _IONBF, 0);
  if (pipe(pipe_stdout) == -1) return -1;
  dup2(pipe_stdout[1], STDOUT_FILENO);
  setvbuf(stderr, 0, _IONBF, 0);
  if (pipe(pipe_stderr) == -1) return -1;
  dup2(pipe_stderr[1], STDERR_FILENO);
  if (pthread_create(&thread_stdout, 0, thread_stdout_func, 0) != 0) return -1;
  pthread_detach(thread_stdout);
  if (pthread_create(&thread_stderr, 0, thread_stderr_func, 0) != 0) return -1;
  pthread_detach(thread_stderr);
  return 0;
}

// libuv wants every argument in one block of memory.
extern "C" JNIEXPORT jint JNICALL
Java_com_chrisjtwomey_rivertable_NodeService_startNode(
    JNIEnv *env, jobject, jobjectArray arguments) {
  jsize argc = env->GetArrayLength(arguments);

  size_t total = 0;
  for (int i = 0; i < argc; i++) {
    jstring s = (jstring) env->GetObjectArrayElement(arguments, i);
    const char *c = env->GetStringUTFChars(s, 0);
    total += strlen(c) + 1;
    env->ReleaseStringUTFChars(s, c);
    env->DeleteLocalRef(s);
  }

  char *buffer = (char *) calloc(total, sizeof(char));
  char **argv = (char **) calloc(argc + 1, sizeof(char *));
  char *at = buffer;
  for (int i = 0; i < argc; i++) {
    jstring s = (jstring) env->GetObjectArrayElement(arguments, i);
    const char *c = env->GetStringUTFChars(s, 0);
    strcpy(at, c);
    argv[i] = at;
    at += strlen(c) + 1;
    env->ReleaseStringUTFChars(s, c);
    env->DeleteLocalRef(s);
  }

  if (redirect_output() == -1) {
    __android_log_write(ANDROID_LOG_ERROR, LOGTAG, "cannot send node's output to logcat");
  }
  return jint(node::Start(argc, argv));
}

// Sets a variable in node's own environment, before node starts. The server
// reads PORT, DATA_DIR and NO_TLS from there.
extern "C" JNIEXPORT void JNICALL
Java_com_chrisjtwomey_rivertable_NodeService_setEnv(
    JNIEnv *env, jobject, jstring name, jstring value) {
  const char *n = env->GetStringUTFChars(name, 0);
  const char *v = env->GetStringUTFChars(value, 0);
  setenv(n, v, 1);
  env->ReleaseStringUTFChars(name, n);
  env->ReleaseStringUTFChars(value, v);
}
