package dev.homedashboard.legendaryclock;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.Item;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLEnvironment;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/** Legendary Clock: shows when Pixelmon will next try to spawn a legendary and a mega boss, and the time of day it will be then. */
@Mod(LegendaryClock.MODID)
public class LegendaryClock {
    public static final String MODID = "legendaryclock";

    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MODID);
    public static final DeferredItem<Item> CLOCK = ITEMS.registerItem("legendary_clock", ClockItem::new, new Item.Properties().stacksTo(1));

    private int ticks;

    public LegendaryClock(IEventBus modBus) {
        ITEMS.register(modBus);
        modBus.addListener(Network::register);
        modBus.addListener((BuildCreativeModeTabContentsEvent e) -> {
            if (e.getTabKey().location().getPath().equals("tools_and_utilities")) e.accept(CLOCK.get());
        });
        NeoForge.EVENT_BUS.addListener(this::onServerTick);
        if (FMLEnvironment.dist.isClient()) dev.homedashboard.legendaryclock.client.ClientSetup.init(modBus);
        if (Boolean.getBoolean("legendaryclock.selftest")) NeoForge.EVENT_BUS.addListener(SelfTest::run);
    }

    /** Once a second, everyone carrying a clock gets the current timers (the client counts down smoothly in between). */
    private void onServerTick(ServerTickEvent.Post e) {
        if (++ticks % 20 != 0) return;
        Network.Status status = null;
        for (ServerPlayer p : e.getServer().getPlayerList().getPlayers()) {
            if (ClockFinder.find(p).isEmpty()) continue;
            if (status == null) status = SpawnInfo.status(e.getServer());
            PacketDistributor.sendToPlayer(p, status);
        }
    }
}
