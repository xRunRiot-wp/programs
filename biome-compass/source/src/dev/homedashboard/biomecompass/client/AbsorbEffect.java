package dev.homedashboard.biomecompass.client;

import dev.homedashboard.biomecompass.BiomeCompass;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.util.Mth;
import net.neoforged.neoforge.client.event.ClientTickEvent;

/**
 * "Absorbing nature essence", drawn on the top-left compass icon only (Adam: nothing around the player).
 * While a new biome unlocks (the 10 seconds), motes in its leaf colour keep spiralling into the icon - more of them as
 * it fills - and a bar under the icon fills up. On unlock the icon glows and a small sparkle flashes.
 */
public final class AbsorbEffect {
    private static final int MOTES = 14, LOOP = 30, FINISH = 18;
    private static final float[] angle = new float[MOTES], radius = new float[MOTES];

    static {
        for (int i = 0; i < MOTES; i++) {
            angle[i] = (float) (i * 2.39996); // golden angle, so the motes spread evenly around the icon
            radius[i] = 22 + (i * 7) % 10;
        }
    }

    private static int color = 0x8FD07A, clock;
    /** Unlocking: seconds so far (0 = not unlocking) and ticks since the server last said so. */
    private static int chargeSecs, sinceUpdate;
    private static String chargeBiome = "";
    /** Ticks since the unlock finished (-1 = not showing the finish). */
    private static int finishAge = -1;

    private AbsorbEffect() {}

    private static int colorOf(String biome) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) return 0x8FD07A;
        int rgb = mc.level.registryAccess().registryOrThrow(Registries.BIOME).getOptional(ResourceLocation.tryParse(biome))
                .map(b -> b.getFoliageColor()).orElse(0x59AE30);
        return brighten(rgb, 0.35f);
    }

    public static void progress(String biome, int secs) {
        if (!biome.equals(chargeBiome)) color = colorOf(biome);
        chargeBiome = biome;
        chargeSecs = secs;
        sinceUpdate = 0;
    }

    /** The biome unlocked: finish with the glow and sparkle. */
    public static void start(int entityId, String biome) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || entityId != mc.player.getId()) return;
        color = colorOf(biome);
        chargeSecs = 0;
        chargeBiome = "";
        finishAge = 0;
        mc.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.AMETHYST_BLOCK_RESONATE, 1.6f, 0.6f));
    }

    public static boolean active() {
        return chargeSecs > 0 || finishAge >= 0;
    }

    /** Draws around the icon centred on (cx, cy). */
    public static void render(GuiGraphics g, int cx, int cy, float partial) {
        if (chargeSecs > 0) {
            float fill = Mth.clamp((chargeSecs + (sinceUpdate + partial) / 20f) / BiomeCompass.UNLOCK_SECONDS, 0, 1);
            int shown = Math.max(3, Math.round(fill * MOTES)); // more essence flows in as it fills up
            float now = clock + partial;
            for (int i = 0; i < shown; i++) {
                float t = ((now + i * (float) LOOP / MOTES) % LOOP) / LOOP;
                float pull = t * t, r = radius[i] * (1 - pull);          // starts slow, then gets pulled in
                double a = angle[i] + t * Math.PI * 0.9;                  // a gentle spiral on the way in
                int x = cx + Math.round((float) Math.cos(a) * r), y = cy + Math.round((float) Math.sin(a) * r);
                int alpha = (int) (255 * Math.min(1, t * 4) * (1 - Math.max(0, t - 0.85f) / 0.15f));
                g.fill(x - 1, y - 1, x + 2, y + 2, (alpha / 2 << 24) | color);      // soft 3x3 glow
                g.fill(x, y, x + 1, y + 1, (alpha << 24) | brighten(color, 0.6f));  // bright core
            }
            int glowA = (int) (60 * fill);                                    // the icon slowly takes on the colour
            g.fill(cx - 15, cy - 15, cx + 15, cy + 15, (glowA << 24) | color);
            g.fill(cx - 16, cy + 18, cx + 16, cy + 20, 0x80000000);           // bar under the icon
            g.fill(cx - 16, cy + 18, cx - 16 + Math.round(32 * fill), cy + 20, 0xFF000000 | color);
        }
        if (finishAge >= 0) {
            float f = (finishAge + partial) / FINISH; // glow swells and fades, with a four-point sparkle
            if (f < 1) {
                int alpha = (int) (130 * Math.sin(f * Math.PI));
                int s = 15 + Math.round(f * 4);
                g.fill(cx - s, cy - s, cx + s, cy + s, (alpha << 24) | color);
                int len = Math.round(6 + f * 10), sa = (int) (230 * (1 - f));
                int c = (sa << 24) | brighten(color, 0.7f);
                g.fill(cx - len, cy, cx + len + 1, cy + 1, c);
                g.fill(cx, cy - len, cx + 1, cy + len + 1, c);
            }
        }
    }

    private static int brighten(int rgb, float k) {
        int r = (int) (((rgb >> 16) & 255) + (255 - ((rgb >> 16) & 255)) * k);
        int gr = (int) (((rgb >> 8) & 255) + (255 - ((rgb >> 8) & 255)) * k);
        int b = (int) ((rgb & 255) + (255 - (rgb & 255)) * k);
        return (r << 16) | (gr << 8) | b;
    }

    public static void tick(ClientTickEvent.Post event) {
        if (Minecraft.getInstance().isPaused()) return;
        clock++;
        // the server updates once a second; no update for 1.5 s means you stepped out (or it unlocked)
        if (chargeSecs > 0 && ++sinceUpdate > 30) { chargeSecs = 0; chargeBiome = ""; }
        if (finishAge >= 0 && ++finishAge > FINISH) finishAge = -1;
    }
}
