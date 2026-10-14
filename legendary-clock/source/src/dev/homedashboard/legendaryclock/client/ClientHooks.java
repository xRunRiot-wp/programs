package dev.homedashboard.legendaryclock.client;

import dev.homedashboard.legendaryclock.Network;
import net.minecraft.client.Minecraft;

import java.util.List;
import java.util.Locale;

/** Client-only: the last timers from the server, counted down locally between updates. */
public final class ClientHooks {
    private ClientHooks() {}

    private static Network.Status last;
    private static long receivedAt;

    public static void onStatus(Network.Status s) {
        last = s;
        receivedAt = System.currentTimeMillis();
    }

    public static void openScreen() {
        Minecraft.getInstance().setScreen(new ClockScreen());
    }

    /** Null until the server has sent anything, or once updates stop (clock put away, left the world). */
    public static Network.Status status() {
        return last != null && System.currentTimeMillis() - receivedAt < 3000 ? last : null;
    }

    /** ms left now (counting down since the last update), or Network.OFF. */
    public static long msLeft(Network.Timer t) {
        return t.msLeft() == Network.OFF ? Network.OFF : Math.max(0, t.msLeft() - (System.currentTimeMillis() - receivedAt));
    }

    /** "12:34", "1:02:03", or "Any moment" once the timer is up. */
    public static String countdown(Network.Timer t) {
        long ms = msLeft(t);
        if (ms == Network.OFF) return "Off";
        if (ms <= 0) return "Any moment";
        long s = (ms + 999) / 1000;
        return s >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
                : String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60);
    }

    /** Pixelmon's names (DAWN, MIDNIGHT...) as words, joined: "Night + Midnight". */
    public static String times(List<String> names) {
        if (names.isEmpty()) return "-";
        StringBuilder sb = new StringBuilder();
        for (String n : names) {
            if (!sb.isEmpty()) sb.append(" + ");
            sb.append(n.charAt(0)).append(n.substring(1).toLowerCase(Locale.ROOT));
        }
        return sb.toString();
    }
}
