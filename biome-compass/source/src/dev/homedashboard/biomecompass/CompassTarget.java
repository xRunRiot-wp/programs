package dev.homedashboard.biomecompass;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import io.netty.buffer.ByteBuf;
import net.minecraft.core.BlockPos;
import net.minecraft.core.GlobalPos;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;

import java.util.List;
import java.util.Optional;

/**
 * What a compass is set to: the biome, the search state, where it was found, the search id (to find the stack again),
 * the spots already found for this biome that "Find Next" skips (each one's whole patch is skipped), and whether the
 * found biome is a cave biome (then its height counts: Y is shown and the distance is 3D).
 */
public record CompassTarget(String biome, int state, Optional<GlobalPos> pos, int searchId, List<BlockPos> skip, boolean cave) {
    public static final int IDLE = 0, SEARCHING = 1, FOUND = 2, NOT_FOUND = 3;
    public static final int MAX_SKIPS = 16;
    public static final CompassTarget NONE = new CompassTarget("", IDLE, Optional.empty(), 0, List.of());

    public CompassTarget(String biome, int state, Optional<GlobalPos> pos, int searchId, List<BlockPos> skip) {
        this(biome, state, pos, searchId, skip, false);
    }

    public static final Codec<CompassTarget> CODEC = RecordCodecBuilder.create(i -> i.group(
            Codec.STRING.fieldOf("biome").forGetter(CompassTarget::biome),
            Codec.INT.fieldOf("state").forGetter(CompassTarget::state),
            GlobalPos.CODEC.optionalFieldOf("pos").forGetter(CompassTarget::pos),
            Codec.INT.optionalFieldOf("search_id", 0).forGetter(CompassTarget::searchId),
            BlockPos.CODEC.listOf().optionalFieldOf("skip", List.of()).forGetter(CompassTarget::skip),
            Codec.BOOL.optionalFieldOf("cave", false).forGetter(CompassTarget::cave)
    ).apply(i, CompassTarget::new));

    public static final StreamCodec<ByteBuf, CompassTarget> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.STRING_UTF8, CompassTarget::biome,
            ByteBufCodecs.VAR_INT, CompassTarget::state,
            ByteBufCodecs.optional(GlobalPos.STREAM_CODEC), CompassTarget::pos,
            ByteBufCodecs.VAR_INT, CompassTarget::searchId,
            BlockPos.STREAM_CODEC.apply(ByteBufCodecs.list()), CompassTarget::skip,
            ByteBufCodecs.BOOL, CompassTarget::cave,
            CompassTarget::new);
}
