package dev.homedashboard.foragestation;

import com.pixelmonmod.pixelmon.api.pokemon.Pokemon;
import com.pixelmonmod.pixelmon.api.pokemon.PokemonFactory;
import com.pixelmonmod.pixelmon.api.storage.StorageProxy;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.saveddata.SavedData;

import java.util.UUID;

/**
 * Pokemon from broken stations, waiting to go to their owner's PC. Saved with the world, so nothing is lost if the
 * owner is offline (their PC is only touched while they are online, when Pixelmon has it loaded properly).
 */
public final class Returns extends SavedData {
    private final ListTag pending = new ListTag();   // {Owner, OwnerName, Pokemon}

    private static final Factory<Returns> FACTORY = new Factory<>(Returns::new, Returns::load, null);

    private static Returns load(CompoundTag tag, HolderLookup.Provider reg) {
        Returns r = new Returns();
        r.pending.addAll(tag.getList("Pending", 10));
        return r;
    }

    @Override public CompoundTag save(CompoundTag tag, HolderLookup.Provider reg) { tag.put("Pending", pending.copy()); return tag; }

    static Returns get(MinecraftServer server) { return server.overworld().getDataStorage().computeIfAbsent(FACTORY, "foragestation_returns"); }

    public static int pendingCount(MinecraftServer server) { return get(server).pending.size(); }

    static void queue(MinecraftServer server, UUID owner, String ownerName, CompoundTag pokemon) {
        if (owner == null) return;
        Returns r = get(server);
        CompoundTag e = new CompoundTag();
        e.putUUID("Owner", owner);
        e.putString("OwnerName", ownerName);
        e.put("Pokemon", pokemon.copy());
        r.pending.add(e);
        r.setDirty();
        ServerPlayer p = server.getPlayerList().getPlayer(owner);
        if (p != null) server.execute(() -> deliver(p));              // after the block is fully gone
    }

    /** Puts every waiting Pokemon of this player into their PC (or party if the PC is full). */
    static void deliver(ServerPlayer p) {
        Returns r = get(p.server);
        var reg = p.server.registryAccess();
        for (int i = r.pending.size() - 1; i >= 0; i--) {
            CompoundTag e = r.pending.getCompound(i);
            if (!e.getUUID("Owner").equals(p.getUUID())) continue;
            Pokemon mon = PokemonFactory.create(e.getCompound("Pokemon"), reg);
            boolean ok = StorageProxy.getPCForPlayerNow(p).add(mon) || StorageProxy.getPartyNow(p).add(mon);
            if (!ok) { p.sendSystemMessage(Component.translatable("foragestation.return_waiting", mon.getDisplayName())); continue; }
            p.sendSystemMessage(Component.translatable("foragestation.returned.broken", mon.getDisplayName()));
            r.pending.remove(i);
            r.setDirty();
        }
    }
}
