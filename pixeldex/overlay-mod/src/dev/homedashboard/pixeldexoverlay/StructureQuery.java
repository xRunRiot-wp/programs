package dev.homedashboard.pixeldexoverlay;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import it.unimi.dsi.fastutil.longs.LongSet;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.chunk.ChunkAccess;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.chunk.status.ChunkStatus;
import net.minecraft.world.level.levelgen.structure.BoundingBox;
import net.minecraft.world.level.levelgen.structure.Structure;
import net.minecraft.world.level.levelgen.structure.StructurePiece;
import net.minecraft.world.level.levelgen.structure.StructureStart;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.handling.IPayloadContext;

/** Client asks "which structures are around me?"; the server answers with each structure's outline and its parts. */
public final class StructureQuery {
    static final int MAX_RADIUS = 12;            // chunks
    static final int MAX_STRUCTURES = 64;
    static final int MAX_PIECES = 64;            // per structure
    private static final Map<UUID, Long> lastAsked = new HashMap<>();

    /** One structure: its id ("pixelmon:misc/graveyard"), outer box, and its pieces' boxes (6 ints each). */
    public record Found(String id, int[] box, int[] pieces) {}

    static int[] ints(BoundingBox b) {
        return new int[]{b.minX(), b.minY(), b.minZ(), b.maxX(), b.maxY(), b.maxZ()};
    }

    public record Request(int radius) implements CustomPacketPayload {
        public static final Type<Request> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath(PixelDexOverlay.MODID, "ask"));
        public static final StreamCodec<FriendlyByteBuf, Request> CODEC =
                CustomPacketPayload.codec((m, b) -> b.writeVarInt(m.radius), b -> new Request(b.readVarInt()));

        @Override public Type<? extends CustomPacketPayload> type() { return TYPE; }

        static void handle(Request m, IPayloadContext ctx) {
            ctx.enqueueWork(() -> {
                if (!(ctx.player() instanceof ServerPlayer p)) return;
                ServerLevel level = p.serverLevel();
                long now = level.getGameTime();
                Long last = lastAsked.get(p.getUUID());
                if (last != null && now - last < 10) return;                  // at most twice a second per player
                lastAsked.put(p.getUUID(), now);
                PacketDistributor.sendToPlayer(p, new Reply(find(level, p.chunkPosition(), Math.max(1, Math.min(MAX_RADIUS, m.radius)))));
            });
        }
    }

    /** Structures touching the loaded chunks around `center`. Never loads or generates chunks. */
    static List<Found> find(ServerLevel level, ChunkPos center, int radius) {
        var registry = level.registryAccess().registryOrThrow(Registries.STRUCTURE);
        Set<String> seen = new HashSet<>();
        List<Found> out = new ArrayList<>();
        for (int dx = -radius; dx <= radius && out.size() < MAX_STRUCTURES; dx++) {
            for (int dz = -radius; dz <= radius && out.size() < MAX_STRUCTURES; dz++) {
                LevelChunk chunk = level.getChunkSource().getChunkNow(center.x + dx, center.z + dz);
                if (chunk == null) continue;
                for (Map.Entry<Structure, LongSet> ref : chunk.getAllReferences().entrySet()) {
                    ResourceLocation id = registry.getKey(ref.getKey());
                    if (id == null) continue;
                    for (long startChunk : ref.getValue()) {
                        String key = id + "@" + startChunk;
                        if (!seen.add(key)) continue;
                        ChunkPos sp = new ChunkPos(startChunk);
                        ChunkAccess sc = level.getChunk(sp.x, sp.z, ChunkStatus.STRUCTURE_STARTS, false);
                        if (sc == null) continue;
                        StructureStart start = sc.getStartForStructure(ref.getKey());
                        if (start == null || !start.isValid()) continue;
                        List<StructurePiece> pieces = start.getPieces();
                        int n = Math.min(MAX_PIECES, pieces.size());
                        int[] pc = new int[pieces.size() > 1 ? n * 6 : 0];      // a one-piece structure: the outer box says it all
                        if (pc.length > 0)
                            for (int i = 0; i < n; i++) System.arraycopy(ints(pieces.get(i).getBoundingBox()), 0, pc, i * 6, 6);
                        out.add(new Found(id.toString(), ints(start.getBoundingBox()), pc));
                        if (out.size() >= MAX_STRUCTURES) break;
                    }
                }
            }
        }
        return out;
    }

    public record Reply(List<Found> found) implements CustomPacketPayload {
        public static final Type<Reply> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath(PixelDexOverlay.MODID, "found"));
        public static final StreamCodec<FriendlyByteBuf, Reply> CODEC = CustomPacketPayload.codec(Reply::write, Reply::read);

        void write(FriendlyByteBuf b) {
            b.writeVarInt(found.size());
            for (Found f : found) {
                b.writeUtf(f.id(), 256);
                b.writeVarIntArray(f.box());
                b.writeVarIntArray(f.pieces());
            }
        }

        static Reply read(FriendlyByteBuf b) {
            int n = Math.min(b.readVarInt(), MAX_STRUCTURES);
            List<Found> list = new ArrayList<>(n);
            for (int i = 0; i < n; i++) list.add(new Found(b.readUtf(256), b.readVarIntArray(6), b.readVarIntArray(MAX_PIECES * 6)));
            return new Reply(list);
        }

        @Override public Type<? extends CustomPacketPayload> type() { return TYPE; }

        static void handle(Reply m, IPayloadContext ctx) {
            ctx.enqueueWork(() -> dev.homedashboard.pixeldexoverlay.client.OverlayClient.receive(m.found));
        }
    }

    private StructureQuery() {}
}
