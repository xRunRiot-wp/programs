package dev.homedashboard.biomecompass;

import net.minecraft.ChatFormatting;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.Style;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.level.saveddata.SavedData;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Saved with the world (data/biomecompass.dat): which biomes each player found themselves, and compass groups.
 * A player sees their own finds plus everything their group members found (before or after joining).
 * Leaving a group keeps only your own finds.
 */
public class Unlocks extends SavedData {
    private static final SavedData.Factory<Unlocks> FACTORY = new SavedData.Factory<>(Unlocks::new, Unlocks::load);

    private final Map<UUID, Set<String>> found = new HashMap<>();
    private final Map<UUID, Integer> groupOf = new HashMap<>();
    private final Map<UUID, String> names = new HashMap<>();
    private int nextGroup = 1;
    /** Not saved: invitee -> inviter. */
    private final Map<UUID, UUID> invites = new HashMap<>();

    public static Unlocks get(MinecraftServer server) {
        return server.overworld().getDataStorage().computeIfAbsent(FACTORY, BiomeCompass.MODID);
    }

    public void rememberName(ServerPlayer p) {
        if (!p.getGameProfile().getName().equals(names.get(p.getUUID()))) {
            names.put(p.getUUID(), p.getGameProfile().getName());
            setDirty();
        }
    }

    public String nameOf(UUID id) {
        return names.getOrDefault(id, "?");
    }

    public Set<String> foundBy(UUID id) {
        return found.getOrDefault(id, Set.of());
    }

    /** Everyone in the player's group, including the player (just the player when not in a group). */
    public List<UUID> groupMembers(UUID id) {
        Integer g = groupOf.get(id);
        if (g == null) return List.of(id);
        List<UUID> out = new ArrayList<>();
        for (var e : groupOf.entrySet()) if (e.getValue().equals(g)) out.add(e.getKey());
        return out;
    }

    public Set<String> visibleTo(UUID id) {
        Set<String> out = new HashSet<>();
        for (UUID m : groupMembers(id)) out.addAll(foundBy(m));
        return out;
    }

    public void unlock(ServerPlayer p, ResourceLocation biome) {
        String key = biome.toString();
        if (foundBy(p.getUUID()).contains(key)) return;
        rememberName(p);
        boolean newForGroup = !visibleTo(p.getUUID()).contains(key);
        found.computeIfAbsent(p.getUUID(), k -> new HashSet<>()).add(key);
        setDirty();
        if (!newForGroup) return; // the group already had it; now it's also the player's own find (kept if they leave)
        Component name = BiomeCompass.biomeName(biome).copy().withStyle(ChatFormatting.YELLOW);
        p.sendSystemMessage(Component.translatable("biomecompass.unlocked", name).withStyle(ChatFormatting.GREEN));
        p.playNotifySound(SoundEvents.PLAYER_LEVELUP, SoundSource.PLAYERS, 0.5f, 1.4f);
        for (UUID m : groupMembers(p.getUUID())) {
            ServerPlayer other = m.equals(p.getUUID()) ? p : p.server.getPlayerList().getPlayer(m);
            if (other != null && other != p)
                other.sendSystemMessage(Component.translatable("biomecompass.unlocked_by", p.getDisplayName(), name).withStyle(ChatFormatting.GREEN));
            if (other != null) Network.autoUndiscovered(other);
        }
    }

    public void invite(ServerPlayer from, String targetName) {
        rememberName(from);
        ServerPlayer to = from.server.getPlayerList().getPlayerByName(targetName);
        if (to == null || to == from) {
            from.sendSystemMessage(Component.translatable("biomecompass.invite_offline", targetName).withStyle(ChatFormatting.RED));
            return;
        }
        if (groupMembers(from.getUUID()).contains(to.getUUID())) {
            from.sendSystemMessage(Component.translatable("biomecompass.already_in_group", to.getDisplayName()).withStyle(ChatFormatting.YELLOW));
            return;
        }
        invites.put(to.getUUID(), from.getUUID());
        String fromName = from.getGameProfile().getName();
        Component accept = Component.translatable("biomecompass.accept").withStyle(Style.EMPTY.withColor(ChatFormatting.GREEN).withBold(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.RUN_COMMAND, "/" + BiomeCompass.MODID + " accept " + fromName))
                .withHoverEvent(new HoverEvent(HoverEvent.Action.SHOW_TEXT, Component.translatable("biomecompass.accept_hover", fromName))));
        to.sendSystemMessage(Component.translatable("biomecompass.invited", from.getDisplayName(), accept).withStyle(ChatFormatting.AQUA));
        from.sendSystemMessage(Component.translatable("biomecompass.invite_sent", to.getDisplayName()).withStyle(ChatFormatting.AQUA));
    }

    public void accept(ServerPlayer p, String inviterName) {
        UUID inviter = invites.get(p.getUUID());
        if (inviter == null || !inviterName.equalsIgnoreCase(nameOf(inviter))) {
            p.sendSystemMessage(Component.translatable("biomecompass.no_invite", inviterName).withStyle(ChatFormatting.RED));
            return;
        }
        invites.remove(p.getUUID());
        rememberName(p);
        if (groupMembers(p.getUUID()).contains(inviter)) return;
        if (groupOf.containsKey(p.getUUID())) leave(p);
        Integer g = groupOf.get(inviter);
        if (g == null) {
            g = nextGroup++;
            groupOf.put(inviter, g);
        }
        groupOf.put(p.getUUID(), g);
        setDirty();
        for (UUID m : groupMembers(p.getUUID())) {
            ServerPlayer other = p.server.getPlayerList().getPlayer(m);
            if (other != null) other.sendSystemMessage(Component.translatable("biomecompass.joined", p.getDisplayName(), visibleTo(p.getUUID()).size()).withStyle(ChatFormatting.AQUA));
        }
    }

    public void leave(ServerPlayer p) {
        Integer g = groupOf.remove(p.getUUID());
        if (g == null) return;
        setDirty();
        p.sendSystemMessage(Component.translatable("biomecompass.left", foundBy(p.getUUID()).size()).withStyle(ChatFormatting.AQUA));
        List<UUID> rest = new ArrayList<>();
        for (var e : groupOf.entrySet()) if (e.getValue().equals(g)) rest.add(e.getKey());
        for (UUID m : rest) {
            ServerPlayer other = p.server.getPlayerList().getPlayer(m);
            if (other != null) other.sendSystemMessage(Component.translatable("biomecompass.member_left", p.getDisplayName()).withStyle(ChatFormatting.AQUA));
        }
        if (rest.size() == 1) groupOf.remove(rest.get(0)); // a group of one is no group
    }

    public boolean inGroup(UUID id) {
        return groupOf.containsKey(id);
    }

    @Override
    public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
        CompoundTag f = new CompoundTag();
        found.forEach((id, set) -> {
            ListTag list = new ListTag();
            for (String s : set) list.add(StringTag.valueOf(s));
            f.put(id.toString(), list);
        });
        tag.put("found", f);
        CompoundTag g = new CompoundTag();
        groupOf.forEach((id, n) -> g.putInt(id.toString(), n));
        tag.put("groups", g);
        CompoundTag n = new CompoundTag();
        names.forEach((id, s) -> n.putString(id.toString(), s));
        tag.put("names", n);
        tag.putInt("next_group", nextGroup);
        return tag;
    }

    private static Unlocks load(CompoundTag tag, HolderLookup.Provider registries) {
        Unlocks u = new Unlocks();
        CompoundTag f = tag.getCompound("found");
        for (String k : f.getAllKeys()) {
            Set<String> set = new HashSet<>();
            for (Tag t : f.getList(k, Tag.TAG_STRING)) set.add(t.getAsString());
            u.found.put(UUID.fromString(k), set);
        }
        CompoundTag g = tag.getCompound("groups");
        for (String k : g.getAllKeys()) u.groupOf.put(UUID.fromString(k), g.getInt(k));
        CompoundTag n = tag.getCompound("names");
        for (String k : n.getAllKeys()) u.names.put(UUID.fromString(k), n.getString(k));
        u.nextGroup = Math.max(1, tag.getInt("next_group"));
        return u;
    }
}
