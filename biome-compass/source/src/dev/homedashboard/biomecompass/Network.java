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

    /** Plays the "absorbing nature essence" effect on the player's top-left compass icon. */
    public record Absorb(int entityId, String biome) implements CustomPacketPayload {
        public static final Type<Absorb> TYPE = typeOf("absorb");
        public static final StreamCodec<ByteBuf, Absorb> CODEC = StreamCodec.composite(
                ByteBufCodecs.VAR_INT, Absorb::entityId, ByteBufCodecs.STRING_UTF8, Absorb::biome, Absorb::new);
        @Override public Type<Absorb> type() { return TYPE; }
    }

    /** Seconds stood so far in a biome that is still unlocking (sent once a second while it lasts). */
    public record Progress(String biome, int seconds) implements CustomPacketPayload {
        public static final Type<Progress> TYPE = typeOf("progress");
        public static final StreamCodec<ByteBuf, Progress> CODEC = StreamCodec.composite(
                ByteBufCodecs.STRING_UTF8, Progress::biome, ByteBufCodecs.VAR_INT, Progress::seconds, Progress::new);
        @Override public Type<Progress> type() { return TYPE; }
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
        r.playToClient(Absorb.TYPE, Absorb.CODEC, (p, ctx) -> dev.homedashboard.biomecompass.client.ClientHooks.onAbsorb(p));
        r.playToClient(Progress.TYPE, Progress.CODEC, (p, ctx) -> dev.homedashboard.biomecompass.client.ClientHooks.onProgress(p));
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
            case "next" -> next(p);
            case "undiscovered" -> search(p, u, BiomeCompass.UNDISCOVERED.toString());
            case "clear" -> {
                ItemStack stack = CompassFinder.find(p, s -> !CompassItem.target(s).biome().isEmpty());
                if (!stack.isEmpty()) stack.set(BiomeCompass.TARGET.get(), CompassTarget.NONE);
            }
            case "teleport" -> teleport(p);
            case "invite" -> u.invite(p, a.arg());
            case "leave" -> { u.leave(p); sendOpen(p); }
            default -> {}
        }
    }

    /** Biomes of the player's dimension they (and their group) haven't unlocked yet. */
    private static Set<net.minecraft.resources.ResourceKey<net.minecraft.world.level.biome.Biome>> locked(ServerPlayer p, Unlocks u) {
        Set<String> visible = u.visibleTo(p.getUUID());
        Set<net.minecraft.resources.ResourceKey<net.minecraft.world.level.biome.Biome>> out = new java.util.HashSet<>();
        for (var h : p.serverLevel().getChunkSource().getGenerator().getBiomeSource().possibleBiomes())
            h.unwrapKey().filter(k -> !visible.contains(k.location().toString())).ifPresent(out::add);
        return out;
    }

    private static void startSearch(ServerPlayer p, Unlocks u, ItemStack stack, String biome, List<net.minecraft.core.BlockPos> skip) {
        int searchId = ThreadLocalRandom.current().nextInt(1, Integer.MAX_VALUE);
        ResourceLocation id = ResourceLocation.parse(biome);
        if (id.equals(BiomeCompass.UNDISCOVERED)) {
            var targets = locked(p, u);
            if (targets.isEmpty()) {
                stack.set(BiomeCompass.TARGET.get(), CompassTarget.NONE);
                p.displayClientMessage(Component.translatable("biomecompass.all_unlocked"), true);
                return;
            }
            stack.set(BiomeCompass.TARGET.get(), new CompassTarget(biome, CompassTarget.SEARCHING, Optional.empty(), searchId, skip));
            WorldWorkerManager.addWorker(new BiomeSearch(p, targets, id, searchId, skip));
        } else {
            stack.set(BiomeCompass.TARGET.get(), new CompassTarget(biome, CompassTarget.SEARCHING, Optional.empty(), searchId, skip));
            WorldWorkerManager.addWorker(new BiomeSearch(p, net.minecraft.resources.ResourceKey.create(Registries.BIOME, id), searchId, skip));
        }
    }

    /** After a new unlock: a compass on "Find Undiscovered" moves on to the next-nearest undiscovered biome by itself. */
    public static void autoUndiscovered(ServerPlayer p) {
        ItemStack stack = CompassFinder.find(p, s -> BiomeCompass.UNDISCOVERED.toString().equals(CompassItem.target(s).biome()));
        if (stack.isEmpty() || CompassItem.target(stack).state() == CompassTarget.SEARCHING) return;
        startSearch(p, Unlocks.get(p.server), stack, BiomeCompass.UNDISCOVERED.toString(), List.of());
    }

    private static void search(ServerPlayer p, Unlocks u, String biome) {
        if (biome.equals(BiomeCompass.UNDISCOVERED.toString())) {
            ItemStack stack = CompassFinder.find(p, s -> true);
            if (!stack.isEmpty()) startSearch(p, u, stack, biome, List.of());
            return;
        }
        ResourceLocation id = ResourceLocation.tryParse(biome);
        Set<String> visible = u.visibleTo(p.getUUID());
        if (id == null || !visible.contains(biome)) return;
        ItemStack stack = CompassFinder.find(p, s -> true);
        if (stack.isEmpty()) return;
        startSearch(p, u, stack, biome, List.of());
    }

    /** Find Next: skip every patch found so far for this biome and look again from where the player stands. */
    private static void next(ServerPlayer p) {
        ItemStack stack = CompassFinder.find(p, s -> CompassItem.target(s).state() == CompassTarget.FOUND);
        if (stack.isEmpty()) return;
        CompassTarget t = CompassItem.target(stack);
        var pos = t.pos().orElse(null);
        ResourceLocation id = ResourceLocation.tryParse(t.biome());
        if (pos == null || id == null || !pos.dimension().equals(p.level().dimension())) return;
        List<net.minecraft.core.BlockPos> skip = new ArrayList<>(t.skip());
        skip.add(pos.pos());
        while (skip.size() > CompassTarget.MAX_SKIPS) skip.remove(0);
        startSearch(p, Unlocks.get(p.server), stack, t.biome(), List.copyOf(skip));
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
