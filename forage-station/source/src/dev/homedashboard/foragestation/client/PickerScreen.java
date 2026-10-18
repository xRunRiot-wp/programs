package dev.homedashboard.foragestation.client;

import dev.homedashboard.foragestation.Network;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.neoforged.neoforge.network.PacketDistributor;

import java.util.List;

/** Pick a Pokemon from the party (page 0) or a PC box (pages 1..n) to put in the station. */
public class PickerScreen extends Screen {
    private static final int COLS = 6, ROWS = 5, CELL = 36;
    private Network.Picker data;

    public PickerScreen(Network.Picker p) {
        super(Component.translatable("foragestation.picker"));
        data = p;
    }

    public BlockPos pos() { return data.pos(); }

    public void show(Network.Picker p) { data = p; rebuildWidgets(); }

    private int left() { return (width - COLS * CELL) / 2; }
    private int top() { return (height - ROWS * CELL) / 2 + 10; }

    @Override
    protected void init() {
        int y = top() - 26;
        addRenderableWidget(Button.builder(Component.literal("<"), b -> request(data.page() - 1)).bounds(left(), y, 20, 20).build());
        addRenderableWidget(Button.builder(Component.literal(">"), b -> request(data.page() + 1)).bounds(left() + COLS * CELL - 20, y, 20, 20).build());
        if (data.page() != 0)
            addRenderableWidget(Button.builder(Component.translatable("foragestation.party"), b -> request(0)).bounds(left() + COLS * CELL + 6, y, 50, 20).build());
    }

    private void request(int page) {
        PacketDistributor.sendToServer(new Network.PageRequest(data.pos(), page));
    }

    private Network.Entry at(double mx, double my) {
        int col = (int) Math.floor((mx - left()) / CELL), row = (int) Math.floor((my - top()) / CELL);
        if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
        int slot = row * COLS + col;
        for (Network.Entry e : data.entries()) if (e.slot() == slot) return e;
        return null;
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (super.mouseClicked(mx, my, button)) return true;
        Network.Entry e = at(mx, my);
        if (e == null) return false;
        PacketDistributor.sendToServer(new Network.Pick(data.pos(), data.page(), e.slot(), e.id()));
        onClose();
        return true;
    }

    @Override
    public void render(GuiGraphics g, int mx, int my, float partial) {
        super.render(g, mx, my, partial);
        Component label = data.page() == 0 ? Component.translatable("foragestation.party")
                : Component.translatable("foragestation.box", data.page(), data.pages() - 1);
        g.drawCenteredString(font, label, width / 2, top() - 20, 0xFFFFFF);
        g.drawCenteredString(font, Component.translatable("foragestation.picker_hint"), width / 2, top() + ROWS * CELL + 8, 0xB0B0B0);
        int rows = data.page() == 0 ? 1 : ROWS;
        for (int r = 0; r < rows; r++) for (int c = 0; c < COLS; c++) {
            int x = left() + c * CELL, y = top() + r * CELL;
            g.fill(x + 1, y + 1, x + CELL - 1, y + CELL - 1, 0x80303030);
        }
        for (Network.Entry e : data.entries()) {
            int x = left() + (e.slot() % COLS) * CELL, y = top() + (e.slot() / COLS) * CELL;
            g.pose().pushPose();
            g.pose().translate(x + 2, y + 2, 0);
            g.pose().scale(2f, 2f, 1f);
            g.renderItem(e.photo(), 0, 0);
            g.pose().popPose();
        }
        Network.Entry hover = at(mx, my);
        if (hover != null) g.renderComponentTooltip(font, List.of(Component.literal(hover.name()),
                Component.translatable("foragestation.tip", hover.level(), hover.speed(), String.format("%.1f",
                        dev.homedashboard.foragestation.ForageLoot.cooldownTicks(hover.speed()) / 20.0))), mx, my);
    }

    @Override public boolean isPauseScreen() { return false; }
}
