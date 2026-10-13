package dev.homedashboard.biomecompass;

import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.neoforged.fml.ModList;

import java.util.function.Predicate;

/** Finds the player's compass: hands first, then the Curios compass slot, then the rest of the inventory. */
public final class CompassFinder {
    private CompassFinder() {}

    public static boolean curiosLoaded() {
        return ModList.get().isLoaded("curios");
    }

    public static ItemStack find(Player p, Predicate<ItemStack> extra) {
        Predicate<ItemStack> ok = s -> s.is(BiomeCompass.COMPASS.get()) && extra.test(s);
        if (ok.test(p.getMainHandItem())) return p.getMainHandItem();
        if (ok.test(p.getOffhandItem())) return p.getOffhandItem();
        if (curiosLoaded()) {
            ItemStack c = CuriosCompat.find(p, ok);
            if (!c.isEmpty()) return c;
        }
        for (ItemStack s : p.getInventory().items) if (ok.test(s)) return s;
        return ItemStack.EMPTY;
    }

    /** The compass to show on screen: one in a hand or the Curios slot (not one sitting in the backpack). */
    public static ItemStack active(Player p) {
        if (p.getMainHandItem().is(BiomeCompass.COMPASS.get())) return p.getMainHandItem();
        if (p.getOffhandItem().is(BiomeCompass.COMPASS.get())) return p.getOffhandItem();
        return curiosLoaded() ? CuriosCompat.find(p, s -> s.is(BiomeCompass.COMPASS.get())) : ItemStack.EMPTY;
    }

    public static ItemStack findBySearch(Player p, int searchId) {
        return find(p, s -> CompassItem.target(s).searchId() == searchId);
    }
}
