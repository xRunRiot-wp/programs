package dev.homedashboard.legendaryclock;

import com.pixelmonmod.pixelmon.api.world.WorldTime;
import com.pixelmonmod.pixelmon.spawning.PixelmonSpawning;
import io.netty.buffer.Unpooled;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

import java.util.List;

/** Only with -Dlegendaryclock.selftest: reads Pixelmon's spawners on a dedicated server, checks the time-of-day maths, then stops it. */
final class SelfTest {
    private SelfTest() {}

    private static int ticks;

    static void run(ServerTickEvent.Post e) {
        if (++ticks != 200) return; // give Pixelmon's spawner coordinator time to start
        String tag = "[legendaryclock selftest] ";
        try {
            var server = e.getServer();
            ServerLevel level = server.overworld();
            var rid = ResourceLocation.fromNamespaceAndPath(LegendaryClock.MODID, "legendary_clock");
            System.out.println(tag + "recipe: " + (server.getRecipeManager().byKey(rid).isPresent() ? "ok" : "MISSING"));
            System.out.println(tag + "spawners: legendary=" + (PixelmonSpawning.legendarySpawner != null) + " boss=" + (PixelmonSpawning.megaBossSpawner != null));

            // Our time-of-day list for any tick must match Pixelmon's own answer for the world at that tick.
            long saved = level.getDayTime();
            int mismatches = 0;
            for (long t = 0; t < 24000; t++) {
                level.setDayTime(t);
                List<String> ours = SpawnInfo.times(t);
                List<String> theirs = WorldTime.getCurrent(level).stream().map(Enum::name).toList();
                if (!new java.util.HashSet<>(ours).equals(new java.util.HashSet<>(theirs))) {
                    if (mismatches++ < 5) System.out.println(tag + "mismatch at " + t + ": ours=" + ours + " pixelmon=" + theirs);
                }
            }
            level.setDayTime(saved);
            System.out.println(tag + "times match Pixelmon: " + (mismatches == 0) + " (" + mismatches + " mismatches)");
            System.out.println(tag + "night 18000 = " + SpawnInfo.times(18000) + ", dawn 23000 = " + SpawnInfo.times(23000) + ", noon 6000 = " + SpawnInfo.times(6000));

            Network.Status s = SpawnInfo.status(server);
            System.out.println(tag + "status: " + s);
            FriendlyByteBuf buf = new FriendlyByteBuf(Unpooled.buffer());
            Network.Status.CODEC.encode(buf, s);
            System.out.println(tag + "packet round trip: " + s.equals(Network.Status.CODEC.decode(buf)));
            if (ClockFinder.curiosLoaded()) {
                var p = net.neoforged.neoforge.common.util.FakePlayerFactory.get(level, new com.mojang.authlib.GameProfile(java.util.UUID.randomUUID(), "ClockTest"));
                System.out.println(tag + "curios: " + CuriosCompat.check(p));
            } else {
                System.out.println(tag + "curios: not installed on this server");
            }
            System.out.println(tag + "DONE");
        } catch (Throwable t) {
            System.out.println(tag + "FAILED " + t);
            t.printStackTrace(System.out);
        }
        e.getServer().halt(false);
    }
}
