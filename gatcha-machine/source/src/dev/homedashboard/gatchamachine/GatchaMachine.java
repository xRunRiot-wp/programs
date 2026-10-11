package dev.homedashboard.gatchamachine;

import com.mojang.serialization.Codec;
import com.pixelmonmod.pixelmon.Pixelmon;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.Item;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.attachment.AttachmentType;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.event.entity.player.AdvancementEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;
import net.neoforged.neoforge.registries.NeoForgeRegistries;

import java.util.function.Supplier;

/** Gatcha Machine: earn points (time + new Pokedex entries) after getting the machine, spend them on a boss spin. */
@Mod(GatchaMachine.MODID)
public class GatchaMachine {
    public static final String MODID = "gatchamachine";
    public static final ResourceLocation ADVANCEMENT = ResourceLocation.fromNamespaceAndPath(MODID, "got_gatcha_machine");

    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MODID);
    public static final DeferredItem<Item> MACHINE = ITEMS.registerItem("gatcha_machine", GatchaMachineItem::new, new Item.Properties().stacksTo(1));

    /** Points live in the player's save under "gatchamachine:points" - kept across mod versions as long as this id stays. */
    public static final DeferredRegister<AttachmentType<?>> ATTACHMENTS = DeferredRegister.create(NeoForgeRegistries.ATTACHMENT_TYPES, MODID);
    public static final Supplier<AttachmentType<Integer>> POINTS = ATTACHMENTS.register("points",
            () -> AttachmentType.builder(() -> 0).serialize(Codec.INT).copyOnDeath().build());

    private int ticks;

    public GatchaMachine(IEventBus modBus) {
        ITEMS.register(modBus);
        ATTACHMENTS.register(modBus);
        modBus.addListener(Network::register);
        modBus.addListener((BuildCreativeModeTabContentsEvent e) -> {
            if (e.getTabKey().location().getPath().equals("tools_and_utilities")) e.accept(MACHINE.get());
        });
        NeoForge.EVENT_BUS.addListener(this::onServerTick);
        NeoForge.EVENT_BUS.addListener((PlayerEvent.PlayerLoggedInEvent e) -> {
            if (e.getEntity() instanceof ServerPlayer p) Network.syncPoints(p);
        });
        NeoForge.EVENT_BUS.addListener((AdvancementEvent.AdvancementEarnEvent e) -> {
            if (e.getAdvancement().id().equals(ADVANCEMENT) && e.getEntity() instanceof ServerPlayer p) {
                p.sendSystemMessage(Component.translatable("gatchamachine.unlocked"));
                Network.syncPoints(p);
            }
        });
        Pixelmon.EVENT_BUS.addListener(PokedexPoints::onPokedex);
        Pixelmon.EVENT_BUS.addListener(EventPriority.LOWEST, PokedexPoints::onCapture); // after anything that might cancel the catch
        if (Boolean.getBoolean("gatchamachine.selftest")) NeoForge.EVENT_BUS.addListener(SelfTest::run);
    }

    private void onServerTick(ServerTickEvent.Post e) {
        BossSpin.tickPending(e.getServer());
        if (++ticks % 100 != 0) return; // 5 points every 5 seconds
        for (ServerPlayer p : e.getServer().getPlayerList().getPlayers()) {
            if (isUnlocked(p)) addPoints(p, 5);
        }
    }

    public static boolean isUnlocked(ServerPlayer p) {
        var holder = p.server.getAdvancements().get(ADVANCEMENT);
        return holder != null && p.getAdvancements().getOrStartProgress(holder).isDone();
    }

    public static int getPoints(ServerPlayer p) {
        return p.getData(POINTS);
    }

    public static void addPoints(ServerPlayer p, int amount) {
        p.setData(POINTS, Math.max(0, getPoints(p) + amount));
        Network.syncPoints(p);
    }
}
