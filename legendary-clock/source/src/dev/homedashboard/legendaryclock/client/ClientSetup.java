package dev.homedashboard.legendaryclock.client;

import dev.homedashboard.legendaryclock.ClockFinder;
import dev.homedashboard.legendaryclock.LegendaryClock;
import dev.homedashboard.legendaryclock.Network;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.client.event.RegisterGuiLayersEvent;
import net.neoforged.neoforge.client.event.ScreenEvent;
import net.neoforged.neoforge.common.NeoForge;

/** The movable on-screen timer and the inventory button. */
public final class ClientSetup {
    private ClientSetup() {}

    public static final int LEGENDARY = 0xFFFFD54A, BOSS = 0xFFE58CFF, TEXT = 0xFFFFFFFF, DIM = 0xFFB0B0B0;

    public static void init(IEventBus modBus) {
        modBus.addListener((RegisterGuiLayersEvent e) ->
                e.registerAboveAll(ResourceLocation.fromNamespaceAndPath(LegendaryClock.MODID, "hud"), ClientSetup::renderHud));
        NeoForge.EVENT_BUS.addListener(ClientSetup::onScreenInit);
    }

    private static void renderHud(GuiGraphics g, DeltaTracker delta) {
        Minecraft mc = Minecraft.getInstance();
        HudConfig.load();
        if (!HudConfig.shown || mc.player == null || mc.options.hideGui || mc.getDebugOverlay().showDebugScreen() || mc.screen != null) return;
        if (ClockFinder.find(mc.player).isEmpty()) return;
        Network.Status s = ClientHooks.status();
        if (s == null) return;
        int[] size = hudSize(mc.font, s);
        int x = Mth.clamp(HudConfig.x, 0, Math.max(0, g.guiWidth() - size[0])), y = Mth.clamp(HudConfig.y, 0, Math.max(0, g.guiHeight() - size[1]));
        drawHud(g, mc.font, s, x, y);
    }

    private static String line(String label, Network.Timer t) {
        String time = ClientHooks.countdown(t);
        return t.msLeft() == Network.OFF ? label + "  " + time : label + "  " + time + "  " + ClientHooks.times(t.times());
    }

    /** Width and height of the timer box. */
    public static int[] hudSize(Font font, Network.Status s) {
        int w = Math.max(font.width(line("Legendary", s.legendary())), font.width(line("Mega Boss", s.boss())));
        return new int[]{w + 26, 24};
    }

    /** The timer box: clock icon, then one line each for the legendary and the mega boss. */
    public static void drawHud(GuiGraphics g, Font font, Network.Status s, int x, int y) {
        int[] size = hudSize(font, s);
        g.fill(x, y, x + size[0], y + size[1], 0x90000000);
        g.renderItem(new ItemStack(LegendaryClock.CLOCK.get()), x + 3, y + 4);
        g.drawString(font, line("Legendary", s.legendary()), x + 22, y + 3, LEGENDARY, true);
        g.drawString(font, line("Mega Boss", s.boss()), x + 22, y + 13, BOSS, true);
    }

    /** Small clock button in the inventory, inside the inventory's own frame (under the crafting result), clear of JEI and the compass button. */
    private static void onScreenInit(ScreenEvent.Init.Post e) {
        if (!(e.getScreen() instanceof AbstractContainerScreen<?> screen)) return;
        boolean isInventory = screen instanceof InventoryScreen || screen.getClass().getName().equals("top.theillusivec4.curios.client.gui.CuriosScreen");
        if (!isInventory) return;
        e.addListener(new InventoryButton(screen));
    }

    private static final class InventoryButton extends Button {
        private static final int DX = 156, DY = 62;
        private final AbstractContainerScreen<?> screen;
        private final Tooltip tooltip = Tooltip.create(Component.translatable("legendaryclock.gui.open"));

        InventoryButton(AbstractContainerScreen<?> screen) {
            super(screen.getGuiLeft() + DX, screen.getGuiTop() + DY, 16, 16, Component.translatable("item.legendaryclock.legendary_clock"),
                    b -> ClientHooks.openScreen(), Button.DEFAULT_NARRATION);
            this.screen = screen;
        }

        @Override
        protected void renderWidget(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
            Minecraft mc = Minecraft.getInstance();
            // Follow the inventory when the recipe book shifts it; only show while you carry a clock.
            setPosition(screen.getGuiLeft() + DX, screen.getGuiTop() + DY);
            boolean show = mc.player != null && !ClockFinder.find(mc.player).isEmpty();
            active = show;
            setTooltip(show ? tooltip : null);
            if (!show) return;
            if (isHovered()) g.fill(getX(), getY(), getX() + 16, getY() + 16, 0x60FFFFFF);
            g.renderItem(new ItemStack(LegendaryClock.CLOCK.get()), getX(), getY());
        }
    }
}
