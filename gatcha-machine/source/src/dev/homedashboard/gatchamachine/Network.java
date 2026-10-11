package dev.homedashboard.gatchamachine;

import io.netty.buffer.ByteBuf;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.handling.IPayloadContext;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;

import java.util.ArrayList;
import java.util.List;

/** The four packets: points sync, open screen, spin request (client -> server), spin result. */
public final class Network {
    private Network() {}

    private static <T extends CustomPacketPayload> CustomPacketPayload.Type<T> typeOf(String path) {
        return new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(GatchaMachine.MODID, path));
    }

    public record ReelEntry(String sprite, String name) {
        public static final StreamCodec<ByteBuf, ReelEntry> CODEC = StreamCodec.composite(
                ByteBufCodecs.STRING_UTF8, ReelEntry::sprite, ByteBufCodecs.STRING_UTF8, ReelEntry::name, ReelEntry::new);
    }

    public record Points(int points, boolean unlocked) implements CustomPacketPayload {
        public static final Type<Points> TYPE = typeOf("points");
        public static final StreamCodec<ByteBuf, Points> CODEC = StreamCodec.composite(
                ByteBufCodecs.VAR_INT, Points::points, ByteBufCodecs.BOOL, Points::unlocked, Points::new);
        @Override public Type<Points> type() { return TYPE; }
    }

    /** Opens the screen; also carries the Ultimate "never encountered" numbers. */
    public record Open(int points, boolean unlocked, int unseen, int total) implements CustomPacketPayload {
        public static final Type<Open> TYPE = typeOf("open");
        public static final StreamCodec<ByteBuf, Open> CODEC = StreamCodec.composite(
                ByteBufCodecs.VAR_INT, Open::points, ByteBufCodecs.BOOL, Open::unlocked,
                ByteBufCodecs.VAR_INT, Open::unseen, ByteBufCodecs.VAR_INT, Open::total, Open::new);
        @Override public Type<Open> type() { return TYPE; }
    }

    public record SpinRequest(int tier, boolean neverEncountered) implements CustomPacketPayload {
        public static final Type<SpinRequest> TYPE = typeOf("spin_request");
        public static final StreamCodec<ByteBuf, SpinRequest> CODEC = StreamCodec.composite(
                ByteBufCodecs.VAR_INT, SpinRequest::tier, ByteBufCodecs.BOOL, SpinRequest::neverEncountered, SpinRequest::new);
        @Override public Type<SpinRequest> type() { return TYPE; }
    }

    public record SpinResult(int tier, List<ReelEntry> reel, int points) implements CustomPacketPayload {
        public static final Type<SpinResult> TYPE = typeOf("spin_result");
        public static final StreamCodec<ByteBuf, SpinResult> CODEC = StreamCodec.composite(
                ByteBufCodecs.VAR_INT, SpinResult::tier,
                ReelEntry.CODEC.apply(ByteBufCodecs.collection(ArrayList::new)), SpinResult::reel,
                ByteBufCodecs.VAR_INT, SpinResult::points, SpinResult::new);
        @Override public Type<SpinResult> type() { return TYPE; }
    }

    public static void register(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar r = event.registrar("1");
        r.playToClient(Points.TYPE, Points.CODEC, (p, ctx) -> dev.homedashboard.gatchamachine.client.ClientHooks.onPoints(p));
        r.playToClient(Open.TYPE, Open.CODEC, (p, ctx) -> dev.homedashboard.gatchamachine.client.ClientHooks.onOpen(p));
        r.playToClient(SpinResult.TYPE, SpinResult.CODEC, (p, ctx) -> dev.homedashboard.gatchamachine.client.ClientHooks.onSpin(p));
        r.playToServer(SpinRequest.TYPE, SpinRequest.CODEC, Network::onSpinRequest);
    }

    private static void onSpinRequest(SpinRequest req, IPayloadContext ctx) {
        if (ctx.player() instanceof ServerPlayer p) BossSpin.spin(p, req.tier(), req.neverEncountered());
    }

    public static void syncPoints(ServerPlayer p) {
        PacketDistributor.sendToPlayer(p, new Points(GatchaMachine.getPoints(p), GatchaMachine.isUnlocked(p)));
    }

    public static void sendOpen(ServerPlayer p) {
        int total = BossSpin.ultimatePool().size();
        int unseen = BossSpin.neverEncountered(p).size();
        PacketDistributor.sendToPlayer(p, new Open(GatchaMachine.getPoints(p), GatchaMachine.isUnlocked(p), unseen, total));
    }

    public static void sendSpin(ServerPlayer p, int tier, List<ReelEntry> reel, int points) {
        PacketDistributor.sendToPlayer(p, new SpinResult(tier, reel, points));
    }
}
