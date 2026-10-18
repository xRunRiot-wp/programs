package dev.homedashboard.foragestation;

import com.pixelmonmod.pixelmon.api.pokemon.Pokemon;
import com.pixelmonmod.pixelmon.api.storage.PCStorage;
import com.pixelmonmod.pixelmon.api.storage.StorageProxy;
import com.pixelmonmod.pixelmon.api.util.helpers.SpriteItemHelper;
import net.minecraft.core.BlockPos;
import net.minecraft.core.UUIDUtil;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.handling.IPayloadContext;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The Pokemon picker: page 0 = party, page 1..n = PC box 1..n. The server sends one page at a time;
 * the client sends back the page, slot and the Pokemon's UUID (so a moved Pokemon is never the wrong one).
 */
public final class Network {
    private Network() {}

    private static <T extends CustomPacketPayload> CustomPacketPayload.Type<T> typeOf(String path) {
        return new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(ForageStation.MODID, path));
    }

    public record Entry(int slot, UUID id, ItemStack photo, String name, int level, int speed) {
        public static final StreamCodec<RegistryFriendlyByteBuf, Entry> CODEC = StreamCodec.composite(
                ByteBufCodecs.VAR_INT, Entry::slot, UUIDUtil.STREAM_CODEC, Entry::id, ItemStack.OPTIONAL_STREAM_CODEC, Entry::photo,
                ByteBufCodecs.STRING_UTF8, Entry::name, ByteBufCodecs.VAR_INT, Entry::level, ByteBufCodecs.VAR_INT, Entry::speed, Entry::new);
    }

    public record Picker(BlockPos pos, int page, int pages, List<Entry> entries) implements CustomPacketPayload {
        public static final Type<Picker> TYPE = typeOf("picker");
        public static final StreamCodec<RegistryFriendlyByteBuf, Picker> CODEC = StreamCodec.composite(
                BlockPos.STREAM_CODEC, Picker::pos, ByteBufCodecs.VAR_INT, Picker::page, ByteBufCodecs.VAR_INT, Picker::pages,
                Entry.CODEC.apply(ByteBufCodecs.collection(ArrayList::new)), Picker::entries, Picker::new);
        @Override public Type<Picker> type() { return TYPE; }
    }

    public record PageRequest(BlockPos pos, int page) implements CustomPacketPayload {
        public static final Type<PageRequest> TYPE = typeOf("page");
        public static final StreamCodec<RegistryFriendlyByteBuf, PageRequest> CODEC = StreamCodec.composite(
                BlockPos.STREAM_CODEC, PageRequest::pos, ByteBufCodecs.VAR_INT, PageRequest::page, PageRequest::new);
        @Override public Type<PageRequest> type() { return TYPE; }
    }

    public record Pick(BlockPos pos, int page, int slot, UUID id) implements CustomPacketPayload {
        public static final Type<Pick> TYPE = typeOf("pick");
        public static final StreamCodec<RegistryFriendlyByteBuf, Pick> CODEC = StreamCodec.composite(
                BlockPos.STREAM_CODEC, Pick::pos, ByteBufCodecs.VAR_INT, Pick::page, ByteBufCodecs.VAR_INT, Pick::slot,
                UUIDUtil.STREAM_CODEC, Pick::id, Pick::new);
        @Override public Type<Pick> type() { return TYPE; }
    }

    public static void register(RegisterPayloadHandlersEvent event) {
        var r = event.registrar("1");
        r.playToClient(Picker.TYPE, Picker.CODEC, (p, ctx) -> dev.homedashboard.foragestation.client.ClientHooks.onPicker(p));
        r.playToServer(PageRequest.TYPE, PageRequest.CODEC, (p, ctx) -> { if (ctx.player() instanceof ServerPlayer sp && usable(sp, p.pos()) != null) sendPicker(sp, p.pos(), p.page()); });
        r.playToServer(Pick.TYPE, Pick.CODEC, Network::onPick);
    }

    private static StationBlockEntity usable(ServerPlayer p, BlockPos pos) {
        if (p.distanceToSqr(pos.getCenter()) > 64) return null;
        return p.level().getBlockEntity(pos) instanceof StationBlockEntity be && !be.hasPokemon() && be.mayManage(p) ? be : null;
    }

    public static List<Entry> page(ServerPlayer p, int page) {
        List<Entry> out = new ArrayList<>();
        Pokemon[] mons;
        if (page == 0) mons = StorageProxy.getPartyNow(p).getAll();
        else {
            PCStorage pc = StorageProxy.getPCForPlayerNow(p);
            mons = new Pokemon[30];
            for (int i = 0; i < 30; i++) mons[i] = pc.get(page - 1, i);
        }
        for (int i = 0; i < mons.length; i++) {
            Pokemon m = mons[i];
            if (m == null || m.isEgg()) continue;
            out.add(new Entry(i, m.getUUID(), SpriteItemHelper.getPhoto(m), m.getDisplayName().getString(), m.getPokemonLevel(), m.getStats().getSpeed()));
        }
        return out;
    }

    public static void sendPicker(ServerPlayer p, BlockPos pos, int page) {
        int pages = 1 + StorageProxy.getPCForPlayerNow(p).getBoxCount();
        page = Math.floorMod(page, pages);
        PacketDistributor.sendToPlayer(p, new Picker(pos, page, pages, page(p, page)));
    }

    private static void onPick(Pick req, IPayloadContext ctx) {
        if (!(ctx.player() instanceof ServerPlayer p)) return;
        StationBlockEntity be = usable(p, req.pos());
        if (be == null) return;
        String err = take(p, be, req.page(), req.slot(), req.id());
        if (err != null) p.displayClientMessage(Component.translatable(err), true);
    }

    /** Moves the Pokemon out of the party/PC into the station. Returns an error key, or null when it worked. */
    static String take(ServerPlayer p, StationBlockEntity be, int page, int slot, UUID id) {
        Pokemon mon;
        if (page == 0) {
            var party = StorageProxy.getPartyNow(p);
            mon = party.get(slot);
            if (mon == null || !mon.getUUID().equals(id) || mon.isEgg()) return "foragestation.moved";
            if (party.getTeam().size() <= 1) return "foragestation.last";       // never leave the party empty
            mon.getPixelmonEntity().ifPresent(e -> e.unloadEntity());   // recall it if it's out
            party.set(slot, null);
        } else {
            PCStorage pc = StorageProxy.getPCForPlayerNow(p);
            mon = pc.get(page - 1, slot);
            if (mon == null || !mon.getUUID().equals(id) || mon.isEgg()) return "foragestation.moved";
            pc.set(page - 1, slot, null);
        }
        be.insert(mon, p.getUUID(), p.getScoreboardName(), page == 0);
        p.displayClientMessage(Component.translatable("foragestation.inserted", mon.getDisplayName()), true);
        p.closeContainer();
        return null;
    }
}
