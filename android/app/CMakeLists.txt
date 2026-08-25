cmake_minimum_required(VERSION 3.22.1)
project(rivertable)

# The Node.js for Mobile shared library, fetched by tools/prepare.sh.
include_directories(libnode/include/node/)
add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES IMPORTED_LOCATION
  ${CMAKE_SOURCE_DIR}/libnode/bin/${ANDROID_ABI}/libnode.so)

add_library(native-lib SHARED src/main/cpp/native-lib.cpp)
find_library(log-lib log)
target_link_libraries(native-lib libnode ${log-lib})
