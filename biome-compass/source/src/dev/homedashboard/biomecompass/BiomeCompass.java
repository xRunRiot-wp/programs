package dev.homedashboard.biomecompass;

import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.biome.Biome;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLEnvironment;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;
import net.minecraft.core.component.DataComponentType;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Biome Compass: like Nature's Compass, but you only see biomes you (or your compass group) have stood in for 10 seconds. */
@Mod(BiomeCompass.MODID)
public class BiomeCompass {
    public static final String MODID = "biomecompass";
    public static final int UNLOCK_SECONDS = 10;
    /** Compass target meaning "nearest biome you haven't unlocked"; its name is "Undiscovered biome" (lang file). */
    public static final ResourceLocation UNDISCOVERED = ResourceLocation.fromNamespaceAndPath(MODID, "undiscovered");

    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MODID);
    public static final DeferredItem<Item> COMPASS = ITEMS.registerItem("biome_compass", CompassItem::new, new Item.Properties().stacksTo(1));

    public static final DeferredRegister.DataComponents COMPONENTS = DeferredRegister.createDataComponents(MODID);
    public static final DeferredHolder<DataComponentType<?>, DataComponentType<CompassTarget>> TARGET = COMPONENTS.registerComponentType("target",
            b -> b.persistent(CompassTarget.CODEC).networkSynchronized(CompassTarget.STREAM_CODEC));

    /** Per player: the biome they are standing in and for how many seconds in a row. */
    private final Map<UUID, ResourceKey<Biome>> standingIn = new HashMap<>();
    private final Map<UUID, Integer> standingSeconds = new HashMap<>();
    private int ticks;

    public BiomeCompass(IEventBus modBus) {
        ITEMS.register(modBus);
        COMPONENTS.register(modBus);
        modBus.addListener(Network::register);
        modBus.addListener((BuildCreativeModeTabContentsEvent e) -> {
            if (e.getTabKey().location().getPath().equals("tools_and_utilities")) e.accept(COMPASS.get());
        });
        NeoForge.EVENT_BUS.addListener(this::onServerTick);
        NeoForge.EVENT_BUS.addListener(this::onCommands);
        NeoForge.EVENT_BUS.addListener((PlayerEvent.PlayerLoggedInEvent e) -> {
            if (e.getEntity() instanceof ServerPlayer p) Unlocks.get(p.server).rememberName(p);
        });
        NeoForge.EVENT_BUS.addListener((PlayerEvent.PlayerLoggedOutEvent e) -> {
            standingIn.remove(e.getEntity().getUUID());
            standingSeconds.remove(e.getEntity().getUUID());
        });
        if (FMLEnvironment.dist.isClient()) dev.homedashboard.biomecompass.client.ClientSetup.init(modBus);
        if (Boolean.getBoolean("biomecompass.selftest")) NeoForge.EVENT_BUS.addListener(SelfTest::run);
    }

    private void onServerTick(ServerTickEvent.Post e) {
        if (++ticks % 20 != 0) return; // once a second
        Unlocks unlocks = Unlocks.get(e.getServer());
        for (ServerPlayer p : e.getServer().getPlayerList().getPlayers()) {
            if (p.isSpectator()) continue;
            var key = p.level().getBiome(p.blockPosition()).unwrapKey().orElse(null);
            if (key == null) continue;
            UUID id = p.getUUID();
            int secs = key.equals(standingIn.get(id)) ? standingSeconds.getOrDefault(id, 0) + 1 : 1;
            standingIn.put(id, key);
            standingSeconds.put(id, secs);
            if (secs >= UNLOCK_SECONDS) unlocks.unlock(p, key.location());
        }
    }

    private void onCommands(RegisterCommandsEvent e) {
        // Used by the clickable [Accept] in the invite chat message.
        e.getDispatcher().register(Commands.literal(MODID)
                .then(Commands.literal("accept").then(Commands.argument("player", StringArgumentType.word())
                        .executes(c -> {
                            ServerPlayer p = c.getSource().getPlayerOrException();
                            Unlocks.get(p.server).accept(p, StringArgumentType.getString(c, "player"));
                            return 1;
                        }))));
    }

    public static Component biomeName(ResourceLocation id) {
        String path = id.getPath();
        String pretty = path.substring(path.lastIndexOf('/') + 1).replace('_', ' ');
        StringBuilder sb = new StringBuilder();
        for (String w : pretty.split(" ")) if (!w.isEmpty()) sb.append(Character.toUpperCase(w.charAt(0))).append(w.substring(1)).append(' ');
        return Component.translatableWithFallback("biome." + id.getNamespace() + "." + path.replace('/', '.'), sb.toString().trim());
    }

    public static ResourceKey<Biome> biomeKey(ResourceLocation id) {
        return ResourceKey.create(Registries.BIOME, id);
    }
}
