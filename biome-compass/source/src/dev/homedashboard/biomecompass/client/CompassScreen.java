package dev.homedashboard.biomecompass.client;

import dev.homedashboard.biomecompass.BiomeCompass;
import dev.homedashboard.biomecompass.CompassFinder;
import dev.homedashboard.biomecompass.CompassItem;
import dev.homedashboard.biomecompass.CompassTarget;
import dev.homedashboard.biomecompass.Network;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Biome list (only unlocked biomes of this dimension) with search box, plus a Group page for invites. */
public class CompassScreen extends Screen {
    private static final int W = 250, H = 248, ROW = 12, ROWS = 10;
    private static final int BG = 0xE0101418, BORDER = 0xFF4E7A3A, SELECTED = 0x804E7A3A, HOVER = 0x40FFFFFF;

    private final Network.Open data;
    private final List<ResourceLocation> unlocked = new ArrayList<>();
    private final int possibleCount;
    private List<ResourceLocation> shown = new ArrayList<>();
    private int scroll;
    private boolean groupPage;
    private EditBox filter;
    private Button nextButton, clearButton;

    public CompassScreen(Network.Open data) {
        super(Component.translatable("item.biomecompass.biome_compass"));
        this.data = data;
        Set<String> possible = new HashSet<>(data.possible());
        possibleCount = possible.size();
        for (String s : data.unlocked()) if (possible.contains(s)) unlocked.add(ResourceLocation.parse(s));
        unlocked.sort((a, b) -> name(a).compareToIgnoreCase(name(b)));
    }

    private static String name(ResourceLocation id) {
        return BiomeCompass.biomeName(id).getString();
    }

    private int left() { return (width - W) / 2; }
    private int top() { return (height - H) / 2; }

    @Override
    protected void init() {
        clearWidgets();
        int x = left(), y = top();
        if (!groupPage) {
            String old = filter == null ? "" : filter.getValue();
            filter = addRenderableWidget(new EditBox(font, x + 8, y + 30, W - 16, 14, Component.translatable("biomecompass.gui.filter")));
            filter.setHint(Component.translatable("biomecompass.gui.filter"));
            filter.setValue(old);
            filter.setResponder(s -> applyFilter());
            applyFilter();
            int bottomW = data.canTeleport() ? 116 : W - 16;
            if (data.canTeleport())
                addRenderableWidget(Button.builder(Component.translatable("biomecompass.gui.teleport"), b -> { Network.sendAction("teleport", ""); onClose(); })
                        .bounds(x + 8, y + H - 26, 116, 20).build());
            addRenderableWidget(Button.builder(Component.translatable("biomecompass.gui.group"), b -> { groupPage = true; init(); })
                    .bounds(x + W - 8 - bottomW, y + H - 26, bottomW, 20).build());
            nextButton = addRenderableWidget(Button.builder(Component.translatable("biomecompass.gui.next"), b -> Network.sendAction("next", ""))
                    .bounds(x + 8, y + H - 48, 116, 20).build());
            nextButton.setTooltip(Tooltip.create(Component.translatable("biomecompass.gui.next_tip")));
            clearButton = addRenderableWidget(Button.builder(Component.translatable("biomecompass.gui.clear"), b -> Network.sendAction("clear", ""))
                    .bounds(x + 126, y + H - 48, 116, 20).build());
            tick();
        } else {
            int row = y + 46 + Math.max(1, data.group().size()) * ROW + 20;
            for (String name : data.online()) {
                if (row > y + H - 50) break;
                addRenderableWidget(Button.builder(Component.translatable("biomecompass.gui.invite", name), b -> {
                    Network.sendAction("invite", name);
                    b.active = false;
                    b.setMessage(Component.translatable("biomecompass.gui.invited", name));
                }).bounds(x + 8, row, W - 16, 18).build());
                row += 20;
            }
            if (!data.group().isEmpty())
                addRenderableWidget(Button.builder(Component.translatable("biomecompass.gui.leave"), b -> { Network.sendAction("leave", ""); onClose(); })
                        .bounds(x + 8, y + H - 26, 116, 20).build());
            addRenderableWidget(Button.builder(Component.translatable("biomecompass.gui.back"), b -> { groupPage = false; init(); })
                    .bounds(x + 126, y + H - 26, 116, 20).build());
        }
    }

    /** What the compass the server would use (hand, Curios slot, then inventory) is tracking. */
    private static CompassTarget current() {
        var player = net.minecraft.client.Minecraft.getInstance().player;
        if (player == null) return CompassTarget.NONE;
        return CompassItem.target(CompassFinder.find(player, s -> true));
    }

    /** The compass's state changes while the screen stays open (search finishing), so keep the buttons in step. */
    @Override
    public void tick() {
        if (groupPage || nextButton == null) return;
        CompassTarget t = current();
        nextButton.active = t.state() == CompassTarget.FOUND;
        clearButton.active = !t.biome().isEmpty();
    }

    /** E (the inventory key) closes straight back to the game, unless you're typing in the filter box. */
    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if ((groupPage || filter == null || !filter.isFocused()) && minecraft.options.keyInventory.matches(keyCode, scanCode)) {
            onClose();
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    private void applyFilter() {
        String f = filter.getValue().toLowerCase(Locale.ROOT).trim();
        shown = new ArrayList<>();
        for (ResourceLocation id : unlocked) if (f.isEmpty() || name(id).toLowerCase(Locale.ROOT).contains(f)) shown.add(id);
        scroll = Mth.clamp(scroll, 0, Math.max(0, shown.size() - ROWS));
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        int x = left(), y = top();
        g.drawCenteredString(font, title, x + W / 2, y + 7, 0xFFE8D27A);
        if (!groupPage) {
            g.drawCenteredString(font, Component.translatable("biomecompass.gui.count", unlocked.size(), possibleCount), x + W / 2, y + 18, 0xFFAAAAAA);
            int listTop = y + 48;
            g.fill(x + 8, listTop, x + W - 8, listTop + ROWS * ROW + 2, 0x60000000);
            if (shown.isEmpty()) {
                Component msg = unlocked.isEmpty() ? Component.translatable("biomecompass.gui.none_yet", BiomeCompass.UNLOCK_SECONDS)
                        : Component.translatable("biomecompass.gui.no_match");
                g.drawWordWrap(font, msg, x + 14, listTop + 6, W - 28, 0xFFAAAAAA);
            }
            CompassTarget t = current();
            ResourceLocation tracked = t.biome().isEmpty() ? null : ResourceLocation.tryParse(t.biome());
            for (int i = 0; i < ROWS && i + scroll < shown.size(); i++) {
                ResourceLocation id = shown.get(i + scroll);
                int ry = listTop + 1 + i * ROW;
                if (id.equals(tracked)) g.fill(x + 9, ry, x + W - 9, ry + ROW, SELECTED);
                else if (mouseX >= x + 9 && mouseX < x + W - 9 && mouseY >= ry && mouseY < ry + ROW) g.fill(x + 9, ry, x + W - 9, ry + ROW, HOVER);
                g.drawString(font, BiomeCompass.biomeName(id), x + 13, ry + 2, 0xFFFFFFFF);
            }
            if (shown.size() > ROWS) {
                int barH = Math.max(10, ROWS * ROW * ROWS / shown.size());
                int barY = listTop + 1 + (ROWS * ROW - barH) * scroll / Math.max(1, shown.size() - ROWS);
                g.fill(x + W - 12, barY, x + W - 9, barY + barH, 0xFF8FB86F);
            }
            int locked = possibleCount - unlocked.size();
            if (locked > 0)
                g.drawCenteredString(font, Component.translatable("biomecompass.gui.locked", locked, BiomeCompass.UNLOCK_SECONDS), x + W / 2, listTop + ROWS * ROW + 6, 0xFF8FB86F);
            if (tracked != null) g.drawCenteredString(font, status(t, tracked), x + W / 2, y + H - 62, 0xFFE8D27A);
        } else {
            g.drawCenteredString(font, Component.translatable("biomecompass.gui.group_title"), x + W / 2, y + 18, 0xFFAAAAAA);
            int row = y + 34;
            if (data.group().isEmpty()) g.drawString(font, Component.translatable("biomecompass.gui.no_group"), x + 12, row, 0xFFAAAAAA);
            for (String m : data.group()) { g.drawString(font, "- " + m, x + 12, row, 0xFFFFFFFF); row += ROW; }
            row = y + 46 + Math.max(1, data.group().size()) * ROW + 6;
            g.drawString(font, Component.translatable(data.online().isEmpty() ? "biomecompass.gui.nobody_online" : "biomecompass.gui.invite_title"), x + 12, row, 0xFFE8D27A);
            g.drawWordWrap(font, Component.translatable("biomecompass.gui.group_help"), x + 12, y + H - 50, W - 24, 0xFF888888);
        }
    }

    private Component status(CompassTarget t, ResourceLocation tracked) {
        Component name = BiomeCompass.biomeName(tracked);
        return switch (t.state()) {
            case CompassTarget.SEARCHING -> Component.translatable("biomecompass.hud.searching", name);
            case CompassTarget.NOT_FOUND -> Component.translatable("biomecompass.hud.not_found", name);
            case CompassTarget.FOUND -> {
                var pos = t.pos().orElse(null);
                var player = minecraft.player;
                if (pos == null || player == null || !pos.dimension().equals(player.level().dimension()))
                    yield Component.translatable("biomecompass.gui.tracking", name);
                double dx = pos.pos().getX() + 0.5 - player.getX(), dz = pos.pos().getZ() + 0.5 - player.getZ();
                yield Component.translatable("biomecompass.gui.tracking_dist", name, (int) Math.sqrt(dx * dx + dz * dz));
            }
            default -> Component.empty();
        };
    }

    @Override
    public void renderBackground(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.renderBackground(g, mouseX, mouseY, partialTick);
        int x = left(), y = top();
        g.fill(x - 1, y - 1, x + W + 1, y + H + 1, BORDER);
        g.fill(x, y, x + W, y + H, BG);
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (!groupPage) {
            int x = left(), listTop = top() + 48;
            if (mx >= x + 9 && mx < x + W - 9 && my >= listTop + 1 && my < listTop + 1 + ROWS * ROW) {
                int i = (int) ((my - listTop - 1) / ROW) + scroll;
                if (i < shown.size()) {
                    // one click starts the search; the screen stays open and shows the result below the list
                    Network.sendAction("search", shown.get(i).toString());
                    minecraft.getSoundManager().play(net.minecraft.client.resources.sounds.SimpleSoundInstance.forUI(net.minecraft.sounds.SoundEvents.UI_BUTTON_CLICK, 1.0f));
                    return true;
                }
            }
        }
        return super.mouseClicked(mx, my, button);
    }

    @Override
    public boolean mouseScrolled(double mx, double my, double dx, double dy) {
        if (!groupPage) scroll = Mth.clamp(scroll - (int) Math.signum(dy), 0, Math.max(0, shown.size() - ROWS));
        return true;
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
