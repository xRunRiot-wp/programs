package dev.homedashboard.biomecompass;

import net.minecraft.core.BlockPos;
import net.minecraft.core.GlobalPos;
import net.minecraft.core.QuartPos;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.biome.BiomeSource;
import net.minecraft.world.level.biome.Climate;
import net.neoforged.neoforge.common.WorldWorkerManager;

import java.util.Optional;

/**
 * Finds the nearest biome in square rings around the player, 32 blocks apart, checking every 64 blocks of height
 * (so cave biomes are found too). Runs in the spare time of each server tick, so the game never freezes.
 */
public class BiomeSearch implements WorldWorkerManager.IWorker {
    public static final int RADIUS = 10000, STEP = 32, Y_STEP = 64;
    private static final int POINTS_PER_CALL = 16;

    private final ServerPlayer player;
    private final ServerLevel level;
    private final ResourceKey<Biome> target;
    private final int searchId, cx, cz, maxRing;
    private final BiomeSource source;
    private final Climate.Sampler sampler;
    private final int[] ys;
    private int ring, index;
    private BlockPos best;
    private long bestDist = Long.MAX_VALUE;
    private boolean finished;

    public BiomeSearch(ServerPlayer player, ResourceKey<Biome> target, int searchId) {
        this.player = player;
        this.level = player.serverLevel();
        this.target = target;
        this.searchId = searchId;
        this.cx = player.getBlockX();
        this.cz = player.getBlockZ();
        this.maxRing = RADIUS / STEP;
        this.source = level.getChunkSource().getGenerator().getBiomeSource();
        this.sampler = level.getChunkSource().randomState().sampler();
        int min = level.getMinBuildHeight(), max = level.getMaxBuildHeight();
        int n = Math.max(1, (max - min) / Y_STEP);
        ys = new int[n];
        for (int i = 0; i < n; i++) ys[i] = min + Y_STEP / 2 + i * Y_STEP;
    }

    @Override
    public boolean hasWork() {
        return !finished;
    }

    @Override
    public boolean doWork() {
        if (finished) return false;
        if (player.isRemoved() || player.level() != level) { finished = true; return false; }
        for (int n = 0; n < POINTS_PER_CALL; n++) {
            int len = ring == 0 ? 1 : 8 * ring;
            if (index >= len) {
                if (best != null || ring >= maxRing) { finish(); return false; }
                ring++;
                index = 0;
                continue;
            }
            int dx, dz;
            if (ring == 0) { dx = 0; dz = 0; }
            else {
                int side = index / (2 * ring), off = index % (2 * ring);
                switch (side) {
                    case 0 -> { dx = -ring + off; dz = -ring; }
                    case 1 -> { dx = ring; dz = -ring + off; }
                    case 2 -> { dx = ring - off; dz = ring; }
                    default -> { dx = -ring; dz = ring - off; }
                }
            }
            index++;
            int x = cx + dx * STEP, z = cz + dz * STEP;
            for (int y : ys) {
                if (source.getNoiseBiome(QuartPos.fromBlock(x), QuartPos.fromBlock(y), QuartPos.fromBlock(z), sampler).is(target)) {
                    long d = (long) (x - cx) * (x - cx) + (long) (z - cz) * (z - cz);
                    if (d < bestDist) { bestDist = d; best = new BlockPos(x, y, z); }
                    break;
                }
            }
        }
        return true;
    }

    private void finish() {
        finished = true;
        ItemStack stack = CompassFinder.findBySearch(player, searchId);
        if (stack.isEmpty()) return;
        CompassTarget old = CompassItem.target(stack);
        if (best != null) {
            stack.set(BiomeCompass.TARGET.get(), new CompassTarget(old.biome(), CompassTarget.FOUND, Optional.of(GlobalPos.of(level.dimension(), best)), searchId));
            player.displayClientMessage(Component.translatable("biomecompass.found", BiomeCompass.biomeName(target.location()), (int) Math.sqrt(bestDist)), true);
        } else {
            stack.set(BiomeCompass.TARGET.get(), new CompassTarget(old.biome(), CompassTarget.NOT_FOUND, Optional.empty(), searchId));
            player.displayClientMessage(Component.translatable("biomecompass.not_found", BiomeCompass.biomeName(target.location()), RADIUS), true);
        }
    }
}
