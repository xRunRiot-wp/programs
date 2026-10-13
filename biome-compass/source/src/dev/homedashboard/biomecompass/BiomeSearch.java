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

import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Finds the nearest biome in square rings around the player on a 32-block grid, checking every 64 blocks of height
 * (so cave biomes are found too). Runs in the spare time of each server tick, so the game never freezes.
 * For "Find Next", it first flood-fills each already-found patch on the grid and skips those cells.
 */
public class BiomeSearch implements WorldWorkerManager.IWorker {
    public static final int RADIUS = 10000, STEP = 32, Y_STEP = 64;
    private static final int POINTS_PER_CALL = 16, FLOOD_PER_CALL = 64, MAX_PATCH_CELLS = 40000;

    private final ServerPlayer player;
    private final ServerLevel level;
    /** Biomes that count as a hit (one biome, or every still-locked biome for "Find Undiscovered"). */
    private final Set<ResourceKey<Biome>> targets;
    /** What to call it in messages: the biome, or biomecompass:undiscovered. */
    private final net.minecraft.resources.ResourceLocation label;
    private final int searchId, gcx, gcz, cx, cz, maxRing;
    private final BiomeSource source;
    private final Climate.Sampler sampler;
    private final int[] ys;
    private final List<BlockPos> skip;
    /** Grid cells (packed x/z) belonging to already-found patches. */
    private final Set<Long> skipped = new HashSet<>();
    private final ArrayDeque<long[]> flood = new ArrayDeque<>(); // {cellX, cellZ, y}
    private ResourceKey<Biome> floodBiome; // the biome of the patch being traced
    private int floodIndex, floodCount;
    private int ring, index;
    private BlockPos best;
    private long bestDist = Long.MAX_VALUE;
    private boolean finished;

    public BiomeSearch(ServerPlayer player, ResourceKey<Biome> target, int searchId, List<BlockPos> skip) {
        this(player, Set.of(target), target.location(), searchId, skip);
    }

    public BiomeSearch(ServerPlayer player, Set<ResourceKey<Biome>> targets, net.minecraft.resources.ResourceLocation label, int searchId, List<BlockPos> skip) {
        this.player = player;
        this.level = player.serverLevel();
        this.targets = targets;
        this.label = label;
        this.searchId = searchId;
        this.skip = skip;
        this.cx = player.getBlockX();
        this.cz = player.getBlockZ();
        this.gcx = Math.floorDiv(cx, STEP);
        this.gcz = Math.floorDiv(cz, STEP);
        this.maxRing = RADIUS / STEP;
        this.source = level.getChunkSource().getGenerator().getBiomeSource();
        this.sampler = level.getChunkSource().randomState().sampler();
        int min = level.getMinBuildHeight(), max = level.getMaxBuildHeight();
        int n = Math.max(1, (max - min) / Y_STEP);
        ys = new int[n];
        for (int i = 0; i < n; i++) ys[i] = min + Y_STEP / 2 + i * Y_STEP;
        // check near sea level first, so surface biomes are found (and their patch traced) at the surface, not deep underground
        int sea = level.getSeaLevel();
        Integer[] boxed = java.util.Arrays.stream(ys).boxed().toArray(Integer[]::new);
        java.util.Arrays.sort(boxed, java.util.Comparator.comparingInt(y -> Math.abs(y - sea)));
        for (int i = 0; i < n; i++) ys[i] = boxed[i];
    }

    private static long key(int x, int z) {
        return ((long) x << 32) | (z & 0xFFFFFFFFL);
    }

    private ResourceKey<Biome> biomeAt(int gx, int y, int gz) {
        int x = gx * STEP + STEP / 2, z = gz * STEP + STEP / 2;
        return source.getNoiseBiome(QuartPos.fromBlock(x), QuartPos.fromBlock(y), QuartPos.fromBlock(z), sampler).unwrapKey().orElse(null);
    }

    private boolean isTarget(int gx, int y, int gz) {
        return targets.contains(biomeAt(gx, y, gz));
    }

    @Override
    public boolean hasWork() {
        return !finished;
    }

    @Override
    public boolean doWork() {
        if (finished) return false;
        if (player.isRemoved() || player.level() != level) { finished = true; return false; }
        return floodStep() || searchStep();
    }

    /** Marks the patches already found (one at a time); true while there is still flooding to do. */
    private boolean floodStep() {
        if (flood.isEmpty()) {
            if (floodIndex >= skip.size()) return false;
            BlockPos p = skip.get(floodIndex++);
            int gx = Math.floorDiv(p.getX(), STEP), gz = Math.floorDiv(p.getZ(), STEP);
            floodCount = 0;
            floodBiome = biomeAt(gx, p.getY(), gz);
            if (skipped.add(key(gx, gz)) && floodBiome != null) flood.add(new long[]{gx, gz, p.getY()});
            return true;
        }
        for (int n = 0; n < FLOOD_PER_CALL && !flood.isEmpty(); n++) {
            long[] c = flood.poll();
            if (++floodCount > MAX_PATCH_CELLS) { flood.clear(); break; } // huge patch (an ocean): skip what we have
            int[][] around = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
            for (int[] d : around) {
                int nx = (int) c[0] + d[0], nz = (int) c[1] + d[1];
                if (Math.abs(nx - gcx) > maxRing + 1 || Math.abs(nz - gcz) > maxRing + 1) continue;
                if (!skipped.contains(key(nx, nz)) && floodBiome.equals(biomeAt(nx, (int) c[2], nz))) {
                    skipped.add(key(nx, nz));
                    flood.add(new long[]{nx, nz, c[2]});
                }
            }
        }
        return true;
    }

    private boolean searchStep() {
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
            int gx = gcx + dx, gz = gcz + dz;
            if (skipped.contains(key(gx, gz))) continue;
            for (int y : ys) {
                if (isTarget(gx, y, gz)) {
                    int x = gx * STEP + STEP / 2, z = gz * STEP + STEP / 2;
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
        Component name = BiomeCompass.biomeName(label);
        if (best != null) {
            stack.set(BiomeCompass.TARGET.get(), new CompassTarget(old.biome(), CompassTarget.FOUND, Optional.of(GlobalPos.of(level.dimension(), best)), searchId, old.skip()));
            player.displayClientMessage(Component.translatable(skip.isEmpty() ? "biomecompass.found" : "biomecompass.found_next", name, (int) Math.sqrt(bestDist)), true);
        } else {
            stack.set(BiomeCompass.TARGET.get(), new CompassTarget(old.biome(), CompassTarget.NOT_FOUND, Optional.empty(), searchId, old.skip()));
            player.displayClientMessage(Component.translatable(skip.isEmpty() ? "biomecompass.not_found" : "biomecompass.no_other", name, RADIUS), true);
        }
    }

    /** For the self-test: the result without needing a compass. */
    BlockPos best() {
        return best;
    }
}
