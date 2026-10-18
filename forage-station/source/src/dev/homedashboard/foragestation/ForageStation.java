package dev.homedashboard.foragestation;

import net.minecraft.core.registries.Registries;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.event.OnDatapackSyncEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLEnvironment;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.capabilities.RegisterCapabilitiesEvent;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.items.wrapper.InvWrapper;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

import java.util.function.Supplier;

/** Forage Station: a block that holds one Pokemon, which forages the biome on its own (Pixelmon's Forage loot list). */
@Mod(ForageStation.MODID)
public class ForageStation {
    public static final String MODID = "foragestation";

    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(MODID);
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MODID);
    public static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES = DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, MODID);

    public static final DeferredBlock<StationBlock> STATION = BLOCKS.register("forage_station",
            () -> new StationBlock(BlockBehaviour.Properties.of().strength(2.0f).sound(SoundType.WOOD).noOcclusion()));
    public static final DeferredItem<Item> STATION_ITEM = ITEMS.register("forage_station", () -> new BlockItem(STATION.get(), new Item.Properties()));
    @SuppressWarnings("DataFlowIssue")
    public static final Supplier<BlockEntityType<StationBlockEntity>> STATION_BE = BLOCK_ENTITIES.register("forage_station",
            () -> BlockEntityType.Builder.of(StationBlockEntity::new, STATION.get()).build(null));

    public ForageStation(IEventBus modBus) {
        BLOCKS.register(modBus);
        ITEMS.register(modBus);
        BLOCK_ENTITIES.register(modBus);
        modBus.addListener(Network::register);
        modBus.addListener((RegisterCapabilitiesEvent e) ->      // hoppers / pipes pull the finds out
                e.registerBlockEntity(Capabilities.ItemHandler.BLOCK, STATION_BE.get(), (be, side) -> new InvWrapper(be.items())));
        modBus.addListener((BuildCreativeModeTabContentsEvent e) -> {
            if (e.getTabKey().location().getPath().equals("functional_blocks")) e.accept(STATION_ITEM.get());
        });
        NeoForge.EVENT_BUS.addListener((PlayerEvent.PlayerLoggedInEvent e) -> {
            if (e.getEntity() instanceof ServerPlayer p) Returns.deliver(p);   // Pokemon from stations broken while they were away
        });
        NeoForge.EVENT_BUS.addListener(EventPriority.HIGH, (ServerStartedEvent e) -> ForageLoot.load(e.getServer()));
        NeoForge.EVENT_BUS.addListener((OnDatapackSyncEvent e) -> { if (e.getPlayer() == null) ForageLoot.load(e.getPlayerList().getServer()); }); // after /reload
        if (FMLEnvironment.dist.isClient()) dev.homedashboard.foragestation.client.ClientSetup.init(modBus);
        if (Boolean.getBoolean("foragestation.selftest")) NeoForge.EVENT_BUS.addListener(SelfTest::run);
    }
}
