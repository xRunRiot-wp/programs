#!/bin/sh
# Builds pixeldexoverlay-<version>.jar against the pack's NeoForge 1.21.1 client + libraries.
set -e
cd "$(dirname "$0")"
MC=..
JDK=$(ls -d $MC/tools/jdk-21*)
L=$MC/.minecraft/libraries
rm -rf build && mkdir -p build/classes
{ echo "$L/net/neoforged/neoforge/21.1.248/neoforge-21.1.248-client.jar"; echo "$L/net/minecraft/client/1.21.1-20240808.144430/client-1.21.1-20240808.144430-srg.jar";
  find "$(cygpath -u "$APPDATA")/.minecraft/libraries/org/joml" "$(cygpath -u "$APPDATA")/.minecraft/libraries/org/lwjgl" "$(cygpath -u "$APPDATA")/.minecraft/libraries/com/mojang/brigadier" "$(cygpath -u "$APPDATA")/.minecraft/libraries/com/mojang/datafixerupper" "$(cygpath -u "$APPDATA")/.minecraft/libraries/io/netty" "$(cygpath -u "$APPDATA")/.minecraft/libraries/it/unimi" -name "*.jar" | grep -v natives | while read f; do cygpath -w "$f"; done; find "$L" -name "*.jar" | grep -v -- "-extra.jar\|-slim.jar\|-srg.jar\|neoforge-21.1.248-client.jar\|/net/minecraft/client/1.16" ; } | tr '\n' ';' > build/cp.txt
"$JDK/bin/javac" -nowarn -encoding UTF-8 --release 21 -cp "$(cat build/cp.txt)" -d build/classes $(find src -name "*.java")
cp -r resources/* build/classes/
VER=$(grep '^version=' resources/META-INF/neoforge.mods.toml | head -1 | cut -d'"' -f2)
"$JDK/bin/jar" --create --file "build/pixeldexoverlay-$VER.jar" -C build/classes .
echo "built build/pixeldexoverlay-$VER.jar"
