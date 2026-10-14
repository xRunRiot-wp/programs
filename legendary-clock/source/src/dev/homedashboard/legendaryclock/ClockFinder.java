package dev.homedashboard.legendaryclock;

import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.neoforged.fml.ModList;

/** Finds the player's clock: hands, the Curios clock slot, then the rest of the inventory. */
public final class ClockFinder {
    private ClockFinder() {}

    public static boolean curiosLoaded() {
        return ModList.get().isLoaded("curios");
    }

    public static boolean isClock(ItemStack s) {
        return s.is(LegendaryClock.CLOCK.get());
    }

    public static ItemStack find(Player p) {
        if (isClock(p.getMainHandItem())) return p.getMainHandItem();
        if (isClock(p.getOffhandItem())) return p.getOffhandItem();
        ItemStack c = inSlot(p);
        if (!c.isEmpty()) return c;
        for (ItemStack s : p.getInventory().items) if (isClock(s)) return s;
        return ItemStack.EMPTY;
    }

    /** The clock in the Curios clock slot, if any. */
    public static ItemStack inSlot(Player p) {
        return curiosLoaded() ? CuriosCompat.find(p) : ItemStack.EMPTY;
    }
}
