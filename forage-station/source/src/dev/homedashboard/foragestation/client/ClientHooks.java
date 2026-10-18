package dev.homedashboard.foragestation.client;

import dev.homedashboard.foragestation.Network;
import net.minecraft.client.Minecraft;

public final class ClientHooks {
    private ClientHooks() {}

    public static void onPicker(Network.Picker p) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.screen instanceof PickerScreen s && s.pos().equals(p.pos())) s.show(p);
        else mc.setScreen(new PickerScreen(p));
    }
}
