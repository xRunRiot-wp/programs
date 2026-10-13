package dev.homedashboard.biomecompass;

import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.biome.Biomes;
import net.neoforged.neoforge.common.util.FakePlayer;
import net.neoforged.neoforge.common.util.FakePlayerFactory;
import net.neoforged.neoforge.event.server.ServerStartedEvent;

import java.util.Optional;
import java.util.UUID;

/** Only with -Dbiomecompass.selftest: unlock/group logic, a real biome search, recipe and Curios slot on a dedicated server. */
final class SelfTest {
    private SelfTest() {}

    static void run(ServerStartedEvent e) {
        String tag = "[biomecompass selftest] ";
        try {
            ServerLevel level = e.getServer().overworld();
            System.out.println(tag + "overworld biomes: " + level.getChunkSource().getGenerator().getBiomeSource().possibleBiomes().size());
            var rid = ResourceLocation.fromNamespaceAndPath(BiomeCompass.MODID, "biome_compass");
            System.out.println(tag + "recipe: " + (e.getServer().getRecipeManager().byKey(rid).isPresent() ? "ok" : "MISSING"));

            FakePlayer a = FakePlayerFactory.get(level, new com.mojang.authlib.GameProfile(UUID.randomUUID(), "TestA"));
            FakePlayer b = FakePlayerFactory.get(level, new com.mojang.authlib.GameProfile(UUID.randomUUID(), "TestB"));
            Unlocks u = Unlocks.get(e.getServer());
            u.unlock(a, Biomes.PLAINS.location());
            u.unlock(b, Biomes.DESERT.location());
            boolean separate = u.visibleTo(a.getUUID()).size() == 1 && u.visibleTo(b.getUUID()).size() == 1;
            // join: b accepts an invite from a (invites map set directly; invite() needs a real online player)
            u.rememberName(a);
            u.rememberName(b);
            java.lang.reflect.Field f = Unlocks.class.getDeclaredField("invites");
            f.setAccessible(true);
            @SuppressWarnings("unchecked") var invites = (java.util.Map<UUID, UUID>) f.get(u);
            invites.put(b.getUUID(), a.getUUID());
            u.accept(b, "TestA");
            boolean shared = u.visibleTo(a.getUUID()).size() == 2 && u.visibleTo(b.getUUID()).size() == 2;
            u.leave(b);
            boolean keepsOwn = u.visibleTo(b.getUUID()).equals(java.util.Set.of(Biomes.DESERT.location().toString()))
                    && u.visibleTo(a.getUUID()).equals(java.util.Set.of(Biomes.PLAINS.location().toString()))
                    && !u.inGroup(a.getUUID());
            System.out.println(tag + "unlocks separate=" + separate + " groupShares=" + shared + " leaveKeepsOwnOnly=" + keepsOwn);

            // real search from spawn for the plains biome, run to completion
            var spawn = level.getSharedSpawnPos();
            a.moveTo(spawn.getX(), 100, spawn.getZ());
            ItemStack compass = new ItemStack(BiomeCompass.COMPASS.get());
            compass.set(BiomeCompass.TARGET.get(), new CompassTarget("minecraft:plains", CompassTarget.SEARCHING, Optional.empty(), 42));
            a.setItemInHand(InteractionHand.MAIN_HAND, compass);
            long t0 = System.nanoTime();
            BiomeSearch s = new BiomeSearch(a, Biomes.PLAINS, 42);
            int calls = 0;
            while (s.hasWork() && calls < 5_000_000) { s.doWork(); calls++; }
            CompassTarget result = CompassItem.target(a.getMainHandItem());
            System.out.println(tag + "search plains: state=" + result.state() + " pos=" + result.pos().map(p -> p.pos().toShortString()).orElse("-")
                    + " in " + (System.nanoTime() - t0) / 1_000_000 + " ms, " + calls + " calls");
            t0 = System.nanoTime();
            compass.set(BiomeCompass.TARGET.get(), new CompassTarget("minecraft:lush_caves", CompassTarget.SEARCHING, Optional.empty(), 43));
            s = new BiomeSearch(a, Biomes.LUSH_CAVES, 43);
            calls = 0;
            while (s.hasWork() && calls < 5_000_000) { s.doWork(); calls++; }
            result = CompassItem.target(a.getMainHandItem());
            System.out.println(tag + "search lush caves: state=" + result.state() + " pos=" + result.pos().map(p -> p.pos().toShortString()).orElse("-")
                    + " in " + (System.nanoTime() - t0) / 1_000_000 + " ms");
            if (CompassFinder.curiosLoaded()) System.out.println(tag + "curios: " + CuriosCompat.check(a));
            boolean ok = separate && shared && keepsOwn && result.state() == CompassTarget.FOUND;
            System.out.println(tag + (ok ? "PASS" : "FAIL"));
        } catch (Throwable t) {
            System.out.println(tag + "FAIL " + t);
            t.printStackTrace(System.out);
        }
    }
}
