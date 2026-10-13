package dev.homedashboard.biomecompass.client;

import net.minecraft.client.Minecraft;
import net.minecraft.core.particles.DustParticleOptions;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import org.joml.Vector3f;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * "Absorbing nature essence" when a biome unlocks: a few motes in the biome's leaf colour start around the player,
 * curve inward and get pulled into them, then a small sparkle. Small on purpose.
 */
public final class AbsorbEffect {
    private static final int MOTES = 14, DURATION = 28;
    private static final List<Mote> motes = new ArrayList<>();

    private record Mote(int entityId, Vec3 start, float swirl, int delay, DustParticleOptions dust, int[] age) {}

    private AbsorbEffect() {}

    public static void start(int entityId, String biome) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null || !(mc.level.getEntity(entityId) instanceof Entity e)) return;
        int rgb = mc.level.registryAccess().registryOrThrow(Registries.BIOME).getOptional(ResourceLocation.tryParse(biome))
                .map(b -> b.getFoliageColor()).orElse(0x59AE30);
        RandomSource r = mc.level.random;
        for (int i = 0; i < MOTES; i++) {
            // brighten the leaf colour a little so it reads as glowing, and vary each mote slightly
            float k = 0.25f + r.nextFloat() * 0.2f;
            Vector3f c = new Vector3f(mix((rgb >> 16) & 255, k), mix((rgb >> 8) & 255, k), mix(rgb & 255, k));
            double ang = r.nextDouble() * Math.PI * 2, dist = 2.2 + r.nextDouble() * 1.3;
            Vec3 start = new Vec3(Math.cos(ang) * dist, 0.2 + r.nextDouble() * 1.8, Math.sin(ang) * dist);
            motes.add(new Mote(entityId, start, (r.nextBoolean() ? 1 : -1) * (0.6f + r.nextFloat() * 0.6f), r.nextInt(10),
                    new DustParticleOptions(c, 0.7f + r.nextFloat() * 0.4f), new int[1]));
        }
        mc.level.playLocalSound(e.getX(), e.getY(), e.getZ(), SoundEvents.AMETHYST_BLOCK_RESONATE, SoundSource.PLAYERS, 0.6f, 1.6f, false);
    }

    private static float mix(int channel, float toWhite) {
        return (channel + (255 - channel) * toWhite) / 255f;
    }

    public static void tick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (motes.isEmpty()) return;
        if (mc.level == null || mc.isPaused()) { if (mc.level == null) motes.clear(); return; }
        Iterator<Mote> it = motes.iterator();
        while (it.hasNext()) {
            Mote m = it.next();
            Entity e = mc.level.getEntity(m.entityId());
            int age = ++m.age()[0] - m.delay();
            if (e == null) { it.remove(); continue; }
            if (age < 0) continue;
            Vec3 centre = e.position().add(0, e.getBbHeight() * 0.55, 0);
            if (age >= DURATION) {
                mc.level.addParticle(ParticleTypes.HAPPY_VILLAGER, centre.x + (mc.level.random.nextDouble() - 0.5) * 0.6,
                        centre.y + (mc.level.random.nextDouble() - 0.5) * 0.6, centre.z + (mc.level.random.nextDouble() - 0.5) * 0.6, 0, 0, 0);
                it.remove();
                continue;
            }
            double t = (double) age / DURATION, pull = t * t; // starts slow, then gets pulled in
            double turn = m.swirl() * t * Math.PI * 0.8;     // a gentle spiral on the way in
            double cos = Math.cos(turn), sin = Math.sin(turn);
            Vec3 s = m.start();
            Vec3 off = new Vec3(s.x * cos - s.z * sin, s.y - 0.9, s.x * sin + s.z * cos).scale(1 - pull);
            Vec3 p = centre.add(off);
            mc.level.addParticle(m.dust(), p.x, p.y, p.z, 0, 0, 0);
        }
    }
}
