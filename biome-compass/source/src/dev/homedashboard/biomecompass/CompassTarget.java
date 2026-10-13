package dev.homedashboard.biomecompass;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import io.netty.buffer.ByteBuf;
import net.minecraft.core.GlobalPos;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;

import java.util.Optional;

/** What a compass is set to: the biome, the search state, where it was found, and the search id (to find the stack again). */
public record CompassTarget(String biome, int state, Optional<GlobalPos> pos, int searchId) {
    public static final int IDLE = 0, SEARCHING = 1, FOUND = 2, NOT_FOUND = 3;
    public static final CompassTarget NONE = new CompassTarget("", IDLE, Optional.empty(), 0);

    public static final Codec<CompassTarget> CODEC = RecordCodecBuilder.create(i -> i.group(
            Codec.STRING.fieldOf("biome").forGetter(CompassTarget::biome),
            Codec.INT.fieldOf("state").forGetter(CompassTarget::state),
            GlobalPos.CODEC.optionalFieldOf("pos").forGetter(CompassTarget::pos),
            Codec.INT.optionalFieldOf("search_id", 0).forGetter(CompassTarget::searchId)
    ).apply(i, CompassTarget::new));

    public static final StreamCodec<ByteBuf, CompassTarget> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.STRING_UTF8, CompassTarget::biome,
            ByteBufCodecs.VAR_INT, CompassTarget::state,
            ByteBufCodecs.optional(GlobalPos.STREAM_CODEC), CompassTarget::pos,
            ByteBufCodecs.VAR_INT, CompassTarget::searchId,
            CompassTarget::new);
}
