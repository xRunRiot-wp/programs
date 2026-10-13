package dev.homedashboard.biomecompass.client;

import dev.homedashboard.biomecompass.BiomeCompass;
import dev.homedashboard.biomecompass.CompassFinder;
import dev.homedashboard.biomecompass.CompassItem;
import dev.homedashboard.biomecompass.CompassTarget;
import dev.homedashboard.biomecompass.Network;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.client.renderer.item.CompassItemPropertyFunction;
import net.minecraft.client.renderer.item.ItemProperties;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.neoforge.client.event.RegisterGuiLayersEvent;
import net.neoforged.neoforge.client.event.ScreenEvent;
import net.neoforged.neoforge.common.NeoForge;

import java.util.ArrayList;
import java.util.List;

/** Needle, on-screen distance text, and the inventory button (shown while the compass sits in the Curios slot). */
public final class ClientSetup {
    private ClientSetup() {}

    public static void init(IEventBus modBus) {
        modBus.addListener((FMLClientSetupEvent e) -> e.enqueueWork(() ->
                ItemProperties.register(BiomeCompass.COMPASS.get(), ResourceLocation.fromNamespaceAndPath(BiomeCompass.MODID, "angle"),
                        new CompassItemPropertyFunction((level, stack, entity) -> {
                            CompassTarget t = CompassItem.target(stack);
                            return t.state() == CompassTarget.FOUND ? t.pos().orElse(null) : null; // null = needle spins
                        }))));
        modBus.addListener((RegisterGuiLayersEvent e) ->
                e.registerAboveAll(ResourceLocation.fromNamespaceAndPath(BiomeCompass.MODID, "hud"), ClientSetup::renderHud));
        NeoForge.EVENT_BUS.addListener(ClientSetup::onScreenInit);
    }

    private static void renderHud(GuiGraphics g, DeltaTracker delta) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.options.hideGui || mc.getDebugOverlay().showDebugScreen() || mc.screen != null) return;
        ItemStack stack = CompassFinder.active(mc.player);
        if (stack.isEmpty()) return;
        CompassTarget t = CompassItem.target(stack);
        if (t.biome().isEmpty()) return;
        Component biome = BiomeCompass.biomeName(ResourceLocation.parse(t.biome()));
        List<Component> lines = new ArrayList<>();
        switch (t.state()) {
            case CompassTarget.SEARCHING -> lines.add(Component.translatable("biomecompass.hud.searching", biome));
            case CompassTarget.NOT_FOUND -> lines.add(Component.translatable("biomecompass.hud.not_found", biome));
            case CompassTarget.FOUND -> {
                var pos = t.pos().orElseThrow();
                lines.add(Component.translatable("biomecompass.hud.biome", biome));
                if (!pos.dimension().equals(mc.player.level().dimension())) {
                    lines.add(Component.translatable("biomecompass.hud.other_dimension"));
                } else {
                    double dx = pos.pos().getX() + 0.5 - mc.player.getX(), dz = pos.pos().getZ() + 0.5 - mc.player.getZ();
                    double dy = t.cave() ? pos.pos().getY() - mc.player.getY() : 0; // cave biomes: height counts
                    lines.add(t.cave() ? Component.translatable("biomecompass.hud.coords3", pos.pos().getX(), pos.pos().getY(), pos.pos().getZ())
                            : Component.translatable("biomecompass.hud.coords", pos.pos().getX(), pos.pos().getZ()));
                    lines.add(Component.translatable("biomecompass.hud.distance", (int) Math.sqrt(dx * dx + dy * dy + dz * dz)));
                }
            }
            default -> { return; }
        }
        // In the Curios slot you can't see the needle, so draw the compass itself (needle and all) at double size.
        boolean inHand = mc.player.getMainHandItem() == stack || mc.player.getOffhandItem() == stack;
        int textX = 5;
        if (!inHand) {
            g.pose().pushPose();
            g.pose().translate(4, 4, 0);
            g.pose().scale(2, 2, 1);
            g.renderItem(mc.player, stack, 0, 0, 0);
            g.pose().popPose();
            textX = 42;
        }
        int y = 5;
        for (Component line : lines) {
            g.drawString(mc.font, line, textX, y, 0xFFFFFFFF, true);
            y += 10;
        }
    }

    /** Small compass button in the inventory, inside the inventory's own frame so it never covers JEI or the recipe book. */
    private static void onScreenInit(ScreenEvent.Init.Post e) {
        if (!(e.getScreen() instanceof AbstractContainerScreen<?> screen)) return;
        boolean isInventory = screen instanceof InventoryScreen || screen.getClass().getName().equals("top.theillusivec4.curios.client.gui.CuriosScreen");
        if (!isInventory) return;
        e.addListener(new InventoryButton(screen));
    }

    private static final class InventoryButton extends Button {
        private final AbstractContainerScreen<?> screen;
        private final Tooltip tooltip = Tooltip.create(Component.translatable("biomecompass.gui.open"));

        InventoryButton(AbstractContainerScreen<?> screen) {
            super(screen.getGuiLeft() + 156, screen.getGuiTop() + 4, 16, 16, Component.translatable("item.biomecompass.biome_compass"),
                    b -> Network.sendAction("open", ""), Button.DEFAULT_NARRATION);
            this.screen = screen;
        }

        @Override
        protected void renderWidget(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
            Minecraft mc = Minecraft.getInstance();
            // Follow the inventory when the recipe book shifts it, and only show while the compass is in the Curios slot.
            setPosition(screen.getGuiLeft() + 156, screen.getGuiTop() + 4);
            boolean show = mc.player != null && CompassFinder.curiosLoaded() && !CompassFinder.active(mc.player).isEmpty()
                    && !mc.player.getMainHandItem().is(BiomeCompass.COMPASS.get()) && !mc.player.getOffhandItem().is(BiomeCompass.COMPASS.get());
            active = show;
            setTooltip(show ? tooltip : null);
            if (!show) return;
            if (isHovered()) g.fill(getX(), getY(), getX() + 16, getY() + 16, 0x60FFFFFF);
            g.renderItem(new ItemStack(BiomeCompass.COMPASS.get()), getX(), getY());
        }
    }
}
