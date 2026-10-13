package dev.homedashboard.biomecompass;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;

/** Right-click opens the biome list (the server sends the unlocked biomes and the group first). */
public class CompassItem extends Item {
    public CompassItem(Properties props) {
        super(props);
    }

    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        if (player instanceof ServerPlayer sp) Network.sendOpen(sp);
        return InteractionResultHolder.sidedSuccess(player.getItemInHand(hand), level.isClientSide());
    }

    public static CompassTarget target(ItemStack stack) {
        return stack.getOrDefault(BiomeCompass.TARGET.get(), CompassTarget.NONE);
    }
}
