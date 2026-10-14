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

import java.util.ArrayList;
import java.util.List;

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
        List<Row> rows = rows(s, false);
        if (rows.isEmpty()) return; // both timers still further out than "show when under"
        int[] size = hudSize(mc.font, rows, HudConfig.scale);
        int x = Mth.clamp(HudConfig.x, 0, Math.max(0, g.guiWidth() - size[0])), y = Mth.clamp(HudConfig.y, 0, Math.max(0, g.guiHeight() - size[1]));
        drawHud(g, mc.font, rows, x, y, HudConfig.scale);
    }

    public record Row(String text, int colour) {}

    /** The timer lines to show; with all = false, only timers within the "show when under" minutes. */
    public static List<Row> rows(Network.Status s, boolean all) {
        List<Row> rows = new ArrayList<>();
        if (all || within(s.legendary())) rows.add(new Row(line("Legendary", s.legendary()), LEGENDARY));
        if (all || within(s.boss())) rows.add(new Row(line("Mega Boss", s.boss()), BOSS));
        return rows;
    }

    private static boolean within(Network.Timer t) {
        if (HudConfig.showUnder <= 0) return true;
        long ms = ClientHooks.msLeft(t);
        return ms != Network.OFF && ms <= HudConfig.showUnder * 60_000L;
    }

    private static String line(String label, Network.Timer t) {
        String time = ClientHooks.countdown(t);
        return t.msLeft() == Network.OFF ? label + "  " + time : label + "  " + time + "  " + ClientHooks.times(t.times());
    }

    /** Width and height of the timer box on screen, after scaling. */
    public static int[] hudSize(Font font, List<Row> rows, float scale) {
        int w = 0;
        for (Row r : rows) w = Math.max(w, font.width(r.text()));
        return new int[]{Math.round((w + 26) * scale), Math.round(Math.max(24, rows.size() * 10 + 4) * scale)};
    }

    /** The timer box: clock icon, then one line per timer, drawn at the chosen size. */
    public static void drawHud(GuiGraphics g, Font font, List<Row> rows, int x, int y, float scale) {
        int[] size = hudSize(font, rows, 1);
        g.pose().pushPose();
        g.pose().translate(x, y, 0);
        g.pose().scale(scale, scale, 1);
        g.fill(0, 0, size[0], size[1], 0x90000000);
        g.renderItem(new ItemStack(LegendaryClock.CLOCK.get()), 3, (size[1] - 16) / 2);
        int ty = (size[1] - rows.size() * 10) / 2 + 1;
        for (Row r : rows) {
            g.drawString(font, r.text(), 22, ty, r.colour(), true);
            ty += 10;
        }
        g.pose().popPose();
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
