package dev.homedashboard.biomecompass.client;

import dev.homedashboard.biomecompass.Network;
import net.minecraft.client.Minecraft;

/** Client-only packet handling; only loaded when a packet actually arrives on the client. */
public final class ClientHooks {
    private ClientHooks() {}

    public static void onOpen(Network.Open p) {
        Minecraft.getInstance().setScreen(new CompassScreen(p));
    }

    public static void onAbsorb(Network.Absorb p) {
        AbsorbEffect.start(p.entityId(), p.biome());
    }
}
