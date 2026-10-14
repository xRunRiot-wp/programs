package dev.homedashboard.legendaryclock;

import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import top.theillusivec4.curios.api.CuriosApi;
import top.theillusivec4.curios.api.SlotResult;

/** Only loaded when Curios is installed. The "legendary_clock" slot itself comes from data/legendaryclock/curios. */
final class CuriosCompat {
    private CuriosCompat() {}

    static ItemStack find(Player p) {
        return CuriosApi.getCuriosInventory(p).flatMap(inv -> inv.findFirstCurio(ClockFinder::isClock)).map(SlotResult::stack).orElse(ItemStack.EMPTY);
    }

    /** For the self-test: is our slot registered, and does it accept the clock? */
    static String check(Player p) {
        boolean slot = CuriosApi.getSlot("legendary_clock", false).isPresent();
        boolean onPlayer = CuriosApi.getCuriosInventory(p).map(inv -> inv.getCurios().containsKey("legendary_clock")).orElse(false);
        boolean valid = new ItemStack(LegendaryClock.CLOCK.get()).is(net.minecraft.tags.ItemTags.create(net.minecraft.resources.ResourceLocation.fromNamespaceAndPath("curios", "legendary_clock")));
        return "slot=" + slot + " onPlayer=" + onPlayer + " tagAccepts=" + valid;
    }
}
