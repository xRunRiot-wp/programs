package dev.homedashboard.biomecompass;

import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import top.theillusivec4.curios.api.CuriosApi;
import top.theillusivec4.curios.api.SlotResult;

import java.util.function.Predicate;

/** Only loaded when Curios is installed. The "biome_compass" slot itself comes from data/biomecompass/curios. */
final class CuriosCompat {
    private CuriosCompat() {}

    static ItemStack find(Player p, Predicate<ItemStack> ok) {
        return CuriosApi.getCuriosInventory(p).flatMap(inv -> inv.findFirstCurio(ok)).map(SlotResult::stack).orElse(ItemStack.EMPTY);
    }

    /** For the self-test: is our slot registered, and does it accept the compass? */
    static String check(Player p) {
        boolean slot = CuriosApi.getSlot("biome_compass", false).isPresent();
        boolean onPlayer = CuriosApi.getCuriosInventory(p).map(inv -> inv.getCurios().containsKey("biome_compass")).orElse(false);
        boolean valid = new ItemStack(BiomeCompass.COMPASS.get()).is(net.minecraft.tags.ItemTags.create(net.minecraft.resources.ResourceLocation.fromNamespaceAndPath("curios", "biome_compass")));
        return "slot=" + slot + " onPlayer=" + onPlayer + " tagAccepts=" + valid;
    }
}
