package dev.homedashboard.legendaryclock.client;

import dev.homedashboard.legendaryclock.Network;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.Locale;

/** The clock's screen: both timers in full, the time of day now and at each try, and the on-screen timer settings. */
public class ClockScreen extends Screen {
    private static final int W = 260, H = 196;
    private static final int BG = 0xE0101418, BORDER = 0xFFC9A227;

    public ClockScreen() {
        super(Component.translatable("item.legendaryclock.legendary_clock"));
    }

    private int left() { return (width - W) / 2; }
    private int top() { return (height - H) / 2; }

    @Override
    protected void init() {
        HudConfig.load();
        int x = left(), y = top() + H - 28;
        addRenderableWidget(Button.builder(toggleLabel(), b -> {
            HudConfig.shown = !HudConfig.shown;
            HudConfig.save();
            b.setMessage(toggleLabel());
        }).bounds(x + 8, y, 100, 20).build());
        addRenderableWidget(Button.builder(Component.translatable("legendaryclock.gui.move"), b -> minecraft.setScreen(new MoveHudScreen(this)))
                .bounds(x + 112, y, 80, 20).build());
        addRenderableWidget(Button.builder(Component.translatable("gui.done"), b -> onClose()).bounds(x + 196, y, 56, 20).build());
    }

    private static Component toggleLabel() {
        return Component.translatable(HudConfig.shown ? "legendaryclock.gui.hud_on" : "legendaryclock.gui.hud_off");
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        int x = left() + 10, y = top() + 8;
        g.drawCenteredString(font, title, width / 2, y, ClientSetup.LEGENDARY);
        y += 16;
        Network.Status s = ClientHooks.status();
        if (s == null) {
            g.drawWordWrap(font, Component.translatable("legendaryclock.gui.waiting"), x, y, W - 20, ClientSetup.DIM);
            return;
        }
        y = section(g, x, y, "legendaryclock.gui.legendary", s.legendary(), ClientSetup.LEGENDARY);
        y = section(g, x, y + 4, "legendaryclock.gui.boss", s.boss(), ClientSetup.BOSS);
        g.drawString(font, Component.translatable("legendaryclock.gui.now", ClientHooks.times(s.now())), x, y + 4, ClientSetup.TEXT, false);
        if (!s.cycle()) g.drawString(font, Component.translatable("legendaryclock.gui.no_cycle"), x, y + 16, ClientSetup.DIM, false);
    }

    private int section(GuiGraphics g, int x, int y, String key, Network.Timer t, int colour) {
        g.drawString(font, Component.translatable(key), x, y, colour, false);
        y += 12;
        if (t.msLeft() == Network.OFF) {
            g.drawString(font, Component.translatable("legendaryclock.gui.off"), x + 6, y, ClientSetup.DIM, false);
            return y + 12;
        }
        long ms = ClientHooks.msLeft(t);
        g.drawString(font, Component.translatable("legendaryclock.gui.next", ClientHooks.countdown(t)), x + 6, y, ClientSetup.TEXT, false);
        y += 11;
        g.drawString(font, Component.translatable(ms <= 0 ? "legendaryclock.gui.time_now" : "legendaryclock.gui.time_then",
                ClientHooks.times(t.times())), x + 6, y, ClientSetup.TEXT, false);
        y += 11;
        g.drawString(font, Component.translatable("legendaryclock.gui.chance", String.format(Locale.ROOT, "%.0f%%", t.chance() * 100)), x + 6, y, ClientSetup.DIM, false);
        return y + 12;
    }

    @Override
    public void renderBackground(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.renderBackground(g, mouseX, mouseY, partialTick);
        int x = left(), y = top();
        g.fill(x - 1, y - 1, x + W + 1, y + H + 1, BORDER);
        g.fill(x, y, x + W, y + H, BG);
    }

    @Override
    public boolean keyPressed(int key, int scan, int mods) {
        // The inventory key closes the clock straight back to the game, like the Biome Compass.
        if (minecraft != null && minecraft.options.keyInventory.matches(key, scan)) {
            onClose();
            return true;
        }
        return super.keyPressed(key, scan, mods);
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
