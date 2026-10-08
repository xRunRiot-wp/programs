package dev.homedashboard.pixeldexoverlay;

import java.util.ArrayList;
import java.util.List;

import com.mojang.datafixers.util.Pair;
import io.netty.buffer.Unpooled;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.core.HolderSet;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.levelgen.structure.Structure;
import net.neoforged.neoforge.event.server.ServerStartedEvent;

/** Only with -Dpixeldexoverlay.selftest: after the server starts, find the nearest Pixelmon structure, load around it,
 *  run the same lookup the overlay uses, round-trip the reply through its network codec, log it, and stop the server. */
final class SelfTest {
    static void run(ServerStartedEvent e) {
        ServerLevel level = e.getServer().overworld();
        try {
            var reg = level.registryAccess().registryOrThrow(Registries.STRUCTURE);
            List<Holder<Structure>> pix = new ArrayList<>();
            reg.holders().forEach(h -> { if (h.key().location().getNamespace().equals("pixelmon")) pix.add(h); });
            System.out.println("[pixeldexoverlay selftest] pixelmon structures registered: " + pix.size());
            BlockPos spawn = level.getSharedSpawnPos();
            Pair<BlockPos, Holder<Structure>> near = level.getChunkSource().getGenerator()
                    .findNearestMapStructure(level, HolderSet.direct(pix), spawn, 64, false);
            List<BlockPos> spots = new ArrayList<>(List.of(spawn));
            if (near != null) {
                System.out.println("[pixeldexoverlay selftest] nearest pixelmon structure: " + near.getSecond().getRegisteredName() + " at " + near.getFirst());
                spots.add(near.getFirst());
            }
            for (BlockPos at : spots) {
                ChunkPos c = new ChunkPos(at);
                for (int dx = -3; dx <= 3; dx++) for (int dz = -3; dz <= 3; dz++) level.getChunk(c.x + dx, c.z + dz);
                List<StructureQuery.Found> found = StructureQuery.find(level, c, 3);
                FriendlyByteBuf buf = new FriendlyByteBuf(Unpooled.buffer());
                StructureQuery.Reply.CODEC.encode(buf, new StructureQuery.Reply(found));
                int bytes = buf.readableBytes();
                StructureQuery.Reply back = StructureQuery.Reply.CODEC.decode(buf);
                System.out.println("[pixeldexoverlay selftest] around " + at + ": " + found.size() + " structures, reply "
                        + bytes + " bytes, decoded " + back.found().size());
                for (StructureQuery.Found f : back.found())
                    System.out.println("[pixeldexoverlay selftest]   " + f.id() + " box " + java.util.Arrays.toString(f.box()) + " pieces " + f.pieces().length / 6);
            }
            System.out.println("[pixeldexoverlay selftest] PASS");
        } catch (Throwable t) {
            System.out.println("[pixeldexoverlay selftest] FAIL " + t);
            t.printStackTrace(System.out);
        }
        e.getServer().halt(false);
    }

    private SelfTest() {}
}
