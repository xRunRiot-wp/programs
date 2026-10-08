package dev.homedashboard.pixeldexoverlay.client;

import java.util.List;

import org.lwjgl.glfw.GLFW;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;

import dev.homedashboard.pixeldexoverlay.PixelDexOverlay;
import dev.homedashboard.pixeldexoverlay.StructureQuery;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.language.I18n;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.LevelRenderer;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.debug.DebugRenderer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.client.event.RenderLevelStageEvent;
import net.neoforged.neoforge.network.PacketDistributor;

/** The key, the periodic "what's around me?" question, and drawing the outlines + names. */
public final class OverlayClient {
    static final KeyMapping TOGGLE = new KeyMapping("key.pixeldexoverlay.toggle", InputConstants.Type.KEYSYM,
            GLFW.GLFW_KEY_PERIOD, "key.categories.pixeldexoverlay");
    static final int RADIUS_CHUNKS = 8;          // ask for structures within 8 chunks (128 blocks)
    static final double LABEL_RANGE = 96;

    static boolean on;
    static volatile List<StructureQuery.Found> found = List.of();
    static int ticks;
    static int unanswered;

    /** Server's answer (main thread). */
    public static void receive(List<StructureQuery.Found> list) {
        found = list;
        unanswered = 0;
    }

    @EventBusSubscriber(modid = PixelDexOverlay.MODID, bus = EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
    public static final class ModEvents {
        @SubscribeEvent
        public static void keys(RegisterKeyMappingsEvent e) {
            e.register(TOGGLE);
        }
    }

    @EventBusSubscriber(modid = PixelDexOverlay.MODID, value = Dist.CLIENT)
    public static final class GameEvents {
        @SubscribeEvent
        public static void tick(ClientTickEvent.Post e) {
            Minecraft mc = Minecraft.getInstance();
            while (TOGGLE.consumeClick()) {
                on = !on;
                found = List.of();
                ticks = 0;
                unanswered = 0;
                if (mc.player != null)
                    mc.player.displayClientMessage(Component.translatable(on ? "pixeldexoverlay.on" : "pixeldexoverlay.off"), true);
            }
            if (!on || mc.player == null || mc.getConnection() == null) return;
            if (ticks++ % 20 != 0) return;                                   // once a second
            if (!mc.getConnection().hasChannel(StructureQuery.Request.TYPE)) {
                mc.player.displayClientMessage(Component.translatable("pixeldexoverlay.noserver"), true);
                on = false;
                return;
            }
            unanswered++;
            PacketDistributor.sendToServer(new StructureQuery.Request(RADIUS_CHUNKS));
        }

        @SubscribeEvent
        public static void leave(ClientPlayerNetworkEvent.LoggingOut e) {
            on = false;
            found = List.of();
        }

        @SubscribeEvent
        public static void render(RenderLevelStageEvent e) {
            if (!on || e.getStage() != RenderLevelStageEvent.Stage.AFTER_TRANSLUCENT_BLOCKS) return;
            List<StructureQuery.Found> list = found;
            if (list.isEmpty()) return;
            Minecraft mc = Minecraft.getInstance();
            Vec3 cam = e.getCamera().getPosition();
            PoseStack ps = e.getPoseStack();
            MultiBufferSource.BufferSource buffers = mc.renderBuffers().bufferSource();

            ps.pushPose();
            ps.translate(-cam.x, -cam.y, -cam.z);
            VertexConsumer lines = buffers.getBuffer(RenderType.lines());
            for (StructureQuery.Found f : list) {
                float[] c = color(f.id());
                int[] b = f.box();
                LevelRenderer.renderLineBox(ps, lines, b[0], b[1], b[2], b[3] + 1, b[4] + 1, b[5] + 1, c[0], c[1], c[2], 1f);
                int[] p = f.pieces();
                for (int i = 0; i + 5 < p.length; i += 6)
                    LevelRenderer.renderLineBox(ps, lines, p[i], p[i + 1], p[i + 2], p[i + 3] + 1, p[i + 4] + 1, p[i + 5] + 1,
                            c[0], c[1], c[2], 0.35f);
            }
            buffers.endBatch(RenderType.lines());
            ps.popPose();

            // names, floating above each structure (see-through so you can find underground ones)
            for (StructureQuery.Found f : list) {
                int[] b = f.box();
                double x = (b[0] + b[3] + 1) / 2.0, z = (b[2] + b[5] + 1) / 2.0;
                double y = Math.min(b[4] + 1.5, Math.max(b[1] + 1.5, cam.y + 2));   // near eye level if it's tall
                if (cam.distanceToSqr(x, y, z) > LABEL_RANGE * LABEL_RANGE) continue;
                float[] c = color(f.id());
                int rgb = 0xFF000000 | ((int) (c[0] * 255) << 16) | ((int) (c[1] * 255) << 8) | (int) (c[2] * 255);
                DebugRenderer.renderFloatingText(ps, buffers, name(f.id()), x, y, z, rgb, 0.045f, true, 0f, true);
            }
            buffers.endBatch();
        }
    }

    /** Pixelmon structures gold, vanilla blue, other mods' white. */
    static float[] color(String id) {
        if (id.startsWith("pixelmon:")) return new float[]{1f, 0.78f, 0.15f};
        if (id.startsWith("minecraft:")) return new float[]{0.45f, 0.75f, 1f};
        return new float[]{0.95f, 0.95f, 0.95f};
    }

    /** "pixelmon:misc/haunted_tower" -> the game's own name ("Haunted Tower") or a tidied-up id. */
    static String name(String id) {
        int colon = id.indexOf(':');
        String ns = id.substring(0, colon), path = id.substring(colon + 1);
        for (String key : new String[]{"structure." + ns + "." + path, "structure." + ns + "." + path.replace('/', '.')})
            if (I18n.exists(key)) return I18n.get(key);
        String last = path.substring(path.lastIndexOf('/') + 1);
        StringBuilder sb = new StringBuilder();
        for (String w : last.split("_")) if (!w.isEmpty()) sb.append(sb.length() > 0 ? " " : "").append(Character.toUpperCase(w.charAt(0))).append(w.substring(1));
        return sb.toString();
    }

    private OverlayClient() {}
}
