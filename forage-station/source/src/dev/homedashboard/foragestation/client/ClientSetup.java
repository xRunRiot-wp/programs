package dev.homedashboard.foragestation.client;

import dev.homedashboard.foragestation.ForageStation;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;

public final class ClientSetup {
    private ClientSetup() {}

    public static void init(IEventBus modBus) {
        modBus.addListener((EntityRenderersEvent.RegisterRenderers e) ->
                e.registerBlockEntityRenderer(ForageStation.STATION_BE.get(), ctx -> new StationRenderer()));
    }
}
