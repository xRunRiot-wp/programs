package dev.homedashboard.foragestation.client;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import dev.homedashboard.foragestation.StationBlockEntity;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderer;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.util.Mth;
import net.minecraft.world.item.ItemDisplayContext;

/** The Pokemon's picture slowly turning and bobbing above the station. */
public class StationRenderer implements BlockEntityRenderer<StationBlockEntity> {
    @Override
    public void render(StationBlockEntity be, float partial, PoseStack pose, MultiBufferSource buf, int light, int overlay) {
        if (be.photo().isEmpty() || be.getLevel() == null) return;
        float t = be.getLevel().getGameTime() + partial;
        pose.pushPose();
        pose.translate(0.5, 1.45 + Mth.sin(t / 12f) * 0.05, 0.5);
        pose.mulPose(Axis.YP.rotationDegrees(t * 1.5f % 360));
        pose.scale(0.8f, 0.8f, 0.8f);
        Minecraft.getInstance().getItemRenderer().renderStatic(be.photo(), ItemDisplayContext.FIXED, 0xF000F0, OverlayTexture.NO_OVERLAY, pose, buf, be.getLevel(), 0);
        pose.popPose();
    }
}
