package dev.homedashboard.gatchamachine.client;

import dev.homedashboard.gatchamachine.BossSpin;
import dev.homedashboard.gatchamachine.Network;
import net.minecraft.Util;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.util.Mth;
import net.neoforged.neoforge.network.PacketDistributor;

import java.util.List;

/** CS:GO-style case opening: tier tabs, a reel of boss sprites that slows down onto the winner. */
public class GatchaScreen extends Screen {
    private static final int W = 320, H = 214, CELL = 56, BOX = 52;
    private static final long SPIN_MS = 6500;
    private static final int[] TIER_COLORS = {0xFF006EFF, 0xFF9F00D9, 0xFFFFA200, 0xFF00FFFF};
    private static final String[] TIER_NAMES = {"Rare", "Epic", "Legendary", "Ultimate"};

    private final int unseen, total;
    private int tier = 0;
    private boolean neverEncountered;
    private Button openButton, neverButton;
    private final Button[] tabs = new Button[4];

    private List<Network.ReelEntry> reel;
    private int reelTier;
    private long spinStart = -1;
    private float finalOffset;
    private int lastTickCell = -1;
    private boolean done, waiting;
    private long waitStart;

    public GatchaScreen(int unseen, int total) {
        super(Component.translatable("item.gatchamachine.gatcha_machine"));
        this.unseen = unseen;
        this.total = total;
    }

    private int left() { return (width - W) / 2; }
    private int top() { return (height - H) / 2; }

    @Override
    protected void init() {
        int x = left(), y = top();
        for (int i = 0; i < 4; i++) {
            final int t = i;
            tabs[i] = addRenderableWidget(Button.builder(Component.literal(TIER_NAMES[i]), b -> { tier = t; refresh(); })
                    .bounds(x + 8 + i * 76, y + 20, 74, 18).build());
        }
        neverButton = addRenderableWidget(Button.builder(Component.empty(), b -> { neverEncountered = !neverEncountered; refresh(); })
                .bounds(x + 8, y + 150, 304, 18).build());
        openButton = addRenderableWidget(Button.builder(Component.empty(), b -> open())
                .bounds(x + 90, y + 186, 140, 20).build());
        refresh();
    }

    private boolean spinning() {
        return waiting || (spinStart >= 0 && !done);
    }

    private int cost() {
        if (tier == BossSpin.ULTIMATE && neverEncountered) return BossSpin.neverEncounteredCost(unseen, total);
        return BossSpin.COSTS[tier];
    }

    private void refresh() {
        for (int i = 0; i < 4; i++) tabs[i].active = i != tier && !spinning();
        neverButton.visible = tier == BossSpin.ULTIMATE;
        int extraPct = total <= 0 ? 0 : (int) Math.round(100.0 * (total - unseen) / total);
        neverButton.setMessage(Component.literal((neverEncountered ? "[X] " : "[  ] ") + "Never encountered only  (+" + extraPct + "%, " + unseen + " left)"));
        neverButton.active = unseen > 0 && !spinning();
        if (unseen == 0) neverEncountered = false;
        openButton.setMessage(Component.literal("Open  -  " + cost() + " pts"));
        openButton.active = ClientHooks.unlocked && ClientHooks.points >= cost() && !spinning();
    }

    private void open() {
        waiting = true;
        waitStart = Util.getMillis();
        done = false;
        refresh();
        PacketDistributor.sendToServer(new Network.SpinRequest(tier, tier == BossSpin.ULTIMATE && neverEncountered));
    }

    /** Called when the server confirms the spin with the reel; the server spawns the boss when it ends. */
    public void startSpin(int tier, List<Network.ReelEntry> reel) {
        this.reel = reel;
        this.reelTier = tier;
        this.waiting = false;
        this.done = false;
        this.spinStart = Util.getMillis();
        this.lastTickCell = -1;
        int viewW = W - 20;
        float jitter = (float) (Math.random() * (BOX - 12) - (BOX - 12) / 2.0);
        this.finalOffset = BossSpin.WINNER_INDEX * CELL + BOX / 2f - viewW / 2f + jitter;
        refresh();
    }

    @Override
    public void tick() {
        // the server answers with a chat message instead of a reel if it refuses the spin
        if (waiting && Util.getMillis() - waitStart > 3000) waiting = false;
        if (!spinning()) refresh();
    }

    private float offset() {
        if (spinStart < 0) return 0;
        float t = Mth.clamp((Util.getMillis() - spinStart) / (float) SPIN_MS, 0f, 1f);
        float eased = 1 - (float) Math.pow(1 - t, 4); // ease-out quart, like a case opening
        if (t >= 1f && !done) {
            done = true;
            Minecraft.getInstance().getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.PLAYER_LEVELUP, 1.0f, 0.7f));
            refresh();
        }
        return finalOffset * eased;
    }

    @Override
    public void renderBackground(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.renderBackground(g, mouseX, mouseY, partialTick);
        int x = left(), y = top();
        g.fill(x - 2, y - 2, x + W + 2, y + H + 2, 0xFF000000 | (TIER_COLORS[tier] & 0xFFFFFF));
        g.fill(x, y, x + W, y + H, 0xF0181820);
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        int x = left(), y = top();
        g.drawCenteredString(font, title, x + W / 2, y + 6, 0xFFFFD84A);

        int vx = x + 10, vy = y + 46, vw = W - 20, vh = 70;
        g.fill(vx, vy, vx + vw, vy + vh, 0xFF0B0B10);
        g.enableScissor(vx, vy, vx + vw, vy + vh);
        float off = offset();
        int color = TIER_COLORS[reel == null ? tier : reelTier];
        int count = reel == null ? 8 : reel.size();
        for (int i = 0; i < count; i++) {
            int bx = vx + Math.round(i * CELL - off);
            if (bx + BOX < vx || bx > vx + vw) continue;
            g.fill(bx, vy + 6, bx + BOX, vy + vh - 6, 0xFF24242E);
            g.fill(bx, vy + vh - 10, bx + BOX, vy + vh - 6, color);
            if (reel == null) {
                g.drawCenteredString(font, "?", bx + BOX / 2, vy + 28, 0xFF888888);
            } else {
                ResourceLocation sprite = ResourceLocation.tryParse(reel.get(i).sprite());
                if (sprite != null) g.blit(sprite, bx + 4, vy + 10, 44, 44, 0f, 0f, 32, 32, 32, 32);
            }
        }
        g.disableScissor();
        // centre marker
        g.fill(vx + vw / 2 - 1, vy - 3, vx + vw / 2 + 1, vy + vh + 3, 0xFFFFD84A);

        if (reel != null && spinStart >= 0 && !done) {
            int cell = (int) Math.floor((off + vw / 2f) / CELL);
            if (cell != lastTickCell) {
                lastTickCell = cell;
                Minecraft.getInstance().getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.NOTE_BLOCK_HAT.value(), 1.8f, 0.35f));
            }
        }

        String result;
        int resultColor = 0xFFFFFFFF;
        if (!ClientHooks.unlocked) result = "Get the Gatcha Machine achievement to start earning points";
        else if (waiting) result = "Spinning...";
        else if (reel != null && done) {
            result = "You got: " + reel.get(BossSpin.WINNER_INDEX).name() + " - it's appearing in front of you!";
            resultColor = color;
        } else if (reel != null) result = "...";
        else result = TIER_NAMES[tier] + " boss";
        g.drawCenteredString(font, result, x + W / 2, y + 124, resultColor);
        g.drawCenteredString(font, "Points: " + ClientHooks.points, x + W / 2, y + 136, 0xFFFFD84A);
        g.drawCenteredString(font, tier == BossSpin.ULTIMATE ? "Always Mega or Primal" : "", x + W / 2, y + 172, 0xFFAAAAAA);
    }

    @Override
    public boolean isPauseScreen() {
        return false; // singleplayer keeps ticking so the boss spawns on time
    }
}
