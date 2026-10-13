package dev.homedashboard.biomecompass;

import io.netty.buffer.ByteBuf;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.levelgen.Heightmap;
import net.neoforged.neoforge.common.WorldWorkerManager;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.handling.IPayloadContext;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/** Open screen (server -> client) and the screen's actions: search, teleport, invite, leave, open (client -> server). */
public final class Network {
    private Network() {}

    private static <T extends CustomPacketPayload> CustomPacketPayload.Type<T> typeOf(String path) {
        return new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(BiomeCompass.MODID, path));
    }

    private static final StreamCodec<ByteBuf, List<String>> STRINGS = ByteBufCodecs.STRING_UTF8.apply(ByteBufCodecs.collection(ArrayList::new));

    /** possible = biomes of this dimension, unlocked = the ones this player (or their group) found. */
    public record Open(List<String> possible, List<String> unlocked, List<String> group, List<String> online, boolean canTeleport) implements CustomPacketPayload {
        public static final Type<Open> TYPE = typeOf("open");
        public static final StreamCodec<ByteBuf, Open> CODEC = StreamCodec.composite(
                STRINGS, Open::possible, STRINGS, Open::unlocked, STRINGS, Open::group, STRINGS, Open::online,
                ByteBufCodecs.BOOL, Open::canTeleport, Open::new);
        @Override public Type<Open> type() { return TYPE; }
    }

    /** action: "open", "search", "teleport", "invite", "leave"; arg = biome id or player name. */
    public record Action(String action, String arg) implements CustomPacketPayload {
        public static final Type<Action> TYPE = typeOf("action");
        public static final StreamCodec<ByteBuf, Action> CODEC = StreamCodec.composite(
                ByteBufCodecs.STRING_UTF8, Action::action, ByteBufCodecs.STRING_UTF8, Action::arg, Action::new);
        @Override public Type<Action> type() { return TYPE; }
    }

    public static void register(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar r = event.registrar("1");
        r.playToClient(Open.TYPE, Open.CODEC, (p, ctx) -> dev.homedashboard.biomecompass.client.ClientHooks.onOpen(p));
        r.playToServer(Action.TYPE, Action.CODEC, Network::onAction);
    }

    public static void sendAction(String action, String arg) {
        PacketDistributor.sendToServer(new Action(action, arg));
    }

    public static void sendOpen(ServerPlayer p) {
        Unlocks u = Unlocks.get(p.server);
        u.rememberName(p);
        List<String> possible = new ArrayList<>();
        for (var h : p.serverLevel().getChunkSource().getGenerator().getBiomeSource().possibleBiomes())
            h.unwrapKey().ifPresent(k -> possible.add(k.location().toString()));
        List<String> group = new ArrayList<>();
        if (u.inGroup(p.getUUID())) for (UUID m : u.groupMembers(p.getUUID())) group.add(u.nameOf(m));
        List<String> online = new ArrayList<>();
        for (ServerPlayer o : p.server.getPlayerList().getPlayers())
            if (o != p && !group.contains(o.getGameProfile().getName())) online.add(o.getGameProfile().getName());
        PacketDistributor.sendToPlayer(p, new Open(possible, new ArrayList<>(u.visibleTo(p.getUUID())), group, online, p.hasPermissions(2)));
    }

    private static void onAction(Action a, IPayloadContext ctx) {
        if (!(ctx.player() instanceof ServerPlayer p)) return;
        Unlocks u = Unlocks.get(p.server);
        switch (a.action()) {
            case "open" -> { if (!CompassFinder.find(p, s -> true).isEmpty()) sendOpen(p); }
            case "search" -> search(p, u, a.arg());
            case "teleport" -> teleport(p);
            case "invite" -> u.invite(p, a.arg());
            case "leave" -> { u.leave(p); sendOpen(p); }
            default -> {}
        }
    }

    private static void search(ServerPlayer p, Unlocks u, String biome) {
        ResourceLocation id = ResourceLocation.tryParse(biome);
        Set<String> visible = u.visibleTo(p.getUUID());
        if (id == null || !visible.contains(biome)) return;
        ItemStack stack = CompassFinder.find(p, s -> true);
        if (stack.isEmpty()) return;
        var key = net.minecraft.resources.ResourceKey.create(Registries.BIOME, id);
        int searchId = ThreadLocalRandom.current().nextInt(1, Integer.MAX_VALUE);
        stack.set(BiomeCompass.TARGET.get(), new CompassTarget(biome, CompassTarget.SEARCHING, Optional.empty(), searchId));
        WorldWorkerManager.addWorker(new BiomeSearch(p, key, searchId));
    }

    private static void teleport(ServerPlayer p) {
        if (!p.hasPermissions(2)) return;
        ItemStack stack = CompassFinder.find(p, s -> CompassItem.target(s).state() == CompassTarget.FOUND);
        if (stack.isEmpty()) return;
        var pos = CompassItem.target(stack).pos().orElse(null);
        if (pos == null || !pos.dimension().equals(p.level().dimension())) return;
        int x = pos.pos().getX(), z = pos.pos().getZ();
        int y = p.serverLevel().getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, x, z);
        p.teleportTo(p.serverLevel(), x + 0.5, y, z + 0.5, p.getYRot(), p.getXRot());
        p.displayClientMessage(Component.translatable("biomecompass.teleported"), true);
    }
}
