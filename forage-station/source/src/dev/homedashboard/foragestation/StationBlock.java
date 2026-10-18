package dev.homedashboard.foragestation;

import com.mojang.serialization.MapCodec;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Containers;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.BaseEntityBlock;
import net.minecraft.world.level.block.RenderShape;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityTicker;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;

public class StationBlock extends BaseEntityBlock {
    public static final MapCodec<StationBlock> CODEC = simpleCodec(StationBlock::new);

    public StationBlock(Properties props) { super(props); }

    @Override protected MapCodec<? extends BaseEntityBlock> codec() { return CODEC; }
    @Override protected RenderShape getRenderShape(BlockState state) { return RenderShape.MODEL; }
    @Override public BlockEntity newBlockEntity(BlockPos pos, BlockState state) { return new StationBlockEntity(pos, state); }

    @Override
    public <T extends BlockEntity> BlockEntityTicker<T> getTicker(Level level, BlockState state, BlockEntityType<T> type) {
        return level.isClientSide ? null : createTickerHelper(type, ForageStation.STATION_BE.get(), (l, p, s, be) -> be.serverTick());
    }

    @Override
    public void setPlacedBy(Level level, BlockPos pos, BlockState state, LivingEntity placer, ItemStack stack) {
        if (!level.isClientSide && placer instanceof Player p && level.getBlockEntity(pos) instanceof StationBlockEntity be) be.setOwner(p);
    }

    @Override
    protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hit) {
        if (level.isClientSide) return InteractionResult.SUCCESS;
        if (!(player instanceof ServerPlayer sp) || !(level.getBlockEntity(pos) instanceof StationBlockEntity be)) return InteractionResult.PASS;
        if (!be.hasPokemon()) {
            if (!be.mayManage(sp)) { sp.displayClientMessage(Component.translatable("foragestation.not_owner", be.ownerName()), true); return InteractionResult.CONSUME; }
            Network.sendPicker(sp, pos, 0);
        } else if (sp.isShiftKeyDown()) {
            if (!be.mayManage(sp)) { sp.displayClientMessage(Component.translatable("foragestation.not_owner", be.ownerName()), true); return InteractionResult.CONSUME; }
            be.takeBack(sp);
        } else {
            be.openStorage(sp);
        }
        return InteractionResult.CONSUME;
    }

    @Override
    protected void onRemove(BlockState state, Level level, BlockPos pos, BlockState newState, boolean moved) {
        if (!state.is(newState.getBlock()) && level.getBlockEntity(pos) instanceof StationBlockEntity be) {
            Containers.dropContents(level, pos, be.items());
            be.sendHomeOnBreak();                          // Adam: "if the block breaks its sent back to the pc"
        }
        super.onRemove(state, level, pos, newState, moved);
    }
}
