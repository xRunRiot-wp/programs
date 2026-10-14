package dev.homedashboard.legendaryclock;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;

import java.util.List;

/** One packet: the server's timers, sent once a second to players carrying a clock. */
public final class Network {
    private Network() {}

    /** ms left until the next spawn try: OFF = that spawner is switched off, otherwise 0 = due at the next check. */
    public static final long OFF = -1;

    /** One spawner (legendary or mega boss). times = Pixelmon times of day at the moment of the try (several can apply at once). */
    public record Timer(long msLeft, float chance, List<String> times) {
        static Timer read(FriendlyByteBuf b) {
            return new Timer(b.readLong(), b.readFloat(), b.readList(FriendlyByteBuf::readUtf));
        }

        void write(FriendlyByteBuf b) {
            b.writeLong(msLeft);
            b.writeFloat(chance);
            b.writeCollection(times, FriendlyByteBuf::writeUtf);
        }
    }

    /** now = times of day right now; cycle = false when the daylight cycle is off (time of day never changes). */
    public record Status(Timer legendary, Timer boss, List<String> now, boolean cycle) implements CustomPacketPayload {
        public static final Type<Status> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath(LegendaryClock.MODID, "status"));
        public static final StreamCodec<FriendlyByteBuf, Status> CODEC = CustomPacketPayload.codec(Status::write, Status::read);

        static Status read(FriendlyByteBuf b) {
            return new Status(Timer.read(b), Timer.read(b), b.readList(FriendlyByteBuf::readUtf), b.readBoolean());
        }

        void write(FriendlyByteBuf b) {
            legendary.write(b);
            boss.write(b);
            b.writeCollection(now, FriendlyByteBuf::writeUtf);
            b.writeBoolean(cycle);
        }

        @Override public Type<Status> type() { return TYPE; }
    }

    public static void register(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar r = event.registrar("1");
        r.playToClient(Status.TYPE, Status.CODEC, (p, ctx) -> dev.homedashboard.legendaryclock.client.ClientHooks.onStatus(p));
    }
}
