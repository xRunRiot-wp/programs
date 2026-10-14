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
            a.setItemInHand(InteractionHand.MAIN_HAND, compass);
            CompassTarget plains1 = search(a, Biomes.PLAINS, java.util.List.of(), tag + "search plains");
            var p1 = plains1.pos().map(gp -> gp.pos()).orElse(null);
            CompassTarget plains2 = p1 == null ? CompassTarget.NONE : search(a, Biomes.PLAINS, java.util.List.of(p1), tag + "find next plains");
            var p2 = plains2.pos().map(gp -> gp.pos()).orElse(null);
            CompassTarget plains3 = p2 == null ? CompassTarget.NONE : search(a, Biomes.PLAINS, java.util.List.of(p1, p2), tag + "find next again");
            boolean nextOk = p2 != null && !p2.equals(p1) && plains3.pos().isPresent() && !plains3.pos().get().pos().equals(p2) && !plains3.pos().get().pos().equals(p1);
            CompassTarget result = search(a, Biomes.LUSH_CAVES, java.util.List.of(), tag + "search lush caves");
            boolean caveOk = result.cave() && !plains1.cave();
            System.out.println(tag + "lush caves marked as cave (height counts): " + result.cave() + ", plains not: " + !plains1.cave());
            // Find Undiscovered: a only has plains unlocked, so the hit must be some other biome
            java.util.Set<net.minecraft.resources.ResourceKey<net.minecraft.world.level.biome.Biome>> lockedSet = new java.util.HashSet<>();
            for (var h : level.getChunkSource().getGenerator().getBiomeSource().possibleBiomes())
                h.unwrapKey().filter(k -> !u.visibleTo(a.getUUID()).contains(k.location().toString())).ifPresent(lockedSet::add);
            a.getMainHandItem().set(BiomeCompass.TARGET.get(), new CompassTarget(BiomeCompass.UNDISCOVERED.toString(), CompassTarget.SEARCHING, Optional.empty(), 999, java.util.List.of()));
            BiomeSearch us = new BiomeSearch(a, lockedSet, BiomeCompass.UNDISCOVERED, 999, java.util.List.of());
            while (us.hasWork()) us.doWork();
            CompassTarget und = CompassItem.target(a.getMainHandItem());
            var ub = und.pos().map(gp -> level.getChunkSource().getGenerator().getBiomeSource().getNoiseBiome(
                    net.minecraft.core.QuartPos.fromBlock(gp.pos().getX()), net.minecraft.core.QuartPos.fromBlock(gp.pos().getY()), net.minecraft.core.QuartPos.fromBlock(gp.pos().getZ()),
                    level.getChunkSource().randomState().sampler()).unwrapKey().map(k -> k.location().toString()).orElse("?")).orElse("-");
            boolean undOk = und.state() == CompassTarget.FOUND && !u.visibleTo(a.getUUID()).contains(ub);
            // unlocking the biome it pointed at makes the compass look for the next undiscovered one by itself
            if (undOk) u.unlock(a, net.minecraft.resources.ResourceLocation.parse(ub));
            boolean autoOk = CompassItem.target(a.getMainHandItem()).state() == CompassTarget.SEARCHING;
            System.out.println(tag + "auto re-search after unlocking it: " + autoOk);
            undOk = undOk && autoOk;
            System.out.println(tag + "find undiscovered: state=" + und.state() + " pos=" + und.pos().map(gp -> gp.pos().toShortString()).orElse("-") + " biome=" + ub + " ok=" + undOk);
            if (CompassFinder.curiosLoaded()) System.out.println(tag + "curios: " + CuriosCompat.check(a));
            // Teleport landing: far, never-loaded chunks must land on solid ground, not below bedrock.
            boolean landOk = true;
            int[][] spots = {{4000, 64, 4000}, {-6000, 64, 2500}};
            for (int[] sp : spots) landOk &= landing(level, sp[0], sp[1], sp[2], false, tag + "teleport surface " + sp[0] + "," + sp[2]);
            if (p1 != null) landOk &= landing(level, p1.getX(), p1.getY(), p1.getZ(), false, tag + "teleport plains");
            result.pos().ifPresent(gp -> System.out.println(tag + "lush caves found at y=" + gp.pos().getY()));
            if (result.pos().isPresent()) landOk &= landing(level, result.pos().get().pos().getX(), result.pos().get().pos().getY(), result.pos().get().pos().getZ(), true, tag + "teleport lush caves");
            boolean ok = separate && shared && keepsOwn && nextOk && undOk && caveOk && landOk && result.state() == CompassTarget.FOUND;
            System.out.println(tag + "findNext gives a different patch each time: " + nextOk);
            System.out.println(tag + (ok ? "PASS" : "FAIL"));
            if (Boolean.getBoolean("biomecompass.selftest.halt")) e.getServer().halt(false);
        } catch (Throwable t) {
            System.out.println(tag + "FAIL " + t);
            t.printStackTrace(System.out);
        }
    }

    private static boolean landing(ServerLevel level, int x, int foundY, int z, boolean cave, String label) {
        boolean loadedBefore = level.hasChunk(x >> 4, z >> 4);
        int y = Network.landingY(level, x, foundY, z, cave);
        var floor = level.getBlockState(new net.minecraft.core.BlockPos(x, y - 1, z));
        boolean ok = y > level.getMinBuildHeight() + 1 && (floor.blocksMotion() || !floor.getFluidState().isEmpty());
        System.out.println(label + ": chunk loaded before=" + loadedBefore + " y=" + y + " floor=" + floor.getBlock() + " ok=" + ok);
        return ok;
    }

    private static int nextId = 100;

    private static CompassTarget search(FakePlayer a, net.minecraft.resources.ResourceKey<net.minecraft.world.level.biome.Biome> biome, java.util.List<net.minecraft.core.BlockPos> skip, String label) {
        int id = nextId++;
        a.getMainHandItem().set(BiomeCompass.TARGET.get(), new CompassTarget(biome.location().toString(), CompassTarget.SEARCHING, Optional.empty(), id, skip));
        long t0 = System.nanoTime();
        BiomeSearch s = new BiomeSearch(a, biome, id, skip);
        int calls = 0;
        while (s.hasWork() && calls < 5_000_000) { s.doWork(); calls++; }
        CompassTarget r = CompassItem.target(a.getMainHandItem());
        System.out.println(label + ": state=" + r.state() + " pos=" + r.pos().map(p -> p.pos().toShortString()).orElse("-")
                + " in " + (System.nanoTime() - t0) / 1_000_000 + " ms, " + calls + " calls");
        return r;
    }
}
