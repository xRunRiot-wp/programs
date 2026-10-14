package dev.homedashboard.legendaryclock.client;

import dev.homedashboard.legendaryclock.Network;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;

import java.util.List;

/** Drag the on-screen timer to where you want it; Done saves, Reset puts it back in the top-left. */
public class MoveHudScreen extends Screen {
    private static final Network.Status SAMPLE = new Network.Status(
            new Network.Timer(754_000, 0.3f, List.of("NIGHT", "MIDNIGHT")), new Network.Timer(190_000, 0.3f, List.of("DAY", "AFTERNOON")),
            List.of("DAY"), true);
    private final Screen parent;
    private int x, y, grabX, grabY;
    private boolean dragging;

    public MoveHudScreen(Screen parent) {
        super(Component.translatable("legendaryclock.gui.move"));
        this.parent = parent;
        x = HudConfig.x;
        y = HudConfig.y;
    }

    private Network.Status shown() {
        Network.Status s = ClientHooks.status();
        return s != null ? s : SAMPLE;
    }

    @Override
    protected void init() {
        addRenderableWidget(Button.builder(Component.translatable("gui.done"), b -> {
            HudConfig.x = x;
            HudConfig.y = y;
            HudConfig.save();
            minecraft.setScreen(parent);
        }).bounds(width / 2 - 104, height - 28, 100, 20).build());
        addRenderableWidget(Button.builder(Component.translatable("legendaryclock.gui.reset"), b -> {
            x = 4;
            y = 44;
        }).bounds(width / 2 + 4, height - 28, 100, 20).build());
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        int[] size = ClientSetup.hudSize(font, shown());
        x = Mth.clamp(x, 0, Math.max(0, width - size[0]));
        y = Mth.clamp(y, 0, Math.max(0, height - size[1]));
        ClientSetup.drawHud(g, font, shown(), x, y);
        boolean over = mouseX >= x && mouseX < x + size[0] && mouseY >= y && mouseY < y + size[1];
        if (over || dragging) g.renderOutline(x - 1, y - 1, size[0] + 2, size[1] + 2, 0xFFFFFFFF);
        g.drawCenteredString(font, Component.translatable("legendaryclock.gui.move_help"), width / 2, height - 44, 0xFFFFFFFF);
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (super.mouseClicked(mx, my, button)) return true;
        int[] size = ClientSetup.hudSize(font, shown());
        if (button == 0 && mx >= x && mx < x + size[0] && my >= y && my < y + size[1]) {
            dragging = true;
            grabX = (int) mx - x;
            grabY = (int) my - y;
            return true;
        }
        return false;
    }

    @Override
    public boolean mouseDragged(double mx, double my, int button, double dx, double dy) {
        if (dragging) {
            x = (int) mx - grabX;
            y = (int) my - grabY;
            return true;
        }
        return super.mouseDragged(mx, my, button, dx, dy);
    }

    @Override
    public boolean mouseReleased(double mx, double my, int button) {
        dragging = false;
        return super.mouseReleased(mx, my, button);
    }

    @Override
    public void renderBackground(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        // No blur or dark overlay, so you can see where the timer sits over the game.
    }

    @Override
    public void onClose() {
        minecraft.setScreen(parent);
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
