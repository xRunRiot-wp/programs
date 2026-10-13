package dev.homedashboard.biomecompass.client;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.util.RandomSource;
import net.neoforged.neoforge.client.event.ClientTickEvent;

/**
 * "Absorbing nature essence" when a biome unlocks, drawn on the top-left compass icon only (Adam: nothing around the
 * player): motes in the biome's leaf colour spiral into the icon, it glows, and a small sparkle flashes. Small on purpose.
 */
public final class AbsorbEffect {
    private static final int DURATION = 28, TOTAL = DURATION + 14, MOTES = 14;
    private static final float[] angle = new float[MOTES], delay = new float[MOTES], radius = new float[MOTES];
    /** Ticks since it started (-1 = off) and the biome colour. */
    private static int age = -1, color;

    private AbsorbEffect() {}

    public static void start(int entityId, String biome) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null || mc.player == null || entityId != mc.player.getId()) return;
        int rgb = mc.level.registryAccess().registryOrThrow(Registries.BIOME).getOptional(ResourceLocation.tryParse(biome))
                .map(b -> b.getFoliageColor()).orElse(0x59AE30);
        RandomSource r = mc.level.random;
        age = 0;
        color = brighten(rgb, 0.35f);
        for (int i = 0; i < MOTES; i++) {
            angle[i] = (float) (i * Math.PI * 2 / MOTES + r.nextFloat() * 0.4);
            delay[i] = r.nextInt(8);
            radius[i] = 22 + r.nextFloat() * 10;
        }
        mc.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.AMETHYST_BLOCK_RESONATE, 1.6f, 0.6f));
    }

    public static boolean active() {
        return age >= 0;
    }

    /** Draws around the icon centred on (cx, cy). */
    public static void render(GuiGraphics g, int cx, int cy, float partial) {
        float now = age + partial;
        for (int i = 0; i < MOTES; i++) {
            float t = (now - delay[i]) / DURATION;
            if (t < 0 || t > 1) continue;
            float pull = t * t, r = radius[i] * (1 - pull); // starts slow, then gets pulled in
            double a = angle[i] + t * Math.PI * 0.9;         // a gentle spiral on the way in
            int x = cx + Math.round((float) Math.cos(a) * r), y = cy + Math.round((float) Math.sin(a) * r);
            int alpha = (int) (255 * Math.min(1, t * 4));
            g.fill(x - 1, y - 1, x + 2, y + 2, (alpha / 2 << 24) | color);              // soft 3x3 glow
            g.fill(x, y, x + 1, y + 1, (alpha << 24) | brighten(color, 0.6f));        // bright core
        }
        float glow = (now - DURATION + 4) / 14f; // the icon swells with colour as the last motes land, then fades
        if (glow > 0 && glow < 1) {
            int alpha = (int) (120 * Math.sin(glow * Math.PI));
            int s = 15 + Math.round(glow * 4);
            g.fill(cx - s, cy - s, cx + s, cy + s, (alpha << 24) | color);
            int len = Math.round(6 + glow * 10), sa = (int) (220 * (1 - glow)); // little four-point sparkle
            int c = (sa << 24) | brighten(color, 0.7f);
            g.fill(cx - len, cy, cx + len + 1, cy + 1, c);
            g.fill(cx, cy - len, cx + 1, cy + len + 1, c);
        }
    }

    private static int brighten(int rgb, float k) {
        int r = (int) (((rgb >> 16) & 255) + (255 - ((rgb >> 16) & 255)) * k);
        int gr = (int) (((rgb >> 8) & 255) + (255 - ((rgb >> 8) & 255)) * k);
        int b = (int) ((rgb & 255) + (255 - (rgb & 255)) * k);
        return (r << 16) | (gr << 8) | b;
    }

    public static void tick(ClientTickEvent.Post event) {
        if (age >= 0 && !Minecraft.getInstance().isPaused() && ++age > TOTAL) age = -1;
    }
}
