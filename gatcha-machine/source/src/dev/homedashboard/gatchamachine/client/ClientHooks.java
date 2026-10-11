package dev.homedashboard.gatchamachine.client;

import dev.homedashboard.gatchamachine.Network;
import net.minecraft.client.Minecraft;

/** Client-only packet handling; only loaded when a packet actually arrives on the client. */
public final class ClientHooks {
    public static int points;
    public static boolean unlocked;

    private ClientHooks() {}

    public static void onPoints(Network.Points p) {
        points = p.points();
        unlocked = p.unlocked();
    }

    public static void onOpen(Network.Open p) {
        points = p.points();
        unlocked = p.unlocked();
        Minecraft.getInstance().setScreen(new GatchaScreen(p.unseen(), p.total()));
    }

    public static void onSpin(Network.SpinResult p) {
        points = p.points();
        if (Minecraft.getInstance().screen instanceof GatchaScreen screen) screen.startSpin(p.tier(), p.reel());
    }
}
