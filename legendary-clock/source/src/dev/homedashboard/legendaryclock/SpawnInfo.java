package dev.homedashboard.legendaryclock;

import com.pixelmonmod.pixelmon.api.config.PixelmonConfigProxy;
import com.pixelmonmod.pixelmon.api.world.TimeSegment;
import com.pixelmonmod.pixelmon.api.world.WorldTime;
import com.pixelmonmod.pixelmon.spawning.LegendarySpawner;
import com.pixelmonmod.pixelmon.spawning.PixelmonSpawning;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.GameRules;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;

/**
 * Reads Pixelmon's own spawners. Both the legendary and the mega boss spawner keep the real-world time (System ms) of their
 * next try in nextSpawnTime; when it passes, Pixelmon rolls the chance and spawns near a random player. The time of day at
 * that moment decides which legendaries can appear, so we work out what the in-game clock will say then.
 */
public final class SpawnInfo {
    private SpawnInfo() {}

    public static Network.Status status(MinecraftServer server) {
        ServerLevel level = server.overworld();
        boolean cycle = level.getGameRules().getBoolean(GameRules.RULE_DAYLIGHT);
        long day = level.getDayTime();
        var leg = PixelmonConfigProxy.getSpawningLegendary();
        var boss = PixelmonConfigProxy.getSpawningBoss();
        return new Network.Status(
                timer(PixelmonSpawning.legendarySpawner, leg.isAllowLegendarySpawn(), leg.getLegendarySpawnChance(), day, cycle),
                timer(PixelmonSpawning.megaBossSpawner, true, boss.getBossSpawnChance(), day, cycle),
                times(day), cycle);
    }

    private static Network.Timer timer(LegendarySpawner spawner, boolean allowed, float chance, long day, boolean cycle) {
        if (spawner == null || !allowed) return new Network.Timer(Network.OFF, chance, List.of());
        long left = Math.max(0, spawner.nextSpawnTime - System.currentTimeMillis());
        // 20 game ticks a second; a stopped daylight cycle keeps the time of day where it is.
        long then = cycle ? day + left / 50 : day;
        return new Network.Timer(left, chance, times(then));
    }

    /**
     * Pixelmon's time-of-day names that apply at this day tick (they overlap, e.g. Night and Midnight). Spawning uses
     * WorldTime.getCurrent, which reads a private table of tick segments; the per-time predicates disagree with it at the
     * edges, so we read that same table (and only fall back to the predicates if a Pixelmon update renames it).
     */
    public static List<String> times(long dayTime) {
        int t = (int) Math.floorMod(dayTime, 24000L);
        List<String> out = new ArrayList<>();
        TimeSegment[] segments = segments();
        if (segments != null) {
            for (TimeSegment s : segments) {
                if (!s.fits(t)) continue;
                for (WorldTime w : s.times()) out.add(w.name());
                return out;
            }
        }
        for (WorldTime w : WorldTime.values()) if (w.getTickCondition().test(t)) out.add(w.name());
        return out;
    }

    private static TimeSegment[] segments;
    private static boolean segmentsTried;

    private static TimeSegment[] segments() {
        if (!segmentsTried) {
            segmentsTried = true;
            try {
                Field f = WorldTime.class.getDeclaredField("SEGMENTS");
                f.setAccessible(true);
                segments = (TimeSegment[]) f.get(null);
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                segments = null;
            }
        }
        return segments;
    }
}
