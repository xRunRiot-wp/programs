package dev.homedashboard.foragestation;

import com.pixelmonmod.pixelmon.api.config.PixelmonConfigProxy;
import com.pixelmonmod.pixelmon.api.pokemon.Pokemon;
import com.pixelmonmod.pixelmon.api.pokemon.PokemonFactory;
import com.pixelmonmod.pixelmon.api.storage.StorageProxy;
import com.pixelmonmod.pixelmon.api.util.helpers.SpriteItemHelper;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientGamePacketListener;
import net.minecraft.network.protocol.game.ClientboundBlockEntityDataPacket;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Containers;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;

import java.util.UUID;

/** Holds one Pokemon (as Pixelmon NBT, out of the owner's party/PC), the finds (27 slots) and the forage timer. */
public class StationBlockEntity extends BlockEntity {
    public static final int SLOTS = 27;

    private final SimpleContainer items = new SimpleContainer(SLOTS) {
        @Override public void setChanged() { super.setChanged(); StationBlockEntity.this.setChanged(); }
        @Override public boolean stillValid(Player p) { return !isRemoved() && p.distanceToSqr(worldPosition.getCenter()) < 64; }
    };
    private CompoundTag pokemonTag;      // null = empty station
    private boolean fromParty;           // where it came from, so "take back" returns it there
    private UUID owner;
    private String ownerName = "";
    private int cooldown;                // ticks until the next forage try
    private Pokemon cached;
    // what the client draws on top
    private ItemStack photo = ItemStack.EMPTY;
    private String pokemonName = "";

    public StationBlockEntity(BlockPos pos, BlockState state) { super(ForageStation.STATION_BE.get(), pos, state); }

    public SimpleContainer items() { return items; }
    public boolean hasPokemon() { return pokemonTag != null; }
    public ItemStack photo() { return photo; }
    public String pokemonName() { return pokemonName; }
    public String ownerName() { return ownerName; }
    public UUID owner() { return owner; }
    public int cooldown() { return cooldown; }

    public void setOwner(Player p) { owner = p.getUUID(); ownerName = p.getScoreboardName(); setChanged(); }

    /** Only the owner puts in / takes out the Pokemon. An empty station with no owner goes to whoever uses it. */
    public boolean mayManage(Player p) { return owner == null || owner.equals(p.getUUID()); }

    public Pokemon pokemon() {
        if (pokemonTag == null) return null;
        if (cached == null && level != null) cached = PokemonFactory.create(pokemonTag, level.registryAccess());
        return cached;
    }

    /** Takes the Pokemon (already removed from its storage) into the station. */
    public void insert(Pokemon mon, UUID ownerId, String name, boolean party) {
        owner = ownerId; ownerName = name;
        pokemonTag = mon.writeToNBT(new CompoundTag(), level.registryAccess());
        cached = mon;
        fromParty = party;
        cooldown = ForageLoot.cooldownTicks(mon.getStats().getSpeed());
        refreshDisplay();
    }

    /** Owner shift-clicks: back to the party if it came from there and there is room, otherwise the PC. */
    public void takeBack(ServerPlayer p) {
        Pokemon mon = pokemon();
        if (mon == null) return;
        var party = StorageProxy.getPartyNow(p);
        boolean ok = fromParty && party.getFirstEmptyPosition() != null && party.add(mon);
        String where = "party";
        if (!ok) { ok = StorageProxy.getPCForPlayerNow(p).add(mon); where = "pc"; }
        if (!ok) { p.displayClientMessage(Component.translatable("foragestation.no_room"), true); return; }
        p.displayClientMessage(Component.translatable("foragestation.returned." + where, mon.getDisplayName()), true);
        clearPokemon();
    }

    /** Block broken (by anyone, or an explosion): the Pokemon goes to the owner's PC, now or when they next log in. */
    public void sendHomeOnBreak() {
        if (pokemonTag == null || !(level instanceof ServerLevel sl)) return;
        Returns.queue(sl.getServer(), owner, ownerName, pokemonTag);
        pokemonTag = null; cached = null;
    }

    private void clearPokemon() {
        pokemonTag = null; cached = null; cooldown = 0;
        refreshDisplay();
    }

    public boolean hasSpace() {
        for (int i = 0; i < SLOTS; i++) if (items.getItem(i).isEmpty()) return true;
        return false;
    }

    public void openStorage(ServerPlayer p) {
        Pokemon mon = pokemon();
        Component name = mon == null ? Component.literal("?") : mon.getDisplayName();
        Component title = hasSpace() ? Component.translatable("foragestation.title", name, Math.max(1, cooldown / 20))
                : Component.translatable("foragestation.title_full", name);
        p.openMenu(new SimpleMenuProvider((id, inv, pl) -> ChestMenu.threeRows(id, inv, items), title));
    }

    void serverTick() {
        if (pokemonTag == null) return;
        if (--cooldown > 0) return;
        Pokemon mon = pokemon();
        if (mon == null) return;
        if (!hasSpace()) { cooldown = 100; return; }        // full: look again in 5 s
        forageOnce(mon);
        cooldown = ForageLoot.cooldownTicks(mon.getStats().getSpeed());
        setChanged();
    }

    /** One forage try, the same odds as Pixelmon's own Forage (forage-chance in external_moves.yml). Returns what was found. */
    ItemStack forageOnce(Pokemon mon) {
        if (level.random.nextFloat() >= PixelmonConfigProxy.getExternalMoves().getForageChance()) return ItemStack.EMPTY;
        ItemStack found = ForageLoot.roll((ServerLevel) level, worldPosition, level.random);
        if (found.isEmpty()) return found;
        ItemStack copy = found.copy();
        ItemStack left = items.addItem(found);
        if (!left.isEmpty()) Containers.dropItemStack(level, worldPosition.getX() + 0.5, worldPosition.getY() + 1.1, worldPosition.getZ() + 0.5, left);
        return copy;
    }

    private void refreshDisplay() {
        Pokemon mon = pokemon();
        photo = mon == null ? ItemStack.EMPTY : SpriteItemHelper.getPhoto(mon);
        pokemonName = mon == null ? "" : mon.getDisplayName().getString();
        setChanged();
        if (level != null && !level.isClientSide) level.sendBlockUpdated(worldPosition, getBlockState(), getBlockState(), 3);
    }

    @Override
    protected void saveAdditional(CompoundTag tag, HolderLookup.Provider reg) {
        super.saveAdditional(tag, reg);
        tag.put("Items", items.createTag(reg));
        if (pokemonTag != null) tag.put("Pokemon", pokemonTag);
        tag.putBoolean("FromParty", fromParty);
        if (owner != null) tag.putUUID("Owner", owner);
        tag.putString("OwnerName", ownerName);
        tag.putInt("Cooldown", cooldown);
    }

    @Override
    protected void loadAdditional(CompoundTag tag, HolderLookup.Provider reg) {
        super.loadAdditional(tag, reg);
        if (tag.contains("ClientSync")) {                              // the small update the client gets
            photo = tag.contains("Photo") ? ItemStack.parseOptional(reg, tag.getCompound("Photo")) : ItemStack.EMPTY;
            pokemonName = tag.getString("PokemonName");
            ownerName = tag.getString("OwnerName");
            return;
        }
        items.fromTag(tag.getList("Items", 10), reg);
        pokemonTag = tag.contains("Pokemon") ? tag.getCompound("Pokemon") : null;
        cached = null;
        fromParty = tag.getBoolean("FromParty");
        owner = tag.hasUUID("Owner") ? tag.getUUID("Owner") : null;
        ownerName = tag.getString("OwnerName");
        cooldown = tag.getInt("Cooldown");
    }

    @Override
    public CompoundTag getUpdateTag(HolderLookup.Provider reg) {
        if (pokemonTag != null && photo.isEmpty()) {                   // after a world load
            Pokemon mon = pokemon();
            if (mon != null) { photo = SpriteItemHelper.getPhoto(mon); pokemonName = mon.getDisplayName().getString(); }
        }
        CompoundTag tag = new CompoundTag();
        tag.putBoolean("ClientSync", true);
        if (!photo.isEmpty()) tag.put("Photo", photo.save(reg));
        tag.putString("PokemonName", pokemonName);
        tag.putString("OwnerName", ownerName);
        return tag;
    }

    @Override public Packet<ClientGamePacketListener> getUpdatePacket() { return ClientboundBlockEntityDataPacket.create(this); }
}
